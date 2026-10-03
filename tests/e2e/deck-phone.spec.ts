import { expect, test } from "@playwright/test";
import { hasWebGL, openScene, SLOW, withoutWebGL } from "./deck";

// Phone framing (spec 5.2), checked at 375px in Chromium: the geometry is the same in every engine
test.use({ viewport: { width: 375, height: 812 } });
test.describe.configure({ timeout: 90_000 * SLOW });

test("on a 375px phone the canvas is full bleed, the cover is at least 90px tall and the control fits inside", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "framing, checked once in Chromium");
  test.skip(!(await hasWebGL(page)), "no WebGL here");
  await openScene(page);
  const canvas = (await page.locator("[data-deck] canvas").boundingBox())!;
  expect(Math.round(canvas.x)).toBe(0);
  expect(Math.round(canvas.width)).toBe(375);
  const cover = await page.evaluate(() => window.__deckScene!.coverRect());
  expect(cover.height).toBeGreaterThanOrEqual(90);
  const control = (await page.locator(".crate-hud").boundingBox())!;
  expect(control.x).toBeGreaterThanOrEqual(canvas.x);
  expect(control.x + control.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(control.y).toBeGreaterThanOrEqual(canvas.y);
  expect(control.y + control.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("without WebGL a phone gets the phone poster", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "checked once in Chromium");
  await withoutWebGL(page);
  await page.goto("/");
  const poster = page.locator("[data-deck] .poster img");
  await poster.scrollIntoViewIfNeeded();
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain("/posters/deck-phone.webp");
});
