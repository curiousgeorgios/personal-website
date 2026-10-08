import { beforeEach, expect, test, vi } from "vitest";
import { verifyPhotoToken } from "../../src/lib/photos/tokens";
import { sqliteD1 } from "./sqlite-d1";

// The route reads the Worker's env; stand in the fixture key and a D1 over the real migrations
const env = vi.hoisted(() => ({ PHOTO_LINK_SECRET: "1".repeat(64), DB: undefined as unknown as D1Database }));
vi.mock("cloudflare:workers", () => ({ env }));
const { POST } = await import("../../src/pages/admin/photos/links");

const ROUTE = "https://curiousgeorge.dev/admin/photos/links";
const call = async (body: unknown) =>
  POST({ request: new Request(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), url: new URL(ROUTE) } as unknown as Parameters<typeof POST>[0]) as Promise<Response>;

beforeEach(() => {
  env.DB = sqliteD1();
});

test("a photo id is refused: photo links are internal, and nothing is granted", async () => {
  const response = await call({ photoId: "fixture-01" });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "photo links are internal" });
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM photo_download_grants").first("n"))).toBe(0);
});

test("a catalogue link points at the downloads page, signed for its grant", async () => {
  const response = await call({ expiresInSeconds: 3600 });
  expect(response.status).toBe(201);
  const link = (await response.json()) as { grantId: string; expiresAt: number; url: string };
  const url = new URL(link.url);
  expect(`${url.origin}${url.pathname}`).toBe("https://curiousgeorge.dev/photos/downloads");
  expect(await verifyPhotoToken(env.PHOTO_LINK_SECRET, url.searchParams.get("token")!)).toEqual({ grantId: link.grantId, photoId: null, expiresAt: link.expiresAt });
  expect(await env.DB.prepare("SELECT photo_id FROM photo_download_grants WHERE id = ?").bind(link.grantId).first("photo_id")).toBeNull();
});
