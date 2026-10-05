import { expect, test, type Page } from "@playwright/test";
import { withoutWebGL } from "./deck";

// Spec 5.2: the poster stands in for the scene, so from 19:00 to 06:00 in Sydney it shows the room by candlelight. The
// page is cached at the edge for a day, so an inline script picks the poster before it paints (only one is ever
// fetched); without JavaScript the day poster shows. The night poster showing also proves the CSP allowed the script.
const NOON = new Date("2026-10-05T02:00:00Z"); // 13:00 in Sydney
const NIGHT = new Date("2026-10-05T11:00:00Z"); // 22:00 in Sydney

async function poster(page: Page) {
  const img = page.locator("[data-deck] .poster img");
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return img.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname);
}

const fetched = (page: Page) => {
  const posters: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/posters/")) posters.push(path);
  });
  return posters;
};

test.beforeEach(({ page }) => withoutWebGL(page));

test("by day, the day poster", async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  await page.goto("/");
  expect(await poster(page)).toBe("/posters/deck-desktop.webp");
});

test("at night, the night poster, and only it is fetched", async ({ page }) => {
  const posters = fetched(page);
  await page.clock.setFixedTime(NIGHT);
  await page.goto("/");
  expect(await poster(page)).toBe("/posters/deck-desktop-night.webp");
  expect(posters).toEqual(["/posters/deck-desktop-night.webp"]);
});

test("on a phone at night, the phone's night poster", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.setFixedTime(NIGHT);
  await page.goto("/");
  expect(await poster(page)).toBe("/posters/deck-phone-night.webp");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the day poster, whatever the time", async ({ page }) => {
    await page.goto("/");
    expect(await poster(page)).toBe("/posters/deck-desktop.webp");
  });
});
