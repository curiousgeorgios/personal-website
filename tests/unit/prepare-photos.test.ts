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

const BONDI = { subLocality: null, locality: "Bondi Beach", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
const BRONTE = { subLocality: null, locality: "Bronte", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
const SURRY = { subLocality: null, locality: "Surry Hills", subAdministrativeArea: "Imaginary Council", administrativeArea: "NSW", isoCountryCode: "AU" };
const portraits = (count: number) => Array.from({ length: count }, (_, i) => ({ slide: i + 1, width: 300, height: 450 }));

describe("photos:prepare's posts and places", () => {
  test("writes each post's time and most common place, asking about each photo once", { timeout: 90_000 }, async () => {
    const workspace = await photoWorkspace([
      { post: "postA", publishedAt: "2025-02-02T20:27:48+11:00", slides: portraits(5) },
      // Half past midnight in Sydney is still the 2nd in UTC: the offset has to survive into the manifest
      { post: "postB", publishedAt: "2025-02-03T00:30:00+11:00", slides: [{ slide: 1, width: 450, height: 300 }] },
    ]);
    folders.push(workspace.dir);
    // Every slide of postA has GPS, so the first, middle and last are asked (1, 3 and 5), and two say bondi. postB has none.
    const places = { "postA-01-original.jpg": BRONTE, "postA-02-original.jpg": BRONTE, "postA-03-original.jpg": BONDI, "postA-04-original.jpg": BRONTE, "postA-05-original.jpg": BONDI };
    const { stdout } = await workspace.prepare(places);
    const manifest = JSON.parse(await readFile(join(workspace.output, "manifest.json"), "utf8"));
    expect(manifest.posts).toEqual([
      { collection: "postA", publishedAt: "2025-02-02T20:27:48+11:00", place: "bondi beach, sydney" },
      { collection: "postB", publishedAt: "2025-02-03T00:30:00+11:00", place: null },
    ]);
    expect(await workspace.geocoded()).toEqual(["postA-01-original.jpg", "postA-03-original.jpg", "postA-05-original.jpg"]);
    expect(stdout).toContain("2025-02-02 postA bondi beach, sydney");
    expect(stdout).toContain("2025-02-03 postB (no place)");
    const cache = join(workspace.output, "metadata", "places.json");
    expect((await stat(cache)).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(await readFile(cache, "utf8")))).toEqual(["postA-01", "postA-03", "postA-05"]);
    // A second run asks nobody: every lookup is cached
    await workspace.prepare(places);
    expect(await workspace.geocoded()).toHaveLength(3);
  });

  test("an Australian place missing from the city map stops prepare before the manifest, naming the key and its post", { timeout: 60_000 }, async () => {
    const workspace = await photoWorkspace([{ post: "postC", publishedAt: "2026-03-01T12:00:00+11:00", slides: portraits(1) }]);
    folders.push(workspace.dir);
    await expect(workspace.prepare({ "postC-01-original.jpg": SURRY })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('"AU/NSW/Imaginary Council"  (post postC)') });
    await expect(stat(join(workspace.output, "manifest.json"))).rejects.toThrow();
  });

  test("a lookup that may work later (offline, rate limited) stops prepare, keeps what it had and resumes from there", { timeout: 90_000 }, async () => {
    const workspace = await photoWorkspace([{ post: "postD", publishedAt: "2026-03-02T12:00:00+11:00", slides: portraits(3) }]);
    folders.push(workspace.dir);
    const cache = join(workspace.output, "metadata", "places.json");
    await expect(workspace.prepare({ "postD-01-original.jpg": BONDI, "postD-02-original.jpg": { __exit: 75 }, "postD-03-original.jpg": BRONTE })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining("run photos:prepare again"),
    });
    await expect(stat(join(workspace.output, "manifest.json"))).rejects.toThrow();
    expect(Object.keys(JSON.parse(await readFile(cache, "utf8")))).toEqual(["postD-01"]);
    // Back online: only the two it hadn't answered are asked
    await workspace.prepare({ "postD-01-original.jpg": BONDI, "postD-02-original.jpg": BRONTE, "postD-03-original.jpg": BRONTE });
    expect(await workspace.geocoded()).toEqual(["postD-01-original.jpg", "postD-02-original.jpg", "postD-02-original.jpg", "postD-03-original.jpg"]);
    const manifest = JSON.parse(await readFile(join(workspace.output, "manifest.json"), "utf8"));
    expect(manifest.posts).toEqual([{ collection: "postD", publishedAt: "2026-03-02T12:00:00+11:00", place: "bronte, sydney" }]);
  });

  test("a lookup that will fail every time caches nothing, leaves the post without a place and lists it", { timeout: 90_000 }, async () => {
    const workspace = await photoWorkspace([
      { post: "postE", publishedAt: "2026-03-03T12:00:00+11:00", slides: portraits(1) },
      { post: "postF", publishedAt: "2026-03-04T12:00:00+11:00", slides: portraits(1) },
    ]);
    folders.push(workspace.dir);
    const { stdout } = await workspace.prepare({ "postE-01-original.jpg": { __exit: 1 }, "postF-01-original.jpg": BONDI });
    const manifest = JSON.parse(await readFile(join(workspace.output, "manifest.json"), "utf8"));
    expect(manifest.posts.map((post: { place: string | null }) => post.place)).toEqual([null, "bondi beach, sydney"]);
    expect(stdout).toContain("no place for postE: lookup failed, rerun or set it in /admin");
    expect(stdout).not.toContain("no place for postF");
    // The failure is not cached, so a rerun asks about it again; the answered one is not asked twice
    expect(Object.keys(JSON.parse(await readFile(join(workspace.output, "metadata", "places.json"), "utf8")))).toEqual(["postF-01"]);
    await workspace.prepare({ "postE-01-original.jpg": BRONTE, "postF-01-original.jpg": BONDI });
    expect(await workspace.geocoded()).toEqual(["postE-01-original.jpg", "postF-01-original.jpg", "postE-01-original.jpg"]);
  });
});
