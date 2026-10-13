import { beforeEach, expect, test, vi } from "vitest";
import { insertOrder, printDb } from "./prints-fakes";

// The route reads the Worker's env; stand in a store and the fixture secrets
const env = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, PHOTO_PRINTS: {}, PRINTS_OPEN: "true", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_SECRET_KEY: "sk_test_x" }));
vi.mock("cloudflare:workers", () => ({ env }));
vi.stubGlobal("__TEST_HOOKS__", false);
const { POST } = await import("../../src/pages/api/prints/stripe");

const ORDER = "01k6x00000000000000000000a";
const sign = async (body: string, t = Math.floor(Date.now() / 1000)) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_fixture"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${mac}`;
};
const call = async (body: string, signature: string | null) =>
  (await POST({ request: new Request("https://curiousgeorge.dev/api/prints/stripe", { method: "POST", body, headers: signature ? { "Stripe-Signature": signature } : {} }), locals: { cfContext: { waitUntil: () => {} } } } as never)) as Response;

beforeEach(async () => {
  env.DB = await printDb();
});

test("a bad signature is a 400 before the body is read for anything", async () => {
  const response = await call("not json at all", "t=1,v1=00");
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM stripe_events").first("n")).toBe(0);
});

test("a well-formed event with no signature, a wrong one or a stale one is a 400 and changes nothing", async () => {
  await insertOrder(env.DB, { id: ORDER, status: "checkout", stripe_session_id: "cs_test_1", stripe_payment_intent: null, paid_at: null });
  const body = JSON.stringify({ id: "evt_forged", type: "checkout.session.expired", livemode: false, data: { object: { id: "cs_test_1", client_reference_id: ORDER, status: "expired", payment_status: "unpaid" } } });
  const good = await sign(body);
  for (const signature of [null, good.replace(/v1=./, (start) => (start.endsWith("0") ? "v1=1" : "v1=0")), await sign(body, Math.floor(Date.now() / 1000) - 301)]) {
    expect((await call(body, signature)).status).toBe(400);
  }
  expect(await env.DB.prepare("SELECT status FROM print_orders WHERE id = ?").bind(ORDER).first("status")).toBe("checkout");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM stripe_events").first("n")).toBe(0);
});

test("a body past 256KB is a 413", async () => {
  expect((await call("x".repeat(256 * 1024 + 1), "t=1,v1=00")).status).toBe(413);
});

test("a signed body that isn't an event is a 400; a signed event is applied and answered 200", async () => {
  expect((await call("[]", await sign("[]"))).status).toBe(400);
  await insertOrder(env.DB, { id: ORDER, status: "checkout", stripe_session_id: "cs_test_1", stripe_payment_intent: null, paid_at: null });
  const body = JSON.stringify({ id: "evt_route", type: "checkout.session.expired", livemode: false, data: { object: { id: "cs_test_1", client_reference_id: ORDER, metadata: { order_id: ORDER }, status: "expired", payment_status: "unpaid" } } });
  const response = await call(body, await sign(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  expect(await env.DB.prepare("SELECT status FROM print_orders WHERE id = ?").bind(ORDER).first("status")).toBe("expired");
});
