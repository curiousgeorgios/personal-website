import type { SnapshotStatus } from "../../../src/lib/snapshots";

// The slice of a Browser Rendering page a capture uses; @cloudflare/puppeteer's Page provides all of it
export interface CaptureRequest {
  url(): string;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}
export interface CaptureResponse {
  status(): number;
  headers(): Record<string, string>;
}
export interface CapturePage {
  setViewport(viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setRequestInterception(on: boolean): Promise<void>;
  on(event: "request", handler: (request: CaptureRequest) => void): unknown;
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<CaptureResponse | null>;
  waitForFunction(expression: string, options: { timeout: number }): Promise<unknown>;
  waitForNetworkIdle(options: { idleTime: number; timeout: number }): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  content(): Promise<string>;
  screenshot(options: { type: "png" }): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface CaptureBrowser {
  newPage(): Promise<CapturePage>;
  close(): Promise<void>;
}

export type CaptureResult = { status: "ok"; png: Uint8Array } | { status: Exclude<SnapshotStatus, "ok">; detail: string };

export const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };
export const CAP_MS = 15_000;
export const QUIET_MS = 1_500;
/**
 * Spec 9: a screenshot under 10KB is never a snapshot. Only a backstop: a blank page at this size encodes to about
 * 19KB, over the floor, so blankness is judged from the page itself (SHOWS_SOMETHING) before the shot.
 */
export const MIN_BYTES = 10 * 1024;
// Analytics are never reached, so a capture isn't counted as a visit on George's other sites (spec 9): the known hosts
// (a suffix match, so region1.analytics.google.com and the like are covered), and a first-party PostHog proxy at
// /ingest/ on any host (as this site has)
const BLOCKED_HOSTS = [
  /(^|\.)posthog\.com$/,
  /(^|\.)google-analytics\.com$/,
  /(^|\.)analytics\.google\.com$/,
  /(^|\.)stats\.g\.doubleclick\.net$/,
  /(^|\.)googletagmanager\.com$/,
  /(^|\.)facebook\.(com|net)$/,
];

export function isBlocked(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return BLOCKED_HOSTS.some((pattern) => pattern.test(hostname)) || pathname.startsWith("/ingest/");
  } catch {
    return false;
  }
}

// Cloudflare's challenge page, for when the status and header don't give it away: its inline options object or its title.
// Not the /cdn-cgi/challenge-platform/ path, which JavaScript detections inject into ordinary 200 pages as well
const looksLikeChallenge = (html: string) => html.includes("_cf_chl_opt") || /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(html);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Whether the page shows anything: some text, media with a box or a CSS background (an image or a gradient) on the page
// itself or on an element with a box. A blank 2x screenshot is too big for MIN_BYTES to catch, so the page is asked
export const SHOWS_SOMETHING = `(() => {
  const body = document.body;
  if (!body) return false;
  if (body.innerText.trim() !== "") return true;
  const shown = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  if ([...document.querySelectorAll("img, svg, canvas, video, picture, iframe, object, embed")].some(shown)) return true;
  const painted = (element) => getComputedStyle(element).backgroundImage !== "none";
  return painted(document.documentElement) || painted(body) || [...body.querySelectorAll("*")].some((element) => shown(element) && painted(element));
})()`;

// A wait that runs out is the capture cap doing its job (puppeteer's TimeoutError); anything else is unexpected, so it's thrown
const unlessTimeout = (error: unknown) => {
  if (error instanceof Error && error.name === "TimeoutError") return;
  throw error;
};

/**
 * Captures one page (spec 9): 1440 × 900 CSS px at scale 2, after load and a 1.5s quiet period, shot at the 15s cap
 * even if the page never goes quiet. Fails only on a navigation error, a non-2xx status, a Cloudflare challenge, a page
 * that shows nothing (asked of the page, before the shot) or a screenshot under 10KB (a backstop), and the caller keeps
 * the previous snapshot then. Anything unexpected is thrown.
 */
export async function capture(browser: CaptureBrowser, url: string, now: () => number = Date.now): Promise<CaptureResult> {
  const start = now();
  // Never 0: puppeteer reads a timeout of 0 as "wait for ever"
  const left = () => Math.max(1, CAP_MS - (now() - start));
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      void (isBlocked(request.url()) ? request.abort("blockedbyclient") : request.continue()).catch(() => {});
    });
    let response: CaptureResponse | null;
    try {
      // The document's own arrival is the navigation; load and quiet are waited for below, within the same cap
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: CAP_MS });
    } catch (error) {
      return { status: "navigation-error", detail: message(error) };
    }
    if (!response) return { status: "navigation-error", detail: "no response" };
    if (response.headers()["cf-mitigated"] === "challenge") return { status: "challenge", detail: "cf-mitigated: challenge" };
    const status = response.status();
    if (status < 200 || status > 299) return { status: "http-error", detail: `status ${status}` };
    // A page whose load or network never settles is shot as it stands at the cap
    await page.waitForFunction("document.readyState === 'complete'", { timeout: left() }).catch(unlessTimeout);
    await page.waitForNetworkIdle({ idleTime: QUIET_MS, timeout: left() }).catch(unlessTimeout);
    if (looksLikeChallenge(await page.content())) return { status: "challenge", detail: "a challenge page" };
    if (!(await page.evaluate(SHOWS_SOMETHING))) return { status: "too-small", detail: "a blank page" };
    const png = await page.screenshot({ type: "png" });
    if (png.byteLength < MIN_BYTES) return { status: "too-small", detail: `${png.byteLength} bytes` };
    return { status: "ok", png };
  } finally {
    await page.close().catch(() => {});
  }
}
