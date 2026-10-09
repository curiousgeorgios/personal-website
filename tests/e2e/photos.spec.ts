import { expect, test } from "@playwright/test";
import { signPhotoToken } from "../../src/lib/photos/tokens";
import { ADMIN } from "./admin";
import { GALLERY } from "./gallery-site";
import { adminD1, catalogueLink } from "./photo-store";

test.skip(({ browserName }) => browserName !== "chromium", "HTTP backend behaviour, checked once");
test.describe.configure({ mode: "serial" });
const PRIVATE = { "cache-control": "private, no-store", "cloudflare-cdn-cache-control": "no-store", "referrer-policy": "no-referrer" };
/** The admin server's fixture signing key (playwright.config.ts) */
const SECRET = "1".repeat(64);
const tokenOf = (url: string) => encodeURIComponent(new URL(url).searchParams.get("token")!);

test("public API returns responsive previews without drafts or private object keys", async ({ request }) => {
  const response = await request.get(`${ADMIN}/api/photos?limit=1`);
  expect(response.status()).toBe(200);
  const page = await response.json();
  expect(page.photos.map((p: { id: string }) => p.id)).toEqual(["fixture-01"]);
  expect(page.next).toBe(0);
  expect(page.photos[0].previews).toHaveLength(8);
  expect(page.photos[0]).toMatchObject({ date: "2026-09-27", place: "bondi, sydney" });
  expect(JSON.stringify(page)).not.toMatch(/prints\/|print_key|token=/);
  const preview = await request.get(`${ADMIN}${page.photos[0].previews[0].url}`);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toBe("image/webp");
  expect(preview.headers()["cache-control"]).toContain("immutable");
  expect((await request.get(`${ADMIN}/api/photos/fixture-03`)).status()).toBe(404);
  expect(await (await request.get(`${ADMIN}/api/photos/fixture-01`)).json()).toMatchObject({ id: "fixture-01", date: "2026-09-27", place: "bondi, sydney" });
  expect((await request.get(`${ADMIN}/api/photos?token=secret`)).status()).toBe(400);
});

