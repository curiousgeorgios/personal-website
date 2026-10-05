import { expect, test } from "@playwright/test";
import { deckState, expectSeated, hasWebGL, openScene, playing, settled, SLOW, withoutWebGL } from "./deck";

test.describe.configure({ timeout: 90_000 * SLOW });

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
  await expect(page.locator("[data-deck].live canvas")).toHaveCount(1, { timeout: 60_000 * SLOW });
  expect(requested).toHaveLength(1);
  await expect(page.locator("[data-deck] canvas")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("[data-deck] .poster")).toBeHidden();
});

test("a press during the scene download waits for it, then plays with one scene", async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  // The page records what it shows from the start: under load one round trip to the page can outlast the whole journey
  // (27s, measured at a load average near 300), so asking afterwards can miss it. It keeps each change of the first
  // row's label, with whether the scene had arrived by then, and the most tweens running on any frame
  await page.addInitScript(() => {
    const seen = { labels: [] as string[], mostTweens: 0 };
    (window as unknown as { seen: typeof seen }).seen = seen;
    addEventListener("DOMContentLoaded", () => {
      const label = document.querySelector(".tracks li .st")!;
      new MutationObserver(() => seen.labels.push(`${label.textContent} ${window.__deck!.state().scene ? "scene" : "no scene"}`)).observe(label, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    const watch = () => {
      seen.mostTweens = Math.max(seen.mostTweens, window.__deckScene?.tweens() ?? 0);
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
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
  await page.locator(".tracks li").first().locator("button").click();
  release(); // as soon as the press is in, so the scene has nearly all of the runner's 5s wait to mount
  await playing(page, 0, 60_000 * SLOW);
  const seen = await page.evaluate(() => (window as unknown as { seen: { labels: string[]; mostTweens: number } }).seen);
  // Cueing while the scene downloaded, playing only once it had arrived
  expect(seen.labels).toEqual(["cueing no scene", "playing · stop scene"]);
  // The journey animated: a scene that hadn't yet learned it was on screen would finish every step at once, leaving no
  // tween running on any frame. An instant journey draws 0 or 1 frames
  expect(seen.mostTweens).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__deckScene!.frames())).toBeGreaterThan(2);
  await expect(page.locator("[data-deck] canvas")).toHaveCount(1);
  await settled(page);
  await expectSeated(page);
});

test("a different press during the scene download plays only the second record; the first never leaves the crate", async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  // How far record 0's sleeve ever rose, and whether its disc ever showed, read on every frame once the scene exists
  await page.addInitScript(() => {
    const first = { lifted: 0, out: false };
    (window as unknown as { first: typeof first }).first = first;
    const watch = () => {
      const record = window.__deckScene?.offsets()[0];
      if (record) {
        first.lifted = Math.max(first.lifted, record.lifted);
        first.out ||= record.visible;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
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
  const rows = page.locator(".tracks li");
  await rows.nth(0).locator("button").click();
  // No wait between: a different record isn't held by the double-press guard, and the runner's 5s wait for the scene
  // starts at the first press
  await rows.nth(1).locator("button").click();
  await expect(rows.nth(1).locator(".st")).toHaveText("cueing");
  release();
  await playing(page, 1, 60_000 * SLOW);
  await settled(page);
  await expectSeated(page);
  expect(await page.evaluate(() => (window as unknown as { first: { lifted: number; out: boolean } }).first)).toEqual({ lifted: 0, out: false });
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
  // No scene, no ‹ ›: only the short hint shows
  await expect(page.locator(".corner > .hint .hint-list")).toBeVisible();
  await expect(page.locator(".corner > .hint .hint-scene")).toBeHidden();
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

for (const viewport of [{ width: 1280, height: 720 }, { width: 375, height: 812 }]) {
  test(`at ${viewport.width}px the hint names ‹ › only while the scene is live, and its line never changes height`, async ({ page }) => {
    test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
    // At 375px the long sentence wraps to two lines, and the short one must keep that height
    await page.setViewportSize(viewport);
    await page.goto("/");
    const hint = page.locator(".corner > .hint");
    const full = hint.locator(".hint-scene");
    const short = hint.locator(".hint-list");
    await expect(short).toBeVisible();
    await expect(full).toBeHidden();
    const height = (await hint.boundingBox())!.height;
    await page.locator("[data-deck]").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 45_000 * SLOW });
    await expect(full).toBeVisible();
    await expect(short).toBeHidden();
    expect((await hint.boundingBox())!.height).toBe(height);
    await page.evaluate(() => window.__deckScene!.loseContext());
    await expect(page.locator("[data-deck].live")).toHaveCount(0);
    await expect(short).toBeVisible();
    await expect(full).toBeHidden();
  });
}

// The poster is picked as the page loads and the scene starts later, when the row comes near; the scene keeps the
// poster's mood, so a visit that crosses 19:00 or 06:00 doesn't swap the light at take-over
for (const [loaded, started, night] of [
  ["2026-10-05T07:59:00Z", "2026-10-05T08:01:00Z", false], // 18:59 then 19:01 in Sydney: day stays day
  ["2026-10-04T18:59:00Z", "2026-10-04T19:01:00Z", true], // 05:59 then 06:01: night stays night
] as const) {
  test(`loaded at ${loaded} and started at ${started}, the scene keeps the ${night ? "night" : "day"} poster's light`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "checked once in Chromium");
    test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
    await page.setViewportSize({ width: 1280, height: 400 }); // the row starts out of reach, so the scene waits
    await page.clock.setFixedTime(new Date(loaded));
    await page.goto("/");
    expect(await page.locator("[data-deck]").evaluate((deck) => deck.hasAttribute("data-night"))).toBe(night);
    await page.clock.setFixedTime(new Date(started));
    await page.locator("[data-deck]").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 45_000 * SLOW });
    expect(await page.evaluate(() => window.__deckScene!.candle())).toBe(night ? 9 : 4);
  });
}
