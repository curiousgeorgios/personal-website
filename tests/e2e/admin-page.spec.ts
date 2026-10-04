import { expect, test } from "@playwright/test";
import { ADMIN, expectSaved, openAdmin, openLogbook, submit } from "./admin";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");
// The tests in this file share the lately row, so they run in order
test.describe.configure({ mode: "serial" });

test("the page shows both lately forms and every page to snapshot", async ({ page }) => {
  await openAdmin(page);
  await expect(page.locator("#fact-shelf-title")).toBeVisible();
  await expect(page.locator("#fact-kettle-subtitle")).toBeVisible();
  await expect(page.locator('label[for="fact-shelf-subtitle"]')).toHaveText("author");
  await expect(page.locator('label[for="fact-kettle-subtitle"]')).toHaveText("note");
  await expect(page.locator('#snapshots li[data-slug="digital-nachos"] .status')).toHaveText("not captured yet");
});

test("a save redirects and says when the logbook shows it; a reload doesn't send it again", async ({ page }) => {
  await openAdmin(page);
  await page.locator("#fact-shelf-title").fill("piranesi");
  await page.locator("#fact-shelf-subtitle").fill("susanna clarke");
  expect((await submit(page, "fact-shelf")).status()).toBe(303);
  await expectSaved(page, "lately");
  await expect(page.locator("#fact-shelf-title")).toHaveValue("piranesi");

  const navigations: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) navigations.push(request.method());
  });
  await page.reload();
  expect(navigations).toEqual(["GET"]);

  await openLogbook(page);
  await expect(page.locator("#lately .fact").first()).toContainText("piranesi");
  await expect(page.locator("#lately .fact").first()).toContainText("susanna clarke");
});

test("a failed save comes back open, with what was typed and what's wrong", async ({ page }) => {
  await openAdmin(page);
  await page.locator("#fact-kettle-title").fill("");
  await page.locator("#fact-kettle-subtitle").fill("still slightly hacked");
  const response = await submit(page, "fact-kettle");
  expect(response.status()).toBe(422);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(page).toHaveURL(`${ADMIN}/admin/#fact-kettle`);
  await expect(page.locator("#fact-kettle-title")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#fact-kettle-title-error")).toHaveText("a title is needed, or clear both to hide it");
  await expect(page.locator("#fact-kettle-subtitle")).toHaveValue("still slightly hacked");
  await expect(page.locator(".notice")).toHaveCount(0);
});

test("clearing both fields hides that half of lately", async ({ page }) => {
  await openAdmin(page);
  await page.locator("#fact-kettle-title").fill("");
  await page.locator("#fact-kettle-subtitle").fill("");
  expect((await submit(page, "fact-kettle")).status()).toBe(303);
  await expectSaved(page, "lately");
  await openLogbook(page);
  await expect(page.locator("#lately .fact")).toHaveCount(1);
  await expect(page.locator("#lately")).not.toContainText("in the kettle");
});

test("a write the page can't place gets a message at the top and saves nothing", async ({ page }) => {
  const response = await page.request.post(`${ADMIN}/admin/`, { form: { intent: "drop.tables" }, headers: { Origin: ADMIN } });
  expect(response.status()).toBe(422);
  expect(response.headers()["cache-control"]).toBe("no-store");
  // Astro escapes the apostrophe
  expect(await response.text()).toMatch(/class="error page-error"[^>]*>that action isn(&#39;|')t recognised</);
});
