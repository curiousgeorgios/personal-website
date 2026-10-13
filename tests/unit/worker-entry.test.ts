import { afterEach, expect, test, vi } from "vitest";
import { sqliteD1 } from "./sqlite-d1";

// The adapter's handler imports virtual modules only Astro's build provides; it is stood in here
const handle = vi.hoisted(() => vi.fn());
vi.mock("@astrojs/cloudflare/handler", () => ({ handle }));
vi.mock("./../../src/lib/prints/scheduler", () => ({ PrintScheduler: class {} }));
const run = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/prints/cron", () => ({ runScheduled: run }));
vi.stubGlobal("__TEST_HOOKS__", false);
const worker = (await import("../../src/worker")).default;
const incoming = (url: string) => new Request(url) as Request<unknown, IncomingRequestCfProperties>;

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.stubGlobal("__TEST_HOOKS__", false); });

test("requests go to Astro's handler without starting the private timer", async () => {
  const response = new Response("site");
  handle.mockResolvedValue(response);
  const request = incoming("https://site.test/photos");
  const env = {} as Env;
  const ctx = {} as ExecutionContext;
  expect(await worker.fetch(request, env, ctx)).toBe(response);
  expect(handle).toHaveBeenCalledWith(request, env, ctx);
});

test("an authenticated admin response starts the timer, and a refused admin request does not", async () => {
  const ensureStarted = vi.fn(async () => {});
  const getByName = vi.fn(() => ({ ensureStarted }));
  const env = { PRINT_SCHEDULER: { getByName } } as unknown as Env;
  const waitUntil = vi.fn();
  const ctx = { waitUntil } as unknown as ExecutionContext;
  handle.mockResolvedValue(new Response("denied", { status: 403 }));
  await worker.fetch(incoming("https://site.test/admin"), env, ctx);
  expect(getByName).not.toHaveBeenCalled();
  handle.mockResolvedValue(new Response("admin"));
  await worker.fetch(incoming("https://site.test/admin/"), env, ctx);
  expect(getByName).toHaveBeenCalledWith("prints");
  expect(ensureStarted).toHaveBeenCalledOnce();
  expect(waitUntil).toHaveBeenCalledOnce();
});

test("fixture builds keep alarms off so browser tests drive jobs explicitly", async () => {
  vi.stubGlobal("__TEST_HOOKS__", true);
  handle.mockResolvedValue(new Response("fixture admin"));
  await worker.fetch(incoming("https://site.test/admin"), {} as Env, {} as ExecutionContext);
});

test("a scheduled run records its heartbeat only after the jobs complete", async () => {
  const db = sqliteD1();
  const env = { DB: db, PHOTO_PRINTS: {}, PRINTS_OPEN: "false" } as unknown as Env;
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  await worker.scheduled({} as ScheduledController, env, ctx);
  expect(run).toHaveBeenCalledOnce();
  expect(await db.prepare("SELECT value FROM print_settings WHERE key = 'cron_last_run_at'").first()).not.toBeNull();
  await db.prepare("DELETE FROM print_settings WHERE key = 'cron_last_run_at'").run();
  run.mockRejectedValueOnce(new Error("worker failed"));
  await expect(worker.scheduled({} as ScheduledController, env, ctx)).rejects.toThrow("worker failed");
  expect(await db.prepare("SELECT value FROM print_settings WHERE key = 'cron_last_run_at'").first()).toBeNull();
});
