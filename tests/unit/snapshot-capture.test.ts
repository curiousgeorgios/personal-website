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

  test.each([
    ["a navigation error", { fail: new Error("net::ERR_NAME_NOT_RESOLVED") }, "navigation-error"],
    ["a page that doesn't arrive within 15s", { fail: new Error("Navigation timeout of 15000 ms exceeded") }, "navigation-error"],
    ["a 404", { status: 404 }, "http-error"],
    ["a 503", { status: 503 }, "http-error"],
    ["a challenge header", { status: 403, headers: { "cf-mitigated": "challenge" } }, "challenge"],
    ["a challenge page served with a 200", { html: "<html><head><title>Just a moment...</title></head></html>" }, "challenge"],
    ["the challenge platform's script", { html: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>' }, "challenge"],
    ["a blank page", { png: new Uint8Array(4_000) }, "too-small"],
  ])("fails on %s, without shooting, and closes the page", async (_name, site, status) => {
    const { browser, result } = shoot(site as FakeSite);
    const outcome = await result;
    expect(outcome.status).toBe(status);
    expect(outcome).toHaveProperty("detail");
    expect(browser.pages[0].calls.at(-1)).toBe("close");
    if (status !== "too-small") expect(browser.pages[0].calls).not.toContain("shot");
  });

  test("an unexpected failure is thrown, and the page still closes", async () => {
    const { browser, result } = shoot({ broken: true });
    await expect(result).rejects.toThrow("Target closed");
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
      "https://digitalnachos.com.au/ingest/i/v0/e/",
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
