import type { TrackProperties } from "../lib/track";
import type { DeckTrack } from "./types";

/**
 * Without JavaScript each track is a link to its MP3, which the browser plays in its own player (spec 4.1). The deck
 * script turns each link into the play button it binds, keeping its data and its words, before anything reads the rows.
 * Both forms share the .pick class and look the same, so the swap can't shift anything.
 */
export function upgradeRows(list: HTMLElement): HTMLButtonElement[] {
  for (const link of [...list.querySelectorAll<HTMLAnchorElement>("a.pick")]) {
    const button = link.ownerDocument.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("class", "pick");
    button.setAttribute("aria-pressed", "false");
    for (const { name, value } of Array.from(link.attributes)) {
      if (name.startsWith("data-")) button.setAttribute(name, value);
    }
    while (link.firstChild) button.appendChild(link.firstChild);
    link.replaceWith(button);
  }
  return [...list.querySelectorAll<HTMLButtonElement>("button[data-index]")];
}

/** A row's record, as the runner plays it */
export const trackOf = (button: HTMLElement): DeckTrack => ({
  title: button.dataset.title ?? "",
  artist: button.dataset.artist ?? "",
  src: button.dataset.src ?? "",
  cover: button.dataset.cover ?? "",
});

/** record_played's properties: the record's id, or none for a row without one, which is still counted */
export function playedProperties(id: string | undefined): TrackProperties {
  const value = Number.parseInt(id ?? "", 10);
  return Number.isNaN(value) ? {} : { record_id: value };
}
