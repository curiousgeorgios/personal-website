import { chromium, expect, test, type Page } from "@playwright/test";

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
  const link = page.locator('[data-slug="canberra-events"] .line a');
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
  expect(new URL(page.url()).pathname).toBe("/"); // the frame's link isn't followed
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
  await expect(item.locator(".frame img")).toBeVisible();
  const dialog = page.locator("dialog.closer");
  // Every frame's transform from here on, so a movement is caught whenever it happens, in the open or the close
  await dialog.locator("img").evaluate((big) => {
    const seen = new Set<string>();
    const note = () => seen.add(getComputedStyle(big).transform);
    new MutationObserver(note).observe(big, { attributes: true });
    const tick = () => {
      note();
      requestAnimationFrame(tick);
    };
    tick();
    (window as unknown as { seen: Set<string> }).seen = seen;
  });
  await item.locator(".frame").click();
  await expect(dialog).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => [...(window as unknown as { seen: Set<string> }).seen])).toEqual(["none"]);
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
    const link = element as HTMLAnchorElement;
    const dialog = document.querySelector<HTMLDialogElement>("dialog.closer")!;
    const big = dialog.querySelector("img")!;
    const box = (rect: DOMRect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    link.click();
    while (!dialog.open) await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100)); // part-way through the 420ms grow
    const landed = new Promise<DOMRect>((resolve) => big.addEventListener("transitionend", () => resolve(big.getBoundingClientRect()), { once: true }));
    big.click();
    return { landed: box(await landed), frame: box(link.querySelector("img")!.getBoundingClientRect()) };
  });
  for (const key of ["left", "top", "width", "height"] as const) expect(Math.abs(landed[key] - frame[key])).toBeLessThan(1);
});

// The closer look's big file, held back so a click can be followed by others while it loads
const BIG = /-1920\.(avif|webp)$/;
const delayBig = (page: Page, ms: number) =>
  page.route(BIG, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });

test("a double click on a frame still grows the snapshot out of it, instead of popping it open", async ({ page }) => {
  await delayBig(page, 300);
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  // The image's transform on each of the first frames after the dialog opens
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("dialog.closer")!;
    const big = dialog.querySelector("img")!;
    const frames: string[] = [];
    (window as unknown as { frames: string[] }).frames = frames;
    new MutationObserver((_records, observer) => {
      if (!dialog.open) return;
      observer.disconnect();
      const note = () => {
        frames.push(getComputedStyle(big).transform);
        if (frames.length < 6) requestAnimationFrame(note);
      };
      note();
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  });
  await item.locator(".frame").dblclick();
  await expect(page.locator("dialog.closer")).toHaveAttribute("open", "");
  await expect.poll(() => page.evaluate(() => (window as unknown as { frames: string[] }).frames.length)).toBe(6);
  // Every one of them is the grow on its way: scaled down from the frame's box, never full size. A second open measuring
  // the image with the first's transform on made the grow's start the identity, so the picture popped to full size
  const frames = await page.evaluate(() => (window as unknown as { frames: string[] }).frames);
  expect(frames.filter((transform) => transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)")).toEqual([]);
});

test("a second frame clicked while the first one's big file loads is ignored, and the first frame's snapshot comes back", async ({ page }) => {
  await delayBig(page, 2000);
  await page.goto("/");
  const first = page.locator('[data-slug="digital-nachos"]');
  const second = page.locator('[data-slug="canberra-events"]');
  await first.locator(".peek").click();
  await second.locator(".peek").click();
  await expect(first.locator(".frame img")).toBeVisible();
  await expect(second.locator(".frame img")).toBeVisible();
  await first.locator(".frame").click();
  // The wait shows: the frame says it is busy and the pointer says so too
  await expect(first.locator(".frame")).toHaveAttribute("aria-busy", "true");
  await expect(first.locator(".frame")).toHaveCSS("cursor", "progress");
  await second.locator(".frame").click();
  const dialog = page.locator("dialog.closer");
  await expect(dialog).toHaveAttribute("open", "", { timeout: 10_000 });
  await expect(dialog.locator("img")).toHaveAttribute("src", /fixture-digital-nachos-1920\.webp$/);
  await expect(first.locator(".frame")).not.toHaveAttribute("aria-busy", /.*/);
  await expect(second.locator(".frame")).not.toHaveAttribute("aria-busy", /.*/);
  await dialog.locator(".closer-close").click();
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(first.locator(".frame img")).toHaveCSS("visibility", "visible");
  await expect(second.locator(".frame img")).toHaveCSS("visibility", "visible");
  await expect(first.locator(".frame")).toBeFocused();
});

test("a label closed while its closer look loads never gets one, and focus stays where it was put", async ({ page }) => {
  await delayBig(page, 1500);
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  const pill = item.locator(".peek");
  await pill.click();
  await expect(item.locator(".frame img")).toBeVisible();
  await item.locator(".frame").click();
  await expect(item.locator(".frame")).toHaveAttribute("aria-busy", "true");
  await pill.press("Enter");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  // The file arrives, and nothing opens over the closed label; the busy marks go on this path too
  await expect(item.locator(".frame")).not.toHaveAttribute("aria-busy", /.*/, { timeout: 10_000 });
  await expect(page.locator("dialog.closer")).not.toHaveAttribute("open", "");
  await expect(pill).toBeFocused();
  await expect(item.locator(".frame img")).toHaveCSS("visibility", "visible");
});

test("a closer look whose big file won't load grows from the frame's own picture instead of a broken one", async ({ page }) => {
  await page.route(BIG, (route) => route.abort());
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  await item.locator(".frame").click();
  const dialog = page.locator("dialog.closer");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(item.locator(".frame")).not.toHaveAttribute("aria-busy", /.*/);
  const same = await item.locator(".frame").evaluate((button) => {
    const big = document.querySelector<HTMLImageElement>("dialog.closer img")!;
    return { loaded: big.naturalWidth > 0, current: big.currentSrc === button.querySelector("img")!.currentSrc };
  });
  expect(same).toEqual({ loaded: true, current: true });
  await expect.poll(() => dialog.locator("img").evaluate((big) => getComputedStyle(big).transform)).toBe("none");
  expect((await dialog.locator("img").boundingBox())!.width).toBeGreaterThan((await item.locator(".frame img").boundingBox())!.width);
});

test("two quick Escapes put the snapshot back and focus on the frame as the browser closes the dialog, then a third closes the label", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  const dialog = page.locator("dialog.closer");
  await item.locator(".frame").click();
  await expect(dialog).toHaveAttribute("open", "");
  await expect.poll(() => dialog.locator("img").evaluate((big) => getComputedStyle(big).transform)).toBe("none");
  // Where things stand when the dialog's close event reaches a listener of the page's, whoever closed it. The browser
  // won't let the second Escape's cancel be stopped, so it closes the dialog 300ms early
  await dialog.evaluate((element) => {
    element.addEventListener("close", () => {
      const link = document.querySelector<HTMLElement>('[data-slug="digital-nachos"] .frame')!;
      (window as unknown as { atClose: object }).atClose = { snapshot: getComputedStyle(link.querySelector("img")!).visibility, focused: document.activeElement === link };
    });
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(item.locator(".frame")).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { atClose: object }).atClose)).toEqual({ snapshot: "visible", focused: true });
  await expect(item.locator(".frame img")).toHaveCSS("visibility", "visible");
  await page.keyboard.press("Escape");
  await expect(item.locator(".peek")).toHaveAttribute("aria-expanded", "false");
  await expect(item.locator(".peek")).toBeFocused();
});

