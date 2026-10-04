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

test("a write the page can't place shows its message stuck at the top, in view, with the form the browser scrolled to below it", async ({ page }) => {
  // A phone-sized window, so the second form starts below the fold and the fragment scroll has somewhere to go
  await page.setViewportSize({ width: 390, height: 600 });
  await openAdmin(page);
  // Send what a stale or tampered page would: an action the server doesn't know
  await page.route(`${ADMIN}/admin/`, (route) =>
    route.request().method() === "POST" ? route.continue({ postData: "intent=drop.tables" }) : route.continue(),
  );
  const response = await submit(page, "fact-kettle");
  expect(response.status()).toBe(422);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(page).toHaveURL(`${ADMIN}/admin/#fact-kettle`);

  const banner = page.locator(".page-error");
  await expect(banner).toHaveText("that action isn't recognised");
  await expect(banner).toHaveAttribute("role", "alert");
  // The browser scrolled down to the form; the message came with it, stuck to the top, and the form isn't under it
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(banner).toBeInViewport();
  const bannerBox = (await banner.boundingBox())!;
  expect(bannerBox.y).toBe(0);
  const formBox = (await page.locator("#fact-kettle").boundingBox())!;
  expect(formBox.y).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height);
});
