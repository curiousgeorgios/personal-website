import { expect, test, type Page } from "@playwright/test";
import { deckState, expectSeated, hasWebGL, openScene, platterOnScreen, playing, settled } from "./deck";

// The crate checks from spec 5.5
test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
});

const control = (page: Page, act: string) => page.locator(`.crate-hud [data-act="${act}"]`);
const tilts = (page: Page) => page.evaluate(() => window.__deckScene!.tilts());
const coverOnScreen = (page: Page) =>
  page.evaluate(() => {
    const p = window.__deckScene!.coverAt();
    return window.__deckScene!.toScreen(p.x, p.y, p.z);
  });

test("five quick next presses stop at the last record with exact tilts", async ({ page }) => {
  // force: Playwright treats aria-disabled as disabled, and the last presses land on a disabled arrow on purpose
  for (let i = 0; i < 5; i++) await control(page, "next").click({ force: true });
  await settled(page);
  expect((await deckState(page)).browsed).toBe(3);
  expect(await tilts(page)).toEqual([0.72, 0.65, 0.58, -0.1]);
  await expect(control(page, "next")).toHaveAttribute("aria-disabled", "true");
  await expect(control(page, "prev")).toHaveAttribute("aria-disabled", "false");
  await expectSeated(page);
});

test("the arrows are disabled while a record travels", async ({ page }) => {
  await control(page, "play").click();
  await expect(control(page, "prev")).toHaveAttribute("aria-disabled", "true");
  await expect(control(page, "next")).toHaveAttribute("aria-disabled", "true");
  await expect(control(page, "play")).toHaveAttribute("data-state", "cueing");
  await playing(page, 0);
  await expect(control(page, "next")).toHaveAttribute("aria-disabled", "false");
  await expect(control(page, "play")).toHaveAttribute("data-state", "stop");
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});

test("the crate control keeps one geometry in every state", async ({ page }) => {
  const boxes = () =>
    Promise.all(
      ["prev", "play", "next"].map(async (act) => {
        const box = (await control(page, act).boundingBox())!;
        return [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 2) / 2);
      }),
    );
  const atRest = await boxes();
  for (const act of ["prev", "play", "next"]) {
    await control(page, act).hover({ force: true });
    expect(await boxes()).toEqual(atRest);
  }
  await control(page, "play").click();
  expect(await boxes()).toEqual(atRest); // cueing
  await playing(page, 0);
  expect(await boxes()).toEqual(atRest); // playing
  await control(page, "next").click();
  await settled(page);
  expect(await boxes()).toEqual(atRest); // another title
});

test("hovering the cover lifts it and shades play; clicking it plays", async ({ page }) => {
  const cover = await coverOnScreen(page);
  await page.mouse.move(cover.x, cover.y);
  await expect(control(page, "play")).toHaveClass(/\bhint\b/);
  await expect.poll(() => page.evaluate(() => window.__deckScene!.offsets()[0].lifted)).toBeGreaterThan(0.1);
  await page.mouse.click(cover.x, cover.y);
  await playing(page, 0);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});

test("browsing while playing, then stopping from the flipped crate, flips back and seats everything", async ({ page }) => {
  await page.locator(".tracks li").first().locator("button").click();
  await playing(page, 0);
  await control(page, "next").click();
  await control(page, "next").click();
  await settled(page);
  expect(await deckState(page)).toMatchObject({ browsed: 2, playing: 0 });
  await expect(control(page, "play")).toHaveAttribute("data-state", "play");
  await expect(page.locator(".tracks li").nth(2)).toHaveClass(/\bbrowsed\b/);
  // Stop by clicking the spinning record, so nothing hovers the list back to record 0 first
  const record = await platterOnScreen(page);
  await page.mouse.click(record.x + record.rx, record.y);
  await playing(page, null);
  await page.mouse.move(0, 0);
  await settled(page);
  expect((await deckState(page)).browsed).toBe(0);
  expect(await tilts(page)).toEqual([-0.1, -0.112, -0.124, -0.136]);
  await expectSeated(page);
});

test("the arrow keys flip while the crate control has focus", async ({ page }) => {
  await control(page, "play").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await deckState(page)).browsed).toBe(1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await deckState(page)).browsed).toBe(0);
  await settled(page);
  await expectSeated(page);
});

test("a control press then a list press within 150ms: only the list's record plays, and everything agrees", async ({ page }) => {
  await control(page, "play").click();
  await page.waitForTimeout(100);
  await page.locator(".tracks li").nth(2).locator("button").click();
  await playing(page, 2, 60_000);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
  await expect(control(page, "play")).toHaveAttribute("data-state", "stop");
  await expect(control(page, "play")).toHaveAttribute("aria-label", "stop no bad feelings today");
  await expect(page.locator(".tracks li").nth(2).locator(".st")).toHaveText("playing · stop");
});

test("a cover click then a list press within 150ms: only the list's record plays", async ({ page }) => {
  const cover = await coverOnScreen(page);
  await page.mouse.click(cover.x, cover.y);
  await page.waitForTimeout(100);
  await page.locator(".tracks li").nth(3).locator("button").click();
  await playing(page, 3, 60_000);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
  await expect(control(page, "play")).toHaveAttribute("aria-label", "stop light it up");
});
