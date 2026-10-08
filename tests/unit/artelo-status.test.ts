import { afterEach, describe, expect, test, vi } from "vitest";
import { issueOrderGrant } from "../../src/lib/photos/store";
import { mapStatus } from "../../src/lib/prints/artelo-status";
import { applyArteloUpdate, pollStatuses, readArteloUpdate, verifyArteloSignature } from "../../src/lib/prints/artelo-updates";
import { sendDueMail } from "../../src/lib/prints/mail";
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

  // Fix round 1 (Minor 4): a late or replayed status is ignored and writes nothing, not even artelo's status or the check time
  test("a lower status arriving late is ignored and writes nothing", async () => {
    const { db, deps } = await setup({ status: "shipped" });
    expect(await applyArteloUpdate(deps, update("Received"))).toBe("ignored");
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "shipped", artelo_status: null, status_checked_at: null });
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

  // Fix round 1 (ruling 1): replaces the brief's "a failed check leaves the order to be asked again", which pinned an empty stamp
  test("a failed check is asked again an hour later, not on every run", async () => {
    const { db, deps } = await setup({ placed_at: NOW - 50_000 }, { "GET https://artelo.test/orders/get-by-id": () => json({}, 503) });
    await pollStatuses(deps, async () => {});
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", status_checked_at: NOW - 43_200 + 3600 });
    const asked = async (at: number) => {
      const fake = fakeFetch({ "GET https://artelo.test/orders/get-by-id": () => json({}, 503) });
      await pollStatuses(testDeps(db, { fetch: fake.fetch, now: () => at }), async () => {});
      return fake.calls.length;
    };
    expect(await asked(NOW + 59 * 60)).toBe(0);
    expect(await asked(NOW + 61 * 60)).toBe(1);
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
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", status_checked_at: NOW - 43_200 + 3600 });
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
    expect(await getOrder(second.db, ORDER)).toMatchObject({ status: "placed", status_checked_at: NOW - 43_200 + 3600 });
    expect((await getOrder(second.db, "01k6x00000000000000000000b"))?.status).toBe("in_production");
  });
});

