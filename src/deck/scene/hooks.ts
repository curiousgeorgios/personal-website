import { Vector3, type WebGLRenderer } from "three";
import type { Deck } from "../types";
import type { Stage } from "./build";
import { PLATTER, RECORD_Y, SLEEVE } from "./layout";
import type { Loop } from "./loop";
import type { Tweens } from "./tween";

type Point = { x: number; y: number; z: number };

export interface SceneHooks {
  frames(): number;
  tweens(): number;
  tilts(): number[];
  spin(): number;
  offsets(): { i: number; parent: "platter" | "scene"; visible: boolean; dx: number; dz: number; y: number; lifted: number }[];
  /** Client (page) coordinates of a world point */
  toScreen(x: number, y: number, z: number): { x: number; y: number };
  platterAt(): Point;
  coverAt(): Point;
  /** On-screen box of the browsed record's sleeve, in client pixels */
  coverRect(): { x: number; y: number; width: number; height: number };
  loseContext(): void;
  /** Empties the crate and hides the crate control, for `bun run poster` */
  poster(): void;
}

// A test-only window into the scene (spec 5.5). Installed only when __TEST_HOOKS__ is true, so production drops it.
export function installHooks({ renderer, stage, tweens, loop, deck }: { renderer: WebGLRenderer; stage: Stage; tweens: Tweens; loop: Loop; deck: Deck }): void {
  const canvas = renderer.domElement;
  const screen = (point: Vector3) => {
    const box = canvas.getBoundingClientRect();
    const p = point.clone().project(stage.camera);
    return { x: box.left + (p.x * 0.5 + 0.5) * box.width, y: box.top + (-p.y * 0.5 + 0.5) * box.height };
  };
  const browsed = () => {
    const record = stage.records[deck.getState().browsed];
    record.holder.updateWorldMatrix(true, false);
    return record;
  };
  window.__deckScene = {
    frames: () => loop.frames,
    tweens: () => tweens.count,
    tilts: () => stage.records.map((r) => +r.holder.rotation.x.toFixed(3)),
    spin: () => +stage.platter.rotation.y.toFixed(3),
    offsets: () =>
      stage.records.map((r, i) => {
        const at = r.disc.getWorldPosition(new Vector3());
        return {
          i,
          parent: r.disc.parent === stage.platter ? ("platter" as const) : ("scene" as const),
          visible: r.disc.visible,
          dx: +(at.x - PLATTER.x).toFixed(3),
          dz: +(at.z - PLATTER.z).toFixed(3),
          y: +at.y.toFixed(3),
          lifted: +(r.holder.position.y - r.baseY).toFixed(3),
        };
      }),
    toScreen: (x, y, z) => screen(new Vector3(x, y, z)),
    platterAt: () => ({ x: PLATTER.x, y: RECORD_Y, z: PLATTER.z }),
    coverAt: () => {
      const centre = browsed().holder.localToWorld(new Vector3(0, SLEEVE / 2, 0));
      return { x: centre.x, y: centre.y + 0.6, z: centre.z };
    },
    coverRect: () => {
      const holder = browsed().holder;
      const points = [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, sy]) => screen(holder.localToWorld(new Vector3((sx * SLEEVE) / 2, sy * SLEEVE, 0))));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    },
    loseContext: () => renderer.getContext().getExtension("WEBGL_lose_context")?.loseContext(),
    poster: () => {
      for (const record of stage.records) {
        record.holder.visible = false;
        record.disc.visible = false;
      }
      canvas.parentElement?.querySelector<HTMLElement>(".crate-hud")?.style.setProperty("visibility", "hidden");
      loop.invalidate();
    },
  };
}
