import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createLoop } from "../../src/deck/scene/loop";

// A renderer that records, for each frame drawn, whether the shadow map was to be redrawn
function setup() {
  const shadows: boolean[] = [];
  const renderer = {
    shadowMap: { autoUpdate: true, needsUpdate: false },
    render: vi.fn(() => {
      shadows.push(renderer.shadowMap.needsUpdate);
    }),
  };
  const stage = {
    scene: {},
    camera: {},
    platter: { rotation: { y: 0 } },
    candle: { light: { intensity: 1 }, flame: { scale: { set: () => {} }, rotation: { z: 0 } }, intensity: 1 },
  };
  // As the real tweens do: step applies a tween's last pose and reports it done in the same call
  let running = 0;
  const tweens = {
    get count() {
      return running;
    },
    step: () => {
      if (running > 0) running -= 1;
      return running > 0;
    },
  };
  const loop = createLoop({ renderer: renderer as never, stage: stage as never, tweens: tweens as never, reduce: true, onFrame: () => {} });
  return { loop, renderer, shadows, tween: (on: boolean) => void (running = on ? Infinity : 0), tweenFor: (frames: number) => void (running = frames) };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Frames on the faked clock, so spinning-only frames come due at 30 a second as they would in a browser
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the shadow map is redrawn for a frame asked for and while tweens run, not while the platter only spins", async () => {
  const { loop, renderer, shadows, tween } = setup();
  expect(renderer.shadowMap.autoUpdate).toBe(false);
  loop.setVisible(true);
  await vi.advanceTimersByTimeAsync(20);
  expect(shadows).toEqual([true]);

  loop.spinTo(5);
  await vi.advanceTimersByTimeAsync(1000);
  expect(shadows[1]).toBe(true); // the frame the spin asked for
  expect(shadows.slice(2).length).toBeGreaterThan(5);
  expect(shadows.slice(2).every((redrawn) => redrawn === false)).toBe(true);

  const before = shadows.length;
  tween(true);
  loop.invalidate();
  await vi.advanceTimersByTimeAsync(200);
  expect(shadows.slice(before).every((redrawn) => redrawn === true)).toBe(true);
  loop.stop();
});

test("the frame a tween ends on still redraws the shadow map, because it draws the final pose", async () => {
  const { loop, shadows, tweenFor } = setup();
  loop.setVisible(true);
  await vi.advanceTimersByTimeAsync(20);
  const before = shadows.length;
  tweenFor(3); // three frames: the third applies the final pose and reports the tween done
  loop.invalidate();
  await vi.advanceTimersByTimeAsync(200);
  expect(shadows.slice(before)).toEqual([true, true, true]);
  loop.stop();
});
