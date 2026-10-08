import { afterEach, describe, expect, test, vi } from "vitest";
import { REFUND_REASON } from "../../src/lib/prints/artelo-status";
import { daily } from "../../src/lib/prints/cron";
import { checkArteloWebhook, cleanUp, lookUpStrandedRefunds, STRANDED_LIMIT } from "../../src/lib/prints/daily";
import { getOrder, readSettings } from "../../src/lib/prints/store";
import { captureLogs, fakeFetch, insertOrder, json, NOW, printDb, testConfig, testDeps, type Handler } from "./prints-fakes";

const HOOKS = "GET https://artelo.test/webhooks/get";
const withHooks = async (handler: Handler) => {
  const db = await printDb();
  const mail = vi.fn(async () => ({ messageId: "m" }));
  return { db, mail, deps: testDeps(db, { fetch: fakeFetch({ [HOOKS]: handler }).fetch, email: { send: mail } as unknown as SendEmail }) };
};

afterEach(() => vi.restoreAllMocks());

describe("the webhook check", () => {
  test("our url and topic among artelo's webhooks: connected", async () => {
    const { db, mail, deps } = await withHooks(() => json([{ topic: "OrderStatusChange", url: "https://curiousgeorge.dev/api/prints/artelo" }]));
    expect(await checkArteloWebhook(deps)).toBe(true);
    expect((await readSettings(db)).webhookMissing).toBe(false);
    expect(mail).not.toHaveBeenCalled();
  });

  test("none of ours: missing, and george is emailed", async () => {
    const { db, mail, deps } = await withHooks(() => json({ webhooks: [{ topic: "OrderStatusChange", url: "https://elsewhere.test/hook" }] }));
    expect(await checkArteloWebhook(deps)).toBe(true);
    expect((await readSettings(db)).webhookMissing).toBe(true);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: "the artelo webhook is missing" }));
  });

  test("with no artelo key yet (before launch), nothing is asked and the day counts as checked", async () => {
    const db = await printDb();
    const fake = fakeFetch({});
    const deps = testDeps(db, { fetch: fake.fetch, config: testConfig({ secrets: { ...testConfig().secrets, ARTELO_API_KEY: "" } }) });
    await daily(deps, "webhook_check", () => checkArteloWebhook(deps));
    expect(fake.calls).toHaveLength(0);
    expect((await readSettings(db)).daily.webhook_check).toBe(NOW);
  });

  test("artelo unreachable or unreadable decides nothing and is tried again", async () => {
    captureLogs();
    for (const handler of [() => json({}, 503), () => json({ hooks: "?" })] as Handler[]) {
      const { db, deps } = await withHooks(handler);
      expect(await checkArteloWebhook(deps)).toBe(false);
      expect((await readSettings(db)).webhookMissing).toBe(false);
    }
  });
});

test("the clean-up deletes expired orders over 30 days old with their lines and stripe events over 90 days old, nothing else", async () => {
  const { db, deps } = await withHooks(() => json([]));
  await insertOrder(db, { id: "01k6x00000000000000000000a", status: "expired", created_at: NOW - 31 * 86_400 });
  await insertOrder(db, { id: "01k6x00000000000000000000b", status: "expired", created_at: NOW - 29 * 86_400 });
  await insertOrder(db, { id: "01k6x00000000000000000000c", status: "delivered", created_at: NOW - 400 * 86_400 });
  await db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES ('evt_old', 't', ?), ('evt_new', 't', ?)").bind(NOW - 91 * 86_400, NOW - 89 * 86_400).run();
  expect(await cleanUp(deps)).toBe(true);
  expect((await db.prepare("SELECT id FROM print_orders ORDER BY id").all()).results).toEqual([{ id: "01k6x00000000000000000000b" }, { id: "01k6x00000000000000000000c" }]);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM print_order_items WHERE order_id = '01k6x00000000000000000000a'").first("n")).toBe(0);
  expect((await db.prepare("SELECT id FROM stripe_events").all()).results).toEqual([{ id: "evt_new" }]);
});

