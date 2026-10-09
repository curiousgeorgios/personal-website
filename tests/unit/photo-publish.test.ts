import { beforeEach, describe, expect, test, vi } from "vitest";
import { publicationPurges, publishRefusal, setPublished, VERIFY_CONCURRENCY } from "../../src/lib/photos/publish";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "b8".repeat(32);
let db: D1Database;
let prints: Map<string, { size: number; contentType: string; sha256: string }>;
let media: Map<string, string>;
let inFlight = 0;
let most = 0;

const previews = (id: string) =>
  [240, 480, 960, 1600].flatMap((size) => ["webp", "avif"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format })));

/** R2 head requests that take a moment, so the most in flight at once can be counted */
async function headed<T>(answer: () => T): Promise<T> {
  inFlight++;
  most = Math.max(most, inFlight);
  await new Promise((done) => setTimeout(done, 1));
  inFlight--;
  return answer();
}
const printBucket = { head: vi.fn((key: string) => headed(() => { const o = prints.get(key); return o ? { size: o.size, httpMetadata: { contentType: o.contentType }, customMetadata: { sha256: o.sha256 } } : null; })) };
const mediaBucket = { head: vi.fn((key: string) => headed(() => (media.has(key) ? { httpMetadata: { contentType: media.get(key) } } : null))) };
const deps = () => ({ db, prints: printBucket as unknown as R2Bucket, media: mediaBucket as unknown as R2Bucket });

