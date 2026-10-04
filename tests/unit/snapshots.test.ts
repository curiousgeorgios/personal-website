import { expect, test } from "vitest";
import { describeSnapshot } from "../../src/lib/snapshots";

test.each([
  [null, null, "not captured yet"],
  ["ok", "2026-10-04T17:00:12.000Z", "captured 2026-10-05"],
  ["challenge", "2026-10-01T17:00:00.000Z", "a bot check blocked it · last good capture 2026-10-02"],
  ["too-small", null, "the capture came out blank · no good capture yet"],
  ["something-new", null, "something-new · no good capture yet"],
])("%s at %s reads %s", (status, at, expected) => {
  expect(describeSnapshot(status, at)).toBe(expected);
});
