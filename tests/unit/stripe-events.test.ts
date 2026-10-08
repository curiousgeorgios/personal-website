import { afterEach, describe, expect, test, vi } from "vitest";
import { issueOrderGrant } from "../../src/lib/photos/store";
import { applyPaid, handleStripeEvent, reconcileCheckouts, type StripeEvent } from "../../src/lib/prints/stripe-events";
import { verifyStripeSignature } from "../../src/lib/prints/stripe";
import { getOrder } from "../../src/lib/prints/store";
import { captureLogs, dumpDb, fakeFetch, insertOrder, json, NOW, PHOTO_KEY, printDb, testDeps, type Handler } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";
const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1", object: "checkout.session", status: "complete", payment_status: "paid", client_reference_id: ORDER, livemode: false, currency: "aud",
  amount_total: 28700, payment_intent: "pi_test_1", metadata: { order_id: ORDER, country: "AU", print_total: "23800", delivery_amount: "4900", delivery_taxed: "0", line_1: "fixture-b-01:medium:oak:1", line_2: "fixture-b-02:small:unframed:1" },
  ...over,
});
const event = (type: string, object: Record<string, unknown>, id = "evt_1"): StripeEvent => ({ id, type, livemode: false, data: { object } });
const checkout = (db: D1Database, over: Record<string, string | number | null> = {}) =>
  insertOrder(db, { id: ORDER, status: "checkout", stripe_session_id: "cs_test_1", stripe_payment_intent: null, paid_at: null, next_attempt_at: null, retry_until: null, ...over });
// Placement starts in the background against a fake with no Artelo, fails and retries: its logs are silenced
const setup = async (handlers: Record<string, Handler> = {}) => {
  captureLogs();
  const db = await printDb();
  const deps = testDeps(db, { fetch: fakeFetch(handlers).fetch });
  return { db, deps };
};
const events = (db: D1Database) => db.prepare("SELECT id FROM stripe_events").all().then((result) => result.results);

afterEach(() => vi.restoreAllMocks());

