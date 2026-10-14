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
  test("sits between the photo and say hi, a plain get form to the basket with one small script", async () => {
    const doc = await render(PhotoView, { page, prints });
    expect(labels(doc)).toEqual(["photo", "prints", "say hi"]);
    const form = doc.querySelector("form#prints")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/basket"]);
    expect(text(form.querySelector("p"))).toBe("a print of this photo, made by artelo on archival matte paper and posted from the us.");
    // The preview's announcement (print-preview.ts), bundled and inlined by the build; nothing else
    expect([...doc.querySelectorAll("script")].map((script) => script.getAttribute("src"))).toEqual([expect.stringContaining("PrintRow.astro?astro&type=script")]);
  });

  test("one size radio per tier it gets, the first checked; unframed checked, oak offered", async () => {
    const doc = await render(PhotoView, { page, prints });
    const sizes = [...doc.querySelectorAll('input[name="size"]')];
    expect(sizes.map((input) => [input.getAttribute("value"), input.hasAttribute("checked")])).toEqual([["small", true], ["medium", false]]);
    expect([...doc.querySelectorAll(".size-choice")].map(text)).toEqual([
      "small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed",
      "medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed",
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

describe("the print row's preview", () => {
  const nbsp = (text: string) => text.replace(/ /g, " ");
  /** The fixture photo at another master size, its previews fitted inside the square as photos:prepare makes them */
  const at = (width: number, height: number, id = "fixture-x-01"): { page: PhotoPage; prints: typeof prints } => {
    const fit = (size: number) => ({ width: Math.round((size * width) / Math.max(width, height)), height: Math.round((size * height) / Math.max(width, height)) });
    const previews = [960, 1600].flatMap((size) => (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/${id}/sha/${size}.${format}`, ...fit(size), format })));
    return { page: { ...page, photo: { ...photo, id, width, height, previews } }, prints: { offers: printsFor(width, height)!, prices: PRICES, gst: GST } };
  };

  test("draws the chosen print from the photo page's own image, for the eye only", async () => {
    const doc = await render(PhotoView, { page, prints });
    const stage = doc.querySelector("#prints .preview-stage")!;
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    expect([...stage.classList]).toEqual(["preview-stage", "vertical", "family-2-3"]);
    expect([...stage.querySelectorAll(".preview-outline")].map((outline) => outline.getAttribute("data-tier"))).toEqual(["small", "medium"]);
    // The same sources and sizes as the head row's picture, so the browser reuses the copy it has; never a master
    const head = doc.querySelector(".photo img")!;
    const img = stage.querySelector(".preview-print img")!;
    for (const name of ["src", "srcset", "sizes"]) expect(img.getAttribute(name)).toBe(head.getAttribute(name));
    expect(stage.querySelector(".preview-print source")!.getAttribute("srcset")).toBe(doc.querySelector(".photo source")!.getAttribute("srcset"));
    expect([img.getAttribute("alt"), img.getAttribute("loading")]).toEqual(["", "lazy"]);
    for (const url of [img.getAttribute("src")!, ...img.getAttribute("srcset")!.split(", ")]) expect(url).toMatch(/^\/media\/p\/(960|1600)\.webp/);
    expect([...stage.querySelectorAll(".ruler-x b")].map(text)).toEqual(["0", "10", "20", "30", "40", "50"]);
    expect([...stage.querySelectorAll(".ruler-y b")].map(text)).toEqual(["0", "10", "20", "30", "40", "50", "60"]);
  });

  test("its caption has a line for every size and frame the row offers, at the row's prices, and an empty status for the script", async () => {
    const doc = await render(PhotoView, { page, prints });
    const caption = doc.querySelector("#prints .preview-caption")!;
    expect([...caption.querySelectorAll(".preview-choice")].map((line) => [line.getAttribute("data-tier"), line.getAttribute("data-frame"), text(line)])).toEqual([
      ["small", "unframed", "small · unframed · $59"], ["small", "oak", "small · oak frame · $139"],
      ["medium", "unframed", "medium · unframed · $79"], ["medium", "oak", "medium · oak frame · $179"],
    ]);
    expect([...caption.querySelectorAll(".preview-size")].map((line) => nbsp(text(line)))).toEqual([
      "the print: 20 cm wide, 30 cm tall (8 × 12 in), 500 pixels per inch",
      "the print: 30 cm wide, 46 cm tall (12 × 18 in), 333 pixels per inch",
    ]);
    expect(text(caption.querySelector(".preview-note"))).toBe("drawn to scale against the ruler. the frame is illustrative; screen colour and timber grain vary.");
    const status = doc.querySelector("#prints .preview-status")!;
    expect([status.getAttribute("role"), text(status)]).toEqual(["status", ""]);
  });

  test("a landscape is drawn on its side, its width first", async () => {
    const doc = await render(PhotoView, at(6000, 4000));
    expect(doc.querySelector("#prints .preview-stage")!.classList.contains("horizontal")).toBe(true);
    expect(nbsp(text(doc.querySelector('#prints .preview-size[data-tier="medium"]')))).toBe("the print: 46 cm wide, 30 cm tall (18 × 12 in), 333 pixels per inch");
  });

  test("every ratio family gets its class, an outline per size and its trim where the paper's shape differs", async () => {
    const families: [number, number, string, string | null][] = [
      [4000, 6000, "family-2-3", null], [4284, 5712, "family-3-4", null], [4000, 5000, "family-4-5", "trims 1.8% of the photo's width, evenly from both sides"],
      [4000, 5657, "family-iso-a", "trims 0.3% of the photo's height, evenly from top and bottom"], [4000, 4000, "family-1-1", null],
    ];
    for (const [width, height, family, mediumTrim] of families) {
      const doc = await render(PhotoView, at(width, height));
      const stage = doc.querySelector("#prints .preview-stage")!;
      expect(stage.classList.contains(family), family).toBe(true);
      expect(stage.querySelectorAll(".preview-outline")).toHaveLength(family === "family-2-3" ? 2 : 3);
      const medium = text(doc.querySelector('#prints .preview-size[data-tier="medium"]'));
      if (mediumTrim) expect(medium).toContain(`; ${mediumTrim}`);
      else expect(medium).not.toContain("trims");
    }
  });

  test("a photo with one size draws one, with its two frames", async () => {
    const doc = await render(PhotoView, at(2048, 2048));
    expect([...doc.querySelectorAll("#prints .preview-outline")].map((outline) => outline.getAttribute("data-tier"))).toEqual(["small"]);
    expect([...doc.querySelectorAll("#prints .preview-choice")].map(text)).toEqual(["small · unframed · $59", "small · oak frame · $139"]);
    expect([...doc.querySelectorAll('#prints input[name="size"]')].map((input) => input.getAttribute("value"))).toEqual(["small"]);
  });

  test("no preview without prints", async () => {
    const doc = await render(PhotoView, { page });
    expect(doc.querySelector(".print-preview")).toBeNull();
  });

  test("says what the print is made from: this photo's own pixel size, each size's density and the file's details", async () => {
    const doc = await render(PhotoView, at(3648, 5472, "fixture-x-02"));
    const intro = [...doc.querySelectorAll("#prints > p")].map(text);
    expect(intro.slice(0, 2)).toEqual([
      "a print of this photo, made by artelo on archival matte paper and posted from the us.",
      "printed from the full-resolution file, 3,648 × 5,472 pixels, not from the smaller images on this page.",
    ]);
    // At least 200 on both sides at every size offered (the catalogue's rule), rounded down: 3648 / 12 = 304
    expect([...doc.querySelectorAll("#prints .preview-size")].map((line) => text(line).match(/(\d+) pixels per inch/)?.[1])).toEqual(["456", "304"]);
    const details = doc.querySelector("#prints details.print-details")!;
    expect(text(details.querySelector("summary"))).toBe("about the print file");
    expect(details.hasAttribute("open")).toBe(false);
    expect(text(details.querySelector("p"))).toBe(
      "full-resolution jpeg at quality 96, with an srgb colour profile and no colour subsampling. at least 200 pixels per inch at every available print size.",
    );
  });

  test("invites a request for a high-resolution file by email, never a download", async () => {
    const doc = await render(PhotoView, { page, prints });
    const contact = doc.querySelector("#prints .print-contact")!;
    expect(text(contact)).toBe("want a high-resolution file to print yourself? ask george at hello@curiousgeorge.dev.");
    const links = [...contact.querySelectorAll("a")];
    expect(links.map((link) => [link.getAttribute("href"), text(link)])).toEqual([["mailto:hello@curiousgeorge.dev?subject=a%20high-resolution%20file%20of%20fixture-b-01", "hello@curiousgeorge.dev"]]);
    // Nothing on the row links to a file: the master stays behind its signed, revocable links
    expect([...doc.querySelectorAll("#prints a")].map((link) => link.getAttribute("href"))).toEqual([links[0].getAttribute("href")]);
    expect(doc.querySelector('#prints [href*="/photos/download"], #prints [href*="prints/"], #prints [download]')).toBeNull();
  });
});

