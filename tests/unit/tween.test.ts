import { describe, expect, test, vi } from "vitest";
import { createTweens, easeOut, linear } from "../../src/deck/scene/tween";

describe("tweens", () => {
  test("advance with the clock and resolve at the end", async () => {
    const tweens = createTweens(() => {}, () => 0);
    let value = 0;
    const done = vi.fn();
    void tweens.tween(100, (k) => (value = k), linear).then(done);
    expect(tweens.step(50)).toBe(true);
    expect(value).toBe(0.5);
    expect(tweens.step(100)).toBe(false);
    expect(value).toBe(1);
    await Promise.resolve();
    expect(done).toHaveBeenCalled();
    expect(tweens.count).toBe(0);
  });

  test("a keyed tween ends the running one where it stands, so input retargets", async () => {
    let now = 0;
    const tweens = createTweens(() => {}, () => now);
    let tilt = 0;
    const first = vi.fn();
    void tweens.tween(100, (k) => (tilt = k), linear, "tilt").then(first);
    tweens.step(50);
    now = 50;
    const from = tilt;
    void tweens.tween(100, (k) => (tilt = from + (2 - from) * k), linear, "tilt");
    await Promise.resolve();
    expect(first).toHaveBeenCalled();
    expect(tilt).toBe(0.5); // not jumped to the first tween's end
    expect(tweens.count).toBe(1);
    tweens.step(150);
    expect(tilt).toBe(2);
  });

  test("instant mode finishes new tweens at once and flushes running ones", async () => {
    const tweens = createTweens(() => {}, () => 0);
    let a = 0;
    let b = 0;
    const running = tweens.tween(1000, (k) => (a = k));
    tweens.setInstant(true);
    await running;
    expect(a).toBe(1);
    await tweens.tween(1000, (k) => (b = k));
    await tweens.wait(5000);
    expect(b).toBe(1);
    expect(tweens.count).toBe(0);
  });

  test("asks for a frame whenever a tween starts", () => {
    const frame = vi.fn();
    const tweens = createTweens(frame, () => 0);
    void tweens.tween(100, () => {});
    expect(frame).toHaveBeenCalledTimes(1);
  });

  test("casting is true only while a running tween moves something that casts a shadow", () => {
    const tweens = createTweens(() => {}, () => 0);
    expect(tweens.casting).toBe(false);
    void tweens.tween(100, () => {}, linear, "rate", false);
    expect(tweens.count).toBe(1);
    expect(tweens.casting).toBe(false);
    void tweens.tween(50, () => {}, linear); // casts unless told otherwise
    expect(tweens.casting).toBe(true);
    tweens.step(50);
    expect(tweens.count).toBe(1);
    expect(tweens.casting).toBe(false);
    tweens.step(100);
    expect(tweens.count).toBe(0);
  });

  test("ease-out ends exactly at 1", () => {
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
