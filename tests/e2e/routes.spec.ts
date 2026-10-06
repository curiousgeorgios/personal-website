import { expect, test } from "@playwright/test";

test("/ig redirects home with UTM tags", async ({ request }) => {
  const response = await request.get("/ig", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe("/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link");
});

test("the old job page is retired", async ({ request }) => {
  const response = await request.get("/jobs/video-editor", { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()["location"]).toBe("/");
});

test("query strings from Instagram still get the logbook", async ({ page }) => {
  const response = await page.goto("/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link&fbclid=abc123");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("george vlachos");
});

test("unknown pages get the notebook 404, uncached", async ({ page }) => {
  const response = await page.goto("/nothing-here");
  expect(response?.status()).toBe(404);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.locator("main")).toContainText("nothing written on this page.");
  await expect(page.getByRole("link", { name: "back to the logbook" })).toHaveAttribute("href", "/");
});

test("security headers and a CSP are present", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  // Astro sends its CSP as a header for on-demand pages, so there is no <meta> CSP
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toMatch(/script-src 'self'( 'sha256-[^']+')+/);
  expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
  await expect(page.locator('meta[http-equiv="content-security-policy"]')).toHaveCount(0);
});

test("pages work under the CSP with no violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto("/");
  await page.locator('[data-slug="canberra-events"] .peek').click();
  await page.locator("#log .more").click();
  await expect(page.locator("[data-sydney-time]")).toHaveText(/\d/);
  await page.goto("/nothing-here");
  await expect(page.getByRole("link", { name: "back to the logbook" })).toBeVisible();
  expect(violations).toEqual([]);
});
