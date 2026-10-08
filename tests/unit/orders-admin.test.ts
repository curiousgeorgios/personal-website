import { afterEach, describe, expect, test, vi } from "vitest";
import OrdersAdmin from "../../src/components/admin/OrdersAdmin.astro";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { loadOrdersAdmin, stamp } from "../../src/lib/prints/admin";
import { placeOrder } from "../../src/lib/prints/place";
import { getOrder, readSettings } from "../../src/lib/prints/store";
import { ADDRESS, captureLogs, fakeFetch, insertOrder, json, NOW, printDb, testConfig, testDeps } from "./prints-fakes";
import { render, text } from "./render";

const ORDER = "01k6x00000000000000000000a";
const formOf = (entries: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return form;
};
const depsOf = (db: D1Database, placeLater = vi.fn()): ActionDeps & { orders: { placeLater: ReturnType<typeof vi.fn>; retryWindow: number } } => ({ db, media: {} as R2Bucket, images: {} as ImagesBinding, orders: { placeLater, retryWindow: 86_400 } });

afterEach(() => vi.restoreAllMocks());

describe("the orders section's actions", () => {
  test("the buffer saves a whole percent from 0 to 20 as a share", async () => {
    const db = await printDb();
    expect(await runAction(formOf({ intent: "prints.buffer", buffer: "12" }), depsOf(db))).toEqual({ ok: true, section: "orders" });
    expect((await readSettings(db)).buffer).toBe(0.12);
    expect(await runAction(formOf({ intent: "prints.buffer", buffer: "0" }), depsOf(db))).toEqual({ ok: true, section: "orders" });
    for (const buffer of ["21", "-1", "8.5", "", "eight"]) {
      expect(await runAction(formOf({ intent: "prints.buffer", buffer }), depsOf(db))).toEqual({ ok: false, section: "orders", form: "buffer", errors: { buffer: "a whole number from 0 to 20" }, values: { buffer } });
    }
    expect((await readSettings(db)).buffer).toBe(0);
  });

  test("the buffer's edges: 20 saves, a missing field, 100, 1e1 and a full-width digit are refused and change nothing", async () => {
    const db = await printDb();
    expect(await runAction(formOf({ intent: "prints.buffer", buffer: "20" }), depsOf(db))).toEqual({ ok: true, section: "orders" });
    expect((await readSettings(db)).buffer).toBe(0.2);
    expect(await runAction(formOf({ intent: "prints.buffer" }), depsOf(db))).toEqual({ ok: false, section: "orders", form: "buffer", errors: { buffer: "a whole number from 0 to 20" }, values: { buffer: "" } });
    for (const buffer of ["100", "1e1", "２", "0x1", "+5"]) {
      expect(await runAction(formOf({ intent: "prints.buffer", buffer }), depsOf(db))).toMatchObject({ ok: false, errors: { buffer: "a whole number from 0 to 20" } });
    }
    // Never clamped: the last good value stands
    expect((await readSettings(db)).buffer).toBe(0.2);
  });

  test("retry now sets an attention order back to paid with a fresh day and places it in the background", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "artelo didn't take the order within a day: artelo answered 503", attempts: 8, attention_notified_at: 1, lease_until: 5 });
    const deps = depsOf(db);
    const before = Math.floor(Date.now() / 1000);
    expect(await runAction(formOf({ intent: "order.retry", id: ORDER }), deps)).toEqual({ ok: true, section: "orders", note: "retry" });
    const order = (await getOrder(db, ORDER))!;
    expect(order).toMatchObject({ status: "paid", attempts: 0, attention_reason: null, attention_notified_at: null, lease_until: null });
    expect(order.retry_until! - order.next_attempt_at!).toBe(86_400);
    expect(order.next_attempt_at).toBeGreaterThanOrEqual(before);
    expect(deps.orders.placeLater).toHaveBeenCalledWith(ORDER);
    // A repeat counts as saved, and starts nothing new
    expect(await runAction(formOf({ intent: "order.retry", id: ORDER }), deps)).toEqual({ ok: true, section: "orders", note: "retry" });
    expect(deps.orders.placeLater).toHaveBeenCalledTimes(1);
  });

  test("an order artelo already has, or one that isn't stuck, can't be retried from here; an unknown one is gone", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", artelo_order_id: "artelo-1" });
    expect(await runAction(formOf({ intent: "order.retry", id: ORDER }), depsOf(db))).toEqual({ ok: false, section: "orders", form: `order-${ORDER}`, errors: { form: "that order can't be retried from here." }, values: {} });
    expect(await runAction(formOf({ intent: "order.retry", id: "01k6x0000000000000000000zz" }), depsOf(db))).toEqual({ ok: false, section: null, form: "", errors: { form: "that order no longer exists" }, values: {} });
    expect(await runAction(formOf({ intent: "order.retry", id: "../x" }), depsOf(db))).toMatchObject({ ok: false, errors: { form: "that order no longer exists" } });
  });
});

