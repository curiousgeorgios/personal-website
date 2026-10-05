import { Raycaster, Vector2, type Mesh, type Object3D } from "three";
import type { TrackDetail } from "../../lib/track";
import type { Deck } from "../types";
import type { Stage } from "./build";
import type { Hud } from "./hud";
import type { Journeys, Preview } from "./journeys";
import { OMEGA, PLATTER } from "./layout";
import type { Loop } from "./loop";
import { easeOut, type Tweens } from "./tween";

type Act = "play" | "prev" | "next" | "record" | "deck";

export interface Pointer {
  clearPreview(): void;
}

interface Options {
  deck: Deck;
  stage: Stage;
  journeys: Journeys;
  hud: Hud;
  loop: Loop;
  tweens: Tweens;
  reduce: boolean;
}

const SCRATCH_PX = 6;
const RATE_MIN = 0.25; // Firefox mutes below this
const RATE_MAX = 2.5;

// The cover you can see (or anywhere on the crate) plays or stops; records in front or behind flip by one; the
// spinning record, the platter and the start button stop. Hidden records never count as hits (spec 5.4).
export function bindPointer(canvas: HTMLCanvasElement, { deck, stage, journeys, hud, loop, tweens, reduce }: Options): Pointer {
  const ray = new Raycaster();
  const ndc = new Vector2();
  let previewing: Preview = null;
  let suppressClick = false;
  let found = false;
  let drag: { x0: number; y0: number; angle: number; at: number; live: boolean; rate: number } | null = null;

  function pick(event: MouseEvent): Act | null {
    const box = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const discs = stage.records.filter((r) => r.disc.visible).map((r) => r.disc);
    const targets: Object3D[] = [...stage.records.map((r) => r.sleeve), ...stage.crateWalls, stage.button, stage.platter, ...discs];
    const hit = ray.intersectObjects(targets, true)[0];
    if (!hit) return null;
    const state = deck.getState();
    const index = hit.object.userData.index as number | undefined;
    if (index !== undefined) return index === state.browsed ? "play" : index < state.browsed ? "prev" : "next";
    if (stage.crateWalls.includes(hit.object as Mesh)) return "play";
    const onPlatter = state.current !== null ? stage.records[state.current].disc : null;
    if (onPlatter?.visible && hit.object.parent === onPlatter) return "record";
    return "deck";
  }

  // Hover previews the click: the cover lifts, the browsed record starts to tip or the nearest tipped one starts to rise
  function preview(action: Preview) {
    if (deck.getState().busy) action = null;
    if (action === previewing) return;
    previewing = action;
    journeys.preview(action);
    hud.hint(action);
  }

  // The pointer's angle around the platter's centre on screen
  function screenAngle(event: PointerEvent) {
    const box = canvas.getBoundingClientRect();
    const p = PLATTER.clone().project(stage.camera);
    const cx = box.left + (p.x * 0.5 + 0.5) * box.width;
    const cy = box.top + (-p.y * 0.5 + 0.5) * box.height;
    return Math.atan2(event.clientY - cy, event.clientX - cx);
  }

  // Easter egg: grab the spinning record and scratch it. The platter follows the hand and the music bends with it.
  function scratch(event: PointerEvent) {
    if (!drag) return;
    if (!drag.live) {
      if (Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < SCRATCH_PX) return;
      drag.live = true;
      if (!found) {
        found = true; // counted once per visit
        document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "scratch_found" } }));
      }
      loop.setScratching(true);
      canvas.style.cursor = "grabbing";
    }
    const angle = screenAngle(event);
    const at = performance.now();
    const turned = Math.atan2(Math.sin(angle - drag.angle), Math.cos(angle - drag.angle));
    const seconds = Math.max(0.008, (at - drag.at) / 1000);
    stage.platter.rotation.y -= turned;
    drag.rate += (Math.max(RATE_MIN, Math.min(RATE_MAX, turned / seconds / OMEGA)) - drag.rate) * 0.45;
    deck.setRate(drag.rate);
    drag.angle = angle;
    drag.at = at;
  }

  function endDrag(event: PointerEvent) {
    if (!drag) return;
    if (drag.live) {
      suppressClick = event.type === "pointerup"; // no click follows a cancelled pointer
      loop.setScratching(false);
      canvas.style.cursor = "grab";
      // Only a record still playing spins up: one that ended or failed mid-scratch has gone home
      const now = deck.getState();
      if (now.current !== null && now.want === now.current && !now.busy) loop.spinTo(reduce ? 0 : OMEGA);
      const from = drag.rate;
      void tweens.tween(420, (k) => deck.setRate(k === 1 ? 1 : from + (1 - from) * k), easeOut, "scratch");
    }
    drag = null;
  }

  canvas.addEventListener("pointerdown", (event) => {
    suppressClick = false; // a new gesture: a scratch that ended without a click must not swallow this one
    if (event.pointerType !== "mouse") return; // touch and pen keep scrolling the page; a pen tap still stops the record (click)
    const state = deck.getState();
    if (state.busy || state.current === null || state.want !== state.current) return;
    if (pick(event) !== "record") return;
    drag = { x0: event.clientX, y0: event.clientY, angle: screenAngle(event), at: performance.now(), live: false, rate: 1 };
    try {
      canvas.setPointerCapture(event.pointerId); // keeps the drag even if the pointer leaves the canvas
    } catch {
      // the pointer may already be gone
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag) return scratch(event);
    if (event.pointerType !== "mouse") return;
    const act = pick(event);
    canvas.style.cursor = act === null ? "" : act === "record" && !deck.getState().busy ? "grab" : "pointer";
    preview(act === "play" || act === "prev" || act === "next" ? act : null);
  });
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (drag) return;
    canvas.style.cursor = "";
    preview(null);
  });
  canvas.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const act = pick(event);
    if (act === null) return;
    const { browsed, want } = deck.getState();
    if (act === "play") deck.toggle(browsed);
    else if (act === "prev") deck.browse(browsed - 1);
    else if (act === "next") deck.browse(browsed + 1);
    else if (want !== null) deck.toggle(want); // the record, the platter or the start button: stop
  });

  return { clearPreview: () => preview(null) };
}
