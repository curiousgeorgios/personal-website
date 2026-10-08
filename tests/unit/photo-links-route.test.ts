import { beforeEach, expect, test, vi } from "vitest";
import { verifyPhotoToken } from "../../src/lib/photos/tokens";
import { sqliteD1 } from "./sqlite-d1";

// The route reads the Worker's env; stand in the fixture key and a D1 over the real migrations
const env = vi.hoisted(() => ({ PHOTO_LINK_SECRET: "1".repeat(64), DB: undefined as unknown as D1Database }));
vi.mock("cloudflare:workers", () => ({ env }));
const { POST, DELETE } = await import("../../src/pages/admin/photos/links");

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

const revoke = async (id: string) =>
  DELETE({ url: new URL(`${ROUTE}?grantId=${id}`) } as unknown as Parameters<typeof DELETE>[0]) as Promise<Response>;

test("revoking switches a catalogue link off, once", async () => {
  const { grantId } = (await (await call({})).json()) as { grantId: string };
  expect((await revoke(grantId)).status).toBe(200);
  expect(await env.DB.prepare("SELECT revoked_at FROM photo_download_grants WHERE id = ?").bind(grantId).first("revoked_at")).not.toBeNull();
  expect((await revoke(grantId)).status).toBe(404);
});

test("a photo-scoped grant can't be revoked here: it answers as if there were none, and stays working", async () => {
  await env.DB.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES ('fixture-01', 'fx', 1, '', 1, '[]', 'k', 1, 1, 1, 's')").run();
  const order = "b0000000-0000-4000-8000-000000000001";
  await env.DB.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES (?, 'fixture-01', 9999999999)").bind(order).run();
  const refused = await revoke(order);
  const unknown = await revoke("b0000000-0000-4000-8000-000000000002");
  expect([refused.status, await refused.json()]).toEqual([unknown.status, await unknown.json()]);
  expect(refused.status).toBe(404);
  expect(await env.DB.prepare("SELECT revoked_at FROM photo_download_grants WHERE id = ?").bind(order).first("revoked_at")).toBeNull();
});
