import { afterEach, expect, test, vi } from "vitest";
import { sqliteD1 } from "./sqlite-d1";
import { writeSetting } from "../../src/lib/prints/store";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {
  constructor(protected ctx: DurableObjectState, protected env: Env) {}
} }));
const run = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/prints/cron", () => ({ runScheduled: run }));
vi.stubGlobal("__TEST_HOOKS__", false);
const { PrintScheduler, PRINT_INTERVAL_MS } = await import("../../src/lib/prints/scheduler");

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

function fixture() {
  const db = sqliteD1();
  let alarm: number | null = null;
  const storage = {
    getAlarm: async () => alarm,
    setAlarm: vi.fn(async (next: number) => { alarm = next; }),
    transaction: async (callback: (storage: unknown) => Promise<void>) => callback(storage),
  };
  const ctx = { storage, waitUntil: vi.fn() } as unknown as DurableObjectState;
  const env = { DB: db, PHOTO_PRINTS: {}, PRINTS_OPEN: "false" } as unknown as Env;
  return { db, storage, scheduler: new PrintScheduler(ctx, env), next: () => alarm };
}

test("repeated admin visits preserve the pending alarm, including one already due", async () => {
  const f = fixture();
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  await f.scheduler.ensureStarted();
  expect(f.next()).toBe(1_005_000);
  vi.spyOn(Date, "now").mockReturnValue(2_000_000);
  await f.scheduler.ensureStarted();
  expect(f.next()).toBe(1_005_000);
  expect(f.storage.setAlarm).toHaveBeenCalledOnce();
});

test("the alarm runs missed jobs, stores its actual run and schedules another pass", async () => {
  const f = fixture();
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  await f.scheduler.alarm();
  expect(run).toHaveBeenCalledOnce();
  expect(f.next()).toBe(1_000_000 + PRINT_INTERVAL_MS);
  expect(await f.db.prepare("SELECT value FROM print_settings WHERE key = 'alarm_last_run_at'").first()).toEqual({ value: "1000" });
});

test("a recent cron suppresses duplicate work; its missed next interval is picked up", async () => {
  const f = fixture();
  await writeSetting(f.db, "cron_last_run_at", "1000", 1000);
  vi.spyOn(Date, "now").mockReturnValue(1_000_000 + PRINT_INTERVAL_MS - 1000);
  await f.scheduler.alarm();
  expect(run).not.toHaveBeenCalled();
  vi.spyOn(Date, "now").mockReturnValue(1_000_000 + PRINT_INTERVAL_MS);
  await f.scheduler.alarm();
  expect(run).toHaveBeenCalledOnce();
});

test("an unexpected job failure leaves the next alarm armed and no success heartbeat", async () => {
  const f = fixture();
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  run.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(f.scheduler.alarm()).rejects.toThrow("database unavailable");
  expect(f.next()).toBe(1_000_000 + PRINT_INTERVAL_MS);
  expect(await f.db.prepare("SELECT value FROM print_settings WHERE key = 'alarm_last_run_at'").first()).toBeNull();
});

test("a malformed or future cron timestamp cannot suppress the fallback indefinitely", async () => {
  const f = fixture();
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  for (const value of ["broken", "2000"]) {
    await writeSetting(f.db, "cron_last_run_at", value, 1000);
    await f.scheduler.alarm();
  }
  expect(run).toHaveBeenCalledTimes(2);
});
