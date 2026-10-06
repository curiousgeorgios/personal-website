export type Ease = (k: number) => number;

export const easeOut: Ease = (k) => 1 - Math.pow(1 - k, 3);
export const easeInOut: Ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const linear: Ease = (k) => k;

interface Running {
  start: number;
  ms: number;
  apply: (k: number) => void;
  ease: Ease;
  done: () => void;
  key?: string;
  casts: boolean;
}

export interface Tweens {
  /**
   * Runs `apply` from 0 to 1 over `ms`. A keyed tween first ends any running tween with the same key where it stands,
   * so fast repeated input (flips, hovers) retargets instead of two animations fighting. `casts` is true unless `apply`
   * moves nothing that casts a shadow (a playback rate, say): the loop then leaves the 2048 shadow map alone for its frames.
   */
  tween(ms: number, apply: (k: number) => void, ease?: Ease, key?: string, casts?: boolean): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Advances every tween to `now`; true while any are still running */
  step(now: number): boolean;
  /** While instant (off screen, hidden tab, reduced motion, lost context) tweens jump to their end, so journeys never stall */
  setInstant(instant: boolean): void;
  readonly count: number;
  /** True while any running tween moves something that casts a shadow */
  readonly casting: boolean;
}

export function createTweens(onStart: () => void, clock: () => number = () => performance.now()): Tweens {
  const running: Running[] = [];
  let instant = false;

  const tween: Tweens["tween"] = (ms, apply, ease = easeOut, key, casts = true) =>
    new Promise<void>((done) => {
      if (key) {
        const j = running.findIndex((r) => r.key === key);
        if (j >= 0) running.splice(j, 1)[0].done();
      }
      if (instant || ms <= 0) {
        apply(1);
        done();
      } else {
        running.push({ start: clock(), ms, apply, ease, done, key, casts });
      }
      onStart();
    });

  return {
    tween,
    wait: (ms) => tween(ms, () => {}, linear),
    step(now) {
      for (let i = running.length - 1; i >= 0; i--) {
        const r = running[i];
        const k = Math.min(1, Math.max(0, (now - r.start) / r.ms));
        r.apply(r.ease(k));
        if (k === 1) {
          running.splice(i, 1);
          r.done();
        }
      }
      return running.length > 0;
    },
    setInstant(next) {
      instant = next;
      if (!next) return;
      for (const r of running.splice(0)) {
        r.apply(1);
        r.done();
      }
    },
    get count() {
      return running.length;
    },
    get casting() {
      return running.some((r) => r.casts);
    },
  };
}
