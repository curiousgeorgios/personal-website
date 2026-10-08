import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";

// The gallery on the gallery server's photo fixture (spec 11.3), which no spec changes: six posts, newest first, four to a page
test.use({ baseURL: GALLERY });

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the first page lists four entries, newest first, with dated headings and numbered frames", async ({ page }) => {
    const response = await page.goto("/photos");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("no-cache");
    expect(response?.headers()["cache-tag"]).toContain("photos");
    await expect(page).toHaveTitle("photos · george vlachos");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "photos george vlachos has taken, one entry per instagram post.");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://curiousgeorge.dev/photos");
    await expect(page.locator(".row > .label")).toHaveText(["photos of", "entries"]);
    expect(await page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id))).toEqual(["post-fixture", "post-fixture-b", "post-fixture-c", "post-fixture-d"]);
    await expect(page.locator("#post-fixture .entry-head")).toHaveText("27.09.26 · bondi, sydney");
    await expect(page.locator("#post-fixture .entry-head time")).toHaveAttribute("datetime", "2026-09-27");
    await expect(page.locator("#post-fixture-b .entry-head")).toHaveText("14.06.26");
    // fixture-03 is hidden: two frames, each showing its slide number
    await expect(page.locator("#post-fixture .frame-no")).toHaveText(["01", "02"]);
    await expect(page.locator("#post-fixture a.frame-link").first()).toHaveAttribute("href", "/photos/fixture-01");
    await expect(page.locator("#post-fixture img").first()).toHaveAttribute("alt", "a test photograph");
    await expect(page.locator("#post-fixture img").nth(1)).toHaveAttribute("alt", "photo 2 of 2 from 27 september 2026, bondi, sydney");
    await expect(page.locator("#post-fixture-b img").first()).toHaveAttribute("alt", "photo 1 of 2 from 14 june 2026");
  });

  test("frames know their size before any preview arrives: 120px tall, 88px on a phone", async ({ page }) => {
    // Hold every preview, so only the width and height attributes can size the frames
    await page.route((url) => url.pathname.startsWith("/media/photos/"), () => {});
    await page.goto("/photos", { waitUntil: "domcontentloaded" });
    const height = page.viewportSize()!.width < 680 ? 88 : 120;
    const portrait = page.locator("#post-fixture-b img").first(); // 4000 × 6000
    const landscape = page.locator("#post-fixture-b img").nth(1); // 6000 × 4000
    const box = (await portrait.boundingBox())!;
    expect(Math.round(box.height)).toBe(height);
    expect(Math.round(box.width)).toBe(Math.round((height * 2) / 3));
    expect(Math.round((await landscape.boundingBox())!.width)).toBe(Math.round((height * 3) / 2));
    await expect(portrait).toHaveAttribute("sizes", "(max-width: 679px) 59px, 80px");
    await expect(landscape).toHaveAttribute("sizes", "(max-width: 679px) 132px, 180px");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("only the first entry's first row loads eagerly, its first frame with high priority", async ({ page }) => {
    await page.goto("/photos");
    const loading = await page.locator("ol.entries img").evaluateAll((all) => all.map((img) => [img.getAttribute("loading"), img.getAttribute("fetchpriority")]));
    expect(loading).toEqual([["eager", "high"], ["eager", null], ["lazy", null], ["lazy", null], ["lazy", null], ["lazy", null]]);
  });

  test("older entries is a plain link to a noindex page that ends the list", async ({ page }) => {
    await page.goto("/photos");
    const more = page.locator("a.more");
    await expect(more).toHaveText("older entries");
    await expect(more).toHaveAttribute("href", "/photos?before=1766610000");
    await more.click();
    await expect(page).toHaveURL(/\/photos\?before=1766610000$/);
    expect(await page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id))).toEqual(["post-fixture-e", "post-fixture-f"]);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "newest entries" })).toHaveAttribute("href", "/photos");
  });

  test("a cursor older than every post says that's every entry; a malformed one is the notebook 404", async ({ page }) => {
    const response = await page.goto("/photos?before=1");
    expect(response?.status()).toBe(200);
    await expect(page.locator("ol.entries > li")).toHaveCount(0);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator(".empty")).toHaveCount(0);
    for (const cursor of ["abc", "-1", "12345678901", "1.5"]) {
      const refused = await page.goto(`/photos?before=${cursor}`);
      expect(refused?.status()).toBe(404);
      expect(refused?.headers()["cache-control"]).toBe("no-store");
      await expect(page.locator("main")).toContainText("nothing written on this page.");
    }
  });
});

test("when D1 fails the gallery says so with a 503 that is never cached", async ({ page }) => {
  const response = await page.goto("http://localhost:4332/photos");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["cache-tag"]).toBeUndefined();
  await expect(page.locator(".down")).toHaveText("photos aren't loading right now. try again in a bit.");
});

test("the gallery works under the CSP, with every script inline", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto("/photos", { waitUntil: "networkidle" });
  await expect(page.locator("script[src]")).toHaveCount(0);
  expect(violations).toEqual([]);
});
