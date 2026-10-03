import { expect, test, type Page } from "@playwright/test";
import { audioState, deckState, expectSeated, hasWebGL, openScene, playing, scrollDeckAway, settled } from "./deck";

// The playback checks from spec 5.5, driven from the list
test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
});

const press = (page: Page, index: number) => page.locator(".tracks li").nth(index).locator("button").click();
const spin = (page: Page) => page.evaluate(() => window.__deckScene!.spin());

test("play lands the record centred on a spinning platter; stop puts everything back", async ({ page }) => {
  await press(page, 0);
  await playing(page, 0);
  await settled(page);
  await expectSeated(page);
  const before = await spin(page);
  await expect.poll(() => spin(page)).not.toBe(before);
  await page.waitForTimeout(460);
  await press(page, 0);
  await playing(page, null);
  await settled(page);
  await expectSeated(page);
});

test("two different records within 150ms: only the second ends on the platter", async ({ page }) => {
  await press(page, 0);
  await page.waitForTimeout(100);
  await press(page, 1);
  await playing(page, 1, 40_000);
  await settled(page);
  await expectSeated(page);
});

test("the same record twice within 450ms plays once", async ({ page }) => {
  await page.locator(".tracks li").first().locator("button").dblclick();
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
  await playing(page, 3, 60_000);
  await settled(page);
  await expectSeated(page);
});

test("changing mind mid-flight twice ends on the last choice", async ({ page }) => {
  await press(page, 0);
  await page.waitForTimeout(800);
  await press(page, 1);
  await page.waitForTimeout(800);
  await press(page, 2);
  await playing(page, 2, 60_000);
  await settled(page);
  await expectSeated(page);
});

test("scrolling away mid-flight finishes the journey at once", async ({ page }) => {
  await press(page, 1);
  await page.waitForTimeout(400);
  await scrollDeckAway(page);
  await playing(page, 1, 5000);
  expect((await audioState(page)).paused).toBe(false);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await settled(page);
  await expectSeated(page);
});

test("off screen the list starts and stops audio without drawing a frame", async ({ page }) => {
  await scrollDeckAway(page);
  await page.waitForTimeout(200);
  const frames = await page.evaluate(() => window.__deckScene!.frames());
  await press(page, 2);
  await playing(page, 2, 5000);
  expect((await audioState(page)).paused).toBe(false);
  await page.waitForTimeout(460);
  await press(page, 2);
  await playing(page, null, 5000);
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
  expect(await page.evaluate(() => window.__deckScene!.frames())).toBe(frames);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await settled(page);
  await expectSeated(page);
});

test("a track that can't play flies home and the row says so", async ({ page }) => {
  await page.route("**/media/audio/no-bad-feelings-today.mp3", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
  await press(page, 2);
  await expect(page.locator(".tracks li").nth(2).locator(".st")).toHaveText("couldn't play", { timeout: 30_000 });
  await playing(page, null);
  await settled(page);
  await expectSeated(page);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a record lands at once and the platter does not spin", async ({ page }) => {
    const before = await spin(page);
    await press(page, 2);
    await playing(page, 2, 5000);
    await settled(page);
    await expectSeated(page);
    await page.waitForTimeout(500);
    expect(await spin(page)).toBe(before);
  });
});
