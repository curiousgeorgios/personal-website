import { afterEach, describe, expect, test, vi } from "vitest";
import { issueOrderGrant } from "../../src/lib/photos/store";
import { mapStatus } from "../../src/lib/prints/artelo-status";
import { applyArteloUpdate, pollStatuses, readArteloUpdate, verifyArteloSignature } from "../../src/lib/prints/artelo-updates";
import { getOrder } from "../../src/lib/prints/store";
import { sameBytes } from "../../src/lib/prints/stripe";
import { captureLogs, dumpDb, fakeFetch, insertOrder, json, NOW, PHOTO_KEY, printDb, testDeps, type Handler } from "./prints-fakes";

// The real comparison, watched: the signature must be compared through the constant-time one
vi.mock("../../src/lib/prints/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/prints/stripe")>();
  return { ...real, sameBytes: vi.fn(real.sameBytes) };
});

const ORDER = "01k6x00000000000000000000a";
const TRACKING = [{ carrierCode: "UPS", trackingNumber: "1Z999AA10123456784", trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }];
const setup = async (columns: Record<string, string | number | null> = {}, handlers: Record<string, Handler> = {}) => {
  captureLogs();
  const db = await printDb();
  await insertOrder(db, { id: ORDER, status: "placed", artelo_order_id: "artelo-1", placed_at: NOW - 3600, ...columns });
  return { db, deps: testDeps(db, { fetch: fakeFetch(handlers).fetch }) };
};
const update = (status: string, shipments: unknown[] | null = null, orderId = "artelo-1") => ({ orderId, status, shipments: shipments ? readArteloUpdate({ orderId, status, shipments })!.shipments : null });
const activeGrants = (db: D1Database) => db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n");

afterEach(() => vi.restoreAllMocks());

test("artelo's statuses map to the order's", () => {
  expect(["ImagesProcessing", "Received", "Ignored", "PendingFulfillmentAction", "InProduction", "Shipped", "Delivered", "Canceled", "OnHold"].map(mapStatus)).toEqual([
    "placed", "placed", "placed", "needs_attention", "in_production", "shipped", "delivered", "cancelled", null,
  ]);
});

