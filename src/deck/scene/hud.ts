import type { Deck, DeckState } from "../types";
import type { Preview } from "./journeys";

export interface Hud {
  render(state: DeckState): void;
  /** Shades the button a click on the scene would press */
  hint(action: Preview): void;
  /** Centres the control on the anchor, kept 8px inside the canvas */
  place(x: number, y: number, width: number, height: number): void;
  remove(): void;
}

// The crate control (spec 5.4): previous, play or stop, next. Three fixed columns and the same words in every state,
// so nothing moves whatever it says or whatever is hovered; the icon morphs between play and stop.
export function createHud(host: HTMLElement, deck: Deck): Hud {
  const el = host.ownerDocument.createElement("div");
  el.className = "crate-hud";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "record crate");
  el.innerHTML =
    '<button type="button" class="flip" data-act="prev" aria-label="previous record">‹</button>' +
    '<button type="button" class="now" data-act="play"><span class="ico" aria-hidden="true"></span><span class="t"></span></button>' +
    '<button type="button" class="flip" data-act="next" aria-label="next record">›</button>';
  host.appendChild(el);
  const [prev, now, next] = [...el.querySelectorAll<HTMLButtonElement>("button")];
  const title = now.querySelector<HTMLElement>(".t")!;
  // aria-disabled, not disabled, so focus stays on the arrow
  const usable = (button: HTMLButtonElement) => button.getAttribute("aria-disabled") !== "true";
  const browseBy = (step: number) => deck.browse(deck.getState().browsed + step);

  prev.addEventListener("click", () => {
    if (usable(prev)) browseBy(-1);
  });
  next.addEventListener("click", () => {
    if (usable(next)) browseBy(1);
  });
  now.addEventListener("click", () => deck.toggle(deck.getState().browsed));
  el.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    browseBy(event.key === "ArrowLeft" ? -1 : 1);
  });

  return {
    render(state) {
      const track = deck.tracks[state.browsed];
      const travelling = state.busy && (state.want === state.browsed || state.current === state.browsed);
      const playingThis = !state.busy && state.current === state.browsed && state.want === state.browsed;
      const mode = travelling ? "cueing" : playingThis ? "stop" : "play";
      now.dataset.state = mode;
      title.textContent = track.title;
      now.title = track.title;
      now.setAttribute("aria-label", `${mode} ${track.title}`);
      prev.setAttribute("aria-disabled", String(state.busy || state.browsed === 0));
      next.setAttribute("aria-disabled", String(state.busy || state.browsed === deck.tracks.length - 1));
    },
    hint(action) {
      for (const button of [prev, now, next]) button.classList.toggle("hint", button.dataset.act === action);
    },
    place(x, y, width, height) {
      el.style.setProperty("--deck-w", `${width}px`);
      const left = Math.max(8, Math.min(width - 8 - el.offsetWidth, x - el.offsetWidth / 2));
      const top = Math.max(8, Math.min(height - 8 - el.offsetHeight, y - el.offsetHeight / 2));
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    },
    remove() {
      el.remove();
    },
  };
}
