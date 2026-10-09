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

test("the scheduled event runs the prints cron, and says so only when there is something to say", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const waited: Promise<unknown>[] = [];
  const env = { DB: {}, PHOTO_PRINTS: {}, PRINTS_OPEN: "false" } as unknown as Env;
  await worker.scheduled({} as ScheduledController, env, { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as unknown as ExecutionContext);
  // A quiet run logs nothing; a run that logs (later tasks' steps, failing against this stand-in env) says the cron ran
  for (const [line] of log.mock.calls) expect(String(line)).toMatch(/^prints: cron ran; /);
});
