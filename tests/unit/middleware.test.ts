import { afterEach, describe, expect, test, vi } from "vitest";

// The middleware imports two virtual modules and reads a build-time constant; stand them in
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.stubGlobal("__ADMIN_BYPASS__", true);

const { onRequest } = (await import("../../src/middleware")) as unknown as {
  onRequest: (context: { request: Request; url: URL; locals: Record<string, unknown> }, next: () => Promise<Response>) => Promise<Response>;
};

const run = (path: string, next: () => Promise<Response>) => {
  const url = new URL(`http://localhost${path}`);
  return onRequest({ request: new Request(url), url, locals: {} }, next);
};

afterEach(() => vi.restoreAllMocks());

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
