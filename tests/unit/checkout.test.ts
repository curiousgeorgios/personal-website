import { afterEach, describe, expect, test, vi } from "vitest";
import { basketPost } from "../../src/lib/prints/basket-page";
import { parseItems } from "../../src/lib/prints/basket";
import { customText, sessionForm, startCheckout } from "../../src/lib/prints/checkout";
import { sealQuote, type QuotePayload } from "../../src/lib/prints/seal";
import { printConfig } from "../../src/lib/prints/config";
import { getOrder, resolveBasket, writeSetting } from "../../src/lib/prints/store";
import { livemodeOf } from "../../src/lib/prints/stripe";
import { viewKey } from "../../src/lib/prints/view-key";
import { ADDRESS, captureLogs, dumpDb, fakeFetch, json, NOW, printDb, testConfig, testDeps, US_ADDRESS, VIEW_SECRET, type Handler } from "./prints-fakes";

const TWO = "fixture-b-01:medium:oak,fixture-b-02:small:unframed";
const SESSIONS = "POST https://stripe.test/v1/checkout/sessions";
const GST = "prices include no gst; the seller isn't registered for gst.";
const payload = (over: Partial<QuotePayload> = {}): QuotePayload => ({
  items: TWO, address: ADDRESS, printTotal: 23800, deliveryAmount: 4900, freightCents: 3000, taxes: [], buffer: 0.08, rate: 1.5, expires: NOW + 1800, ...over,
});
let made = 0;
const created: Handler = () => {
  made += 1;
  return json({ id: `cs_test_${made}`, url: `https://checkout.stripe.com/c/pay/cs_test_${made}` });
};
const setup = async (handler: Handler = created, over = {}) => {
  const fake = fakeFetch({ [SESSIONS]: handler });
  const db = await printDb();
  return { fake, db, deps: testDeps(db, { fetch: fake.fetch, ...over }) };
};
const pay = async (quote: string, address = ADDRESS) => {
  const form = new FormData();
  form.set("intent", "checkout");
  form.set("quote", quote);
  for (const [name, value] of Object.entries(address)) form.set(name, value);
  return new Request("https://curiousgeorge.dev/basket", { method: "POST", body: form });
};
const url = (items = TWO) => new URL(`https://curiousgeorge.dev/basket?items=${items}`);

afterEach(() => vi.restoreAllMocks());

