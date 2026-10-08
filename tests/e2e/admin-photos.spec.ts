import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN, expectSaved, openAdmin, unique } from "./admin";
import { adminD1 } from "./photo-store";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");
// Each test keeps to its own posts (fixture-b, -c and -e), which no other spec on 4333 changes
test.describe.configure({ mode: "serial" });

const post = (page: Page, collection: string) => page.locator(`#post-${collection}`);
const intent = (scope: Locator, value: string) => scope.locator(`form:has(input[name="intent"][value="${value}"])`);
const POSTED = (response: { request(): { method(): string } }) => response.request().method() === "POST";

async function openPost(page: Page, collection: string) {
  await openAdmin(page);
  await post(page, collection).locator("summary").click();
}

test("posts are listed newest first, each with its date, place, counts and RAW pill", async ({ page }) => {
  await openAdmin(page);
  expect(await page.locator("#photographs details").evaluateAll((all) => all.map((details) => details.id))).toEqual([
    "post-fixture", "post-fixture-b", "post-fixture-c", "post-fixture-d", "post-fixture-e", "post-fixture-f",
  ]);
  await expect(post(page, "fixture").locator("summary .what")).toHaveText("27.09.26 · bondi, sydney · 3 photos, 2 published");
  await expect(post(page, "fixture-c").locator("summary .tagged")).toHaveText("1 raw");
});

