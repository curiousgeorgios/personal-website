import { expect, test, type Page, type Route } from "@playwright/test";
import { GALLERY } from "./gallery-site";

// The downloads page's sign-in as a visitor works it (spec 5.2 as amended), on the gallery server. The two JSON routes are
// answered here, so these check the page's own behaviour whatever the backend does; photo-access-session.spec.ts runs the
// real flow. A browser with no session always gets this sign-in.
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "answers the sign-in's routes itself, on the local gallery server");

const PAGE = `${GALLERY}/photos/downloads`;
const SENT = "if this email address has been approved, a sign-in code will arrive shortly. it works for 10 minutes, once.";

interface Sent { method: string; path: string; body: unknown; origin: string | undefined; contentType: string | undefined }

/** Answers the sign-in's routes: each answer is [status, json, headers], taken in turn per route; records what was sent */
async function answer(page: Page, routes: Record<string, [number, unknown, Record<string, string>?][]>) {
  const sent: Sent[] = [];
  await page.route(/\/api\/photos\/access\/(code|session)$/, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    sent.push({ method: request.method(), path, body: request.postDataJSON?.() ?? null, origin: request.headers().origin, contentType: request.headers()["content-type"] });
    const [status, json, headers = {}] = routes[`${request.method()} ${path}`]?.shift() ?? [500, { error: "unexpected" }];
    await route.fulfill({ status, contentType: "application/json", headers, body: json === null ? "" : JSON.stringify(json) });
  });
  return sent;
}

const codeAccepted: [number, unknown] = [202, { message: "If this email address has been approved, a sign-in code will arrive shortly.", expiresIn: 600, resendAfter: 60 }];

test("from the keyboard: an address, then the code, with every message said and nothing in the URL or storage", async ({ page }) => {
  const sent = await answer(page, {
    "POST /api/photos/access/code": [codeAccepted],
    "POST /api/photos/access/session": [[403, { error: "Invalid code." }], [200, { authenticated: true, expiresAt: 1793158200 }]],
  });
  await page.goto(PAGE);
  await expect(page.locator("noscript")).toHaveCount(1);
  await expect(page.locator("#access-code")).toBeHidden();
  await page.getByLabel("email address").focus();
  await page.keyboard.type("Mum@Example.com ");
  await page.keyboard.press("Enter");
  // The code step takes the focus, says what happens next and starts the resend's 60 seconds
  await expect(page.getByLabel("six-digit code")).toBeFocused();
  await expect(page.locator("#access-code-sent")).toHaveText(SENT);
  await expect(page.locator("[data-resend]")).toBeDisabled();
  await expect(page.locator("[data-resend]")).toHaveText(/^send a new code in (60|59)s$/);
  await expect(page.locator("#access-email")).toBeHidden();
  // A wrong code is said without saying why, and the field is ready to retype
  await page.keyboard.type("12 34 56");
  await expect(page.getByLabel("six-digit code")).toHaveValue("123456");
  await page.keyboard.press("Enter");
  await expect(page.locator("#access-code-error")).toHaveText("that code didn't work. it may be mistyped, used or out of date. check it, or send a new one.");
  await expect(page.getByLabel("six-digit code")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("six-digit code")).toBeFocused();
  await page.keyboard.type("654321");
  // Signed in: the page loads again for the server to render this browser's list
  await Promise.all([page.waitForEvent("framenavigated"), page.keyboard.press("Enter")]);
  expect(sent.map(({ method, path, body }) => [method, path, body])).toEqual([
    ["POST", "/api/photos/access/code", { email: "Mum@Example.com" }],
    ["POST", "/api/photos/access/session", { code: "123456" }],
    ["POST", "/api/photos/access/session", { code: "654321" }],
  ]);
  // Every write is JSON with a real origin (never null), so the server's Origin check holds under the page's no-referrer policy
  for (const write of sent) expect([write.origin, write.contentType]).toEqual([GALLERY, "application/json"]);
  expect(page.url()).toBe(PAGE);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length + document.cookie.length)).toBe(0);
});

test("the resend waits as asked, and too many requests say how long to wait", async ({ page }) => {
  await page.clock.install();
  const sent = await answer(page, {
    "POST /api/photos/access/code": [codeAccepted, [429, { error: "Too many." }, { "Retry-After": "120" }]],
  });
  await page.goto(PAGE);
  await page.getByLabel("email address").fill("mum@example.com");
  await page.getByRole("button", { name: "send a code" }).click();
  await expect(page.locator("[data-resend]")).toHaveText("send a new code in 60s");
  await page.clock.runFor(60_000);
  await expect(page.locator("[data-resend]")).toBeEnabled();
  await expect(page.locator("[data-resend]")).toHaveText("send a new code");
  await page.locator("[data-resend]").click();
  await expect(page.locator("#access-code-error")).toHaveText("that's a lot of codes in a short time. try again in 2 minutes.");
  await expect(page.locator("[data-resend]")).toHaveText("send a new code in 120s");
  // The resend sends the address from the first step again: it was never kept anywhere but the script's memory
  expect(sent.map((write) => write.body)).toEqual([{ email: "mum@example.com" }, { email: "mum@example.com" }]);
});

