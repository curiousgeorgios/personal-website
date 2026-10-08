import { describe, expect, test, vi } from "vitest";
import Order from "../../src/components/prints/Order.astro";
import Notebook from "../../src/layouts/Notebook.astro";
import { canViewOrder, ORDER_STATUS_LINES } from "../../src/lib/prints/order-page";
import { getOrder, orderLines, type OrderRow } from "../../src/lib/prints/store";
import { viewKey } from "../../src/lib/prints/view-key";
import { insertOrder, printDb, VIEW_SECRET } from "./prints-fakes";
import { render, text } from "./render";

const GST = "prices include no gst; the seller isn't registered for gst.";
const ORDER = "01k6x00000000000000000000a";
const load = async (columns: Record<string, string | number | null> = {}, lines?: Parameters<typeof insertOrder>[2]) => {
  const db = await printDb();
  await insertOrder(db, { id: ORDER, paid_at: Date.UTC(2026, 9, 8, 3, 2) / 1000, ...columns }, lines);
  return { order: (await getOrder(db, ORDER)) as OrderRow, lines: (await orderLines(db, [ORDER])).get(ORDER)! };
};
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);

describe("the order page", () => {
  test("its prints, where they go, what was paid, the gst sentence and the paid date", async () => {
    const doc = await render(Order, { ...(await load({ status: "placed" })), gst: GST });
    expect(labels(doc)).toEqual(["your order", "status", "say hi"]);
    expect(text(doc.querySelector("h1"))).toBe("your prints");
    expect([...doc.querySelectorAll(".basket-line")].map((line) => [text(line.querySelector(".line-name")), text(line.querySelector(".line-what"))])).toEqual([["photo 1 of 2 from 14.06.26", "medium · 12 × 18 in · oak frame"], ["photo 2 of 2 from 14.06.26", "small · 8 × 12 in · unframed"]]);
    expect(doc.querySelector(".basket-line img")!.getAttribute("width")).toBe("160");
    expect([...doc.querySelectorAll(".order-facts p")].map(text)).toEqual(["to australia", "prints $238 + delivery $49 = $287", GST, "paid 08.10.26"]);
    expect(text(doc.querySelector(".order-status"))).toBe("they're with the printer.");
    expect(text(doc.querySelector("#say-hi"))).toContain("questions about your order? hello@curiousgeorge.dev");
    expect(doc.querySelector('#say-hi a[href="mailto:hello@curiousgeorge.dev"]')).not.toBeNull();
    expect(doc.querySelector("script")).toBeNull();
  });

  test("a taxed delivery says so; one print reads in the singular; quantities show", async () => {
    let doc = await render(Order, { ...(await load({ status: "paid", delivery_taxed: 1, delivery_amount: 5600, country: "US" })), gst: GST });
    expect([...doc.querySelectorAll(".order-facts p")].map(text).slice(0, 2)).toEqual(["to united states", "prints $238 + delivery and destination taxes $56 = $294"]);
    doc = await render(Order, { ...(await load({ status: "in_production" }, [["fixture-01", "small", "oak", 1]])), gst: GST });
    expect(text(doc.querySelector("h1"))).toBe("your print");
    expect(text(doc.querySelector(".order-status"))).toBe("it's being printed and packed.");
    doc = await render(Order, { ...(await load({ status: "placed" }, [["fixture-01", "small", "oak", 2]])), gst: GST });
    expect(text(doc.querySelector(".basket-line"))).toContain("× 2");
  });

  test("every status has its line, in the plural and the singular", () => {
    expect(ORDER_STATUS_LINES).toEqual({
      checkout: ["your payment's on its way through. this page updates when it lands.", "your payment's on its way through. this page updates when it lands."],
      expired: ["this checkout wasn't finished, so nothing was charged.", "this checkout wasn't finished, so nothing was charged."],
      paid: ["paid. your prints are being sent to the printer.", "paid. your print is being sent to the printer."],
      needs_attention: ["paid. something needs sorting before they print. george knows and will email you.", "paid. something needs sorting before it prints. george knows and will email you."],
      placed: ["they're with the printer.", "it's with the printer."],
      in_production: ["they're being printed and packed.", "it's being printed and packed."],
      shipped: ["they're on their way:", "it's on its way:"],
      delivered: ["delivered. enjoy them.", "delivered. enjoy it."],
      cancelled: ["this order was cancelled. george will be in touch about a refund.", "this order was cancelled. george will be in touch about a refund."],
      refunded: ["refunded.", "refunded."],
    });
  });

  test("shipped lists each parcel's carrier and a tracking link; an order not yet paid shows no paid date", async () => {
    const shipments = JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }, { carrier: "usps", number: "9400", url: "" }]);
    let doc = await render(Order, { ...(await load({ status: "shipped", shipments })), gst: GST });
    expect([...doc.querySelectorAll(".tracking li")].map(text)).toEqual(["ups 1Z999AA10123456784", "usps 9400"]);
    const link = doc.querySelector(".tracking a")!;
    expect([link.getAttribute("href"), link.getAttribute("rel")]).toEqual(["https://www.ups.com/track?tracknum=1Z999AA10123456784", "noopener noreferrer"]);
    doc = await render(Order, { ...(await load({ status: "checkout", paid_at: null })), gst: GST });
    expect([...doc.querySelectorAll(".order-facts p")].map(text)).not.toContain("paid 08.10.26");
  });

  test("a recreated order's line with no artelo size still reads", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention" }, [["fixture-b-01", "medium", "oak", 1]]);
    await db.prepare("UPDATE print_order_items SET size = '' WHERE order_id = ?").bind(ORDER).run();
    const doc = await render(Order, { order: (await getOrder(db, ORDER))!, lines: (await orderLines(db, [ORDER])).get(ORDER)!, gst: GST });
    expect(text(doc.querySelector(".line-what"))).toBe("medium · oak frame");
  });

  test("the notebook refreshes a page only when asked", async () => {
    const asked = await render(Notebook, { title: "t", noindex: true, refresh: 10 });
    expect(asked.querySelector('meta[http-equiv="refresh"]')!.getAttribute("content")).toBe("10");
    expect((await render(Notebook, { title: "t" })).querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });

  test("a buyer reads their own words for needs attention, cancelled and refunded, never artelo's message or an internal reason", async () => {
    const reason = "artelo answered 503: internal-reason-xyz";
    for (const status of ["needs_attention", "cancelled", "refunded"] as const) {
      const doc = await render(Order, { ...(await load({ status, attention_reason: reason, artelo_status: "Failed", artelo_order_id: "48213", refunded_amount: 100 })), gst: GST });
      expect(text(doc.querySelector(".order-status"))).toBe(ORDER_STATUS_LINES[status][0]);
      const page = doc.documentElement.outerHTML;
      for (const internal of ["internal-reason-xyz", "artelo answered", "Failed", "48213"]) expect(page).not.toContain(internal);
    }
  });

  test("tracking from outside renders as text, and only an https address becomes a link", async () => {
    const shipments = JSON.stringify([
      { carrier: "<b>ups</b>", number: "<img src=x onerror=alert(1)>", url: "https://example.com/t?a=1&b=\"2" },
      { carrier: "fedex", number: "A1", url: "javascript:alert(1)" },
      { carrier: "dhl", number: "B2", url: "http://example.com/t" },
      { carrier: "usps", number: "C3", url: "https://exa mple.com/t" },
    ]);
    const doc = await render(Order, { ...(await load({ status: "shipped", shipments })), gst: GST });
    expect(doc.querySelector(".tracking b, .tracking img")).toBeNull();
    expect([...doc.querySelectorAll(".tracking li")].map(text)).toEqual(["<b>ups</b> <img src=x onerror=alert(1)>", "fedex A1", "dhl B2", "usps C3"]);
    expect([...doc.querySelectorAll(".tracking a")].map((link) => [link.getAttribute("href"), link.getAttribute("rel")])).toEqual([["https://example.com/t?a=1&b=\"2", "noopener noreferrer"]]);
    expect([...doc.querySelectorAll("a")].filter((link) => /^(javascript|http):/i.test(link.getAttribute("href") ?? ""))).toEqual([]);
  });

  test("a delivered order shows no tracking and a page holds no address or email", async () => {
    const doc = await render(Order, { ...(await load({ status: "delivered", shipments: JSON.stringify([{ carrier: "ups", number: "1Z", url: "https://example.com" }]) })), gst: GST });
    expect(doc.querySelector(".tracking")).toBeNull();
    expect(doc.documentElement.outerHTML).not.toMatch(/@(?!curiousgeorge\.dev)|street|phone/i);
  });
});

