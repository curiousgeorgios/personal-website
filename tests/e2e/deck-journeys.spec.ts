import { expect, test, type Page } from "@playwright/test";
import { audioState, deckState, expectSeated, hasWebGL, LONG_TRACK, openScene, playing, scrollDeckAway, settled, SLOW } from "./deck";

// The playback checks from spec 5.5, driven from the list
test.describe.configure({ timeout: 90_000 * SLOW });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
});

const press = (page: Page, index: number) => page.locator(".tracks li").nth(index).locator("button").click();
const spin = (page: Page) => page.evaluate(() => window.__deckScene!.spin());
const tweens = (page: Page) => page.evaluate(() => window.__deckScene!.tweens());
const frames = (page: Page) => page.evaluate(() => window.__deckScene!.frames());

test("play lands the record centred on a spinning platter; stop puts everything back", async ({ page }) => {
  await press(page, LONG_TRACK);
  await playing(page, LONG_TRACK);
  await settled(page);
  await expectSeated(page);
  const before = await spin(page);
  await expect.poll(() => spin(page)).not.toBe(before);
  await page.waitForTimeout(460);
  await press(page, LONG_TRACK);
  await playing(page, null);
  await settled(page);
  await expectSeated(page);
});

test("two different records within 150ms: only the second ends on the platter", async ({ page }) => {
  await press(page, 0);
  await page.waitForTimeout(100);
  await press(page, 1);
  await playing(page, 1, 40_000 * SLOW);
  await settled(page);
  await expectSeated(page);
});

test("the same record twice within 450ms plays once", async ({ page }) => {
  // Both clicks at one runner time: the guard reads the clock as each press is handled, and Playwright sends the second
  // click only once the renderer has handled the first, so how far apart the runner sees them is down to load. The edges
  // of the 450ms window are runner.test.ts's
  await page.evaluate(() => window.__deck!.hold(performance.now()));
  await page.locator(".tracks li").first().locator("button").dblclick();
  await page.evaluate(() => window.__deck!.hold(null));
  await playing(page, 0);
  expect((await deckState(page)).want).toBe(0);
  await settled(page);
  await expectSeated(page);
});

test("mashing four records ends on the last", async ({ page }) => {
  for (const index of [0, 1, 2, 3]) {
    await press(page, index);
    await page.waitForTimeout(60);
  }
  await playing(page, 3, 60_000 * SLOW);
  await settled(page);
  await expectSeated(page);
});

test("changing mind mid-flight twice ends on the last choice", async ({ page }) => {
  await press(page, 0);
  await page.waitForTimeout(800);
  await press(page, 1);
  await page.waitForTimeout(800);
  await press(page, 2);
  await playing(page, 2, 60_000 * SLOW);
  await settled(page);
  await expectSeated(page);
});

test("scrolling away mid-flight finishes the journey at once", async ({ page }) => {
  await press(page, 1);
  await page.waitForTimeout(400);
  await scrollDeckAway(page);
  // At once means structurally: the tweens are flushed, not waited out, and nothing draws off screen
  await expect.poll(() => tweens(page), { timeout: 5000 * SLOW }).toBe(0);
  const drawn = await frames(page);
  await playing(page, 1, 5000 * SLOW);
  expect((await audioState(page)).paused).toBe(false);
  expect(await frames(page)).toBe(drawn);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await settled(page);
  await expectSeated(page);
});

test("off screen the list starts and stops audio without drawing a frame", async ({ page }) => {
  await scrollDeckAway(page);
  await page.waitForTimeout(200);
  const drawn = await frames(page);
  await press(page, 2);
  await playing(page, 2, 5000 * SLOW);
  expect(await tweens(page)).toBe(0);
  expect((await audioState(page)).paused).toBe(false);
  await page.waitForTimeout(460);
  await press(page, 2);
  await playing(page, null, 5000 * SLOW);
  expect(await tweens(page)).toBe(0);
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
  expect(await frames(page)).toBe(drawn);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await settled(page);
  await expectSeated(page);
});

test("a track that can't play flies home and the row says so", async ({ page }) => {
  await page.route("**/media/audio/no-bad-feelings-today.mp3", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
  await press(page, 2);
  await expect(page.locator(".tracks li").nth(2).locator(".st")).toHaveText("couldn't play", { timeout: 30_000 * SLOW });
  await playing(page, null);
  await settled(page);
  await expectSeated(page);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a record lands at once and the platter does not spin", async ({ page }) => {
    const before = await spin(page);
    // Sampled every frame: a journey that was really instant never leaves a tween running
    await page.evaluate(() => {
      const seen = window as unknown as { mostTweens: number };
      seen.mostTweens = 0;
      const sample = () => {
        seen.mostTweens = Math.max(seen.mostTweens, window.__deckScene!.tweens());
        requestAnimationFrame(sample);
      };
      sample();
    });
    await press(page, 2);
    await playing(page, 2, 5000 * SLOW);
    expect(await page.evaluate(() => (window as unknown as { mostTweens: number }).mostTweens)).toBe(0);
    await settled(page);
    await expectSeated(page);
    await page.waitForTimeout(500);
    expect(await spin(page)).toBe(before);
  });
});
