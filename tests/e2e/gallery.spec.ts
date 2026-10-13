import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";

// The gallery on the gallery server's photo fixture (spec 11.3), which no spec changes: six posts, newest first, two to a page
test.use({ baseURL: GALLERY });

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the first page lists two entries, newest first, with dated headings and numbered frames", async ({ page }) => {
    const response = await page.goto("/photos");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("no-cache");
    expect(response?.headers()["cache-tag"]).toContain("photos");
    await expect(page).toHaveTitle("photos · george vlachos");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "photos george vlachos has taken, one entry per instagram post.");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://curiousgeorge.dev/photos");
    await expect(page.locator(".row > .label")).toHaveText(["photos of", "entries"]);
    expect(await page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id))).toEqual(["post-fixture", "post-fixture-b"]);
    await expect(page.locator("#post-fixture .entry-head")).toHaveText("27.09.26 · bondi, sydney");
    await expect(page.locator("#post-fixture .entry-head time")).toHaveAttribute("datetime", "2026-09-27");
    await expect(page.locator("#post-fixture-b .entry-head")).toHaveText("14.06.26");
    // fixture-03 is hidden: two frames, each showing its slide number
    await expect(page.locator("#post-fixture .frame-no")).toHaveText(["01", "02"]);
    await expect(page.locator("#post-fixture a.frame-link").first()).toHaveAttribute("href", "/photos/fixture-01");
    await expect(page.locator("#post-fixture img").first()).toHaveAttribute("alt", "a test photograph");
    await expect(page.locator("#post-fixture img").nth(1)).toHaveAttribute("alt", "photo 2 of 2 from 27 september 2026, bondi, sydney");
    await expect(page.locator("#post-fixture-b img").first()).toHaveAttribute("alt", "photo 1 of 2 from 14 june 2026");
  });

  test("frames know their size before any preview arrives: 120px tall, 88px on a phone", async ({ page }) => {
    // Hold every preview, so only the width and height attributes can size the frames
    await page.route((url) => url.pathname.startsWith("/media/photos/"), () => {});
    await page.goto("/photos", { waitUntil: "domcontentloaded" });
    const height = page.viewportSize()!.width < 680 ? 88 : 120;
    const portrait = page.locator("#post-fixture-b img").first(); // 4000 × 6000
    const landscape = page.locator("#post-fixture-b img").nth(1); // 6000 × 4000
    const box = (await portrait.boundingBox())!;
    expect(Math.round(box.height)).toBe(height);
    expect(Math.round(box.width)).toBe(Math.round((height * 2) / 3));
    expect(Math.round((await landscape.boundingBox())!.width)).toBe(Math.round((height * 3) / 2));
    await expect(portrait).toHaveAttribute("sizes", "(max-width: 680px) 59px, 80px");
    await expect(landscape).toHaveAttribute("sizes", "(max-width: 680px) 132px, 180px");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("only the first entry's first row loads eagerly, its first frame with high priority", async ({ page }) => {
    await page.goto("/photos");
    const loading = await page.locator("ol.entries img").evaluateAll((all) => all.map((img) => [img.getAttribute("loading"), img.getAttribute("fetchpriority")]));
    expect(loading).toEqual([["eager", "high"], ["eager", null], ["lazy", null], ["lazy", null]]);
  });

  test("older entries is a plain link to noindex pages, two entries each, that end the list", async ({ page }) => {
    await page.goto("/photos");
    const more = page.locator("a.more");
    await expect(more).toHaveText("older entries");
    await expect(more).toHaveAttribute("href", "/photos?before=1781392500");
    await more.click();
    await expect(page).toHaveURL(/\/photos\?before=1781392500$/);
    expect(await page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id))).toEqual(["post-fixture-c", "post-fixture-d"]);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(more).toHaveAttribute("href", "/photos?before=1766610000");
    await more.click();
    await expect(page).toHaveURL(/\/photos\?before=1766610000$/);
    expect(await page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id))).toEqual(["post-fixture-e", "post-fixture-f"]);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator("a.more")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "newest entries" })).toHaveAttribute("href", "/photos");
  });

  test("a phone takes only the 240 previews, whatever its pixel density", async ({ page }) => {
    test.skip(page.viewportSize()!.width > 680, "the phone project (a 3× iPhone)");
    await page.goto("/photos", { waitUntil: "networkidle" });
    const chosen = await page.locator("ol.entries img").evaluateAll((all) => all.map((img) => (img as HTMLImageElement).currentSrc));
    expect(chosen.length).toBe(4);
    for (const src of chosen) expect(src).toMatch(/\/240\.(avif|webp)$/);
  });

  test("a cursor older than every post says that's every entry; a malformed one is the notebook 404", async ({ page }) => {
    const response = await page.goto("/photos?before=1");
    expect(response?.status()).toBe(200);
    await expect(page.locator("ol.entries > li")).toHaveCount(0);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator(".empty")).toHaveCount(0);
    for (const cursor of ["abc", "-1", "12345678901", "1.5"]) {
      const refused = await page.goto(`/photos?before=${cursor}`);
      expect(refused?.status()).toBe(404);
      expect(refused?.headers()["cache-control"]).toBe("no-store");
      await expect(page.locator("main")).toContainText("nothing written on this page.");
    }
  });
});

