import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDeck, DOUBLE_PRESS_MS, FAILED_MS, VIEW_WAIT_MS } from "../../src/deck/runner";
import type { AudioPort, DeckState, DeckView } from "../../src/deck/types";

const tracks = ["a", "b", "c", "d"].map((t) => ({ title: t, artist: "x", src: `/media/audio/${t}.mp3`, cover: `/media/covers/${t}.webp` }));
let clock = 0;

function fakeAudio() {
  let ended = () => {};
  let errored = () => {};
  const calls: string[] = [];
  const audio = {
    calls,
    result: true,
    unlock: (src: string) => void calls.push(`unlock ${src}`),
    start: async (src: string) => {
      calls.push(`start ${src}`);
      return audio.result;
    },
    stop: () => void calls.push("stop"),
    setRate: vi.fn(),
    onEnded: (fn: () => void) => void (ended = fn),
    onError: (fn: () => void) => void (errored = fn),
    end: () => ended(),
    error: () => errored(),
  };
  return audio satisfies AudioPort;
}

// Every step takes `ms` of (fake) time; counts how many run at once
function fakeView(ms = 100) {
  const calls: string[] = [];
  let active = 0;
  let most = 0;
  const step = async (name: string) => {
    calls.push(name);
    active += 1;
    most = Math.max(most, active);
    await new Promise((resolve) => setTimeout(resolve, ms));
    active -= 1;
  };
  const view: DeckView = {
    flip: (i) => step(`flip ${i}`),
    load: (i) => step(`load ${i}`),
    unload: (i) => step(`unload ${i}`),
    update: () => {},
  };
  return { view, calls, most: () => most };
}

function setup() {
  const audio = fakeAudio();
  const said: string[] = [];
  const deck = createDeck({ tracks, audio, announce: (message) => said.push(message), now: () => clock });
  return { deck, audio, said };
}

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const starts = (calls: string[]) => calls.filter((call) => call.startsWith("start"));

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

describe("deck runner without a scene", () => {
  test("unlocks audio inside the press, then plays and announces", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(1);
    expect(audio.calls).toEqual(["unlock /media/audio/b.mp3"]);
    expect(deck.getState()).toMatchObject({ want: 1, busy: true });
    await settle();
    expect(deck.getState()).toEqual({ want: 1, current: 1, browsed: 1, busy: false, playing: 1, failed: null, scene: false });
    expect(starts(audio.calls)).toEqual(["start /media/audio/b.mp3"]);
    expect(said).toEqual(["now playing b"]);
  });

  test("a second press stops it", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(1);
    await settle();
    clock = 1000;
    deck.toggle(1);
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null, busy: false });
    expect(audio.calls.at(-1)).toBe("stop");
    expect(said).toEqual(["now playing b", "stopped"]);
  });

  test("a second press on the same record within 450ms is ignored", async () => {
    const { deck } = setup();
    deck.toggle(0);
    clock = DOUBLE_PRESS_MS - 1;
    deck.toggle(0);
    await settle();
    expect(deck.getState().playing).toBe(0);
    clock = DOUBLE_PRESS_MS + 10;
    deck.toggle(0);
    await settle();
    expect(deck.getState().playing).toBeNull();
  });

  test("a track that can't play goes back and says so for four seconds", async () => {
    const { deck, audio, said } = setup();
    audio.result = false;
    deck.toggle(2);
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null, failed: 2, busy: false });
    expect(said).toEqual(["couldn't play c"]);
    await settle(FAILED_MS);
    expect(deck.getState().failed).toBeNull();
  });

  test("a new press clears the failure", async () => {
    const { deck, audio } = setup();
    audio.result = false;
    deck.toggle(2);
    await settle();
    audio.result = true;
    clock = 1000;
    deck.toggle(1);
    expect(deck.getState().failed).toBeNull();
    await settle();
    expect(deck.getState().playing).toBe(1);
  });

  test("a start that fails after the visitor moved on is not reported", async () => {
    const { deck, audio, said } = setup();
    // The first start hangs until we say it failed; any later one succeeds
    let failFirst = () => {};
    let first = true;
    audio.start = (src) => {
      audio.calls.push(`start ${src}`);
      if (!first) return Promise.resolve(true);
      first = false;
      return new Promise<boolean>((resolve) => void (failFirst = () => resolve(false)));
    };
    deck.toggle(0);
    await settle();
    deck.toggle(1);
    failFirst();
    await settle();
    expect(deck.getState()).toEqual({ want: 1, current: 1, browsed: 1, busy: false, playing: 1, failed: null, scene: false });
    expect(said).toEqual(["now playing b"]);
  });

  test("when a track ends the record goes back", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(0);
    await settle();
    audio.end();
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null });
    expect(said).toEqual(["now playing a", "stopped"]);
  });

  test("an audio error mid-track counts as couldn't play", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(0);
    await settle();
    audio.error();
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null, failed: 0 });
    expect(said).toEqual(["now playing a", "couldn't play a"]);
  });

  test("browse clamps to the crate", () => {
    const { deck } = setup();
    deck.browse(-3);
    expect(deck.getState().browsed).toBe(0);
    deck.browse(99);
    expect(deck.getState().browsed).toBe(3);
  });

  test("subscribers hear every change until they unsubscribe", async () => {
    const { deck } = setup();
    const heard: DeckState[] = [];
    const stop = deck.subscribe((state) => heard.push(state));
    deck.browse(2);
    expect(heard.at(-1)?.browsed).toBe(2);
    stop();
    deck.browse(3);
    expect(heard.at(-1)?.browsed).toBe(2);
  });

  test("tells the page when a record's audio starts, but not when it can't play", async () => {
    const audio = fakeAudio();
    const played: number[] = [];
    const deck = createDeck({ tracks, audio, announce: () => {}, now: () => clock, played: (index) => played.push(index) });
    deck.toggle(1);
    await settle();
    expect(played).toEqual([1]);
    clock += DOUBLE_PRESS_MS + 1;
    deck.toggle(1); // stop
    await settle();
    expect(played).toEqual([1]);
    clock += DOUBLE_PRESS_MS + 1;
    audio.result = false;
    deck.toggle(2);
    await settle();
    expect(played).toEqual([1]);
  });
});

