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
