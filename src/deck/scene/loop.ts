import type { WebGLRenderer } from "three";
import type { Stage } from "./build";
import type { Tweens } from "./tween";

export interface Loop {
  /** Draws a frame soon, if the canvas can be seen */
  invalidate(): void;
  /** Platter speed to ease towards, in radians a second */
  spinTo(target: number): void;
  setScratching(on: boolean): void;
  setVisible(visible: boolean): void;
  stop(): void;
  readonly frames: number;
  /** Frames that redrew the shadow map, for the test hooks */
  readonly shadows: number;
}

const SPIN_FPS = 30;

// Renders on demand (spec 5.2): a frame only while something moves or the platter spins, never off screen, and at
// most 30 frames a second while the spinning platter is the only thing moving. The candle flickers only then too.
export function createLoop({ renderer, stage, tweens, reduce, onFrame }: { renderer: WebGLRenderer; stage: Stage; tweens: Tweens; reduce: boolean; onFrame: () => void }): Loop {
  const { scene, camera, platter, candle } = stage;
  let raf = 0;
  let last = 0;
  let lastDraw = -Infinity;
  let omega = 0;
  let omegaTarget = 0;
  let scratching = false;
  let visible = false;
  let stopped = false;
  let dirty = true;
  let frames = 0;
  let shadows = 0;

  // The shadow map is redrawn only when something casting a shadow may have moved: a tween, or a frame asked for.
  // Spinning, a scratch turning the platter by hand and the candle's flicker change nothing a shadow shows (the record's
  // shadow is a disc), so the 2048 map isn't redrawn 30 times a second for a whole track, or on every move of a scratch
  // (plan 2 and plan 4 follow-ups).
  renderer.shadowMap.autoUpdate = false;

  function flicker(now: number) {
    const t = now / 1000;
    const f = 1 + 0.07 * Math.sin(t * 12.7) + 0.045 * Math.sin(t * 23.3 + 1.1) + 0.03 * Math.sin(t * 41.9 + 2.3);
    candle.light.intensity = candle.intensity * f;
    candle.flame.scale.set(1 - (f - 1) * 0.6, f, 1 - (f - 1) * 0.6);
    candle.flame.rotation.z = Math.sin(t * 3.1) * 0.05;
  }

  function tick(now: number) {
    raf = 0;
    if (stopped || !visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Counted before stepping: step applies a tween's final pose and reports it done in the same call, and the frame
    // that draws that pose still needs its shadow
    const stepping = tweens.count > 0;
    const tweening = tweens.step(now);
    omega += (omegaTarget - omega) * (1 - Math.exp(-dt * 3.2));
    if (omegaTarget === 0 && Math.abs(omega) < 0.0005) omega = 0;
    platter.rotation.y -= omega * dt;
    const moving = tweening || omega > 0 || scratching;
    const spinningOnly = moving && !tweening && !scratching;
    if (dirty || !spinningOnly || now - lastDraw >= 1000 / SPIN_FPS - 1) {
      if (moving && !reduce) flicker(now);
      renderer.shadowMap.needsUpdate = dirty || stepping;
      if (renderer.shadowMap.needsUpdate) shadows += 1;
      renderer.render(scene, camera);
      frames += 1;
      lastDraw = now;
      dirty = false;
      onFrame();
    }
    if (moving || dirty) raf = requestAnimationFrame(tick);
  }

  function invalidate() {
    dirty = true;
    if (raf || stopped || !visible) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  return {
    invalidate,
    spinTo(target) {
      omegaTarget = target;
      if (!visible) omega = target; // nobody can see it ease, and tick won't run to do it
      invalidate();
    },
    setScratching(on) {
      scratching = on;
      if (on) {
        omega = 0;
        omegaTarget = 0;
      }
      invalidate();
    },
    setVisible(next) {
      visible = next;
      if (next) invalidate();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    get frames() {
      return frames;
    },
    get shadows() {
      return shadows;
    },
  };
}
