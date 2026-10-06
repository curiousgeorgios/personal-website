import { describe, expect, test } from "vitest";
import { capture, isBlocked } from "../../workers/snapshots/src/capture";
import { fakeBrowser, type FakeSite } from "./fake-browser";

const URL_ = "https://canberra.events/";
const shoot = (site: FakeSite, now?: () => number) => {
  const browser = fakeBrowser(() => site);
  return { browser, result: capture(browser, URL_, now ?? (() => 0)) };
};

describe("capture", () => {
  test("shoots 1440 × 900 at scale 2 once the page has loaded and gone quiet for 1.5s", async () => {
    const png = new Uint8Array(30_000);
    const { browser, result } = shoot({ png });
    expect(await result).toEqual({ status: "ok", png });
    expect(browser.pages[0].calls).toEqual([
      "viewport 1440x900@2",
      "intercept true",
      `goto ${URL_} domcontentloaded 15000`,
      "wait load 15000",
      "wait quiet 1500 15000",
      "evaluate",
      "shot",
      "close",
    ]);
    expect(browser.closed).toBe(false); // the caller owns the browser
  });

  test("a page that never goes quiet is shot at the 15s cap", async () => {
    const times = [0, 14_000, 15_500];
    const { browser, result } = shoot({ neverQuiet: true }, () => times.shift() ?? 15_500);
    expect((await result).status).toBe("ok");
    expect(browser.pages[0].calls).toContain("wait load 1000");
    expect(browser.pages[0].calls).toContain("wait quiet 1500 1");
  });

  test("a page that never finishes loading is shot at the cap too", async () => {
    const { browser, result } = shoot({ neverLoads: true });
    expect((await result).status).toBe("ok");
    expect(browser.pages[0].calls).toContain("shot");
  });

  test("a 200 page carrying Cloudflare's JavaScript detections is a page, not a challenge", async () => {
    const html = '<html><head><title>digital nachos</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head><body>hello</body></html>';
    const png = new Uint8Array(30_000);
    const { result } = shoot({ html, png });
    expect(await result).toEqual({ status: "ok", png });
  });

  test.each([
    ["a navigation error", { fail: new Error("net::ERR_NAME_NOT_RESOLVED") }, "navigation-error"],
    ["a page that doesn't arrive within 15s", { fail: new Error("Navigation timeout of 15000 ms exceeded") }, "navigation-error"],
    ["no response at all", { noResponse: true }, "navigation-error"],
    ["a 404", { status: 404 }, "http-error"],
    ["a 503", { status: 503 }, "http-error"],
    ["a 403 with no challenge header", { status: 403 }, "http-error"],
    ["a challenge header", { status: 403, headers: { "cf-mitigated": "challenge" } }, "challenge"],
    ["a challenge page served with a 200", { html: "<html><head><title>Just a moment...</title></head></html>" }, "challenge"],
    ["a challenge page's inline options", { html: "<script>window._cf_chl_opt = { cvId: '3', cType: 'managed' };</script>" }, "challenge"],
  ])("fails on %s, without shooting, and closes the page", async (_name, site, status) => {
    const { browser, result } = shoot(site as FakeSite);
    const outcome = await result;
    expect(outcome.status).toBe(status);
    expect(outcome).toHaveProperty("detail");
    expect(browser.pages[0].calls).not.toContain("shot");
    expect(browser.pages[0].calls.at(-1)).toBe("close");
  });

  test("a page that shows nothing is too small whatever a screenshot of it would weigh, and isn't shot", async () => {
    // A blank page at 1440 x 900 @2 encodes to about 19KB, well over the 10KB floor, so it's the page that's asked
    const { browser, result } = shoot({ blank: true, png: new Uint8Array(19_000) });
    expect(await result).toEqual({ status: "too-small", detail: "a blank page" });
    expect(browser.pages[0].calls).toEqual([
      "viewport 1440x900@2",
      "intercept true",
      `goto ${URL_} domcontentloaded 15000`,
      "wait load 15000",
      "wait quiet 1500 15000",
      "evaluate",
      "close",
    ]);
  });

  test("a screenshot under 10KB is still too small, as a backstop", async () => {
    const { browser, result } = shoot({ png: new Uint8Array(4_000) });
    expect(await result).toEqual({ status: "too-small", detail: "4000 bytes" });
    expect(browser.pages[0].calls.slice(-2)).toEqual(["shot", "close"]);
  });

  test("an unexpected failure is thrown, and the page still closes", async () => {
    const { browser, result } = shoot({ broken: true });
    await expect(result).rejects.toThrow("Target closed");
    expect(browser.pages[0].calls.at(-1)).toBe("close");
  });

  test.each(["load", "quiet"] as const)("a crash while waiting for the page to %s is thrown, not shot as a page that never settled", async (crash) => {
    const { browser, result } = shoot({ crash });
    await expect(result).rejects.toThrow("Target closed");
    expect(browser.pages[0].calls).not.toContain("shot");
    expect(browser.pages[0].calls.at(-1)).toBe("close");
  });

  test("blocks analytics hosts, so a capture isn't counted as a visit, and lets the page's own requests through", async () => {
    const browser = fakeBrowser(() => ({}));
    await capture(browser, URL_, () => 0);
    const page = browser.pages[0];
    for (const url of [
      "https://us-assets.i.posthog.com/static/array.js",
      "https://us.i.posthog.com/e/",
      "https://www.google-analytics.com/g/collect",
      "https://www.googletagmanager.com/gtag/js?id=G-1",
      "https://connect.facebook.net/en_US/fbevents.js",
      "https://www.facebook.com/tr?id=1",
      "https://analytics.google.com/g/collect",
      "https://region1.analytics.google.com/g/collect",
      "https://stats.g.doubleclick.net/g/collect",
      "https://digitalnachos.com.au/ingest/i/v0/e/",
      "https://canberra.events/ingest/i/v0/e/",
    ]) {
      expect(await page.intercept(url), url).toBe("blocked");
    }
    for (const url of ["https://canberra.events/app.js", "https://fonts.googleapis.com/css2", "https://cdn.example.com/x.png", "https://canberra.events/ingest-guide"]) {
      expect(await page.intercept(url), url).toBe("allowed");
    }
  });
});

test("isBlocked takes a malformed URL as not blocked", () => {
  expect(isBlocked("not a url")).toBe(false);
});

// Hosts are matched whole, so a lookalike that merely contains an analytics name is a different site and still loads
test.each([
  "https://notposthog.com/",
  "https://posthog.com.example/",
  "https://www.googletagmanager.com.evil.example/",
  "https://evil-google-analytics.com/",
  "https://analytics.google.com.example/",
  "https://notfacebook.com/",
])("isBlocked lets the lookalike %s through", (url) => {
  expect(isBlocked(url)).toBe(false);
});

test("isBlocked stops /ingest/ on any host but not /ingest on its own or a path that only starts with it", () => {
  expect(isBlocked("https://example.com/ingest/")).toBe(true);
  expect(isBlocked("https://example.com/ingest/i/v0/e/")).toBe(true);
  expect(isBlocked("https://example.com/ingest")).toBe(false);
  expect(isBlocked("https://example.com/ingest-guide")).toBe(false);
});
