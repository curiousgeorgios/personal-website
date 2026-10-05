import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { lightFor } from "../../src/deck/scene/lighting";
import { NIGHT_POSTER } from "../../src/scripts/night-poster.mjs";

// Runs the inline script against a picture like the deck's, at a given moment, and returns its two addresses and whether
// it marked the deck as night
function posterAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const element = (tagName: string, name: string, value: string) => {
    const attributes = new Map([[name, value]]);
    return { tagName, getAttribute: (key: string) => attributes.get(key) ?? null, setAttribute: (key: string, next: string) => void attributes.set(key, next) };
  };
  const source = element("SOURCE", "srcset", "/posters/deck-phone.webp");
  const img = element("IMG", "src", "/posters/deck-desktop.webp");
  const deck = element("DIV", "data-deck", "");
  const picture = { querySelectorAll: () => [source, img], parentElement: deck };
  new Function("document", NIGHT_POSTER)({ currentScript: { previousElementSibling: picture } });
  return [source.getAttribute("srcset"), img.getAttribute("src"), deck.getAttribute("data-night") !== null];
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test.each([
  ["2026-10-05T02:00:00Z", false], // 13:00 in Sydney (AEDT)
  ["2026-10-05T07:59:00Z", false], // 18:59
  ["2026-10-05T08:00:00Z", true], // 19:00
  ["2026-10-04T13:30:00Z", true], // 00:30 on the 5th: midnight's hour
  ["2026-10-04T18:59:00Z", true], // 05:59 on the 5th
  ["2026-10-04T19:00:00Z", false], // 06:00
  ["2026-07-01T08:59:00Z", false], // 18:59 in winter (AEST)
  ["2026-07-01T09:00:00Z", true], // 19:00 in winter
])("at %s the night poster is %s, as the scene's own light says", (iso, night) => {
  expect(lightFor(new Date(iso)).mood === "night").toBe(night);
  const suffix = night ? "-night" : "";
  expect(posterAt(iso)).toEqual([`/posters/deck-phone${suffix}.webp`, `/posters/deck-desktop${suffix}.webp`, night]);
});
