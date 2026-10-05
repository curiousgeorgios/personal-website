import { expect, test } from "@playwright/test";
import { STALL_MS } from "./load";

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
  // Hidden again by a 300ms timer once the drawer has closed, which a loaded machine can run seconds late
  await expect(page.locator("#older-entries")).toHaveAttribute("hidden", "until-found", { timeout: STALL_MS });
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

test("closing, reopening and closing quickly lets the last close finish its animation", async ({ page }) => {
  await page.goto("/");
  const hiddenAfter = await page.locator("#log").evaluate(async (log) => {
    const more = log.querySelector<HTMLButtonElement>(".more")!;
    const older = log.querySelector<HTMLElement>(".older")!;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    more.click();
    await wait(400);
    more.click();
    await wait(100);
    more.click();
    await wait(100);
    more.click();
    const closedAt = performance.now();
    await new Promise<void>((resolve) =>
      new MutationObserver((_records, observer) => {
        if (older.hasAttribute("hidden")) {
          observer.disconnect();
          resolve();
        }
      }).observe(older, { attributes: true }),
    );
    return performance.now() - closedAt;
  });
  expect(hiddenAfter).toBeGreaterThanOrEqual(270);
});