describe("who may see an order", () => {
  const unknown = "01k6x0000000000000000000zz";
  const cases = async (): Promise<[string, string, string | null, boolean][]> => {
    const key = await viewKey(VIEW_SECRET, ORDER);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const spare = key.slice(0, -1) + alphabet[alphabet.indexOf(key.at(-1)!) ^ 1];
    return [
      ["the right key", ORDER, key, true],
      ["a wrong key", ORDER, "w".repeat(43), false],
      ["another order's key", ORDER, await viewKey(VIEW_SECRET, unknown), false],
      ["no key", ORDER, null, false],
      ["an empty key", ORDER, "", false],
      ["a short key", ORDER, key.slice(0, -1), false],
      ["a key with characters outside the alphabet", ORDER, "!".repeat(43), false],
      ["a key in a non-canonical spelling", ORDER, spare, false],
      ["an unknown order id with its own valid key", unknown, await viewKey(VIEW_SECRET, unknown), true],
      ["an unknown order id with another order's key", unknown, key, false],
      ["a malformed order id", "not-an-id", key, false],
      ["an empty order id", "", key, false],
    ];
  };

  test("only the right key for a well-formed id passes", async () => {
    for (const [name, id, key, expected] of await cases()) expect(await canViewOrder(VIEW_SECRET, id, key), name).toBe(expected);
    expect(await canViewOrder("", ORDER, await viewKey(VIEW_SECRET, ORDER))).toBe(false);
    expect(await canViewOrder(VIEW_SECRET, ORDER.toUpperCase(), await viewKey(VIEW_SECRET, ORDER.toUpperCase()))).toBe(false);
  });

  test("every refusal costs the same one verification as a yes, so a 404's timing says nothing about an order", async () => {
    const verify = vi.spyOn(crypto.subtle, "verify");
    try {
      for (const [name, id, key] of await cases()) {
        verify.mockClear();
        await canViewOrder(VIEW_SECRET, id, key);
        expect(verify, name).toHaveBeenCalledTimes(1);
      }
    } finally {
      verify.mockRestore();
    }
  });
});
