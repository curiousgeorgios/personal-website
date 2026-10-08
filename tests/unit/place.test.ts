import { afterEach, describe, expect, test, vi } from "vitest";
import { verifyPhotoToken } from "../../src/lib/photos/tokens";
import { LEASE_SECONDS, nextDelay, placeDue, placeOrder, scrub, type PlaceOutcome } from "../../src/lib/prints/place";
import { getOrder } from "../../src/lib/prints/store";
import { ADDRESS, captureLogs, dumpDb, fakeFetch, insertOrder, json, masters, NOW, PHOTO_KEY, printDb, testConfig, testDeps, type Handler } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";
const LOOKUP = "GET https://artelo.test/orders/get";
const CREATE = "POST https://artelo.test/orders/create";
const INTENT = "GET https://stripe.test/v1/payment_intents/pi_test_place";
const shipping = { name: ADDRESS.name, phone: ADDRESS.phone, address: { line1: ADDRESS.line1, line2: ADDRESS.line2, city: ADDRESS.city, state: ADDRESS.state, postal_code: ADDRESS.postcode, country: ADDRESS.country } };
const accepted: Handler = async (request) => {
  const body = (await request.json()) as { orderId: string };
  return json({ id: "artelo-1", orderId: body.orderId, status: "Received", details: { productionCost: 80, arteloShipping: 30, usSalesTax: 0 } });
};
const world = (over: Record<string, Handler> = {}) => fakeFetch({ [LOOKUP]: () => json([]), [CREATE]: accepted, [INTENT]: () => json({ id: "pi_test_place", shipping }), ...over });
const setup = async (handlers: Record<string, Handler> = {}, columns: Record<string, string | number | null> = {}, over = {}) => {
  const db = await printDb();
  const fake = world(handlers);
  await insertOrder(db, { id: ORDER, stripe_payment_intent: "pi_test_place", ...columns });
  return { db, fake, deps: testDeps(db, { fetch: fake.fetch, ...over }) };
};
const creates = (fake: ReturnType<typeof world>) => fake.calls.filter((call) => call.method === "POST" && call.url.endsWith("/orders/create"));

afterEach(() => vi.restoreAllMocks());

