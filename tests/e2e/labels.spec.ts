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

test("a second hover fetches nothing new", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover on a phone");
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const card = item.locator(".hovercard");
  const fetched: string[] = [];
  page.on("request", (request) => {
    if (SNAPSHOT.test(request.url())) fetched.push(request.url());
  });
  await item.locator(".aside").hover();
  await expect(card).toHaveCSS("opacity", "1");
  await page.locator("h1").hover();
  await expect(card).toBeHidden();
  await item.locator(".aside").hover();
  await expect(card).toHaveCSS("opacity", "1");
  await page.waitForLoadState("networkidle");
  expect(fetched).toHaveLength(1);
});

test("at rest a hover card is out of the page's text, so it isn't copied or found", async ({ page }) => {
  await page.goto("/");
  const copied = await page.locator('[data-slug="canberra-events"]').evaluate((item) => {
    getSelection()!.selectAllChildren(item);
    return getSelection()!.toString();
  });
  expect(copied).toContain("canberra.events");
  expect(copied).not.toContain("click for the label");
});

test("Escape dismisses a hovered card until the pointer leaves the line", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover on a phone");
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const card = item.locator(".hovercard");
  await item.locator(".aside").hover();
  await expect(card).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCSS("opacity", "0");
  await expect(card).toBeHidden();
  await page.locator("h1").hover();
  await item.locator(".aside").hover();
  await expect(card).toHaveCSS("opacity", "1");
});

test("focusing the pill shows the card; Escape dismisses it until focus leaves the line", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover cards on a phone");
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const pill = item.locator(".peek");
  const card = item.locator(".hovercard");
  // Focus from script counts as visible focus in both engines (WebKit on macOS doesn't Tab to buttons)
  await pill.focus();
  await expect(card).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(pill).toBeFocused();
  await expect(card).toHaveCSS("opacity", "0");
  await expect(card).toBeHidden();
  await page.locator('[data-slug="linear-gratis"] .peek').focus();
  await pill.focus();
  await expect(card).toHaveCSS("opacity", "1");
});

test("Escape on an open label closes it and returns focus to the pill without bringing its card up", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover cards on a phone");
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const pill = item.locator(".peek");
  const card = item.locator(".hovercard");
  await pill.focus();
  await page.keyboard.press("Enter");
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await expect(card).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect(pill).toBeFocused();
  await expect(card).toHaveCSS("opacity", "0");
  await expect(card).toBeHidden();
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

test("find-in-page with JavaScript on loads the frame's snapshot", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  const [request] = await Promise.all([
    page.waitForRequest(SNAPSHOT),
    // What find-in-page does to a match inside hidden="until-found": beforematch, then the attribute goes
    item.locator(".drawer").evaluate((drawer) => {
      drawer.dispatchEvent(new Event("beforematch"));
      drawer.removeAttribute("hidden");
    }),
  ]);
  expect(request.url()).toMatch(/fixture-digital-nachos-(480|960)\.(avif|webp)$/);
  await expect(item.locator(".peek")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => item.locator(".frame img").evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
});

test("a snapshot opens a closer look; Esc returns it to its frame, then closes the label", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  const frame = item.locator(".frame");
  await expect(frame.locator("img")).toBeVisible();
  await frame.click();
  const dialog = page.locator("dialog.closer");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog.locator(".closer-close")).toBeFocused();
  await expect(dialog.locator("img")).toHaveAttribute("src", /fixture-digital-nachos-1920\.webp$/);
  await expect(dialog).toHaveAccessibleName("closer look: a snapshot of digital nachos");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(frame).toBeFocused();
  await expect(frame.locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(item.locator(".peek")).toHaveAttribute("aria-expanded", "false");
  await expect(item.locator(".peek")).toBeFocused();
});

test("a click anywhere in the closer look, or its close button, puts the snapshot back", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  const dialog = page.locator("dialog.closer");
  for (const close of [() => dialog.locator("img").click(), () => dialog.locator(".closer-close").click()]) {
    await item.locator(".frame").click();
    await expect(dialog).toHaveAttribute("open", "");
    await close();
    await expect(dialog).not.toHaveAttribute("open", "");
    await expect(item.locator(".frame")).toBeFocused();
  }
});

test("with reduced motion the closer look opens and closes without moving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await item.locator(".frame").click();
  const img = page.locator("dialog.closer img");
  await expect(page.locator("dialog.closer")).toHaveAttribute("open", "");
  expect(await img.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.closer")).not.toHaveAttribute("open", "");
});

test("the paper veil fades in over the page instead of appearing at once", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  // WebKit used to start the veil already opaque, as nothing had settled the dialog's style before the class went on
  const fading = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const dialog = document.querySelector<HTMLDialogElement>("dialog.closer")!;
        new MutationObserver((_records, observer) => {
          if (!dialog.classList.contains("on")) return;
          observer.disconnect();
          requestAnimationFrame(() => resolve(dialog.getAnimations({ subtree: true }).some((animation) => animation instanceof CSSTransition && animation.transitionProperty === "opacity")));
        }).observe(dialog, { attributes: true, attributeFilter: ["class"] });
        document.querySelector<HTMLElement>('[data-slug="canberra-events"] .frame')!.click();
      }),
  );
  expect(fading).toBe(true);
});

test("a closer look closed while it is still growing goes back to its frame, not to where it had got to", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  const { landed, frame } = await item.locator(".frame").evaluate(async (element) => {
    const button = element as HTMLButtonElement;
    const dialog = document.querySelector<HTMLDialogElement>("dialog.closer")!;
    const big = dialog.querySelector("img")!;
    const box = (rect: DOMRect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    button.click();
    while (!dialog.open) await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100)); // part-way through the 420ms grow
    const landed = new Promise<DOMRect>((resolve) => big.addEventListener("transitionend", () => resolve(big.getBoundingClientRect()), { once: true }));
    big.click();
    return { landed: box(await landed), frame: box(button.querySelector("img")!.getBoundingClientRect()) };
  });
  for (const key of ["left", "top", "width", "height"] as const) expect(Math.abs(landed[key] - frame[key])).toBeLessThan(1);
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
