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
  await page.goto("/");
  await page.locator('[data-slug="canberra-events"] .peek').click();
  await page.locator("#log .more").click();
  await page.waitForLoadState("networkidle");
  await Promise.all(checks);
  expect(setCookies).toEqual([]);
  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
});