describe("deck runner with a scene", () => {
  test("runs one journey at a time and only the last of several quick presses plays", async () => {
    const { deck, audio } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    deck.toggle(1);
    deck.toggle(2);
    deck.toggle(3);
    await settle(5000);
    expect(deck.getState()).toMatchObject({ want: 3, current: 3, playing: 3, browsed: 3, busy: false, scene: true });
    expect(scene.most()).toBe(1);
    expect(scene.calls).toEqual(["load 0", "unload 0", "flip 3", "load 3"]);
    expect(starts(audio.calls)).toEqual(["start /media/audio/d.mp3"]);
  });

  test("stopping before the record lands plays nothing and takes it back", async () => {
    const { deck, audio } = setup();
    const scene = fakeView(1000);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    await settle(500);
    clock = 500;
    deck.toggle(0);
    await settle(5000);
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null });
    expect(scene.calls).toEqual(["load 0", "unload 0"]);
    expect(starts(audio.calls)).toEqual([]);
  });

  test("flips asked for during a journey happen when the runner is idle", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(1);
    deck.browse(3);
    expect(deck.getState().browsed).toBe(1);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ browsed: 3, playing: 1 });
    expect(scene.calls).toEqual(["flip 1", "load 1", "flip 3"]);
  });

  test("a press during that last flip is not lost", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    deck.browse(2);
    await settle(150); // load 0 done, the deferred flip to 2 is running
    clock = 1000;
    deck.toggle(1);
    await settle(2000);
    expect(deck.getState()).toMatchObject({ want: 1, current: 1, playing: 1, busy: false });
  });

  test("a browse during that last flip is not lost", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    deck.browse(2);
    await settle(150); // load 0 done, the deferred flip to 2 is running
    deck.browse(3);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ browsed: 3, busy: false, playing: 0 });
    expect(scene.calls).toEqual(["load 0", "flip 2", "flip 3"]);
  });

  test("waits for a scene that is still loading, then animates", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    let resolve!: (view: DeckView) => void;
    deck.connect(new Promise((r) => (resolve = r)));
    deck.toggle(0);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ want: 0, busy: true, playing: null, scene: false });
    resolve(scene.view);
    await settle(1000);
    expect(scene.calls).toEqual(["load 0"]);
    expect(deck.getState()).toMatchObject({ playing: 0, scene: true });
  });

  test("stops waiting for a scene that never arrives", async () => {
    const { deck } = setup();
    deck.connect(new Promise(() => {}));
    deck.toggle(0);
    await settle(VIEW_WAIT_MS);
    expect(deck.getState()).toMatchObject({ playing: 0, scene: false });
    clock = VIEW_WAIT_MS + 1000;
    deck.toggle(0);
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null }); // no second wait
  });

  test("a scene that fails to load leaves the list working", async () => {
    const { deck } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    deck.connect(Promise.reject(new Error("chunk 404")));
    deck.toggle(0);
    await settle();
    expect(deck.getState()).toMatchObject({ playing: 0, scene: false });
    error.mockRestore();
  });

  test("a scene that throws mid-journey is dropped and playback carries on", async () => {
    const { deck } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const scene = fakeView(100);
    scene.view.load = () => Promise.reject(new Error("WebGL went away"));
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ playing: 0, scene: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("disconnect detaches the scene", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.disconnect(scene.view);
    expect(deck.getState().scene).toBe(false);
    deck.toggle(0);
    await settle();
    expect(scene.calls).toEqual([]);
    expect(deck.getState().playing).toBe(0);
  });

  test("the scene hears every state change", async () => {
    const { deck } = setup();
    const scene = fakeView(0);
    const seen: DeckState[] = [];
    scene.view.update = (state) => void seen.push(state);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(2);
    await settle(100);
    expect(seen.at(-1)).toMatchObject({ playing: 2, busy: false, scene: true });
  });

  test("a scene whose update throws is dropped and the list still plays", async () => {
    const { deck } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const scene = fakeView(100);
    scene.view.update = () => {
      throw new Error("update blew up");
    };
    deck.connect(Promise.resolve(scene.view));
    await settle();
    expect(deck.getState().scene).toBe(false);
    expect(error).toHaveBeenCalled();
    deck.toggle(0);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ want: 0, current: 0, playing: 0, busy: false, scene: false });
    expect(scene.calls).toEqual([]);
    error.mockRestore();
  });

  test("an idle flip that rejects drops the scene", async () => {
    const { deck } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const scene = fakeView(100);
    scene.view.flip = () => Promise.reject(new Error("flip rejected"));
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.browse(2);
    await settle();
    expect(deck.getState()).toMatchObject({ browsed: 2, scene: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("an idle flip that throws synchronously drops the scene without throwing out of browse", async () => {
    const { deck } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const scene = fakeView(100);
    scene.view.flip = () => {
      throw new Error("flip threw");
    };
    deck.connect(Promise.resolve(scene.view));
    await settle();
    expect(() => deck.browse(2)).not.toThrow();
    await settle();
    expect(deck.getState()).toMatchObject({ browsed: 2, scene: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