describe("retry now never places what it mustn't", () => {
  const refused = { ok: false, section: "orders", form: `order-${ORDER}`, errors: { form: "that order can't be retried from here." }, values: {} };
  const unchanged = async (columns: Record<string, string | number | null>) => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, ...columns });
    const before = await getOrder(db, ORDER);
    const deps = depsOf(db);
    const result = await runAction(formOf({ intent: "order.retry", id: ORDER }), deps);
    expect(await getOrder(db, ORDER)).toEqual(before);
    expect(deps.orders.placeLater).not.toHaveBeenCalled();
    return result;
  };

  test("a refunded order does nothing, and keeps the lease that marks artelo may have it", async () => {
    // ADR-0026: a refunded order holding a lapsed lease and no artelo id is the marker the daily job looks for
    expect(await unchanged({ status: "refunded", lease_until: 5, attempts: 3, refunded_amount: 28700 })).toEqual(refused);
  });

  test("an order artelo has does nothing", async () => {
    expect(await unchanged({ status: "needs_attention", artelo_order_id: "artelo-1", attention_reason: "artelo needs something before it can print: open the order in artelo." })).toEqual(refused);
  });

  test("an order whose lease is still live does nothing", async () => {
    expect(await unchanged({ status: "needs_attention", attention_reason: "stuck", lease_until: Math.floor(Date.now() / 1000) + 100 })).toEqual(refused);
  });

  test("placed, shipped, cancelled and the rest are never touched", async () => {
    for (const status of ["placed", "in_production", "shipped", "delivered", "cancelled", "checkout", "expired"]) {
      expect(await unchanged({ status })).toEqual(refused);
    }
  });

  test("two retries at once make one placement, through placeOrder", async () => {
    captureLogs();
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "artelo didn't take the order within a day: artelo answered 503", stripe_payment_intent: "pi_test_retry", attempts: 8 });
    const shipping = { name: ADDRESS.name, phone: ADDRESS.phone, address: { line1: ADDRESS.line1, line2: ADDRESS.line2, city: ADDRESS.city, state: ADDRESS.state, postal_code: ADDRESS.postcode, country: ADDRESS.country } };
    const fake = fakeFetch({
      "GET https://artelo.test/orders/get": () => json([]),
      "GET https://stripe.test/v1/payment_intents/pi_test_retry": () => json({ id: "pi_test_retry", shipping }),
      "POST https://artelo.test/orders/create": async (request) => json({ id: "artelo-9", orderId: ((await request.json()) as { orderId: string }).orderId, status: "Received" }),
    });
    // The admin's clock, as the page's placeLater has it
    const prints = testDeps(db, { fetch: fake.fetch, now: () => Math.floor(Date.now() / 1000) });
    const placing: Promise<unknown>[] = [];
    const deps = depsOf(db, vi.fn((id: string) => void placing.push(placeOrder(prints, id))));
    const results = await Promise.all([runAction(formOf({ intent: "order.retry", id: ORDER }), deps), runAction(formOf({ intent: "order.retry", id: ORDER }), deps)]);
    expect(results).toEqual([{ ok: true, section: "orders", note: "retry" }, { ok: true, section: "orders", note: "retry" }]);
    expect(await Promise.all(placing)).toEqual(["placed"]);
    expect(fake.calls.filter((call) => call.url.endsWith("/orders/create"))).toHaveLength(1);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-9", attempts: 1 });
  });
});

