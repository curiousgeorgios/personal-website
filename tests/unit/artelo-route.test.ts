import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { captureLogs, dumpDb, insertOrder, printDb } from "./prints-fakes";

const env = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, PHOTO_PRINTS: {}, ARTELO_WEBHOOK_SECRET: "artelo-fixture-webhook-secret" }));
vi.mock("cloudflare:workers", () => ({ env }));
vi.stubGlobal("__TEST_HOOKS__", false);
const { POST } = await import("../../src/pages/api/prints/artelo");

const ORDER = "01k6x00000000000000000000a";
const sign = (text: string) => createHmac("sha256", "artelo-fixture-webhook-secret").update(text).digest("hex");
const call = async (body: string, signature: string | null = sign(body)) =>
  (await POST({ request: new Request("https://curiousgeorge.dev/api/prints/artelo", { method: "POST", body, headers: signature ? { "x-artelo-signature": signature } : {} }), locals: { cfContext: { waitUntil: () => {} } } } as never)) as Response;

beforeEach(async () => {
  env.DB = await printDb();
  await insertOrder(env.DB, { id: ORDER, status: "placed", artelo_order_id: "artelo-1" });
});
afterEach(() => vi.restoreAllMocks());

test("a mismatched signature answers 400 with artelo's own code, and nothing is read", async () => {
  const response = await call('{"orderId":"artelo-1","status":"Shipped"}', "00");
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "invalid_signature" });
  expect(await env.DB.prepare("SELECT status FROM print_orders").first("status")).toBe("placed");
});

test("a body past 64KB is a 413", async () => {
  expect((await call("x".repeat(64 * 1024 + 1))).status).toBe(413);
});

test("a signed update is applied and remembered as heard", async () => {
  const response = await call(JSON.stringify({ data: { orderId: "artelo-1", status: "InProduction" } }));
  expect(response.status).toBe(200);
  expect(await env.DB.prepare("SELECT status FROM print_orders").first("status")).toBe("in_production");
  expect(Number(await env.DB.prepare("SELECT value FROM print_settings WHERE key = 'artelo_webhook_at'").first("value"))).toBeGreaterThan(0);
});

test("a signed body it can't read, or for an unknown order, still answers 200 and logs only the body's keys", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect((await call(JSON.stringify({ event: "ping", secretThing: "Ada Lovelace" }))).status).toBe(200);
  expect((await call(JSON.stringify({ orderId: "artelo-404", status: "Shipped" }))).status).toBe(200);
  expect(warn.mock.calls.map((args) => args.join(" "))).toEqual([
    "prints: an artelo webhook couldn't be read; its keys: event, secretThing",
    "prints: an artelo webhook named an unknown order; its keys: orderId, status",
  ]);
});

// The rulings for a public webhook (task 11): each guard below fails its test when broken

/** Every table but print_settings, where artelo_webhook_at is the one write a signed body always makes */
const ordersDump = async () => (await dumpDb(env.DB)).split("\n").filter((rows) => !rows.includes('"key":"')).join("\n");

test("the body is capped as it streams: a long one is refused once past 64KB, never buffered whole", async () => {
  // 200 chunks of 16KB (3.2MB): reading stops a few chunks past the cap, where buffering it all would pull every one
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; if (pulled > 200) controller.close(); else controller.enqueue(new Uint8Array(16 * 1024)); } });
  const request = new Request("https://curiousgeorge.dev/api/prints/artelo", { method: "POST", body, duplex: "half", headers: { "x-artelo-signature": "0".repeat(64) } } as RequestInit);
  const response = (await POST({ request, locals: { cfContext: { waitUntil: () => {} } } } as never)) as Response;
  expect(response.status).toBe(413);
  expect(pulled).toBeLessThan(10);
});

test("a wrong, missing, oversized or malformed signature is refused before d1 is touched or the body is read", async () => {
  const body = JSON.stringify({ orderId: "artelo-1", status: "Canceled" });
  const prepare = vi.spyOn(env.DB, "prepare");
  const batch = vi.spyOn(env.DB, "batch");
  for (const signature of [sign(`${body} `), null, `${sign(body)}${"0".repeat(10_000)}`, "zz", sign(body).slice(0, 40)]) {
    const response = await call(body, signature);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "invalid_signature" });
  }
  expect(prepare).not.toHaveBeenCalled();
  expect(batch).not.toHaveBeenCalled();
});

test("a signed body for an unknown order changes no order, whatever its status says", async () => {
  captureLogs();
  const before = await ordersDump();
  for (const orderId of ["artelo-404", "01k6x00000000000000000000z"]) {
    for (const status of ["Received", "PendingFulfillmentAction", "InProduction", "Shipped", "Delivered", "Canceled"]) {
      expect((await call(JSON.stringify({ orderId, status, shipments: [{ carrierCode: "UPS", trackingNumber: "1Z", trackingUrl: "https://ups.example/1Z" }] }))).status).toBe(200);
    }
  }
  expect(await ordersDump()).toBe(before);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM print_orders").first("n")).toBe(1);
});

test("nothing personal in artelo's payload is written or logged: only its order id, status and cleaned tracking count", async () => {
  const logs = captureLogs();
  const body = JSON.stringify({
    data: {
      orderId: "artelo-1", status: "Shipped", customerAddress: { name: "Ada Lovelace", street1: "12 Example Street", city: "Bondi Beach", phone: "+61 400 000 000" }, email: "ada@example.com",
      shipments: [{ carrierCode: "UPS", trackingNumber: "1Z999AA10123456784", trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784", recipient: "Ada Lovelace", deliveredTo: "12 Example Street" }],
    },
  });
  expect((await call(body)).status).toBe(200);
  expect(await env.DB.prepare("SELECT shipments FROM print_orders").first("shipments")).toBe(JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]));
  // An unreadable one logs its keys, never a value
  expect((await call(JSON.stringify({ customer: "Ada Lovelace", orderId: { name: "Ada Lovelace" }, status: "Shipped" }))).status).toBe(200);
  expect(await dumpDb(env.DB)).not.toMatch(/Ada|Lovelace|Example Street|Bondi|400 000|ada@/);
  expect(logs()).not.toMatch(/Ada|Lovelace|Example Street|Bondi|400 000|ada@/);
  expect(logs()).toContain("prints: an artelo webhook couldn't be read; its keys: customer, orderId, status");
});