test("when D1 fails the gallery says so with a 503 that is never cached", async ({ page }) => {
  const response = await page.goto("http://localhost:4332/photos");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["cache-tag"]).toBeUndefined();
  await expect(page.locator(".down")).toHaveText("photos aren't loading right now. try again in a bit.");
});

test("the gallery works under the CSP, with every script inline", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto("/photos", { waitUntil: "networkidle" });
  await expect(page.locator("script[src]")).toHaveCount(0);
  expect(violations).toEqual([]);
});

test.describe("with JavaScript", () => {
  const entryIds = (page: import("@playwright/test").Page) => page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id));
  // The End key, so the script sees a visitor's scroll even where the fixture's short page can't move (and mobile WebKit has no wheel)
  const toBottom = (page: import("@playwright/test").Page) => page.keyboard.press("End");

  test("nothing is fetched on load, even with the link inside the margin, until the visitor scrolls", async ({ page }) => {
    const queries: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/photos") queries.push(url.search);
    });
    await page.goto("/photos");
    // The test means something only if the observer would have fired: the link is within 800px of the viewport's bottom
    const gap = await page.locator("a.more").evaluate((link) => link.getBoundingClientRect().top - window.innerHeight);
    expect(gap).toBeLessThan(800);
    await page.waitForTimeout(500);
    expect(queries).toEqual([]);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(2);
    await expect(page.locator("a.more")).toHaveText("older entries");
    await toBottom(page);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    expect(queries).toEqual(["?by=entry&before=1781392500&limit=4"]);
  });

  test("keys that don't scroll fetch nothing: Tab, Shift and Cmd+A", async ({ page }) => {
    const queries: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/photos") queries.push(request.url());
    });
    await page.goto("/photos");
    const gap = await page.locator("a.more").evaluate((link) => link.getBoundingClientRect().top - window.innerHeight);
    expect(gap).toBeLessThan(800);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift");
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(500);
    expect(queries).toEqual([]);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(2);
  });

  test("an arrow key starts it, as does focusing the older entries link", async ({ page }) => {
    await page.goto("/photos");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    await page.goto("/photos");
    await page.locator("a.more").focus();
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
  });

  test("nearing the end loads the next entries in place once and ends the list", async ({ page }) => {
    const queries: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/photos") queries.push(url.search);
    });
    await page.goto("/photos");
    await toBottom(page);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    expect(await entryIds(page)).toEqual(["post-fixture", "post-fixture-b", "post-fixture-c", "post-fixture-d", "post-fixture-e", "post-fixture-f"]);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator("a.more")).toHaveCount(0);
    expect(queries).toEqual(["?by=entry&before=1781392500&limit=4"]);
    await expect(page).toHaveURL(/\/photos$/);
    await expect(page.locator("#post-fixture-f .entry-head")).toHaveText("02.02.25 · valletta, malta");
    await expect(page.locator("#post-fixture-f img")).toHaveAttribute("loading", "lazy");
    await expect(page.locator("#post-fixture-f img")).toHaveAttribute("alt", "photo 1 of 1 from 2 february 2025, valletta, malta");
    await expect(page.locator("#post-fixture-f a.frame-link")).toHaveAttribute("href", "/photos/fixture-f-01");
    await expect(page.locator("#post-fixture-f .frame-no")).toHaveText("01");
  });

  test("while a batch loads the link says so and can't be followed, and a click fetches nothing more", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    let calls = 0;
    await page.route((url) => url.pathname === "/api/photos", async (route) => {
      calls++;
      await held;
      await route.continue();
    });
    await page.goto("/photos");
    await toBottom(page);
    const more = page.locator("a.more");
    await expect(more).toHaveText("loading older entries…");
    await expect(more).toHaveAttribute("aria-disabled", "true");
    // force: Playwright waits for an aria-disabled link to be enabled; a visitor's click arrives regardless
    await more.click({ force: true });
    await expect(page).toHaveURL(/\/photos$/);
    release();
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    expect(calls).toBe(1);
  });

  test("focus stays where it was when a batch arrives, and the end line keeps it from the link", async ({ page }) => {
    await page.goto("/photos");
    await page.locator("a.frame-link").first().focus();
    await toBottom(page);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("href"))).toBe("/photos/fixture-01");
    // From the link itself: the line that replaces it takes the focus, so it doesn't fall back to the page
    await page.goto("/photos?before=1781392500");
    await page.locator("a.more").focus();
    await toBottom(page);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("more-end");
  });

  test("an appended entry has exactly the server's markup for the same post", async ({ page, browser, baseURL }) => {
    // Tag names, sorted attributes and leaf text: attribute order differs between a clone and a parse, nothing else may
    const shape = (root: Element) => {
      const walk = (el: Element): unknown => [el.tagName.toLowerCase(), [...el.attributes].map((a) => `${a.name}=${a.value}`).sort(), el.children.length > 0 ? [...el.children].map(walk) : el.textContent];
      return JSON.stringify(walk(root));
    };
    const plain = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const server = await plain.newPage();
    // fixture-f is the second entry there, so lazy like an appended one
    await server.goto("/photos?before=1766610000");
    const rendered = await server.locator("#post-fixture-f").evaluate(shape);
    await plain.close();
    await page.goto("/photos");
    await toBottom(page);
    await expect(page.locator("#post-fixture-f")).toHaveCount(1);
    expect(await page.locator("#post-fixture-f").evaluate(shape)).toBe(rendered);
    // The shape holds the two phone sources, so a frame with a missing or different one fails above
    expect(rendered).toContain("(max-width: 680px)");
  });

  test("a cloned entry with several frames and no place has exactly the server's markup too", async ({ page, baseURL }) => {
    const shape = (root: Element) => {
      const walk = (el: Element): unknown => [el.tagName.toLowerCase(), [...el.attributes].map((a) => `${a.name}=${a.value}`).sort(), el.children.length > 0 ? [...el.children].map(walk) : el.textContent];
      return JSON.stringify(walk(root));
    };
    // The cursor after the first post, so the batch starts at fixture-b, which the page already holds as rendered by the server
    const first = (await (await page.request.get(`${baseURL}/api/photos?by=entry&limit=1`)).json()) as { next: number };
    await page.route((url) => url.pathname === "/api/photos", (route) => route.continue({ url: `${baseURL}/api/photos?by=entry&before=${first.next}&limit=4` }));
    await page.goto("/photos");
    await toBottom(page);
    await expect(page.locator("#post-fixture-b")).toHaveCount(2);
    const [rendered, cloned] = await page.locator("#post-fixture-b").evaluateAll((all, source) => all.map((el) => new Function("return " + source)()(el)), shape.toString());
    expect(cloned).toBe(rendered);
    // Two frames, no place: the numbering and the bare date are in what was compared
    expect(cloned).toContain("photo 2 of 2 from 14 june 2026");
    expect(await page.locator("#post-fixture-b .entry-head").nth(1).textContent()).toBe("14.06.26");
  });

  test("a loaded batch takes only the 240s on a phone, as the server's frames do", async ({ page }) => {
    test.skip(page.viewportSize()!.width > 680, "the phone project (a 3× iPhone)");
    await page.goto("/photos", { waitUntil: "networkidle" });
    await toBottom(page);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    await page.waitForLoadState("networkidle");
    const chosen = await page.locator("#post-fixture-c img, #post-fixture-d img, #post-fixture-e img, #post-fixture-f img").evaluateAll((all) => all.map((img) => (img as HTMLImageElement).currentSrc));
    for (const src of chosen) expect(src).toMatch(/\/240\.(avif|webp)$/);
  });

  test("a batch arriving shifts nothing a visitor was looking at", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { shifts: number }).shifts = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          // Counted whether or not the wheel was recent: a batch arrives on its own schedule
          (window as unknown as { shifts: number }).shifts += shift.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/photos", { waitUntil: "networkidle" });
    await toBottom(page);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts)).toBeLessThan(0.01);
  });

  test("a cursor that doesn't advance is a failure: the plain link comes back and nothing more is fetched", async ({ page }) => {
    let calls = 0;
    await page.route((url) => url.pathname === "/api/photos", (route) => {
      calls++;
      return route.fulfill({ json: { entries: [], next: 1781392500 } });
    });
    await page.goto("/photos");
    await toBottom(page);
    await expect.poll(() => calls).toBe(1);
    await expect(page.locator("a.more")).toHaveText("older entries");
    await expect(page.locator("a.more")).not.toHaveAttribute("aria-disabled");
    await page.waitForTimeout(300);
    expect(calls).toBe(1);
  });

  test("when a batch fails the link is a plain link again, and nothing more is fetched", async ({ page }) => {
    let calls = 0;
    await page.route((url) => url.pathname === "/api/photos", (route) => {
      calls++;
      return route.abort();
    });
    await page.goto("/photos");
    await toBottom(page);
    await expect.poll(() => calls).toBe(1);
    const more = page.locator("a.more");
    await expect(more).toHaveText("older entries");
    await expect(more).not.toHaveAttribute("aria-disabled");
    await page.evaluate(() => window.scrollTo(0, 0));
    await toBottom(page);
    await page.waitForTimeout(300);
    expect(calls).toBe(1);
    await more.click();
    await expect(page).toHaveURL(/\/photos\?before=1781392500$/);
    expect(await entryIds(page)).toEqual(["post-fixture-c", "post-fixture-d"]);
  });
});
