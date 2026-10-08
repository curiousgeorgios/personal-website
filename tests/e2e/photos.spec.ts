import { expect, test } from "@playwright/test";
import { ADMIN } from "./admin";

test.skip(({ browserName }) => browserName !== "chromium", "HTTP backend behaviour, checked once");
test.describe.configure({ mode: "serial" });
const PRIVATE = { "cache-control": "private, no-store", "cloudflare-cdn-cache-control": "no-store", "referrer-policy": "no-referrer" };

test("public API returns responsive previews without drafts or private object keys", async ({ request }) => {
  const response = await request.get(`${ADMIN}/api/photos?limit=1`);
  expect(response.status()).toBe(200);
  const page = await response.json();
  expect(page.photos.map((p: { id: string }) => p.id)).toEqual(["fixture-01"]);
  expect(page.next).toBe(0);
  expect(page.photos[0].previews).toHaveLength(6);
  expect(JSON.stringify(page)).not.toMatch(/prints\/|print_key|token=/);
  const preview = await request.get(`${ADMIN}${page.photos[0].previews[0].url}`);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toBe("image/webp");
  expect(preview.headers()["cache-control"]).toContain("immutable");
  expect((await request.get(`${ADMIN}/api/photos/fixture-03`)).status()).toBe(404);
  expect((await request.get(`${ADMIN}/api/photos?token=secret`)).status()).toBe(400);
});

test("signed photo links download real JPEG bytes with GET, range and HEAD", async ({ request }) => {
  const issued = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { photoId: "fixture-01", expiresInSeconds: 600 } });
  expect(issued.status()).toBe(201);
  const link = await issued.json();
  expect(issued.headers()["cache-control"]).toBe("no-store");
  const full = await request.get(link.url);
  expect(full.status()).toBe(200);
  expect(full.headers()).toMatchObject(PRIVATE);
  expect(full.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await full.body();
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  expect(bytes.length).toBe(Number(full.headers()["content-length"]));
  const part = await request.get(link.url, { headers: { Range: "bytes=100-199" } });
  expect(part.status()).toBe(206);
  expect(await part.body()).toEqual(bytes.subarray(100, 200));
  const head = await request.head(link.url);
  expect(head.status()).toBe(200);
  expect((await head.body()).length).toBe(0);
  expect(head.headers()).toMatchObject(PRIVATE);
  const different = link.url.replace("fixture-01", "fixture-02");
  expect((await request.get(different)).status()).toBe(403);
  const revoked = await request.delete(`${ADMIN}/admin/photos/links?grantId=${link.grantId}`, { headers: { Origin: ADMIN } });
  expect(revoked.status()).toBe(200);
  expect((await request.get(link.url, { headers: { "If-None-Match": full.headers().etag } })).status()).toBe(403);
});

test("catalogue grants expose protected links and stop working after revocation", async ({ request }) => {
  const issued = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: {} });
  expect(issued.status()).toBe(201);
  const link = await issued.json();
  const page = await request.get(link.url);
  expect(page.headers()).toMatchObject(PRIVATE);
  const catalogue = await page.json();
  expect(catalogue.photos.map((p: { id: string }) => p.id)).toEqual(["fixture-01", "fixture-02"]);
  expect((await request.get(`${ADMIN}${catalogue.photos[1].downloadUrl}`)).status()).toBe(200);
  await request.delete(`${ADMIN}/admin/photos/links?grantId=${link.grantId}`, { headers: { Origin: ADMIN } });
  expect((await request.get(link.url)).status()).toBe(403);
});

test("missing tokens, public bucket bypasses and cross-origin issuance are refused", async ({ request }) => {
  for (const path of ["/photos/downloads/fixture-01", "/api/photos/downloads"]) {
    const response = await request.get(`${ADMIN}${path}`);
    expect(response.status()).toBe(403);
    expect(response.headers()).toMatchObject(PRIVATE);
  }
  expect((await request.get(`${ADMIN}/media/prints/fixture-01/any.jpg`)).status()).toBe(404);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: "https://other.example" }, data: {} })).status()).toBe(403);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { expiresInSeconds: 31 * 86400 } })).status()).toBe(400);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { unused: "x".repeat(5000) } })).status()).toBe(413);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { photoId: "fixture-03" } })).status()).toBe(404);
});

test("publishing requires verified assets and refreshes the catalogue", async ({ request }) => {
  const path = `${ADMIN}/admin/photos/fixture-03`;
  const published = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: true } });
  expect(published.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-03?`)).status()).toBe(200);
  const unpublished = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: false } });
  expect(unpublished.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-03`)).status()).toBe(404);
});
