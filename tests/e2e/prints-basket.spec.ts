import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";
import { PRINTS } from "./prints-site";

// The prints server (4337): prints open, every provider stood in. The print specs run in Chromium (spec 23.2)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

const labels = (page: import("@playwright/test").Page) => page.locator(".row > .label");

test("a photograph's page offers the sizes it prints at, priced, with how delivery works; none while prints are closed", async ({ page }) => {
  const response = await page.goto("/photos/fixture-b-01");
  expect(response?.headers()["cache-control"]).toBe("no-cache");
  await expect(labels(page)).toHaveText(["photo", "prints", "say hi"]);
  const form = page.locator("form#prints");
  await expect(form).toHaveAttribute("action", "/basket");
  await expect(form.locator(".size-choice")).toHaveText([
    "small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed",
    "medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed",
    "large · 16 × 24 in (41 × 61 cm) · $119, or $259 framed",
  ]);
  await expect(form.locator(".frame-choice")).toHaveText(["unframed", "oak frame"]);
  await expect(form.locator(".prints-hint")).toHaveText("delivery is quoted for your address in the basket. prices include no gst; the seller isn't registered for gst.");
  // The same photo on the gallery server, where prints are closed: no row, and the plain intro
  await page.goto(`${GALLERY}/photos/fixture-b-01`);
  await expect(page.locator("form#prints")).toHaveCount(0);
  await page.goto(`${GALLERY}/photos`);
  await expect(page.locator(".intro")).toHaveText("photos i've taken, one entry per instagram post, newest first.");
});

test("a square photo prints small only, and one too small or the wrong shape gets no row", async ({ page }) => {
  await page.goto("/photos/fixture-01");
  await expect(page.locator("form#prints .size-choice")).toHaveText(["small · 10 × 10 in (25 × 25 cm) · $59, or $139 framed"]);
  await page.goto("/photos/fixture-c-01");
  await expect(labels(page)).toHaveText(["photo", "say hi"]);
});

test("while prints are open the gallery's intro and the home page's line say some come as prints", async ({ page }) => {
  await page.goto("/photos");
  await expect(page.locator(".intro")).toHaveText("photos i've taken, one entry per instagram post, newest first. some come as prints.");
  await page.goto("/");
  await expect(page.locator("#photos .body")).toHaveText("photos i've taken, kept like this log. some come as prints.");
});

test("a basket rides through the gallery's links, and those pages are never cached or indexed", async ({ page }) => {
  const response = await page.goto("/photos?items=fixture-b-01:medium:oak");
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["cache-tag"]).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.getByRole("link", { name: "basket · 1 print" })).toHaveAttribute("href", "/basket?items=fixture-b-01:medium:oak");
  await expect(page.locator("a.frame-link").first()).toHaveAttribute("href", "/photos/fixture-01?items=fixture-b-01:medium:oak");
  await page.locator('a.frame-link[href^="/photos/fixture-b-01"]').click();
  await expect(page).toHaveURL(/\/photos\/fixture-b-01\?items=fixture-b-01:medium:oak$/);
  await expect(page.locator('form#prints input[name="items"]')).toHaveValue("fixture-b-01:medium:oak");
  await expect(page.locator('a[rel="next"]')).toHaveAttribute("href", "/photos/fixture-b-02?items=fixture-b-01:medium:oak");
});

test("a basket of nothing valid carries nothing, and the page is still never cached", async ({ page }) => {
  const response = await page.goto("/photos/fixture-b-01?items=nobody-01:small:oak");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.locator(".basket-link")).toHaveCount(0);
  await expect(page.locator('form#prints input[name="items"]')).toHaveCount(0);
});

test("later batches of a carried basket's gallery keep it on their frames", async ({ page }) => {
  await page.goto("/photos?items=fixture-b-01:medium:oak");
  await expect(page.locator("ol.entries > li.entry")).toHaveCount(2);
  // The End key, so the script sees a visitor's scroll even where the fixture's short page can't move
  await page.keyboard.press("End");
  await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
  const links = await page.locator("a.frame-link").evaluateAll((all) => all.map((link) => link.getAttribute("href")));
  expect(links.length).toBeGreaterThan(2);
  for (const href of links) expect(href).toMatch(/^\/photos\/[\w-]+\?items=fixture-b-01:medium:oak$/);
});

// The prints-closed server (4335): a closed site ignores ?items= altogether (spec 16.5), so these are the plain, cached,
// indexable pages, with nothing about prints on them and no basket read
test("with prints closed an items parameter changes nothing: the plain cached gallery and photo pages", async ({ page }) => {
  const items = "?items=fixture-b-01:medium:oak";
  const gallery = await page.goto(`${GALLERY}/photos${items}`);
  expect(gallery?.headers()["cache-control"]).toBe("no-cache");
  expect(gallery?.headers()["cache-tag"]).toContain("photos");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/basket"]')).toHaveCount(0);
  await expect(page.locator(".where")).toHaveText("back to the logbook");
  await expect(page.locator("ol.entries")).not.toHaveAttribute("data-items", /.*/);
  expect(await page.locator('a[href*="items="]').count()).toBe(0);
  const photo = await page.goto(`${GALLERY}/photos/fixture-b-01${items}`);
  expect(photo?.headers()["cache-control"]).toBe("no-cache");
  expect(photo?.headers()["cache-tag"]).toContain("photos");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator(".basket-link")).toHaveCount(0);
  await expect(page.locator("form#prints")).toHaveCount(0);
  expect(await page.locator('a[href*="items="]').count()).toBe(0);
  // Junk is no different
  const junk = await page.goto(`${GALLERY}/photos/fixture-b-01?items=garbage`);
  expect(junk?.headers()["cache-control"]).toBe("no-cache");
});
