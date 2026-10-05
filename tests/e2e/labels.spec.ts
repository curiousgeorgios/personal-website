import { expect, test } from "@playwright/test";

test("clicking a labelled line opens its label in place; Esc closes and returns focus", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const pill = item.locator(".peek");
  const drawer = page.locator("#label-canberra-events");
  await expect(drawer).toHaveAttribute("hidden", "until-found");
  await item.locator(".aside").click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).not.toHaveAttribute("hidden", /.*/);
  await expect(drawer.locator(".made")).toBeVisible();
  await pill.focus();
  await page.keyboard.press("Escape");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect(pill).toBeFocused();
  await expect(drawer).toHaveAttribute("hidden", "until-found");
});

test("the pill toggles with the keyboard and several labels can be open", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-slug="digital-nachos"] .peek').press("Enter");
  await page.locator('[data-slug="linear-gratis"] .peek').press("Enter");
  await expect(page.locator(".line-item.open")).toHaveCount(2);
});

test("a same-frame open and close leaves the label closed and unstyled", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.evaluate((el) => {
    const line = el.querySelector<HTMLElement>(".line")!;
    line.click();
    line.click();
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(item.locator(".peek")).toHaveAttribute("aria-expanded", "false");
  await expect(item).not.toHaveClass(/\bopen\b/);
});

test("links inside a labelled line navigate instead of toggling", async ({ page }) => {
  await page.goto("/");
  const link = page.locator('[data-slug="canberra-events"] a');
  await expect(link).toHaveAttribute("href", "https://canberra.events");
  await page.route("https://canberra.events/**", (route) => route.fulfill({ body: "ok" }));
  await link.click();
  await expect(page).toHaveURL("https://canberra.events/");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("label contents stay in the page for find-in-page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#label-canberra-events")).toHaveAttribute("hidden", "until-found");
    await expect(page.locator("#label-canberra-events .made")).toHaveCount(1);
  });
});

const SNAPSHOT = /\/media\/snapshots\//;

test("no snapshot is fetched before a label is hovered or opened", async ({ page }) => {
  const fetched: string[] = [];
  page.on("request", (request) => {
    if (SNAPSHOT.test(request.url())) fetched.push(request.url());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(fetched).toEqual([]);
});

test("hovering a labelled line grows its snapshot out of the pill; it goes when the label opens", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover on a phone");
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const card = item.locator(".hovercard");
  const [request] = await Promise.all([page.waitForRequest(SNAPSHOT), item.locator(".aside").hover()]);
  expect(request.url()).toMatch(/fixture-canberra-events-480\.(avif|webp)$/);
  await expect(card).toHaveCSS("opacity", "1");
  await item.locator(".aside").click();
  await expect(card).toHaveCSS("opacity", "0");
});

test("a phone shows no hover card", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phones only");
  await page.goto("/");
  await expect(page.locator('[data-slug="canberra-events"] .hovercard')).toBeHidden();
});

test("a line without a snapshot has no hover card, and its label no frame", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="linear-gratis"]');
  await expect(item.locator(".hovercard")).toHaveCount(0);
  await item.locator(".peek").click();
  await expect(item.locator(".made")).toBeVisible();
  await expect(item.locator(".frame")).toHaveCount(0);
});

test("opening a label fetches its framed snapshot, and the drawer really opens", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  await expect.poll(() => item.locator(".frame img").evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect.poll(() => item.locator(".drawer").evaluate((drawer) => drawer.getBoundingClientRect().height)).toBeGreaterThan(100);
});

test("a snapshot that won't load leaves the label without its frame", async ({ page }) => {
  await page.route(SNAPSHOT, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".wall")).toHaveClass(/\bno-shot\b/);
  await expect(item.locator(".frame")).toBeHidden();
  await expect(item.locator(".made")).toBeVisible();
});

test("closing, reopening and closing quickly lets the last close finish its animation", async ({ page }) => {
  await page.goto("/");
  const hiddenAfter = await page.locator('[data-slug="canberra-events"]').evaluate(async (item) => {
    const line = item.querySelector<HTMLElement>(".line")!;
    const drawer = item.querySelector<HTMLElement>(".drawer")!;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    line.click();
    await wait(400);
    line.click();
    await wait(100);
    line.click();
    await wait(100);
    line.click();
    const closedAt = performance.now();
    await new Promise<void>((resolve) =>
      new MutationObserver((_records, observer) => {
        if (drawer.hasAttribute("hidden")) {
          observer.disconnect();
          resolve();
        }
      }).observe(drawer, { attributes: true }),
    );
    return performance.now() - closedAt;
  });
  // The first close's timer used to hide the drawer about 120ms into the last close's 320ms animation
  expect(hiddenAfter).toBeGreaterThanOrEqual(290);
});

test("find-in-page opens a label at once", async ({ page }) => {
  await page.goto("/");
  const opened = await page.locator('[data-slug="canberra-events"]').evaluate((item) => {
    item.querySelector(".drawer")!.dispatchEvent(new Event("beforematch"));
    return item.classList.contains("open") && item.querySelector(".peek")!.getAttribute("aria-expanded") === "true";
  });
  expect(opened).toBe(true);
});

test.describe("snapshots without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  // Browsers ignore loading="lazy" while scripting is off (an anti-tracking rule in the HTML spec), so without
  // JavaScript the frames' files come with the page; the hover cards' and the closer look's never do
  test("only the frames' snapshots are fetched, and find-in-page opens a label to show its frame", async ({ page }) => {
    const fetched: string[] = [];
    page.on("request", (request) => {
      if (SNAPSHOT.test(request.url())) fetched.push(request.url());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((url) => /fixture-(digital-nachos|canberra-events)-(480|960)\.avif$/.test(url))).toBe(true);
    // What find-in-page does to a match inside hidden="until-found"
    await page.locator("#label-digital-nachos").evaluate((drawer) => drawer.removeAttribute("hidden"));
    await expect.poll(() => page.locator("#label-digital-nachos").evaluate((drawer) => drawer.getBoundingClientRect().height)).toBeGreaterThan(100);
  });
});

test("the hover cards never scroll the page sideways", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover cards on a phone");
  for (const width of [800, 820, 840]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test("selecting a line's text doesn't toggle its label", async ({ page, isMobile }) => {
  test.skip(isMobile, "a mouse selection");
  await page.goto("/");
  const aside = page.locator('[data-slug="canberra-events"] .aside');
  const box = (await aside.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-slug="canberra-events"] .peek')).toHaveAttribute("aria-expanded", "false");
});
