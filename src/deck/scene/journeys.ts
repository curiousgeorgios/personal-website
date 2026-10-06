import { Quaternion, Vector3, type Object3D } from "three";
import type { DeckState } from "../types";
import type { CrateRecord, Stage } from "./build";
import { ARM_DOWN, ARM_UP, FLY_PEAK, OMEGA, PLATTER, RECORD_Y, SLEEVE, playAngle, tiltFor } from "./layout";
import type { Loop } from "./loop";
import { easeInOut, easeOut, type Ease, type Tweens } from "./tween";

export type Preview = "play" | "prev" | "next" | null;

export interface Journeys {
  flip(browsed: number): Promise<void>;
  load(index: number, wanted: () => boolean): Promise<void>;
  unload(index: number): Promise<void>;
  /** Poses the deck to match the runner without animating (the scene arriving mid-session) */
  sync(state: DeckState): void;
  /** Hover preview: the cover lifts (play), the browsed record starts to tip (next) or the nearest tipped one starts to rise (prev) */
  preview(action: Preview): void;
}

// A flat record turned upright, label facing out, as it stands in its sleeve
const STAND = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
const FLAT = new Quaternion();

// Every move is physical: a record rises out of its sleeve, travels to the platter and goes back the same way.
// Only the deck runner calls load and unload, one at a time, so two journeys never overlap.
export function createJourneys(stage: Stage, tweens: Tweens, loop: Loop, reduce: boolean): Journeys {
  const { scene, platter, arm, records } = stage;
  const PLAY_ANGLE = playAngle();
  let shown = 0;
  let previewing: Preview = null;

  const moveTo = (o: Object3D, to: Vector3, ms: number, ease?: Ease) => {
    const from = o.position.clone();
    return tweens.tween(ms, (k) => void o.position.lerpVectors(from, to, k), ease);
  };
  const turnTo = (o: Object3D, y: number, ms: number, ease?: Ease) => {
    const from = o.rotation.y;
    return tweens.tween(ms, (k) => void (o.rotation.y = from + (y - from) * k), ease);
  };
  // Keyed, so fast flips and hovers retarget instead of fighting
  const tiltTo = (r: CrateRecord, x: number, ms: number) => {
    const from = r.holder.rotation.x;
    return tweens.tween(ms, (k) => void (r.holder.rotation.x = from + (x - from) * k), easeOut, `${r.holder.uuid}:tilt`);
  };
  const liftTo = (r: CrateRecord, by: number, ms: number) => {
    const from = r.holder.position.y;
    const to = r.baseY + by;
    return tweens.tween(ms, (k) => void (r.holder.position.y = from + (to - from) * k), easeOut, `${r.holder.uuid}:lift`);
  };
  // An arc through a raised midpoint while the record turns between standing and flat
  const fly = (o: Object3D, to: Vector3, toQ: Quaternion, ms: number) => {
    const p0 = o.position.clone();
    const p2 = to.clone();
    const p1 = p0.clone().lerp(p2, 0.5);
    p1.y = Math.max(FLY_PEAK, p0.y, p2.y);
    const q0 = o.quaternion.clone();
    return tweens.tween(
      ms,
      (k) => {
        const a = (1 - k) * (1 - k);
        const b = 2 * (1 - k) * k;
        const c = k * k;
        o.position.set(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y, a * p0.z + b * p1.z + c * p2.z);
        o.quaternion.slerpQuaternions(q0, toQ, k);
      },
      easeInOut,
    );
  };

  const sleeveCentre = (r: CrateRecord) => {
    r.holder.updateWorldMatrix(true, false);
    return r.holder.localToWorld(new Vector3(0, SLEEVE / 2, 0));
  };
  const pulled = (r: CrateRecord) => sleeveCentre(r).add(new Vector3(-3.2, 0, 0));
  const standing = (r: CrateRecord) => r.holder.getWorldQuaternion(new Quaternion()).multiply(STAND);
  const onPlatter = () => new Vector3(PLATTER.x, RECORD_Y, PLATTER.z);
  const nudge = (j: number) => (previewing === "next" && j === shown ? 0.11 : previewing === "prev" && j === shown - 1 ? -0.1 : 0);
  const settle = (ms: number) => Promise.all(records.map((r, j) => tiltTo(r, tiltFor(j, shown) + nudge(j), ms))).then(() => {});
  const lampOn = (on: boolean) => {
    stage.lamp.emissiveIntensity = on ? 2.2 : 0;
    loop.invalidate();
  };

  function flip(browsed: number) {
    shown = Math.max(0, Math.min(records.length - 1, browsed));
    return settle(280);
  }

  async function load(index: number, wanted: () => boolean) {
    const r = records[index];
    previewing = null;
    await liftTo(r, 0.95, 300);
    scene.attach(r.disc); // every journey travels in world space, whatever the record was attached to
    r.disc.position.copy(sleeveCentre(r));
    r.disc.quaternion.copy(standing(r));
    r.disc.visible = true;
    await moveTo(r.disc, pulled(r), 440);
    void liftTo(r, 0, 280);
    await fly(r.disc, onPlatter().setY(RECORD_Y + 0.5), FLAT, 720);
    await moveTo(r.disc, onPlatter(), 200);
    platter.attach(r.disc);
    if (!wanted()) return; // changed their mind on the way: no needle, the runner takes it back
    loop.spinTo(reduce ? 0 : OMEGA);
    await turnTo(arm, -PLAY_ANGLE, 560, easeInOut);
    await moveTo(arm, arm.position.clone().setY(ARM_DOWN), 160);
    lampOn(true);
  }

  async function unload(index: number) {
    const r = records[index];
    previewing = null;
    lampOn(false);
    loop.spinTo(0);
    if (arm.rotation.y !== 0) {
      await moveTo(arm, arm.position.clone().setY(ARM_UP), 150);
      await turnTo(arm, 0, 520, easeInOut);
    }
    scene.attach(r.disc);
    await moveTo(r.disc, r.disc.position.clone().setY(RECORD_Y + 0.5), 200);
    if (shown !== index) void flip(index);
    void liftTo(r, 0.95, 300);
    await tweens.wait(300);
    await fly(r.disc, pulled(r), standing(r), 720);
    await moveTo(r.disc, sleeveCentre(r), 400);
    r.disc.visible = false;
    await liftTo(r, 0, 280);
  }

  function sync(state: DeckState) {
    shown = state.browsed;
    previewing = null;
    records.forEach((r, j) => {
      r.holder.rotation.x = tiltFor(j, shown);
      r.holder.position.y = r.baseY;
      scene.attach(r.disc);
      r.disc.visible = false;
    });
    arm.rotation.y = 0;
    arm.position.y = ARM_UP;
    lampOn(false);
    loop.spinTo(0);
    // A record at rest on the platter; one mid-journey starts from its sleeve, because the runner is about to move it
    if (state.current !== null && !state.busy) {
      const disc = records[state.current].disc;
      disc.position.copy(onPlatter());
      disc.quaternion.identity();
      disc.visible = true;
      platter.attach(disc);
      if (state.want === state.current) {
        arm.rotation.y = -PLAY_ANGLE;
        arm.position.y = ARM_DOWN;
        lampOn(true);
        loop.spinTo(reduce ? 0 : OMEGA);
      }
    }
    loop.invalidate();
  }

  function preview(action: Preview) {
    if (action === previewing) return;
    const wasPlay = previewing === "play";
    previewing = action;
    const r = records[shown];
    if (wasPlay || action === "play") void liftTo(r, action === "play" ? 0.12 : 0, 160);
    void settle(170);
  }

  return { flip, load, unload, sync, preview };
}
