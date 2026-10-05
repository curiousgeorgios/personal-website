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
  // A real press and release, for the hit test, the pointer capture and the click that ends the drag; the moves between
  // them are dispatched by the page, a frame apart, so the drag costs one round trip, not twelve
  await page.mouse.down();
  const drag = await page.evaluate(async ({ x, y, rx, ry }) => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-deck] canvas")!;
    const hooks = window.__deckScene!;
    const before = { shadows: hooks.shadows(), frames: hooks.frames() };
    for (let step = 1; step <= 12; step++) {
      const angle = (step / 12) * Math.PI;
      const clientX = x + rx * Math.cos(angle);
      const clientY = y + ry * Math.sin(angle);
      canvas.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, clientX, clientY, buttons: 1 }));
      await new Promise(requestAnimationFrame);
    }
    return { spin: hooks.spin(), shadows: hooks.shadows() - before.shadows, frames: hooks.frames() - before.frames };
  }, record);
  expect(drag.spin).not.toBe(spin);
  // Turning a disc changes no shadow: the drag's moves, each in a frame of its own, draw frames but leave the 2048 shadow
  // map alone (the one redraw is the frame the scratch's start asks for)
  expect(drag.frames).toBeGreaterThanOrEqual(3);
  expect(drag.shadows).toBeLessThanOrEqual(1);
  await page.mouse.up();
  const rates = await page.evaluate(() => (window as unknown as { rates: number[] }).rates);
  expect(rates.length).toBeGreaterThan(0);
  expect(rates.some((rate) => Math.abs(rate - 1) > 0.05)).toBe(true);
  expect(Math.max(...rates)).toBeLessThanOrEqual(2.5);
  expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.25);
  // Found the easter egg: counted once, however many times the drag moves
  expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual(["scratch_found"]);
  await expect.poll(async () => (await audioState(page)).rate, { timeout: 10_000 * SLOW }).toBe(1);
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
    // Three moves are enough to start a scratch and bend the rate
    for (let step = 1; step <= 3; step++) {
      const angle = (step / 3) * Math.PI;
      await page.mouse.move(record.x + record.rx * Math.cos(angle), record.y + record.ry * Math.sin(angle));
    }
    await page.mouse.up();
    // Each drag really is a scratch: the record's speed bends while it lasts, then settles before the next one
    const { rates } = await heard();
    expect(rates.some((rate) => Math.abs(rate - 1) > 0.05), `drag ${drag} scratched`).toBe(true);
    await expect.poll(async () => (await audioState(page)).rate, { timeout: 10_000 * SLOW }).toBe(1);
    await page.evaluate(() => ((window as unknown as { rates: number[] }).rates.length = 0));
  }
  expect((await heard()).events).toEqual(["scratch_found"]);
});

test("a pen on the spinning record doesn't scratch it: pens, like touch, keep scrolling the page", async ({ page }) => {
  const record = await platterOnScreen(page);
  // The page dispatches the pen's drag itself (Playwright has no pen), and records what it hears
  const heard = await page.evaluate(
    async ({ x, y, rx, ry }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-deck] canvas")!;
      const element = document.querySelector<HTMLAudioElement>("audio[data-deck-audio]")!;
      const rates: number[] = [];
      const events: string[] = [];
      element.addEventListener("ratechange", () => rates.push(element.playbackRate));
      document.addEventListener("logbook:track", (event) => events.push(event.detail.event));
      const pen = (type: string, clientX: number, clientY: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, { pointerType: "pen", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, clientX, clientY, buttons: type === "pointerup" ? 0 : 1 }),
        );
      pen("pointerdown", x + rx, y);
      for (let step = 1; step <= 12; step++) {
        const angle = (step / 12) * Math.PI;
        pen("pointermove", x + rx * Math.cos(angle), y + ry * Math.sin(angle));
      }
      pen("pointerup", x - rx, y);
      await new Promise((resolve) => setTimeout(resolve, 500)); // ratechange and the event would have arrived by now
      return { rates, events };
    },
    record,
  );
  expect(heard).toEqual({ rates: [], events: [] });
  expect((await audioState(page)).rate).toBe(1);
  expect(await deckState(page)).toMatchObject({ want: LONG_TRACK, playing: LONG_TRACK });
});

test("a plain click on the spinning record stops it", async ({ page }) => {
  const record = await platterOnScreen(page);
  await page.mouse.click(record.x + record.rx, record.y);
  await playing(page, null);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});
