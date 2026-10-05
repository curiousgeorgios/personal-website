import { expect, test } from "@playwright/test";
import { audioState, deckState, expectSeated, hasWebGL, LONG_TRACK, openScene, platterOnScreen, playing, settled, SLOW } from "./deck";

test.describe.configure({ timeout: 90_000 * SLOW });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
  await page.locator(".tracks li").nth(LONG_TRACK).locator("button").click();
  await playing(page, LONG_TRACK);
  await settled(page);
});

test("dragging the spinning record scratches it; letting go plays on at normal speed", async ({ page }) => {
  const record = await platterOnScreen(page);
  const spin = await page.evaluate(() => window.__deckScene!.spin());
  // 0.9 units right of centre is on the vinyl, clear of the label
  await page.mouse.move(record.x + record.rx, record.y);
  // While the scene draws every frame in software, each round trip to the page takes seconds, so the page itself
  // records the playback rate every time it changes and the test reads the list once, after the drag
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { rates: number[] }).rates = seen;
    const element = document.querySelector<HTMLAudioElement>("audio[data-deck-audio]")!;
    element.addEventListener("ratechange", () => seen.push(element.playbackRate));
    const events: string[] = [];
    (window as unknown as { events: string[] }).events = events;
    document.addEventListener("logbook:track", (event) => events.push(event.detail.event));
  });
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    const angle = (step / 12) * Math.PI;
    await page.mouse.move(record.x + record.rx * Math.cos(angle), record.y + record.ry * Math.sin(angle));
  }
  expect(await page.evaluate(() => window.__deckScene!.spin())).not.toBe(spin);
  await page.mouse.up();
  const rates = await page.evaluate(() => (window as unknown as { rates: number[] }).rates);
  expect(rates.length).toBeGreaterThan(0);
  expect(rates.some((rate) => Math.abs(rate - 1) > 0.05)).toBe(true);
  expect(Math.max(...rates)).toBeLessThanOrEqual(2.5);
  expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.25);
  // Found the easter egg: counted once, however many times the drag moves
  expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual(["scratch_found"]);
  await expect.poll(async () => (await audioState(page)).rate, { timeout: 3000 * SLOW }).toBe(1);
  // The click that ends a scratch is not a stop
  expect(await deckState(page)).toMatchObject({ want: LONG_TRACK, playing: LONG_TRACK });
  expect((await audioState(page)).paused).toBe(false);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});

test("scratching again later in the same visit is not counted again", async ({ page }) => {
  const record = await platterOnScreen(page);
  // The page records what it hears, as in the test above, so the drags don't wait on round trips
  await page.evaluate(() => {
    const events: string[] = [];
    const rates: number[] = [];
    Object.assign(window, { events, rates });
    document.addEventListener("logbook:track", (event) => events.push(event.detail.event));
    const element = document.querySelector<HTMLAudioElement>("audio[data-deck-audio]")!;
    element.addEventListener("ratechange", () => rates.push(element.playbackRate));
  });
  const heard = () =>
    page.evaluate(() => {
      const seen = window as unknown as { events: string[]; rates: number[] };
      return { events: [...seen.events], rates: [...seen.rates] };
    });
  for (const drag of [1, 2]) {
    await page.mouse.move(record.x + record.rx, record.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      const angle = (step / 12) * Math.PI;
      await page.mouse.move(record.x + record.rx * Math.cos(angle), record.y + record.ry * Math.sin(angle));
    }
    await page.mouse.up();
    // Each drag really is a scratch: the record's speed bends while it lasts, then settles before the next one
    const { rates } = await heard();
    expect(rates.some((rate) => Math.abs(rate - 1) > 0.05), `drag ${drag} scratched`).toBe(true);
    await expect.poll(async () => (await audioState(page)).rate, { timeout: 3000 * SLOW }).toBe(1);
    await page.evaluate(() => ((window as unknown as { rates: number[] }).rates.length = 0));
  }
  expect((await heard()).events).toEqual(["scratch_found"]);
});

test("a plain click on the spinning record stops it", async ({ page }) => {
  const record = await platterOnScreen(page);
  await page.mouse.click(record.x + record.rx, record.y);
  await playing(page, null);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});