describe("the session form", () => {
  test("adaptive pricing off, cards only, an hour to pay, each line in aud cents, then delivery", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems(TWO));
    const form = Object.fromEntries(sessionForm({ orderId: "01k6x00000000000000000000a", lines: basket.lines, payload: payload(), config: testConfig(), viewKey: "KEY", now: NOW }));
    expect(form).toMatchObject({
      mode: "payment", "payment_method_types[0]": "card", submit_type: "pay", locale: "auto", expires_at: String(NOW + 3600), "adaptive_pricing[enabled]": "false",
      "line_items[0][price_data][currency]": "aud", "line_items[0][price_data][unit_amount]": "17900", "line_items[0][quantity]": "1",
      "line_items[0][price_data][product_data][name]": "print of photo 1 of 2 from 14.06.26 · medium, 12 × 18 in · oak frame",
      "line_items[0][price_data][product_data][description]": "archival matte paper, made and posted by artelo",
      "line_items[1][price_data][unit_amount]": "5900", "line_items[1][price_data][product_data][name]": "print of photo 2 of 2 from 14.06.26 · small, 8 × 12 in · unframed",
      "line_items[2][price_data][currency]": "aud", "line_items[2][price_data][unit_amount]": "4900", "line_items[2][quantity]": "1",
      "line_items[2][price_data][product_data][name]": "delivery to australia, 2 prints",
    });
    expect(form["line_items[0][price_data][product_data][images][0]"]).toMatch(/^https:\/\/curiousgeorge\.dev\/media\/photos\/previews\/fixture-b-01\/.+\/480\.webp$/);
  });

  test("the quoted address rides on the payment and in the custom text, never in metadata or a url", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems(TWO));
    const form = Object.fromEntries(sessionForm({ orderId: "01k6x00000000000000000000a", lines: basket.lines, payload: payload(), config: testConfig(), viewKey: "KEY", now: NOW }));
    expect(form).toMatchObject({
      "payment_intent_data[shipping][name]": "Ada Lovelace", "payment_intent_data[shipping][phone]": "+61 400 000 000",
      "payment_intent_data[shipping][address][line1]": "12 Example Street", "payment_intent_data[shipping][address][line2]": "Unit 3",
      "payment_intent_data[shipping][address][city]": "Bondi Beach", "payment_intent_data[shipping][address][state]": "NSW",
      "payment_intent_data[shipping][address][postal_code]": "2026", "payment_intent_data[shipping][address][country]": "AU",
      "custom_text[submit][message]": `posting to: Ada Lovelace, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia. to change it, go back and quote again. prints are made and posted by artelo in the us. ${GST}`,
      "payment_intent_data[description]": "print order 01k6x00000000000000000000a · prices include no gst; the seller isn't registered for gst",
      client_reference_id: "01k6x00000000000000000000a", "metadata[order_id]": "01k6x00000000000000000000a", "metadata[country]": "AU",
      "metadata[print_total]": "23800", "metadata[delivery_amount]": "4900", "metadata[delivery_taxed]": "0",
      "metadata[line_1]": "fixture-b-01:medium:oak:1", "metadata[line_2]": "fixture-b-02:small:unframed:1",
      "payment_intent_data[metadata][order_id]": "01k6x00000000000000000000a",
      success_url: "https://curiousgeorge.dev/prints/01k6x00000000000000000000a?key=KEY", cancel_url: `https://curiousgeorge.dev/basket?items=${TWO}`,
    });
    for (const [name, value] of Object.entries(form)) {
      if (name.startsWith("payment_intent_data[shipping]") || name === "custom_text[submit][message]") continue;
      expect(value, name).not.toMatch(/Ada|Example Street|Bondi|400 000/);
    }
    expect(form).not.toHaveProperty(["shipping_address_collection[allowed_countries][0]"]);
    expect(form).not.toHaveProperty(["phone_number_collection[enabled]"]);
  });

  test("destination taxes name the delivery line; a missing unit or state is left out; images only on https", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems("fixture-b-01:medium:oak"));
    const form = Object.fromEntries(sessionForm({ orderId: "o", lines: basket.lines, payload: payload({ items: "fixture-b-01:medium:oak", address: US_ADDRESS, taxes: [{ field: "usSalesTax", label: "us sales tax", cents: 420 }] }), config: testConfig({ siteOrigin: "http://localhost:4337" }), viewKey: "K", now: NOW }));
    expect(form["line_items[1][price_data][product_data][name]"]).toBe("delivery and destination taxes to united states, 1 print");
    expect(form["metadata[delivery_taxed]"]).toBe("1");
    expect(form).not.toHaveProperty(["payment_intent_data[shipping][address][line2]"]);
    expect(form).not.toHaveProperty(["line_items[0][price_data][product_data][images][0]"]);
  });

  test("an address in another script, with markup and punctuation, reaches stripe's page exactly (review focus 1)", () => {
    const address = { ...ADDRESS, name: "Zoë O'Brien & Sons", line1: "東京都渋谷区 1-2-3", line2: "<b>unit</b> 3", city: "Shibuya", state: "Tokyo", postcode: "150-0002", country: "JP" };
    expect(customText(address, GST)).toBe(`posting to: Zoë O'Brien & Sons, 東京都渋谷区 1-2-3, <b>unit</b> 3, Shibuya Tokyo 150-0002, japan. to change it, go back and quote again. prints are made and posted by artelo in the us. ${GST}`);
  });

  test("with gst inclusive, an australian order adds the tax rate to every line; another country's doesn't", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems(TWO));
    const config = testConfig({ gst: "inclusive", gstTaxRate: "txr_123" });
    const au = sessionForm({ orderId: "o", lines: basket.lines, payload: payload(), config, viewKey: "K", now: NOW });
    expect(au.getAll("line_items[0][tax_rates][0]").concat(au.getAll("line_items[2][tax_rates][0]"))).toEqual(["txr_123", "txr_123"]);
    expect(au.get("custom_text[submit][message]")).toMatch(/prices include gst for orders posted within australia\.$/);
    const us = sessionForm({ orderId: "o", lines: basket.lines, payload: payload({ address: US_ADDRESS }), config, viewKey: "K", now: NOW });
    expect(us.has("line_items[0][tax_rates][0]")).toBe(false);
  });
});

describe("livemodeOf", () => {
  test("a live key, standard or restricted, makes a live order; a test key of either kind a test one", () => {
    expect(livemodeOf("sk_live_abc")).toBe(1);
    expect(livemodeOf("rk_live_abc")).toBe(1);
    expect(livemodeOf("sk_test_abc")).toBe(0);
    expect(livemodeOf("rk_test_abc")).toBe(0);
  });
});

