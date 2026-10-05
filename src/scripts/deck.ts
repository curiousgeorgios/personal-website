import { createAudioPort } from "../deck/audio";
import { bindList } from "../deck/list";
import { playedProperties, trackOf, upgradeRows } from "../deck/rows";
import { createDeck } from "../deck/runner";
import type { Deck } from "../deck/types";
import type { TrackDetail } from "../lib/track";

// The deck runner: no Three.js, no dynamic import, inlined into the page, so playback never depends on a hashed
// file or on WebGL (spec 5.1). The scene loader finds the runner on the deck host.
const host = document.querySelector<HTMLElement & { deck?: Deck }>("[data-deck]");
const list = document.querySelector<HTMLElement>(".tracks");
const element = document.querySelector<HTMLAudioElement>("[data-deck-audio]");
const status = document.querySelector<HTMLElement>("[data-deck-status]");

if (host && list && element && status) {
  // Links to the MP3s in the HTML, play buttons from here on
  const buttons = upgradeRows(list);
  const ids = buttons.map((button) => button.dataset.id);
  const audio = createAudioPort(element);
  // The audio graph is built in an idle moment once the page has loaded, not inside the first press, where it cost about
  // 200ms at 4× CPU. It starts suspended; the press resumes it
  const prepare = () => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => audio.prepare(), { timeout: 2000 });
    else setTimeout(() => audio.prepare(), 200);
  };
  if (document.readyState === "complete") prepare();
  else addEventListener("load", prepare, { once: true });
  const deck = createDeck({
    tracks: buttons.map(trackOf),
    audio,
    // Cleared first and set on the next frame, so a repeated message is announced again
    announce: (message) => {
      status.textContent = "";
      requestAnimationFrame(() => {
        status.textContent = message;
      });
    },
    played: (index) => {
      document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "record_played", properties: playedProperties(ids[index]) } }));
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
        ready: audio.ready,
      }),
    };
  }
}
