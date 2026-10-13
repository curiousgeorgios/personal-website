import { expect, test, type Page } from "@playwright/test";
import { ADMIN, openAdmin, unique } from "./admin";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");

const POSTED = (response: { request(): { method(): string } }) => response.request().method() === "POST";

/** Issues a link through the form; returns the address shown and the nonce the form carried */
async function issue(page: Page, note: string) {
  await openAdmin(page);
  const form = page.locator("#link-new");
  const nonce = await form.locator('input[name="nonce"]').inputValue();
  await form.getByLabel("days it works").fill("2");
  await form.getByLabel("note").fill(note);
  const [response] = await Promise.all([page.waitForResponse(POSTED), form.getByRole("button", { name: "issue a link", exact: true }).click()]);
  expect(response.status()).toBe(200);
  await expect(page.locator("#links .notice")).toHaveText("here's the link. copy it now - it can't be shown again.");
  return { url: await page.locator("#issued-link").inputValue(), nonce, response };
}

test("a link is shown once and the same form again makes no second one; revoking it switches it off", async ({ page }) => {
  const note = `e2e ${unique()}`;
  const { url, nonce, response } = await issue(page, note);
  expect(new URL(url).pathname).toBe("/photos/downloads");
  // Shown in this response alone: no redirect, nothing cacheable, and the token is in no address the browser holds
  expect(response.headers().location).toBeUndefined();
  expect(response.headers()["cache-control"]).toBe("no-store");
  const token = new URL(url).searchParams.get("token")!;
  expect(page.url()).not.toContain(token);
  await expect(page.locator("#issued-link")).toHaveAttribute("readonly", "");
  expect((await page.request.get(url)).status()).toBe(200);

  // The same form sent again, as a double tap or a reload would
  const again = await page.request.post(`${ADMIN}/admin/`, { headers: { Origin: ADMIN }, form: { intent: "link.issue", days: "2", note, nonce } });
  expect(again.status()).toBe(200);
  const body = await again.text();
  expect(body).toContain("that link was already made. it's in the list below, but it can't be shown again.");
  expect(body).not.toContain('id="issued-link"');

  await openAdmin(page);
  // A reload of the page (a GET) shows the working link in the list but never its address
  expect(await page.content()).not.toContain(token);
  const row = page.locator("#links li.entry", { hasText: note });
  await expect(row).toHaveCount(1);
  await expect(row.locator("p").first()).toHaveText(new RegExp(`^made \\d{2}\\.\\d{2}\\.\\d{2} · works until \\d{2}\\.\\d{2}\\.\\d{2} · ${note}$`));
  await row.getByLabel("yes, switch this link off").check();
  await row.getByRole("button", { name: "revoke", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=links#links$/);
  await expect(page.locator("#links .notice")).toHaveText("saved - that link no longer works.");
  await expect(page.locator("#links li.entry", { hasText: note })).toHaveCount(0);
  expect((await page.request.get(url)).status()).toBe(403);
});

test("copy puts the link on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ADMIN });
  const { url } = await issue(page, `e2e ${unique()}`);
  await page.getByRole("button", { name: "copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});

test("when the clipboard is refused the whole link is selected, and leaving the page clears it", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("refused")) }, configurable: true });
  });
  const { url } = await issue(page, `e2e ${unique()}`);
  await page.getByRole("button", { name: "copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "selected - copy it from there", exact: true })).toBeVisible();
  expect(await page.locator("#issued-link").evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([0, url.length]);
  // What the back-forward cache sees as the page goes: the link is gone before it is stored
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(page.locator("#issued-link")).toHaveCount(0);
  expect(await page.content()).not.toContain(new URL(url).searchParams.get("token")!);
});
