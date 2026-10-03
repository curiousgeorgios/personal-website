import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

test("page weight stays inside the budgets", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  // A short window keeps the turntable out of reach, so this measures only what loads before any interaction;
  // the scene is measured on its own below
  await page.setViewportSize({ width: 1280, height: 400 });
  const sizes = { js: 0, css: 0, html: 0, font: 0 };
  let fonts = 0;
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!["script", "stylesheet", "document", "font"].includes(type) || response.status() >= 300) return;
    reads.push(
      response.body().then((body) => {
        if (type === "font") { sizes.font += body.length; fonts += 1; return; }
        const bytes = gzipSync(body).length;
        if (type === "script") sizes.js += bytes;
        if (type === "stylesheet") sizes.css += bytes;
        if (type === "document") sizes.html += bytes;
      }),
    );
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await Promise.all(reads);
  // Astro inlines small page scripts and every stylesheet into the HTML, so count those too
  const inline = await page.evaluate(() => ({
    js: [...document.querySelectorAll("script:not([src])")].map((s) => s.textContent ?? "").join("\n"),
    css: [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n"),
  }));
  sizes.js += gzipSync(inline.js).length;
  sizes.css += gzipSync(inline.css).length;
  console.log("budgets (bytes)", sizes);
  expect(sizes.js).toBeGreaterThan(0);
  expect(sizes.js).toBeLessThan(10 * 1024);
  expect(sizes.css).toBeLessThan(15 * 1024);
  expect(sizes.html).toBeLessThan(30 * 1024);
  expect(fonts).toBe(2);
  expect(sizes.font).toBeLessThan(60 * 1024);
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
