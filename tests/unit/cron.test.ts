import { afterEach, expect, test, vi } from "vitest";
import { runSteps } from "../../src/lib/prints/cron";

afterEach(() => vi.restoreAllMocks());

test("every step runs in order, and a failing step doesn't stop the rest", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const ran: string[] = [];
  const failed = await runSteps([
    ["first", async () => { ran.push("first"); }],
    ["second", async () => { ran.push("second"); throw new Error("artelo is down"); }],
    ["third", async () => { ran.push("third"); }],
  ]);
  expect(ran).toEqual(["first", "second", "third"]);
  expect(failed).toEqual(["second"]);
  expect(error).toHaveBeenCalledWith("prints: the cron's second step failed", "artelo is down");
});
