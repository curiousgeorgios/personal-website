import { expect, test, type Page } from "@playwright/test";
import { ADMIN, expectSaved, openAdmin, openLogbook, submit, unique } from "./admin";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");
// The tests build on each other's lines, so they run in order
test.describe.configure({ mode: "serial" });

const u = unique();
const garden = `garden-${u}`;
const fence = `fence-${u}`;
const entry = (page: Page, slug: string) => page.locator(`.entry[data-slug="${slug}"]`);
const slugs = (page: Page, section: "now" | "before") =>
  page.locator(`#${section} .entry`).evaluateAll((entries) => entries.map((entry) => entry.getAttribute("data-slug")));

async function addLine(page: Page, section: "now" | "before", slug: string, text: string) {
  await openAdmin(page);
  const form = `item-new-${section}`;
  await page.locator(`#${form} > summary`).click();
  // An add form is fixed to its own section: with a select, a failure after switching it would reopen the other form
  await expect(page.locator(`#${form}-section`)).toHaveCount(0);
  await expect(page.locator(`#${form} input[name="section"]`)).toHaveValue(section);
  await page.locator(`#${form}-text`).fill(text);
  await page.locator(`#${form}-slug`).fill(slug);
  return submit(page, form, "add");
}

test("adds a line at the end of now, and the logbook shows its text escaped", async ({ page }) => {
  expect((await addLine(page, "now", garden, "started a <b>garden</b> club with [friends](https://example.com)")).status()).toBe(303);
  await expectSaved(page, "now");
  expect((await slugs(page, "now")).at(-1)).toBe(garden);
  // The collapsed line shows the link text only; the textarea inside keeps the raw text
  await expect(entry(page, garden).locator("summary .what")).toHaveText("started a <b>garden</b> club with friends");
  await expect(entry(page, garden).locator("textarea[name='text']")).toHaveValue("started a <b>garden</b> club with [friends](https://example.com)");

  await openLogbook(page);
  const line = page.locator(`#now li[data-slug="${garden}"] .line`);
  await expect(line).toContainText("started a <b>garden</b> club with friends");
  await expect(line.locator("b")).toHaveCount(0);
  await expect(line.getByRole("link", { name: "friends" })).toHaveAttribute("href", "https://example.com");
});

test("a taken slug comes back open, with what was typed", async ({ page }) => {
  expect((await addLine(page, "now", "digital-nachos", "a second digital nachos")).status()).toBe(422);
  await expect(page).toHaveURL(`${ADMIN}/admin/#item-new-now`);
  await expect(page.locator("#item-new-now")).toHaveAttribute("open", "");
  await expect(page.locator("#item-new-now > [role=alert]")).toHaveText("1 thing to fix below");
  await expect(page.locator("#item-new-now-slug-error")).toHaveText("that slug is taken");
  await expect(page.locator("#item-new-now-slug")).toHaveValue("digital-nachos");
  await expect(page.locator("#item-new-now-text")).toHaveValue("a second digital nachos");
});

test("a link the logbook can't show is named, not saved", async ({ page }) => {
  expect((await addLine(page, "now", `link-${u}`, "see [it](http://example.com)")).status()).toBe(422);
  await expect(page.locator("#item-new-now-text-error")).toHaveText("links need an https:// or mailto: address");
  expect(await slugs(page, "now")).not.toContain(`link-${u}`);
});

test("edits a line: an aside, a wall label with a page to snapshot and a move to before", async ({ page }) => {
  await openAdmin(page);
  const line = entry(page, garden);
  await line.locator("summary").click();
  await line.getByLabel("aside (after the dash)", { exact: true }).fill("since spring");
  await line.getByLabel("status", { exact: true }).selectOption("live");
  await line.getByLabel("era", { exact: true }).fill("2026");
  await line.getByLabel("kind", { exact: true }).selectOption("lesson");
  await line.getByLabel("the decision or lesson", { exact: true }).fill("small is fine.");
  await line.getByLabel("page to snapshot", { exact: true }).fill(`https://example.com/${u}`);
  await line.getByLabel("section", { exact: true }).selectOption("before");
  await line.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "before");
  expect((await slugs(page, "before")).at(-1)).toBe(garden);
  expect(await slugs(page, "now")).not.toContain(garden);
  await expect(page.locator(`#snapshots li[data-slug="${garden}"] .status`)).toHaveText("not captured yet");

  await openLogbook(page);
  const item = page.locator(`#before li[data-slug="${garden}"]`);
  await expect(item.locator(".aside")).toHaveText("- since spring");
  await expect(item.locator(".peek")).toBeVisible();
});

test("reorders within a section, and the ends can't move further", async ({ page }) => {
  expect((await addLine(page, "before", fence, "built a fence")).status()).toBe(303);
  await expectSaved(page, "before");
  expect((await slugs(page, "before")).slice(-2)).toEqual([garden, fence]);

  await page.getByRole("button", { name: `move ${fence} up`, exact: true }).click();
  await expectSaved(page, "before");
  expect((await slugs(page, "before")).slice(-2)).toEqual([fence, garden]);
  await expect(page.getByRole("button", { name: `move ${garden} down`, exact: true })).toBeDisabled();
  const top = (await slugs(page, "before"))[0];
  await expect(page.getByRole("button", { name: `move ${top} up`, exact: true })).toBeDisabled();
});

test("removing a line needs the box ticked", async ({ page }) => {
  await openAdmin(page);
  const line = entry(page, fence);
  await line.locator("summary").click();
  const confirm = line.getByLabel("yes, remove this line", { exact: true });
  // The browser won't send it unticked; the server refuses it too (tests/unit/actions.test.ts)
  await expect(confirm).toHaveAttribute("required", "");
  await confirm.check();
  await line.getByRole("button", { name: "remove", exact: true }).click();
  await expectSaved(page, "before");
  await expect(entry(page, fence)).toHaveCount(0);
});
