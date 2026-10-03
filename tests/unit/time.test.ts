import { expect, test } from "vitest";
import { sydneyTime } from "../../src/lib/time";

test("formats Sydney time in lowercase with a non-breaking space", () => {
  // 05:17 UTC on 3 Oct 2026 is 3:17 pm AEST (daylight saving starts on 4 Oct 2026)
  expect(sydneyTime(new Date("2026-10-03T05:17:00Z"))).toBe("3:17 pm");
  expect(sydneyTime(new Date("2026-10-02T23:05:00Z"))).toBe("9:05 am");
});
