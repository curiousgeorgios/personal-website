import { afterEach, expect, test, vi } from "vitest";

// The adapter's handler imports virtual modules only Astro's build provides; it is stood in here
const handle = vi.hoisted(() => vi.fn());
vi.mock("@astrojs/cloudflare/handler", () => ({ handle }));
vi.stubGlobal("__TEST_HOOKS__", false);
const worker = (await import("../../src/worker")).default;

afterEach(() => vi.restoreAllMocks());

test("requests go to Astro's handler", () => {
  expect(worker.fetch).toBe(handle);
});

test("the scheduled event runs the prints cron and says so", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const waited: Promise<unknown>[] = [];
  const env = { DB: {}, PHOTO_PRINTS: {}, PRINTS_OPEN: "false" } as unknown as Env;
  await worker.scheduled({} as ScheduledController, env, { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as unknown as ExecutionContext);
  // Later tasks add steps, which fail here against a stand-in env; the run still finishes and says so
  expect(String(log.mock.calls.at(-1)?.[0])).toMatch(/^prints: cron ran/);
});
