import { beforeEach, describe, expect, test } from "vitest";
import { entryOptions } from "../../src/lib/photos/http";
import { entryPage, photoById, photoPage } from "../../src/lib/photos/store";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "d4".repeat(32);
let db: D1Database;
let position = 0;

const previews = (id: string) =>
  [240, 480, 960, 1600].flatMap((size) => ["webp", "avif"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format })));

/** A post and its photographs, in post order; [id, published] */
async function post(collection: string, publishedAt: string, place: string | null, photos: [string, boolean][]) {
  await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)")
    .bind(collection, Date.parse(publishedAt) / 1000, publishedAt.slice(0, 10), place).run();
  for (const [id, published] of photos) await photo(id, collection, published);
}

async function photo(id: string, collection: string, published: boolean) {
  await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, collection, position++, "", published ? 1 : 0, JSON.stringify(previews(id)), `prints/${id}/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
}

beforeEach(async () => {
  db = sqliteD1();
  position = 0;
  // Oldest first here; the gallery shows them newest first
  await post("oldest", "2025-02-02T20:27:48+11:00", "valletta, malta", [["oldest-01", true]]);
  await post("hidden", "2025-06-01T10:00:00+10:00", null, [["hidden-01", false]]);
  await post("middle", "2025-08-09T16:45:00+10:00", null, [["middle-01", true], ["middle-02", false], ["middle-03", true]]);
  await post("newest", "2026-09-27T18:30:00+10:00", "bondi, sydney", [["newest-01", true]]);
});

describe("entryPage", () => {
  test("pages posts newest first, asking for one more than the limit to know if there's a next page", async () => {
    const first = await entryPage(db, null, 2);
    expect(first.entries.map((entry) => entry.collection)).toEqual(["newest", "middle"]);
    expect(first.next).toBe(Date.parse("2025-08-09T16:45:00+10:00") / 1000);
    const second = await entryPage(db, first.next, 2);
    expect(second.entries.map((entry) => entry.collection)).toEqual(["oldest"]);
    expect(second.next).toBeNull();
  });

  test("a post with no published photograph is left out, and hidden photographs are left out of their post", async () => {
    const { entries } = await entryPage(db, null, 12);
    expect(entries.map((entry) => entry.collection)).toEqual(["newest", "middle", "oldest"]);
    expect(entries[1].photos.map((p) => p.id)).toEqual(["middle-01", "middle-03"]);
  });

  test("each entry and photograph carries the post's date and place, with only the 240 and 480 previews", async () => {
    const { entries } = await entryPage(db, null, 4);
    expect(entries[0]).toMatchObject({ collection: "newest", date: "2026-09-27", place: "bondi, sydney", publishedAt: 1790497800 });
    expect(entries[0].photos[0]).toMatchObject({ id: "newest-01", date: "2026-09-27", place: "bondi, sydney", width: 2048, height: 2048, downloadBytes: 1000 });
    expect(entries[0].photos[0].previews.map((p) => p.url.split("/").at(-1))).toEqual(["240.webp", "240.avif", "480.webp", "480.avif"]);
    expect(entries[1].place).toBeNull();
    expect(JSON.stringify(entries)).not.toMatch(/prints\/|print_key|sha256/);
  });

  test("the cursor is strict: a post at exactly that second is on the previous page", async () => {
    const { entries } = await entryPage(db, 1790497800, 4);
    expect(entries[0].collection).toBe("middle");
    expect((await entryPage(db, 1, 4)).entries).toEqual([]);
  });

  test("a photograph whose post row is missing isn't shown anywhere public", async () => {
    await photo("orphan-01", "orphan", true);
    expect(await photoById(db, "orphan-01")).toBeNull();
    expect((await photoPage(db, -1, 48)).photos.map((p) => p.id)).not.toContain("orphan-01");
    expect((await entryPage(db, null, 12)).entries.map((entry) => entry.collection)).not.toContain("orphan");
  });

  test("the catalogue without the entry mode keeps all eight previews and gains date and place", async () => {
    const page = await photoPage(db, -1, 48);
    expect(page.photos[0]).toMatchObject({ id: "oldest-01", date: "2025-02-02", place: "valletta, malta" });
    expect(page.photos[0].previews).toHaveLength(8);
  });
});

describe("entryOptions", () => {
  const options = (query: string) => entryOptions(new URL(`https://curiousgeorge.dev/api/photos?${query}`));

  test("defaults to the newest four", () => {
    expect(options("by=entry")).toEqual({ before: null, limit: 4 });
    expect(options("by=entry&before=1738488468&limit=12")).toEqual({ before: 1738488468, limit: 12 });
  });

  test("refuses anything else, as the catalogue does", () => {
    for (const query of ["by=post", "by=entry&limit=0", "by=entry&limit=13", "by=entry&before=abc", "by=entry&before=12345678901", "by=entry&before=-1", "by=entry&after=1", "by=entry&token=x", "by=entry&by=entry"]) {
      expect(options(query)).toBeNull();
    }
  });
});
