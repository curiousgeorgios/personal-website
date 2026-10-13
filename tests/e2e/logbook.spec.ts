import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";

test("renders the seeded logbook", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".row > .label")).toHaveText(["logbook of", "now", "lately", "log", "on the turntable", "before", "say hi", "visitor info"]);
  await expect(page.locator("#now .line").first()).toContainText("growing digital nachos");
  await expect(page.locator("#now a", { hasText: "with-me" })).toHaveAttribute("href", "https://www.with-me.co/");
  await expect(page.locator("#lately .fact")).toHaveCount(2);
  await expect(page.locator("#turntable .tracks li")).toHaveCount(4);
  await expect(page.locator("#turntable .tracks li").first()).toHaveText(/a1\s*simple things - loom room\s*play/);
  await expect(page.locator(".where")).toContainText("last entry 03.10.26");
});

test("the Sydney clock fills in without shifting the line", async ({ page }) => {
  await page.goto("/");
  const clock = page.locator("[data-sydney-time]");
  await expect(clock).toHaveText(/^\d{1,2}:\d{2}\u00a0(am|pm)$/);
  const width = await clock.evaluate((el) => el.getBoundingClientRect().width);
  const minWidth = await clock.evaluate((el) => parseFloat(getComputedStyle(el).minWidth));
  expect(width).toBeLessThanOrEqual(minWidth + 0.5);
});

test("caches the page at the edge with the logbook tag", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["cloudflare-cdn-cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
  expect(response.headers()["cache-tag"]).toContain("logbook");
  expect(response.headers()["cache-control"]).toBe("no-cache");
});

// The gallery server (4335) has the logbook's seed and published photographs, so its home page has the line
test("the home page points to the photos while one is published", async ({ page }) => {
  await page.goto(`${GALLERY}/`);
  await expect(page.locator(".row > .label")).toHaveText(["logbook of", "now", "lately", "log", "photos", "on the turntable", "before", "say hi", "visitor info"]);
  await expect(page.locator("#photos .body")).toHaveText("photos i've taken, kept like this log.");
  await expect(page.locator("#photos a")).toHaveAttribute("href", "/photos");
});
