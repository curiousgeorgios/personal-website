import { expect, test, type Page } from "@playwright/test";
import { hasWebGL, settled, SLOW } from "./deck";

// Spec 11 on every run: interaction to next paint under 200ms at 4× CPU and layout shift under 0.01 at phone width.
// INP comes from the Event Timing API (an interaction's latency is its longest event entry), because Lighthouse's
// navigation mode doesn't report it. LCP is Lighthouse's, against the live site after each deploy (scripts/lighthouse.mjs).
test.skip(({ browserName }) => browserName !== "chromium", "CPU throttling and Event Timing through CDP: Chromium only");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "measured locally");

async function throttled(page: Page) {
  await page.goto("/", { waitUntil: "load" });
  // The scene boots in an idle callback once the turntable row is near (long tasks of its own), so let it finish before
  // throttling: the gates measure the interactions, not the boot. Then back to the top, as a visitor starts.
  if (await hasWebGL(page)) {
    await page.locator("[data-deck]").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 45_000 * SLOW });
    await settled(page);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  // The deck builds its audio graph in an idle moment after load; the press is measured once that's done, as a visitor's is
  expect(await page.evaluate(() => !!window.__deck), "a test build (bun run build:test) installs the __deck hook").toBe(true);
  await expect.poll(() => page.evaluate(() => window.__deck!.audio().ready), { timeout: 10_000 * SLOW }).toBe(true);
  await page.evaluate(() => {
    const store = window as unknown as { latencies: Map<number, number> };
    store.latencies = new Map();
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { interactionId?: number })[]) {
        if (entry.interactionId) store.latencies.set(entry.interactionId, Math.max(store.latencies.get(entry.interactionId) ?? 0, entry.duration));
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(500); // let the page settle at the new speed
}

/** Forgets the interactions so far, so the next reading is of the one about to be made */
const forget = (page: Page) => page.evaluate(() => (window as unknown as { latencies: Map<number, number> }).latencies.clear());

/** Interactions the browser has counted so far (Event Timing's interactionCount) */
const interactions = (page: Page) => page.evaluate(() => (performance as unknown as { interactionCount: number }).interactionCount);

/** The slowest interaction so far, once its entries have arrived (after the next paint) */
const slowest = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return Math.max(0, ...(window as unknown as { latencies: Map<number, number> }).latencies.values());
  });

test("opening a label responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  await page.locator('[data-slug="canberra-events"] .peek').click();
  const latency = await slowest(page);
  test.info().annotations.push({ type: "inp", description: `opening a label: ${latency}ms at 4× CPU` });
  expect(latency).toBeLessThan(200);
});

test("showing older log entries responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  await page.locator("#log .more").click();
  const latency = await slowest(page);
  test.info().annotations.push({ type: "inp", description: `showing older entries: ${latency}ms at 4× CPU` });
  expect(latency).toBeLessThan(200);
});

test("pressing play responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  await page.locator(".tracks button").first().click();
  const latency = await slowest(page);
  test.info().annotations.push({ type: "inp", description: `pressing play: ${latency}ms at 4× CPU` });
  expect(latency).toBeLessThan(200);
});

// The click's latency runs to the next paint (the frame's busy state), not to the dialog opening: that waits for the
// 1920 to decode, which is the network's time and not an interaction's.
test("opening the closer look responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  await forget(page);
  const counted = await interactions(page);
  await item.locator(".frame").click();
  const latency = await slowest(page);
  test.info().annotations.push({ type: "inp", description: `opening the closer look: ${latency}ms at 4× CPU` });
  expect(await interactions(page)).toBeGreaterThan(counted); // the click was measured, even if too quick for an entry
  expect(latency).toBeLessThan(200);
  await expect(page.locator("dialog.closer")).toHaveAttribute("open", "");
});

test("nothing shifts while the page settles at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 1500);
      }),
  );
  test.info().annotations.push({ type: "cls", description: `layout shift at 375px: ${cls}` });
  expect(cls).toBeLessThan(0.01);
});

test("fonts are cached for a month, and static files are never sniffed", async ({ request }) => {
  const font = await request.get("/fonts/dm-mono.woff2");
  expect(font.headers()["cache-control"]).toBe("public, max-age=2592000");
  expect(font.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await request.get("/favicon.ico")).headers()["x-content-type-options"]).toBe("nosniff");
});
