import { describe, expect, test } from "vitest";
import PhotoView from "../../src/components/photos/PhotoView.astro";
import type { PhotoPage, PublicPhoto } from "../../src/lib/photos/store";
import { printsFor } from "../../src/lib/prints/catalogue";
import { render, text } from "./render";

const PRICES = { small: { unframed: 5900, oak: 13900 }, medium: { unframed: 7900, oak: 17900 }, large: { unframed: 11900, oak: 25900 } };
const GST = "prices include no gst; the seller isn't registered for gst.";
const photo: PublicPhoto = {
  id: "fixture-b-01", collection: "fixture-b", title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2026-06-14", place: null,
  previews: [960, 1600].flatMap((size) => (["webp", "avif"] as const).map((format) => ({ url: `/media/p/${size}.${format}`, width: (size * 2) / 3, height: size, format }))),
};
const page: PhotoPage = { photo, publishedAt: 1781392500, index: 0, total: 2, previous: null, next: "fixture-b-02" };
const prints = { offers: printsFor(4000, 6000)!, prices: PRICES, gst: GST };
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);

describe("the print row", () => {
  test("sits between the photo and say hi, a plain get form to the basket", async () => {
    const doc = await render(PhotoView, { page, prints });
    expect(labels(doc)).toEqual(["photo", "prints", "say hi"]);
    const form = doc.querySelector("form#prints")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/basket"]);
    expect(text(form.querySelector("p"))).toBe("a print of this photo, made by artelo on archival matte paper and posted from the us.");
    expect(doc.querySelector("script")).toBeNull();
  });

  test("one size radio per tier it gets, the first checked; unframed checked, oak offered", async () => {
    const doc = await render(PhotoView, { page, prints });
    const sizes = [...doc.querySelectorAll('input[name="size"]')];
    expect(sizes.map((input) => [input.getAttribute("value"), input.hasAttribute("checked")])).toEqual([["small", true], ["medium", false], ["large", false]]);
    expect([...doc.querySelectorAll(".size-choice")].map(text)).toEqual([
      "small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed",
      "medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed",
      "large · 16 × 24 in (41 × 61 cm) · $119, or $259 framed",
    ]);
    expect([...doc.querySelectorAll('input[name="frame"]')].map((input) => [input.getAttribute("value"), input.hasAttribute("checked")])).toEqual([["unframed", true], ["oak", false]]);
    expect([...doc.querySelectorAll(".frame-choice")].map(text)).toEqual(["unframed", "oak frame"]);
  });

  test("names the photo to add, says how delivery works and carries a basket only when there is one", async () => {
    let doc = await render(PhotoView, { page, prints });
    expect(doc.querySelector('input[name="add"]')!.getAttribute("value")).toBe("fixture-b-01");
    expect(doc.querySelector('input[name="items"]')).toBeNull();
    expect(text(doc.querySelector("#prints button"))).toBe("add to basket");
    expect(text(doc.querySelector("#prints .prints-hint"))).toBe(`delivery is quoted for your address in the basket. ${GST}`);
    doc = await render(PhotoView, { page, prints, carry: { items: "fixture-01:small:oak", count: 1 } });
    expect(doc.querySelector('input[name="items"]')!.getAttribute("value")).toBe("fixture-01:small:oak");
  });

  test("no row without prints", async () => {
    expect(labels(await render(PhotoView, { page }))).toEqual(["photo", "say hi"]);
  });

  test("a carried basket rides on every gallery link and shows in the head row", async () => {
    const doc = await render(PhotoView, { page, carry: { items: "fixture-01:small:oak", count: 1 } });
    expect(doc.querySelector('a[rel="next"]')!.getAttribute("href")).toBe("/photos/fixture-b-02?items=fixture-01:small:oak");
    expect([...doc.querySelectorAll(".photo-nav a")].at(-1)!.getAttribute("href")).toBe("/photos?before=1781392501&items=fixture-01:small:oak#post-fixture-b");
    const basket = doc.querySelector(".basket-link a")!;
    expect([basket.getAttribute("href"), text(basket)]).toEqual(["/basket?items=fixture-01:small:oak", "basket · 1 print"]);
  });
});
