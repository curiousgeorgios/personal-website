import { expect, type Page, type Response } from "@playwright/test";

// Helpers for the admin specs. They write, so they use the admin server on 4333, whose store is recreated on every run.

export const ADMIN = "http://localhost:4333";

/** A suffix unique to this attempt, so a retried test never collides with what an earlier attempt saved */
export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export async function openAdmin(page: Page) {
  const response = await page.goto(`${ADMIN}/admin/`);
  expect(response?.status()).toBe(200);
}

/** After a save: the redirect lands on the section and says so. Local runs have no cache purge, so they say "within five minutes". */
export async function expectSaved(page: Page, section: string) {
  await expect(page).toHaveURL(new RegExp(`/admin/\\?saved=${section}(&later=1)?#${section}$`));
  await expect(page.locator(`#${section} .notice`)).toHaveText(/^saved - (it's on the logbook now|the logbook shows it within five minutes)\.$/);
}

/** The logbook as a visitor would see it now: a fresh query string misses any cached copy (cache keys include it, spec 6.1) */
export async function openLogbook(page: Page) {
  await page.goto(`${ADMIN}/?fresh=${unique()}`);
}

/** Clicks the button in the element with this id and returns the response to the POST it sends */
export async function submit(page: Page, formId: string, button = "save"): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().startsWith(`${ADMIN}/admin/`)),
    page.locator(`#${formId}`).getByRole("button", { name: button, exact: true }).click(),
  ]);
  return response;
}