describe("loadOrdersAdmin", () => {
  test("needs attention first, then newest paid; checkout and expired orders left out; lines in order", async () => {
    const db = await printDb();
    await insertOrder(db, { id: "01k6x00000000000000000000a", status: "placed", paid_at: NOW - 100, artelo_order_id: "artelo-1", artelo_cost: 6140 });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "needs_attention", attention_reason: "artelo refused the order: unknown size", paid_at: NOW - 900 });
    await insertOrder(db, { id: "01k6x00000000000000000000c", status: "shipped", paid_at: NOW - 50, livemode: 1, refunded_amount: 4900, shipments: JSON.stringify([{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }]) });
    await insertOrder(db, { id: "01k6x00000000000000000000d", status: "checkout", paid_at: null });
    await insertOrder(db, { id: "01k6x00000000000000000000e", status: "expired", paid_at: null });
    const data = await loadOrdersAdmin(db, testConfig(), NOW);
    expect(data.orders.map((order) => order.id)).toEqual(["01k6x00000000000000000000b", "01k6x00000000000000000000c", "01k6x00000000000000000000a"]);
    expect(data.orders[1]).toMatchObject({ status: "shipped", livemode: true, refundedAmount: 4900, shipments: [{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }], paymentIntent: "pi_test_01k6x00000000000000000000c" });
    expect(data.orders[2].lines).toEqual([{ photoId: "fixture-b-01", tier: "medium", frame: "oak", quantity: 1 }, { photoId: "fixture-b-02", tier: "small", frame: "unframed", quantity: 1 }]);
    expect(data).toMatchObject({ status: { open: true }, rate: 1.5, rateDate: "2026-10-07", stale: false, webhookAt: null, webhookMissing: false, buffer: 0.08 });
  });

  test("the latest 100 only", async () => {
    const db = await printDb();
    for (let n = 0; n < 102; n += 1) await insertOrder(db, { id: `01k6x0000000000000000${String(n).padStart(5, "0")}`, status: "placed", paid_at: NOW - n });
    const data = await loadOrdersAdmin(db, testConfig(), NOW);
    expect(data.orders).toHaveLength(100);
    expect(data.orders.at(-1)!.id).toBe("01k6x000000000000000000099");
    expect(data.orders.every((order) => order.lines.length === 2)).toBe(true);
  });

  test("a rate older than a week is stale; no rate closes prints", async () => {
    const db = await printDb();
    expect((await loadOrdersAdmin(db, testConfig(), NOW + 8 * 86_400)).stale).toBe(true);
    await db.prepare("DELETE FROM print_settings WHERE key = 'usd_aud'").run();
    expect((await loadOrdersAdmin(db, testConfig(), NOW)).status).toEqual({ open: false, reason: "no exchange rate has been fetched yet" });
  });

  test("time stamps read in sydney, either side of daylight saving", () => {
    // 03:02 UTC on 8 October 2026 is 14:02 in Sydney (AEDT); 04:02 UTC on 8 June is 14:02 (AEST)
    expect(stamp(Date.UTC(2026, 9, 8, 3, 2) / 1000)).toBe("08.10.26 14:02");
    expect(stamp(Date.UTC(2026, 5, 8, 4, 2) / 1000)).toBe("08.06.26 14:02");
  });
});