describe("startCheckout", () => {
  test("the order and its lines exist before stripe hears of it, so no payment can arrive for an unknown order", async () => {
    let seen: unknown = "never asked";
    const { fake, db, deps } = await setup(async (request) => {
      const form = new URLSearchParams(await request.text());
      seen = await db.prepare("SELECT status FROM print_orders WHERE id = ?").bind(form.get("client_reference_id")).first("status");
      return json({ id: "cs_test_seen", url: "https://checkout.stripe.com/c/pay/cs_test_seen" });
    });
    const basket = await resolveBasket(db, parseItems(TWO));
    const outcome = await startCheckout(deps, basket, payload());
    expect(outcome).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_seen" });
    expect(seen).toBe("checkout");
    const id = new URLSearchParams(fake.calls[0].body).get("client_reference_id")!;
    expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    expect(await getOrder(db, id)).toMatchObject({ status: "checkout", country: "AU", print_total: 23800, delivery_amount: 4900, delivery_taxed: 0, livemode: 0, stripe_session_id: "cs_test_seen", created_at: NOW });
    expect((await db.prepare("SELECT line, photo_id, tier, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id = ? ORDER BY line").bind(id).all()).results).toEqual([
      { line: 1, photo_id: "fixture-b-01", tier: "medium", size: "x12x18", frame: "oak", quantity: 1, unit_amount: 17900 },
      { line: 2, photo_id: "fixture-b-02", tier: "small", size: "x8x12", frame: "unframed", quantity: 1, unit_amount: 5900 },
    ]);
    expect(fake.calls[0].headers.get("stripe-version")).toBe("2025-09-30.clover");
    expect(fake.calls[0].headers.get("idempotency-key")).toBe(`checkout-${id}`);
    expect(fake.calls[0].headers.get("authorization")).toBe("Bearer sk_test_fixture");
    expect(new URLSearchParams(fake.calls[0].body).get("success_url")).toBe(`https://curiousgeorge.dev/prints/${id}?key=${await viewKey(VIEW_SECRET, id)}`);
  });

  test("stripe refusing or unreachable expires the order, so the buyer never saw a payment page for it", async () => {
    captureLogs();
    for (const handler of [() => json({ error: { message: "no" } }, 400), () => { throw new TypeError("network"); }, () => json({ id: "cs" })] as Handler[]) {
      const { db, deps } = await setup(handler);
      expect(await startCheckout(deps, await resolveBasket(db, parseItems(TWO)), payload())).toEqual({ failure: "stripe" });
      expect((await db.prepare("SELECT status, stripe_session_id FROM print_orders").all()).results).toEqual([{ status: "expired", stripe_session_id: null }]);
    }
  });

  test("a session stripe made but the store couldn't record is never shown, and the order isn't left open", async () => {
    const logs = captureLogs();
    const { db, deps } = await setup();
    const failing = new Proxy(db, {
      get: (target, name) => (name === "prepare" ? (sql: string) => (sql.includes("SET stripe_session_id") ? { bind: () => ({ run: async () => { throw new Error("d1 is down"); } }) } : target.prepare(sql)) : Reflect.get(target, name)),
    });
    expect(await startCheckout({ ...deps, db: failing }, await resolveBasket(db, parseItems(TWO)), payload())).toEqual({ failure: "stripe" });
    expect((await db.prepare("SELECT status, stripe_session_id FROM print_orders").all()).results).toEqual([{ status: "expired", stripe_session_id: null }]);
    expect(logs()).toContain("couldn't record the session");
  });

  test("an address too long for stripe's page is refused before anything is created", async () => {
    const { fake, db, deps } = await setup();
    const long = { ...ADDRESS, name: "n".repeat(100), line1: "a".repeat(100), line2: "b".repeat(100), city: "c".repeat(60), state: "s".repeat(60), postcode: "p".repeat(20) };
    expect(customText(long, GST).length).toBeLessThan(1200);
    const huge = { ...long, name: "n".repeat(1200) };
    expect(await startCheckout(deps, await resolveBasket(db, parseItems(TWO)), payload({ address: huge }))).toEqual({ failure: "long" });
    expect(fake.calls).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM print_orders").first("n")).toBe(0);
  });

  test("the address is never stored or logged", async () => {
    const logs = captureLogs();
    const { db, deps } = await setup();
    await startCheckout(deps, await resolveBasket(db, parseItems(TWO)), payload());
    expect(await dumpDb(db)).not.toMatch(/Ada|Lovelace|Example Street|Bondi Beach|400 000/);
    expect(logs()).not.toMatch(/Ada|Lovelace|Example Street|Bondi Beach|400 000/);
  });
});

