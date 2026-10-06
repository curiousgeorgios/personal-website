import { describe, expect, test } from "vitest";
import { lightFor, sydneyHour } from "../../src/deck/scene/lighting";

describe("light follows the time in Sydney (spec 5.2)", () => {
  test.each([
    ["2026-10-03T02:00:00Z", "day"], // 12:00 AEST
    ["2026-10-03T06:30:00Z", "golden"], // 16:30 AEST
    ["2026-10-03T09:00:00Z", "night"], // 19:00 AEST
    ["2026-10-02T19:59:00Z", "night"], // 05:59 AEST
    ["2026-10-02T20:00:00Z", "day"], // 06:00 AEST
    ["2026-10-04T08:00:00Z", "night"], // 19:00 AEDT; 18:00 if daylight saving were ignored
  ])("%s is %s", (iso, mood) => {
    expect(lightFor(new Date(iso)).mood).toBe(mood);
  });

  test("night has a brighter candle and dimmer room", () => {
    const day = lightFor(new Date("2026-10-03T02:00:00Z"));
    const night = lightFor(new Date("2026-10-03T10:00:00Z"));
    expect(night.candle).toBeGreaterThan(day.candle);
    expect(night.environment).toBeLessThan(day.environment);
  });

  test("the deck's mood holds for the visit: day stays day past 19:00, night stays night past 06:00", () => {
    // Loaded at 18:59 with the day poster, the scene starting at 19:01: golden, the sun at its last angle
    const late = lightFor(new Date("2026-10-05T08:01:00Z"), false);
    expect(late).toMatchObject({ mood: "golden", candle: lightFor(new Date("2026-10-05T07:59:00Z")).candle });
    expect(late.key.position).toEqual([-10, 12, 8]);
    // Loaded at 05:59 with the night poster, the scene starting at 06:01: still night
    expect(lightFor(new Date("2026-10-04T19:01:00Z"), true)).toEqual(lightFor(new Date("2026-10-04T18:59:00Z")));
    // Within the day the light still follows the clock, golden hour included
    expect(lightFor(new Date("2026-10-05T02:00:00Z"), false)).toEqual(lightFor(new Date("2026-10-05T02:00:00Z")));
    expect(lightFor(new Date("2026-10-05T05:30:00Z"), false).mood).toBe("golden");
  });

  test("reads hours in Sydney across daylight saving", () => {
    expect(sydneyHour(new Date("2026-10-03T05:15:00Z"))).toBe(15.25);
    expect(sydneyHour(new Date("2026-10-04T05:15:00Z"))).toBe(16.25);
  });
});
