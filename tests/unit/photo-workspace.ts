import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const PREPARE = fileURLToPath(new URL("../../scripts/prepare-photos.mjs", import.meta.url));

export interface FixtureSlide {
  slide: number;
  width: number;
  height: number;
}
export interface FixturePost {
  post: string;
  publishedAt: string;
  slides: FixtureSlide[];
}

/**
 * A private folder outside the checkout, laid out as photos:prepare reads George's: small edited JPEGs and their
 * originals, an index and a selection. Synthetic only: no test ever reads the real library or prepared assets.
 */
export async function photoWorkspace(posts: FixturePost[]) {
  const dir = await mkdtemp(join(tmpdir(), "photo-prepare-"));
  const sources = join(dir, "sources");
  await mkdir(sources);
  const index = [];
  const included = [];
  for (const { post, publishedAt, slides } of posts) {
    for (const { slide, width, height } of slides) {
      const id = `${post}-${String(slide).padStart(2, "0")}`;
      const edited = join(sources, `${id}-edited.jpg`);
      const original = join(sources, `${id}-original.jpg`);
      for (const path of [edited, original]) await sharp({ create: { width, height, channels: 3, background: "#4a6b5e" } }).jpeg().toFile(path);
      index.push({
        post, slide, published_at: publishedAt, status: "matched", media_type: "photo", largest_original_pixels: 24_000_000,
        files: [
          { path: edited, kind: "edited", resource_role: "primary", display_width: width, display_height: height },
          { path: original, kind: "original", resource_role: "primary", display_width: width, display_height: height },
        ],
      });
      included.push({ id, post, slide });
    }
  }
  await writeFile(join(dir, "index.json"), JSON.stringify(index));
  await writeFile(join(dir, "selection.json"), JSON.stringify({ schema_version: 1, included, excluded: [], counts: {} }));
  const output = join(dir, "assets");
  return {
    dir,
    output,
    prepare: (env: Record<string, string> = {}) =>
      run(process.execPath, [PREPARE, "--selection", join(dir, "selection.json"), "--index", join(dir, "index.json"), "--output", output], { env: { ...process.env, ...env } }),
  };
}
