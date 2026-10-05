import { expect, test, type Page, type Request } from "@playwright/test";
import { SLOW } from "./deck";
import { withGpc } from "./gpc";

// The local test build has no PostHog key: /ingest drops what it accepts, so these specs only watch what the page sends
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "would send events to PostHog from the live site");

const beacon = (page: Page, event: string, timeout = 10_000) =>
  page.waitForRequest((request) => request.url().endsWith("/ingest/i/v0/e/") && request.method() === "POST" && body(request).event === event, { timeout });
const body = (request: Request) => JSON.parse(request.postData() ?? "{}");
// The site took it: a beacon the middleware refused would still be sent, and production would count nothing
const accepted = async (request: Request) => expect((await request.response())?.status()).toBe(204);

test("a visit sends a cookieless pageview, first party, with no key and no storage", async ({ page, baseURL }) => {
  const [request] = await Promise.all([beacon(page, "$pageview"), page.goto("/?utm_source=instagram&utm_medium=social")]);
  await accepted(request);
  const sent = body(request);
  expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
  expect(sent).toMatchObject({
    distinct_id: "$posthog_cookieless",
    properties: { $pathname: "/", $referrer: "$direct", $cookieless_mode: true, $process_person_profile: false, utm_source: "instagram", utm_medium: "social" },
  });
  expect(sent).not.toHaveProperty("api_key");
  expect(sent.properties.$session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await page.evaluate(() => document.cookie + localStorage.length + sessionStorage.length)).toBe("00");
});

test("opening a label is counted with its slug and the visit's session", async ({ page }) => {
  const pageview = beacon(page, "$pageview");
  await page.goto("/");
  const viewed = await pageview;
  await accepted(viewed);
  const session = body(viewed).properties.$session_id;
  const [opened] = await Promise.all([beacon(page, "label_opened"), page.locator('[data-slug="canberra-events"] .peek').click()]);
  await accepted(opened);
  expect(body(opened).properties).toMatchObject({ slug: "canberra-events", $session_id: session });
});

test("playing a record is counted with its id", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "playback is covered by the deck specs; counted once here");
  test.setTimeout(90_000 * SLOW);
  await page.goto("/");
  const [played] = await Promise.all([beacon(page, "record_played", 60_000 * SLOW), page.locator(".tracks button").first().click()]);
  await accepted(played);
  expect(body(played).properties).toMatchObject({ record_id: 1 });
});

test("Global Privacy Control means nothing is sent", async ({ page }) => {
  await withGpc(page);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ingest/")) sent.push(request.url());
  });
  await page.goto("/");
  await page.locator('[data-slug="canberra-events"] .peek').click();
  await page.waitForLoadState("networkidle");
  expect(sent).toEqual([]);
});