describe("placeOrder", () => {
  test("places the whole order once, to the quoted address, each print made from its own master", async () => {
    captureLogs();
    const { db, fake, deps } = await setup();
    expect(await placeOrder(deps, ORDER)).toBe("placed");
    const [create] = creates(fake);
    const body = JSON.parse(create.body);
    expect(body).toMatchObject({
      orderId: ORDER, createdAt: new Date((NOW - 60) * 1000).toISOString(), currency: "AUD", total: 287, shippingCost: 49, channelName: "curiousgeorge.dev",
      companyName: "george vlachos", isTestOrder: true,
      customerAddress: { name: "Ada Lovelace", street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" },
    });
    expect(body.items.map((item: { orderItemId: string; quantity: number; unitPrice: number; productInfo: Record<string, unknown> }) => [item.orderItemId, item.quantity, item.unitPrice, item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation, item.productInfo.paperType])).toEqual([
      [`${ORDER}-1`, 1, 179, "x12x18", "NaturalOak", "Vertical", "ArchivalMatteFineArt"],
      [`${ORDER}-2`, 1, 59, "x8x12", null, "Horizontal", "ArchivalMatteFineArt"],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/email|dangerouslySkipDPICheck/);
    for (const [index, photoId] of ["fixture-b-01", "fixture-b-02"].entries()) {
      const design = body.items[index].productInfo.designs[0];
      expect(design.fitOptions).toEqual({ canvas: "Paper", style: "Outside" });
      const link = new URL(design.sourceImage.url);
      expect(`${link.origin}${link.pathname}`).toBe(`https://curiousgeorge.dev/photos/downloads/${photoId}`);
      const token = await verifyPhotoToken(PHOTO_KEY, link.searchParams.get("token")!, NOW);
      expect(token).toMatchObject({ photoId, expiresAt: NOW + 72 * 3600 });
      expect(await db.prepare("SELECT order_id FROM photo_download_grants WHERE id = ?").bind(token!.grantId).first("order_id")).toBe(ORDER);
    }
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-1", artelo_status: "Received", artelo_cost: 11000, placed_at: NOW, lease_until: null, attempts: 1 });
  });

  test("every attempt looks the order up first, and adopts one artelo already has instead of creating it again", async () => {
    captureLogs();
    const { db, fake, deps } = await setup({ [LOOKUP]: () => json({ orders: [{ id: "artelo-old", orderId: "someone-else", status: "Received" }, { id: "artelo-7", orderId: ORDER, status: "Received", details: { productionCost: 80, arteloShipping: 30 } }] }) });
    expect(await placeOrder(deps, ORDER)).toBe("adopted");
    expect(fake.calls[0].url).toBe(`https://artelo.test/orders/get?limit=5&name=${ORDER}`);
    expect(creates(fake)).toHaveLength(0);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-7", artelo_cost: 11000 });
  });

  test("a failed or unreadable lookup never creates: it counts as retryable", async () => {
    captureLogs();
    for (const lookup of [() => json({}, 503), () => json({ found: "maybe" }), () => { throw new TypeError("network"); }] as Handler[]) {
      const { db, fake, deps } = await setup({ [LOOKUP]: lookup });
      expect(await placeOrder(deps, ORDER)).toBe("retry");
      expect(creates(fake)).toHaveLength(0);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", next_attempt_at: NOW + 300, lease_until: null });
    }
  });

  test("the lease stops two runs placing one order; an expired lease is taken over", async () => {
    captureLogs();
    const { fake, deps } = await setup();
    expect((await Promise.all([placeOrder(deps, ORDER), placeOrder(deps, ORDER)])).sort()).toEqual(["not-due", "placed"]);
    expect(creates(fake)).toHaveLength(1);
    const held = await setup({}, { lease_until: NOW + 60 });
    expect(await placeOrder(held.deps, ORDER)).toBe("not-due");
    const lapsed = await setup({}, { lease_until: NOW - 1 });
    expect(await placeOrder(lapsed.deps, ORDER)).toBe("placed");
  });

  test("an order not yet due, or no longer paid, isn't touched", async () => {
    for (const columns of [{ next_attempt_at: NOW + 1 }, { status: "needs_attention" }, { status: "placed" }, { status: "refunded" }] as Record<string, string | number | null>[]) {
      const { fake, deps } = await setup({}, columns);
      expect(await placeOrder(deps, ORDER)).toBe("not-due");
      expect(fake.calls).toHaveLength(0);
    }
  });

  test("retryable: a network error, a timeout, 408, 429 and any 5xx, including a proxy's html page", async () => {
    captureLogs();
    const answers: Handler[] = [() => { throw new TypeError("network"); }, () => { throw new DOMException("timed out", "TimeoutError"); }, () => json({}, 408), () => json({}, 429), () => json({}, 500), () => new Response("<html>bad gateway</html>", { status: 502 })];
    for (const answer of answers) {
      const { db, deps } = await setup({ [CREATE]: answer });
      expect(await placeOrder(deps, ORDER)).toBe("retry");
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", next_attempt_at: NOW + 300, lease_until: null, attempts: 1 });
    }
  });

  test("any other 4xx is permanent: needs attention at once, with artelo's message", async () => {
    captureLogs();
    for (const status of [400, 401, 403, 404, 422]) {
      const { db, deps } = await setup({ [CREATE]: () => json({ message: "unknown size" }, status) });
      expect(await placeOrder(deps, ORDER)).toBe("attention");
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "artelo refused the order: unknown size", lease_until: null, attention_notified_at: null });
    }
  });

  test("a partial refusal refuses the order: nothing is placed for the other print", async () => {
    captureLogs();
    const { db, fake, deps } = await setup({ [CREATE]: () => json({ message: `item ${ORDER}-2: the design for fixture-b-02 can't be printed` }, 400) });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect(creates(fake)).toHaveLength(1);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_order_id: null, attention_reason: `artelo refused the order: item ${ORDER}-2: the design for fixture-b-02 can't be printed` });
  });

  test("backoff: 5 minutes, then 15, 45, 2 hours 15, then every 6 hours", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(nextDelay)).toEqual([300, 900, 2700, 8100, 21600, 21600, 21600, 21600]);
  });

  test("within 24 hours of payment: the eighth failure is the last, and the order needs attention with the last error", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({}, 503) }, { paid_at: NOW, next_attempt_at: NOW, retry_until: NOW + 86_400 });
    let clock = NOW;
    for (let attempt = 0; attempt < 20; attempt++) {
      await placeOrder({ ...deps, now: () => clock }, ORDER);
      const row = (await getOrder(db, ORDER))!;
      if (row.status !== "paid") break;
      clock = row.next_attempt_at!;
    }
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attempts: 8, attention_reason: "artelo didn't take the order within a day: artelo answered 503" });
  });

  test("a window of nothing (the test build's PRINT_RETRY_WINDOW=0) sends the first failure to needs attention", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({}, 503) }, { retry_until: NOW - 60 });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("artelo didn't take the order within a day: artelo answered 503");
  });

  test("a missing master fails the whole order before anything is created", async () => {
    captureLogs();
    const { db, fake, deps } = await setup({}, {}, { photoPrints: masters(["fixture-b-02"]) });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect(creates(fake)).toHaveLength(0);
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("the print file for fixture-b-02 is missing. import it again, then retry.");
  });

  test("the address comes from the payment: unreadable is permanent, unreachable is retryable, none is permanent", async () => {
    captureLogs();
    let { db, deps } = await setup({ [INTENT]: () => json({ error: {} }, 404) });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("stripe couldn't give the payment's delivery address (404).");
    ({ db, deps } = await setup({ [INTENT]: () => json({}, 503) }));
    expect(await placeOrder(deps, ORDER)).toBe("retry");
    ({ db, deps } = await setup({ [INTENT]: () => json({ id: "pi_test_place", shipping: null }) }));
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("the payment has no delivery address.");
  });

  test("no signing key is permanent; a live order is a real one", async () => {
    captureLogs();
    const keyless = await setup({}, {}, { config: testConfig({ secrets: { ...testConfig().secrets, PHOTO_LINK_SECRET: "" } }) });
    expect(await placeOrder(keyless.deps, ORDER)).toBe("attention");
    expect((await getOrder(keyless.db, ORDER))?.attention_reason).toBe("PHOTO_LINK_SECRET isn't set.");
    const live = await setup({}, { livemode: 1 });
    await placeOrder(live.deps, ORDER);
    expect(JSON.parse(creates(live.fake)[0].body).isTestOrder).toBe(false);
  });

  test("artelo holding the order for action at once sends it to needs attention, adopted", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: async (request) => json({ id: "artelo-9", orderId: ((await request.json()) as { orderId: string }).orderId, status: "PendingFulfillmentAction" }) });
    await placeOrder(deps, ORDER);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_order_id: "artelo-9", attention_reason: "artelo needs something before it can print: open the order in artelo." });
  });

  test("a full refund landing while artelo makes the order flags it for cancelling there; it is never lost", async () => {
    captureLogs();
    const holder: { db?: D1Database } = {};
    const { db, deps } = await setup({
      [CREATE]: async (request) => {
        await holder.db!.prepare("UPDATE print_orders SET status = 'refunded', refunded_amount = 28700 WHERE id = ?").bind(ORDER).run();
        return accepted(request);
      },
    });
    holder.db = db;
    await placeOrder(deps, ORDER);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_order_id: "artelo-1", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", lease_until: null });
  });

  test("each attempt revokes the last attempt's master links, so only one set works", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({}, 503) });
    await placeOrder(deps, ORDER);
    await placeOrder({ ...deps, now: () => NOW + 300 }, ORDER);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ?").bind(ORDER).first("n")).toBe(4);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(2);
  });

  test("a 2xx without an order id is retried, and the next attempt's lookup adopts what artelo made (review focus 5)", async () => {
    captureLogs();
    let made = false;
    const { db, fake, deps } = await setup({
      [CREATE]: () => { made = true; return new Response("<html>ok</html>", { status: 200 }); },
      [LOOKUP]: () => json(made ? [{ id: "artelo-3", orderId: ORDER, status: "Received" }] : []),
    });
    expect(await placeOrder(deps, ORDER)).toBe("retry");
    expect(await placeOrder({ ...deps, now: () => NOW + 300 }, ORDER)).toBe("adopted");
    expect(creates(fake)).toHaveLength(1);
    expect((await getOrder(db, ORDER))?.artelo_order_id).toBe("artelo-3");
  });

  test("artelo's message never stores or logs the address", async () => {
    const logs = captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({ message: "Ada Lovelace at 12 Example Street, Bondi Beach can't be delivered to" }, 422) });
    await placeOrder(deps, ORDER);
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("artelo refused the order: [address] at [address], [address] can't be delivered to");
    expect(await dumpDb(db)).not.toMatch(/Ada|Lovelace|Example Street|Bondi|400 000/);
    expect(logs()).not.toMatch(/Ada|Lovelace|Example Street|Bondi|400 000|delivered/);
  });
});

