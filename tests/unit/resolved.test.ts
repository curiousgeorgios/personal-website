import { afterEach, describe, expect, test, vi } from "vitest";
import OrdersAdmin from "../../src/components/admin/OrdersAdmin.astro";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { canRetry, loadOrdersAdmin, stamp } from "../../src/lib/prints/admin";
import { PENDING_REASON, REFUND_REASON } from "../../src/lib/prints/artelo-status";
import { applyArteloUpdate } from "../../src/lib/prints/artelo-updates";
import { lookUpStrandedRefunds } from "../../src/lib/prints/daily";
import { placeOrder } from "../../src/lib/prints/place";
import { getOrder } from "../../src/lib/prints/store";
import { handleStripeEvent } from "../../src/lib/prints/stripe-events";
import { ADDRESS, captureLogs, fakeFetch, insertOrder, json, NOW, printDb, testConfig, testDeps, type Handler } from "./prints-fakes";
import { render, text } from "./render";

// mark resolved (spec 20, after plan 7's final review): George clears a needs_attention order he has dealt with outside
// the site; any write that moves an order into needs_attention again clears it, so a new problem shows again

const ORDER = "01k6x00000000000000000000a";
const EARLIER = NOW - 3600;
const formOf = (entries: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return form;
};
const depsOf = (db: D1Database, placeLater = vi.fn()): ActionDeps & { orders: { placeLater: ReturnType<typeof vi.fn>; retryWindow: number } } => ({ db, media: {} as R2Bucket, images: {} as ImagesBinding, orders: { placeLater, retryWindow: 86_400 } });
/** The form as the view posts it: the order's id and the reason the page showed */
const resolve = (db: D1Database, id = ORDER, reason = "stuck") => runAction(formOf({ intent: "order.resolve", id, reason }), depsOf(db));

afterEach(() => vi.restoreAllMocks());

