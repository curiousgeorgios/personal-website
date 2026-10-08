import { describe, expect, test } from "vitest";
import Basket from "../../src/components/prints/Basket.astro";
import { parseItems } from "../../src/lib/prints/basket";
import type { BasketView } from "../../src/lib/prints/basket-page";
import { EMPTY_ADDRESS } from "../../src/lib/prints/address";
import { resolveBasket } from "../../src/lib/prints/store";
import { ADDRESS, printDb } from "./prints-fakes";
import { render, text } from "./render";

const GST = "prices include no gst; the seller isn't registered for gst.";
const viewOf = async (items: string, over: Partial<BasketView> = {}): Promise<BasketView> => ({
  basket: await resolveBasket(await printDb(), parseItems(items)), notes: [], open: true, address: { ...EMPTY_ADDRESS }, errors: {}, quote: null, gst: GST, ...over,
});
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);
const TWO = "fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed";

describe("the basket page", () => {
  test("its head row says where the basket lives and links back to the gallery with it", async () => {
    const doc = await render(Basket, { view: await viewOf(TWO) });
    expect(labels(doc)).toEqual(["basket", "prints", "deliver to"]);
    expect(text(doc.querySelector("h1"))).toBe("your basket");
    expect(text(doc.querySelector(".intro"))).toBe("this basket lives in the address bar: bookmark or share this page to keep it.");
    expect(doc.querySelector(".where a")!.getAttribute("href")).toBe(`/photos?items=${TWO}`);
    expect(text(doc.querySelector(".where a"))).toBe("keep looking");
    expect(doc.querySelector("script")).toBeNull();
  });

  test("one line per print line: its eager 240 preview, name, size, frame, quantity, price and links", async () => {
    const doc = await render(Basket, { view: await viewOf(TWO) });
    const lines = [...doc.querySelectorAll(".basket-line")];
    expect(lines.map((line) => text(line.querySelector(".line-name")))).toEqual(["photo 1 of 2 from 14.06.26", "photo 2 of 2 from 14.06.26"]);
    expect(lines.map((line) => text(line.querySelector(".line-what")))).toEqual(["medium · 12 × 18 in · oak frame × 2 · $358", "small · 8 × 12 in · unframed · $59"]);
    const img = lines[0].querySelector("img")!;
    expect(["loading", "width", "height", "alt"].map((name) => img.getAttribute(name))).toEqual(["eager", "160", "240", ""]);
    expect([...lines[1].querySelectorAll(".line-links a")].map((a) => [text(a), a.getAttribute("href")])).toEqual([
      ["one more", `/basket?items=${TWO}&more=2`], ["remove one", `/basket?items=${TWO}&remove=2`],
    ]);
    expect(text(doc.querySelector(".basket-total"))).toBe("prints $417");
  });

  test("at ten prints there is no one more", async () => {
    const doc = await render(Basket, { view: await viewOf(Array.from({ length: 10 }, () => "fixture-b-01:small:oak").join(",")) });
    expect([...doc.querySelectorAll(".line-links a")].map(text)).toEqual(["remove one"]);
  });

  test("the address form posts to the basket, each field labelled with its shipping autocomplete token", async () => {
    const doc = await render(Basket, { view: await viewOf(TWO) });
    const form = doc.querySelector("form#deliver")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["post", `/basket?items=${TWO}`]);
    expect(form.querySelector('input[name="intent"]')!.getAttribute("value")).toBe("quote");
    const fields = [...form.querySelectorAll("input:not([type=hidden]), select")].map((control) => [control.getAttribute("name"), control.getAttribute("autocomplete"), text(form.querySelector(`label[for="${control.id}"]`))]);
    expect(fields).toEqual([
      ["name", "shipping name", "full name"], ["line1", "shipping address-line1", "street address"], ["line2", "shipping address-line2", "apartment, unit or building"],
      ["city", "shipping address-level2", "city or suburb"], ["state", "shipping address-level1", "state or region"], ["postcode", "shipping postal-code", "postcode"],
      ["country", "shipping country", "country"], ["phone", "shipping tel", "phone"],
    ]);
    expect(form.querySelector('input[name="phone"]')!.getAttribute("type")).toBe("tel");
    expect(text(form.querySelector('select option[value=""]'))).toBe("choose a country");
    expect(text(form.querySelector(".prints-hint"))).toBe("this address goes to stripe and artelo, to quote and deliver your prints. this site doesn't keep it.");
    expect(text(form.querySelector("button"))).toBe("quote delivery");
  });

  test("a failed field reopens with its value and a message beside it; addresses are text, never markup", async () => {
    const address = { ...ADDRESS, line2: "<b>unit</b> 3" };
    const doc = await render(Basket, { view: await viewOf(TWO, { address, errors: { phone: "that phone number looks too short.", form: "artelo couldn't quote delivery to this address: no" } }) });
    expect(doc.querySelector('input[name="line2"]')!.getAttribute("value")).toBe("<b>unit</b> 3");
    expect(doc.querySelector("#deliver b")).toBeNull();
    expect(doc.querySelector('input[name="phone"]')!.getAttribute("aria-invalid")).toBe("true");
    expect(text(doc.querySelector("#deliver-phone-error"))).toBe("that phone number looks too short.");
    expect(text(doc.querySelector("#deliver .basket-error[role=alert]"))).toBe("artelo couldn't quote delivery to this address: no");
    expect(doc.querySelector('select[name="country"] option[selected]')!.getAttribute("value")).toBe("AU");
  });

  test("after a quote: the total, the breakdown, the gst sentence and a pay form carrying the address and the sealed quote", async () => {
    const quote = { printTotal: 41700, deliveryAmount: 4900, label: "delivery", breakdown: "artelo's freight us$30.00 for this address, …", token: "sealed.token" };
    const doc = await render(Basket, { view: await viewOf(TWO, { address: ADDRESS, quote }) });
    expect(labels(doc)).toEqual(["basket", "prints", "deliver to", "total"]);
    expect(text(doc.querySelector(".quote-line"))).toBe("prints $417 + delivery $49 = $466");
    expect([...doc.querySelectorAll("#total .prints-hint")].map(text).slice(0, 2)).toEqual(["artelo's freight us$30.00 for this address, …", `in australian dollars. ${GST}`]);
    const pay = doc.querySelector("form#pay")!;
    expect([pay.getAttribute("method"), pay.getAttribute("action")]).toEqual(["post", `/basket?items=${TWO}`]);
    const hidden = Object.fromEntries([...pay.querySelectorAll("input[type=hidden]")].map((input) => [input.getAttribute("name"), input.getAttribute("value")]));
    expect(hidden).toEqual({ intent: "checkout", ...ADDRESS, quote: "sealed.token" });
    expect(text(pay.querySelector("button"))).toBe("continue to payment");
    expect(text(pay.querySelector(".prints-hint"))).toBe("payment happens on stripe's own checkout page, which sets its own cookies. this site sets none. your address is fixed there; to change it, change it here and quote again.");
  });

  test("an empty basket says so; closed prints show the lines and no form; notes are shown", async () => {
    let doc = await render(Basket, { view: await viewOf("") });
    expect(labels(doc)).toEqual(["basket", "prints"]);
    expect(text(doc.querySelector(".empty"))).toBe("your basket is empty. find a photo you like.");
    expect(doc.querySelector('.empty a[href="/photos"]')).not.toBeNull();
    doc = await render(Basket, { view: await viewOf(TWO, { open: false, notes: ["a basket holds up to 10 prints."] }) });
    expect(labels(doc)).toEqual(["basket", "prints"]);
    expect(text(doc.querySelector(".basket-closed"))).toBe("prints are closed for now.");
    expect(text(doc.querySelector(".basket-note"))).toBe("a basket holds up to 10 prints.");
    expect(doc.querySelector("form")).toBeNull();
  });
});