test("a catalogue link opens the page, and its photos download as JPEG with GET, range and HEAD", async ({ request }) => {
  const link = await catalogueLink(request);
  expect(new URL(link.url).pathname).toBe("/photos/downloads");
  const download = `${ADMIN}/photos/downloads/fixture-01?token=${tokenOf(link.url)}`;
  const full = await request.get(download);
  expect(full.status()).toBe(200);
  expect(full.headers()).toMatchObject(PRIVATE);
  expect(full.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await full.body();
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  expect(bytes.length).toBe(Number(full.headers()["content-length"]));
  const part = await request.get(download, { headers: { Range: "bytes=100-199" } });
  expect(part.status()).toBe(206);
  expect(await part.body()).toEqual(bytes.subarray(100, 200));
  const head = await request.head(download);
  expect(head.status()).toBe(200);
  expect((await head.body()).length).toBe(0);
  expect(head.headers()).toMatchObject(PRIVATE);
  const revoked = await request.delete(`${ADMIN}/admin/photos/links?grantId=${link.grantId}`, { headers: { Origin: ADMIN } });
  expect(revoked.status()).toBe(200);
  expect((await request.get(download, { headers: { "If-None-Match": full.headers().etag } })).status()).toBe(403);
});

test("a photo-scoped grant, made only inside the site, reaches its own photo and nothing else", async ({ request }) => {
  const now = Math.floor(Date.now() / 1000);
  const grant = { grantId: crypto.randomUUID(), photoId: "fixture-01", expiresAt: now + 600 };
  adminD1(`INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES ('${grant.grantId}', 'fixture-01', ${grant.expiresAt})`);
  const token = encodeURIComponent(await signPhotoToken(SECRET, grant, now));
  expect((await request.get(`${ADMIN}/photos/downloads/fixture-01?token=${token}`)).status()).toBe(200);
  expect((await request.get(`${ADMIN}/photos/downloads/fixture-02?token=${token}`)).status()).toBe(403);
  expect((await request.get(`${ADMIN}/api/photos/downloads?token=${token}`)).status()).toBe(403);
  expect((await request.get(`${ADMIN}/photos/downloads?token=${token}`)).status()).toBe(403);
});

test("catalogue grants expose protected links through the JSON route and stop working after revocation", async ({ request }) => {
  const link = await catalogueLink(request);
  const page = await request.get(`${ADMIN}/api/photos/downloads?token=${tokenOf(link.url)}`);
  expect(page.headers()).toMatchObject(PRIVATE);
  const catalogue = await page.json();
  const ids = catalogue.photos.map((p: { id: string }) => p.id);
  // The admin specs publish and hide their own posts meanwhile, so only photographs no spec changes are pinned
  expect(ids).toEqual(expect.arrayContaining(["fixture-01", "fixture-02"]));
  expect(ids).not.toContain("fixture-03");
  expect(catalogue.photos[0]).toMatchObject({ id: "fixture-01", date: "2026-09-27", place: "bondi, sydney" });
  expect((await request.get(`${ADMIN}${catalogue.photos[1].downloadUrl}`)).status()).toBe(200);
  await request.delete(`${ADMIN}/admin/photos/links?grantId=${link.grantId}`, { headers: { Origin: ADMIN } });
  expect((await request.get(`${ADMIN}/api/photos/downloads?token=${tokenOf(link.url)}`)).status()).toBe(403);
});

test("missing tokens, public bucket bypasses, photo links and cross-origin issuance are refused", async ({ request }) => {
  for (const path of ["/photos/downloads/fixture-01", "/api/photos/downloads"]) {
    const response = await request.get(`${ADMIN}${path}`);
    expect(response.status()).toBe(403);
    expect(response.headers()).toMatchObject(PRIVATE);
  }
  expect((await request.get(`${ADMIN}/media/prints/fixture-01/any.jpg`)).status()).toBe(404);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: "https://other.example" }, data: {} })).status()).toBe(403);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { expiresInSeconds: 31 * 86400 } })).status()).toBe(400);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { unused: "x".repeat(5000) } })).status()).toBe(413);
  const scoped = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { photoId: "fixture-01" } });
  expect(scoped.status()).toBe(400);
  expect(await scoped.json()).toEqual({ error: "photo links are internal" });
});

test("publishing requires verified assets and refreshes the catalogue", async ({ request }) => {
  // fixture-d-01, which no other spec changes (the admin server's store is shared by every spec on 4333)
  const path = `${ADMIN}/admin/photos/fixture-d-01`;
  const hidden = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: false } });
  expect(hidden.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-d-01`)).status()).toBe(404);
  const published = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: true } });
  expect(published.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-d-01?`)).status()).toBe(200);
});

// On the gallery server (4335), whose photo fixture no spec changes
test("the entry mode pages posts newest first, with only the gallery's previews", async ({ request }) => {
  const response = await request.get(`${GALLERY}/api/photos?by=entry&limit=4`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300");
  const page = await response.json();
  expect(page.entries.map((entry: { collection: string }) => entry.collection)).toEqual(["fixture", "fixture-b", "fixture-c", "fixture-d"]);
  expect(page.next).toBe(1766610000);
  expect(page.entries[0]).toMatchObject({ collection: "fixture", date: "2026-09-27", place: "bondi, sydney" });
  expect(page.entries[0]).not.toHaveProperty("publishedAt");
  expect(page.entries[1].place).toBeNull();
  expect(page.entries[0].photos.map((photo: { id: string }) => photo.id)).toEqual(["fixture-01", "fixture-02"]);
  expect(page.entries[0].photos[0].previews.map((preview: { url: string }) => preview.url.split("/").at(-1))).toEqual(["240.webp", "240.avif", "480.webp", "480.avif"]);
  const rest = await (await request.get(`${GALLERY}/api/photos?by=entry&before=${page.next}`)).json();
  expect(rest.entries.map((entry: { collection: string }) => entry.collection)).toEqual(["fixture-e", "fixture-f"]);
  expect(rest.next).toBeNull();
  for (const query of ["by=entry&limit=13", "by=entry&before=abc", "by=entry&after=1", "by=post"]) {
    expect((await request.get(`${GALLERY}/api/photos?${query}`)).status()).toBe(400);
  }
});
