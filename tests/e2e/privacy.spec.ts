import { expect, test } from "@playwright/test";
import { withGpc } from "./gpc";

test("cookies none, storage empty, every request first party", async ({ page, baseURL }) => {
  // Against the live site the beacon would count this check as a visit; Global Privacy Control switches it off (the
  // proxy is checked separately below)
  if (process.env.PLAYWRIGHT_BASE_URL) await withGpc(page);
  const origin = new URL(baseURL!).origin;
  const setCookies: string[] = [];
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("data:") && new URL(url).origin !== origin) foreign.push(url);
  });
  const checks: Promise<void>[] = [];
  page.on("response", (response) => {
    checks.push(
      response.allHeaders().then((headers) => {
        if (headers["set-cookie"]) setCookies.push(`${response.url()}: ${headers["set-cookie"]}`);
      }),
    );
  });
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
  await Promise.all(checks);
  expect(setCookies).toEqual([]);
  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
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
