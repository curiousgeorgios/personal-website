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
/** Spec 9: a capture under 10KB is a blank page, not a snapshot */
export const MIN_BYTES = 10 * 1024;
// Analytics are never reached, so a capture isn't counted as a visit on George's other sites (spec 9): the known hosts,
// and a first-party PostHog proxy at /ingest/ on any host (as this site has)
const BLOCKED_HOSTS = [/(^|\.)posthog\.com$/, /(^|\.)google-analytics\.com$/, /(^|\.)googletagmanager\.com$/, /(^|\.)facebook\.(com|net)$/];

export function isBlocked(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return BLOCKED_HOSTS.some((pattern) => pattern.test(hostname)) || pathname.startsWith("/ingest/");
  } catch {
    return false;
  }
}

// Cloudflare's challenge page, for when the status and header don't give it away
const looksLikeChallenge = (html: string) => html.includes("/cdn-cgi/challenge-platform/") || /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(html);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Captures one page (spec 9): 1440 × 900 CSS px at scale 2, after load and a 1.5s quiet period, shot at the 15s cap
 * even if the page never goes quiet. Fails only on a navigation error, a non-2xx status, a Cloudflare challenge or a
 * screenshot under 10KB, and the caller keeps the previous snapshot then. Anything unexpected is thrown.
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
    await page.waitForFunction("document.readyState === 'complete'", { timeout: left() }).catch(() => {});
    await page.waitForNetworkIdle({ idleTime: QUIET_MS, timeout: left() }).catch(() => {});
    if (looksLikeChallenge(await page.content())) return { status: "challenge", detail: "a challenge page" };
    const png = await page.screenshot({ type: "png" });
    if (png.byteLength < MIN_BYTES) return { status: "too-small", detail: `${png.byteLength} bytes` };
    return { status: "ok", png };
  } finally {
    await page.close().catch(() => {});
  }
}
