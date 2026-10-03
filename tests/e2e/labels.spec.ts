import { expect, test } from "@playwright/test";

test("clicking a labelled line opens its label in place; Esc closes and returns focus", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const pill = item.locator(".peek");
  const drawer = page.locator("#label-canberra-events");
  await expect(drawer).toHaveAttribute("hidden", "until-found");
  await item.locator(".aside").click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).not.toHaveAttribute("hidden", /.*/);
  await expect(drawer.locator(".made")).toBeVisible();
  await pill.focus();
  await page.keyboard.press("Escape");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect(pill).toBeFocused();
  await expect(drawer).toHaveAttribute("hidden", "until-found");
});

test("the pill toggles with the keyboard and several labels can be open", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-slug="digital-nachos"] .peek').press("Enter");
  await page.locator('[data-slug="linear-gratis"] .peek').press("Enter");
  await expect(page.locator(".line-item.open")).toHaveCount(2);
});

test("a same-frame open and close leaves the label closed and unstyled", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.evaluate((el) => {
    const line = el.querySelector<HTMLElement>(".line")!;
    line.click();
    line.click();
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(item.locator(".peek")).toHaveAttribute("aria-expanded", "false");
  await expect(item).not.toHaveClass(/\bopen\b/);
});

test("links inside a labelled line navigate instead of toggling", async ({ page }) => {
  await page.goto("/");
  const link = page.locator('[data-slug="canberra-events"] a');
  await expect(link).toHaveAttribute("href", "https://canberra.events");
  await page.route("https://canberra.events/**", (route) => route.fulfill({ body: "ok" }));
  await link.click();
  await expect(page).toHaveURL("https://canberra.events/");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("label contents stay in the page for find-in-page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#label-canberra-events")).toHaveAttribute("hidden", "until-found");
    await expect(page.locator("#label-canberra-events .made")).toHaveCount(1);
  });
});