describe("mark resolved", () => {
  test("a needs_attention order is marked resolved, in one write that touches nothing else", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "stuck", attention_notified_at: EARLIER });
    const before = (await getOrder(db, ORDER))!;
    const started = Math.floor(Date.now() / 1000);
    expect(await resolve(db)).toEqual({ ok: true, section: "orders", note: "resolved" });
    const after = (await getOrder(db, ORDER))!;
    expect(after.resolved_at).toBeGreaterThanOrEqual(started);
    expect(after).toEqual({ ...before, resolved_at: after.resolved_at, updated_at: after.resolved_at });
  });

  test("only a needs_attention order: any other status is refused and unchanged", async () => {
    for (const status of ["paid", "placed", "in_production", "shipped", "delivered", "cancelled", "refunded"]) {
      const db = await printDb();
      await insertOrder(db, { id: ORDER, status });
      const before = await getOrder(db, ORDER);
      expect(await resolve(db), status).toEqual({ ok: false, section: "orders", form: `order-${ORDER}`, errors: { form: "that order doesn't need attention any more." }, values: {} });
      expect(await getOrder(db, ORDER)).toEqual(before);
    }
  });

  test("a second click writes nothing and counts as saved; an unknown or malformed id is gone", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "stuck", resolved_at: EARLIER, updated_at: EARLIER });
    const before = await getOrder(db, ORDER);
    expect(await resolve(db)).toEqual({ ok: true, section: "orders", note: "resolved" });
    expect(await getOrder(db, ORDER)).toEqual(before);
    for (const id of ["01k6x0000000000000000000zz", "../x"]) expect(await resolve(db, id)).toMatchObject({ ok: false, section: null, errors: { form: "that order no longer exists" } });
  });

  test("resolving is bound to the reason the page showed: an order flagged again since does nothing and says it changed", async () => {
    const db = await printDb();
    // Refunded in stripe while artelo had it, after the page loaded showing artelo's hold
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: REFUND_REASON, artelo_order_id: "artelo-1" });
    const before = await getOrder(db, ORDER);
    expect(await resolve(db, ORDER, PENDING_REASON)).toEqual({ ok: false, section: "orders", form: `order-${ORDER}`, errors: { form: "that order changed. look again before resolving." }, values: {} });
    expect(await getOrder(db, ORDER)).toEqual(before);
    // A form with no reason, or a reason the order never had, is refused the same way
    for (const reason of ["", "something else"]) expect(await resolve(db, ORDER, reason)).toMatchObject({ ok: false, errors: { form: "that order changed. look again before resolving." } });
    expect(await getOrder(db, ORDER)).toEqual(before);
    // With the reason it has, it resolves
    expect(await resolve(db, ORDER, REFUND_REASON)).toEqual({ ok: true, section: "orders", note: "resolved" });
    expect((await getOrder(db, ORDER))?.resolved_at).not.toBeNull();
  });

  test("a resolved order can't be retried: the view hides it and the action's guard refuses it", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "stuck", resolved_at: EARLIER, lease_until: null });
    const [order] = (await loadOrdersAdmin(db, testConfig(), NOW)).orders;
    expect(canRetry(order)).toBe(false);
    const deps = depsOf(db);
    expect(await runAction(formOf({ intent: "order.retry", id: ORDER }), deps)).toMatchObject({ ok: false, errors: { form: "that order can't be retried from here." } });
    expect(deps.orders.placeLater).not.toHaveBeenCalled();
    expect((await getOrder(db, ORDER))?.status).toBe("needs_attention");
  });

  test("the view: a resolved order leaves the needs-attention-first ordering, loses its dot and its forms, and keeps its reason with a resolved note", async () => {
    const db = await printDb();
    await insertOrder(db, { id: "01k6x00000000000000000000a", status: "needs_attention", attention_reason: "stuck", paid_at: NOW - 100 });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "placed", artelo_order_id: "artelo-2", paid_at: NOW - 200 });
    // The newest, but resolved: it takes its place by date among the rest, not at the top
    await insertOrder(db, { id: "01k6x00000000000000000000c", status: "needs_attention", attention_reason: "artelo refused the order (403).", resolved_at: EARLIER, paid_at: NOW - 50 });
    await insertOrder(db, { id: "01k6x00000000000000000000d", status: "needs_attention", attention_reason: "stuck too", paid_at: NOW - 300 });
    const data = await loadOrdersAdmin(db, testConfig(), NOW);
    expect(data.orders.map((order) => order.id.slice(-1))).toEqual(["a", "d", "c", "b"]);
    const doc = await render(OrdersAdmin, { data, failure: null });
    expect([...doc.querySelectorAll(".orders-admin > li")].map((li) => li.id.slice(-1))).toEqual(["a", "d", "c", "b"]);
    const resolved = doc.querySelector("#order-01k6x00000000000000000000c")!;
    expect(resolved.classList.contains("attention")).toBe(false);
    expect(resolved.classList.contains("resolved")).toBe(true);
    expect(resolved.querySelector(".attention-dot")).toBeNull();
    expect(resolved.querySelector("form")).toBeNull();
    expect(text(resolved.querySelector(".reason"))).toBe("artelo refused the order (403).");
    expect(text(resolved.querySelector(".resolved-on"))).toBe(`resolved ${stamp(EARLIER)}`);
    expect(text(resolved.querySelector(".order-sums"))).toContain("needs attention");
    // An unresolved one keeps its dot, retry now and mark resolved
    const stuck = doc.querySelector("#order-01k6x00000000000000000000a")!;
    expect(stuck.querySelector(".attention-dot")).not.toBeNull();
    expect(stuck.querySelector(".resolved-on")).toBeNull();
    expect(stuck.querySelector('input[value="order.retry"]')).not.toBeNull();
    const form = stuck.querySelector('input[value="order.resolve"]')!.closest("form")!;
    expect([form.getAttribute("method"), form.getAttribute("action"), form.querySelector<HTMLInputElement>('input[name="id"]')!.value, form.querySelector<HTMLInputElement>('input[name="reason"]')!.value, text(form.querySelector("button"))]).toEqual(["post", "/admin/#order-01k6x00000000000000000000a", "01k6x00000000000000000000a", "stuck", "mark resolved"]);
    // A resolved_at left from an earlier episode shows nothing once the order has moved on
    expect(data.orders.find((order) => order.id.endsWith("b"))?.resolvedAt).toBeNull();
  });
});

