// The listening corner's shared types. Everything under src/deck/scene* and the scene loader imports these with
// `import type` only, so the deck runner stays one inlined script that shares no chunk with the scene.

export interface DeckTrack {
  title: string;
  artist: string;
  /** Same-origin URL of the MP3, e.g. /media/audio/simple-things.mp3 */
  src: string;
  /** Same-origin URL of the 512px WebP cover */
  cover: string;
}

export interface DeckState {
  /** The record the visitor wants on the platter, or null for none */
  want: number | null;
  /** The record out of its sleeve (travelling or on the platter), or null */
  current: number | null;
  /** The record the crate shows */
  browsed: number;
  /** A journey is running */
  busy: boolean;
  /** The record whose audio is playing, or null */
  playing: number | null;
  /** The record whose row says "couldn't play", or null */
  failed: number | null;
  /** A scene is attached */
  scene: boolean;
}

/** What the scene does for the runner. Each promise resolves when its motion ends (at once when nobody can see it). */
export interface DeckView {
  /** Tilt the crate so `browsed` is in view; a new flip retargets one still running */
  flip(browsed: number): Promise<void>;
  /** Carry a record from its sleeve to the platter, then, if `wanted()` is still true, spin up and drop the needle */
  load(index: number, wanted: () => boolean): Promise<void>;
  /** Lift the needle, stop the platter and carry the record back into its sleeve */
  unload(index: number): Promise<void>;
  /** Called after every state change */
  update(state: DeckState): void;
}

export interface AudioPort {
  /** Call inside the press handler: resumes Web Audio and primes the element, because WebKit only plays media started in a gesture */
  unlock(src: string): void;
  /** Plays `src` from the start with a fade-in. False when it can't load, decode or play; no fade-in if `wanted()` turned false meanwhile */
  start(src: string, wanted: () => boolean): Promise<boolean>;
  /** Fades out, then pauses */
  stop(): void;
  /** Playback rate for the scratch (pitch follows the rate) */
  setRate(rate: number): void;
  onEnded(listener: () => void): void;
  onError(listener: () => void): void;
}

export interface Deck {
  readonly tracks: readonly DeckTrack[];
  getState(): DeckState;
  subscribe(listener: (state: DeckState) => void): () => void;
  /** Plays the record, or stops it if it is the one wanted. A second press on the same record within 450ms is ignored */
  toggle(index: number): void;
  /** Shows a record in the crate; during a journey the flip waits until the runner is idle */
  browse(index: number): void;
  setRate(rate: number): void;
  /** The scene loader hands over the scene while it is still loading; steps wait for it (up to 5s) */
  connect(view: Promise<DeckView | null>): void;
  /** The scene went away (lost WebGL context); the runner carries on without it */
  disconnect(view: DeckView): void;
}
