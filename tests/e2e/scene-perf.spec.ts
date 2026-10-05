import { expect, test } from "@playwright/test";

// Spec 11: no scene task over 50ms at 4× CPU throttle, except one: generating the environment map, about 70ms at 4×,
// once, before the canvas shows, while the poster is still on screen (ADR-0017). Opt-in, and only meaningful with a GPU:
//   SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium --headed
// CI and headless runs draw WebGL in software, which is no guide, so the spec skips itself there.
type Task = { start: number; duration: number };

test("no scene task blocks the main thread for more than 50ms at 4× CPU, the environment map aside", async ({ page, browserName }) => {
  test.skip(process.env.SCENE_PERF !== "1", "opt-in: set SCENE_PERF=1");
  test.skip(browserName !== "chromium", "CPU throttling is Chromium-only");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/", { waitUntil: "networkidle" });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  });
  test.skip(/swiftshader|llvmpipe/i.test(renderer), "software rendering is no guide");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const tasks: { start: number; duration: number }[] = [];
    (window as unknown as { longTasks: typeof tasks }).longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask" });
  });
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 150_000 });
  await page.locator(".tracks button").first().click();
  await expect.poll(() => page.evaluate(() => window.__deck!.state().playing), { timeout: 60_000 }).toBe(0);
  const { tasks, environment } = await page.evaluate(() => {
    const measure = performance.getEntriesByName("deck:environment", "measure")[0];
    return {
      tasks: (window as unknown as { longTasks: { start: number; duration: number }[] }).longTasks,
      environment: measure ? { start: measure.startTime, duration: measure.duration } : null,
    };
  });
  console.log("long tasks (ms)", tasks.map((task) => Math.round(task.duration)), "environment map (ms)", environment && Math.round(environment.duration));
  expect(environment, "a test build marks the environment map").not.toBeNull();
  const overlaps = (task: Task) => task.start < environment!.start + environment!.duration && task.start + task.duration > environment!.start;
  const atEnvironment = tasks.filter(overlaps);
  expect(tasks.filter((task) => !overlaps(task)).map((task) => Math.round(task.duration))).toEqual([]);
  expect(atEnvironment.length).toBeLessThanOrEqual(1);
  for (const task of atEnvironment) expect(task.duration).toBeLessThan(100);
});
