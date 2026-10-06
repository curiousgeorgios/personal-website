import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`layout holds at ${width}px, even with long unbroken words`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-03T05:17:00Z"));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("[data-sydney-time]")).toHaveText("3:17 pm");
    await page.locator("#now .line").first().evaluate((el) => el.append(` ${"x".repeat(120)} https://example.com/${"a".repeat(120)}`));
    await page.locator("#log li span").first().evaluate((el) => el.append(` ${"y".repeat(120)}`));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const label = (await page.locator("#now > .label").boundingBox())!;
    const body = (await page.locator("#now > .body").boundingBox())!;
    if (width < 680) expect(label.y + label.height).toBeLessThanOrEqual(body.y + 1);
    else expect(label.x + label.width).toBeLessThanOrEqual(body.x + 1);
  });
}