describe("the guard", () => {
  test("a paid session moves its order from checkout to paid and starts placing it at once", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect(await events(db)).toEqual([{ id: "evt_1" }]);
    expect(deps.waited).toHaveLength(1);
    // The first attempt ran at once (attempts from 0 to 1, due now) and, with no Artelo here, backed off five minutes
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", paid_at: NOW, stripe_session_id: "cs_test_1", stripe_payment_intent: "pi_test_1", retry_until: NOW + 86_400, attempts: 1, next_attempt_at: NOW + 300 });
  });

  test("an expired checkout that is paid after all becomes paid too", async () => {
    const { db, deps } = await setup();
    await checkout(db, { status: "expired" });
    await handleStripeEvent(deps, event("checkout.session.completed", session()));
    expect((await getOrder(db, ORDER))?.status).toBe("paid");
  });

  test("the same event twice applies once", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session()));
    await db.prepare("UPDATE print_orders SET status = 'placed' WHERE id = ?").bind(ORDER).run();
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect((await getOrder(db, ORDER))?.status).toBe("placed");
    expect(deps.waited).toHaveLength(1);
  });

  test("a concurrent duplicate fails its batch and answers 500, changing nothing; stripe's redelivery then finds the row", async () => {
    captureLogs();
    const { db, deps } = await setup();
    await checkout(db);
    // The race: the other delivery's row lands between this one's look and its batch
    await db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES ('evt_1', 'checkout.session.completed', 1)").run();
    const racing = {
      ...db,
      prepare: (sql: string) => (sql.startsWith("SELECT 1") ? { bind: () => ({ first: async () => null }) } : db.prepare(sql)),
      batch: db.batch.bind(db),
    } as unknown as D1Database;
    expect(await handleStripeEvent({ ...deps, db: racing }, event("checkout.session.completed", session()))).toBe(500);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
  });

  test("two events for one session pay once: the status condition is the session's guard", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session(), "evt_1"));
    await handleStripeEvent(deps, event("checkout.session.completed", session(), "evt_2"));
    expect(deps.waited).toHaveLength(1);
    expect(await events(db)).toEqual([{ id: "evt_1" }, { id: "evt_2" }]);
  });

  test("an event whose order can't be found isn't recorded and answers 500, so stripe sends it again", async () => {
    captureLogs();
    const { db, deps } = await setup();
    expect(await handleStripeEvent(deps, event("checkout.session.expired", session({ id: "cs_none", client_reference_id: "01k6x0000000000000000000zz", metadata: { order_id: "01k6x0000000000000000000zz" } })))).toBe(500);
    expect(await handleStripeEvent(deps, event("charge.refunded", { payment_intent: "pi_none", amount: 100, amount_refunded: 100, refunded: true }, "evt_2"))).toBe(500);
    expect(await events(db)).toEqual([]);
  });

  test("a paid session whose order is missing recreates it from the metadata, straight into needs attention", async () => {
    const { db, deps } = await setup();
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "the order row was missing; check it before it's placed.", country: "AU", print_total: 23800, delivery_amount: 4900, delivery_taxed: 0, livemode: 0, stripe_session_id: "cs_test_1", stripe_payment_intent: "pi_test_1" });
    expect((await db.prepare("SELECT line, photo_id, tier, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id = ? ORDER BY line").bind(ORDER).all()).results).toEqual([
      { line: 1, photo_id: "fixture-b-01", tier: "medium", size: "x12x18", frame: "oak", quantity: 1, unit_amount: 17900 },
      { line: 2, photo_id: "fixture-b-02", tier: "small", size: "x8x12", frame: "unframed", quantity: 1, unit_amount: 5900 },
    ]);
  });

  test("recreated amounts are whole cents, and a line the store can't hold is left out rather than losing the order", async () => {
    const { db, deps } = await setup();
    const metadata = { ...session().metadata, print_total: "23800.6", delivery_amount: "4899.5", line_3: "fixture-b-01:small:oak:0", line_4: "fixture-b-01:small:oak:11" };
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ metadata })))).toBe(200);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", print_total: 23801, delivery_amount: 4900 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM print_order_items WHERE order_id = ?").bind(ORDER).first("n")).toBe(2);
  });

  test("an amount, currency or currency conversion that doesn't match the quote is paid but needs attention (adaptive pricing off)", async () => {
    for (const over of [{ amount_total: 28600 }, { currency: "usd" }, { currency_conversion: { amount_total: 19000, source_currency: "usd" } }]) {
      const { db, deps } = await setup();
      await checkout(db);
      await handleStripeEvent(deps, event("checkout.session.completed", session(over)));
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "the amount paid differs from the quote", paid_at: NOW, stripe_payment_intent: "pi_test_1" });
    }
    const { db, deps } = await setup();
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session({ livemode: true })));
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("stripe's test and live modes don't match this order; check it before it's placed.");
  });

  test("a mismatch emails george straight away and never starts placing", async () => {
    captureLogs();
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const db = await printDb();
    const deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session({ amount_total: 1 })));
    await Promise.all(deps.waited);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${ORDER} needs attention` }));
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attempts: 0, lease_until: null });
  });

  test("an unpaid session records nothing; an expired one expires its checkout", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ payment_status: "unpaid" })))).toBe(200);
    expect(await events(db)).toEqual([]);
    expect(await handleStripeEvent(deps, event("checkout.session.expired", session({ status: "expired", payment_status: "unpaid" }), "evt_2"))).toBe(200);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
    expect(await events(db)).toEqual([{ id: "evt_2" }]);
  });
});

describe("only this site's own checkout", () => {
  const unchanged = async (db: D1Database, status: string, sessionId: string | null) =>
    expect(await getOrder(db, ORDER)).toMatchObject({ status, stripe_session_id: sessionId, stripe_payment_intent: null, paid_at: null });

  test("a signed event for another session can't pay an expired order, or replace its session or payment intent", async () => {
    for (const metadata of [{}, { ...session().metadata }]) {
      const logs = captureLogs();
      const db = await printDb();
      const deps = testDeps(db);
      await checkout(db, { status: "expired" });
      expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ id: "cs_other_link", payment_intent: "pi_attacker", metadata })))).toBe(200);
      await unchanged(db, "expired", "cs_test_1");
      expect(deps.waited).toHaveLength(0);
      expect(await events(db)).toEqual([{ id: "evt_1" }]);
      expect(logs()).toContain("prints: stripe event evt_1 checkout.session.completed isn't for one of this site's print checkouts; recorded and ignored");
      vi.restoreAllMocks();
    }
  });

  test("a session stored by the order meanwhile is never overwritten: the statement checks it again", async () => {
    const { db, deps } = await setup();
    await checkout(db, { stripe_session_id: null });
    // Another session is recorded for the order between the handler's read and its batch
    const racing = {
      ...db,
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        await db.prepare("UPDATE print_orders SET stripe_session_id = 'cs_test_stored' WHERE id = ?").bind(ORDER).run();
        return db.batch(statements);
      },
    } as unknown as D1Database;
    expect(await handleStripeEvent({ ...deps, db: racing }, event("checkout.session.completed", session()))).toBe(200);
    await unchanged(db, "checkout", "cs_test_stored");
    expect(deps.waited).toHaveLength(0);
  });

  test("a payment link's session, with only a client_reference_id, changes nothing and is answered 200, whatever order it names", async () => {
    for (const metadata of [null, {}]) {
      const { db, deps } = await setup();
      await checkout(db, { stripe_session_id: null });
      expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ id: "cs_link", metadata })))).toBe(200);
      await unchanged(db, "checkout", null);
      // Naming no order here: nothing is recreated either
      expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ id: "cs_link_2", client_reference_id: "01k6x0000000000000000000zz", metadata }), "evt_2"))).toBe(200);
      expect(await getOrder(db, "01k6x0000000000000000000zz")).toBeNull();
      expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ id: "cs_link_3", client_reference_id: null, metadata }), "evt_3"))).toBe(200);
      expect(await events(db)).toEqual([{ id: "evt_1" }, { id: "evt_2" }, { id: "evt_3" }]);
      expect(deps.waited).toHaveLength(0);
    }
  });

  test("a session whose metadata names another order is answered 200 and changes nothing", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ metadata: { ...session().metadata, order_id: "01k6x0000000000000000000zz" } })))).toBe(200);
    await unchanged(db, "checkout", "cs_test_1");
    expect(await getOrder(db, "01k6x0000000000000000000zz")).toBeNull();
  });

  test("an expired session that isn't the order's own is recorded and answered 200, and its order keeps waiting", async () => {
    for (const over of [{ metadata: {} }, { id: "cs_other" }, { client_reference_id: null }]) {
      const { db, deps } = await setup();
      await checkout(db);
      const logs = captureLogs();
      expect(await handleStripeEvent(deps, event("checkout.session.expired", session({ status: "expired", payment_status: "unpaid", ...over })))).toBe(200);
      await unchanged(db, "checkout", "cs_test_1");
      expect(await events(db)).toEqual([{ id: "evt_1" }]);
      expect(logs()).toContain("recorded and ignored");
      vi.restoreAllMocks();
    }
  });

  test("an expiry never lands on an order that took another session meanwhile", async () => {
    const { db, deps } = await setup();
    await checkout(db, { stripe_session_id: null });
    const racing = {
      ...db,
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        await db.prepare("UPDATE print_orders SET stripe_session_id = 'cs_test_stored' WHERE id = ?").bind(ORDER).run();
        return db.batch(statements);
      },
    } as unknown as D1Database;
    expect(await handleStripeEvent({ ...deps, db: racing }, event("checkout.session.expired", session({ status: "expired", payment_status: "unpaid" })))).toBe(200);
    await unchanged(db, "checkout", "cs_test_stored");
  });

  test("a session that isn't ours is logged by its event alone, never by the order id it carries", async () => {
    const logs = captureLogs();
    const db = await printDb();
    const deps = testDeps(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session({ client_reference_id: "someone@example.com", metadata: null })));
    expect(logs()).toContain("evt_1");
    expect(logs()).not.toContain("someone@example.com");
  });

  test("the ledger's own read failing is the handler's one-line 500, so stripe sends it again", async () => {
    const logs = captureLogs();
    const db = await printDb();
    const broken = { ...db, prepare: (sql: string) => (sql.startsWith("SELECT 1") ? { bind: () => ({ first: async () => { throw new Error("D1 is down"); } }) } : db.prepare(sql)) } as unknown as D1Database;
    expect(await handleStripeEvent(testDeps(broken), event("checkout.session.completed", session()))).toBe(500);
    expect(logs()).toContain("prints: stripe event evt_1 checkout.session.completed wasn't applied: D1 is down");
  });
});

describe("refunds", () => {
  const refund = (amount_refunded: number, refunded: boolean, id = "evt_r") => event("charge.refunded", { payment_intent: `pi_test_${ORDER}`, amount: 28700, amount_refunded, refunded }, id);

  test("a full refund before placement stops the retries and revokes the master links", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    await handleStripeEvent(deps, refund(28700, true));
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "refunded", refunded_amount: 28700, refunded_at: NOW });
    expect(await events(db)).toEqual([{ id: "evt_r" }]);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(0);
  });

  test("a full refund after placement needs attention, to cancel it at artelo", async () => {
    for (const status of ["placed", "in_production"]) {
      const { db, deps } = await setup();
      await insertOrder(db, { id: ORDER, status, artelo_order_id: "artelo-1" });
      await handleStripeEvent(deps, refund(28700, true));
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", refunded_amount: 28700 });
    }
  });

  test("a full refund that lands while an attempt holds the lease keeps the lease and records no artelo id, the marker that artelo may have it", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER, attempts: 1, lease_until: NOW + 120 });
    expect(await handleStripeEvent(deps, refund(28700, true))).toBe(200);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "refunded", lease_until: NOW + 120, artelo_order_id: null, refunded_amount: 28700 });
  });

  test("a full refund of an order that needs attention but artelo already has takes the refund reason and emails george again, its artelo id and links kept", async () => {
    captureLogs();
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const db = await printDb();
    const deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "artelo needs something before it can print: open the order in artelo.", attention_notified_at: NOW - 600, artelo_order_id: "artelo-1" });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    await handleStripeEvent(deps, refund(28700, true));
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", attention_notified_at: NOW, artelo_order_id: "artelo-1", refunded_amount: 28700 });
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${ORDER} needs attention`, text: expect.stringContaining("refunded in stripe: cancel it in artelo") }));
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(1);
    // Its email sent, a second full-refund event (another id) doesn't make it due again
    await handleStripeEvent(deps, refund(28700, true, "evt_r2"));
    await Promise.all(deps.waited);
    expect((await getOrder(db, ORDER))?.attention_notified_at).toBe(NOW);
    expect(mail).toHaveBeenCalledTimes(1);
  });

  test("the links are revoked in the event's own write: when that write fails, neither the event nor the revoke happens, and the redelivery does both", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    const live = () => db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n");
    // The revoke itself fails (a D1 hiccup at that statement)
    await db.prepare("CREATE TRIGGER revoke_fails BEFORE UPDATE OF revoked_at ON photo_download_grants BEGIN SELECT RAISE(ABORT, 'revoke failed'); END").run();
    expect(await handleStripeEvent(deps, refund(28700, true))).toBe(500);
    expect(await events(db)).toEqual([]);
    expect(await live()).toBe(1);
    expect((await getOrder(db, ORDER))?.status).toBe("paid");
    await db.prepare("DROP TRIGGER revoke_fails").run();
    expect(await handleStripeEvent(deps, refund(28700, true))).toBe(200);
    expect(await events(db)).toEqual([{ id: "evt_r" }]);
    expect(await live()).toBe(0);
    expect((await getOrder(db, ORDER))?.status).toBe("refunded");
  });

  test("the revoke follows the order's state as the write runs, not an earlier read: an order artelo took meanwhile keeps its links", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    // Placement records Artelo's id between the handler's read of the order and its batch
    const racing = {
      ...db,
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        await db.prepare("UPDATE print_orders SET status = 'placed', artelo_order_id = 'artelo-1' WHERE id = ?").bind(ORDER).run();
        return db.batch(statements);
      },
    } as unknown as D1Database;
    expect(await handleStripeEvent({ ...deps, db: racing }, refund(28700, true))).toBe(200);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", artelo_order_id: "artelo-1" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(1);
  });

  test("a refunded order artelo has keeps its links when a full refund arrives", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER, status: "refunded", artelo_order_id: "artelo-1" });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    expect(await handleStripeEvent(deps, refund(28700, true))).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(1);
  });

  test("refund amounts only grow: a late event with a smaller amount, or none, never lowers what is recorded", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER, status: "placed", artelo_order_id: "artelo-1" });
    await handleStripeEvent(deps, refund(9800, false, "evt_r1"));
    await handleStripeEvent(deps, refund(4900, false, "evt_r2"));
    expect((await getOrder(db, ORDER))?.refunded_amount).toBe(9800);
    await handleStripeEvent(deps, event("charge.refunded", { payment_intent: `pi_test_${ORDER}`, refunded: false }, "evt_r3"));
    expect((await getOrder(db, ORDER))?.refunded_amount).toBe(9800);
  });

  test("a refund in fractions of a cent is written in whole cents, so the store never refuses it", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER, status: "placed", artelo_order_id: "artelo-1" });
    expect(await handleStripeEvent(deps, refund(4900.6, false))).toBe(200);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", refunded_amount: 4901 });
  });

  test("a partial refund changes only the amounts", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER, status: "placed", artelo_order_id: "artelo-1" });
    await handleStripeEvent(deps, refund(4900, false));
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", refunded_amount: 4900, refunded_at: NOW });
  });
});

