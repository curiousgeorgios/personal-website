import type { AudioPort } from "./types";

export const FADE_IN_MS = 500;
export const FADE_OUT_MS = 260;
export const START_TIMEOUT_MS = 15_000;

type Graph = { context: AudioContext; gain: GainNode };

/** Resolves true once `playing` resolves, false if it rejects or takes longer than `ms` */
function settles(playing: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    playing.then(
      () => { clearTimeout(timer); resolve(true); },
      () => { clearTimeout(timer); resolve(false); },
    );
  });
}

/** The deck's audio port, plus building its graph ahead of the first press */
export interface DeckAudio extends AudioPort {
  /** Builds the Web Audio graph now, suspended: a context made outside a gesture starts suspended, and the press resumes
   *  it. Keeps that work out of the first press (spec 11's interaction budget). Safe to call more than once */
  prepare(): void;
  /** The graph has been built, or building it failed and fades use the element's volume */
  readonly ready: boolean;
}

// One shared <audio> element for every record, routed through a gain node (spec 5.3)
export function createAudioPort(element: HTMLAudioElement, makeContext: () => AudioContext = () => new AudioContext()): DeckAudio {
  let graph: Graph | null = null;
  let tried = false;
  let unlocked = false;
  let loaded = "";
  let token = 0;
  let ended = () => {};
  let errored = () => {};
  element.addEventListener("ended", () => ended());
  element.addEventListener("error", () => errored());

  // Built once: ahead of the first press (prepare), or inside it. A context made outside a gesture starts suspended,
  // and every press resumes it, because browsers only let audio start from a user gesture
  function connect(): Graph | null {
    if (tried) return graph;
    tried = true;
    try {
      const context = makeContext();
      const gain = context.createGain();
      context.createMediaElementSource(element).connect(gain).connect(context.destination);
      graph = { context, gain };
    } catch {
      graph = null;
    }
    return graph;
  }

  // The gain, not element.volume, because iOS ignores volume
  function fade(to: number, ms: number) {
    if (!graph) {
      element.volume = to;
      return;
    }
    const param = graph.gain.gain;
    const now = graph.context.currentTime;
    param.cancelScheduledValues(now);
    if (ms <= 0) {
      param.setValueAtTime(to, now);
      return;
    }
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + ms / 1000);
  }

  function load(src: string) {
    if (loaded === src && !element.error) return;
    loaded = src;
    element.src = src;
  }

  return {
    prepare() {
      connect();
    },
    get ready() {
      return tried;
    },
    unlock(src) {
      // iOS mutes Web Audio with the ringer switch unless the page asks for a playback session
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
      void connect()?.context.resume().catch(() => {});
      if (unlocked) return;
      unlocked = true;
      // Started inside the gesture at zero gain, so WebKit lets this element play when the record lands
      fade(0, 0);
      load(src);
      element.play().catch(() => {});
    },
    async start(src, wanted) {
      const mine = ++token;
      load(src);
      fade(0, 0);
      element.currentTime = 0;
      element.playbackRate = 1;
      if (!(await settles(element.play(), START_TIMEOUT_MS))) {
        element.pause();
        return false;
      }
      if (mine !== token) return true;
      if (!wanted()) {
        element.pause();
        return true;
      }
      fade(1, FADE_IN_MS);
      return true;
    },
    stop() {
      const mine = ++token;
      fade(0, FADE_OUT_MS);
      setTimeout(() => {
        if (mine === token) element.pause();
      }, FADE_OUT_MS);
    },
    setRate(rate) {
      element.preservesPitch = false;
      (element as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
      element.playbackRate = rate;
    },
    onEnded(listener) {
      ended = listener;
    },
    onError(listener) {
      errored = listener;
    },
  };
}
