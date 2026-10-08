import { afterEach, expect, test, vi } from "vitest";
import type { PrintDeps } from "../../src/lib/prints/config";
import { runScheduled, runSteps } from "../../src/lib/prints/cron";

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

test("a run logs only when a step did something or failed", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const deps = {} as PrintDeps;
  await runScheduled(deps, []);
  await runScheduled(deps, [["placing", async () => 0], ["mailing", async () => undefined]]);
  expect(log).not.toHaveBeenCalled();
  await runScheduled(deps, [["placing", async () => 2], ["mailing", async () => 0]]);
  expect(log).toHaveBeenLastCalledWith("prints: cron ran; placing did work");
  await runScheduled(deps, [["placing", async () => 2], ["polling", async () => { throw new Error("artelo is down"); }]]);
  expect(log).toHaveBeenLastCalledWith("prints: cron ran; polling failed");
});
