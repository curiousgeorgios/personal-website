import { afterEach, describe, expect, test, vi } from "vitest";
import { artelo, ARTELO_TIMEOUT_MS, arteloAddress, hasWebhook, priceCheck, priceCheckBody, productInfo, readWebhooks, shapeOf, type QuoteLine } from "../../src/lib/prints/artelo";
import { parseSize } from "../../src/lib/prints/catalogue";
import { ADDRESS, captureLogs, fakeFetch, json, printDb, testDeps, US_ADDRESS, type Handler } from "./prints-fakes";

const LINES: QuoteLine[] = [
  { line: 1, quantity: 1, unitAmount: 17900, size: parseSize("x12x18"), frame: "oak", orientation: "Vertical" },
  { line: 2, quantity: 2, unitAmount: 5900, size: parseSize("x8x12"), frame: "unframed", orientation: "Horizontal" },
];
const PRICE_CHECK = "POST https://artelo.test/orders/price-check";
const answering = async (handler: Handler) => {
  const fake = fakeFetch({ [PRICE_CHECK]: handler });
  return { fake, deps: testDeps(await printDb(), { fetch: fake.fetch }) };
};

afterEach(() => vi.restoreAllMocks());

describe("the request", () => {
  test("the address maps as at order time: street2 only when present, phone outside the us", () => {
    expect(arteloAddress(ADDRESS)).toEqual({ name: "Ada Lovelace", street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" });
    expect(arteloAddress(US_ADDRESS)).toEqual({ name: "Grace Hopper", street1: "1600 Example Avenue", city: "Arlington", state: "VA", zipcode: "22201", country: "US" });
    // No state: the city stands in; no postcode: an empty zipcode
    expect(arteloAddress({ ...ADDRESS, state: "", postcode: "" })).toMatchObject({ city: "Bondi Beach", state: "Bondi Beach", zipcode: "" });
  });

  test("one item per line with the order's product info and no designs, the price in us dollars for information", () => {
    const body = priceCheckBody(LINES, ADDRESS, 1.5, "quote-0123456789abcdef");
    expect(body).toMatchObject({ orderId: "quote-0123456789abcdef", currency: "USD", customerAddress: arteloAddress(ADDRESS) });
    expect(body.items).toEqual([
      { orderItemId: "1", quantity: 1, unitPrice: 119.33, productInfo: productInfo(LINES[0]) },
      { orderItemId: "2", quantity: 2, unitPrice: 39.33, productInfo: productInfo(LINES[1]) },
    ]);
    expect(productInfo(LINES[0])).toEqual({
      catalogProductId: "IndividualArtPrint", size: "x12x18", frameColor: "NaturalOak", paperType: "ArchivalMatteFineArt", orientation: "Vertical",
      canvasDesignedFor: null, canvasBorderStyle: null, includeFramingService: false, includeHangingPins: false, includeMats: false,
    });
    expect(productInfo(LINES[1]).frameColor).toBeNull();
    expect(productInfo(LINES[0], "https://x/master")).toMatchObject({ designs: [{ sourceImage: { url: "https://x/master" }, fitOptions: { canvas: "Paper", style: "Outside" } }] });
  });

  test("the key goes in the authorization header, with a 15-second timeout, and a redirect is never followed", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { fake, deps } = await answering(() => json({ orderCosts: { arteloShipping: 30 } }));
    await artelo(deps, "POST", "/orders/price-check", {});
    expect(fake.calls[0].headers.get("authorization")).toBe("Bearer artelo-fixture-key");
    const init = vi.mocked(fake.fetch).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(ARTELO_TIMEOUT_MS).toBe(15_000);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(init.redirect).toBe("manual");
  });
});

describe("artelo", () => {
  test("never throws: a 2xx that can't be read, a network error and a redirect are all not ok", async () => {
    for (const [handler, status] of [
      [() => new Response("<html>ok</html>", { status: 200 }), null],
      [() => new Response("", { status: 204 }), null],
      [() => { throw new TypeError("network"); }, null],
      [() => new Response(null, { status: 302, headers: { Location: "https://elsewhere.test/" } }), 302],
    ] as [Handler, number | null][]) {
      const { deps } = await answering(handler);
      expect(await artelo(deps, "POST", "/orders/price-check", {})).toMatchObject({ ok: false, status });
    }
  });

  test("a readable 2xx is ok with its body", async () => {
    const { deps } = await answering(() => json({ hello: "there" }, 201));
    expect(await artelo(deps, "POST", "/orders/price-check", {})).toEqual({ ok: true, status: 201, body: { hello: "there" } });
  });
});

describe("priceCheck", () => {
  test("a quote reads the freight and taxes, with an orderId that is never stored", async () => {
    const { fake, deps } = await answering(() => json({ orderCosts: { productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, total: 114.2 } }));
    expect(await priceCheck(deps, LINES, US_ADDRESS, 1.5)).toEqual({ ok: true, costs: { freightCents: 3000, productionCents: 8000, taxes: [{ field: "usSalesTax", label: "us sales tax", cents: 420 }] } });
    expect(JSON.parse(fake.calls[0].body).orderId).toMatch(/^quote-[0-9a-f]{16}$/);
  });

  test("a 400 or 422 is artelo refusing, with its message cut to 200 characters and logged only as a status", async () => {
    const logs = captureLogs();
    const { deps } = await answering(() => json({ message: `we don't deliver to Antarctica ${"x".repeat(300)}` }, 400));
    const result = await priceCheck(deps, LINES, { ...ADDRESS, country: "AQ" }, 1.5);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.refused?.length).toBe(200);
    expect(!result.ok && result.refused?.startsWith("we don't deliver to Antarctica")).toBe(true);
    expect(logs()).not.toMatch(/Antarctica|Ada|Example Street/);
    const unprocessable = await answering(() => json({ errors: [{ message: "unknown size" }] }, 422));
    expect(await priceCheck(unprocessable.deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: "unknown size" });
  });

  test("a refusal whose body is a proxy's html page has no message to show (review focus 5)", async () => {
    captureLogs();
    const { deps } = await answering(() => new Response("<html><body>Bad Request</body></html>", { status: 400, headers: { "Content-Type": "text/html" } }));
    expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: "" });
  });

  test("anything else is artelo being unavailable: 401, 403, 408, 429, 5xx, html, timeouts and network errors", async () => {
    captureLogs();
    for (const status of [401, 403, 408, 429, 500, 502, 503]) {
      const { deps } = await answering(() => new Response("<html>bad gateway</html>", { status, headers: { "Content-Type": "text/html" } }));
      expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    }
    for (const handler of [() => { throw new DOMException("timed out", "TimeoutError"); }, () => { throw new TypeError("network"); }, () => new Response("<html>ok</html>", { status: 200 }), () => json({ total: 3 })] as Handler[]) {
      const { deps } = await answering(handler);
      expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    }
  });

  test("a charge this site doesn't know refuses the quote and is logged by name", async () => {
    const logs = captureLogs();
    for (const field of ["remoteAreaFee", "heavyDutyBox", "totalTax", "totalWithTax"]) {
      const { deps } = await answering(() => json({ orderCosts: { arteloShipping: 30, usSalesTax: 4.2, [field]: 5 } }));
      expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
      expect(logs()).toContain(field);
    }
  });

  test("a negative or non-finite amount, or a total that doesn't add up, is unavailable rather than a refusal of the address", async () => {
    const logs = captureLogs();
    for (const orderCosts of [{ arteloShipping: 30, usSalesTax: -4.2 }, { arteloShipping: 30, gst: -1 }, { arteloShipping: 30, productionCost: 80, usSalesTax: 4.2, total: 118.4 }]) {
      const { deps } = await answering(() => json({ orderCosts }));
      expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    }
    const huge = await answering(() => new Response('{"orderCosts":{"arteloShipping":30,"usSalesTax":1e999}}', { status: 200 }));
    expect(await priceCheck(huge.deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    expect(logs()).toMatch(/usSalesTax is not a usable amount/);
    expect(logs()).toMatch(/total 11840 against its parts 11420/);
  });

  test("a delivery over the ceiling is logged and refused; just under it quotes", async () => {
    const logs = captureLogs();
    // 400 × 1.5 × 1.2 is A$720; 250 × 1.5 × 1.2 is A$450
    const over = await answering(() => json({ orderCosts: { arteloShipping: 400 } }));
    expect(await priceCheck(over.deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    expect(logs()).toContain("over the ceiling");
    const taxed = await answering(() => json({ orderCosts: { arteloShipping: 200, usSalesTax: 200 } }));
    expect(await priceCheck(taxed.deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    const under = await answering(() => json({ orderCosts: { arteloShipping: 250 } }));
    expect((await priceCheck(under.deps, LINES, ADDRESS, 1.5)).ok).toBe(true);
  });
});

describe("an answer's shape, for logs and the terminal", () => {
  test("entry counts and field names only, never a value; a key that isn't plainly a field name is only counted", () => {
    expect(shapeOf([{ id: "artelo-1", name: "Ada Lovelace", customerAddress: { street1: "12 Example Street" } }, {}])).toBe("2 entries, the first with keys id, name, customerAddress");
    expect(shapeOf([{ "ada@example.com": 1, id: 2, "Ada Lovelace": 3 }])).toBe("1 entry, the first with keys id and 2 more");
    expect(shapeOf({ orders: "?", customer: "Ada Lovelace" })).toBe("an object with keys orders, customer");
    expect(shapeOf([])).toBe("0 entries");
    expect(shapeOf(["Ada Lovelace"])).toBe("1 entry");
    expect(shapeOf("Ada Lovelace")).toBe("a string");
    expect(shapeOf(null)).toBe("nothing readable");
  });

  test("a webhook list with entries but no url is unreadable; an empty one is readable", () => {
    expect(readWebhooks([{ endpoint: "https://x.test", topic: "OrderStatusChange" }])).toBeNull();
    expect(readWebhooks({ webhooks: [] })).toEqual([]);
    expect(readWebhooks({ hooks: [] })).toBeNull();
    const hooks = readWebhooks({ data: [{ url: "https://x.test/api/prints/artelo", topic: "OrderStatusChange" }, "?"] })!;
    expect(hasWebhook(hooks, "https://x.test/api/prints/artelo")).toBe(true);
    expect(hasWebhook([{ url: "https://x.test/api/prints/artelo", topic: "OrderCreated" }], "https://x.test/api/prints/artelo")).toBe(false);
  });
});
