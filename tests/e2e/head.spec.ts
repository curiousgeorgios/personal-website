import { expect, test } from "@playwright/test";

test("head carries metadata, preloads two self-hosted fonts and nothing third-party", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => { if (request.resourceType() === "font") fontRequests.push(request.url()); });
  await page.goto("/");
  await expect(page).toHaveTitle("george vlachos");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /does the hard part/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://curiousgeorge.dev/");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f3f2ec");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://curiousgeorge.dev/og.png");
  await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  expect(fontRequests.sort()).toEqual([
    "http://localhost:4331/fonts/dm-mono.woff2",
    "http://localhost:4331/fonts/schibsted-grotesk.woff2",
  ]);
});

test("static files are served", async ({ request }) => {
  expect((await request.get("/robots.txt")).status()).toBe(200);
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /admin");
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /photos/downloads");
  expect((await request.get("/favicon-32x32.png")).status()).toBe(200);
  const manifest = await (await request.get("/site.webmanifest")).json();
  expect(manifest.theme_color).toBe("#f3f2ec");
});
