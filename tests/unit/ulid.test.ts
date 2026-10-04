import { expect, test } from "vitest";
import { ulid } from "../../src/lib/admin/ulid";

const zeros = (count: number) => new Uint8Array(count);

test("is 26 lowercase Crockford characters", () => {
  expect(ulid()).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
});

test("starts with the time, so keys sort by upload time", () => {
  expect(ulid(0, zeros)).toBe("0".repeat(26));
  expect(ulid(1_700_000_000_000, zeros).slice(10)).toBe("0".repeat(16));
  expect(ulid(1_700_000_000_000, zeros) < ulid(1_800_000_000_000, zeros)).toBe(true);
});

test("encodes the timestamp correctly", () => {
  expect(ulid(1, zeros)).toMatch(/^0000000001/);
  expect(ulid(32, zeros)).toMatch(/^0000000010/);
});

test("two ids from the same millisecond differ", () => {
  expect(ulid(5)).not.toBe(ulid(5));
});