describe("the stranded-refund lookup (ADR-0026)", () => {
  const LOOKUP = "GET https://artelo.test/orders/get";
  const DAY = 86_400;
  /** A fully refunded order with no Artelo id, paid two days ago unless `columns` says otherwise */
  const refunded = (id: string, columns: Record<string, string | number | null> = {}) => ({ id, status: "refunded", refunded_amount: 28_700, refunded_at: NOW - 3600, paid_at: NOW - 2 * DAY, ...columns });
  const lookups = (calls: { method: string; url: string }[]) => calls.filter((call) => `${call.method} ${call.url}`.startsWith(LOOKUP)).map((call) => new URL(call.url).searchParams.get("name"));
  const setUp = async (handler: Handler) => {
    const db = await printDb();
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const fake = fakeFetch({ [LOOKUP]: handler });
    const pause = vi.fn(async () => {});
    const deps = testDeps(db, { fetch: fake.fetch, email: { send: mail } as unknown as SendEmail });
    return { db, mail, fake, pause, deps };
  };
  /** Artelo's Get Orders, holding these of our ids under its own ids, with a status and costs */
  const holding = (orders: Record<string, string>, status = "Received") => (request: Request) => {
    const name = new URL(request.url).searchParams.get("name") ?? "";
    return json(orders[name] ? [{ id: orders[name], orderId: name, status, details: { productionCost: 80, arteloShipping: 30.004, usSalesTax: 0 } }] : []);
  };

  test("an order artelo has: its id recorded, needs attention with the refund reason, and george's email goes", async () => {
    const logs = captureLogs();
    const { db, mail, fake, pause, deps } = await setUp(holding({ "01k6x0000000000000000000r1": "artelo-77" }));
    // Its earlier needs-attention email went before the refund: this is a new reason, so a new email
    await insertOrder(db, refunded("01k6x0000000000000000000r1", { lease_until: NOW - 600, attention_notified_at: NOW - 5 * DAY }));
    expect(await lookUpStrandedRefunds(deps, pause)).toBe(true);
    const order = (await getOrder(db, "01k6x0000000000000000000r1"))!;
    expect(order).toMatchObject({ status: "needs_attention", attention_reason: REFUND_REASON, artelo_order_id: "artelo-77", artelo_status: "Received", artelo_cost: 11_000, lease_until: null });
    // attention_notified_at was cleared, so the email was due, and went straight away
    expect(order.attention_notified_at).toBe(NOW);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: "print order 01k6x0000000000000000000r1 needs attention" }));
    expect(lookups(fake.calls)).toEqual(["01k6x0000000000000000000r1"]);
    expect(logs()).toContain("01k6x0000000000000000000r1");
  });

  test("a lease-less refunded order is still looked up (toAttention cleared the marker before the refund)", async () => {
    captureLogs();
    const { db, pause, deps } = await setUp(holding({ "01k6x0000000000000000000r2": "artelo-78" }));
    await insertOrder(db, refunded("01k6x0000000000000000000r2", { lease_until: null, attempts: 8 }));
    await lookUpStrandedRefunds(deps, pause);
    expect(await getOrder(db, "01k6x0000000000000000000r2")).toMatchObject({ status: "needs_attention", artelo_order_id: "artelo-78" });
  });

  test("one artelo has already cancelled ends cancelled, with no email: nothing is left to do", async () => {
    captureLogs();
    const { db, mail, pause, deps } = await setUp(holding({ "01k6x0000000000000000000r3": "artelo-79" }, "Canceled"));
    await insertOrder(db, refunded("01k6x0000000000000000000r3"));
    await lookUpStrandedRefunds(deps, pause);
    await Promise.all(deps.waited);
    expect(await getOrder(db, "01k6x0000000000000000000r3")).toMatchObject({ status: "cancelled", artelo_order_id: "artelo-79", artelo_status: "Canceled" });
    expect(mail).not.toHaveBeenCalled();
  });

  test("one artelo clearly hasn't got: stays refunded, a lapsed lease is cleared, a live one kept, and it goes to the back of the line", async () => {
    const { db, mail, pause, deps } = await setUp(() => json([]));
    await insertOrder(db, refunded("01k6x0000000000000000000n1", { lease_until: NOW - 1 }));
    await insertOrder(db, refunded("01k6x0000000000000000000n2", { lease_until: NOW + 60 }));
    expect(await lookUpStrandedRefunds(deps, pause)).toBe(true);
    expect(await getOrder(db, "01k6x0000000000000000000n1")).toMatchObject({ status: "refunded", artelo_order_id: null, lease_until: null, status_checked_at: NOW, attention_reason: null });
    // A live lease is an attempt still in flight: its own outcome handles the order
    expect(await getOrder(db, "01k6x0000000000000000000n2")).toMatchObject({ status: "refunded", artelo_order_id: null, lease_until: NOW + 60, status_checked_at: NOW });
    expect(mail).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledWith(300);
  });

  test("an unreadable or failed lookup changes nothing, and the day still counts: it is tried again tomorrow", async () => {
    const logs = captureLogs();
    const answers: Handler[] = [
      () => json({ message: "down" }, 503),
      () => json({ orders: "?" }),
      // Something for our id that can't be matched to it: fail closed, as placement does
      (request) => json([{ id: "artelo-1", name: new URL(request.url).searchParams.get("name") }]),
    ];
    for (const answer of answers) {
      const { db, mail, pause, deps } = await setUp(answer);
      await insertOrder(db, refunded("01k6x0000000000000000000u1", { lease_until: NOW - 600 }));
      const before = await getOrder(db, "01k6x0000000000000000000u1");
      await daily(deps, "refund_lookup", () => lookUpStrandedRefunds(deps, pause));
      expect(await getOrder(db, "01k6x0000000000000000000u1")).toEqual(before);
      expect((await readSettings(db)).daily.refund_lookup).toBe(NOW);
      expect(mail).not.toHaveBeenCalled();
    }
    expect(logs()).toContain("couldn't look up refunded order 01k6x0000000000000000000u1 at artelo");
  });

  test("only refunded orders with no artelo id paid in the last 30 days are looked up", async () => {
    const { db, fake, pause, deps } = await setUp(() => json([]));
    await insertOrder(db, refunded("01k6x0000000000000000000o1", { paid_at: NOW - 30 * DAY - 1 }));
    await insertOrder(db, refunded("01k6x0000000000000000000o2", { paid_at: NOW - 30 * DAY }));
    await insertOrder(db, refunded("01k6x0000000000000000000o3", { artelo_order_id: "artelo-5" }));
    await insertOrder(db, { id: "01k6x0000000000000000000o4", status: "paid" });
    await insertOrder(db, { id: "01k6x0000000000000000000o5", status: "needs_attention", attention_reason: "x" });
    await lookUpStrandedRefunds(deps, pause);
    expect(lookups(fake.calls)).toEqual(["01k6x0000000000000000000o2"]);
    expect(await getOrder(db, "01k6x0000000000000000000o1")).toMatchObject({ status_checked_at: null });
  });

  test("at most twenty a run, 300ms apart, the longest unchecked first, so the next run reaches the rest", async () => {
    const { db, fake, pause, deps } = await setUp(() => json([]));
    expect(STRANDED_LIMIT).toBe(20);
    const ids = Array.from({ length: 25 }, (_, index) => `01k6x00000000000000000s${String(index).padStart(3, "0")}`);
    for (const [index, id] of ids.entries()) await insertOrder(db, refunded(id, { paid_at: NOW - DAY - index }));
    await lookUpStrandedRefunds(deps, pause);
    const first = lookups(fake.calls);
    expect(first).toHaveLength(20);
    expect(pause).toHaveBeenCalledTimes(19);
    await lookUpStrandedRefunds(testDeps(db, { fetch: fake.fetch, now: () => NOW + DAY }), pause);
    const second = lookups(fake.calls).slice(20);
    expect(second.slice(0, 5).sort()).toEqual(ids.filter((id) => !first.includes(id)).sort());
  });

  test("with no artelo key yet, nothing is asked and the day counts", async () => {
    const { db, fake, pause } = await setUp(() => json([]));
    await insertOrder(db, refunded("01k6x0000000000000000000k1"));
    const deps = testDeps(db, { fetch: fake.fetch, config: testConfig({ secrets: { ...testConfig().secrets, ARTELO_API_KEY: "" } }) });
    await daily(deps, "refund_lookup", () => lookUpStrandedRefunds(deps, pause));
    expect(fake.calls).toHaveLength(0);
    expect((await readSettings(db)).daily.refund_lookup).toBe(NOW);
  });
});
