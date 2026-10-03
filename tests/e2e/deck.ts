import { expect, type Page } from "@playwright/test";

// Helpers for the listening corner specs. They read the test hooks, which exist only in `bun run build:test` builds.

export const deckState = (page: Page) => page.evaluate(() => window.__deck!.state());
export const audioState = (page: Page) => page.evaluate(() => window.__deck!.audio());

/** Waits until the runner is idle with `index` playing (null: nothing playing) */
export async function playing(page: Page, index: number | null, timeout = 20_000) {
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