describe("applying a status", () => {
  test("production revokes the order's grants; shipping stores the tracking and makes the buyer's email due", async () => {
    const { db, deps } = await setup();
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("applied");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "in_production", artelo_status: "InProduction", status_checked_at: NOW });
    expect(await activeGrants(db)).toBe(0);
    expect(await applyArteloUpdate(deps, update("Shipped", TRACKING))).toBe("applied");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "shipped", shipped_at: NOW, shipments: JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]) });
    expect(deps.waited).toHaveLength(1);
  });

  test("a lower status arriving late is ignored, but recorded as artelo's", async () => {
    const { db, deps } = await setup({ status: "shipped" });
    expect(await applyArteloUpdate(deps, update("Received"))).toBe("ignored");
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "shipped", artelo_status: "InProduction" });
  });

  test("artelo needing something sends a placed order to needs attention and emails george; after production it is ignored", async () => {
    let { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, update("PendingFulfillmentAction"))).toBe("applied");
    expect(deps.waited).toHaveLength(1);
    // The email's claim runs at once; with no binding here it is released, so wait for that before reading the row
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "artelo needs something before it can print: open the order in artelo.", attention_notified_at: null });
    // A later status moves it on and clears the attention
    await db.prepare("UPDATE print_orders SET attention_notified_at = 1 WHERE id = ?").bind(ORDER).run();
    await Promise.all(deps.waited);
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("applied");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "in_production", attention_reason: null, attention_notified_at: null });
    ({ db, deps } = await setup({ status: "in_production" }));
    expect(await applyArteloUpdate(deps, update("PendingFulfillmentAction"))).toBe("ignored");
    expect((await getOrder(db, ORDER))?.status).toBe("in_production");
  });

  test("cancelled, delivered and refunded are final", async () => {
    for (const status of ["cancelled", "delivered", "refunded"]) {
      const { db, deps } = await setup({ status });
      expect(await applyArteloUpdate(deps, update("Shipped", TRACKING))).toBe("ignored");
      expect((await getOrder(db, ORDER))?.status).toBe(status);
    }
  });

  test("artelo cancelling tells george to refund, unless the order is already fully refunded, and revokes its grants", async () => {
    const mail = vi.fn(async () => ({ messageId: "m" }));
    let { db, deps } = await setup();
    deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    expect(await applyArteloUpdate(deps, update("Canceled"))).toBe("applied");
    await Promise.all(deps.waited);
    expect((await getOrder(db, ORDER))?.status).toBe("cancelled");
    expect(await activeGrants(db)).toBe(0);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${ORDER} was cancelled by artelo`, text: `artelo cancelled order ${ORDER}. refund it in stripe.` }));
    ({ db } = await setup({ refunded_amount: 28700 }));
    mail.mockClear();
    deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    await applyArteloUpdate(deps, update("Canceled"));
    await Promise.all(deps.waited);
    expect(mail).not.toHaveBeenCalled();
  });

  test("a needs attention this site set (a refund to cancel at artelo) isn't cleared by artelo's later statuses", async () => {
    const { db, deps } = await setup({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed." });
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", artelo_status: "InProduction" });
    expect(await applyArteloUpdate(deps, update("Canceled"))).toBe("applied");
    expect((await getOrder(db, ORDER))?.status).toBe("cancelled");
  });

  test("a status for an order still being placed is only recorded, so the next attempt's lookup adopts it", async () => {
    const { db, deps } = await setup({ status: "paid", artelo_order_id: null });
    expect(await applyArteloUpdate(deps, update("Received", null, ORDER))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", artelo_order_id: null, artelo_status: "Received" });
  });

  test("a status this site doesn't map changes nothing but artelo's status; an unknown order is unknown", async () => {
    const { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, update("OnHold"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_status: "OnHold" });
    expect(await applyArteloUpdate(deps, update("Shipped", null, "artelo-404"))).toBe("unknown");
  });

  test("the order is found by artelo's id, or failing that by ours", async () => {
    const { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, update("InProduction", null, ORDER))).toBe("applied");
    expect((await getOrder(db, ORDER))?.status).toBe("in_production");
  });
});

describe("reading the webhook", () => {
  test("orderId, status and shipments at the top level or inside data; anything else can't be read", () => {
    expect(readArteloUpdate({ orderId: 12345, status: "Shipped", shipments: TRACKING })).toEqual({ orderId: "12345", status: "Shipped", shipments: [{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }] });
    expect(readArteloUpdate({ data: { orderId: "artelo-1", status: "InProduction" } })).toEqual({ orderId: "artelo-1", status: "InProduction", shipments: null });
    for (const body of [null, [], {}, { orderId: "x" }, { status: "Shipped" }, "Shipped"]) expect(readArteloUpdate(body)).toBeNull();
  });

  test("a tracking url only counts as https", () => {
    expect(readArteloUpdate({ orderId: "a", status: "Shipped", shipments: [{ carrierCode: "ups", trackingNumber: "1Z", trackingUrl: "javascript:alert(1)" }] })?.shipments).toEqual([{ carrier: "ups", number: "1Z", url: "" }]);
  });

  test("the signature is the hex hmac of the raw body, or of the body re-serialised as artelo's example signs it", async () => {
    const secret = "artelo-fixture-webhook-secret";
    const hex = async (text: string) => {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const raw = '{ "orderId": "artelo-1",  "status": "Shipped" }';
    expect(await verifyArteloSignature(secret, await hex(raw), raw)).toBe(true);
    expect(await verifyArteloSignature(secret, await hex(JSON.stringify(JSON.parse(raw))), raw)).toBe(true);
    expect(await verifyArteloSignature(secret, await hex(raw), raw.replace("Shipped", "Delivered"))).toBe(false);
    expect(await verifyArteloSignature("other", await hex(raw), raw)).toBe(false);
    for (const header of [null, "", "zz", "00"]) expect(await verifyArteloSignature(secret, header, raw)).toBe(false);
    expect(await verifyArteloSignature("", await hex(raw), raw)).toBe(false);
  });
});

describe("the poll", () => {
  test("asks artelo about orders not checked for twelve hours, 300ms apart, then applies what it says", async () => {
    const { db, deps } = await setup({ status_checked_at: NOW - 43_201 }, {
      "GET https://artelo.test/orders/get-by-id": (request) => json({ id: new URL(request.url).searchParams.get("orderId"), status: "Shipped", shipments: TRACKING }),
    });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "in_production", artelo_order_id: "artelo-2", placed_at: NOW - 50_000 });
    await insertOrder(db, { id: "01k6x00000000000000000000c", status: "placed", artelo_order_id: "artelo-3", placed_at: NOW - 3600 });
    await insertOrder(db, { id: "01k6x00000000000000000000d", status: "delivered", artelo_order_id: "artelo-4", placed_at: NOW - 90_000 });
    const pause = vi.fn(async () => {});
    await pollStatuses(deps, pause);
    expect((await getOrder(db, ORDER))?.status).toBe("shipped");
    expect((await getOrder(db, "01k6x00000000000000000000b"))?.status).toBe("shipped");
    // Placed an hour ago: not yet due; delivered: final
    expect((await getOrder(db, "01k6x00000000000000000000c"))?.status).toBe("placed");
    expect((await getOrder(db, "01k6x00000000000000000000d"))?.status).toBe("delivered");
    expect(pause.mock.calls).toEqual([[300]]);
  });

  test("a failed check leaves the order to be asked again", async () => {
    const { db, deps } = await setup({ placed_at: NOW - 50_000 }, { "GET https://artelo.test/orders/get-by-id": () => json({}, 503) });
    await pollStatuses(deps, async () => {});
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", status_checked_at: null });
  });
});

describe("the guards the brief's tests don't reach (task 11 rulings)", () => {
  const SECRET = "artelo-fixture-webhook-secret";
  const hexOf = async (text: string) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const RAW = '{"orderId":"artelo-1","status":"Shipped"}';

  test("an oversized signature header is refused, even one that would be right once trimmed", async () => {
    const good = await hexOf(RAW);
    expect(await verifyArteloSignature(SECRET, ` ${good} `, RAW)).toBe(true);
    expect(await verifyArteloSignature(SECRET, `${good}${" ".repeat(65)}`, RAW)).toBe(false);
  });

  test("a malformed signature header is refused before any hmac is computed", async () => {
    const good = await hexOf(RAW);
    const sign = vi.spyOn(crypto.subtle, "sign");
    for (const header of ["00", good.slice(0, 62), `${good}00`, `${good.slice(0, 63)}g`, `sha256=${good}`]) expect(await verifyArteloSignature(SECRET, header, RAW)).toBe(false);
    expect(sign).not.toHaveBeenCalled();
  });

  test("the signature is compared through the constant-time comparison", async () => {
    vi.mocked(sameBytes).mockClear();
    const wrong = (await hexOf(RAW)).replace(/^./, (c) => (c === "0" ? "1" : "0"));
    expect(await verifyArteloSignature(SECRET, wrong, RAW)).toBe(false);
    // Once for the raw body; the re-serialised form is the same text, so it isn't tried again
    expect(vi.mocked(sameBytes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sameBytes).mock.calls[0][1]).toEqual(Uint8Array.from(wrong.match(/../g)!, (byte) => Number.parseInt(byte, 16)));
  });

  test("tracking is cleaned where it is written, whatever the update carries", async () => {
    const { db, deps } = await setup();
    const shipments = [
      { carrier: "U P S\n\tGround", number: "1Z 999\r\nAA\u0000", url: "http://www.ups.com/track" },
      { carrier: "x".repeat(80), number: "9".repeat(100), url: `https://track.example/${"a".repeat(600)}` },
      { carrier: "dhl", number: "", url: "https://dhl.example/t?n=1 2" },
      { carrier: "dhl", number: "JD01", url: "https://dhl.example/t?\u0007" },
      { carrier: "fedex", number: "", url: "javascript:alert(1)" },
      ...Array.from({ length: 12 }, (_, index) => ({ carrier: "aus post", number: `AP${index}`, url: `https://auspost.example/${index}` })),
    ];
    expect(await applyArteloUpdate(deps, { orderId: "artelo-1", status: "Shipped", shipments })).toBe("applied");
    const stored = JSON.parse((await getOrder(db, ORDER))!.shipments!);
    expect(stored.slice(0, 3)).toEqual([
      { carrier: "u p s ground", number: "1Z 999 AA", url: "" },
      { carrier: "x".repeat(40), number: "9".repeat(64), url: "" },
      { carrier: "dhl", number: "JD01", url: "" },
    ]);
    expect(stored).toHaveLength(10);
    expect(stored.at(-1)).toEqual({ carrier: "aus post", number: "AP6", url: "https://auspost.example/6" });
  });

  test("an unknown order id, ours in shape or artelo's, writes nothing at all", async () => {
    const { db, deps } = await setup({ status: "paid", artelo_order_id: null });
    const before = await dumpDb(db);
    for (const orderId of ["artelo-404", "01k6x00000000000000000000z", "x".repeat(200)]) {
      for (const status of ["Shipped", "Canceled", "PendingFulfillmentAction", "Received"]) expect(await applyArteloUpdate(deps, { orderId, status, shipments: null })).toBe("unknown");
    }
    expect(await dumpDb(db)).toBe(before);
    expect(deps.waited).toHaveLength(0);
  });

  test("a status that isn't a single word is never stored or logged", async () => {
    const logs = captureLogs();
    const { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, { orderId: "artelo-1", status: "held for Ada Lovelace, 12 Example Street", shipments: null })).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_status: null, status_checked_at: null });
    expect(logs()).not.toMatch(/Ada|Example/);
  });

  test("a refund landing between the read and the move is never overwritten", async () => {
    const { db, deps } = await setup();
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    let landed = false;
    const racing = new Proxy(db, {
      get(target, property) {
        if (property !== "batch") return Reflect.get(target, property);
        return async (statements: D1PreparedStatement[]) => {
          if (!landed) {
            landed = true;
            await target.prepare("UPDATE print_orders SET status = 'needs_attention', attention_reason = 'refunded in stripe: cancel it in artelo if it hasn''t printed.' WHERE id = ?").bind(ORDER).run();
          }
          return target.batch(statements);
        };
      },
    });
    expect(await applyArteloUpdate({ ...deps, db: racing }, update("Shipped", TRACKING))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", artelo_status: "Shipped", shipments: null });
    // The refund's status doesn't revoke, so the grant written alongside the move was left too
    expect(await activeGrants(db)).toBe(1);
  });

  test("delivered straight from placed stores the tracking and makes the buyer's email due", async () => {
    const { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, update("Delivered", TRACKING))).toBe("applied");
    expect(deps.waited).toHaveLength(1);
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "delivered", shipped_at: NOW, shipped_email_at: null, shipments: JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]) });
    // Shipped then delivered keeps the first shipping time
    const later = await setup({ status: "shipped", shipped_at: NOW - 999 });
    expect(await applyArteloUpdate(later.deps, update("Delivered"))).toBe("applied");
    expect((await getOrder(later.db, ORDER))?.shipped_at).toBe(NOW - 999);
  });

  test("a cancellation after george's missed-webhook note went makes his cancellation email due again; a full refund leaves the guard as it was", async () => {
    // No email binding here, so the claim is given back: due again (0) once the send settles
    let { db, deps } = await setup({ admin_notified_at: NOW - 5000 });
    expect(await applyArteloUpdate(deps, update("Canceled"))).toBe("applied");
    await Promise.all(deps.waited);
    expect((await getOrder(db, ORDER))?.admin_notified_at).toBe(0);
    ({ db, deps } = await setup({ admin_notified_at: NOW - 5000, refunded_amount: 28700 }));
    await applyArteloUpdate(deps, update("Canceled"));
    await Promise.all(deps.waited);
    expect((await getOrder(db, ORDER))?.admin_notified_at).toBe(NOW - 5000);
    // Its attention, if it had any, ends with it
    ({ db, deps } = await setup({ status: "needs_attention", attention_reason: "artelo needs something before it can print: open the order in artelo.", attention_notified_at: NOW - 10 }));
    await applyArteloUpdate(deps, update("Canceled"));
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "cancelled", attention_reason: null, attention_notified_at: null });
  });

  test("the poll never applies an answer about another order, and one that throws doesn't stop the rest", async () => {
    const { db, deps } = await setup({ placed_at: NOW - 50_000 }, { "GET https://artelo.test/orders/get-by-id": () => json({ id: "artelo-999", status: "Canceled" }) });
    await pollStatuses(deps, async () => {});
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", status_checked_at: null });
    const second = await setup({ placed_at: NOW - 50_000 }, { "GET https://artelo.test/orders/get-by-id": (request) => json({ id: new URL(request.url).searchParams.get("orderId"), status: "InProduction" }) });
    await insertOrder(second.db, { id: "01k6x00000000000000000000b", status: "placed", artelo_order_id: "artelo-2", placed_at: NOW - 45_000 });
    let calls = 0;
    const flaky = new Proxy(second.db, {
      get(target, property) {
        if (property !== "batch") return Reflect.get(target, property);
        return async (statements: D1PreparedStatement[]) => {
          if (calls++ === 0) throw new Error("D1_ERROR: a hiccup");
          return target.batch(statements);
        };
      },
    });
    await expect(pollStatuses({ ...second.deps, db: flaky }, async () => {})).rejects.toThrow("1 of the polled orders' statuses couldn't be applied");
    expect((await getOrder(second.db, ORDER))?.status).toBe("placed");
    expect((await getOrder(second.db, "01k6x00000000000000000000b"))?.status).toBe("in_production");
  });
});
