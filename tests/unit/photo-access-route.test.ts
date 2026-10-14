import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sqliteD1 } from "./sqlite-d1";
import { photoAccessFixture } from "./photo-access-fixture";

const env = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, PHOTO_LINK_SECRET: "1".repeat(64) as string | undefined }));
vi.mock("cloudflare:workers", () => ({ env }));
const { GET, POST, DELETE } = await import("../../src/pages/admin/photos/access");
const downloads = await import("../../src/pages/api/photos/downloads");
const ORIGIN = "https://curiousgeorge.dev";
const approve = (body: unknown) => POST({ request: new Request(`${ORIGIN}/admin/photos/access`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(body) }) } as Parameters<typeof POST>[0]) as Promise<Response>;

beforeEach(() => { env.DB = sqliteD1(); env.PHOTO_LINK_SECRET = "1".repeat(64); });
afterEach(() => vi.restoreAllMocks());

test("owner API validates input, normalises addresses, lists privately and revokes", async () => {
  for (const body of [null, [], {}, { email: "bad" }]) expect((await approve(body)).status).toBe(400);
  const response = await approve({ email: " Recipient@EXAMPLE.test " });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const { approval } = await response.json() as { approval: { id: string; email: string; createdAt: number } };
  expect(approval.email).toBe("recipient@example.test");
  expect(await (await approve({ email: "recipient@example.test" })).json()).toEqual({ approval });
  const list = await GET({} as Parameters<typeof GET>[0]) as Response;
  expect(await list.json()).toEqual({ approvals: [approval] });
  const revoked = await DELETE({ url: new URL(`${ORIGIN}/admin/photos/access?id=${approval.id}`) } as Parameters<typeof DELETE>[0]) as Response;
  expect(revoked.status).toBe(200);
  expect(await (await GET({} as Parameters<typeof GET>[0]) as Response).json()).toEqual({ approvals: [] });
});

test("an unset signing key fails closed without logging an address", async () => {
  env.PHOTO_LINK_SECRET = undefined;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await approve({ email: "recipient@example.test" })).status).toBe(503);
  expect(log.mock.calls).toEqual([["photos: approval unavailable"]]);
});

test("private catalogue requires a cookie session and has token-free file URLs", async () => {
  const call = (request: Request) => downloads.GET({ request, url: new URL(request.url) } as Parameters<typeof downloads.GET>[0]) as Promise<Response>;
  expect((await call(new Request(`${ORIGIN}/api/photos/downloads?token=legacy`))).status).toBe(403);
  const now = Math.floor(Date.now() / 1000);
  const { cookie } = await photoAccessFixture(env.DB, env.PHOTO_LINK_SECRET!, now);
  await env.DB.prepare("INSERT INTO photo_posts (collection, published_at, published_on) VALUES ('test', 100, '2026-10-01')").run();
  await env.DB.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES ('test-01', 'test', 1, '', 1, '[]', 'prints/private.jpg', 3000, 4000, 10000, 'sha')").run();
  const response = await call(new Request(`${ORIGIN}/api/photos/downloads`, { headers: { Cookie: cookie } }));
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(JSON.parse(text).photos[0].downloadUrl).toBe("/photos/downloads/test-01");
  expect(text).not.toMatch(/token=|prints\/|recipient@/);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
