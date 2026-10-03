import type { Deck, DeckState } from "./types";

const label = (state: DeckState, index: number) =>
  state.failed === index ? "couldn't play" : state.playing === index ? "playing · stop" : state.want === index ? "cueing" : "play";

// The track list works without the scene and mirrors it when there is one (spec 5.4)
export function bindList(list: HTMLElement, deck: Deck): void {
  const buttons = [...list.querySelectorAll<HTMLButtonElement>("button[data-index]")];

  function render(state: DeckState) {
    buttons.forEach((button, index) => {
      const row = button.parentElement;
      row?.classList.toggle("on", state.want === index);
      row?.classList.toggle("browsed", state.scene && state.browsed === index);
      row?.classList.toggle("failed", state.failed === index);
      button.setAttribute("aria-pressed", String(state.want === index));
      const st = button.querySelector(".st");
      const text = label(state, index);
      if (st && st.textContent !== text) st.textContent = text;
    });
  }

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => deck.toggle(index));
    // Hovering or focusing a row shows that record in the crate
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") deck.browse(index);
    });
    button.addEventListener("focus", () => deck.browse(index));
  });
  deck.subscribe(render);
  render(deck.getState());
}