test("scrub replaces each address field, whatever its case", () => {
  expect(scrub("ADA LOVELACE, unit 3, nsw", ADDRESS)).toBe("[address], [address], [address]");
  expect(scrub("unknown size", null)).toBe("unknown size");
});

test("placeDue places due orders oldest first and at most ten, leaving the rest", async () => {
  captureLogs();
  const db = await printDb();
  const fake = fakeFetch({ [LOOKUP]: () => json([]), [CREATE]: accepted, "GET https://stripe.test/v1/payment_intents/pi_test_a": () => json({ shipping }), "GET https://stripe.test/v1/payment_intents/pi_test_b": () => json({ shipping }) });
  await insertOrder(db, { id: "01k6x00000000000000000000b", stripe_payment_intent: "pi_test_b", paid_at: NOW - 10 });
  await insertOrder(db, { id: "01k6x00000000000000000000a", stripe_payment_intent: "pi_test_a", paid_at: NOW - 20 });
  await insertOrder(db, { id: "01k6x00000000000000000000c", stripe_payment_intent: "pi_test_c", next_attempt_at: NOW + 60 });
  await placeDue(testDeps(db, { fetch: fake.fetch }));
  expect(creates(fake).map((call) => JSON.parse(call.body).orderId)).toEqual(["01k6x00000000000000000000a", "01k6x00000000000000000000b"]);
  expect((await getOrder(db, "01k6x00000000000000000000c"))?.status).toBe("paid");
});