describe("anything that moves an order into needs_attention again clears resolved_at", () => {
  const cleared = async (db: D1Database, reason?: string) => expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", resolved_at: null, ...(reason ? { attention_reason: reason } : {}) });

  test("a full refund of a resolved order artelo holds: the refund reason, and it shows again", async () => {
    captureLogs();
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: PENDING_REASON, artelo_order_id: "artelo-1", resolved_at: EARLIER });
    const deps = testDeps(db);
    expect(await handleStripeEvent(deps, { id: "evt_r", type: "charge.refunded", livemode: false, data: { object: { payment_intent: `pi_test_${ORDER}`, amount: 28700, amount_refunded: 28700, refunded: true } } })).toBe(200);
    await cleared(db, REFUND_REASON);
  });

  test("a paid session that doesn't match its quote", async () => {
    captureLogs();
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "expired", stripe_session_id: "cs_1", stripe_payment_intent: null, paid_at: null, resolved_at: EARLIER });
    const session = { id: "cs_1", status: "complete", payment_status: "paid", client_reference_id: ORDER, livemode: false, currency: "aud", amount_total: 1, payment_intent: "pi_1", metadata: { order_id: ORDER } };
    expect(await handleStripeEvent(testDeps(db), { id: "evt_1", type: "checkout.session.completed", livemode: false, data: { object: session } })).toBe(200);
    await cleared(db, "the amount paid differs from the quote");
  });

  test("artelo asking for something, and a status reaching a refunded order with no artelo id", async () => {
    captureLogs();
    let db = await printDb();
    await insertOrder(db, { id: ORDER, status: "placed", artelo_order_id: "artelo-1", resolved_at: EARLIER });
    expect(await applyArteloUpdate(testDeps(db), { orderId: "artelo-1", status: "PendingFulfillmentAction", shipments: null })).toBe("applied");
    await cleared(db, PENDING_REASON);
    // Resolved, then refunded (which keeps resolved_at), then artelo says it has it
    db = await printDb();
    await insertOrder(db, { id: ORDER, status: "refunded", artelo_order_id: null, refunded_amount: 28700, resolved_at: EARLIER });
    expect(await applyArteloUpdate(testDeps(db), { orderId: ORDER, status: "Received", shipments: null })).toBe("applied");
    await cleared(db, REFUND_REASON);
  });

  test("the daily stranded-refund lookup, matched and unmatched", async () => {
    captureLogs();
    const LOOKUP = "GET https://artelo.test/orders/get";
    const answers: [Handler, string | null][] = [
      [(request) => json([{ id: "artelo-9", orderId: new URL(request.url).searchParams.get("name"), status: "Received" }]), "artelo-9"],
      [(request) => json([{ id: "artelo-9", name: new URL(request.url).searchParams.get("name") }]), null],
    ];
    for (const [answer, arteloId] of answers) {
      const db = await printDb();
      await insertOrder(db, { id: ORDER, status: "refunded", artelo_order_id: null, refunded_amount: 28700, paid_at: NOW - 86_400, resolved_at: EARLIER });
      await lookUpStrandedRefunds(testDeps(db, { fetch: fakeFetch({ [LOOKUP]: answer }).fetch }), async () => {});
      await cleared(db, REFUND_REASON);
      expect((await getOrder(db, ORDER))?.artelo_order_id).toBe(arteloId);
    }
  });

  test("placement: a permanent failure, artelo holding it on create, and a refund landing while it was created", async () => {
    captureLogs();
    const LOOKUP = "GET https://artelo.test/orders/get";
    const CREATE = "POST https://artelo.test/orders/create";
    const INTENT = "GET https://stripe.test/v1/payment_intents/pi_test_place";
    const shipping = { name: ADDRESS.name, phone: ADDRESS.phone, address: { line1: ADDRESS.line1, line2: ADDRESS.line2, city: ADDRESS.city, state: ADDRESS.state, postal_code: ADDRESS.postcode, country: ADDRESS.country } };
    const holder: { db?: D1Database } = {};
    const created = (status: string) => () => json({ id: "artelo-1", orderId: ORDER, status, details: { productionCost: 80, arteloShipping: 30 } });
    const cases: [Handler, string][] = [
      [() => json({ message: "unknown size" }, 422), "artelo refused the order: unknown size"],
      [created("PendingFulfillmentAction"), PENDING_REASON],
      [async () => {
        await holder.db!.prepare("UPDATE print_orders SET status = 'refunded', refunded_amount = 28700 WHERE id = ?").bind(ORDER).run();
        return created("Received")();
      }, REFUND_REASON],
    ];
    for (const [create, reason] of cases) {
      const db = await printDb();
      holder.db = db;
      // A resolved_at left from an earlier episode (the order resolved, then paid again would clear it; the statement is what is tested)
      await insertOrder(db, { id: ORDER, stripe_payment_intent: "pi_test_place", resolved_at: EARLIER });
      await placeOrder(testDeps(db, { fetch: fakeFetch({ [LOOKUP]: () => json([]), [CREATE]: create, [INTENT]: () => json({ id: "pi_test_place", shipping }) }).fetch }), ORDER);
      await cleared(db, reason);
    }
  });
});