async function addPhoto(id: string, position: number, published = false, list = previews(id)) {
  await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, "post", position, "", published ? 1 : 0, JSON.stringify(list), `prints/${id}/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
  prints.set(`prints/${id}/${SHA}.jpg`, { size: 1000, contentType: "image/jpeg", sha256: SHA });
  for (const preview of list) media.set(preview.key, `image/${preview.format}`);
}
const publishedOf = async (id: string) => db.prepare("SELECT published FROM photos WHERE id = ?").bind(id).first("published");

beforeEach(async () => {
  db = sqliteD1();
  prints = new Map();
  media = new Map();
  inFlight = 0;
  most = 0;
  printBucket.head.mockClear();
  mediaBucket.head.mockClear();
  await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)").bind("post", 1_700_000_000, "2023-11-15", null).run();
  await addPhoto("post-01", 0);
  await addPhoto("post-02", 1);
});

describe("setPublished", () => {
  test("publishes once the master and all eight previews check out", async () => {
    expect(await setPublished(deps(), ["post-01", "post-02"], true)).toEqual({ ok: true });
    expect(await publishedOf("post-01")).toBe(1);
    expect(await publishedOf("post-02")).toBe(1);
    expect(printBucket.head).toHaveBeenCalledTimes(2);
    expect(mediaBucket.head).toHaveBeenCalledTimes(16);
  });

  test("a master that's missing, resized, retyped or changed fails its photo", async () => {
    const key = `prints/post-01/${SHA}.jpg`;
    for (const broken of [undefined, { size: 999, contentType: "image/jpeg", sha256: SHA }, { size: 1000, contentType: "text/html", sha256: SHA }, { size: 1000, contentType: "image/jpeg", sha256: "0".repeat(64) }]) {
      if (broken) prints.set(key, broken);
      else prints.delete(key);
      expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: false, postless: [], unverified: [{ id: "post-01", failed: ["master"] }] });
    }
    expect(await publishedOf("post-01")).toBe(0);
  });

  test("a preview that's missing or of another type fails its photo, and six previews fail without asking R2", async () => {
    media.delete(`photos/previews/post-01/${SHA}/240.avif`);
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: false, postless: [], unverified: [{ id: "post-01", failed: ["240.avif"] }] });
    media.set(`photos/previews/post-01/${SHA}/240.avif`, "image/webp");
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: false, postless: [], unverified: [{ id: "post-01", failed: ["240.avif"] }] });
    await addPhoto("post-03", 2, false, previews("post-03").filter((p) => !p.key.includes("/240.")));
    printBucket.head.mockClear();
    expect(await setPublished(deps(), ["post-03"], true)).toEqual({ ok: false, postless: [], unverified: [{ id: "post-03", failed: ["previews"] }] });
    expect(printBucket.head).not.toHaveBeenCalled();
  });

  test("all or nothing: one failing photo keeps the whole set as it was, and the failures are named in order", async () => {
    await addPhoto("post-03", 2);
    prints.delete(`prints/post-03/${SHA}.jpg`);
    media.delete(`photos/previews/post-01/${SHA}/1600.webp`);
    expect(await setPublished(deps(), ["post-01", "post-02", "post-03"], true)).toEqual({ ok: false, postless: [], unverified: [{ id: "post-01", failed: ["1600.webp"] }, { id: "post-03", failed: ["master"] }] });
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(0);
  });

  test("an id that doesn't exist changes nothing", async () => {
    expect(await setPublished(deps(), ["post-01", "post-99"], true)).toEqual({ ok: false, missing: ["post-99"] });
    expect(await setPublished(deps(), [], true)).toEqual({ ok: false, missing: [] });
    expect(await publishedOf("post-01")).toBe(0);
  });

  test("a photo whose post row is missing is refused when publishing, since the public queries would never show it", async () => {
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("lost-01", "no-such-post", 5, "", 0, JSON.stringify(previews("lost-01")), `prints/lost-01/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
    prints.set(`prints/lost-01/${SHA}.jpg`, { size: 1000, contentType: "image/jpeg", sha256: SHA });
    for (const preview of previews("lost-01")) media.set(preview.key, `image/${preview.format}`);
    expect(await setPublished(deps(), ["post-01", "lost-01"], true)).toEqual({ ok: false, postless: ["lost-01"], unverified: [] });
    expect(await publishedOf("post-01")).toBe(0);
    expect(await publishedOf("lost-01")).toBe(0);
    // Hiding it is still fine: nothing is shown either way
    expect(await setPublished(deps(), ["lost-01"], false)).toEqual({ ok: true });
  });

  test("a set with photos that have no post and photos that fail verification reports both, and nothing changes", async () => {
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("lost-01", "no-such-post", 5, "", 0, JSON.stringify(previews("lost-01")), `prints/lost-01/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
    prints.set(`prints/lost-01/${SHA}.jpg`, { size: 1000, contentType: "image/jpeg", sha256: SHA });
    for (const preview of previews("lost-01")) media.set(preview.key, `image/${preview.format}`);
    prints.delete(`prints/post-02/${SHA}.jpg`);
    media.delete(`photos/previews/post-02/${SHA}/480.webp`);
    media.delete(`photos/previews/post-02/${SHA}/960.avif`);
    const outcome = await setPublished(deps(), ["post-01", "post-02", "lost-01"], true);
    expect(outcome).toEqual({ ok: false, postless: ["lost-01"], unverified: [{ id: "post-02", failed: ["master", "480.webp", "960.avif"] }] });
    for (const id of ["post-01", "post-02", "lost-01"]) expect(await publishedOf(id)).toBe(0);
    if (!("postless" in outcome)) throw new Error("expected a refusal");
    expect(publishRefusal(outcome)).toBe("Photo has no post, so it would stay hidden. Import its post first. Verified print master unavailable. Preview 480.webp, 960.avif unavailable.");
  });

  test("the refusal says which of the master, the preview set or the previews failed", () => {
    expect(publishRefusal({ ok: false, postless: [], unverified: [{ id: "a", failed: ["master"] }] })).toBe("Verified print master unavailable.");
    expect(publishRefusal({ ok: false, postless: [], unverified: [{ id: "a", failed: ["previews"] }] })).toBe("Responsive previews unavailable.");
    expect(publishRefusal({ ok: false, postless: [], unverified: [{ id: "a", failed: ["240.avif"] }] })).toBe("Preview 240.avif unavailable.");
  });

  test("hiding asks R2 nothing, and a repeat of either is fine", async () => {
    await addPhoto("post-03", 2, true);
    expect(await setPublished(deps(), ["post-03"], false)).toEqual({ ok: true });
    expect(await setPublished(deps(), ["post-03"], false)).toEqual({ ok: true });
    expect(printBucket.head).not.toHaveBeenCalled();
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: true });
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: true });
    expect(await publishedOf("post-03")).toBe(0);
  });

  test("a 20-photo post's 180 checks run at most ten at a time", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `big-${String(i + 1).padStart(2, "0")}`);
    for (const [i, id] of ids.entries()) await addPhoto(id, 10 + i);
    printBucket.head.mockClear();
    mediaBucket.head.mockClear();
    expect(await setPublished(deps(), ids, true)).toEqual({ ok: true });
    expect(printBucket.head.mock.calls.length + mediaBucket.head.mock.calls.length).toBe(180);
    expect(most).toBe(VERIFY_CONCURRENCY);
  });
});

describe("publicationPurges", () => {
  test("a publish purges the gallery and the home page; a hide also purges each photograph's previews", () => {
    expect(publicationPurges(["post-01", "post-02"], true)).toEqual(["photos", "logbook"]);
    expect(publicationPurges(["post-01", "post-02"], false)).toEqual(["photos", "logbook", "photo-post-01", "photo-post-02"]);
  });
});
