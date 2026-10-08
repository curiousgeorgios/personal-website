import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { SignJWT } from "jose";
import { sqliteD1 } from "./sqlite-d1";
import { downloadPhoto } from "../../src/lib/photos/download";
import { grantIsActive, insertGrant, photoPage, revokeGrant } from "../../src/lib/photos/store";
import { signPhotoToken, verifyPhotoToken, photoSigningKey, MAX_LINK_SECONDS } from "../../src/lib/photos/tokens";
import { pageOptions } from "../../src/lib/photos/http";
import { isMediaKey } from "../../src/lib/media";

const KEY = "a1".repeat(32), OTHER_KEY = "b2".repeat(32);
const NOW = 1800000000;
const ID = "fixture-01", OTHER = "fixture-02", DRAFT = "fixture-03";
const SHA = "c3".repeat(32);
const BYTES = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
const ETAG = '"fixture-etag"';

async function database() {
  const db = sqliteD1();
  for (const [position, id] of [ID, OTHER, DRAFT].entries()) {
    const previews = [480, 960, 1600].flatMap((size) => ["avif", "webp"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format })));
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, "fixture", position, "", id === DRAFT ? 0 : 1, JSON.stringify(previews), `prints/${id}/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
  }
  return db;
}

function bucket() {
  const base = { size: 1000, httpEtag: ETAG, httpMetadata: { contentType: "image/jpeg" } };
  return {
    head: vi.fn(async () => base),
    get: vi.fn(async (_key: string, options?: { range: { offset: number; length: number } }) => ({ ...base,
      body: new Blob([options?.range ? BYTES.slice(options.range.offset, options.range.offset + options.range.length) : BYTES]).stream(),
    })),
  } as unknown as R2Bucket & { head: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
}
async function issue(db: D1Database, photoId: string | null = ID) {
  const grant = { grantId: crypto.randomUUID(), photoId, expiresAt: NOW + 3600 };
  await insertGrant(db, grant);
  return { grant, token: await signPhotoToken(KEY, grant, NOW) };
}
const request = (token: string, headers: Record<string, string> = {}, method = "GET") => new Request(`https://curiousgeorge.dev/photos/downloads/${ID}?token=${token}`, { headers, method });
const alter = (token: string) => { const [head, body, signature] = token.split("."); return `${head}.${body}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`; };

