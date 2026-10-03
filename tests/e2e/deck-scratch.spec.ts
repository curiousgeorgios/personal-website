import { expect, test } from "@playwright/test";
import { audioState, deckState, expectSeated, hasWebGL, openScene, platterOnScreen, playing, settled } from "./deck";

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
  await page.locator(".tracks li").first().locator("button").click();
  await playing(page, 0);
  await settled(page);
});

test("dragging the spinning record scratches it; letting go plays on at normal speed", async ({ page }) => {
  const record = await platterOnScreen(page);
  const spin = await page.evaluate(() => window.__deckScene!.spin());
  // 0.9 units right of centre is on the vinyl, clear of the label
  await page.mouse.move(record.x + record.rx, record.y);
  await page.mouse.down();
  const rates: number[] = [];
  for (let step = 1; step <= 12; step++) {
    const angle = (step / 12) * Math.PI;
    await page.mouse.move(record.x + record.rx * Math.cos(angle), record.y + record.ry * Math.sin(angle));
    rates.push((await audioState(page)).rate);
  }
  expect(rates.some((rate) => Math.abs(rate - 1) > 0.05)).toBe(true);
  expect(Math.max(...rates)).toBeLessThanOrEqual(2.5);
  expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.25);
  expect(await page.evaluate(() => window.__deckScene!.spin())).not.toBe(spin);
  await page.mouse.up();
  await expect.poll(async () => (await audioState(page)).rate, { timeout: 3000 }).toBe(1);
  // The click that ends a scratch is not a stop
  expect(await deckState(page)).toMatchObject({ want: 0, playing: 0 });
  expect((await audioState(page)).paused).toBe(false);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});

test("a plain click on the spinning record stops it", async ({ page }) => {
  const record = await platterOnScreen(page);
  await page.mouse.click(record.x + record.rx, record.y);
  await playing(page, null);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});
