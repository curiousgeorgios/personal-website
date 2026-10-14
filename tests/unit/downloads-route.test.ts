import { afterEach, expect, test, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { DownloadsView } from "../../src/lib/photos/gallery";

// The page's one decision is photoDownloadsView's (downloads-view.ts): stood in here, so these check the page around it,
// its status, headers and log line, whatever the session logic does
const view = vi.hoisted(() => ({ next: (): Promise<DownloadsView> => Promise.resolve({ state: "signin" }) }));
vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("../../src/lib/photos/downloads-view", () => ({ photoDownloadsView: () => view.next() }));
const { default: page } = await import("../../src/pages/photos/downloads/index.astro");

afterEach(() => vi.restoreAllMocks());

const get = async () => {
  const container = await AstroContainer.create();
  return container.renderToResponse(page, { request: new Request("https://curiousgeorge.dev/photos/downloads", { headers: { cookie: "__Host-photo-session=secret-session" } }) });
};
const privately = (response: Response) => {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
};

test("a browser without a session gets the sign-in at 200, privately, whatever the reason", async () => {
  view.next = () => Promise.resolve({ state: "signin" });
  const response = await get();
  expect(response.status).toBe(200);
  privately(response);
  const html = await response.text();
  expect(html).toContain('id="access-email"');
  expect(html).not.toContain("download-list");
});

test("a signed-in browser gets its list at 200, privately", async () => {
  view.next = () => Promise.resolve({ state: "ok", entries: [], expiresAt: 1793158200 });
  const response = await get();
  expect(response.status).toBe(200);
  privately(response);
  // Intl's time can carry a narrow no-break space before pm
  expect((await response.text()).replace(/\s+/g, " ")).toContain("this browser is signed in until 28.10.26, 2:30 pm sydney time.");
});

test("a failure answers 503 with private headers, and logs a fixed line that names no session", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  view.next = () => Promise.reject(new Error("D1_ERROR: down for secret-session"));
  const response = await get();
  expect(response.status).toBe(503);
  privately(response);
  expect(await response.text()).toContain("downloads aren't working right now");
  expect(log.mock.calls).toEqual([["photos: the downloads page is unavailable"]]);
});