test("the close pill never covers the picture, at any size", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  const dialog = page.locator("dialog.closer");
  await item.locator(".frame").click();
  await expect(dialog).toHaveAttribute("open", "");
  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => dialog.locator("img").evaluate((big) => getComputedStyle(big).transform)).toBe("none");
    const [pill, picture] = await Promise.all([dialog.locator(".closer-close").boundingBox(), dialog.locator("img").boundingBox()]);
    expect(picture!.y, `${size.width} x ${size.height}`).toBeGreaterThanOrEqual(pill!.y + pill!.height);
  }
});

test("with a classic scrollbar the page doesn't shift under the closer look, so the snapshot lands in its frame", async ({ baseURL, browserName }) => {
  test.skip(browserName !== "chromium", "the scrollbar is drawn through Chromium's ::-webkit-scrollbar");
  // A Mac's Chromium only draws overlay scrollbars, so its own browser is launched with scrollbars shown, and the page
  // gets a 15px one (an injected style needs the page's CSP out of the way)
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const page = await (await browser.newContext({ baseURL, bypassCSP: true })).newPage();
    await page.goto("/");
    await page.addStyleTag({ content: "::-webkit-scrollbar { width: 15px; }" });
    const bar = () => page.evaluate(() => innerWidth - document.documentElement.clientWidth);
    expect(await bar()).toBe(15);
    const item = page.locator('[data-slug="canberra-events"]');
    await item.locator(".peek").click();
    await expect(item.locator(".frame img")).toBeVisible();
    const dialog = page.locator("dialog.closer");
    const lefts = () => page.evaluate(() => ["[data-slug='canberra-events'] .line", "[data-slug='canberra-events'] .frame img"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().left));
    const before = await lefts();
    await item.locator(".frame").click();
    await expect(dialog).toHaveAttribute("open", "");
    // The scrollbar goes while the dialog is open (overflow: hidden), and its width stays as padding, so nothing moves
    expect(await bar()).toBe(0);
    expect(Math.max(...(await lefts()).map((left, i) => Math.abs(left - before[i])))).toBeLessThan(0.5);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toHaveAttribute("open", "");
    expect(await bar()).toBe(15);
    expect(Math.max(...(await lefts()).map((left, i) => Math.abs(left - before[i])))).toBeLessThan(0.5);
  } finally {
    await browser.close();
  }
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

  test("a frame is a link that opens the big picture", async ({ page }) => {
    await page.goto("/");
    await page.locator("#label-digital-nachos").evaluate((drawer) => drawer.removeAttribute("hidden"));
    const frame = page.getByRole("link", { name: "look closer at digital nachos" });
    await expect(frame).toHaveAttribute("href", /fixture-digital-nachos-1920\.webp$/);
    await frame.click();
    await expect(page).toHaveURL(/\/media\/snapshots\/fixture-digital-nachos-1920\.webp$/);
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
