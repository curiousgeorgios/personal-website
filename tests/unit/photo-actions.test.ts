import { beforeEach, describe, expect, test, vi } from "vitest";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "c9".repeat(32);
let db: D1Database;
let prints: Map<string, { size: number; sha256: string }>;
let media: Set<string>;

const previews = (id: string) =>
  [240, 480, 960, 1600].flatMap((size) => ["webp", "avif"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format })));

const deps = (): ActionDeps => ({
  db,
  images: {} as ImagesBinding,
  prints: { head: vi.fn(async (key: string) => { const o = prints.get(key); return o ? { size: o.size, httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: o.sha256 } } : null; }) } as unknown as R2Bucket,
  media: { head: vi.fn(async (key: string) => (media.has(key) ? { httpMetadata: { contentType: `image/${key.split(".").at(-1)}` } } : null)) } as unknown as R2Bucket,
});

async function addPhoto(id: string, position: number, published = false) {
  await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, "post", position, "", published ? 1 : 0, JSON.stringify(previews(id)), `prints/${id}/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
  prints.set(`prints/${id}/${SHA}.jpg`, { size: 1000, sha256: SHA });
  for (const preview of previews(id)) media.add(preview.key);
}

const submit = (entries: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return runAction(form, deps());
};
const publishedOf = async (id: string) => db.prepare("SELECT published FROM photos WHERE id = ?").bind(id).first("published");
const placeOf = async () => db.prepare("SELECT place, place_edited FROM photo_posts WHERE collection = 'post'").first();
const titleOf = async (id: string) => db.prepare("SELECT title FROM photos WHERE id = ?").bind(id).first("title");
const SAVED = { ok: true, section: "photographs" };
const PAGE = (message: string) => ({ ok: false, section: null, form: "", errors: { form: message }, values: {} });

beforeEach(async () => {
  db = sqliteD1();
  prints = new Map();
  media = new Set();
  await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES ('post', 1738488468, '2025-02-02', 'bondi beach, sydney')").run();
  for (const [i, id] of ["post-01", "post-02", "post-03"].entries()) await addPhoto(id, i);
});

describe("a post's place", () => {
  test("is saved lowercased and marked edited, so a later import keeps it", async () => {
    expect(await submit({ intent: "post.place", collection: "post", place: "  St Kilda, Melbourne " })).toEqual(SAVED);
    expect(await placeOf()).toEqual({ place: "st kilda, melbourne", place_edited: 1 });
    expect(await submit({ intent: "post.place", collection: "post", place: "o'connor, canberra" })).toEqual(SAVED);
    expect(await placeOf()).toEqual({ place: "o'connor, canberra", place_edited: 1 });
  });

  test("left empty shows no place, and is still George's edit", async () => {
    expect(await submit({ intent: "post.place", collection: "post", place: "" })).toEqual(SAVED);
    expect(await placeOf()).toEqual({ place: null, place_edited: 1 });
  });

  test("outside the place rule comes back with its form, and nothing changes", async () => {
    for (const [place, error] of [["a".repeat(61), "60 characters at most"], ["Ħamrun, malta", "plain latin letters only (accents like é are fine)"]]) {
      expect(await submit({ intent: "post.place", collection: "post", place })).toEqual({ ok: false, section: "photographs", form: "post-post", errors: { place: error }, values: { collection: "post", place } });
    }
    expect(await placeOf()).toEqual({ place: "bondi beach, sydney", place_edited: 0 });
  });

  test("for a post that isn't there is a message for the page", async () => {
    expect(await submit({ intent: "post.place", collection: "gone", place: "bondi" })).toEqual(PAGE("that post no longer exists"));
    expect(await submit({ intent: "post.place", collection: "../x", place: "bondi" })).toEqual(PAGE("that post no longer exists"));
  });
});

describe("publishing or hiding a post", () => {
  test("checks every photo, then publishes them all", async () => {
    expect(await submit({ intent: "post.publish", collection: "post" })).toEqual(SAVED);
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(1);
  });

  test("publishes nothing when any photo fails its checks, and names the ones that did", async () => {
    prints.set(`prints/post-02/${SHA}.jpg`, { size: 1000, sha256: "0".repeat(64) });
    media.delete(`photos/previews/post-03/${SHA}/240.avif`);
    expect(await submit({ intent: "post.publish", collection: "post" })).toEqual({
      ok: false, section: "photographs", form: "post-post",
      errors: { form: "2 photos couldn't be checked: post-02, post-03. publish the others one at a time." }, values: {},
    });
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(0);
  });

  test("says one photo when one fails", async () => {
    prints.delete(`prints/post-01/${SHA}.jpg`);
    expect(await submit({ intent: "post.publish", collection: "post" })).toMatchObject({ errors: { form: "1 photo couldn't be checked: post-01. publish the others one at a time." } });
  });

  test("hiding all, and hiding all again, both count as saved", async () => {
    await submit({ intent: "post.publish", collection: "post" });
    expect(await submit({ intent: "post.hide", collection: "post" })).toEqual(SAVED);
    expect(await submit({ intent: "post.hide", collection: "post" })).toEqual(SAVED);
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(0);
  });

  test("for a post that isn't there is a message for the page", async () => {
    expect(await submit({ intent: "post.publish", collection: "gone" })).toEqual(PAGE("that post no longer exists"));
  });
});

describe("a photograph", () => {
  test("takes a title exactly as typed and can lose it again", async () => {
    expect(await submit({ intent: "photo.title", id: "post-01", title: '<b>dawn</b> & "co"' })).toEqual(SAVED);
    expect(await titleOf("post-01")).toBe('<b>dawn</b> & "co"');
    expect(await submit({ intent: "photo.title", id: "post-01", title: "" })).toEqual(SAVED);
    expect(await titleOf("post-01")).toBe("");
  });

  test("refuses a title over 80 characters or on two lines, with its form", async () => {
    for (const [title, error] of [["x".repeat(81), "80 characters at most"], ["dawn\nat bondi", "one line of plain text"]]) {
      expect(await submit({ intent: "photo.title", id: "post-01", title })).toEqual({ ok: false, section: "photographs", form: "photo-post-01", errors: { title: error }, values: { id: "post-01", title } });
    }
  });

  test("is published alone once its files check out, and hidden alone", async () => {
    expect(await submit({ intent: "photo.publish", id: "post-02" })).toEqual(SAVED);
    expect([await publishedOf("post-01"), await publishedOf("post-02")]).toEqual([0, 1]);
    expect(await submit({ intent: "photo.hide", id: "post-02" })).toEqual(SAVED);
    expect(await publishedOf("post-02")).toBe(0);
  });

  test("that fails its checks stays hidden, with a message on its own row", async () => {
    media.delete(`photos/previews/post-01/${SHA}/960.webp`);
    expect(await submit({ intent: "photo.publish", id: "post-01" })).toEqual({
      ok: false, section: "photographs", form: "photo-post-01",
      errors: { form: "that photo couldn't be checked, so it stays hidden. run the import for it again." }, values: {},
    });
    expect(await publishedOf("post-01")).toBe(0);
  });

  test("with no post stays hidden, and the message says to import its post first", async () => {
    await addPhoto("orphan-01", 9);
    await db.prepare("UPDATE photos SET collection = 'orphan' WHERE id = 'orphan-01'").run();
    expect(await submit({ intent: "photo.publish", id: "orphan-01" })).toEqual({
      ok: false, section: "photographs", form: "photo-orphan-01",
      errors: { form: "Photo has no post, so it would stay hidden. Import its post first." }, values: {},
    });
    media.delete(`photos/previews/orphan-01/${SHA}/240.avif`);
    expect(await submit({ intent: "photo.publish", id: "orphan-01" })).toMatchObject({
      errors: { form: "Photo has no post, so it would stay hidden. Import its post first. that photo couldn't be checked, so it stays hidden. run the import for it again." },
    });
    expect(await publishedOf("orphan-01")).toBe(0);
  });

  test("that isn't there is a message for the page", async () => {
    expect(await submit({ intent: "photo.title", id: "post-99", title: "x" })).toEqual(PAGE("that photo no longer exists"));
    expect(await submit({ intent: "photo.publish", id: "post-99" })).toEqual(PAGE("that photo no longer exists"));
    expect(await submit({ intent: "photo.hide", id: "not an id" })).toEqual(PAGE("that photo no longer exists"));
  });
});
