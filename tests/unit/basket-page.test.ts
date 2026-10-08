import { afterEach, describe, expect, test, vi } from "vitest";
import { basketGet, basketPost } from "../../src/lib/prints/basket-page";
import { openQuote } from "../../src/lib/prints/seal";
import { ADDRESS, captureLogs, fakeFetch, json, NOW, printDb, testConfig, testDeps, US_ADDRESS, VIEW_SECRET, type Handler } from "./prints-fakes";

const TWO = "fixture-b-01:medium:oak,fixture-b-02:small:unframed";
const PRICE_CHECK = "POST https://artelo.test/orders/price-check";
const quoted: Handler = async (request) => {
  const body = (await request.json()) as { customerAddress: { country: string } };
  const tax = body.customerAddress.country === "US" ? 4.2 : 0;
  // Its parts add up to its total, or the quote is refused (ADR-0021 as amended)
  return json({ orderCosts: { productionCost: 80, arteloShipping: 30, usSalesTax: tax, total: 110 + tax } });
};
const url = (query: string) => new URL(`https://curiousgeorge.dev/basket${query}`);
const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return new Request("https://curiousgeorge.dev/basket", { method: "POST", body: form, headers });
};
const setup = async (handler: Handler = quoted, over = {}) => {
  const fake = fakeFetch({ [PRICE_CHECK]: handler });
  return { fake, deps: testDeps(await printDb(), { fetch: fake.fetch, ...over }) };
};
const refusing = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;

afterEach(() => vi.restoreAllMocks());

describe("GET /basket", () => {
  test("adding answers 303 to the canonical basket with the print appended, merging identical prints", async () => {
    const { deps } = await setup();
    expect(await basketGet(deps, url("?items=fixture-b-02:small:unframed&add=fixture-b-01&size=medium&frame=oak"))).toEqual({ redirect: "/basket?items=fixture-b-02:small:unframed,fixture-b-01:medium:oak" });
    expect(await basketGet(deps, url("?add=fixture-b-01&size=medium&frame=oak"))).toEqual({ redirect: "/basket?items=fixture-b-01:medium:oak" });
    expect(await basketGet(deps, url(`?items=fixture-b-01:medium:oak,fixture-b-02:small:unframed&add=fixture-b-01&size=medium&frame=oak`))).toEqual({
      redirect: "/basket?items=fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed",
    });
  });

  test("one more and remove one answer 303 to the changed basket; an empty basket's URL has no items", async () => {
    const { deps } = await setup();
    expect(await basketGet(deps, url(`?items=${TWO}&more=2`))).toEqual({ redirect: "/basket?items=fixture-b-01:medium:oak,fixture-b-02:small:unframed,fixture-b-02:small:unframed" });
    expect(await basketGet(deps, url(`?items=${TWO}&remove=1`))).toEqual({ redirect: "/basket?items=fixture-b-02:small:unframed" });
    expect(await basketGet(deps, url("?items=fixture-b-02:small:unframed&remove=1"))).toEqual({ redirect: "/basket" });
  });

  test("a change that can't apply renders the basket with its line instead of redirecting", async () => {
    const { deps } = await setup();
    const ten = Array.from({ length: 10 }, () => "fixture-b-01:small:oak").join(",");
    for (const query of [`?items=${ten}&more=1`, `?items=${ten}&add=fixture-b-02&size=small&frame=oak`]) {
      const outcome = await basketGet(deps, url(query));
      expect("view" in outcome && outcome.view.notes).toEqual(["a basket holds up to 10 prints."]);
      expect("view" in outcome && outcome.view.basket.count).toBe(10);
    }
    const unoffered = await basketGet(deps, url("?add=fixture-01&size=large&frame=oak"));
    expect("view" in unoffered && unoffered.view.notes).toEqual(["1 print was taken out: that photo isn't available as a print any more."]);
  });

  test("a basket edited by hand renders what is still on offer, with a line for what was dropped (review focus 2)", async () => {
    const { deps } = await setup();
    const outcome = await basketGet(deps, url("?items=fixture-b-01:medium:oak,fixture-c-01:small:oak,fixture-03:small:oak"));
    expect(outcome).toMatchObject({ status: 200, beacon: true });
    expect("view" in outcome && outcome.view.basket.items).toBe("fixture-b-01:medium:oak");
    expect("view" in outcome && outcome.view.notes).toEqual(["2 prints were taken out: those photos aren't available as prints any more."]);
    for (const query of ["?items=a-01:small:oak,,", "?items=A-01:SMALL:OAK", "?items=fixture-b-01:medium:oak%20", `?items=${Array.from({ length: 25 }, () => "fixture-b-01:small:oak").join(",")}`]) {
      const odd = await basketGet(deps, url(query));
      expect("view" in odd).toBe(true);
    }
  });

  test("while prints are closed the basket says so", async () => {
    const { deps } = await setup(quoted, { config: testConfig({ switchedOn: false }) });
    const outcome = await basketGet(deps, url(`?items=${TWO}`));
    expect("view" in outcome && outcome.view.open).toBe(false);
  });
});

