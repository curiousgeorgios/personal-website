import { describe, expect, test } from "vitest";
import { CRATE_SIZE, playAngle, slotZ, tiltFor } from "../../src/deck/scene/layout";

describe("crate layout", () => {
  test("records sit 0.33 apart and closer when there are more; up to six always fit inside the crate", () => {
    expect([0, 1, 2, 3].map((i) => +slotZ(i, 4).toFixed(2))).toEqual([0.8, 0.47, 0.14, -0.19]);
    expect(+slotZ(5, 6).toFixed(2)).toBe(-0.5);
    const inside = CRATE_SIZE.depth / 2 - CRATE_SIZE.wall;
    for (const count of [1, 2, 3, 4, 5, 6]) {
      for (let i = 0; i < count; i++) expect(Math.abs(slotZ(i, count))).toBeLessThan(inside);
    }
  });

  test("records in front of the browsed one tip forward; it and those behind lean back (spec 5.4)", () => {
    expect([0, 1, 2, 3].map((j) => +tiltFor(j, 2).toFixed(3))).toEqual([0.72, 0.65, -0.1, -0.112]);
    expect([0, 1, 2, 3].map((j) => +tiltFor(j, 0).toFixed(3))).toEqual([-0.1, -0.112, -0.124, -0.136]);
  });

  test("the stylus meets the lead-in groove part-way round", () => {
    expect(playAngle()).toBeGreaterThan(0.3);
    expect(playAngle()).toBeLessThan(1.2);
  });
});