describe("signed photo tokens", () => {
  test("round trips a photo-scoped and catalogue-scoped grant", async () => {
    for (const photoId of [ID, null]) {
      const grant = { grantId: crypto.randomUUID(), photoId, expiresAt: NOW + 60 };
      expect(await verifyPhotoToken(KEY, await signPhotoToken(KEY, grant, NOW), NOW)).toEqual(grant);
    }
  });
  test("rejects altered signatures, another key, expiry, malformed and oversized tokens", async () => {
    const token = await signPhotoToken(KEY, { grantId: crypto.randomUUID(), photoId: ID, expiresAt: NOW + 60 }, NOW);
    expect(await verifyPhotoToken(KEY, alter(token), NOW)).toBeNull();
    expect(await verifyPhotoToken(OTHER_KEY, token, NOW)).toBeNull();
    expect(await verifyPhotoToken(KEY, token, NOW + 60)).toBeNull();
    for (const value of ["", "bad", "a".repeat(2049)]) expect(await verifyPhotoToken(KEY, value, NOW)).toBeNull();
  });
  test("refuses an unset or weak signing key", () => {
    for (const key of [undefined, "", "password", "A1".repeat(32)]) expect(() => photoSigningKey(key)).toThrow();
  });
  test("rejects a token made for another purpose and future issuance", async () => {
    const token = await new SignJWT({ photo_id: ID }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("curiousgeorge.dev").setAudience("admin").setSubject(crypto.randomUUID()).setIssuedAt(NOW).setExpirationTime(NOW + 60).sign(photoSigningKey(KEY));
    expect(await verifyPhotoToken(KEY, token, NOW)).toBeNull();
    const future = await signPhotoToken(KEY, { grantId: crypto.randomUUID(), photoId: ID, expiresAt: NOW + 120 }, NOW + 10);
    expect(await verifyPhotoToken(KEY, future, NOW)).toBeNull();
  });
  test("refuses links longer than 30 days and invalid photo identifiers", async () => {
    await expect(signPhotoToken(KEY, { grantId: crypto.randomUUID(), photoId: ID, expiresAt: NOW + MAX_LINK_SECONDS + 1 }, NOW)).rejects.toThrow();
    await expect(signPhotoToken(KEY, { grantId: crypto.randomUUID(), photoId: "../secret", expiresAt: NOW + 60 }, NOW)).rejects.toThrow();
  });
});

describe("private R2 download delivery", () => {
  let db: D1Database;
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => { db = await database(); errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errors.mockRestore());

  test("streams the JPEG with private cache exclusion and attachment headers", async () => {
    const { token } = await issue(db);
    const response = await downloadPhoto(db, bucket(), KEY, ID, request(token), NOW);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(Object.fromEntries(response.headers)).toMatchObject({ "content-type": "image/jpeg", "content-length": "1000", "cache-control": "private, no-store", "cloudflare-cdn-cache-control": "no-store", "content-disposition": 'attachment; filename="fixture-01.jpg"', "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
  });
  test("rejects missing, duplicate, altered and expired tokens without touching R2", async () => {
    const { token } = await issue(db);
    const b = bucket();
    for (const req of [request(""), request(alter(token)), request(token + "&token=" + token)]) expect((await downloadPhoto(db, b, KEY, ID, req, NOW)).status).toBe(403);
    expect((await downloadPhoto(db, b, KEY, ID, request(token), NOW + 3600)).status).toBe(403);
    expect(b.head).not.toHaveBeenCalled();
    expect(b.get).not.toHaveBeenCalled();
  });
  test("enforces scope and allows catalogue grants on multiple published photos", async () => {
    const scoped = await issue(db), all = await issue(db, null);
    const b = bucket();
    expect((await downloadPhoto(db, b, KEY, OTHER, request(scoped.token), NOW)).status).toBe(403);
    expect(b.head).not.toHaveBeenCalled();
    for (const id of [ID, OTHER]) expect((await downloadPhoto(db, b, KEY, id, request(all.token), NOW)).status).toBe(200);
  });
  test("revocation applies before even a conditional 304 or HEAD response", async () => {
    const { grant, token } = await issue(db);
    await revokeGrant(db, grant.grantId, NOW);
    const b = bucket();
    for (const method of ["GET", "HEAD"]) expect((await downloadPhoto(db, b, KEY, ID, request(token, { "If-None-Match": ETAG }, method), NOW)).status).toBe(403);
    expect(b.head).not.toHaveBeenCalled();
  });
  test("a token without a recorded grant or with changed stored scope is refused", async () => {
    const { grant, token } = await issue(db);
    await db.prepare("UPDATE photo_download_grants SET photo_id = ? WHERE id = ?").bind(OTHER, grant.grantId).run();
    expect(await grantIsActive(db, grant, NOW)).toBe(false);
    expect((await downloadPhoto(db, bucket(), KEY, ID, request(token), NOW)).status).toBe(403);
    await db.prepare("DELETE FROM photo_download_grants WHERE id = ?").bind(grant.grantId).run();
    expect((await downloadPhoto(db, bucket(), KEY, ID, request(token), NOW)).status).toBe(403);
  });
  test("draft and unpublished photos stay unavailable even to catalogue tokens", async () => {
    const { token } = await issue(db, null);
    const b = bucket();
    expect((await downloadPhoto(db, b, KEY, DRAFT, request(token), NOW)).status).toBe(404);
    await db.prepare("UPDATE photos SET published = 0 WHERE id = ?").bind(ID).run();
    expect((await downloadPhoto(db, b, KEY, ID, request(token), NOW)).status).toBe(404);
    expect(b.head).not.toHaveBeenCalled();
  });
  test("HEAD checks access and metadata but never reads the body", async () => {
    const { token } = await issue(db), b = bucket();
    const response = await downloadPhoto(db, b, KEY, ID, request(token, { Range: "bytes=100-199" }, "HEAD"), NOW);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("1000");
    expect(await response.text()).toBe("");
    expect(b.get).not.toHaveBeenCalled();
  });
  test("supports bounded, open and oversized suffix ranges", async () => {
    const { token } = await issue(db);
    for (const [range, expected, length] of [["bytes=100-199", "bytes 100-199/1000", 100], ["bytes=900-", "bytes 900-999/1000", 100], ["bytes=-5000", "bytes 0-999/1000", 1000]] as const) {
      const response = await downloadPhoto(db, bucket(), KEY, ID, request(token, { Range: range }), NOW);
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(expected);
      expect((await response.arrayBuffer()).byteLength).toBe(length);
    }
  });
  test("refuses malformed, zero-length, multiple and out-of-bounds ranges", async () => {
    const { token } = await issue(db), b = bucket();
    for (const range of ["bytes=-0", "bytes=2000-", "bytes=500-400", "bytes=", "bytes=0-1,5-6"]) {
      const response = await downloadPhoto(db, b, KEY, ID, request(token, { Range: range }), NOW);
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */1000");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(b.get).not.toHaveBeenCalled();
  });
  test("If-Range mismatch returns the complete file, and If-Match failure returns 412", async () => {
    const { token } = await issue(db);
    expect((await downloadPhoto(db, bucket(), KEY, ID, request(token, { Range: "bytes=0-9", "If-Range": '"old"' }), NOW)).status).toBe(200);
    expect((await downloadPhoto(db, bucket(), KEY, ID, request(token, { "If-Match": '"old"' }), NOW)).status).toBe(412);
  });
  test("unconfigured key and R2 failures fail closed without logging the token", async () => {
    const { token } = await issue(db), b = bucket();
    expect((await downloadPhoto(db, b, undefined, ID, request(token), NOW)).status).toBe(503);
    expect(b.head).not.toHaveBeenCalled();
    b.head.mockRejectedValue(new Error(`failure at ?token=${token}`));
    expect((await downloadPhoto(db, b, KEY, ID, request(token), NOW)).status).toBe(503);
    expect(errors.mock.calls.flat().join(" ")).not.toContain(token);
  });
  test("wrong content type, size and changed objects cannot be streamed", async () => {
    const { token } = await issue(db), b = bucket();
    b.head.mockResolvedValueOnce({ size: 1000, httpEtag: ETAG, httpMetadata: { contentType: "text/html" } });
    expect((await downloadPhoto(db, b, KEY, ID, request(token), NOW)).status).toBe(503);
    b.head.mockResolvedValueOnce({ size: 500, httpEtag: ETAG, httpMetadata: { contentType: "image/jpeg" } });
    expect((await downloadPhoto(db, b, KEY, ID, request(token), NOW)).status).toBe(503);
    b.get.mockResolvedValueOnce({ size: 1000, httpEtag: '"changed"', body: new Blob([BYTES]).stream() });
    expect((await downloadPhoto(db, b, KEY, ID, request(token), NOW)).status).toBe(503);
  });
});

test("public catalogue is paginated, excludes drafts and exposes no private object keys", async () => {
  const db = await database();
  const first = await photoPage(db, -1, 1);
  expect(first.photos.map((p) => p.id)).toEqual([ID]);
  expect(first.next).toBe(0);
  const second = await photoPage(db, first.next!, 1);
  expect(second.photos.map((p) => p.id)).toEqual([OTHER]);
  expect(second.next).toBeNull();
  expect(JSON.stringify(first)).not.toMatch(/prints\/|print_key|sha256|Photos Library/);
  expect((await photoPage(db, -1, 24, "absent")).photos).toEqual([]);
});
test("catalogue pagination validates its bounds", () => {
  for (const query of ["limit=0", "limit=49", "after=NaN", "after=-2", "collection=../secret"]) expect(pageOptions(new URL(`https://curiousgeorge.dev/api/photos?${query}`))).toBeNull();
  expect(pageOptions(new URL("https://curiousgeorge.dev/api/photos"))).toEqual({ after: -1, limit: 24, collection: null });
});
test("the public media route only allows previews, never print masters", () => {
  expect(isMediaKey(`photos/previews/${ID}/${SHA}/480.webp`)).toBe(true);
  for (const key of [`prints/${ID}/${SHA}.jpg`, `photos/prints/${ID}.jpg`, "photos/previews/../prints/a.jpg"]) expect(isMediaKey(key)).toBe(false);
});
