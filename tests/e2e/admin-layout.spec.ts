import { expect, test } from "@playwright/test";
import { ADMIN } from "./admin";

test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");

// Read-only, so it runs in every project, the phone included, while the other admin specs write
test("the admin page fits a phone: the logbook's order, no sideways scrolling and fields that don't zoom", async ({ page }) => {
  await page.goto(`${ADMIN}/admin/`);
  await expect(page.locator(".row > .label")).toHaveText(["admin", "now", "lately", "log", "records", "before", "snapshots", "photographs", "links", "orders"]);
  // Open every form, so their fields are measured too
  await page.locator("details").evaluateAll((all) => all.forEach((details) => ((details as HTMLDetailsElement).open = true)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const fontSizes = await page
    .locator(".field input, .field textarea, .field select")
    .evaluateAll((fields) => fields.map((field) => parseFloat(getComputedStyle(field).fontSize)));
  // An empty list would make Math.min Infinity and pass, so check the page has fields and buttons at all
  expect(fontSizes.length).toBeGreaterThan(0);
  expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(16);
  const heights = await page.locator(".button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  // 44px, the CSS floor for .button
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});
