import { createAudioPort } from "../deck/audio";
import { bindList } from "../deck/list";
import { createDeck } from "../deck/runner";
import type { Deck, DeckTrack } from "../deck/types";

// The deck runner: no Three.js, no dynamic import, inlined into the page, so playback never depends on a hashed
// file or on WebGL (spec 5.1). The scene loader finds the runner on the deck host.
const host = document.querySelector<HTMLElement & { deck?: Deck }>("[data-deck]");
const list = document.querySelector<HTMLElement>(".tracks");
const element = document.querySelector<HTMLAudioElement>("[data-deck-audio]");
const status = document.querySelector<HTMLElement>("[data-deck-status]");

if (host && list && element && status) {
  const tracks: DeckTrack[] = [...list.querySelectorAll<HTMLButtonElement>("button[data-index]")].map((button) => ({
    title: button.dataset.title ?? "",
    artist: button.dataset.artist ?? "",
    src: button.dataset.src ?? "",
    cover: button.dataset.cover ?? "",
  }));
  const deck = createDeck({
    tracks,
    audio: createAudioPort(element),
    announce: (message) => {
      status.textContent = message;
    },
  });
  host.deck = deck;
  bindList(list, deck);
  if (__TEST_HOOKS__) {
    window.__deck = {
      state: () => deck.getState(),
      audio: () => ({
        paused: element.paused,
        src: element.currentSrc ? new URL(element.currentSrc).pathname : (element.getAttribute("src") ?? ""),
        rate: element.playbackRate,
      }),
    };
  }
}
