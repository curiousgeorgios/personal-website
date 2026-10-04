import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectSaved, openAdmin, openLogbook, submit, unique } from "./admin";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");
// The tests share one entry, so they run in order
test.describe.configure({ mode: "serial" });

const u = unique();
const text = `shipped the admin page ${u}.`;
const entry = (page: Page) => page.locator("#log .entry", { hasText: text });

test("adds an entry, dated today in Sydney unless changed, newest first on the logbook", async ({ page }) => {
  await openAdmin(page);
  await expect(page.locator("#log-new-date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.locator("#log-new-date").fill("2030-06-15");
  await page.locator("#log-new-text").fill(text);
  expect((await submit(page, "log-new", "add")).status()).toBe(303);
  await expectSaved(page, "log");
  await expect(entry(page).locator("summary .when")).toHaveText("2030-06-15");

  await openLogbook(page);
  const shown = page.locator("#log li", { hasText: text });
  await expect(shown.locator("time")).toHaveText("15.06.30");
  // 2030 is later than anything seeded or saved by another spec, so it leads the list
  await expect(page.locator("#log .log > ul > li").first()).toContainText(text);
  await expect(page.locator(".where")).toContainText("last entry 15.06.30");
});

test("edits it to month precision, stored as the first of the month", async ({ page }) => {
  await openAdmin(page);
  await entry(page).locator("summary").click();
  await entry(page).getByLabel("shown as", { exact: true }).selectOption("month");
  await entry(page).getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "log");
  await expect(entry(page).locator("summary .when")).toHaveText("2030-06");
  await entry(page).locator("summary").click();
  await expect(entry(page).getByLabel("date", { exact: true })).toHaveValue("2030-06-01");

  await openLogbook(page);
  await expect(page.locator("#log li", { hasText: text }).locator("time")).toHaveText("jun 30");
});

test("a date that doesn't exist is refused, keeping what was typed", async ({ page }) => {
  // A date input can't hold 2026-02-30, so this posts what a hand-made request would
  const response = await page.request.post(`${ADMIN}/admin/`, {
    form: { intent: "log.create", date: "2026-02-30", precision: "day", text: `leap ${u}` },
    headers: { Origin: ADMIN },
  });
  expect(response.status()).toBe(422);
  const html = await response.text();
  expect(html).toContain("a real date, like 2026-10-04");
  expect(html).toContain(`leap ${u}`);
  await openAdmin(page);
  await expect(page.locator("#log .entry", { hasText: `leap ${u}` })).toHaveCount(0);
});

test("removing an entry needs the box ticked", async ({ page }) => {
  await openAdmin(page);
  await entry(page).locator("summary").click();
  await entry(page).getByLabel("yes, remove this entry", { exact: true }).check();
  await entry(page).getByRole("button", { name: "remove", exact: true }).click();
  await expectSaved(page, "log");
  await expect(entry(page)).toHaveCount(0);
});
