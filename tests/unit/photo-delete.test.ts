import { beforeEach, expect, test, vi } from "vitest";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { loadAdmin, postPhotoIds } from "../../src/lib/admin/store";
import { submitForm } from "../../src/lib/admin/submit";
import { publishedPreviews } from "../../src/lib/media";
import { deletePhoto } from "../../src/lib/photos/delete";
import { downloadPhoto } from "../../src/lib/photos/download";
import { photoAccessFixture } from "./photo-access-fixture";
import { setPublished } from "../../src/lib/photos/publish";
import { entryPage, issueOrderGrant, photoById, photoMaster, photoPage, photoPageData, insertGrant } from "../../src/lib/photos/store";
import { signPhotoToken } from "../../src/lib/photos/tokens";
import { upsertPhoto } from "../../scripts/photo-import-db.mjs";
import { sqliteD1 } from "./sqlite-d1";

const env = vi.hoisted(() => ({ DB: undefined as unknown as D1Database }));
vi.mock("cloudflare:workers", () => ({ env }));
const { DELETE } = await import("../../src/pages/admin/photos/[id]");
const NOW = 1_800_000_000;
const KEY = "a1".repeat(32);
const SHA = "c9".repeat(32);
const ID = "post-01";
let db: D1Database;

const photo = (id = ID, position = 0) => ({
  id, collection: "post", position, title: "dawn", needsRawReview: false,
  print: { key: `prints/${id}/${SHA}.jpg`, width: 2048, height: 2048, bytes: 1000, sha256: SHA },
  previews: [240, 480, 960, 1600].flatMap((size) => ["webp", "avif"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format }))),
});
const deps = (): ActionDeps => ({ db, images: {} as ImagesBinding, media: {} as R2Bucket });
const form = (confirm?: string) => {
  const result = new FormData();
  result.set("intent", "photo.delete");
  result.set("id", ID);
  if (confirm !== undefined) result.set("confirm", confirm);
  return result;
};

beforeEach(async () => {
  env.DB = db = sqliteD1();
  await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on) VALUES ('post', 1738488468, '2025-02-02')").run();
  await upsertPhoto(db, photo());
  await db.prepare("UPDATE photos SET published = 1 WHERE id = ?").bind(ID).run();
});

test("deletion removes every public view and the admin row, with no effect on other photographs", async () => {
  await upsertPhoto(db, photo("post-02", 1));
  await db.prepare("UPDATE photos SET published = 1 WHERE id = 'post-02'").run();
  expect(await deletePhoto(db, ID, NOW)).toBe(true);
  expect(await photoById(db, ID)).toBeNull();
  expect(await photoPageData(db, ID)).toBeNull();
  expect((await photoPage(db)).photos.map((p) => p.id)).toEqual(["post-02"]);
  expect((await entryPage(db, null, 4)).entries[0].photos.map((p) => p.id)).toEqual(["post-02"]);
  expect(await publishedPreviews(db)(ID)).toBe(false);
  expect((await loadAdmin(db, NOW)).photographs[0].photos.map((p) => p.id)).toEqual(["post-02"]);
  expect(await postPhotoIds(db, "post")).toEqual(["post-02"]);
});

test("repeated deletion is safe, an empty post leaves the admin and malformed or unknown ids do nothing", async () => {
  expect(await deletePhoto(db, ID, NOW)).toBe(true);
  expect(await deletePhoto(db, ID, NOW + 60)).toBe(true);
  expect(await db.prepare("SELECT deleted_at FROM photos WHERE id = ?").bind(ID).first("deleted_at")).toBe(NOW);
  expect((await loadAdmin(db, NOW)).photographs).toEqual([]);
  expect(await deletePhoto(db, "gone", NOW)).toBe(false);
  expect(await deletePhoto(db, "../post-01", NOW)).toBe(false);
});

test("re-import, a stale title form and publishing cannot bring a deleted photo back or replace its master", async () => {
  await deletePhoto(db, ID, NOW);
  await upsertPhoto(db, { ...photo(), title: "replacement", print: { ...photo().print, sha256: "ff".repeat(32), bytes: 2000 } });
  expect(await photoMaster(db, ID)).toMatchObject({ title: "dawn", print_sha256: SHA, print_bytes: 1000, published: 0 });
  expect(await setPublished({ db, prints: {} as R2Bucket, media: {} as R2Bucket }, [ID], true)).toEqual({ ok: false, missing: [ID] });
  const title = new FormData();
  title.set("intent", "photo.title"); title.set("id", ID); title.set("title", "stale edit");
  expect(await runAction(title, deps())).toMatchObject({ ok: false });
  await expect(db.prepare("UPDATE photos SET published = 1 WHERE id = ?").bind(ID).run()).rejects.toThrow("deleted photos cannot be published");
});

