import { expect, test } from "@playwright/test";

test("when D1 fails the page still renders, uncached, with only the static sections", async ({ page }) => {
  const response = await page.goto("http://localhost:4332/");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["cache-tag"]).toBeUndefined();
  await expect(page.locator(".row > .label")).toHaveText(["logbook of", "say hi", "visitor info"]);
});
