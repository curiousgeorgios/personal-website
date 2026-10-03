import { expect, test } from "@playwright/test";
import { audioState, deckState, playing, withoutWebGL } from "./deck";

// Where the scene loads in software rendering, slow frames overshoot every sequential tween, so a journey can take a while
test.describe.configure({ timeout: 90_000 });

test("the list plays a record and stops it", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(".tracks li").nth(1);
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("playing · stop", { timeout: 45_000 });
  await expect(row.locator("button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-deck-status]")).toHaveText("now playing nyc in 1940");
  expect(await audioState(page)).toMatchObject({ paused: false, src: "/media/audio/nyc-in-1940.mp3" });
  await page.waitForTimeout(500); // past the double-press guard
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("play", { timeout: 45_000 });
  await expect(row.locator("button")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-deck-status]")).toHaveText("stopped");
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
});

test("a double click plays once", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tracks button").first().dblclick();
  await playing(page, 0, 45_000);
  expect((await deckState(page)).want).toBe(0);
});

test("a track that can't play goes back and says so", async ({ page }) => {
  await page.route("**/media/audio/simple-things.mp3", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
  await page.goto("/");
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("couldn't play", { timeout: 45_000 });
  await expect(page.locator("[data-deck-status]")).toHaveText("couldn't play simple things");
  // Read straight away: the failure shows for four seconds and the record's way home can take three
  expect(await deckState(page)).toMatchObject({ want: null, failed: 0 });
  await playing(page, null, 45_000);
  expect((await deckState(page)).current).toBeNull();
  await expect(row.locator(".st")).toHaveText("play", { timeout: 6000 });
});

test("with every hashed script blocked, as after a deploy, the list still plays", async ({ page }) => {
  await page.route(/\/_astro\/.+\.js$/, (route) => route.abort());
  await page.goto("/");
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("playing · stop", { timeout: 45_000 });
});

test("without a scene nothing is marked in view", async ({ page }) => {
  await withoutWebGL(page);
  await page.goto("/");
  await page.locator(".tracks button").nth(2).hover();
  await expect(page.locator(".tracks li.browsed")).toHaveCount(0);
});
