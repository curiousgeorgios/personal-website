import { expect, test } from "@playwright/test";
import { audioState, deckState, playing, SLOW, withoutWebGL } from "./deck";

// Where the scene loads in software rendering, slow frames overshoot every sequential tween, so a journey can take a while
test.describe.configure({ timeout: 90_000 * SLOW });

test("the list plays a record and stops it", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(".tracks li").nth(1);
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("playing · stop", { timeout: 45_000 * SLOW });
  await expect(row.locator("button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-deck-status]")).toHaveText("now playing nyc in 1940");
  expect(await audioState(page)).toMatchObject({ paused: false, src: "/media/audio/nyc-in-1940.mp3" });
  await page.waitForTimeout(500); // past the double-press guard
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("play", { timeout: 45_000 * SLOW });
  await expect(row.locator("button")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-deck-status]")).toHaveText("stopped");
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
});

test("a double click plays once", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tracks button").first().dblclick();
  await playing(page, 0, 45_000 * SLOW);
  expect((await deckState(page)).want).toBe(0);
});

test("a track that can't play goes back and says so", async ({ page }) => {
  await page.route("**/media/audio/simple-things.mp3", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
  await page.goto("/");
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("couldn't play", { timeout: 45_000 * SLOW });
  await expect(page.locator("[data-deck-status]")).toHaveText("couldn't play simple things");
  // The row's text already proves the failure, which shows for four seconds and can be gone by the time a slow page
  // answers a read, so only the runner's own state is checked, polled
  await expect.poll(async () => (await deckState(page)).want).toBeNull();
  await playing(page, null, 45_000 * SLOW);
  expect((await deckState(page)).current).toBeNull();
  await expect(row.locator(".st")).toHaveText("play", { timeout: 6000 * SLOW });
});

test("with every hashed script blocked, as after a deploy, the list still plays", async ({ page }) => {
  await page.route(/\/_astro\/.+\.js$/, (route) => route.abort());
  await page.goto("/");
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("playing · stop", { timeout: 45_000 * SLOW });
});

test("without a scene nothing is marked in view", async ({ page }) => {
  await withoutWebGL(page);
  await page.goto("/");
  await page.locator(".tracks button").nth(2).hover();
  await expect(page.locator(".tracks li.browsed")).toHaveCount(0);
});

test("the script turns each track's link into a play button before anything binds", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tracks a.pick")).toHaveCount(0);
  const first = page.locator(".tracks .pick").first();
  await expect(first).toHaveJSProperty("tagName", "BUTTON");
  await expect(first).toHaveAttribute("type", "button");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(first).not.toHaveAttribute("href", /.*/);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("each track is a link to its MP3, served first party with no cookie, and the hint says only what's true", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator(".tracks li")).toHaveCount(4);
    await expect(page.locator(".tracks button")).toHaveCount(0);
    const hrefs = await page.locator(".tracks a.pick").evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    expect(hrefs).toHaveLength(4);
    for (const href of hrefs) {
      // First party, on this site's own /media/, never another host
      expect(href, href).toMatch(/^\/media\/audio\/[^/]+\.mp3$/);
      // Two bytes are enough to show the browser would get the file, as audio, ready to stream
      const response = await request.get(href, { headers: { Range: "bytes=0-1" } });
      expect(response.status(), href).toBe(206);
      expect(response.headers()["content-type"], href).toBe("audio/mpeg");
      expect(response.headers()["set-cookie"], href).toBeUndefined();
    }
    expect(await page.context().cookies()).toEqual([]);
    await expect(page.locator(".corner > .hint .hint-list")).toBeVisible();
    await expect(page.locator(".corner > .hint .hint-scene")).toBeHidden();
  });
});
