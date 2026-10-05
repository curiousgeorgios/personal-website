import { expect, test } from "@playwright/test";

// HTTP behaviour, checked once. The local test build has no PostHog key, so accepted events are dropped, not sent.
test.skip(({ browserName }) => browserName !== "chromium", "HTTP behaviour, checked once");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "would send events to PostHog from the live site");

const event = (name: string) => JSON.stringify({ event: name, properties: {} });

test("the proxy takes the beacon's events with a 204 and sets nothing", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", { data: event("$pageview"), headers: { Origin: new URL(baseURL!).origin, "Content-Type": "text/plain" } });
  expect(response.status()).toBe(204);
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("events the logbook doesn't send are refused", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", { data: event("$identify"), headers: { Origin: new URL(baseURL!).origin } });
  expect(response.status()).toBe(400);
});

test("a body over 32KB is refused with a 413 and never cached", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", { data: "x".repeat(40 * 1024), headers: { Origin: new URL(baseURL!).origin } });
  expect(response.status()).toBe(413);
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("a body that isn't JSON is refused", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", { data: "not json", headers: { Origin: new URL(baseURL!).origin } });
  expect(response.status()).toBe(400);
});

test("anything else under /ingest is a 404", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  expect((await request.get("/ingest/i/v0/e/")).status()).toBe(404);
  expect((await request.get("/ingest/")).status()).toBe(404);
  expect((await request.post("/ingest/decide/", { data: "{}", headers: { Origin: origin } })).status()).toBe(404);
});

test("a beacon from another site is refused before it reaches the proxy", async ({ baseURL }) => {
  const url = new URL("/ingest/i/v0/e/", baseURL!);
  // Node's fetch sends no Origin unless asked, unlike a browser; check both a missing one and a foreign one
  expect((await fetch(url, { method: "POST", body: event("$pageview") })).status).toBe(403);
  expect((await fetch(url, { method: "POST", body: event("$pageview"), headers: { Origin: "https://example.com" } })).status).toBe(403);
});
