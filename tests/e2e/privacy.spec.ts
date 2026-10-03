import { expect, test } from "@playwright/test";

test("cookies none, storage empty, every request first party", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const setCookies: string[] = [];
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("data:") && new URL(url).origin !== origin) foreign.push(url);
  });
  const checks: Promise<void>[] = [];
  page.on("response", (response) => {
    checks.push(
      response.allHeaders().then((headers) => {
        if (headers["set-cookie"]) setCookies.push(`${response.url()}: ${headers["set-cookie"]}`);
      }),
    );
  });
  // A unique query (set by CI after a deploy) bypasses the edge cache, so the new version is what gets checked
  await page.goto(process.env.PRIVACY_PATH ?? "/");
  // Content-agnostic: exercise the pill and the toggle when production has them, tolerate their absence
  const pill = page.locator(".peek").first();
  if (await pill.count()) await pill.click();
  const more = page.locator("#log .more");
  if (await more.count()) await more.click();
  await page.waitForLoadState("networkidle");
  // Play and stop a record when there is one: audio streams first party from /media and sets nothing
  const track = page.locator(".tracks button").first();
  if (await track.count()) {
    await track.click();
    await page.waitForTimeout(1500);
    await track.click();
  }
  await Promise.all(checks);
  expect(setCookies).toEqual([]);
  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
});
