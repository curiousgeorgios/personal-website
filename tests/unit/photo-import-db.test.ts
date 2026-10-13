import { beforeEach, describe, expect, test } from "vitest";
import { postRow, upsertPhoto, upsertPosts } from "../../scripts/photo-import-db.mjs";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "f6".repeat(32);
const OTHER_SHA = "a7".repeat(32);
let db: D1Database;

const photo = (over: Record<string, unknown> = {}) => ({
  id: "postA-01", collection: "postA", position: 0, title: "", needsRawReview: false,
  print: { key: `prints/postA-01/${SHA}.jpg`, width: 4000, height: 6000, bytes: 1234, sha256: SHA },
  previews: [{ key: `photos/previews/postA-01/${SHA}/240.webp`, file: "x", width: 160, height: 240, format: "webp", bytes: 9, sha256: SHA }],
  ...over,
});
const post = (over: Record<string, unknown> = {}) => ({ collection: "postA", publishedAt: "2025-02-02T20:27:48+11:00", place: "bondi beach, sydney", ...over });
const postRowOf = (collection: string) => db.prepare("SELECT * FROM photo_posts WHERE collection = ?").bind(collection).first();
const photoRowOf = (id: string) => db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();

beforeEach(() => {
  db = sqliteD1();
});

describe("posts", () => {
  test("store the time in seconds and the date in the post's own offset, never UTC's", () => {
    expect(postRow(post())).toEqual(["postA", 1738488468, "2025-02-02", "bondi beach, sydney"]);
    // Half past midnight in Sydney (still the 2nd in UTC) and an evening in Malta (+01:00)
    expect(postRow(post({ publishedAt: "2025-02-03T00:30:00+11:00" }))[2]).toBe("2025-02-03");
    expect(postRow(post({ publishedAt: "2025-02-02T23:30:00+01:00" }))[2]).toBe("2025-02-02");
  });

  test("are inserted, then updated by a re-import", async () => {
    await upsertPosts(db, [post()]);
    expect(await postRowOf("postA")).toMatchObject({ published_at: 1738488468, published_on: "2025-02-02", place: "bondi beach, sydney", place_edited: 0 });
    await upsertPosts(db, [post({ publishedAt: "2025-02-03T00:30:00+11:00", place: "bronte, sydney" })]);
    expect(await postRowOf("postA")).toMatchObject({ published_on: "2025-02-03", place: "bronte, sydney" });
  });

  test("keep a place George edited in /admin, while the time still updates", async () => {
    await upsertPosts(db, [post()]);
    await db.prepare("UPDATE photo_posts SET place = 'tamarama, sydney', place_edited = 1 WHERE collection = 'postA'").run();
    await upsertPosts(db, [post({ place: "bondi beach, sydney", publishedAt: "2025-02-02T20:30:00+11:00" })]);
    expect(await postRowOf("postA")).toMatchObject({ place: "tamarama, sydney", place_edited: 1, published_at: 1738488600 });
  });
});

describe("a place the lookup can't find", () => {
  test("never replaces one it found, but a place cleared in /admin stays cleared", async () => {
    await upsertPosts(db, [post()]);
    await upsertPosts(db, [post({ place: null })]);
    expect(await postRowOf("postA")).toMatchObject({ place: "bondi beach, sydney" });
    await db.prepare("UPDATE photo_posts SET place = NULL, place_edited = 1 WHERE collection = 'postA'").run();
    await upsertPosts(db, [post({ place: "bondi beach, sydney" })]);
    expect(await postRowOf("postA")).toMatchObject({ place: null, place_edited: 1 });
  });
});

describe("a post whose time another post already has", () => {
  test("is refused by name, before anything is written", async () => {
    await upsertPosts(db, [post()]);
    const other = post({ collection: "postB" });
    const fresh = post({ collection: "postC", publishedAt: "2025-03-03T10:00:00+11:00" });
    await expect(upsertPosts(db, [fresh, other])).rejects.toThrow("Post postB has the same time as postA, already in the database");
    expect(await postRowOf("postC")).toBeNull();
    expect(await postRowOf("postB")).toBeNull();
  });

  test("lets a post keep its own time on a re-import", async () => {
    await upsertPosts(db, [post()]);
    await expect(upsertPosts(db, [post()])).resolves.toBeUndefined();
  });
});

describe("photographs", () => {
  beforeEach(async () => {
    await upsertPosts(db, [post()]);
  });

  test("take their title from the manifest only when first inserted", async () => {
    await upsertPhoto(db, photo({ title: "from the manifest" }));
    expect(await photoRowOf("postA-01")).toMatchObject({ title: "from the manifest", published: 0 });
    await db.prepare("UPDATE photos SET title = 'george wrote this' WHERE id = 'postA-01'").run();
    await upsertPhoto(db, photo({ title: "" }));
    expect(await photoRowOf("postA-01")).toMatchObject({ title: "george wrote this" });
  });

  test("set and update raw_review from needsRawReview", async () => {
    await upsertPhoto(db, photo({ needsRawReview: true }));
    expect(await photoRowOf("postA-01")).toMatchObject({ raw_review: 1 });
    await upsertPhoto(db, photo({ needsRawReview: false }));
    expect(await photoRowOf("postA-01")).toMatchObject({ raw_review: 0 });
  });

  test("keep their publication for the same master, and lose it for a changed one", async () => {
    await upsertPhoto(db, photo());
    await db.prepare("UPDATE photos SET published = 1 WHERE id = 'postA-01'").run();
    await upsertPhoto(db, photo());
    expect(await photoRowOf("postA-01")).toMatchObject({ published: 1 });
    await upsertPhoto(db, photo({ print: { key: `prints/postA-01/${OTHER_SHA}.jpg`, width: 4000, height: 6000, bytes: 1300, sha256: OTHER_SHA } }));
    expect(await photoRowOf("postA-01")).toMatchObject({ published: 0, print_sha256: OTHER_SHA });
  });

  test("store only each preview's key, size and format", async () => {
    await upsertPhoto(db, photo());
    expect(JSON.parse((await photoRowOf("postA-01"))!.previews as string)).toEqual([{ key: `photos/previews/postA-01/${SHA}/240.webp`, width: 160, height: 240, format: "webp" }]);
  });
});
