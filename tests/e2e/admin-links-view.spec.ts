import { expect, test } from "@playwright/test";
import { openAdmin, unique } from "./admin";

test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");

const POSTED = (response: { request(): { method(): string } }) => response.request().method() === "POST";

// Runs in every project, the phone included: the link is shown once, so it must land on the screen, not above it. Each
// attempt makes its own link with its own note, so it writes nothing another test reads.
test("a newly issued link lands on the screen", async ({ page }) => {
  await openAdmin(page);
  const form = page.locator("#link-new");
  await form.getByLabel("days it works").fill("1");
  await form.getByLabel("note").fill(`e2e view ${unique()}`);
  const [response] = await Promise.all([page.waitForResponse(POSTED), form.getByRole("button", { name: "issue a link", exact: true }).click()]);
  expect(response.status()).toBe(200);
  await expect(page.locator("#links .issued .notice")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#issued-link")).toBeInViewport({ ratio: 1 });
});
