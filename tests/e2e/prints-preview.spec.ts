import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAMILIES, printsFor, TIERS } from "../../src/lib/prints/catalogue";
import { CM_PER_INCH, familyClass, previewArea, previewSizes, sizeLine } from "../../src/lib/prints/preview";
import { PRINTS } from "./prints-site";

// The print row's preview (spec 15.1 as amended), on the prints server (4337): the drawing follows the radios through
// CSS alone, to one scale, and agrees with what the basket receives
test.use({ baseURL: PRINTS });

const box = async (locator: Locator) => (await locator.boundingBox())!;
/** Where an element sits on the page, whatever the scroll: a click on a label may scroll it into view */
const onPage = (locator: Locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
});
const paper = (page: Page) => page.locator(".preview-print");
/** One centimetre on screen: the drawing area's width over its width in centimetres */
async function centimetre(page: Page) {
  const vertical = await page.locator(".preview-stage.vertical").count();
  return (await box(page.locator(".preview-wall"))).width / previewArea(vertical ? "Vertical" : "Horizontal").width;
}
async function choose(page: Page, size: string, frame: string) {
  await page.locator(`input[name="size"][value="${size}"]`).check();
  await page.locator(`input[name="frame"][value="${frame}"]`).check();
}
/** The paper's size once any transition has finished */
async function settled(page: Page) {
  await expect.poll(async () => paper(page).evaluate((element) => element.getAnimations().length)).toBe(0);
  return box(paper(page));
}
const caption = (page: Page) => page.locator(".preview-caption > :visible");

test("each size is drawn at its own size against one scale, and the area and the controls hold still", async ({ page }) => {
  await page.goto("/photos/fixture-b-01");
  const cm = await centimetre(page);
  const wall = await onPage(page.locator(".preview-wall"));
  const button = await onPage(page.getByRole("button", { name: "add to basket" }));
  const family = FAMILIES.find((candidate) => candidate.name === "2:3")!;
  for (const tier of TIERS) {
    // A click on the label, as a mouse would
    await page.locator(".size-choice", { hasText: `${tier} ·` }).click();
    const drawn = await settled(page);
    expect(drawn.width).toBeCloseTo(family.tiers[tier].short * CM_PER_INCH * cm, 0);
    expect(drawn.height).toBeCloseTo(family.tiers[tier].long * CM_PER_INCH * cm, 0);
    await expect(caption(page)).toHaveText([new RegExp(`^${tier} · unframed · \\$`), /^the print: /, /^drawn to scale/]);
    expect(await onPage(page.locator(".preview-wall"))).toEqual(wall);
    expect(await onPage(page.getByRole("button", { name: "add to basket" }))).toEqual(button);
  }
});

test("every family's sizes are drawn from the catalogue, upright and on their side", async ({ page }) => {
  // The fixture's 2:3 page with its family and orientation swapped in, so the stylesheet's numbers for every family are
  // measured in a real browser (the unit tests hold them to the catalogue)
  await page.goto("/photos/fixture-b-01");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const orientation of ["vertical", "horizontal"] as const) {
    for (const family of FAMILIES) {
      await page.locator(".preview-stage").evaluate((stage, name) => stage.setAttribute("class", name), `preview-stage ${orientation} ${familyClass(family.name)}`);
      const cm = await centimetre(page);
      for (const tier of TIERS) {
        await page.locator(`input[name="size"][value="${tier}"]`).check();
        const drawn = await box(paper(page));
        const { short, long } = family.tiers[tier];
        const [width, height] = orientation === "vertical" ? [short, long] : [long, short];
        expect(drawn.width, `${family.name} ${tier} ${orientation}`).toBeCloseTo(width * CM_PER_INCH * cm, 0);
        expect(drawn.height, `${family.name} ${tier} ${orientation}`).toBeCloseTo(height * CM_PER_INCH * cm, 0);
        expect((await box(page.locator(`.preview-outline[data-tier="${tier}"]`))).width).toBeCloseTo(drawn.width, 0);
      }
    }
  }
});

