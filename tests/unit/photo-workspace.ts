import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const PREPARE = fileURLToPath(new URL("../../scripts/prepare-photos.mjs", import.meta.url));

// A recorded geocoder: a file named in FAKE_PLACES has GPS and answers its placemark (or null); any other has none.
// Each lookup (never a GPS check) is logged to FAKE_LOG, so a test can count what would have gone to Apple.
const FAKE_TOOL = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
const places = JSON.parse(readFileSync(process.env.FAKE_PLACES, "utf8"));
const args = process.argv.slice(2);
const name = basename(args.at(-1));
const known = Object.hasOwn(places, name);
if (args[0] === "--has-gps") console.log(known ? "true" : "false");
else {
  appendFileSync(process.env.FAKE_LOG, name + "\\n");
  console.log(JSON.stringify(known ? places[name] : null));
}
`;

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
 * originals, an index, a selection and a recorded geocoder. Synthetic only: no test reads the real library, asks Apple
 * or touches prepared assets.
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
  const tool = join(dir, "fake-place.mjs");
  await writeFile(tool, FAKE_TOOL, { mode: 0o755 });
  const log = join(dir, "geocoded.log");
  await writeFile(log, "");
  const output = join(dir, "assets");
  return {
    dir,
    output,
    /** Runs photos:prepare with the recorded geocoder answering `places` (file name to placemark) */
    async prepare(places: Record<string, object | null> = {}) {
      const answers = join(dir, "places.json");
      await writeFile(answers, JSON.stringify(places));
      return run(process.execPath, [PREPARE, "--selection", join(dir, "selection.json"), "--index", join(dir, "index.json"), "--output", output], {
        env: { ...process.env, PHOTO_PLACE_TOOL: tool, PHOTO_PLACE_DELAY_MS: "0", FAKE_PLACES: answers, FAKE_LOG: log },
      });
    },
    /** The file names the geocoder was asked about, in order */
    async geocoded() {
      return (await readFile(log, "utf8")).split("\n").filter(Boolean);
    },
  };
}
