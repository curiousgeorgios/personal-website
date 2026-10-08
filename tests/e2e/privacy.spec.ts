import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "./admin";
import { SLOW } from "./deck";
import { GALLERY } from "./gallery-site";
import { withGpc } from "./gpc";
import { catalogueLink } from "./photo-store";

/** Records, from here on, every cookie a response sets and every request to another origin */
function watch(page: Page, origin: string) {
  const seen = { setCookies: [] as string[], foreign: [] as string[], checks: [] as Promise<void>[] };
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("data:") && new URL(url).origin !== origin) seen.foreign.push(url);
  });
  page.on("response", (response) => {
    seen.checks.push(
      response.allHeaders().then((headers) => {
        if (headers["set-cookie"]) seen.setCookies.push(`${response.url()}: ${headers["set-cookie"]}`);
      }),
    );
  });
  return seen;
}

/** The visitor info's promises: cookies none, storage empty, every request first party */
async function expectPrivate(page: Page, seen: ReturnType<typeof watch>) {
  await Promise.all(seen.checks);
  expect(seen.setCookies).toEqual([]);
  expect(seen.foreign).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
}

test("cookies none, storage empty, every request first party", async ({ page, baseURL }) => {
  // Playing a record brings the 3D scene in (the list scrolls into view), so this gets the scene specs' budget
  test.setTimeout(90_000 * SLOW);
  // Against the live site the beacon would count this check as a visit; Global Privacy Control switches it off (the
  // proxy is checked separately below)
  if (process.env.PLAYWRIGHT_BASE_URL) await withGpc(page);
  const seen = watch(page, new URL(baseURL!).origin);
  // A unique query (set by CI after a deploy) bypasses the edge cache, so the new version is what gets checked
  await page.goto(process.env.PRIVACY_PATH ?? "/");
  // Content-agnostic: exercise the pill and the toggle when production has them, tolerate their absence
  const pill = page.locator(".peek").first();
  if (await pill.count()) await pill.click();
  const more = page.locator("#log .more");
  if (await more.count()) await more.click();
  await page.waitForLoadState("networkidle");
  // Play and stop a record when there is one: audio streams first party from /media and sets nothing
  const track = page.locator(".tracks button").first();
  if (await track.count()) {
    await track.click();
    await page.waitForTimeout(1500);
    await track.click();
  }
  await expectPrivate(page, seen);
});

test("the photo pages set no cookies, keep storage empty and stay first party", async ({ page, baseURL }) => {
  if (process.env.PLAYWRIGHT_BASE_URL) await withGpc(page);
  // Locally the gallery server's fixture; after a deploy, the live site
  const site = process.env.PLAYWRIGHT_BASE_URL ? baseURL! : GALLERY;
  const seen = watch(page, new URL(site).origin);
  // A fresh query misses the edge cache, so a deploy's new version is what gets checked
  await page.goto(new URL(`/photos?fresh=${Date.now()}`, site).href, { waitUntil: "networkidle" });
  // Content-agnostic, so it passes on the live site before anything is published: follow a frame when there is one
  const frame = page.locator("a.frame-link").first();
  if (await frame.count()) {
    await frame.click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".photo img")).toBeVisible();
  }
  await expectPrivate(page, seen);
});

test("a downloads page sets no cookies and loads nothing from elsewhere", async ({ page, request }) => {
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs a link from the local admin server");
  const { url } = await catalogueLink(request);
  const seen = watch(page, ADMIN);
  await page.goto(url, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("photos, full size");
  await expectPrivate(page, seen);
});

// Only against a deployed site: the local test build's Access bypass answers /admin/ with the page, by design.
// Before the Access application exists the Worker itself refuses (403); afterwards Access answers with a redirect to its
// sign-in. Either way, an anonymous visitor must never get the page.
test("an anonymous request to /admin/ is never served the page", async ({ request }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "the local test build skips Access");
  const response = await request.get("/admin/", { maxRedirects: 0 });
  expect(response.status(), "/admin/ answered an anonymous visitor").not.toBe(200);
});

// An event the logbook never sends is refused by the proxy before anything reaches PostHog, and nothing is set
test("the analytics proxy answers without a cookie", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", {
    data: JSON.stringify({ event: "privacy_check", properties: {} }),
    headers: { Origin: new URL(baseURL!).origin },
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});