describe("the money path's further guards", () => {
  test("a fractional cost from artelo is stored in whole us cents", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: async (request) => json({ id: "artelo-5", orderId: ((await request.json()) as { orderId: string }).orderId, status: "Received", details: { productionCost: 80.401, arteloShipping: 30.17, usSalesTax: 0.332 } }) });
    expect(await placeOrder(deps, ORDER)).toBe("placed");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_cost: 11090 });
    expect(await db.prepare("SELECT typeof(artelo_cost) AS kind FROM print_orders WHERE id = ?").bind(ORDER).first("kind")).toBe("integer");
  });

  test("a payment whose shipping lacks a name, a street or a country is permanent, never sent half an address", async () => {
    captureLogs();
    const partial = [{ name: "Ada Lovelace", phone: null, address: null }, { name: null, address: { line1: "12 Example Street", country: "AU" } }, { name: "Ada Lovelace", address: { line1: "", country: "AU" } }, { name: "Ada Lovelace", address: { line1: "12 Example Street", country: null } }];
    for (const shipping of partial) {
      const { db, fake, deps } = await setup({ [INTENT]: () => json({ id: "pi_test_place", shipping }) });
      expect(await placeOrder(deps, ORDER)).toBe("attention");
      expect(creates(fake)).toHaveLength(0);
      expect((await getOrder(db, ORDER))?.attention_reason).toBe("the payment has no delivery address.");
    }
  });

  test("a readable 2xx without an order id is retried too, and the next lookup adopts it", async () => {
    captureLogs();
    let made = false;
    const { db, fake, deps } = await setup({
      [CREATE]: () => { made = true; return json({ status: "Received", message: "order received" }); },
      [LOOKUP]: () => json({ data: made ? [{ id: 44, orderId: ORDER, status: "Received" }] : [] }),
    });
    expect(await placeOrder(deps, ORDER)).toBe("retry");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", artelo_order_id: null, next_attempt_at: NOW + 300 });
    expect(await placeOrder({ ...deps, now: () => NOW + 300 }, ORDER)).toBe("adopted");
    expect(creates(fake)).toHaveLength(1);
    expect((await getOrder(db, ORDER))?.artelo_order_id).toBe("44");
  });

  test("needs attention again makes a new note due, whether the last one went or is still in flight", async () => {
    captureLogs();
    for (const earlier of [NOW - 3600, -(NOW - 30)]) {
      const refused = await setup({ [CREATE]: () => json({ message: "unknown size" }, 422) }, { attention_notified_at: earlier });
      expect(await placeOrder(refused.deps, ORDER)).toBe("attention");
      expect(await getOrder(refused.db, ORDER)).toMatchObject({ status: "needs_attention", attention_notified_at: null });
      const late = await setup({ [CREATE]: () => json({}, 503) }, { attention_notified_at: earlier, retry_until: NOW - 60 });
      expect(await placeOrder(late.deps, ORDER)).toBe("attention");
      expect(await getOrder(late.db, ORDER)).toMatchObject({ status: "needs_attention", attention_notified_at: null });
      const held = await setup({ [CREATE]: async (request) => json({ id: "artelo-9", orderId: ((await request.json()) as { orderId: string }).orderId, status: "PendingFulfillmentAction" }) }, { attention_notified_at: earlier });
      await placeOrder(held.deps, ORDER);
      expect(await getOrder(held.db, ORDER)).toMatchObject({ status: "needs_attention", attention_notified_at: null });
    }
  });

  test("placeDue takes the ten oldest due orders, skipping older ones not yet due", async () => {
    captureLogs();
    const db = await printDb();
    const handlers: Record<string, Handler> = { [LOOKUP]: () => json([]), [CREATE]: accepted };
    const id = (n: number) => `01k6x000000000000000000${String(n).padStart(3, "0")}`;
    for (let n = 1; n <= 14; n++) {
      handlers[`GET https://stripe.test/v1/payment_intents/pi_test_${n}`] = () => json({ shipping });
      // The three oldest aren't due yet; the eleven after them are
      await insertOrder(db, { id: id(n), stripe_payment_intent: `pi_test_${n}`, paid_at: NOW - 1000 + n, next_attempt_at: n <= 3 ? NOW + 60 : NOW });
    }
    const fake = fakeFetch(handlers);
    await placeDue(testDeps(db, { fetch: fake.fetch }));
    expect(creates(fake).map((call) => JSON.parse(call.body).orderId)).toEqual(Array.from({ length: 10 }, (_, index) => id(index + 4)));
    expect((await getOrder(db, id(14)))?.status).toBe("paid");
  });

  test("a lookup naming our order without an id never creates: it counts as retryable", async () => {
    captureLogs();
    const { db, fake, deps } = await setup({ [LOOKUP]: () => json([{ orderId: ORDER, status: "Received" }]) });
    expect(await placeOrder(deps, ORDER)).toBe("retry");
    expect(creates(fake)).toHaveLength(0);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", next_attempt_at: NOW + 300, lease_until: null });
  });

  test("a refund landing while an attempt fails is never overwritten, so the order can't be retried into a print", async () => {
    captureLogs();
    const refundDuring = (answer: () => Response): Handler => async () => {
      await holder.db!.prepare("UPDATE print_orders SET status = 'refunded', refunded_amount = 28700 WHERE id = ?").bind(ORDER).run();
      return answer();
    };
    const holder: { db?: D1Database } = {};
    const cases: [Handler, Record<string, number>][] = [
      [refundDuring(() => json({ message: "unknown size" }, 422)), {}],
      [refundDuring(() => json({}, 503)), {}],
      [refundDuring(() => json({}, 503)), { retry_until: NOW - 60 }],
    ];
    for (const [create, columns] of cases) {
      const { db, deps } = await setup({ [CREATE]: create }, columns);
      holder.db = db;
      expect(await placeOrder(deps, ORDER)).toBe("not-due");
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "refunded", attention_reason: null, attention_notified_at: null, lease_until: null, artelo_order_id: null });
      // The links this attempt issued go, as the refund webhook's would (review minor 3)
      expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(0);
    }
  });

  test("an email that can't go straight away leaves the outcome alone; the cron sends it", async () => {
    captureLogs();
    const db = await printDb();
    await insertOrder(db, { id: ORDER, stripe_payment_intent: "pi_test_place" });
    const failingMail = new Proxy(db, {
      get(target, key) {
        if (key === "prepare") return (sql: string) => {
          if (sql.startsWith("SELECT id, status, admin_notified_at")) throw new Error("D1 is down");
          return target.prepare(sql);
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fake = world({ [CREATE]: async (request) => json({ id: "artelo-9", orderId: ((await request.json()) as { orderId: string }).orderId, status: "PendingFulfillmentAction" }) });
    expect(await placeOrder(testDeps(failingMail, { fetch: fake.fetch }), ORDER)).toBe("placed");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_order_id: "artelo-9", attention_reason: "artelo needs something before it can print: open the order in artelo.", attention_notified_at: null });
  });

  test("placeDue carries on past an order that throws, then fails the cron step", async () => {
    const logs = captureLogs();
    const db = await printDb();
    const fake = fakeFetch({ [LOOKUP]: () => json([]), [CREATE]: accepted, "GET https://stripe.test/v1/payment_intents/pi_test_b": () => json({ shipping }) });
    await insertOrder(db, { id: "01k6x00000000000000000000a", stripe_payment_intent: "pi_test_a", paid_at: NOW - 20 });
    await insertOrder(db, { id: "01k6x00000000000000000000b", stripe_payment_intent: "pi_test_b", paid_at: NOW - 10 });
    const throwing = new Proxy(db, {
      get(target, key) {
        if (key === "prepare") return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.startsWith("UPDATE print_orders SET lease_until = ?, attempts")) return statement;
          return { bind: (...values: unknown[]) => { if (values[2] === "01k6x00000000000000000000a") throw new Error("D1 is down"); return statement.bind(...values); } };
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(placeDue(testDeps(throwing, { fetch: fake.fetch }))).rejects.toThrow("1 of the due orders threw while being placed");
    expect(creates(fake).map((call) => JSON.parse(call.body).orderId)).toEqual(["01k6x00000000000000000000b"]);
    expect(logs()).toContain("prints: placing order 01k6x00000000000000000000a failed outright Error");
  });

  test("the scrub catches part of a field and the phone as bare digits, but not a word that merely contains one", () => {
    expect(scrub("Lovelace in bondi, call 61400000000 or +61 400 000 000", ADDRESS)).toBe("[address] in [address], call [address] or [address]");
    expect(scrub("we don't ship to canada from example.com", ADDRESS)).toBe("we don't ship to canada from [address].com");
  });

  test("no failure path stores, logs or puts in a url the buyer's street, city, postcode, name or phone", async () => {
    const away = { name: "Wilhelmina Thrupp", line1: "17 Quillwort Lane", line2: "", city: "Pendlebury Vale", state: "Lancashire", postcode: "QZ9 7XW", country: "GB", phone: "+44 7911 555 0199" };
    const personal = /Wilhelmina|Thrupp|Quillwort|Pendlebury|Lancashire|QZ9|7XW|7911 555|4479115550199/i;
    const echo = `${away.name}, ${away.line1}, ${away.city} ${away.postcode} (Thrupp, Quillwort; call 4479115550199) can't be delivered to`;
    const stripeAway: Handler = () => json({ id: "pi_test_place", shipping: { name: away.name, phone: away.phone, address: { line1: away.line1, line2: null, city: away.city, state: away.state, postal_code: away.postcode, country: away.country } } });
    const holder: { db?: D1Database } = {};
    const paths: [string, Record<string, Handler>, Record<string, string | number | null>, Record<string, unknown>][] = [
      ["refused, quoting the address", { [CREATE]: () => json({ message: echo }, 422) }, {}, {}],
      ["refused, quoting it in errors", { [CREATE]: () => json({ errors: [{ message: echo }] }, 400) }, {}, {}],
      ["down, then out of time", { [CREATE]: () => new Response(`<html>${echo}</html>`, { status: 502 }) }, { retry_until: NOW - 60 }, {}],
      ["down, retried", { [CREATE]: () => json({ message: echo }, 503) }, {}, {}],
      ["a master missing", {}, {}, { photoPrints: masters(["fixture-b-01"]) }],
      ["an unexpected throw quoting it", {}, {}, { photoPrints: { head: async () => { throw new Error(`r2 choked on ${echo}`); } } as unknown as R2Bucket }],
      ["a refund landing during the create", { [CREATE]: async (request) => { await holder.db!.prepare("UPDATE print_orders SET status = 'refunded' WHERE id = ?").bind(ORDER).run(); return accepted(request); } }, {}, {}],
    ];
    for (const [name, handlers, columns, over] of paths) {
      const logs = captureLogs();
      const { db, fake, deps } = await setup({ [INTENT]: stripeAway, ...handlers }, columns, over);
      holder.db = db;
      await placeOrder(deps, ORDER);
      // The address was really in play: read from stripe, and sent to artelo wherever the attempt got that far
      expect(fake.calls.some((call) => call.url.startsWith("https://stripe.test/")), name).toBe(true);
      if (creates(fake).length > 0) expect(creates(fake)[0].body, name).toContain(away.line1);
      expect(await dumpDb(db), name).not.toMatch(personal);
      expect(logs(), name).not.toMatch(personal);
      expect(fake.calls.map((call) => call.url).join("\n"), name).not.toMatch(personal);
      vi.restoreAllMocks();
    }
  });

  test("a refusal quoting the address keeps its sense with each part replaced", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({ message: "Ada Lovelace, 12 Example Street, Unit 3, Bondi Beach NSW 2026 (+61 400 000 000) can't be delivered to" }, 422) });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("artelo refused the order: [address], [address], [address], [address] [address] [address] ([address]) can't be delivered to");
  });

  describe("fix round 1", () => {
    test("a lapsed lease taken over while the first attempt is still in flight makes exactly one create (review important 1)", async () => {
      captureLogs();
      let intents = 0;
      const holder: { deps?: ReturnType<typeof testDeps> } = {};
      const later: PlaceOutcome[] = [];
      const { db, fake, deps } = await setup({
        [INTENT]: async () => {
          // The first attempt stalls here past its lease; a second run claims the order and places it meanwhile
          if (++intents === 1) later.push(await placeOrder({ ...holder.deps!, now: () => NOW + LEASE_SECONDS + 1 }, ORDER));
          return json({ id: "pi_test_place", shipping });
        },
      });
      holder.deps = deps;
      expect(await placeOrder(deps, ORDER)).toBe("not-due");
      expect(later).toEqual(["placed"]);
      expect(creates(fake)).toHaveLength(1);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-1", attempts: 2 });
      // The second run's links are the ones artelo fetches: the stalled attempt revokes only its own, and leaves those working
      const sent = await Promise.all((JSON.parse(creates(fake)[0].body).items as { productInfo: { designs: { sourceImage: { url: string } }[] } }[]).map(async (item) => (await verifyPhotoToken(PHOTO_KEY, new URL(item.productInfo.designs[0].sourceImage.url).searchParams.get("token")!, NOW + LEASE_SECONDS + 1))!.grantId));
      const working = (await db.prepare("SELECT id FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).all()).results.map((row) => row.id);
      expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ?").bind(ORDER).first("n")).toBe(4);
      expect(working.sort()).toEqual(sent.sort());
    });

    test("a stall on revoking the last attempts' links can't let a takeover create a second order (re-review important 1)", async () => {
      captureLogs();
      const db = await printDb();
      await insertOrder(db, { id: ORDER, stripe_payment_intent: "pi_test_place" });
      // A stand-in that remembers what it made, so a lookup finds it
      const made: { id: string; orderId: string; status: string }[] = [];
      const fake = world({
        [CREATE]: async (request) => {
          const order = { id: `artelo-${made.length + 1}`, orderId: ((await request.json()) as { orderId: string }).orderId, status: "Received" };
          made.push(order);
          return json(order);
        },
        [LOOKUP]: () => json(made),
      });
      const later: PlaceOutcome[] = [];
      let stalled = false;
      const stalling = new Proxy(db, {
        get(target, key) {
          if (key === "prepare") return (sql: string) => {
            const statement = target.prepare(sql);
            if (stalled || !sql.includes("NOT IN (SELECT value FROM json_each")) return statement;
            stalled = true;
            // The first attempt's revoke stalls past its lease while a second run claims the order and does its work
            return { bind: (...values: unknown[]) => ({ run: async () => {
              later.push(await placeOrder(testDeps(db, { fetch: fake.fetch, now: () => NOW + LEASE_SECONDS + 1 }), ORDER));
              return statement.bind(...values).run();
            } }) };
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const first = await placeOrder(testDeps(stalling, { fetch: fake.fetch }), ORDER);
      expect(stalled).toBe(true);
      expect(creates(fake)).toHaveLength(1);
      expect([first, ...later]).toEqual(["placed", "adopted"]);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-1" });
      // The links artelo fetches are the ones it was sent
      const sent = await Promise.all((JSON.parse(creates(fake)[0].body).items as { productInfo: { designs: { sourceImage: { url: string } }[] } }[]).map(async (item) => (await verifyPhotoToken(PHOTO_KEY, new URL(item.productInfo.designs[0].sourceImage.url).searchParams.get("token")!, NOW))!.grantId));
      const working = (await db.prepare("SELECT id FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).all()).results.map((row) => row.id);
      expect(working.sort()).toEqual(sent.sort());
    });

    test("a duplicate is logged by both ids even when reading the order back would fail (re-review minor)", async () => {
      const logs = captureLogs();
      const db = await printDb();
      await insertOrder(db, { id: ORDER, stripe_payment_intent: "pi_test_place" });
      let fellBack = false;
      const unreadable = new Proxy(db, {
        get(target, key) {
          if (key === "prepare") return (sql: string) => {
            if (sql.includes("COALESCE(artelo_order_id")) fellBack = true;
            if (fellBack && sql === "SELECT * FROM print_orders WHERE id = ?") throw new Error("D1 is down");
            return target.prepare(sql);
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const fake = world({
        [CREATE]: async (request) => {
          await db.prepare("UPDATE print_orders SET status = 'placed', artelo_order_id = 'artelo-0' WHERE id = ?").bind(ORDER).run();
          return accepted(request);
        },
      });
      await placeOrder(testDeps(unreadable, { fetch: fake.fetch }), ORDER);
      expect(fellBack).toBe(true);
      expect(logs()).toContain(`prints: order ${ORDER} has two artelo orders, artelo-0 and artelo-1: cancel one in artelo`);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-0" });
    });

    test("another run's lease on a still-paid order fences the create out, and is left in place", async () => {
      captureLogs();
      const holder: { db?: D1Database } = {};
      const { db, fake, deps } = await setup({
        [INTENT]: async () => {
          // A run that took over this attempt's lapsed lease holds the order now, mid-attempt itself
          await holder.db!.prepare("UPDATE print_orders SET lease_until = ? WHERE id = ?").bind(NOW + 300, ORDER).run();
          return json({ id: "pi_test_place", shipping });
        },
      });
      holder.db = db;
      expect(await placeOrder(deps, ORDER)).toBe("not-due");
      expect(creates(fake)).toHaveLength(0);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", lease_until: NOW + 300, next_attempt_at: NOW });
      expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(0);
    });

    test("a refund landing before the fence means no create, and the attempt's links are revoked (review minor 1)", async () => {
      captureLogs();
      const holder: { db?: D1Database } = {};
      const { db, fake, deps } = await setup({
        [INTENT]: async () => {
          await holder.db!.prepare("UPDATE print_orders SET status = 'refunded', refunded_amount = 28700 WHERE id = ?").bind(ORDER).run();
          return json({ id: "pi_test_place", shipping });
        },
      });
      holder.db = db;
      expect(await placeOrder(deps, ORDER)).toBe("not-due");
      expect(creates(fake)).toHaveLength(0);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "refunded", artelo_order_id: null, attention_reason: null });
      expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(0);
    });

    test("the fallback never replaces an artelo id already recorded, and logs both (review important 1b)", async () => {
      const logs = captureLogs();
      const holder: { db?: D1Database } = {};
      const { db, deps } = await setup({
        [CREATE]: async (request) => {
          await holder.db!.prepare("UPDATE print_orders SET status = 'placed', artelo_order_id = 'artelo-0', artelo_status = 'Received', artelo_cost = 9000 WHERE id = ?").bind(ORDER).run();
          return accepted(request);
        },
      });
      holder.db = db;
      await placeOrder(deps, ORDER);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-0", artelo_status: "Received", artelo_cost: 9000, lease_until: null });
      expect(logs()).toContain(`prints: order ${ORDER} has two artelo orders, artelo-0 and artelo-1: cancel one in artelo`);
    });

    test("a fallback write that fails propagates: nothing is cleared and the lease is left to lapse (review minor 4)", async () => {
      captureLogs();
      const db = await printDb();
      await insertOrder(db, { id: ORDER, stripe_payment_intent: "pi_test_place" });
      const failing = new Proxy(db, {
        get(target, key) {
          if (key === "prepare") return (sql: string) => {
            if (sql.includes("COALESCE(artelo_order_id")) throw new Error("D1 is down");
            return target.prepare(sql);
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const fake = world({
        [CREATE]: async (request) => {
          await db.prepare("UPDATE print_orders SET status = 'refunded' WHERE id = ?").bind(ORDER).run();
          return accepted(request);
        },
      });
      await expect(placeOrder(testDeps(failing, { fetch: fake.fetch }), ORDER)).rejects.toThrow();
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "refunded", lease_until: NOW + LEASE_SECONDS });
      // Placement leaves its links alone here; for a refunded order it is the refund webhook that revokes them (Task 10),
      // and the kept lease is what Task 14's daily job finds this order by
      expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(2);
    });

    test("an address field straddling character 200 of artelo's message is scrubbed whole before the cut (review important 2)", async () => {
      const logs = captureLogs();
      // Three streets first shrink by 24 characters once scrubbed, so a fragment cut at 200 before the scrub would land
      // inside the stored 200; "Lovel" sits at characters 195 to 199 and the rest of the surname after 200
      const head = "12 Example Street / ".repeat(3);
      const prefix = `${head}${"no. ".repeat(32)}to Ada `;
      const message = `${prefix}Lovelace, Bondi Beach can't be delivered to ${"z".repeat(300)}`;
      expect([message.indexOf("Lovelace"), message.indexOf("Lovelace") + "Lovelace".length]).toEqual([195, 203]);
      const { db, deps } = await setup({ [CREATE]: () => json({ message }, 422) });
      expect(await placeOrder(deps, ORDER)).toBe("attention");
      const reason = (await getOrder(db, ORDER))!.attention_reason!;
      expect(reason).toBe(`artelo refused the order: ${`${"[address] / ".repeat(3)}${"no. ".repeat(32)}to [address], [address] can't be delivered to ${"z".repeat(300)}`.slice(0, 200)}`);
      expect(reason).not.toMatch(/Lov|Ada|Example|Bondi/);
      expect(await dumpDb(db)).not.toMatch(/Ada|Lovel|Example|Bondi/);
      expect(logs()).not.toMatch(/Ada|Lovel|Example|Bondi/);
    });

    test("a lookup answering an order it can't match by orderId never creates (review important 3)", async () => {
      captureLogs();
      for (const answer of [[{ id: "artelo-7", externalOrderId: ORDER, status: "Received" }], { orders: [{ id: "artelo-8", orderId: "someone-else", status: "Received" }] }, [{ orderId: ORDER, status: "Received" }]]) {
        const { db, fake, deps } = await setup({ [LOOKUP]: () => json(answer) });
        expect(await placeOrder(deps, ORDER)).toBe("retry");
        expect(creates(fake)).toHaveLength(0);
        expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", artelo_order_id: null, next_attempt_at: NOW + 300 });
      }
    });

    test("costs artelo's order answer can't be trusted are logged as the order's, not a price check's (review minor 5)", async () => {
      const logs = captureLogs();
      const { db, deps } = await setup({ [CREATE]: async (request) => json({ id: "artelo-6", orderId: ((await request.json()) as { orderId: string }).orderId, status: "Received", details: { productionCost: 80, arteloShipping: 30, surprise: 5 } }) });
      expect(await placeOrder(deps, ORDER)).toBe("placed");
      expect((await getOrder(db, ORDER))?.artelo_cost).toBeNull();
      expect(logs()).toContain("prints: ignored an artelo order's costs: a charge this site doesn't know: surprise");
      expect(logs()).not.toContain("price check");
    });
  });
});
