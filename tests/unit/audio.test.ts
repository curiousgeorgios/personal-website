import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAudioPort, FADE_IN_MS, FADE_OUT_MS, START_TIMEOUT_MS } from "../../src/deck/audio";

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 42;
  playbackRate = 1;
  volume = 1;
  preservesPitch = true;
  paused = true;
  error: MediaError | null = null;
  outcome: "play" | "fail" | "hang" = "play";
  play = vi.fn(() => {
    if (this.outcome === "fail") return Promise.reject(new DOMException("no supported source", "NotSupportedError"));
    if (this.outcome === "hang") return new Promise<void>(() => {});
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

function fakeContext() {
  const gain = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((value: number) => {
      gain.value = value;
    }),
    linearRampToValueAtTime: vi.fn(),
  };
  const context = {
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {}),
    createGain: vi.fn(() => ({ gain, connect: vi.fn((node: unknown) => node) })),
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn((node: unknown) => node) })),
  };
  return { context, gain, make: vi.fn(() => context as unknown as AudioContext) };
}

function setup() {
  const element = new FakeAudio();
  const ctx = fakeContext();
  const port = createAudioPort(element as unknown as HTMLAudioElement, ctx.make);
  return { element, ctx, port };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("audio port", () => {
  test("the first unlock builds the graph inside the press and starts the element silently", () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    expect(ctx.make).toHaveBeenCalledTimes(1);
    expect(ctx.context.resume).toHaveBeenCalled();
    expect(ctx.gain.value).toBe(0);
    expect(element.src).toBe("/media/audio/a.mp3");
    expect(element.play).toHaveBeenCalledTimes(1);
    port.unlock("/media/audio/b.mp3");
    expect(ctx.make).toHaveBeenCalledTimes(1);
    expect(ctx.context.resume).toHaveBeenCalledTimes(2);
    expect(element.src).toBe("/media/audio/a.mp3"); // later presses never cut off what is playing
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  test("start rewinds, plays and fades the gain up", async () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    expect(await port.start("/media/audio/a.mp3", () => true)).toBe(true);
    expect(element.currentTime).toBe(0);
    expect(element.paused).toBe(false);
    expect(ctx.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 10 + FADE_IN_MS / 1000);
  });

  test("start switches to a different track", async () => {
    const { element, port } = setup();
    port.unlock("/media/audio/a.mp3");
    await port.start("/media/audio/b.mp3", () => true);
    expect(element.src).toBe("/media/audio/b.mp3");
  });

  test("start resolves false when the track can't play", async () => {
    const { element, port } = setup();
    element.outcome = "fail";
    port.unlock("/media/audio/a.mp3");
    expect(await port.start("/media/audio/a.mp3", () => true)).toBe(false);
  });

  test("start gives up on a track that never starts", async () => {
    const { element, port } = setup();
    element.outcome = "hang";
    const started = port.start("/media/audio/a.mp3", () => true);
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(await started).toBe(false);
    expect(element.pause).toHaveBeenCalled();
  });

  test("start stays silent when the record is no longer wanted", async () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    expect(await port.start("/media/audio/a.mp3", () => false)).toBe(true);
    expect(element.paused).toBe(true);
    expect(ctx.gain.linearRampToValueAtTime).not.toHaveBeenCalledWith(1, expect.any(Number));
  });

  test("stop fades out, then pauses", async () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    await port.start("/media/audio/a.mp3", () => true);
    port.stop();
    expect(ctx.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10 + FADE_OUT_MS / 1000);
    expect(element.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(FADE_OUT_MS);
    expect(element.paused).toBe(true);
  });

  test("a start during the fade-out keeps the new track playing", async () => {
    const { element, port } = setup();
    port.unlock("/media/audio/a.mp3");
    await port.start("/media/audio/a.mp3", () => true);
    port.stop();
    await port.start("/media/audio/b.mp3", () => true);
    await vi.advanceTimersByTimeAsync(FADE_OUT_MS);
    expect(element.paused).toBe(false);
  });

  test("setRate changes the rate and lets the pitch follow", () => {
    const { element, port } = setup();
    port.setRate(1.8);
    expect(element.playbackRate).toBe(1.8);
    expect(element.preservesPitch).toBe(false);
  });

  test("forwards ended and error", () => {
    const { element, port } = setup();
    const ended = vi.fn();
    const errored = vi.fn();
    port.onEnded(ended);
    port.onError(errored);
    element.dispatchEvent(new Event("ended"));
    element.dispatchEvent(new Event("error"));
    expect([ended.mock.calls.length, errored.mock.calls.length]).toEqual([1, 1]);
  });

  test("without Web Audio, fades fall back to the element's volume", async () => {
    const element = new FakeAudio();
    const port = createAudioPort(element as unknown as HTMLAudioElement, () => {
      throw new Error("no Web Audio");
    });
    port.unlock("/media/audio/a.mp3");
    expect(element.volume).toBe(0);
    await port.start("/media/audio/a.mp3", () => true);
    expect(element.volume).toBe(1);
  });
});
