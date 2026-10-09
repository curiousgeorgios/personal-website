import { afterEach, expect, test, vi } from "vitest";
import type { PrintDeps } from "../../src/lib/prints/config";
import { cronSteps, daily, runScheduled, runSteps } from "../../src/lib/prints/cron";
import { readSettings, writeSetting } from "../../src/lib/prints/store";
import { captureLogs, fakeFetch, insertOrder, json, NOW, printDb, testDeps } from "./prints-fakes";
import { sqliteD1 } from "./sqlite-d1";

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

test("a daily job runs when its timestamp is over 20 hours old, and records the time only when it is done", async () => {
  const deps = testDeps(sqliteD1());
  const job = vi.fn(async () => true);
  expect(await daily(deps, "fx", job)).toBe(true);
  expect(job).toHaveBeenCalledTimes(1);
  expect((await readSettings(deps.db)).daily.fx).toBe(NOW);
  expect(await daily(testDeps(deps.db, { now: () => NOW + 20 * 3600 - 1 }), "fx", job)).toBe(false);
  expect(job).toHaveBeenCalledTimes(1);
  expect(await daily(testDeps(deps.db, { now: () => NOW + 20 * 3600 }), "fx", job)).toBe(true);
  expect(job).toHaveBeenCalledTimes(2);
  const failing = vi.fn(async () => false);
  expect(await daily(deps, "cleanup", failing)).toBe(false);
  expect((await readSettings(deps.db)).daily.cleanup).toBe(0);
});

test("the real steps say when they did work: a quiet run logs nothing, and one that placed an order or ran a daily job logs one line", async () => {
  const logs = captureLogs();
  const db = await printDb();
  // Every daily job done just now, so only the five-minute work can run
  for (const job of ["fx", "webhook_check", "cleanup", "refund_lookup"]) await writeSetting(db, `daily_${job}_at`, String(NOW), NOW);
  const deps = testDeps(db, { fetch: fakeFetch({}).fetch });
  await runScheduled(deps);
  expect(logs()).not.toContain("prints: cron ran");
  // A paid order due for placing: the attempt fails here (no artelo) and backs off, but the step did work
  await insertOrder(db, { status: "paid", next_attempt_at: NOW });
  await runScheduled(deps);
  expect(vi.mocked(console.log)).toHaveBeenCalledWith("prints: cron ran; placing due orders did work");
  // A daily job that gets done counts too
  vi.mocked(console.log).mockClear();
  const later = testDeps(db, { now: () => NOW + 20 * 3600, fetch: fakeFetch({ "GET https://fx.test/latest": () => json({ date: "2026-10-07", rates: { AUD: 1.5237 } }) }).fetch });
  await db.prepare("UPDATE print_orders SET status = 'refunded'").run();
  await runScheduled(later);
  expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringMatching(/^prints: cron ran; .*exchange rate.* did work$/));
});

test("the cron's exchange-rate step stores the rate; a bad answer counts as done for the day, a failed fetch does not", async () => {
  captureLogs();
  const answering = (handler: () => Response) => testDeps(sqliteD1(), { fetch: fakeFetch({ "GET https://fx.test/latest": handler }).fetch });
  const good = answering(() => json({ date: "2026-10-07", rates: { AUD: 1.5237 } }));
  await runScheduled(good);
  expect(await readSettings(good.db)).toMatchObject({ rate: 1.5237, daily: { fx: NOW } });
  const odd = answering(() => json({ date: "2026-10-07", rates: { AUD: 15 } }));
  await runScheduled(odd);
  expect(await readSettings(odd.db)).toMatchObject({ rate: null, daily: { fx: NOW } });
  const down = answering(() => new Response("down", { status: 503 }));
  await runScheduled(down);
  expect(await readSettings(down.db)).toMatchObject({ rate: null, daily: { fx: 0 } });
  expect(cronSteps(down).map(([name]) => name)).toEqual(["placing due orders", "reconciling checkouts", "unsent emails", "artelo statuses", "exchange rate", "artelo webhook check", "clean-up", "stranded refunds"]);
});