test("hiding and publishing a whole post, then one photo", async ({ page }) => {
  await openPost(page, "fixture-b");
  await post(page, "fixture-b").getByRole("button", { name: "hide all", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 0 published");

  await openPost(page, "fixture-b");
  await post(page, "fixture-b").getByRole("button", { name: "publish all 2", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 2 published");

  await openPost(page, "fixture-b");
  await page.getByRole("button", { name: "hide fixture-b-02", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 1 published");
  expect(adminD1<{ id: string; published: number }>("SELECT id, published FROM photos WHERE collection = 'fixture-b' ORDER BY position")).toEqual([
    { id: "fixture-b-01", published: 1 },
    { id: "fixture-b-02", published: 0 },
  ]);

  await openPost(page, "fixture-b");
  await page.getByRole("button", { name: "publish fixture-b-02", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 2 published");
});

test("a hidden photo's previews answer 404 until it is published again; the admin's thumbnails still show", async ({ page, request }) => {
  const previewOf = (id: string) => {
    const [{ previews }] = adminD1<{ previews: string }>(`SELECT previews FROM photos WHERE id = '${id}'`);
    return `${ADMIN}/media/${(JSON.parse(previews) as { key: string }[]).find((preview) => preview.key.endsWith("/240.avif"))!.key}`;
  };
  const expectRefused = async (url: string) => {
    const response = await request.get(url);
    expect([response.status(), response.headers()["cache-control"], response.headers()["cache-tag"]]).toEqual([404, "no-store", undefined]);
  };
  // Never published: refused publicly, shown in the admin through its own route
  await expectRefused(previewOf("fixture-03"));
  await openPost(page, "fixture");
  const thumb = page.locator("#photo-fixture-03 img");
  await expect(thumb).toHaveAttribute("src", /^\/admin\/media\/photos\/previews\/fixture-03\//);
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

  const url = previewOf("fixture-b-02");
  const served = await request.get(url);
  expect(served.status()).toBe(200);
  expect(served.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(served.headers()["cache-tag"]?.split(",")).toContain("photo-fixture-b-02");

  await openPost(page, "fixture-b");
  await page.getByRole("button", { name: "hide fixture-b-02", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expectRefused(url);

  await openPost(page, "fixture-b");
  await page.getByRole("button", { name: "publish fixture-b-02", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  expect((await request.get(url)).status()).toBe(200);
});

test("a photo that fails its checks publishes nothing, and says which", async ({ page }) => {
  await openPost(page, "fixture-e");
  await post(page, "fixture-e").getByRole("button", { name: "hide all", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  const [{ print_sha256: sha }] = adminD1<{ print_sha256: string }>("SELECT print_sha256 FROM photos WHERE id = 'fixture-e-01'");
  // The row now names a master R2 doesn't have, so the check fails as it would after a broken upload
  adminD1(`UPDATE photos SET print_sha256 = '${"0".repeat(64)}' WHERE id = 'fixture-e-01'`);
  try {
    await openPost(page, "fixture-e");
    const [response] = await Promise.all([page.waitForResponse(POSTED), post(page, "fixture-e").getByRole("button", { name: "publish all 1", exact: true }).click()]);
    expect(response.status()).toBe(422);
    await expect(post(page, "fixture-e")).toHaveAttribute("open", "");
    await expect(post(page, "fixture-e").locator(':scope > [role="alert"]')).toHaveText("1 photo couldn't be checked: fixture-e-01 (print master). publish the others one at a time.");
    expect(adminD1<{ published: number }>("SELECT published FROM photos WHERE id = 'fixture-e-01'")[0].published).toBe(0);
  } finally {
    adminD1(`UPDATE photos SET print_sha256 = '${sha}' WHERE id = 'fixture-e-01'`);
  }
  await openPost(page, "fixture-e");
  await post(page, "fixture-e").getByRole("button", { name: "publish all 1", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-e").locator("summary .what")).toHaveText("09.08.25 · braddon, canberra · 1 photo, 1 published");
});

test("a place and a title are saved; a place the fonts can't draw comes back with its form", async ({ page }) => {
  await openPost(page, "fixture-c");
  const place = intent(post(page, "fixture-c"), "post.place");
  await place.getByLabel("place").fill("  Cottesloe, Perth ");
  await place.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-c").locator("summary .what")).toHaveText("01.03.26 · cottesloe, perth · 1 photo, 1 published");
  expect(adminD1("SELECT place, place_edited FROM photo_posts WHERE collection = 'fixture-c'")).toEqual([{ place: "cottesloe, perth", place_edited: 1 }]);

  await openPost(page, "fixture-c");
  await place.getByLabel("place").fill("東京, japan");
  const [refused] = await Promise.all([page.waitForResponse(POSTED), place.getByRole("button", { name: "save", exact: true }).click()]);
  expect(refused.status()).toBe(422);
  await expect(page.locator("#post-fixture-c-place")).toHaveValue("東京, japan");
  await expect(page.locator("#post-fixture-c-place-error")).toHaveText("plain latin letters only (accents like é are fine)");

  await openPost(page, "fixture-c");
  const title = intent(page.locator("#photo-fixture-c-01"), "photo.title");
  await title.getByLabel("title").fill("the long jetty");
  await title.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(page.locator("#photo-fixture-c-01-title")).toHaveValue("the long jetty");
});

test("an edited place and title show on the gallery and the photo's page", async ({ page }) => {
  await openPost(page, "fixture-c");
  const place = intent(post(page, "fixture-c"), "post.place");
  await place.getByLabel("place").fill("cottesloe, perth");
  await place.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await openPost(page, "fixture-c");
  const title = intent(page.locator("#photo-fixture-c-01"), "photo.title");
  await title.getByLabel("title").fill("the long jetty");
  await title.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  // A fresh query misses any cached copy: local runs have no purge
  // The gallery lists two entries a page, so fixture-c is on the page after fixture-b (posted 14 june 2026)
  await page.goto(`${ADMIN}/photos?before=${Date.parse("2026-06-14T09:15:00+10:00") / 1000}&fresh=${unique()}`);
  await expect(page.locator("#post-fixture-c .entry-head")).toHaveText("01.03.26 · cottesloe, perth");
  await expect(page.locator("#post-fixture-c img")).toHaveAttribute("alt", "the long jetty");
  await page.goto(`${ADMIN}/photos/fixture-c-01?fresh=${unique()}`);
  await expect(page.locator("h1")).toHaveText("the long jetty");
  await expect(page.locator(".photo-page .where")).toHaveText("01.03.26 · cottesloe, perth");
});
