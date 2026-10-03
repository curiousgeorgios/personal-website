import { expect, test } from "@playwright/test";

// Spec 11: no scene task over 50ms at 4× CPU throttle. Opt-in, because CI's software WebGL is no guide:
//   SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium
// This check currently fails, on two counts: the environment-map step (PMREM generation takes 66 to 75ms at 4×,
// about 18ms unthrottled, before the canvas shows) and headless software rendering's readback. Plan 4 decides
// between precomputing the map and accepting the hitch (see the plan 2 follow-ups); until then a red run here is known.
test("no scene task blocks the main thread for more than 50ms at 4× CPU throttle", async ({ page, browserName }) => {
  test.skip(process.env.SCENE_PERF !== "1", "opt-in: set SCENE_PERF=1");
  test.skip(browserName !== "chromium", "CPU throttling is Chromium-only");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/", { waitUntil: "networkidle" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const tasks: number[] = [];
    (window as unknown as { longTasks: number[] }).longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask" });
  });
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 150_000 });
  await page.locator(".tracks button").first().click();
  await expect.poll(() => page.evaluate(() => window.__deck!.state().playing), { timeout: 60_000 }).toBe(0);
  const tasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  console.log("long tasks (ms)", tasks);
  expect(tasks).toEqual([]);
});
