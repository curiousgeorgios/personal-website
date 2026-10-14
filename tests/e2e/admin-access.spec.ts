import { expect, test } from "@playwright/test";
import { ADMIN, openAdmin, unique } from "./admin";

// The admin's downloads section (spec 6.3 as amended), through the owner's route on the admin server
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");

test("approving an address lists it; revoking it asks first, then removes it", async ({ page }) => {
  const email = `e2e-${unique()}@example.com`;
  await openAdmin(page);
  const form = page.locator("#access-new");
  await expect(form.getByLabel("email address")).toBeVisible();
  // Checked before anything is sent
  await form.getByLabel("email address").fill("not an address");
  await form.getByRole("button", { name: "approve", exact: true }).click();
  await expect(page.locator("#access-new-error")).toHaveText("an email address, like name@example.com");
  await form.getByLabel("email address").fill(email);
  await Promise.all([page.waitForURL(`${ADMIN}/admin/?saved=downloads#downloads`), form.getByRole("button", { name: "approve", exact: true }).click()]);
  await expect(page.locator("#downloads .notice")).toHaveText("saved - that address can sign in now.");
  const row = page.locator(".access-admin .entry", { hasText: email });
  await expect(row.locator("p").first()).toHaveText(new RegExp(`^${email.replace(/[.@+]/g, "\\$&")} · approved \\d\\d\\.\\d\\d\\.\\d\\d$`));
  // Unticked, nothing is sent
  await row.getByRole("button", { name: "revoke" }).click();
  await expect(row.locator(".error")).toHaveText("tick the box to revoke it");
  await row.getByLabel("yes, stop this address signing in").check();
  await Promise.all([page.waitForURL(`${ADMIN}/admin/?saved=downloads&note=revoked#downloads`), row.getByRole("button", { name: "revoke" }).click()]);
  await expect(page.locator("#downloads .notice")).toHaveText("saved - that address can't sign in any more.");
  await expect(page.locator(".access-admin .entry", { hasText: email })).toHaveCount(0);
});
