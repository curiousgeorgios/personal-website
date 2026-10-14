import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { asTestClient, unique } from "./prints";
import { PHOTO_ACCESS, photoCodeMail } from "./photo-access-site";

// The full sign-in against the real backend (spec 5.2 and 6.3 as amended): George approves an address through the owner's
// route, the person asks for a code, reads it from the email at the mail stand-in, signs in and downloads by the browser's
// session cookie alone. The cookie is always Secure and __Host-, so this runs over HTTPS only, in Chromium and WebKit, with no
// insecure cookie or bypass anywhere. The local HTTPS fixture runs on localhost:4341, using the synthetic mail sink.
// Every address is new, so no limit or approval is shared between runs or browsers.
const SITE = PHOTO_ACCESS;
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local fixture's mail stand-in and Access bypass");
// The fixture's certificate is local and self-signed; the cookie under test is still a real Secure one
test.use({ baseURL: SITE, ignoreHTTPSErrors: true });

const address = () => `e2e-${unique()}@example.com`;
const approve = async (request: APIRequestContext, email: string) => {
  const response = await request.post(`${SITE}/admin/photos/access`, { headers: { Origin: SITE }, data: { email } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { approval: { id: string } }).approval.id;
};
/** The six digits in the newest email to this address; waits for it to arrive */
async function codeFor(email: string): Promise<string> {
  let code = "";
  await expect.poll(async () => {
    const mails = (await photoCodeMail(email)).filter((mail) => JSON.stringify(mail.to).includes(email));
    code = mails.at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? "";
    return code;
  }, { timeout: 15_000 }).toMatch(/^\d{6}$/);
  return code;
}
async function signIn(page: Page, email: string) {
  await page.goto("/photos/downloads");
  await page.getByLabel("email address").fill(email);
  await page.getByRole("button", { name: "send a code" }).click();
  await expect(page.locator("#access-code-sent")).toContainText("if this email address has been approved");
  await page.getByLabel("six-digit code").fill(await codeFor(email));
  await Promise.all([page.waitForURL(`${SITE}/photos/downloads`), page.getByRole("button", { name: "sign in" }).click()]);
  await expect(page.locator(".intro")).toContainText("this browser is signed in until");
}

test("an approved person signs in with the emailed code and downloads the full-resolution jpeg by session alone", async ({ page }) => {
  await asTestClient(page);
  const email = address();
  await approve(page.request, email);
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await signIn(page, email);
  const links = page.locator(".download-list a");
  await expect(links.first()).toHaveText(/^download jpeg · \d+\.\d mb/);
  const href = (await links.first().getAttribute("href"))!;
  expect(href).toMatch(/^\/photos\/downloads\/[\w-]+$/);
  const download = await page.request.get(href);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("image/jpeg");
  // The session is the one cookie: host-only, HttpOnly and Secure, 14 days; nothing in storage or any address
  const cookies = await page.context().cookies(SITE);
  expect(cookies.map((cookie) => [cookie.name, cookie.httpOnly, cookie.secure])).toEqual([["__Host-photo-session", true, true]]);
  expect(cookies[0].expires * 1000 - Date.now()).toBeGreaterThan(13.9 * 86400_000);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length + document.cookie.length)).toBe(0);
  const code = (await photoCodeMail(email)).at(-1)!.text.match(/\b(\d{6})\b/)![1];
  for (const url of urls) expect(url).not.toMatch(new RegExp(`${email.replace(/[.@+]/g, "\\$&")}|${code}|token=`));
  // Signing out ends it here and on the server: the sign-in again, and the file refused
  await Promise.all([page.waitForURL(`${SITE}/photos/downloads`), page.getByRole("button", { name: "sign out" }).click()]);
  await expect(page.getByLabel("email address")).toBeVisible();
  expect((await page.request.get(href)).ok()).toBe(false);
});

test("an address George hasn't approved reads exactly the same and gets no email", async ({ page }) => {
  await asTestClient(page);
  const email = address();
  await page.goto("/photos/downloads");
  await page.getByLabel("email address").fill(email);
  await page.getByRole("button", { name: "send a code" }).click();
  await expect(page.locator("#access-code-sent")).toHaveText("if this email address has been approved, a sign-in code will arrive shortly. it works for 10 minutes, once.");
  await page.waitForTimeout(1000);
  expect(await photoCodeMail(email)).toEqual([]);
  await page.getByLabel("six-digit code").fill("000000");
  await page.getByRole("button", { name: "sign in" }).click();
  await expect(page.locator("#access-code-error")).toHaveText("that code didn't work. it may be mistyped, used or out of date. check it, or send a new one.");
});

test("revoking an address ends its open session at the next request", async ({ page }) => {
  await asTestClient(page);
  const email = address();
  const id = await approve(page.request, email);
  await signIn(page, email);
  const href = (await page.locator(".download-list a").first().getAttribute("href"))!;
  const revoked = await page.request.delete(`${SITE}/admin/photos/access?id=${id}`, { headers: { Origin: SITE } });
  expect(revoked.status()).toBe(200);
  expect((await page.request.get(href)).ok()).toBe(false);
  await page.reload();
  await expect(page.getByLabel("email address")).toBeVisible();
  await expect(page.locator(".download-list")).toHaveCount(0);
});