describe("fix round 1", () => {
  const BACKED_OFF = NOW - 43_200 + 3600;
  const GET = "GET https://artelo.test/orders/get-by-id";
  const answering = (status: string) => (request: Request) => json({ id: new URL(request.url).searchParams.get("orderId"), status });
  /** A db whose batch first runs `meanwhile`, every time, as another writer landing between the read and the write */
  const interrupted = (db: D1Database, meanwhile: () => Promise<unknown>) =>
    new Proxy(db, {
      get(target, property) {
        if (property !== "batch") return Reflect.get(target, property);
        return async (statements: D1PreparedStatement[]) => {
          await meanwhile();
          return target.batch(statements);
        };
      },
    });

  test("every poll outcome that writes nothing backs the order off an hour: a status that isn't a word, lost races, a throw", async () => {
    let { db, deps } = await setup({ placed_at: NOW - 50_000 }, { [GET]: answering("Held_for_review_by_a_person_at_artelo_today") });
    await pollStatuses(deps, async () => {});
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_status: null, status_checked_at: BACKED_OFF });
    // Three lost races in a row: the reason changes under every move
    ({ db, deps } = await setup({ placed_at: NOW - 50_000 }, { [GET]: answering("InProduction") }));
    let flips = 0;
    const racing = interrupted(db, () => db.prepare("UPDATE print_orders SET attention_reason = ? WHERE id = ?").bind(`flip ${++flips}`, ORDER).run());
    await pollStatuses({ ...deps, db: racing }, async () => {});
    expect(flips).toBe(3);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", status_checked_at: BACKED_OFF });
    ({ db, deps } = await setup({ placed_at: NOW - 50_000 }, { [GET]: answering("InProduction") }));
    const throwing = interrupted(db, async () => { throw new Error("D1_ERROR: a hiccup"); });
    await expect(pollStatuses({ ...deps, db: throwing }, async () => {})).rejects.toThrow();
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", status_checked_at: BACKED_OFF });
  });

  test("an answer that changes nothing counts as a check: asked again in twelve hours", async () => {
    const { db, deps } = await setup({ placed_at: NOW - 50_000, artelo_status: "Received" }, { [GET]: answering("Received") });
    await pollStatuses(deps, async () => {});
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_status: "Received", status_checked_at: NOW });
  });

  test("the poll's stamp never pulls back a fresher one a webhook wrote during the poll", async () => {
    const holder: { db?: D1Database } = {};
    const { db, deps } = await setup({ placed_at: NOW - 50_000 }, {
      [GET]: async () => {
        await holder.db!.prepare("UPDATE print_orders SET status_checked_at = ? WHERE id = ?").bind(NOW - 5, ORDER).run();
        return json({}, 503);
      },
    });
    holder.db = db;
    await pollStatuses(deps, async () => {});
    expect((await getOrder(db, ORDER))?.status_checked_at).toBe(NOW - 5);
  });

  test("a refund changing only the attention reason of an order artelo holds is never overwritten (minor 1)", async () => {
    const REFUND = "refunded in stripe: cancel it in artelo if it hasn't printed.";
    const { db, deps } = await setup({ status: "needs_attention", attention_reason: "artelo needs something before it can print: open the order in artelo.", artelo_status: "PendingFulfillmentAction" });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    let landed = false;
    const racing = interrupted(db, async () => {
      if (landed) return;
      landed = true;
      await db.prepare("UPDATE print_orders SET attention_reason = ?, attention_notified_at = NULL WHERE id = ?").bind(REFUND, ORDER).run();
    });
    expect(await applyArteloUpdate({ ...deps, db: racing }, update("InProduction"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: REFUND, attention_notified_at: null, artelo_status: "InProduction" });
    expect(await activeGrants(db)).toBe(1);
  });

  test("a status for a refunded order with no artelo id flags it for george, as the daily lookup would, instead of only recording it (final review m2)", async () => {
    const REFUND = "refunded in stripe: cancel it in artelo if it hasn't printed.";
    const mail = vi.fn(async () => ({ messageId: "m" }));
    // Its attention email went once before (it needed attention, then was refunded): the flag makes it due again
    const { db } = await setup({ status: "refunded", artelo_order_id: null, refunded_amount: 28700, lease_until: NOW - 60, status_checked_at: NOW - 999, attention_notified_at: NOW - 600 });
    const deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    expect(await applyArteloUpdate(deps, update("Received", null, ORDER))).toBe("applied");
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: REFUND, attention_notified_at: NOW, artelo_order_id: null, artelo_status: "Received", lease_until: null });
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${ORDER} needs attention`, text: expect.stringContaining(REFUND) }));
    expect(vi.mocked(console.error)).toHaveBeenCalledWith("prints: artelo sent a status for refunded order", ORDER, "so it needs attention: cancel it there");
    // Flagged, it is the admin's to clear: retry refuses its reason, and artelo's later statuses only record
    expect(await applyArteloUpdate(deps, update("InProduction", null, ORDER))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: REFUND, artelo_status: "InProduction" });
  });

  test("a cancellation reaching a refunded order with no artelo id is flagged, then ends it: cancelled and refunded, no email owed", async () => {
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const { db } = await setup({ status: "refunded", artelo_order_id: null, refunded_amount: 28700 });
    const deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    expect(await applyArteloUpdate(deps, update("Canceled", null, ORDER))).toBe("applied");
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "cancelled", attention_reason: null, artelo_status: "Canceled", admin_notified_at: null });
    expect(mail).not.toHaveBeenCalled();
  });

  test("the flag is bound to the order as read: a placement recording artelo's id meanwhile is never overwritten", async () => {
    const { db, deps } = await setup({ status: "refunded", artelo_order_id: null, refunded_amount: 28700 });
    let landed = false;
    const racing = new Proxy(db, {
      get(target, property) {
        if (property !== "prepare") return Reflect.get(target, property);
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (landed || !sql.startsWith("UPDATE print_orders SET status = 'needs_attention'")) return statement;
          return { bind: (...values: unknown[]) => ({ run: async () => {
            landed = true;
            await target.prepare("UPDATE print_orders SET artelo_order_id = 'artelo-9' WHERE id = ?").bind(ORDER).run();
            return statement.bind(...values).run();
          } }) };
        };
      },
    });
    expect(await applyArteloUpdate({ ...deps, db: racing }, update("Received", null, ORDER))).toBe("ignored");
    expect(landed).toBe(true);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "refunded", attention_reason: null, artelo_order_id: "artelo-9" });
  });

  test("a fully refunded order cancelled while its missed-webhook note is due gets one neutral note, not 'refund it in stripe' (minor 3; final review m3)", async () => {
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const { db } = await setup({ refunded_amount: 28700, admin_notified_at: 0 });
    const deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    expect(await applyArteloUpdate(deps, update("Canceled"))).toBe("applied");
    await Promise.all(deps.waited);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${ORDER} was cancelled and refunded`, text: `print order ${ORDER} was cancelled by artelo and has been refunded; nothing to do.` }));
    expect((await getOrder(db, ORDER))?.admin_notified_at).toBe(NOW);
  });

  test("a cancellation note whose first send failed, then a full refund before it goes, reads as cancelled and refunded, never a missed webhook (final review m3)", async () => {
    const mail = vi.fn(async (): Promise<{ messageId: string }> => { throw new Error("email isn't ready"); });
    const { db } = await setup();
    const deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    expect(await applyArteloUpdate(deps, update("Canceled"))).toBe("applied");
    await Promise.all(deps.waited);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${ORDER} was cancelled by artelo` }));
    expect((await getOrder(db, ORDER))?.admin_notified_at).toBe(0);
    // George refunds it in full from /admin; the cron's next send of the same note
    await db.prepare("UPDATE print_orders SET refunded_amount = 28700, refunded_at = ? WHERE id = ?").bind(NOW, ORDER).run();
    mail.mockReset();
    mail.mockImplementation(async () => ({ messageId: "m" }));
    await sendDueMail(deps);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${ORDER} was cancelled and refunded`, text: `print order ${ORDER} was cancelled by artelo and has been refunded; nothing to do.` }));
    expect(JSON.stringify(mail.mock.calls)).not.toContain("webhook");
  });

  test("a late or replayed status writes nothing at all, by webhook or poll (minor 4)", async () => {
    const row = (db: D1Database) => db.prepare("SELECT status, artelo_status, status_checked_at, updated_at, shipments FROM print_orders WHERE id = ?").bind(ORDER).first();
    const cases: [Record<string, string | number | null>, string][] = [
      [{ status: "shipped", artelo_status: "Shipped" }, "Shipped"],
      [{ status: "shipped", artelo_status: "Shipped" }, "Received"],
      [{ status: "in_production", artelo_status: "InProduction" }, "PendingFulfillmentAction"],
      [{ status: "delivered", artelo_status: "Delivered" }, "Shipped"],
      [{ status: "cancelled", artelo_status: "Canceled" }, "Canceled"],
      [{ status: "placed", artelo_status: "OnHold" }, "OnHold"],
      [{ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", artelo_status: "InProduction" }, "Received"],
      // Artelo's last status is ahead of the order (a site-set needs_attention): judged against that too
      [{ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", artelo_status: "Shipped" }, "InProduction"],
      // A cancellation is past every other status, at Artelo as here
      [{ status: "cancelled", artelo_status: "Canceled" }, "InProduction"],
      [{ status: "cancelled", artelo_status: "Canceled" }, "Shipped"],
    ];
    for (const [columns, status] of cases) {
      const { db, deps } = await setup({ ...columns, status_checked_at: NOW - 999, updated_at: NOW - 999 });
      const before = await row(db);
      expect(await applyArteloUpdate({ ...deps, now: () => NOW + 10 }, update(status, TRACKING))).toBe("ignored");
      expect(await row(db)).toEqual(before);
      expect(deps.waited).toHaveLength(0);
    }
    // A newer status the rules still don't act on is recorded: a site-set needs_attention hears artelo is printing
    const { db, deps } = await setup({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", artelo_status: "Received" });
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_status: "InProduction", status_checked_at: NOW });
  });

  test("a different word at the same rank is recorded so /admin shows it; the same word again writes nothing (fix round 2, minor a)", async () => {
    const PENDING = "artelo needs something before it can print: open the order in artelo.";
    let { db, deps } = await setup({ status: "needs_attention", attention_reason: PENDING, artelo_status: "PendingFulfillmentAction", status_checked_at: NOW - 999 });
    expect(await applyArteloUpdate(deps, update("Received"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: PENDING, artelo_status: "Received", status_checked_at: NOW });
    expect(deps.waited).toHaveLength(0);
    // The same word again, later: nothing written
    expect(await applyArteloUpdate({ ...deps, now: () => NOW + 60 }, update("Received"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ artelo_status: "Received", status_checked_at: NOW, updated_at: NOW });
    // A placed order: ImagesProcessing then Received, and a first status onto none
    ({ db, deps } = await setup({ artelo_status: "ImagesProcessing" }));
    expect(await applyArteloUpdate(deps, update("Received"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_status: "Received" });
    ({ db, deps } = await setup({ artelo_status: null }));
    expect(await applyArteloUpdate(deps, update("Ignored"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_status: "Ignored" });
  });

  test("a shipment reaching a cancelled order leaves it cancelled and logs the order and status, nothing personal (fix round 2, minor b)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of ["Shipped", "Delivered"]) {
      error.mockClear();
      const { db, deps } = await setup({ status: "cancelled", artelo_status: "Canceled" });
      expect(await applyArteloUpdate(deps, update(status, TRACKING))).toBe("ignored");
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "cancelled", artelo_status: "Canceled", shipments: null });
      expect(error.mock.calls.map((args) => args.join(" "))).toEqual([`prints: artelo says order ${ORDER} is ${status} but it was cancelled; it stays cancelled`]);
    }
    // Any other status reaching a cancelled order, or a shipment reaching another final one, isn't an anomaly
    error.mockClear();
    await applyArteloUpdate((await setup({ status: "cancelled", artelo_status: "Canceled" })).deps, update("InProduction"));
    await applyArteloUpdate((await setup({ status: "refunded" })).deps, update("Shipped", TRACKING));
    expect(error).not.toHaveBeenCalled();
  });

  test("a status recorded meanwhile isn't overwritten by an older one decided from a stale read", async () => {
    const REFUND = "refunded in stripe: cancel it in artelo if it hasn't printed.";
    const { db, deps } = await setup({ status: "needs_attention", attention_reason: REFUND, artelo_status: "Received" });
    let landed = false;
    // Another delivery records Shipped between this one's read and its record write
    const racing = new Proxy(db, {
      get(target, property) {
        if (property !== "prepare") return Reflect.get(target, property);
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.startsWith("UPDATE print_orders SET artelo_status") || landed) return statement;
          return { bind: (...values: unknown[]) => ({ run: async () => {
            landed = true;
            await target.prepare("UPDATE print_orders SET artelo_status = 'Shipped' WHERE id = ?").bind(ORDER).run();
            return statement.bind(...values).run();
          } }) };
        };
      },
    });
    expect(await applyArteloUpdate({ ...deps, db: racing }, update("InProduction"))).toBe("ignored");
    expect(landed).toBe(true);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_status: "Shipped" });
  });

  test("tracking loses invisible formatting characters where it is written (minor 5)", async () => {
    const { db, deps } = await setup();
    const shipments = [
      { carrier: "U\u202ES\u202CP", number: "1Z\u200B999\uFEFFAA\u2066\u2069", url: "https://www.ups.com/track?n=1Z\u200B999" },
      { carrier: "dhl\u00AD", number: "JD\u200D01", url: "https://dhl.example/t?n=JD01" },
    ];
    expect(await applyArteloUpdate(deps, { orderId: "artelo-1", status: "Shipped", shipments })).toBe("applied");
    expect(JSON.parse((await getOrder(db, ORDER))!.shipments!)).toEqual([
      { carrier: "usp", number: "1Z999AA", url: "" },
      { carrier: "dhl", number: "JD01", url: "https://dhl.example/t?n=JD01" },
    ]);
    // The reader cleans the same way
    expect(readArteloUpdate({ orderId: "a", status: "Shipped", shipments: [{ carrierCode: "U\u202EPS", trackingNumber: "1\u200BZ" }] })?.shipments).toEqual([{ carrier: "ups", number: "1Z", url: "" }]);
  });
});
