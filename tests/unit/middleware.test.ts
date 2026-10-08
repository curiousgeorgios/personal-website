import { afterEach, describe, expect, test, vi } from "vitest";
import { isPrivatePath } from "../../src/lib/photos/http";

// The middleware imports two virtual modules and reads a build-time constant; stand them in
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("cloudflare:workers", () => ({ env: { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud-123", ADMIN_EMAIL: "hello@curiousgeorge.dev" } }));
// The Access check itself is gate.test.ts's; here it's stubbed to see what the middleware passes it and does with the answer
const { adminIdentity } = vi.hoisted(() => ({ adminIdentity: vi.fn() }));
vi.mock("../../src/lib/admin/gate", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../src/lib/admin/gate")>()), adminIdentity }));
vi.stubGlobal("__ADMIN_BYPASS__", true);

const { onRequest } = (await import("../../src/middleware")) as unknown as {
  onRequest: (context: { request: Request; url: URL; locals: Record<string, unknown> }, next: () => Promise<Response>) => Promise<Response>;
};

const run = (path: string, next: () => Promise<Response>) => {
  const url = new URL(`http://localhost${path}`);
  return onRequest({ request: new Request(url), url, locals: {} }, next);
};

afterEach(() => vi.restoreAllMocks());

test("private photo paths cannot inherit public cache headers or leak a token as a referrer", async () => {
  for (const path of ["/photos/downloads/fixture-01?token=private", "/photos/downloads?token=private", "/api/photos/downloads?token=private"]) {
    const response = await run(path, () => Promise.resolve(new Response("ok", { headers: { "Cache-Control": "public, max-age=999", "Cache-Tag": "photos" } })));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.has("Cache-Tag")).toBe(false);
  }
});

test("the private paths are the downloads page, its files and the JSON catalogue, and nothing else", () => {
  for (const path of ["/photos/downloads", "/photos/downloads/", "/photos/downloads/fixture-01", "/api/photos/downloads", "/api/photos/downloads/"]) expect(isPrivatePath(path)).toBe(true);
  for (const path of ["/photos", "/photos/fixture-01", "/photos/downloadsx", "/api/photos", "/api/photos/downloadsx"]) expect(isPrivatePath(path)).toBe(false);
});

test("a failed private photo route retains cache exclusion", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await run("/photos/downloads/fixture-01", () => Promise.reject(new Error("down")));
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

describe("middleware, when the page throws", () => {
  test("/admin answers a plain 500 that still carries the admin and security headers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await run("/admin/", () => Promise.reject(new Error("D1 is down")));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("the admin page couldn't load. try again.");
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(error).toHaveBeenCalledWith("admin: the page failed to render", expect.any(Error));
  });

  test("the public pages keep their behaviour: the error is not caught", async () => {
    await expect(run("/", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

test("a page that renders is passed through with the admin headers", async () => {
  const response = await run("/admin/", () => Promise.resolve(new Response("<p>ok</p>", { headers: { "Cache-Tag": "logbook" } })));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("<p>ok</p>");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.has("Cache-Tag")).toBe(false);
});

test("under the local bypass the admin is signed in with no session end", async () => {
  const url = new URL("http://localhost/admin/");
  const locals: Record<string, unknown> = {};
  await onRequest({ request: new Request(url), url, locals }, () => Promise.resolve(new Response("ok")));
  expect(locals).toEqual({ adminEmail: "admin-bypass@localhost" });
});

describe("middleware, without the local bypass", () => {
  const onProduction = (path = "/admin/") => {
    const url = new URL(`https://curiousgeorge.dev${path}`);
    const locals: Record<string, unknown> = {};
    const request = new Request(url);
    return { locals, request, response: onRequest({ request, url, locals }, () => Promise.resolve(new Response("ok"))) };
  };

  afterEach(() => vi.stubGlobal("__ADMIN_BYPASS__", true));

  test("passes the Access settings and ADMIN_EMAIL to the check, and records who and until when", async () => {
    vi.stubGlobal("__ADMIN_BYPASS__", false);
    adminIdentity.mockResolvedValueOnce({ email: "hello@curiousgeorge.dev", expires: 1793768400 });
    const { locals, request, response } = onProduction();
    expect((await response).status).toBe(200);
    expect(adminIdentity).toHaveBeenCalledWith(request, { teamDomain: "team.cloudflareaccess.com", audience: "aud-123", adminEmail: "hello@curiousgeorge.dev" });
    expect(locals).toEqual({ adminEmail: "hello@curiousgeorge.dev", adminUntil: 1793768400 });
  });

  test("a refused identity is a 403 with no one signed in", async () => {
    vi.stubGlobal("__ADMIN_BYPASS__", false);
    adminIdentity.mockResolvedValueOnce(null);
    const { locals, response } = onProduction();
    expect((await response).status).toBe(403);
    expect(locals).toEqual({});
  });

  test("a build with the bypass still asks Access off this machine", async () => {
    adminIdentity.mockResolvedValueOnce(null);
    const { response } = onProduction();
    expect((await response).status).toBe(403);
  });
});