describe("the orders section", () => {
  const base = async () => {
    const db = await printDb();
    await insertOrder(db, { id: "01k6x00000000000000000000a", status: "needs_attention", attention_reason: "artelo didn't take the order within a day: artelo answered 503", paid_at: Date.UTC(2026, 9, 8, 3, 2) / 1000 });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "shipped", livemode: 1, artelo_order_id: "48213", artelo_cost: 6140, refunded_amount: 4900, stripe_payment_intent: "pi_live_1", shipments: JSON.stringify([{ carrier: "ups", number: "1Z999", url: "https://www.ups.com/track?tracknum=1Z999" }]) });
    await insertOrder(db, { id: "01k6x00000000000000000000c", status: "needs_attention", artelo_order_id: "48214", attention_reason: "artelo needs something before it can print: open the order in artelo.", paid_at: NOW - 200_000 });
    return loadOrdersAdmin(db, testConfig(), NOW);
  };

  test("the status lines first: open or why not, the rate, the webhook", async () => {
    let doc = await render(OrdersAdmin, { data: await base(), failure: null });
    expect([...doc.querySelectorAll(".orders-status li")].map(text)).toEqual(["prints are open", "us$1 = a$1.50 · ecb rate of 07.10.26", "artelo webhook: not heard from yet"]);
    const closed = { ...(await base()), status: { open: false as const, reason: 'PRINTS_OPEN isn\'t "true"' }, stale: true, webhookMissing: true };
    doc = await render(OrdersAdmin, { data: closed, failure: null });
    expect([...doc.querySelectorAll(".orders-status li")].map(text)).toEqual(['prints are closed: PRINTS_OPEN isn\'t "true"', "us$1 = a$1.50 · ecb rate of 07.10.26 - older than a week, check the rate job", "artelo webhook: missing - run bun run prints:webhook --remote"]);
    doc = await render(OrdersAdmin, { data: { ...(await base()), webhookAt: Date.UTC(2026, 9, 8, 3, 2) / 1000 }, failure: null });
    expect(text(doc.querySelectorAll(".orders-status li")[2])).toBe("artelo webhook: connected · last heard 08.10.26 14:02");
  });

  test("the buffer form shows the current percent and its hint", async () => {
    const doc = await render(OrdersAdmin, { data: await base(), failure: null });
    const form = doc.querySelector("form#buffer")!;
    expect(form.querySelector('input[name="intent"]')!.getAttribute("value")).toBe("prints.buffer");
    expect(form.querySelector('input[name="buffer"]')!.getAttribute("value")).toBe("8");
    expect(text(form.querySelector(".hint"))).toBe("added to artelo's delivery cost for exchange-rate movement. it applies to the next quote.");
  });

  test("a refused buffer comes back with what was typed and the form's error", async () => {
    const failure = { ok: false as const, section: "orders" as const, form: "buffer", errors: { buffer: "a whole number from 0 to 20" }, values: { buffer: "25" } };
    const doc = await render(OrdersAdmin, { data: await base(), failure });
    expect(doc.querySelector("#buffer-buffer")!.getAttribute("value")).toBe("25");
    expect(doc.querySelector("#buffer-buffer")!.getAttribute("aria-invalid")).toBe("true");
    expect(text(doc.querySelector("#buffer-buffer-error"))).toBe("a whole number from 0 to 20");
  });

  test("each order says what george needs, attention first with its reason and a red dot", async () => {
    const doc = await render(OrdersAdmin, { data: await base(), failure: null });
    // Attention first (the newer paid first), then the rest
    const [stuck, held, shipped] = [...doc.querySelectorAll(".orders-admin > li")];
    expect(stuck.classList.contains("attention")).toBe(true);
    expect(stuck.querySelector(".attention-dot")).not.toBeNull();
    expect(text(stuck.querySelector(".order-line"))).toBe("08.10.26 14:02 · 01k6x00000000000000000000a");
    expect(text(stuck.querySelector(".order-prints"))).toBe("2 prints: fixture-b-01 medium oak, fixture-b-02 small unframed");
    expect(stuck.querySelector('.order-prints a[href="/photos/fixture-b-01"]')).not.toBeNull();
    expect(text(stuck.querySelector(".order-sums"))).toBe("to au · $238 + $49 = $287 · needs attention · test");
    expect(text(stuck.querySelector(".reason"))).toBe("artelo didn't take the order within a day: artelo answered 503");
    expect(stuck.querySelector('form input[name="intent"][value="order.retry"]')).not.toBeNull();
    expect(text(shipped.querySelector(".order-sums"))).toBe("to au · $238 + $49 = $287 · shipped · refunded $49 · artelo 48213 us$61.40");
    expect(shipped.querySelector(".order-tracking a")!.getAttribute("href")).toBe("https://www.ups.com/track?tracknum=1Z999");
    expect(text(shipped.querySelector(".order-tracking a"))).toBe("ups 1Z999");
    expect(shipped.querySelector("form")).toBeNull();
    // Artelo has it: no retry, open it there instead
    expect(held.querySelector("form")).toBeNull();
    expect(text(held.querySelector(".open-in-artelo"))).toBe("open it in artelo (order 48214)");
  });

  test("a failed retry shows its message on that order's form", async () => {
    const failure = { ok: false as const, section: "orders" as const, form: "order-01k6x00000000000000000000a", errors: { form: "that order can't be retried from here." }, values: {} };
    const doc = await render(OrdersAdmin, { data: await base(), failure });
    expect(text(doc.querySelector("#order-01k6x00000000000000000000a .error"))).toBe("that order can't be retried from here.");
    expect(doc.querySelector("#order-01k6x00000000000000000000a form")!.getAttribute("action")).toBe("/admin/#order-01k6x00000000000000000000a");
    // One that moved on meanwhile has no form left, and still shows why
    const moved = await render(OrdersAdmin, { data: await base(), failure: { ...failure, form: "order-01k6x00000000000000000000b" } });
    expect(moved.querySelector("#order-01k6x00000000000000000000b form")).toBeNull();
    expect(text(moved.querySelector("#order-01k6x00000000000000000000b .error"))).toBe("that order can't be retried from here.");
  });

  test("whatever artelo or stripe sent is shown as text, and only an https tracking address becomes a link", async () => {
    const db = await printDb();
    const shipments = [
      { carrier: "<b>ups</b>", number: "1Z<img src=x onerror=alert(1)>", url: "javascript:alert(1)" },
      { carrier: "dhl", number: "JD01", url: "http://dhl.example/JD01" },
      { carrier: "fedex", number: "77", url: "" },
      { carrier: "auspost", number: "AP1", url: "https://auspost.example/AP1\"onmouseover=\"alert(1)" },
    ];
    await insertOrder(db, { id: ORDER, status: "shipped", artelo_order_id: "<script>alert(1)</script>", stripe_payment_intent: "pi_1/../../x?y", shipments: JSON.stringify(shipments) });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "needs_attention", attention_reason: "<img src=x onerror=alert(1)> refused" });
    const doc = await render(OrdersAdmin, { data: await loadOrdersAdmin(db, testConfig(), NOW), failure: null });
    expect(doc.querySelector("script, img, b")).toBeNull();
    expect(doc.querySelector("[onerror], [onmouseover]")).toBeNull();
    expect(text(doc.querySelector(".reason"))).toBe("<img src=x onerror=alert(1)> refused");
    const tracking = doc.querySelector(`#order-${ORDER} .order-tracking`)!;
    expect([...tracking.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(['https://auspost.example/AP1"onmouseover="alert(1)']);
    expect(text(tracking)).toBe("<b>ups</b> 1Z<img src=x onerror=alert(1)> · dhl JD01 · fedex 77 · auspost AP1");
    expect(text(doc.querySelector(`#order-${ORDER} .order-sums`))).toContain("artelo <script>alert(1)</script>");
    // The payment intent stays one path segment of stripe's dashboard
    expect(doc.querySelector(`#order-${ORDER} .refund`)!.getAttribute("href")).toBe("https://dashboard.stripe.com/test/payments/pi_1%2F..%2F..%2Fx%3Fy");
  });

  test("nothing personal: the section shows no buyer email, name or street", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "artelo refused the order: [address] isn't valid" });
    const html = (await render(OrdersAdmin, { data: await loadOrdersAdmin(db, testConfig(), NOW), failure: null })).body.innerHTML;
    for (const value of [ADDRESS.name, ADDRESS.line1, ADDRESS.city, ADDRESS.phone, "@"]) expect(html).not.toContain(value);
  });

  test("refunds happen in stripe: a link per paid order, to test or live, in a new tab", async () => {
    const doc = await render(OrdersAdmin, { data: await base(), failure: null });
    const links = [...doc.querySelectorAll(".refund")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://dashboard.stripe.com/test/payments/pi_test_01k6x00000000000000000000a",
      "https://dashboard.stripe.com/test/payments/pi_test_01k6x00000000000000000000c",
      "https://dashboard.stripe.com/payments/pi_live_1",
    ]);
    expect(links.every((a) => a.getAttribute("target") === "_blank" && a.getAttribute("rel") === "noopener noreferrer")).toBe(true);
    expect(text(doc.querySelector(".orders-hint"))).toBe("refunds happen in stripe. a refund doesn't cancel the artelo order, and an artelo cancellation doesn't refund the buyer; a full refund of a placed order shows here as needs attention until it's cancelled in artelo.");
  });

  test("no orders, and an unreadable section, each say so", async () => {
    const db = await printDb();
    expect(text((await render(OrdersAdmin, { data: await loadOrdersAdmin(db, testConfig(), NOW), failure: null })).querySelector(".empty"))).toBe("no print orders yet.");
    expect(text((await render(OrdersAdmin, { data: null, failure: null })).querySelector(".empty"))).toBe("orders aren't loading right now. try again in a bit.");
  });
});