describe("POST /basket, intent=checkout", () => {
  test("a good quote answers 303 to stripe's page, charging the sealed amounts", async () => {
    const { fake, deps } = await setup();
    const outcome = await basketPost(deps, await pay(await sealQuote(VIEW_SECRET, payload())), url(), {});
    expect(outcome).toEqual({ redirect: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_\d+$/) });
    expect(new URLSearchParams(fake.calls[0].body).get("line_items[2][price_data][unit_amount]")).toBe("4900");
  });

  test("an edited address, an edited basket, a tampered or expired quote: 422, nothing created, nothing charged", async () => {
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    const attempts = [
      basketPost(deps, await pay(token, { ...ADDRESS, line1: "13 Example Street" }), url(), {}),
      basketPost(deps, await pay(token), url("fixture-b-01:medium:oak"), {}),
      basketPost(deps, await pay(`${token.slice(0, -2)}xx`), url(), {}),
      basketPost(deps, await pay(await sealQuote(VIEW_SECRET, payload({ expires: NOW }))), url(), {}),
      basketPost(deps, await pay(await sealQuote("3".repeat(64), payload())), url(), {}),
    ];
    for (const outcome of await Promise.all(attempts)) {
      expect(outcome).toMatchObject({ status: 422 });
      expect("view" in outcome && outcome.view.errors.form).toBe("that quote has changed or run out. quote delivery again.");
      expect("view" in outcome && outcome.view.address.name).toBe("Ada Lovelace");
    }
    expect(fake.calls).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM print_orders").first("n")).toBe(0);
  });

  test("a new buffer after the quote changes nothing; a new price list refuses the quote (review focus 4)", async () => {
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    await writeSetting(db, "delivery_buffer", "0.2", NOW);
    await basketPost(deps, await pay(token), url(), {});
    expect(new URLSearchParams(fake.calls[0].body).get("line_items[2][price_data][unit_amount]")).toBe("4900");
    await db.prepare("UPDATE print_prices SET amount = 18900 WHERE tier = 'medium' AND frame = 'oak'").run();
    expect(await basketPost(deps, await pay(token), url(), {})).toMatchObject({ status: 422 });
    expect(fake.calls).toHaveLength(1);
  });

  test("the pay form sent twice makes two tracked orders, never one charged twice (review focus 3)", async () => {
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    await basketPost(deps, await pay(token), url(), {});
    await basketPost(deps, await pay(token), url(), {});
    const ids = fake.calls.map((call) => new URLSearchParams(call.body).get("client_reference_id"));
    expect(new Set(ids).size).toBe(2);
    expect(new Set(fake.calls.map((call) => call.headers.get("idempotency-key"))).size).toBe(2);
    expect((await db.prepare("SELECT status FROM print_orders").all()).results).toEqual([{ status: "checkout" }, { status: "checkout" }]);
  });

  test("a basket that lost a print since the quote is shown with its line; past the limit is 429; stripe down is 503", async () => {
    captureLogs();
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    await db.prepare("UPDATE photos SET published = 0 WHERE id = 'fixture-b-02'").run();
    const lost = await basketPost(deps, await pay(token), url(), {});
    expect(lost).toMatchObject({ status: 422 });
    expect("view" in lost && lost.view.notes).toEqual(["1 print was taken out: that photo isn't available as a print any more."]);
    await db.prepare("UPDATE photos SET published = 1 WHERE id = 'fixture-b-02'").run();
    const refusing = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;
    const limited = await basketPost(deps, await pay(token), url(), { checkout: refusing });
    expect("view" in limited && limited.view.errors.form).toBe("too many tries - wait a minute and try again.");
    expect(fake.calls).toHaveLength(0);
    const down = await setup(() => json({}, 500));
    const outcome = await basketPost(down.deps, await pay(token), url(), {});
    expect(outcome).toMatchObject({ status: 503 });
    expect("view" in outcome && outcome.view.errors.form).toBe("couldn't reach the payment page. nothing was charged - try again in a minute.");
  });

  test("a missing stripe key closes prints: the basket says so and nothing reaches stripe", async () => {
    const { fake, deps } = await setup(created, { config: testConfig({ missing: ["STRIPE_SECRET_KEY"] }) });
    const outcome = await basketPost(deps, await pay(await sealQuote(VIEW_SECRET, payload())), url(), {});
    expect("view" in outcome && outcome.view.open).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  test("a live key, standard or restricted, on a test build is blanked by printConfig: prints close and nothing reaches stripe", async () => {
    vi.stubGlobal("__TEST_HOOKS__", true);
    captureLogs();
    const base = testConfig();
    const env = (key: string) => ({ PRINTS_OPEN: "true", SITE_ORIGIN: base.siteOrigin, STRIPE_API_BASE: base.stripeBase, ...base.secrets, STRIPE_SECRET_KEY: key }) as unknown as Cloudflare.Env;
    try {
      for (const key of ["sk_live_fixture", "rk_live_fixture"]) {
        const config = printConfig(env(key));
        expect(config.secrets.STRIPE_SECRET_KEY, key).toBe("");
        expect(config.missing, key).toEqual(["STRIPE_SECRET_KEY"]);
        const { fake, deps } = await setup(created, { config });
        const outcome = await basketPost(deps, await pay(await sealQuote(VIEW_SECRET, payload())), url(), {});
        expect("view" in outcome && outcome.view.open, key).toBe(false);
        expect(fake.calls, key).toHaveLength(0);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