describe("the buyer's details", () => {
  const EMAIL = "buyer@example.com";
  const address = { line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postal_code: "2026", country: "AU" };
  const buyer = {
    customer_details: { email: EMAIL, name: "Ada Lovelace", phone: "+61 400 000 000", address },
    collected_information: { shipping_details: { name: "Ada Lovelace", address } },
    shipping_details: { name: "Ada Lovelace", address },
  };
  const PERSONAL = [EMAIL, "Ada Lovelace", "Lovelace", "12 Example Street", "Example Street", "Unit 3", "Bondi Beach", "+61 400 000 000"];

  test("are never written to the store, the logs or a url, whichever way an event goes", async () => {
    const logs = captureLogs();
    const db = await printDb();
    const SESSION = "GET https://stripe.test/v1/checkout/sessions/cs_test_1";
    const { fetch, calls } = fakeFetch({ [SESSION]: () => json(session(buyer)) });
    const deps = testDeps(db, { fetch });
    const charge = (over: Record<string, unknown>) => ({ amount: 28700, amount_refunded: 28700, refunded: true, receipt_email: EMAIL, billing_details: { email: EMAIL, name: "Ada Lovelace", phone: "+61 400 000 000", address }, ...over });
    // Paid, then refunded; a mismatch; a recreated order; an unpaid and an expired session; the reconciliation; refusals
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session(buyer), "evt_paid"));
    await handleStripeEvent(deps, event("charge.refunded", charge({ payment_intent: "pi_test_1" }), "evt_refund"));
    const other = await insertOrder(db, { status: "checkout", stripe_session_id: "cs_test_2", stripe_payment_intent: null, paid_at: null });
    await handleStripeEvent(deps, event("checkout.session.completed", session({ ...buyer, id: "cs_test_2", client_reference_id: other, metadata: { ...session().metadata, order_id: other }, payment_intent: "pi_test_2", amount_total: 1 }), "evt_mismatch"));
    await handleStripeEvent(deps, event("checkout.session.completed", session({ ...buyer, id: "cs_test_3", client_reference_id: "01k6x0000000000000000000zz", metadata: { ...session().metadata, order_id: "01k6x0000000000000000000zz" }, payment_intent: "pi_test_3" }), "evt_recreated"));
    await handleStripeEvent(deps, event("checkout.session.completed", session({ ...buyer, payment_status: "unpaid" }), "evt_unpaid"));
    await handleStripeEvent(deps, event("checkout.session.expired", session({ ...buyer, status: "expired", payment_status: "unpaid" }), "evt_expired"));
    await handleStripeEvent(deps, event("checkout.session.completed", session({ ...buyer, client_reference_id: null }), "evt_no_order"));
    await handleStripeEvent(deps, event("charge.refunded", charge({ payment_intent: "pi_none" }), "evt_no_payment"));
    await db.prepare("UPDATE print_orders SET status = 'checkout', created_at = ?, stripe_payment_intent = NULL WHERE id = ?").bind(NOW - 3901, ORDER).run();
    await reconcileCheckouts(deps);
    await Promise.allSettled(deps.waited);
    const stored = await dumpDb(db);
    const logged = logs();
    const urls = calls.map((call) => `${call.url} ${call.body}`).join("\n");
    for (const value of PERSONAL) {
      expect(stored).not.toContain(value);
      expect(logged).not.toContain(value);
      expect(urls).not.toContain(value);
    }
    // The sweep saw the paths it claims to: three orders paid or flagged, a recreated one and the logs of the refusals
    expect(logged).toContain("evt_no_order");
    expect(logged).toContain("evt_no_payment");
    expect(stored).toContain("01k6x0000000000000000000zz");
  });
});

