import type { Deck, DeckView } from "./types";
import { buildStage, createRenderer } from "./scene/build";
import { DESKTOP, PHONE, frame, toCanvas } from "./scene/framing";
import { installHooks } from "./scene/hooks";
import { createHud } from "./scene/hud";
import { createJourneys } from "./scene/journeys";
import { HUD_ANCHOR } from "./scene/layout";
import { lightFor } from "./scene/lighting";
import { createLoop } from "./scene/loop";
import { bindPointer } from "./scene/pointer";
import { idle, loadCovers, makeTextures } from "./scene/textures";
import { createTweens } from "./scene/tween";

const PHONE_WIDTH = "(max-width: 680px)";

// The scene chunk (spec 5.2). Builds the room in idle slices and compiles its shaders before the first frame, then
// attaches to the deck runner as its view. The canvas replaces the poster on its first frame, with no fade.
export async function mount(host: HTMLElement, deck: Deck): Promise<DeckView> {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = createRenderer();
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  const [textures, covers] = await Promise.all([makeTextures(renderer), loadCovers(deck.tracks.map((track) => track.cover))]);
  const stage = await buildStage(renderer, textures, covers, lightFor(new Date()));
  await renderer.compileAsync(stage.scene, stage.camera);
  // Every texture goes to the GPU in an idle moment of its own, so the first frame doesn't upload them all at once
  for (const texture of [...textures.walnut, textures.grooves, textures.fur, textures.glow, ...covers]) {
    await idle();
    renderer.initTexture(texture);
  }

  const tweens = createTweens(() => loop.invalidate());
  const loop = createLoop({ renderer, stage, tweens, reduce, onFrame: () => host.classList.add("live") });
  const journeys = createJourneys(stage, tweens, loop, reduce);
  host.appendChild(canvas);
  const hud = createHud(host, deck);
  const pointer = bindPointer(canvas, { deck, stage, journeys, hud, loop, tweens, reduce });

  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    frame(stage.camera, matchMedia(PHONE_WIDTH).matches ? PHONE : DESKTOP, width, height);
    const anchor = toCanvas(HUD_ANCHOR, stage.camera, width, height);
    hud.place(anchor.x, anchor.y, width, height);
    loop.invalidate();
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(host);
  resize();
  journeys.sync(deck.getState());
  hud.render(deck.getState());

  // Off screen, in a hidden tab, under reduced motion or without a context, steps finish at once and nothing renders
  let onScreen = false;
  let lost = false;
  const visibility = () => {
    tweens.setInstant(reduce || lost || !onScreen || document.hidden);
    loop.setVisible(onScreen && !lost && !document.hidden);
  };
  let sight = () => {};
  const sighted = new Promise<void>((resolve) => (sight = resolve));
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    visibility();
    sight();
  });
  watcher.observe(host);
  document.addEventListener("visibilitychange", visibility);
  visibility();

  const view: DeckView = {
    flip: (index) => journeys.flip(index),
    load: (index, wanted) => journeys.load(index, wanted),
    unload: (index) => journeys.unload(index),
    update: (state) => {
      hud.render(state);
      if (state.busy) pointer.clearPreview();
      // A record that landed while the scene was still arriving: pose it now the runner is idle
      else if (state.current !== null && stage.records[state.current].disc.parent !== stage.platter) journeys.sync(state);
    },
  };

  // Losing the context brings the poster back; the list keeps working
  canvas.addEventListener(
    "webglcontextlost",
    () => {
      lost = true;
      visibility(); // finishes a journey in flight at once, so the runner never waits on a dead scene
      loop.stop();
      watcher.disconnect();
      resizer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      host.classList.remove("live");
      canvas.remove();
      hud.remove();
      deck.disconnect(view);
    },
    { once: true },
  );

  if (__TEST_HOOKS__) installHooks({ renderer, stage, tweens, loop, deck });
  // The runner hands over a held press as soon as the view arrives, so the scene must know whether it can be seen
  // first (until the observer reports, tweens are instant). The cap covers a background tab, where observers don't run.
  await Promise.race([sighted, new Promise((resolve) => setTimeout(resolve, 500))]);
  return view;
}
