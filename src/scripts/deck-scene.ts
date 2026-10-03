import type { Deck, DeckView } from "../deck/types";

// Loads the 3D scene after the page has loaded, in an idle moment, once the row is within 200px of the viewport
// (spec 5.2). This loader is a hashed file like any chunk: if a newer deploy removed it, the poster and the list
// carry on. It imports only types from the deck, so the runner stays inlined.
type Host = HTMLElement & { deck?: Deck };

const host = document.querySelector<Host>("[data-deck]");
let booted = false;

function webgl(): boolean {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

function boot(target: Host) {
  const deck = target.deck;
  if (booted || !deck || !webgl()) return;
  booted = true; // one scene per page, however often this is asked
  const scene: Promise<DeckView | null> = import("../deck/scene").then((module) => module.mount(target, deck));
  deck.connect(scene);
}

function whenNear(target: Host) {
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      boot(target);
    },
    { rootMargin: "200px" },
  );
  near.observe(target);
}

if (host) {
  const start = () => {
    const later = () => whenNear(host);
    if ("requestIdleCallback" in window) requestIdleCallback(later, { timeout: 2000 });
    else setTimeout(later, 200);
  };
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}
