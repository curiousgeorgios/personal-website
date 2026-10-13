import { afterEach, expect, test, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { signPhotoToken } from "../../src/lib/photos/tokens";

// The page reads the Worker's env; a missing key and a D1 that throws stand in for a Worker that can't verify or read
const env = vi.hoisted(() => ({ PHOTO_LINK_SECRET: "1".repeat(64) as string | undefined, DB: undefined as unknown as D1Database }));
vi.mock("cloudflare:workers", () => ({ env }));
const { default: page } = await import("../../src/pages/photos/downloads/index.astro");

afterEach(() => vi.restoreAllMocks());

const get = async (token = "secret-token") => {
  const container = await AstroContainer.create();
  return container.renderToResponse(page, { request: new Request(`https://curiousgeorge.dev/photos/downloads?token=${encodeURIComponent(token)}`) });
};

test("a Worker without its signing key answers 503 with private headers, and logs nothing that could hold the token", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  env.PHOTO_LINK_SECRET = undefined;
  const response = await get();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await response.text()).toContain("downloads aren't working right now");
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
});

test("a D1 that fails on a valid link answers the same 503, and logs a fixed line", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  env.PHOTO_LINK_SECRET = "1".repeat(64);
  env.DB = { prepare: () => { throw new Error("D1_ERROR: down"); } } as unknown as D1Database;
  const token = await signPhotoToken(env.PHOTO_LINK_SECRET, { grantId: crypto.randomUUID(), photoId: null, expiresAt: Math.floor(Date.now() / 1000) + 600 });
  const response = await get(token);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(log.mock.calls).toEqual([["photos: the downloads page is unavailable"]]);
});
