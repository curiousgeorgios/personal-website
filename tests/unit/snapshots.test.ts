import { expect, test } from "vitest";
import { describeSnapshot, snapshotBase, snapshotVariant, variantBase } from "../../src/lib/snapshots";

test.each([
  [null, null, "not captured yet"],
  ["ok", "2026-10-04T17:00:12.000Z", "captured 2026-10-05"],
  ["challenge", "2026-10-01T17:00:00.000Z", "a bot check blocked it · last good capture 2026-10-02"],
  ["too-small", null, "the capture came out blank · no good capture yet"],
  ["something-new", null, "something-new · no good capture yet"],
  ["ok", "not a date", "captured"],
  [null, "not a date", "not captured yet"],
  ["toString", null, "toString · no good capture yet"],
  ["ok", null, "captured"],
])("%s at %s reads %s", (status, at, expected) => {
  expect(describeSnapshot(status, at)).toBe(expected);
});

test("a capture's files share a base: snapshots/<slug>-<id>, then -<width>.<format>", () => {
  const base = snapshotBase("canberra-events", "01k6d4x3n9e5r2q7w8y0z1a2b3");
  expect(base).toBe("snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3");
  expect(snapshotVariant(base, 480, "avif")).toBe("snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3-480.avif");
  expect(variantBase(snapshotVariant(base, 1920, "webp"))).toBe(base);
  expect(variantBase("snapshots/fixture-digital-nachos-960.webp")).toBe("snapshots/fixture-digital-nachos");
  expect(variantBase("snapshots/readme.txt")).toBeNull();
  expect(variantBase("covers/simple-things.webp")).toBeNull();
  expect(variantBase("snapshots/x-640.webp")).toBeNull();
});