test("a mistyped address is caught before anything is sent, and another address can be used", async ({ page }) => {
  const sent = await answer(page, { "POST /api/photos/access/code": [codeAccepted, [503, { error: "down" }]] });
  await page.goto(PAGE);
  await page.getByLabel("email address").fill("not an address");
  await page.getByRole("button", { name: "send a code" }).click();
  await expect(page.locator("#access-email-error")).toHaveText("type the email address george approved.");
  await expect(page.getByLabel("email address")).toBeFocused();
  expect(sent).toEqual([]);
  await page.getByLabel("email address").fill("mum@example.com");
  await page.getByRole("button", { name: "send a code" }).click();
  await page.getByRole("button", { name: "use a different address" }).click();
  await expect(page.getByLabel("email address")).toBeFocused();
  await expect(page.locator("#access-code")).toBeHidden();
  await page.getByLabel("email address").fill("dad@example.com");
  await page.getByRole("button", { name: "send a code" }).click();
  await expect(page.locator("#access-email-error")).toHaveText("signing in isn't working right now. try again in a bit.");
});

test("while a request is out the restart and resend wait, so another address can't race it", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const sent: unknown[] = [];
  await page.route(/\/api\/photos\/access\/code$/, async (route) => {
    sent.push(route.request().postDataJSON());
    if (sent.length === 2) await held;
    await route.fulfill({ status: sent.length === 2 ? 429 : 202, contentType: "application/json", headers: { "Retry-After": "120" }, body: JSON.stringify(codeAccepted[1]) });
  });
  await page.clock.install();
  await page.goto(PAGE);
  await page.getByLabel("email address").fill("mum@example.com");
  await page.getByRole("button", { name: "send a code" }).click();
  await expect(page.getByLabel("six-digit code")).toBeVisible();
  await expect(page.locator("[data-resend]")).toHaveText("send a new code in 60s");
  await page.clock.runFor(60_000);
  // The resend is out: neither it nor the restart can be used until it answers
  await page.locator("[data-resend]").click();
  await expect(page.locator("[data-restart]")).toBeDisabled();
  await expect(page.locator("[data-resend]")).toBeDisabled();
  await expect(page.locator("#access-code")).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.locator("#access-code-error")).toHaveText("that's a lot of codes in a short time. try again in 2 minutes.");
  await expect(page.locator("[data-restart]")).toBeEnabled();
  await page.locator("[data-restart]").click();
  await expect(page.getByLabel("email address")).toBeFocused();
  await expect(page.locator("[data-resend]")).toHaveText("send a new code");
  expect(sent).toEqual([{ email: "mum@example.com" }, { email: "mum@example.com" }]);
});

test("a page the back-forward cache brings back starts again at the address, with no countdown left", async ({ page }) => {
  await answer(page, { "POST /api/photos/access/code": [codeAccepted] });
  await page.goto(PAGE);
  await page.getByLabel("email address").fill("mum@example.com");
  await page.getByRole("button", { name: "send a code" }).click();
  await expect(page.locator("[data-resend]")).toHaveText(/^send a new code in \d+s$/);
  await page.getByLabel("six-digit code").fill("123");
  // The browser's own events for leaving and returning, as the back-forward cache sends them
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.locator("#access-code")).toBeHidden();
  await expect(page.locator("#access-email")).toBeVisible();
  await expect(page.getByLabel("email address")).toHaveValue("");
  await expect(page.getByLabel("six-digit code")).toHaveValue("");
  await expect(page.locator("#access-code-sent")).toHaveText("");
  await expect(page.locator("[data-resend]")).toHaveText("send a new code");
});

test("without JavaScript it says signing in needs it, shows no form and sends nothing", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(PAGE);
  await expect(page.locator(".access-noscript")).toHaveText("signing in needs javascript, which is off in this browser. turn it on for this page to sign in.");
  await expect(page.locator("form")).toHaveCount(2);
  for (const form of await page.locator("form").all()) await expect(form).toBeHidden();
  expect(requests.filter((path) => path.startsWith("/api/"))).toEqual([]);
  await context.close();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("every control is a full tap target and nothing scrolls sideways", async ({ page }) => {
    await answer(page, { "POST /api/photos/access/code": [codeAccepted] });
    await page.goto(PAGE);
    await page.getByLabel("email address").fill("mum@example.com");
    await page.getByRole("button", { name: "send a code" }).tap();
    await expect(page.getByLabel("six-digit code")).toBeVisible();
    for (const control of await page.locator("#access-code button, #access-code input").all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
