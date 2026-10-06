import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { ADMIN, expectSaved, mp3, openAdmin, openLogbook, png, submit, svg, unique } from "./admin";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");
// The tests share the crate, so they run in order; each add uploads a file and converts a cover
test.describe.configure({ mode: "serial", timeout: 90_000 });

const u = unique();
const POSTED = (response: { request(): { method(): string } }) => response.request().method() === "POST";
const active = (page: Page) => page.locator('#records [data-group="active"] .entry');
const record = (page: Page, title: string) => page.locator("#records .entry", { hasText: title });
const count = async (page: Page) => Number((await page.locator("#records .count").textContent())!.match(/^(\d) of 6/)![1]);

async function addRecord(page: Page, title: string, audio = mp3()) {
  await openAdmin(page);
  await page.locator("#record-new > summary").click();
  await page.locator("#record-new-title").fill(title);
  await page.locator("#record-new-artist").fill("the testers");
  await page.locator("#record-new-audio").setInputFiles(audio);
  await page.locator("#record-new-cover").setInputFiles(await png());
  return submit(page, "record-new", "add to the crate");
}

async function deactivate(page: Page, title: string) {
  await page.getByRole("button", { name: `deactivate ${title}`, exact: true }).click();
  await expectSaved(page, "records");
}

test("adds a record near the 15MB limit, its cover made a 512px WebP under 40KB", async ({ page }) => {
  await openAdmin(page);
  // A retry may find the crate full from the first attempt
  if ((await count(page)) === 6) await deactivate(page, (await active(page).last().locator("summary .what").textContent())!);
  const before = await count(page);
  const title = `test ${u}`;
  expect((await addRecord(page, title, mp3(14 * 1024 * 1024))).status()).toBe(303);
  await expectSaved(page, "records");
  expect(await count(page)).toBe(before + 1);

  const src = await record(page, title).locator("img.cover").getAttribute("src");
  expect(src).toMatch(/^\/media\/covers\/[0-9a-hjkmnp-tv-z]{26}\.webp$/);
  const cover = await page.request.get(`${ADMIN}${src}`);
  expect(cover.headers()["content-type"]).toBe("image/webp");
  const bytes = await cover.body();
  expect(bytes.length).toBeLessThan(40 * 1024);
  expect(await sharp(bytes).metadata()).toMatchObject({ format: "webp", width: 512, height: 512 });

  await openLogbook(page);
  await expect(page.locator("#turntable .tracks")).toContainText(title);
});

test("files that aren't what they claim come back with messages, and nothing is added", async ({ page }) => {
  await openAdmin(page);
  // A full crate has no add form (a retry starts from what the first attempt left)
  if ((await count(page)) === 6) await deactivate(page, (await active(page).last().locator("summary .what").textContent())!);
  const before = await count(page);
  await page.locator("#record-new > summary").click();
  await page.locator("#record-new-title").fill(`fake ${u}`);
  await page.locator("#record-new-artist").fill("nobody");
  await page.locator("#record-new-audio").setInputFiles({ ...(await png()), name: "clip.mp3", mimeType: "audio/mpeg" });
  await page.locator("#record-new-cover").setInputFiles(svg());
  expect((await submit(page, "record-new", "add to the crate")).status()).toBe(422);
  await expect(page).toHaveURL(`${ADMIN}/admin/#record-new`);
  await expect(page.locator("#record-new")).toHaveAttribute("open", "");
  await expect(page.locator("#record-new-audio-error")).toHaveText("that file isn't an mp3");
  await expect(page.locator("#record-new-cover-error")).toHaveText("covers can be JPEG, PNG or WebP");
  await expect(page.locator("#record-new-title")).toHaveValue(`fake ${u}`);
  expect(await count(page)).toBe(before);

  // Files aren't kept after a problem, so they're chosen again
  await page.locator("#record-new-audio").setInputFiles(mp3(16 * 1024 * 1024));
  await page.locator("#record-new-cover").setInputFiles(await png());
  expect((await submit(page, "record-new", "add to the crate")).status()).toBe(422);
  await expect(page.locator("#record-new-audio-error")).toHaveText("mp3s can be up to 15MB");
  await expect(page.locator("#record-new-cover-error")).toHaveCount(0);
  expect(await count(page)).toBe(before);
  await expect(record(page, `fake ${u}`)).toHaveCount(0);
});

test("the crate holds six: a full crate has no add form, and a seventh can't be activated", async ({ page }) => {
  await openAdmin(page);
  for (let i = 0; (await count(page)) < 6; i++) {
    expect((await addRecord(page, `filler ${u} ${i}`)).status()).toBe(303);
    await expectSaved(page, "records");
  }
  await expect(page.locator("#record-new")).toContainText("the crate holds six records. deactivate one to add another.");
  await expect(page.locator("#record-new form")).toHaveCount(0);

  const first = (await active(page).first().locator("summary .what").textContent())!;
  await deactivate(page, first);
  expect(await count(page)).toBe(5);
  await expect(page.locator(`#records [data-group="inactive"] .entry`, { hasText: first })).toHaveCount(1);
  await openLogbook(page);
  await expect(page.locator("#turntable .tracks")).not.toContainText(first);

  expect((await addRecord(page, `sixth ${u}`)).status()).toBe(303);
  await expectSaved(page, "records");
  const [response] = await Promise.all([page.waitForResponse(POSTED), page.getByRole("button", { name: `activate ${first}`, exact: true }).click()]);
  expect(response.status()).toBe(422);
  await expect(record(page, first).locator(".error")).toHaveText("the crate holds six records. deactivate one first.");
  expect(await count(page)).toBe(6);
});

test("reorders within the crate", async ({ page }) => {
  await openAdmin(page);
  const titles = () => active(page).locator("summary .what").allTextContents();
  const [top, second] = await titles();
  await page.getByRole("button", { name: `move ${second} up`, exact: true }).click();
  await expectSaved(page, "records");
  expect((await titles()).slice(0, 2)).toEqual([second, top]);
  await expect(page.getByRole("button", { name: `move ${second} up`, exact: true })).toBeDisabled();
  const last = (await titles()).at(-1)!;
  await expect(page.getByRole("button", { name: `move ${last} down`, exact: true })).toBeDisabled();
});

test("edits a title, then removes the record and its files", async ({ page }) => {
  await openAdmin(page);
  const entry = record(page, `test ${u}`);
  await entry.locator("summary").click();
  await entry.getByLabel("title", { exact: true }).fill(`tested ${u}`);
  await entry.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "records");

  const renamed = record(page, `tested ${u}`);
  const src = await renamed.locator("img.cover").getAttribute("src");
  await renamed.locator("summary").click();
  await renamed.getByLabel("yes, remove this record and its files", { exact: true }).check();
  await renamed.getByRole("button", { name: "remove", exact: true }).click();
  await expectSaved(page, "records");
  await expect(record(page, `tested ${u}`)).toHaveCount(0);
  expect((await page.request.get(`${ADMIN}${src}`)).status()).toBe(404);
});