describe("POST /basket, intent=quote", () => {
  const quote = (address = ADDRESS) => post({ intent: "quote", ...address });

  test("quotes the whole basket to the posted address and seals exactly what it shows", async () => {
    const { fake, deps } = await setup();
    const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 200, beacon: false });
    if (!("view" in outcome)) throw new Error("expected a page");
    expect(outcome.view.quote).toMatchObject({ printTotal: 23800, deliveryAmount: 4900, label: "delivery" });
    expect(outcome.view.address).toEqual(ADDRESS);
    const sealed = await openQuote(VIEW_SECRET, outcome.view.quote!.token, NOW);
    expect(sealed).toEqual({ items: TWO, address: ADDRESS, printTotal: 23800, deliveryAmount: 4900, freightCents: 3000, taxes: [], buffer: 0.08, rate: 1.5, expires: NOW + 1800 });
    const sent = JSON.parse(fake.calls[0].body);
    expect(sent.items.map((item: { orderItemId: string; quantity: number; productInfo: { size: string } }) => [item.orderItemId, item.quantity, item.productInfo.size])).toEqual([["1", 1, "x12x18"], ["2", 1, "x8x12"]]);
    expect(sent.customerAddress).toMatchObject({ name: "Ada Lovelace", street1: "12 Example Street", country: "AU" });
  });

  test("a us address passes on the sales tax in a line that says so", async () => {
    const { deps } = await setup();
    const outcome = await basketPost(deps, quote(US_ADDRESS), url(`?items=${TWO}`), {});
    expect("view" in outcome && outcome.view.quote).toMatchObject({ deliveryAmount: 5600, label: "delivery and destination taxes" });
    expect("view" in outcome && outcome.view.quote?.breakdown).toContain("us sales tax us$4.20");
  });

  test("a field that fails its rule reopens the form with its values and messages, 422, and artelo is never asked", async () => {
    const { fake, deps } = await setup();
    const outcome = await basketPost(deps, quote({ ...ADDRESS, line1: "", phone: "12" }), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 422 });
    expect("view" in outcome && outcome.view.errors).toEqual({ line1: "add the street address.", phone: "that phone number looks too short." });
    expect("view" in outcome && outcome.view.address.name).toBe("Ada Lovelace");
    expect(fake.calls).toHaveLength(0);
  });

  test("artelo refusing shows its message beside the form, 422; artelo unavailable is a 503", async () => {
    captureLogs();
    let { deps } = await setup(() => json({ message: "we don't deliver to Antarctica" }, 400));
    let outcome = await basketPost(deps, quote({ ...ADDRESS, country: "AQ" }), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 422 });
    expect("view" in outcome && outcome.view.errors.form).toBe("artelo couldn't quote delivery to this address: we don't deliver to Antarctica");
    ({ deps } = await setup(() => new Response("<html>bad gateway</html>", { status: 502 })));
    outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 503 });
    expect("view" in outcome && outcome.view.errors.form).toBe("delivery prices aren't loading right now. try again in a minute.");
    expect("view" in outcome && outcome.view.quote).toBeNull();
  });

  test("past either limit: 429 without reaching artelo", async () => {
    const { fake, deps } = await setup();
    for (const limits of [{ quote: refusing }, { artelo: refusing }]) {
      const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), limits);
      expect(outcome).toMatchObject({ status: 429 });
      expect("view" in outcome && outcome.view.errors.form).toBe("too many quotes - wait a minute and try again.");
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("test builds key the limits on X-Test-Client; production on the visitor's address and one artelo bucket", async () => {
    const { deps } = await setup();
    const limiter = { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit & { limit: ReturnType<typeof vi.fn> };
    const headers = { "cf-connecting-ip": "203.0.113.9", "x-test-client": "spec-1" };
    await basketPost(deps, post({ intent: "quote", ...ADDRESS }, headers), url(`?items=${TWO}`), { quote: limiter, artelo: limiter });
    expect(limiter.limit.mock.calls.map(([options]) => options.key)).toEqual(["203.0.113.9", "price-check"]);
    const testBuild = testDeps(deps.db, { fetch: deps.fetch, config: testConfig({ testClients: true }) });
    limiter.limit.mockClear();
    await basketPost(testBuild, post({ intent: "quote", ...ADDRESS }, headers), url(`?items=${TWO}`), { quote: limiter, artelo: limiter });
    expect(limiter.limit.mock.calls.map(([options]) => options.key)).toEqual(["test:spec-1", "price-check:spec-1"]);
  });

  test("a basket that lost a print, an empty basket and closed prints get no quote", async () => {
    const { fake, deps } = await setup();
    expect(await basketPost(deps, quote(), url("?items=fixture-b-01:medium:oak,fixture-03:small:oak"), {})).toMatchObject({ status: 422 });
    expect(await basketPost(deps, quote(), url(""), {})).toMatchObject({ status: 200 });
    const closed = testDeps(deps.db, { fetch: deps.fetch, config: testConfig({ missing: ["ARTELO_API_KEY"] }) });
    const outcome = await basketPost(closed, quote(), url(`?items=${TWO}`), {});
    expect("view" in outcome && outcome.view.open).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  test("an unreadable post or an unknown intent says so", async () => {
    const { deps } = await setup();
    for (const request of [new Request("https://curiousgeorge.dev/basket", { method: "POST", body: "x", headers: { "content-type": "text/plain" } }), post({ intent: "pay" })]) {
      const outcome = await basketPost(deps, request, url(`?items=${TWO}`), {});
      expect(outcome).toMatchObject({ status: 422 });
      expect("view" in outcome && outcome.view.errors.form).toBe("that form couldn't be read. try again.");
    }
  });

  test("the address is never logged, whatever happens", async () => {
    const logs = captureLogs();
    for (const handler of [quoted, () => json({ message: "Ada Lovelace at 12 Example Street can't be reached" }, 422), () => new Response("down", { status: 503 })] as Handler[]) {
      const { deps } = await setup(handler);
      await basketPost(deps, quote(), url(`?items=${TWO}`), {});
    }
    expect(logs()).not.toMatch(/Ada|Lovelace|Example Street|Bondi|2026|400 000/);
  });
});

describe("refusals that must never reach a checkout button (ADR-0021 as amended)", () => {
  const quote = () => post({ intent: "quote", ...ADDRESS });
  const UNAVAILABLE = "delivery prices aren't loading right now. try again in a minute.";

  test("an unknown charge, parts that don't add up and a delivery over the ceiling are unavailable, 503, with no quote", async () => {
    captureLogs();
    const answers = [
      { productionCost: 80, arteloShipping: 30, usSalesTax: 0, surcharge: 5, total: 115 },
      { productionCost: 80, arteloShipping: 30, usSalesTax: 0, total: 150 },
      { productionCost: 80, arteloShipping: 300, usSalesTax: 0, total: 380 },
    ];
    for (const orderCosts of answers) {
      const { deps } = await setup(() => json({ orderCosts }));
      const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), {});
      expect(outcome).toMatchObject({ status: 503 });
      expect("view" in outcome && outcome.view.errors.form).toBe(UNAVAILABLE);
      expect("view" in outcome && outcome.view.quote).toBeNull();
    }
  });

  const counting = () => ({ limit: vi.fn(async () => ({ success: true })) }) as unknown as RateLimit & { limit: ReturnType<typeof vi.fn> };
  const noFreshRate = {
    "over a week old": "UPDATE print_settings SET value = '2026-09-30' WHERE key = 'usd_aud_date'",
    "never stored": "DELETE FROM print_settings WHERE key IN ('usd_aud', 'usd_aud_date')",
  };
  for (const [state, sql] of Object.entries(noFreshRate)) {
    test(`an exchange rate ${state}: the basket shows and edits, open but unquotable; a quote is 503 before either limit, and artelo is never asked`, async () => {
      const { fake, deps } = await setup();
      await deps.db.prepare(sql).run();
      const page = await basketGet(deps, url(`?items=${TWO}`));
      expect(page).toMatchObject({ status: 200, beacon: true, view: { open: true, quotable: false, quote: null } });
      expect("view" in page && page.view.basket.count).toBe(2);
      expect(await basketGet(deps, url(`?items=${TWO}&remove=1`))).toEqual({ redirect: "/basket?items=fixture-b-02:small:unframed" });
      const limiter = counting();
      const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), { quote: limiter, artelo: limiter });
      expect(outcome).toMatchObject({ status: 503, view: { open: true, quotable: false, quote: null } });
      expect(limiter.limit).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    });
  }

  test("the quote uses the fresh rate, never a stale one, and seals it", async () => {
    const { deps } = await setup();
    await deps.db.prepare("UPDATE print_settings SET value = '2' WHERE key = 'usd_aud'").run();
    const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), {});
    if (!("view" in outcome) || !outcome.view.quote) throw new Error("expected a quote");
    // ceil(30 × 2 × 1.08) = 65
    expect(outcome.view.quote.deliveryAmount).toBe(6500);
    expect((await openQuote(VIEW_SECRET, outcome.view.quote.token, NOW))?.rate).toBe(2);
  });

  test("a closed basket changes nothing: no redirect for add, one more or remove one", async () => {
    const { deps } = await setup(quoted, { config: testConfig({ switchedOn: false }) });
    for (const query of [`?items=${TWO}&more=1`, `?items=${TWO}&remove=1`, "?add=fixture-b-01&size=medium&frame=oak"]) {
      const outcome = await basketGet(deps, url(query));
      expect("view" in outcome && outcome.view.open).toBe(false);
    }
  });

  test("the shared artelo bucket counts only quotes that reach artelo; the visitor's limit counts every quote", async () => {
    const { deps } = await setup();
    const visitor = counting();
    const artelo = counting();
    await basketPost(deps, quote(), url(`?items=${TWO}`), { quote: visitor, artelo });
    await basketPost(deps, post({ intent: "quote", ...ADDRESS, phone: "12" }), url(`?items=${TWO}`), { quote: visitor, artelo });
    await basketPost(deps, quote(), url("?items=fixture-b-01:medium:oak,fixture-03:small:oak"), { quote: visitor, artelo });
    expect([visitor.limit.mock.calls.length, artelo.limit.mock.calls.length]).toEqual([3, 1]);
  });

  test("a closed basket takes no quote before either limit is counted", async () => {
    const { fake, deps } = await setup(quoted, { config: testConfig({ switchedOn: false }) });
    const limiter = { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit & { limit: ReturnType<typeof vi.fn> };
    const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), { quote: limiter, artelo: limiter });
    expect("view" in outcome && outcome.view.open).toBe(false);
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });
});
