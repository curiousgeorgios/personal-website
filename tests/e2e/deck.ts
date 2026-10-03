import { expect, type Page } from "@playwright/test";

// Helpers for the listening corner specs. They read the test hooks, which exist only in `bun run build:test` builds.

/** Every wait and test budget in the scene specs is scaled by this: CI draws WebGL in software (ADR-0009) */
export const SLOW = process.env.CI ? 2 : 1;

/** The record the specs keep playing: "no bad feelings today" runs 213s, so it can't end mid-test */
export const LONG_TRACK = 2;

export const deckState = (page: Page) => page.evaluate(() => window.__deck!.state());
export const audioState = (page: Page) => page.evaluate(() => window.__deck!.audio());

/** Waits until the runner is idle with `index` playing (null: nothing playing) */
export async function playing(page: Page, index: number | null, timeout = 20_000 * SLOW) {
  await expect
    .poll(async () => {
      const state = await deckState(page);
      return state.busy ? "busy" : state.playing;
    }, { timeout })
    .toBe(index);
}

/** Makes this page believe it has no WebGL, so the scene never loads */
export async function withoutWebGL(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        return type.startsWith("webgl") ? null : original.call(this, type, options);
      },
    });
  });
}

export const hasWebGL = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("canvas");
    return (probe.getContext("webgl2") ?? probe.getContext("webgl")) !== null;
  });

/** Scrolls the turntable into view and waits for the scene to take over from the poster */
export async function openScene(page: Page) {
  await page.goto("/");
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 45_000 * SLOW });
}

/** Waits until no journey runs and nothing in the scene is moving (the spinning platter aside) */
export async function settled(page: Page, timeout = 30_000 * SLOW) {
  await expect.poll(() => page.evaluate(() => !window.__deck!.state().busy && window.__deckScene!.tweens() === 0), { timeout }).toBe(true);
}

/** Every sleeve seated in the crate; only the current record, if any, is out, centred on the platter */
export async function expectSeated(page: Page) {
  const { state, offsets } = await page.evaluate(() => ({ state: window.__deck!.state(), offsets: window.__deckScene!.offsets() }));
  for (const record of offsets) {
    expect(Math.abs(record.lifted), `sleeve ${record.i} seated`).toBeLessThan(0.001);
    if (record.i === state.current) {
      expect(record).toMatchObject({ parent: "platter", visible: true });
      expect(Math.abs(record.dx), `record ${record.i} centred`).toBeLessThan(0.01);
      expect(Math.abs(record.dz), `record ${record.i} centred`).toBeLessThan(0.01);
    } else {
      expect(record.visible, `record ${record.i} back in its sleeve`).toBe(false);
    }
  }
}

/** Puts the canvas just above the viewport, with the track list still in view */
export async function scrollDeckAway(page: Page) {
  await page.evaluate(() => window.scrollBy(0, document.querySelector("[data-deck]")!.getBoundingClientRect().bottom + 4));
}

/** The record's centre on screen and the on-screen size of 0.9 units: on the vinyl, clear of the 0.48 label, inside the 1.45 edge */
export const platterOnScreen = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__deckScene!;
    const p = scene.platterAt();
    const centre = scene.toScreen(p.x, p.y, p.z);
    return { ...centre, rx: scene.toScreen(p.x + 0.9, p.y, p.z).x - centre.x, ry: scene.toScreen(p.x, p.y, p.z + 0.9).y - centre.y };
  });
