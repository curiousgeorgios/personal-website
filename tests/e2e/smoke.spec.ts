import { expect, test } from "@playwright/test";

test("home responds with the logbook shell", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-AU");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("george vlachos");
});
