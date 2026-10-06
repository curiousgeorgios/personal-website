import { expect, test } from "vitest";
import { sydneyDate, sydneyTime } from "../../src/lib/time";

test("formats Sydney time in lowercase with a non-breaking space", () => {
  // 05:17 UTC on 3 Oct 2026 is 3:17 pm AEST (daylight saving starts on 4 Oct 2026)
  expect(sydneyTime(new Date("2026-10-03T05:17:00Z"))).toBe("3:17 pm");
  expect(sydneyTime(new Date("2026-10-02T23:05:00Z"))).toBe("9:05 am");
});

// Built from its code point so the expected strings can't silently turn into ordinary spaces
const NBSP = String.fromCharCode(160);

test("twelve o'clock reads 12 at noon and just after midnight", () => {
  expect(sydneyTime(new Date("2026-10-03T02:05:00Z"))).toBe(`12:05${NBSP}pm`);
  expect(sydneyTime(new Date("2026-10-02T14:30:00Z"))).toBe(`12:30${NBSP}am`);
});

test("follows daylight saving (AEDT from 4 Oct 2026)", () => {
  expect(sydneyTime(new Date("2026-10-04T05:17:00Z"))).toBe(`4:17${NBSP}pm`);
});

test("today's date in Sydney, which runs ahead of UTC", () => {
  // AEST is UTC+10 until daylight saving starts at 2am on 4 Oct 2026
  expect(sydneyDate(new Date("2026-10-03T13:59:00Z"))).toBe("2026-10-03");
  expect(sydneyDate(new Date("2026-10-03T14:00:00Z"))).toBe("2026-10-04");
  // AEDT is UTC+11
  expect(sydneyDate(new Date("2026-12-31T13:00:00Z"))).toBe("2027-01-01");
});
