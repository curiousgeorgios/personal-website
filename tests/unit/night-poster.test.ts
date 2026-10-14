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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

test("an hour that can't be read keeps the day poster, as no JavaScript does", () => {
  vi.spyOn(Date.prototype, "getUTCHours").mockReturnValue(Number.NaN);
  // 21:00 in Sydney is night, so only an unreadable hour can leave the day poster
  expect(posterAt("2026-10-05T10:00:00Z")).toEqual(["/posters/deck-phone.webp", "/posters/deck-desktop.webp", false]);
});

// The script reads Sydney's hour with Date alone (Intl's first use costs a throttled phone about 55ms before first paint).
// Its daylight-saving rule is held to Intl's own time-zone data, the scene's source, through 2035: every hour, and every
// minute of the six hours either side of each change
test("its Sydney hour agrees with Intl's time-zone data at every hour to 2035 and every minute around each clock change", () => {
  const sydney = new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" });
  const offset = (time: number) => (Number(sydney.format(time)) - new Date(time).getUTCHours() + 24) % 24;
  const moments: number[] = [];
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2036, 0, 1);
  for (let time = start; time < end; time += 3_600_000) {
    moments.push(time);
    if (offset(time) !== offset(time + 3_600_000)) for (let minute = time - 6 * 3_600_000; minute < time + 6 * 3_600_000; minute += 60_000) moments.push(minute);
  }
  const changes = moments.filter((time, index) => index > 0 && offset(time) !== offset(moments[index - 1]) && time - moments[index - 1] === 60_000);
  // Two clock changes a year, each pinned to its minute
  expect(changes.length).toBeGreaterThanOrEqual(20);
  const disagreements = moments.filter((time) => {
    const night = Number(sydney.format(time)) < 6 || Number(sydney.format(time)) >= 19;
    return posterAt(new Date(time).toISOString())[2] !== night;
  });
  expect(disagreements.map((time) => new Date(time).toISOString())).toEqual([]);
});
