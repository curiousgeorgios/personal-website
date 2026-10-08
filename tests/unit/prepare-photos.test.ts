import { createHash } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, test } from "vitest";
import { photoWorkspace, type FixturePost } from "./photo-workspace";

const POSTS: FixturePost[] = [
  { post: "postA", publishedAt: "2025-02-02T20:27:48+11:00", slides: [{ slide: 1, width: 300, height: 450 }, { slide: 2, width: 450, height: 300 }] },
];
interface PreviewRecord { key: string; file: string; width: number; height: number }
const EIGHT = ["240.webp", "240.avif", "480.webp", "480.avif", "960.webp", "960.avif", "1600.webp", "1600.avif"];
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const name = (preview: PreviewRecord) => preview.key.split("/").at(-1);
let folders: string[] = [];
afterEach(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
  folders = [];
});

async function prepared(posts = POSTS) {
  const workspace = await photoWorkspace(posts);
  folders.push(workspace.dir);
  await workspace.prepare();
  return workspace;
}

describe("photos:prepare", () => {
  test("encodes eight previews per photo, 240 to 1600 in WebP and AVIF, each fitted inside its square", { timeout: 60_000 }, async () => {
    const { output } = await prepared();
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    const [portrait, landscape] = manifest.photos as { previews: PreviewRecord[] }[];
    expect(portrait.previews.map(name)).toEqual(EIGHT);
    expect(portrait.previews.slice(0, 2).map((p) => [p.width, p.height])).toEqual([[160, 240], [160, 240]]);
    expect(landscape.previews[0]).toMatchObject({ width: 240, height: 160 });
    for (const preview of portrait.previews) expect((await sharp(join(output, preview.file)).metadata()).width).toBe(preview.width);
  });

  test("a checkpoint from before the 240s gains them from its master, without rendering it again", { timeout: 60_000 }, async () => {
    const workspace = await prepared();
    const checkpoint = join(workspace.output, "metadata", "postA-01.json");
    const before = JSON.parse(await readFile(checkpoint, "utf8"));
    // Make it look like a checkpoint written before the gallery: no 240s, on disk or in the record
    const old = (before.previews as PreviewRecord[]).filter((p) => !p.key.includes("/240."));
    for (const preview of (before.previews as PreviewRecord[]).filter((p) => p.key.includes("/240."))) await rm(join(workspace.output, preview.file));
    await writeFile(checkpoint, JSON.stringify({ ...before, previews: old }));
    const masterPath = join(workspace.output, before.print.file);
    const masterBefore = { sha256: sha256(await readFile(masterPath)), mtimeMs: (await stat(masterPath)).mtimeMs };
    await workspace.prepare();
    const after = JSON.parse(await readFile(checkpoint, "utf8"));
    // Fixed expectations, not the earlier run: the old code writes six previews and never gains the 240s
    expect((after.previews as PreviewRecord[]).map(name)).toEqual(EIGHT);
    // The full records, hashes and sizes included: the derived 240s match a fresh encode and the rest are untouched
    expect(after.previews).toEqual(before.previews);
    expect(after.print).toEqual(before.print);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(sha256(await readFile(masterPath))).toBe(masterBefore.sha256);
    expect(masterBefore.sha256).toBe(before.print.sha256);
    expect((await stat(masterPath)).mtimeMs).toBe(masterBefore.mtimeMs);
    for (const preview of after.previews as PreviewRecord[]) await stat(join(workspace.output, preview.file));
  });

  test("a checkpoint whose master has changed on disk is refused, not trusted", { timeout: 60_000 }, async () => {
    const workspace = await prepared();
    const checkpoint = join(workspace.output, "metadata", "postA-01.json");
    const before = JSON.parse(await readFile(checkpoint, "utf8"));
    await writeFile(checkpoint, JSON.stringify({ ...before, previews: (before.previews as PreviewRecord[]).filter((p) => !p.key.includes("/240.")) }));
    // The same size, so the cheap size check passes and only the hash can catch it
    await writeFile(join(workspace.output, before.print.file), Buffer.alloc(before.print.bytes, 1));
    await expect(workspace.prepare()).rejects.toThrow("Prepared master changed on disk");
  });
});
