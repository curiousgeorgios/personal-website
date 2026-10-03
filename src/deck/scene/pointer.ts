import { Raycaster, Vector2, type Mesh, type Object3D } from "three";
import type { Deck } from "../types";
import type { Stage } from "./build";
import type { Hud } from "./hud";
import type { Journeys, Preview } from "./journeys";

type Act = "play" | "prev" | "next" | "record" | "deck";

export interface Pointer {
  clearPreview(): void;
}

// The cover you can see (or anywhere on the crate) plays or stops; records in front or behind flip by one; the
// spinning record, the platter and the start button stop. Hidden records never count as hits (spec 5.4).
export function bindPointer(canvas: HTMLCanvasElement, { deck, stage, journeys, hud }: { deck: Deck; stage: Stage; journeys: Journeys; hud: Hud }): Pointer {
  const ray = new Raycaster();
  const ndc = new Vector2();
  let previewing: Preview = null;

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
    if (index !== undefined) return index === state.browsed || index === state.want ? "play" : index < state.browsed ? "prev" : "next";
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

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const act = pick(event);
    canvas.style.cursor = act === null ? "" : "pointer";
    preview(act === "play" || act === "prev" || act === "next" ? act : null);
  });
  canvas.addEventListener("pointerleave", () => {
    canvas.style.cursor = "";
    preview(null);
  });
  canvas.addEventListener("click", (event) => {
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
