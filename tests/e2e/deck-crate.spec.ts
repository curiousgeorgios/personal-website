import { expect, test, type Page } from "@playwright/test";
import { deckState, expectSeated, hasWebGL, LONG_TRACK, openScene, platterOnScreen, playing, settled, SLOW } from "./deck";

// The crate checks from spec 5.5
test.describe.configure({ timeout: 90_000 * SLOW });

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
  // From record 1, so both arrows are live at rest (on record 0 the previous arrow is disabled anyway)
  await control(page, "next").click();
  await settled(page);
  // The page records the control's every state from before the press: with the scene drawing in software, each round
  // trip to the page can take longer than the 2.5s journey, so asking afterwards can miss the travelling state entirely
  await page.evaluate(() => {
    const states: string[] = [];
    (window as unknown as { states: string[] }).states = states;
    const hud = document.querySelector(".crate-hud")!;
    const read = (act: string, name: string) => hud.querySelector(`[data-act="${act}"]`)!.getAttribute(name);
    new MutationObserver(() => states.push(`${read("prev", "aria-disabled")} ${read("play", "data-state")} ${read("next", "aria-disabled")}`)).observe(hud, {
      attributes: true,
      subtree: true,
      attributeFilter: ["aria-disabled", "data-state"],
    });
  });
  await control(page, "play").click();
  await playing(page, 1);
  const states = await page.evaluate(() => (window as unknown as { states: string[] }).states);
  // It travelled, and whenever it did, both arrows were disabled
  expect(states).toContain("true cueing true");
  expect(states.filter((state) => state.includes("cueing")).every((state) => state === "true cueing true")).toBe(true);
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
  await page.locator(".tracks li").nth(LONG_TRACK).locator("button").click();
  await playing(page, LONG_TRACK);
  await control(page, "prev").click();
  await control(page, "prev").click();
  await settled(page);
  expect(await deckState(page)).toMatchObject({ browsed: 0, playing: LONG_TRACK });
  await expect(control(page, "play")).toHaveAttribute("data-state", "play");
  await expect(page.locator(".tracks li").first()).toHaveClass(/\bbrowsed\b/);
  // Stop by clicking the spinning record, so nothing hovers the list and browses another record first
  const record = await platterOnScreen(page);
  await page.mouse.click(record.x + record.rx, record.y);
  await playing(page, null);
  await page.mouse.move(0, 0);
  await settled(page);
  expect((await deckState(page)).browsed).toBe(LONG_TRACK);
  expect(await tilts(page)).toEqual([0.72, 0.65, -0.1, -0.112]);
  await expectSeated(page);
});

test("clicking the tipped sleeve of the playing record flips back one step and leaves it playing", async ({ page }) => {
  await page.locator(".tracks li").first().locator("button").click();
  await playing(page, 0);
  await control(page, "next").click();
  await control(page, "next").click();
  await settled(page);
  expect(await deckState(page)).toMatchObject({ browsed: 2, playing: 0 });
  // Record 0 stands tipped forward in front of the browsed one: reaching back for it flips, it does not toggle
  const sleeve = await page.evaluate(() => {
    const p = window.__deckScene!.sleeveAt(0);
    return window.__deckScene!.toScreen(p.x, p.y, p.z);
  });
  await page.mouse.click(sleeve.x, sleeve.y);
  await expect.poll(async () => (await deckState(page)).browsed).toBe(1);
  await page.mouse.move(0, 0);
  await settled(page);
  expect(await deckState(page)).toMatchObject({ want: 0, current: 0, browsed: 1, playing: 0 });
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
  await playing(page, 2, 60_000 * SLOW);
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
  await playing(page, 3, 60_000 * SLOW);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
  await expect(control(page, "play")).toHaveAttribute("aria-label", "stop light it up");
});
