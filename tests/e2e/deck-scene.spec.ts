import { expect, test } from "@playwright/test";
import { deckState, expectSeated, hasWebGL, openScene, playing, settled, withoutWebGL } from "./deck";

test.describe.configure({ timeout: 90_000 });

const SCENE = /\/_astro\/scene\.[\w-]+\.js$/;

test("the scene loads only after the page has loaded and the row comes near", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "request timing, checked once");
  await page.setViewportSize({ width: 1280, height: 400 });
  const requested: string[] = [];
  page.on("request", (request) => {
    if (SCENE.test(request.url())) requested.push(request.url());
  });
  await page.goto("/");
  expect((await page.locator("[data-deck]").boundingBox())!.y).toBeGreaterThan(400 + 200);
  await page.waitForTimeout(2500); // load, an idle callback and then some
  expect(requested).toEqual([]);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live canvas")).toHaveCount(1, { timeout: 60_000 });
  expect(requested).toHaveLength(1);
  await expect(page.locator("[data-deck] canvas")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("[data-deck] .poster")).toBeHidden();
});

test("a press during the scene download waits for it, then plays with one scene", async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(SCENE, async (route) => {
    await gate;
    await route.continue();
  });
  const asked = page.waitForRequest(SCENE);
  await page.goto("/");
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await asked;
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("cueing");
  await page.waitForTimeout(500);
  expect((await deckState(page)).playing).toBeNull();
  release();
  // The journey must animate: a scene that hadn't yet learned it was on screen would finish every step at once
  await expect.poll(() => page.evaluate(() => window.__deckScene?.tweens() ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  await playing(page, 0, 60_000);
  // An instant journey draws 0 or 1 frames; the tweens poll above already proves this one animated
  expect(await page.evaluate(() => window.__deckScene!.frames())).toBeGreaterThan(2);
  await expect(page.locator("[data-deck] canvas")).toHaveCount(1);
  await settled(page);
  await expectSeated(page);
});

test("without WebGL the scene never loads and the list plays and stops every record", async ({ page }) => {
  await withoutWebGL(page);
  await page.goto("/");
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-deck] canvas")).toHaveCount(0);
  const poster = page.locator("[data-deck] .poster img");
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const rows = page.locator(".tracks li");
  for (let i = 0; i < (await rows.count()); i++) {
    await rows.nth(i).locator("button").click();
    await playing(page, i);
    await page.waitForTimeout(460);
    await rows.nth(i).locator("button").click();
    await playing(page, null);
  }
});

test("losing the WebGL context mid-journey drops the scene and the list keeps working", async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
  const rows = page.locator(".tracks li");
  await rows.first().locator("button").click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__deckScene!.loseContext());
  await expect(page.locator("[data-deck] canvas")).toHaveCount(0);
  await expect(page.locator("[data-deck].live")).toHaveCount(0);
  await playing(page, 0);
  expect((await deckState(page)).scene).toBe(false);
  await page.waitForTimeout(460);
  await rows.nth(1).locator("button").click();
  await playing(page, 1);
});