for (const width of [1280, 375]) {
  for (const orientation of ["vertical", "horizontal"] as const) {
    test(`crop captions keep the choices and button still at ${width}px, ${orientation}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/photos/fixture-b-01");
      await page.evaluate(() => document.fonts.ready);
      // As with the geometry check above, use the fixture row with real catalogue captions for crop-bearing families
      for (const [short, long] of [[4000, 5000], [4000, 5657]]) {
        const [photoWidth, photoHeight] = orientation === "vertical" ? [short, long] : [long, short];
        const prints = printsFor(photoWidth, photoHeight)!;
        const views = previewSizes(prints, photoWidth, photoHeight);
        const lines = views.map(sizeLine);
        await page.locator(".preview-stage").evaluate((stage, name) => stage.setAttribute("class", name), `preview-stage ${orientation} ${familyClass(prints.family)}`);
        await page.locator(".preview-size").evaluateAll((elements, captions) => {
          elements.forEach((element, index) => { element.textContent = captions[index]; });
        }, lines);
        await choose(page, "small", "unframed");
        const controls = () => Promise.all([
          ...[0, 1].map((index) => onPage(page.locator("#prints fieldset").nth(index))),
          onPage(page.getByRole("button", { name: "add to basket" })),
        ]);
        const before = await controls();
        for (const tier of TIERS) {
          for (const frame of ["unframed", "oak"]) {
            await choose(page, tier, frame);
            await expect(page.locator(".preview-size:visible")).toHaveText(lines[TIERS.indexOf(tier)]);
            expect(await controls(), `${prints.family} ${tier} ${frame}`).toEqual(before);
          }
        }
      }
    });
  }
}

test("a landscape lies on its side, cropped from the centre to the paper's shape", async ({ page }) => {
  await page.goto("/photos/fixture-b-02");
  await expect(page.locator(".preview-stage")).toHaveClass(/horizontal/);
  await page.locator(".print-preview").scrollIntoViewIfNeeded();
  await choose(page, "medium", "unframed");
  const drawn = await settled(page);
  expect(drawn.width / drawn.height).toBeCloseTo(18 / 12, 2);
  const img = page.locator(".preview-print img");
  // Fills the paper edge to edge, cut evenly from the centre, as Artelo's Outside fit does; never stretched or letterboxed
  expect(await img.evaluate((element) => [getComputedStyle(element).objectFit, getComputedStyle(element).objectPosition])).toEqual(["cover", "50% 50%"]);
  const shown = await box(img);
  expect([shown.width, shown.height]).toEqual([drawn.width, drawn.height]);
  await expect(caption(page)).toHaveText(["medium · unframed · $79", "the print: 46 cm wide, 30 cm tall (18 × 12 in), 333 pixels per inch", /^drawn to scale/]);
});

test("oak draws a frame around the paper, never over it, and the caption's price follows", async ({ page }) => {
  await page.goto("/photos/fixture-b-01");
  const frame = () => paper(page).evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return { opacity: style.opacity, inset: style.top };
  });
  await choose(page, "medium", "unframed");
  await expect.poll(async () => (await frame()).opacity).toBe("0");
  const unframed = await settled(page);
  await page.locator(".frame-choice", { hasText: "oak frame" }).click();
  await expect.poll(async () => (await frame()).opacity).toBe("1");
  // The frame sits outside the paper: its face is drawn out from the paper's edge, and the paper keeps its size
  expect(parseFloat((await frame()).inset)).toBeLessThan(0);
  expect(await settled(page)).toEqual(unframed);
  await expect(caption(page)).toHaveText(["medium · oak frame · $179", "the print: 30 cm wide, 46 cm tall (12 × 18 in), 333 pixels per inch", /the frame is illustrative/]);
});

test("the preview, its caption and the basket agree on the chosen print", async ({ page }) => {
  await page.goto("/photos/fixture-b-01");
  await choose(page, "large", "oak");
  await expect(caption(page).first()).toHaveText("large · oak frame · $259");
  await expect(page.locator(".size-choice", { hasText: "large ·" })).toContainText("$259 framed");
  await page.getByRole("button", { name: "add to basket" }).click();
  await expect(page).toHaveURL(/\/basket\?items=fixture-b-01:large:oak$/);
  await expect(page.locator(".line-what")).toHaveText(["large · 16 × 24 in · oak frame · $259"]);
});

test("from the keyboard the radios move the preview, and a screen reader hears the caption", async ({ page, browserName }) => {
  await page.goto("/photos/fixture-b-01");
  const status = page.locator(".preview-status");
  await expect(status).toHaveText("");
  await page.locator('input[name="size"][value="small"]').focus();
  const small = await settled(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('input[name="size"][value="medium"]')).toBeChecked();
  expect((await settled(page)).height).toBeGreaterThan(small.height);
  await expect(status).toHaveText("medium · unframed · $79. the print: 30 cm wide, 46 cm tall (12 × 18 in), 333 pixels per inch");
  const unframed = page.locator('input[name="frame"][value="unframed"]');
  // macOS Safari's full-item navigation uses Option-Tab (support.apple.com/guide/safari/cpsh003/mac).
  // Native browsers differ on whether navigation visits the unchecked sizes too. The next group must remain reachable
  const next = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press(next);
    if (await unframed.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(unframed).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('input[name="frame"][value="oak"]')).toBeChecked();
  await expect(status).toHaveText("medium · oak frame · $179. the print: 30 cm wide, 46 cm tall (12 × 18 in), 333 pixels per inch");
  await expect(page.locator(".print-preview [aria-hidden='true']")).toHaveCount(1);
});

test("without JavaScript the preview still follows the radios and the form still adds the print", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: PRINTS });
  const page = await context.newPage();
  await page.goto("/photos/fixture-b-01");
  await expect(page.locator(".print-preview")).toBeVisible();
  const small = await box(paper(page));
  await page.locator(".size-choice", { hasText: "medium ·" }).click();
  await page.locator(".frame-choice", { hasText: "oak frame" }).click();
  await expect.poll(async () => (await box(paper(page))).height).toBeCloseTo((small.height * 18) / 12, 0);
  await expect(caption(page).first()).toHaveText("medium · oak frame · $179");
  await page.getByRole("button", { name: "add to basket" }).click();
  await expect(page).toHaveURL(/\/basket\?items=fixture-b-01:medium:oak$/);
  await expect(page.locator(".line-what")).toHaveText(["medium · 12 × 18 in · oak frame · $179"]);
  await context.close();
});

test("with reduced motion the paper and frame change at once", async ({ page }) => {
  await page.goto("/photos/fixture-b-01");
  expect(await paper(page).evaluate((element) => getComputedStyle(element).transitionDuration)).not.toBe("0s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const durations = () => paper(page).evaluate((element) => [getComputedStyle(element).transitionDuration, getComputedStyle(element, "::before").transitionDuration]);
  expect(await durations()).toEqual(["0s", "0s"]);
  await page.locator('input[name="size"][value="large"]').check();
  expect(await paper(page).evaluate((element) => element.getAnimations().length)).toBe(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  for (const id of ["fixture-b-01", "fixture-b-02", "fixture-01"]) {
    test(`${id}: the drawing fits the column, nothing scrolls sideways and every choice is a full tap target`, async ({ page }) => {
      await page.goto(`/photos/${id}`);
      const stage = await box(page.locator(".preview-stage"));
      const column = await box(page.locator("#print-row .body"));
      expect(stage.x).toBeGreaterThanOrEqual(column.x);
      expect(stage.x + stage.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(375);
      for (const choice of await page.locator(".choice").all()) expect((await box(choice)).height).toBeGreaterThanOrEqual(44);
      const before = await box(paper(page));
      await page.locator(".frame-choice", { hasText: "oak frame" }).tap();
      await expect(page.locator('input[name="frame"][value="oak"]')).toBeChecked();
      if (id !== "fixture-01") {
        await page.locator(".size-choice", { hasText: "large ·" }).tap();
        expect((await settled(page)).width).toBeGreaterThan(before.width);
      }
    });
  }
});

test("the preview loads no image the page didn't already have, and never a master", async ({ page }) => {
  const images: string[] = [];
  page.on("request", (request) => { if (request.resourceType() === "image") images.push(new URL(request.url()).pathname); });
  await page.goto("/photos/fixture-b-01", { waitUntil: "networkidle" });
  await page.locator(".print-preview").scrollIntoViewIfNeeded();
  const preview = page.locator(".preview-print img");
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const [head, drawn] = await Promise.all([page.locator(".photo img").evaluate((img: HTMLImageElement) => img.currentSrc), preview.evaluate((img: HTMLImageElement) => img.currentSrc)]);
  expect(drawn).toBe(head);
  expect(new Set(images).size).toBe(1);
  for (const path of images) expect(path).toMatch(/^\/media\/photos\/previews\/fixture-b-01\/[0-9a-f]{64}\/(960|1600)\.(avif|webp)$/);
});

test("a photo with no print sizes has no preview", async ({ page }) => {
  await page.goto("/photos/fixture-c-01");
  await expect(page.locator(".print-preview, form#prints")).toHaveCount(0);
});

// Spec 23.1: hold image bytes until the initial boxes are measured. WebKit has no layout-shift entries, so also
// compare the photo, preview and button geometry before and after loading on every browser
for (const [width, height] of [[1280, 900], [375, 812]]) {
  test(`a late image shifts nothing in the print row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    let releaseImages!: () => void;
    const imagesReady = new Promise<void>((resolve) => { releaseImages = resolve; });
    await page.route(/\/media\/photos\/previews\/.*\.(avif|webp)$/, async (route) => {
      await imagesReady;
      await route.continue();
    });
    await page.addInitScript(() => {
      if (!PerformanceObserver.supportedEntryTypes.includes("layout-shift")) return;
      (window as unknown as { cls?: number }).cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) (window as unknown as { cls: number }).cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/photos/fixture-b-01", { waitUntil: "domcontentloaded" });
    await page.locator(".print-preview").scrollIntoViewIfNeeded();
    const geometry = () => Promise.all([
      onPage(page.locator(".photo img")), onPage(page.locator(".print-preview")),
      onPage(page.getByRole("button", { name: "add to basket" })),
    ]);
    const before = await geometry();
    releaseImages();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".photo img, .preview-print img")].every((img) => img.complete && img.naturalWidth > 0), undefined, { timeout: 10_000 });
    await page.waitForTimeout(300);
    const after = await geometry();
    // Rounded responsive-image dimensions can alter the intrinsic ratio by a fraction of a CSS pixel in WebKit
    for (const [index, rect] of after.entries()) {
      for (const axis of ["x", "y", "width", "height"] as const) expect(Math.abs(rect[axis] - before[index][axis])).toBeLessThan(0.5);
    }
    const cls = await page.evaluate(() => (window as unknown as { cls?: number }).cls);
    if (cls !== undefined) expect(cls).toBeLessThan(0.01);
  });
}
