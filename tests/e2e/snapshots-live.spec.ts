import { expect, test, type APIRequestContext } from "@playwright/test";

// The whole snapshot pipeline on this machine (spec 9): both Workers on 4334 with their own store, local Browser
// Rendering (Chrome, downloaded on first use) and the local Images binding, capturing the fixture site on 4400. The
// server's setup points canberra-events at the fixture page, digital-nachos at its 404, linear-gratis at its page that
// never goes quiet and r4r-with-me at its blank page, and clears every other line.
test.skip(({ browserName }) => browserName !== "chromium", "one run: it writes to its own store");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "local Workers only");
test.describe.configure({ mode: "serial", timeout: 240_000 });

export const SNAPS = "http://localhost:4334";

/** Runs the snapshots Worker's cron now, through wrangler's local explorer (the only route that reaches the second Worker) */
export const nightly = (request: APIRequestContext) =>
  request.post(`${SNAPS}/cdn-cgi/local/explorer/api/local/scheduled?worker=curiousgeorge-snapshots`, { data: { cron: "0 17 * * *" }, timeout: 180_000 });

const status = (slug: string) => `#snapshots li[data-slug="${slug}"] .status`;

test("the nightly run captures a line's page even if it never goes quiet, and records a 404 as an error and a blank page as blank", async ({ page, request }) => {
  const response = await nightly(request);
  expect(response.ok(), await response.text()).toBe(true);
  // The fixture page's analytics script is under /ingest/, which a capture blocks, so the fixture never saw a request for it
  expect(await (await request.get("http://127.0.0.1:4400/ingest-hits")).text()).toBe("0");
  await page.goto(`${SNAPS}/admin/`);
  await expect(page.locator(status("canberra-events"))).toHaveText(/^captured \d{4}-\d{2}-\d{2}$/);
  await expect(page.locator(status("digital-nachos"))).toHaveText("the page returned an error · no good capture yet");
  // Shot at the 15s cap: had the wait's TimeoutError lost its name in the bundle, the capture would throw and the line
  // would still say "not captured yet"
  await expect(page.locator(status("linear-gratis"))).toHaveText(/^captured \d{4}-\d{2}-\d{2}$/);
  // Judged blank from the page itself, before any shot
  await expect(page.locator(status("r4r-with-me"))).toHaveText("the capture came out blank · no good capture yet");
});

test("re-shoot now captures one line again and says it saved", async ({ page }) => {
  await page.goto(`${SNAPS}/admin/`);
  await page.getByRole("button", { name: "re-shoot canberra-events now", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=snapshots(&later=1)?#snapshots$/);
  await expect(page.locator("#snapshots .notice")).toHaveText(/^saved - /);
  await expect(page.locator(status("canberra-events"))).toHaveText(/^captured \d{4}-\d{2}-\d{2}$/);
});

test("a re-shoot that fails says why on its line, and keeps the line as it was", async ({ page }) => {
  await page.goto(`${SNAPS}/admin/`);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "POST"),
    page.getByRole("button", { name: "re-shoot digital-nachos now", exact: true }).click(),
  ]);
  expect(response.status()).toBe(422);
  await expect(page.locator('#snapshots li[data-slug="digital-nachos"] .error')).toHaveText("couldn't capture it: the page returned an error");
  await expect(page.locator(status("digital-nachos"))).toHaveText("the page returned an error · no good capture yet");
});
