import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signPhotoToken } from "../../src/lib/photos/tokens";
import { ADMIN } from "./admin";
import { adminD1, catalogueLink } from "./photo-store";

test.skip(({ browserName }) => browserName !== "chromium", "issues links on the admin server: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local admin server's fixture key");
const SECRET = "1".repeat(64);

test("a catalogue link lists every published photo and downloads the master, privately", async ({ page, request }) => {
  const link = await catalogueLink(request);
  const referers: string[] = [];
  const counted: string[] = [];
  const cookies: string[] = [];
  page.on("request", (sent) => {
    const referer = sent.headers().referer;
    if (referer) referers.push(`${sent.url()} from ${referer}`);
    if (new URL(sent.url()).pathname.startsWith("/ingest")) counted.push(sent.url());
  });
  // headers() is synchronous, so no listener is still pending when the test ends and the page closes
  page.on("response", (answer) => { if (answer.headers()["set-cookie"]) cookies.push(answer.url()); });
  const response = await page.goto(link.url);
  expect(response?.status()).toBe(200);
  expect(response?.headers()).toMatchObject({ "cache-control": "private, no-store", "cloudflare-cdn-cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
  await expect(page.locator("h1")).toHaveText("photos, full size");
  // sydneyTime keeps its "pm" on the same line with a no-break space, which \s matches
  await expect(page.locator(".intro")).toHaveText(/^every photo in the gallery as a full-resolution jpeg\. this link works until \d{2}\.\d{2}\.\d{2}, \d{1,2}:\d{2}\s(am|pm) sydney time\. please keep it to yourself\.$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator("script")).toHaveCount(0);
  const files = await page.locator(".download-list a[download]").evaluateAll((all) => all.map((a) => a.getAttribute("download")));
  // Every published photograph no spec changes is listed; the hidden one never is
  expect(files).toEqual(expect.arrayContaining(["fixture-01.jpg", "fixture-02.jpg", "fixture-f-01.jpg"]));
  expect(files).not.toContain("fixture-03.jpg");
  const first = page.locator('a[download="fixture-01.jpg"]');
  await expect(first).toHaveText(/^download · \d+\.\d mb$/);
  const [download] = await Promise.all([page.waitForEvent("download"), first.click()]);
  const bytes = await readFile((await download.path())!);
  const [{ print_sha256: sha }] = adminD1<{ print_sha256: string }>("SELECT print_sha256 FROM photos WHERE id = 'fixture-01'");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  expect(referers).toEqual([]);
  expect(counted).toEqual([]);
  expect(cookies).toEqual([]);
});

test("expired, revoked, garbled and missing links all get the same 403 page", async ({ page, request }) => {
  const now = Math.floor(Date.now() / 1000);
  // Expired: signed with the fixture key an hour ago for a minute, with its grant row inserted to match
  const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: now - 3540 };
  const expired = encodeURIComponent(await signPhotoToken(SECRET, grant, now - 3600));
  adminD1(`INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES ('${grant.grantId}', NULL, ${grant.expiresAt})`);
  const revoked = await catalogueLink(request);
  await request.delete(`${ADMIN}/admin/photos/links?grantId=${revoked.grantId}`, { headers: { Origin: ADMIN } });
  // Signed with the fixture key but photo-scoped (a grant made only inside the site), and signed with a key that isn't the site's
  const scoped = { grantId: crypto.randomUUID(), photoId: "fixture-01", expiresAt: now + 600 };
  adminD1(`INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES ('${scoped.grantId}', 'fixture-01', ${scoped.expiresAt})`);
  const photoScoped = encodeURIComponent(await signPhotoToken(SECRET, scoped, now));
  const wrongKey = encodeURIComponent(await signPhotoToken("2".repeat(64), { grantId: crypto.randomUUID(), photoId: null, expiresAt: now + 600 }, now));
  const pages = [`/photos/downloads?token=${expired}`, `/photos/downloads${new URL(revoked.url).search}`, `/photos/downloads?token=${photoScoped}`, `/photos/downloads?token=${wrongKey}`, "/photos/downloads?token=garbled", "/photos/downloads"];
  const bodies = new Set<string>();
  for (const path of pages) {
    const response = await page.goto(`${ADMIN}${path}`);
    expect(response?.status()).toBe(403);
    expect(response?.headers()).toMatchObject({ "cache-control": "private, no-store", "referrer-policy": "no-referrer" });
    await expect(page.locator("h1")).toHaveText("this link has run out");
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    bodies.add(await page.locator("main").innerText());
  }
  expect(bodies.size).toBe(1);
});

test("the page keeps its private headers on an encoded or doubled-slash path", async ({ page, request }) => {
  // Astro normalises the URL before the middleware sees it; this pins that, so an upgrade that stopped doing so would show here
  const link = await catalogueLink(request);
  const search = new URL(link.url).search;
  for (const path of ["/photos/%64ownloads", "//photos/downloads"]) {
    const response = await page.goto(`${ADMIN}${path}${search}`);
    expect(response?.headers()).toMatchObject({ "cache-control": "private, no-store", "referrer-policy": "no-referrer" });
  }
});
