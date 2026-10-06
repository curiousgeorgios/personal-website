import type { AudioPort, Deck, DeckState, DeckTrack, DeckView } from "./types";

/** A second press on the same record within this window is a double-click, not "play, then stop" */
export const DOUBLE_PRESS_MS = 450;
/** How long a row says "couldn't play" */
export const FAILED_MS = 4000;
/** How long a step waits for a scene that is still loading before going ahead without it */
export const VIEW_WAIT_MS = 5000;

export interface DeckOptions {
  tracks: DeckTrack[];
  audio: AudioPort;
  announce: (message: string) => void;
  /** Called when a record's audio starts (the page counts it as record_played) */
  played?: (index: number) => void;
  now?: () => number;
}

// One runner owns every record movement (spec 5.3). Input only says what the visitor wants; the runner moves the
// deck there one step at a time and re-checks after every step, so two journeys can never overlap.
export function createDeck({ tracks, audio, announce, played, now = () => performance.now() }: DeckOptions): Deck {
  const clamp = (index: number) => Math.max(0, Math.min(tracks.length - 1, index));
  let want: number | null = null;
  let current: number | null = null;
  let browsed = 0;
  let running = false;
  let playing: number | null = null;
  let failed: number | null = null;
  let browseWant: number | null = null;
  let view: DeckView | null = null;
  let pending: Promise<DeckView | null> | null = null;
  let failTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPress = { index: -1, at: -Infinity };
  const listeners = new Set<(state: DeckState) => void>();

  const getState = (): DeckState => ({ want, current, browsed, busy: running, playing, failed, scene: view !== null });

  function emit() {
    const state = getState();
    if (view) {
      try {
        view.update(state);
      } catch (error) {
        drop(view, error); // disconnect emits again with scene: false, so don't notify listeners twice
        return;
      }
    }
    for (const listener of listeners) listener(state);
  }

  // A scene that throws is dropped and the runner carries on without it
  function drop(scene: DeckView, error: unknown) {
    console.error("deck: the scene failed, carrying on without it", error);
    disconnect(scene);
  }

  // A step waits for a scene that is still downloading, so the first record still makes its journey. load() waits here
  // before anything leaves the crate, so a press undone during the download moves nothing
  async function viewForStep(): Promise<DeckView | null> {
    const waiting = pending;
    if (waiting) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        waiting.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), VIEW_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
      // Stop waiting on later steps; the scene still attaches if it turns up
      if (timedOut && pending === waiting) pending = null;
    }
    return view;
  }

  async function animate(step: (scene: DeckView) => Promise<void>) {
    const scene = await viewForStep();
    if (!scene) return;
    try {
      await step(scene);
    } catch (error) {
      drop(scene, error);
    }
  }

  function fail(index: number) {
    if (want === index) want = null;
    failed = index;
    emit();
    announce(`couldn't play ${tracks[index].title}`);
    clearTimeout(failTimer);
    failTimer = setTimeout(() => {
      failed = null;
      emit();
    }, FAILED_MS);
  }

  async function load(index: number) {
    if (pending) {
      // Only while a scene downloads: with one attached, or none coming, presses run exactly as before
      await viewForStep();
      if (want !== index) {
        // They changed their mind while it downloaded: nothing moved, nothing to take back. A stop still pauses the
        // element the press unlocked, which would otherwise keep streaming at zero gain
        if (want === null) audio.stop();
        return;
      }
    }
    current = index;
    const flip = browsed !== index;
    browsed = index;
    emit();
    if (flip) await animate((scene) => scene.flip(index));
    await animate((scene) => scene.load(index, () => want === index));
    if (want !== index) return; // changed their mind on the way: no audio, the loop takes it back
    const ok = await audio.start(tracks[index].src, () => want === index);
    if (!ok) {
      if (want === index) fail(index); // a record the visitor has left is not worth reporting
      return;
    }
    if (want !== index) return;
    playing = index;
    emit();
    announce(`now playing ${tracks[index].title}`);
    played?.(index);
  }

  async function unload(index: number) {
    const wasPlaying = playing === index;
    audio.stop();
    playing = null;
    browsed = index; // the scene flips back to the record on its way home
    emit();
    if (wasPlaying) announce("stopped");
    await animate((scene) => scene.unload(index));
    current = null;
    emit();
  }

  async function run() {
    if (running) return;
    running = true;
    emit();
    try {
      for (;;) {
        while (current !== want) {
          if (current !== null) await unload(current);
          else if (want !== null) await load(want);
        }
        // A flip asked for during the journey; then round again for any press or flip that lands during it
        const target = browseWant;
        browseWant = null;
        if (target === null || target === browsed) break;
        browsed = target;
        emit();
        await animate((scene) => scene.flip(target));
      }
    } finally {
      running = false;
      emit();
    }
  }

  function toggle(index: number) {
    const i = clamp(index);
    const at = now();
    if (i === lastPress.index && at - lastPress.at < DOUBLE_PRESS_MS) return;
    lastPress = { index: i, at };
    if (want === i) {
      want = null;
    } else {
      want = i;
      audio.unlock(tracks[i].src); // inside the press, so WebKit lets the record play when it lands
      if (failed !== null) {
        failed = null;
        clearTimeout(failTimer);
      }
    }
    emit();
    void run();
  }

  function browse(index: number) {
    const i = clamp(index);
    if (running) {
      browseWant = i;
      return;
    }
    if (i === browsed) return;
    browsed = i;
    emit();
    const scene = view;
    if (!scene) return;
    // Starting from a resolved promise catches a flip that throws synchronously as well as one that rejects
    Promise.resolve()
      .then(() => scene.flip(i))
      .catch((error: unknown) => drop(scene, error));
  }

  function connect(loading: Promise<DeckView | null>) {
    const settled: Promise<DeckView | null> = loading
      .catch((error: unknown) => {
        console.error("deck: the scene failed to load", error);
        return null;
      })
      .then((scene) => {
        if (pending === settled) pending = null;
        if (scene) view = scene;
        emit();
        return scene;
      });
    pending = settled;
  }

  function disconnect(scene: DeckView) {
    if (view !== scene) return;
    view = null;
    emit();
  }

  audio.onEnded(() => {
    if (playing === null || want !== playing) return;
    want = null;
    emit();
    void run();
  });
  audio.onError(() => {
    if (playing === null) return; // a failure before the record lands is start()'s to report
    const index = playing;
    playing = null;
    fail(index);
    void run();
  });

  return {
    tracks,
    getState,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggle,
    browse,
    setRate: (rate) => audio.setRate(rate),
    connect,
    disconnect,
  };
}
