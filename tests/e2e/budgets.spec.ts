import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { SLOW } from "./deck";
import { GALLERY } from "./gallery-site";
import { withGpc } from "./gpc";

/** What a page loads before any interaction: scripts, styles and HTML gzipped, fonts as they are, inline ones counted */
async function weigh(page: Page, path: string) {
  const sizes = { js: 0, css: 0, html: 0, font: 0, fonts: 0 };
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!["script", "stylesheet", "document", "font"].includes(type) || response.status() >= 300) return;
    reads.push(
      response.body().then((body) => {
        if (type === "font") { sizes.font += body.length; sizes.fonts += 1; return; }
        const bytes = gzipSync(body).length;
        if (type === "script") sizes.js += bytes;
        if (type === "stylesheet") sizes.css += bytes;
        if (type === "document") sizes.html += bytes;
      }),
    );
  });
  await page.goto(path, { waitUntil: "networkidle" });
  await Promise.all(reads);
  // Astro inlines small page scripts and every stylesheet into the HTML, so count those too
  const inline = await page.evaluate(() => ({
    js: [...document.querySelectorAll("script:not([src])")].map((s) => s.textContent ?? "").join("\n"),
    css: [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n"),
  }));
  sizes.js += gzipSync(inline.js).length;
  sizes.css += gzipSync(inline.css).length;
  return sizes;
}

test("page weight stays inside the budgets", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  // A short window keeps the turntable out of reach, so this measures only what loads before any interaction;
  // the scene is measured on its own below
  await page.setViewportSize({ width: 1280, height: 400 });
  const sizes = await weigh(page, "/");
  console.log("budgets (bytes)", sizes);
  expect(sizes.js).toBeGreaterThan(0);
  expect(sizes.js).toBeLessThan(10 * 1024);
  expect(sizes.css).toBeLessThan(15 * 1024);
  expect(sizes.html).toBeLessThan(30 * 1024);
  expect(sizes.fonts).toBe(2);
  expect(sizes.font).toBeLessThan(60 * 1024);
});

// Photo gallery spec 10, on the gallery server's photo fixture
for (const path of ["/photos", "/photos/fixture-01"]) {
  test(`${path} stays inside the page budgets, with every script inline`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "measured once, in Chromium");
    test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "measured on the local photo fixture");
    const sizes = await weigh(page, `${GALLERY}${path}`);
    console.log(`budgets for ${path} (bytes)`, sizes);
    expect(sizes.js).toBeGreaterThan(0);
    expect(sizes.js).toBeLessThan(10 * 1024);
    expect(sizes.css).toBeLessThan(15 * 1024);
    expect(sizes.html).toBeLessThan(30 * 1024);
    expect(sizes.fonts).toBe(2);
    await expect(page.locator("script[src]")).toHaveCount(0);
  });
}

// The server page holds two entries and a phone takes only the 240 previews (spec 3.3, ADR-0023), so the first screen
// weighs the same at 1× and at a 3× phone's density. The fixture's four frames weigh about 28KB; the same method on a
// throwaway store with the real catalogue's shape (two entries, 36 frames of noise tuned to real bytes per pixel)
// measured 198KB, against 1235KB before the two changes. Lighthouse doesn't weigh images, so the check on the real
// photographs is this test against the live site once they're published (PLAYWRIGHT_BASE_URL, the guide's after-launch
// steps); it only reads, and sends Global Privacy Control so it never counts as a visit.
for (const scale of [1, 3]) {
  test.describe(`at ${scale}× density`, () => {
    test.use({ deviceScaleFactor: scale });

    test("/photos loads under 250KB of images before any scroll at 375 × 812", async ({ page, browserName, baseURL }) => {
      test.skip(browserName !== "chromium", "measured once, in Chromium");
      const remote = !!process.env.PLAYWRIGHT_BASE_URL;
      if (remote) await withGpc(page);
      await page.setViewportSize({ width: 375, height: 812 });
      let bytes = 0;
      const urls: string[] = [];
      const reads: Promise<void>[] = [];
      page.on("response", (response) => {
        if (response.request().resourceType() !== "image" || response.status() >= 300) return;
        urls.push(response.url());
        reads.push(response.body().then((body) => { bytes += body.length; }));
      });
      // Locally the gallery server's fixture; with PLAYWRIGHT_BASE_URL, the deployed site's real catalogue
      await page.goto(new URL("/photos", remote ? baseURL! : GALLERY).href, { waitUntil: "networkidle" });
      await Promise.all(reads);
      test.skip(remote && urls.length === 0 && (await page.locator("a.frame-link").count()) === 0, "nothing is published on the deployed site yet");
      console.log(`images before any scroll on /photos at 375px, ${scale}× (bytes)`, bytes);
      test.info().annotations.push({ type: "images", description: `${bytes} bytes before any scroll on /photos at 375px, ${scale}×` });
      // Only the 240 previews, at any density: a 480 here is what made a 3× phone load 1235KB
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url).toMatch(/\/240\.(avif|webp)$/);
      expect(bytes).toBeGreaterThan(10 * 1024); // previews are photographs (or the fixture's noise), so a near-empty page means nothing loaded
      expect(bytes).toBeLessThan(250 * 1024);
    });
  });
}

test("the scene chunk stays under 190KB gzipped", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  test.setTimeout(90_000 * SLOW);
  const scripts = new Map<string, Promise<number>>();
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.set(response.url(), response.body().then((body) => gzipSync(body).length));
  });
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/", { waitUntil: "networkidle" });
  const early = new Set(scripts.keys());
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 60_000 * SLOW });
  const late = [...scripts].filter(([url]) => !early.has(url));
  const sizes = await Promise.all(late.map(([, size]) => size));
  console.log("scene (gzipped bytes)", Object.fromEntries(late.map(([url], i) => [new URL(url).pathname, sizes[i]])));
  expect(late.some(([url]) => /\/_astro\/scene\./.test(url))).toBe(true);
  expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(190 * 1024);
});

test("no layout shift while the page settles", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "layout-shift entries are Chromium-only");
  await page.goto("/");
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceEntry[] & { value: number; hadRecentInput: boolean }[]) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 1500);
      }),
  );
  expect(cls).toBeLessThan(0.01);
});
