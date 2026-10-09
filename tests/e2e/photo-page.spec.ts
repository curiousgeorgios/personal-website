import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";

// The gallery server's photo fixture: fixture-01 (titled) and fixture-02 are published, fixture-03 is hidden
test.use({ baseURL: GALLERY });

test("an untitled photo's page is headed by its date and place, and walks its post's published photos", async ({ page }) => {
  const response = await page.goto("/photos/fixture-02");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-cache");
  expect(response?.headers()["cache-tag"]).toContain("photos");
  await expect(page).toHaveTitle("27.09.26 · bondi, sydney · photos · george vlachos");
  await expect(page.locator("h1")).toHaveText("27.09.26 · bondi, sydney");
  await expect(page.locator(".photo-nav")).toHaveText("photo 2 of 2 · previous · the whole entry");
  await expect(page.getByRole("link", { name: "previous" })).toHaveAttribute("href", "/photos/fixture-01");
  await expect(page.getByRole("link", { name: "next", exact: true })).toHaveCount(0);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "a photo by george vlachos from 27 september 2026, bondi, sydney.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://curiousgeorge.dev/photos/fixture-02");
  const img = page.locator(".photo img");
  await expect(img).toHaveAttribute("alt", "photo 2 of 2 from 27 september 2026, bondi, sydney");
  await expect(img).toHaveAttribute("fetchpriority", "high");
  await expect(img).toHaveAttribute("width", "1600");
  await expect(img).toHaveAttribute("height", "1600");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\/curiousgeorge\.dev\/media\/photos\/previews\/fixture-02\/[a-f0-9]{64}\/1600\.webp$/);
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1600");
  await expect(page.locator("#say-hi")).toBeVisible();
});

test("a titled photo leads with its title, with its date and place under it", async ({ page }) => {
  await page.goto("/photos/fixture-01");
  await expect(page).toHaveTitle("a test photograph · photos · george vlachos");
  await expect(page.locator("h1")).toHaveText("a test photograph");
  await expect(page.locator(".photo-page .where")).toHaveText("27.09.26 · bondi, sydney");
  await expect(page.locator(".photo-nav")).toHaveText("photo 1 of 2 · next · the whole entry");
  await expect(page.getByRole("link", { name: "next", exact: true })).toHaveAttribute("href", "/photos/fixture-02");
  await expect(page.locator(".photo img")).toHaveAttribute("alt", "a test photograph");
});

test("a portrait fits the viewport, its box known before it loads", async ({ page }) => {
  await page.route((url) => url.pathname.startsWith("/media/photos/"), () => {});
  await page.goto("/photos/fixture-b-01", { waitUntil: "domcontentloaded" });
  const viewport = page.viewportSize()!;
  const box = (await page.locator(".photo img").boundingBox())!;
  expect(box.height).toBeGreaterThan(0);
  expect(box.height).toBeLessThanOrEqual(Math.ceil(viewport.height * 0.82) + 1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the whole entry opens the gallery at this photo's post", async ({ page }) => {
  await page.goto("/photos/fixture-01");
  await page.getByRole("link", { name: "the whole entry" }).click();
  await expect(page).toHaveURL(/\/photos\?before=1790497801#post-fixture$/);
  await expect(page.locator("ol.entries > li.entry").first()).toHaveAttribute("id", "post-fixture");
});

test("a hidden, unknown or malformed photo is the notebook 404, uncached", async ({ page }) => {
  for (const id of ["fixture-03", "nobody-01", "not%20an%20id"]) {
    const response = await page.goto(`/photos/${id}`);
    expect(response?.status()).toBe(404);
    expect(response?.headers()["cache-control"]).toBe("no-store");
    await expect(page.locator("main")).toContainText("nothing written on this page.");
  }
});

test("when D1 fails the photo page says so with a 503 that is never cached", async ({ page }) => {
  const response = await page.goto("http://localhost:4332/photos/fixture-01");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.locator(".down")).toHaveText("photos aren't loading right now. try again in a bit.");
});
