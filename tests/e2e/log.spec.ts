import { expect, test } from "@playwright/test";

test("older entries expand and collapse", async ({ page }) => {
  await page.goto("/");
  const more = page.locator("#log .more");
  await expect(page.locator("#log .log > ul > li")).toHaveCount(3);
  await expect(page.locator("#older-entries")).toHaveAttribute("hidden", "until-found");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(more.locator(".lbl")).toHaveText("fewer entries");
  await expect(page.locator("#older-entries li").first()).toBeVisible();
  await more.click();
  await expect(more.locator(".lbl")).toHaveText("older entries");
  await expect(page.locator("#older-entries")).toHaveAttribute("hidden", "until-found");
});

test("a same-frame open and close leaves the log closed and unstyled", async ({ page }) => {
  await page.goto("/");
  await page.locator("#log .more").evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.locator("#log .more")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#log .log")).not.toHaveClass(/\bopen\b/);
});