describe("Stripe's signature", () => {
  const SECRET = "whsec_fixture";
  const sign = async (body: string, t: number, secret = SECRET) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  test("an HMAC of the timestamp and the raw body, within five minutes, against any of several v1 values", async () => {
    const body = '{"id":"evt_1"}';
    const good = await sign(body, NOW);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good}`, body, NOW)).toBe(true);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${"0".repeat(64)},v1=${good}`, body, NOW + 300)).toBe(true);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good}`, body, NOW + 301)).toBe(false);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good}`, '{"id":"evt_2"}', NOW)).toBe(false);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${await sign(body, NOW, "whsec_other")}`, body, NOW)).toBe(false);
    for (const header of [null, "", `v1=${good}`, `t=abc,v1=${good}`, `t=${NOW}`, `t=${NOW},v1=xyz`]) expect(await verifyStripeSignature(SECRET, header, body, NOW)).toBe(false);
    expect(await verifyStripeSignature("", `t=${NOW},v1=${good}`, body, NOW)).toBe(false);
  });

  test("a timestamp more than five minutes ahead is refused too", async () => {
    const body = '{"id":"evt_1"}';
    expect(await verifyStripeSignature(SECRET, `t=${NOW + 301},v1=${await sign(body, NOW + 301)}`, body, NOW)).toBe(false);
    expect(await verifyStripeSignature(SECRET, `t=${NOW + 300},v1=${await sign(body, NOW + 300)}`, body, NOW)).toBe(true);
  });

  test("a header over 1KB or with more than five v1 values is refused unread; parts with no = are skipped", async () => {
    const body = '{"id":"evt_1"}';
    const good = await sign(body, NOW);
    const wrong = "0".repeat(64);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},${`v1=${wrong},`.repeat(4)}v1=${good}`, body, NOW)).toBe(true);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},${`v1=${wrong},`.repeat(5)}v1=${good}`, body, NOW)).toBe(false);
    const padded = `t=${NOW},v1=${good},v0=${"a".repeat(1024)}`;
    expect(await verifyStripeSignature(SECRET, padded.slice(0, 1024), body, NOW)).toBe(true);
    expect(await verifyStripeSignature(SECRET, padded.slice(0, 1025), body, NOW)).toBe(false);
    expect(await verifyStripeSignature(SECRET, `garbage,t=${NOW},v1=${good}`, body, NOW)).toBe(true);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good},v1=${wrong}`, body, NOW)).toBe(true);
    // A prefix of the right HMAC is not the HMAC
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good.slice(0, 2)}`, body, NOW)).toBe(false);
    expect(await verifyStripeSignature(SECRET, `tt=${NOW},v1=${good}`, body, NOW)).toBe(false);
  });
});

describe("reconciliation", () => {
  const OLD = NOW - 3901;
  const OTHER_ORDER = "01k6x0000000000000000000zz";
  const SESSION = "GET https://stripe.test/v1/checkout/sessions/cs_test_1";
  const EXPIRE = "POST https://stripe.test/v1/checkout/sessions/cs_test_1/expire";

  test("a paid session whose webhook never arrived becomes paid, starts placing and tells george, never expired", async () => {
    captureLogs();
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const db = await printDb();
    const deps = testDeps(db, { fetch: fakeFetch({ [SESSION]: () => json(session()) }).fetch, email: { send: mail } as unknown as SendEmail });
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("paid");
    expect(await events(db)).toEqual([]);
    expect(deps.waited).toHaveLength(1);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${ORDER}: stripe's webhook never arrived`, text: `print order ${ORDER} was paid but stripe's webhook never arrived. check the webhook in stripe.` }));
    expect((await getOrder(db, ORDER))?.admin_notified_at).toBe(NOW);
  });

  test("the missed-webhook email stays due when its send fails, for the cron to retry", async () => {
    const { db, deps } = await setup({ [SESSION]: () => json(session()) });
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", admin_notified_at: 0 });
  });

  test("a session stripe doesn't know a day after it should have ended expires its order; a younger one waits its turn", async () => {
    let { db, deps } = await setup({ [SESSION]: () => json({ error: {} }, 404) });
    await checkout(db, { created_at: NOW - 25 * 3600 - 1 });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
    ({ db, deps } = await setup({ [SESSION]: () => json({ error: {} }, 404) }));
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "checkout", status_checked_at: NOW });
  });

  test("orders it has just read go to the back of the line, so twenty stuck ones can't hide a newer paid one", async () => {
    captureLogs();
    const db = await printDb();
    const handlers: Record<string, Handler> = { [SESSION]: () => json(session()) };
    for (let i = 0; i < 20; i++) {
      await insertOrder(db, { id: `stuck-${i}`, status: "checkout", stripe_session_id: `cs_stuck_${i}`, stripe_payment_intent: null, paid_at: null, created_at: OLD - 1000 - i });
      handlers[`GET https://stripe.test/v1/checkout/sessions/cs_stuck_${i}`] = () => json(session({ id: `cs_stuck_${i}`, status: "complete", payment_status: "unpaid" }));
    }
    await checkout(db, { created_at: OLD });
    const fetch = fakeFetch(handlers).fetch;
    await reconcileCheckouts(testDeps(db, { fetch }));
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    await reconcileCheckouts(testDeps(db, { fetch, now: () => NOW + 300 }));
    expect((await getOrder(db, ORDER))?.status).toBe("paid");
  });

  test("an open session is expired at stripe and left for the next run; an expired one expires its order", async () => {
    const expire = vi.fn(() => json(session({ status: "expired" })));
    let { db, deps } = await setup({ [SESSION]: () => json(session({ status: "open", payment_status: "unpaid" })), [EXPIRE]: expire });
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect(expire).toHaveBeenCalledTimes(1);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    ({ db, deps } = await setup({ [SESSION]: () => json(session({ status: "expired", payment_status: "unpaid" })) }));
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
  });

  test("an order stripe never answered for expires; a recent one and an unreadable session are left alone", async () => {
    captureLogs();
    let { db, deps } = await setup();
    await checkout(db, { created_at: OLD, stripe_session_id: null });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
    ({ db, deps } = await setup({ [SESSION]: () => json(session()) }));
    await checkout(db, { created_at: NOW - 3800 });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    for (const created_at of [OLD, NOW - 25 * 3600 - 1]) {
      ({ db, deps } = await setup({ [SESSION]: () => json({}, 503) }));
      await checkout(db, { created_at });
      await reconcileCheckouts(deps);
      expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    }
  });

  test("a session that isn't the order's own checkout is never applied, to it or to the order it names", async () => {
    for (const over of [{ client_reference_id: OTHER_ORDER, metadata: { ...session().metadata, order_id: OTHER_ORDER } }, { metadata: {} }, { id: "cs_test_other" }]) {
      captureLogs();
      const db = await printDb();
      await checkout(db, { created_at: OLD });
      await insertOrder(db, { id: OTHER_ORDER, status: "checkout", stripe_session_id: null, stripe_payment_intent: null, paid_at: null, created_at: NOW });
      const deps = testDeps(db, { fetch: fakeFetch({ [SESSION]: () => json(session(over)) }).fetch });
      await reconcileCheckouts(deps);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "checkout", stripe_session_id: "cs_test_1", stripe_payment_intent: null, admin_notified_at: null });
      expect(await getOrder(db, OTHER_ORDER)).toMatchObject({ status: "checkout", stripe_session_id: null, admin_notified_at: null });
      expect(deps.waited).toHaveLength(0);
    }
  });

  test("an order the webhook pays while stripe is asked keeps no missed-webhook email", async () => {
    captureLogs();
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const db = await printDb();
    // The webhook lands during the reconciliation's read of the session
    const paying = async () => {
      await db.prepare("UPDATE print_orders SET status = 'paid', paid_at = ?, stripe_payment_intent = 'pi_test_1' WHERE id = ?").bind(NOW, ORDER).run();
      return json(session());
    };
    const deps = testDeps(db, { fetch: fakeFetch({ [SESSION]: paying }).fetch, email: { send: mail } as unknown as SendEmail });
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", admin_notified_at: null });
    expect(mail).not.toHaveBeenCalled();
  });

  test("a young order's session stripe doesn't know is logged on its first read only", async () => {
    const logs = captureLogs();
    const db = await printDb();
    await checkout(db, { created_at: OLD });
    const fetch = fakeFetch({ [SESSION]: () => json({ error: {} }, 404) }).fetch;
    await reconcileCheckouts(testDeps(db, { fetch }));
    await reconcileCheckouts(testDeps(db, { fetch, now: () => NOW + 300 }));
    expect(logs().match(/session stripe doesn't know/g)).toHaveLength(1);
  });

  test("applyPaid with no event row needs no ledger: the status condition guards it", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    expect(await applyPaid(deps, session({ payment_status: "unpaid" }) as never, [])).toBe("unpaid");
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    expect(await applyPaid(deps, session() as never, [])).toBe("paid");
    expect(await applyPaid(deps, session() as never, [])).toBe("unchanged");
  });
});