test("a deletion racing a post's publish prevents publication of every photo in that post", async () => {
  await upsertPhoto(db, photo("post-02", 1));
  await db.prepare("UPDATE photos SET published = 0").run();
  const prints = { head: vi.fn(async () => {
    await deletePhoto(db, ID, NOW);
    return { size: 1000, httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: SHA } };
  }) } as unknown as R2Bucket;
  const media = { head: vi.fn(async (key: string) => ({ httpMetadata: { contentType: `image/${key.split(".").at(-1)}` } })) } as unknown as R2Bucket;
  expect(await setPublished({ db, prints, media }, [ID, "post-02"], true)).toEqual({ ok: false, missing: [ID] });
  expect(await db.prepare("SELECT SUM(published) AS n FROM photos").first("n")).toBe(0);
});

test("catalogue links lose access while an existing order's internal master link still works", async () => {
  await db.prepare("INSERT INTO print_orders (id, country, print_total, delivery_amount, status, livemode, created_at, updated_at) VALUES ('existing-order', 'AU', 5900, 2000, 'paid', 1, ?, ?)").bind(NOW, NOW).run();
  await db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES ('existing-order', 1, ?, 'small', 'x12x18', 'unframed', 1, 5900)").bind(ID).run();
  const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: NOW + 3600 };
  await insertGrant(db, grant);
  const catalogueToken = await signPhotoToken(KEY, grant, NOW);
  const orderUrl = await issueOrderGrant(db, KEY, "existing-order", ID, 3600, "https://curiousgeorge.dev", NOW);
  const session = await photoAccessFixture(db, KEY, NOW);
  await deletePhoto(db, ID, NOW);
  expect(await db.prepare("SELECT photo_id FROM print_order_items WHERE order_id = 'existing-order'").first("photo_id")).toBe(ID);
  expect(await db.prepare("SELECT status FROM print_orders WHERE id = 'existing-order'").first("status")).toBe("paid");
  const bucket = { head: vi.fn(async () => ({ size: 1000, httpEtag: '"master"', httpMetadata: { contentType: "image/jpeg" } })) } as unknown as R2Bucket;
  expect((await downloadPhoto(db, bucket, KEY, ID, new Request(`https://curiousgeorge.dev/photos/downloads/${ID}?token=${catalogueToken}`, { method: "HEAD" }), NOW)).status).toBe(403);
  expect(bucket.head).not.toHaveBeenCalled();
  expect((await downloadPhoto(db, bucket, KEY, ID, new Request(`https://curiousgeorge.dev/photos/downloads/${ID}`, { method: "HEAD", headers: { Cookie: session.cookie } }), NOW)).status).toBe(404);
  expect(bucket.head).not.toHaveBeenCalled();
  expect((await downloadPhoto(db, bucket, KEY, ID, new Request(orderUrl, { method: "HEAD" }), NOW)).status).toBe(200);
});

test("the form requires explicit confirmation and purges the gallery, home page and previews", async () => {
  for (const confirm of [undefined, "no", "true"]) expect(await runAction(form(confirm), deps())).toMatchObject({ ok: false, form: `photo-${ID}`, errors: { confirm: "tick the box to delete it" } });
  expect(await photoById(db, ID)).not.toBeNull();
  const cache = { invalidate: vi.fn(async () => {}) };
  expect(await submitForm(form("yes"), deps(), cache, () => {})).toEqual({ redirect: "/admin/?saved=photographs&note=deleted#photographs" });
  expect(cache.invalidate).toHaveBeenCalledWith({ tags: ["photos", "logbook", `photo-${ID}`] });
});

const remove = async (body: unknown, id = ID, cache = { invalidate: vi.fn(async () => {}) }) => DELETE({ params: { id }, cache,
  request: new Request(`https://curiousgeorge.dev/admin/photos/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
} as unknown as Parameters<typeof DELETE>[0]) as Promise<Response>;

test("the JSON route requires confirmation, is private, purges caches and tolerates repeat requests", async () => {
  for (const body of [{}, { confirm: "true" }, { confirm: false }]) expect((await remove(body)).status).toBe(400);
  expect(await photoById(db, ID)).not.toBeNull();
  const cache = { invalidate: vi.fn(async () => {}) };
  const response = await remove({ confirm: true }, ID, cache);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ id: ID, deleted: true, cacheInvalidated: true });
  expect(cache.invalidate).toHaveBeenCalledWith({ tags: ["photos", "logbook", `photo-${ID}`] });
  expect((await remove({ confirm: true })).status).toBe(200);
  expect((await remove({ confirm: true }, "missing")).status).toBe(404);
});

test("a failed purge reports that the deletion saved but caches could be stale", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await remove({ confirm: true }, ID, { invalidate: vi.fn(async () => { throw new Error("unavailable"); }) });
    expect(await response.json()).toEqual({ id: ID, deleted: true, cacheInvalidated: false });
    expect(await photoById(db, ID)).toBeNull();
  } finally { error.mockRestore(); }
});
