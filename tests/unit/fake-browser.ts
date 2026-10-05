import type { CaptureBrowser, CapturePage, CaptureRequest } from "../../workers/snapshots/src/capture";

/** How a fake site answers: a status and headers, the page's markup, the screenshot or a failure */
export interface FakeSite {
  status?: number;
  headers?: Record<string, string>;
  html?: string;
  /** The screenshot's bytes; 20KB of zeros by default, comfortably over the 10KB floor */
  png?: Uint8Array;
  /** Navigation fails with this error */
  fail?: Error;
  /** Navigation answers with no response at all (puppeteer's null) */
  noResponse?: boolean;
  /** The page never finishes loading */
  neverLoads?: boolean;
  /** The network never goes quiet */
  neverQuiet?: boolean;
  /** The page shows nothing: no text and no media with a box, whatever the screenshot would weigh */
  blank?: boolean;
  /** The browser crashes (a plain error, not a timeout) while waiting for the page to load or go quiet */
  crash?: "load" | "quiet";
  /** Runs while the page is navigating (to change the database mid-capture) */
  during?: () => Promise<void>;
  /** Reading the page throws (an unexpected failure, not a capture verdict) */
  broken?: boolean;
}

/** puppeteer's TimeoutError, which a capture's waits treat as the cap doing its job */
const timeout = (message: string) => Object.assign(new Error(message), { name: "TimeoutError" });

export type FakePage = CapturePage & { calls: string[]; intercept(url: string): Promise<"blocked" | "allowed"> };

/** A Browser Rendering page that answers from `site` instead of the network, and records what it was asked to do */
export function fakePage(site: (url: string) => FakeSite): FakePage {
  const calls: string[] = [];
  let listener: ((request: CaptureRequest) => void) | undefined;
  let current: FakeSite = {};
  const page: FakePage = {
    calls,
    async setViewport(viewport) {
      calls.push(`viewport ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}`);
    },
    async setRequestInterception(on) {
      calls.push(`intercept ${on}`);
    },
    on(_event, handler) {
      listener = handler;
      return page;
    },
    async goto(url, options) {
      calls.push(`goto ${url} ${options.waitUntil} ${options.timeout}`);
      current = site(url);
      await current.during?.();
      if (current.fail) throw current.fail;
      if (current.noResponse) return null;
      return { status: () => current.status ?? 200, headers: () => current.headers ?? {} };
    },
    async waitForFunction(_expression, options) {
      calls.push(`wait load ${options.timeout}`);
      if (current.crash === "load") throw new Error("Target closed");
      if (current.neverLoads) throw timeout("Waiting failed: 15000ms exceeded");
    },
    async waitForNetworkIdle(options) {
      calls.push(`wait quiet ${options.idleTime} ${options.timeout}`);
      if (current.crash === "quiet") throw new Error("Target closed");
      if (current.neverQuiet) throw timeout("Timeout exceeded while waiting for network idle");
    },
    async evaluate() {
      calls.push("evaluate");
      return !current.blank;
    },
    async content() {
      if (current.broken) throw new Error("Target closed");
      return current.html ?? "<html><head><title>a page</title></head><body>hello</body></html>";
    },
    async screenshot() {
      calls.push("shot");
      return current.png ?? new Uint8Array(20 * 1024);
    },
    async close() {
      calls.push("close");
    },
    async intercept(url) {
      let outcome: "blocked" | "allowed" = "allowed";
      listener!({
        url: () => url,
        abort: async () => {
          outcome = "blocked";
        },
        continue: async () => {
          outcome = "allowed";
        },
      });
      await Promise.resolve();
      return outcome;
    },
  };
  return page;
}

/** A browser session whose pages answer from `site`; counts launches of pages and whether it was closed */
export function fakeBrowser(site: (url: string) => FakeSite) {
  const pages: FakePage[] = [];
  const browser: CaptureBrowser & { pages: FakePage[]; closed: boolean } = {
    pages,
    closed: false,
    async newPage() {
      const page = fakePage(site);
      pages.push(page);
      return page;
    },
    async close() {
      browser.closed = true;
    },
  };
  return browser;
}
