import { describe, expect, test } from "vitest";
import Gallery from "../../src/components/photos/Gallery.astro";
import type { Entry, PublicPhoto } from "../../src/lib/photos/store";
import { render, text } from "./render";

const photo = (id: string, over: Partial<PublicPhoto> = {}): PublicPhoto => ({
  id, collection: id.slice(0, id.lastIndexOf("-")), title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2025-02-02", place: "bondi, sydney",
  previews: [240, 480].flatMap((size) => (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/${id}/s/${size}.${format}`, width: (size * 2) / 3, height: size, format }))),
  ...over,
});
const entry = (collection: string, date: string, place: string | null, ids: string[], over: Partial<PublicPhoto> = {}): Entry => ({
  collection, date, place, publishedAt: Date.parse(`${date}T12:00:00+10:00`) / 1000, photos: ids.map((id) => photo(id, { date, place, ...over })),
});
// DFkL1xrsnOH-02 is hidden: the frames are 01 and 03, and they count as 1 and 2 of 2
const PAGE = [entry("DFkL1xrsnOH", "2025-02-02", "bondi, sydney", ["DFkL1xrsnOH-01", "DFkL1xrsnOH-03"]), entry("older", "2024-12-25", null, ["older-01"])];
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);
const attrs = (el: Element | null, ...names: string[]) => names.map((name) => el?.getAttribute(name) ?? null);

describe("Gallery", () => {
  test("each entry is headed by its date and place, with numbered frames that link to their pages", async () => {
    const doc = await render(Gallery, { entries: PAGE, next: null, older: false });
    expect(labels(doc)).toEqual(["photos of", "entries"]);
    expect(text(doc.querySelector("h1"))).toBe("george vlachos");
    expect(text(doc.querySelector(".intro"))).toBe("photos i've taken, one entry per instagram post, newest first.");
    expect(text(doc.querySelector(".where"))).toBe("back to the logbook");
    expect([...doc.querySelectorAll("ol.entries > li.entry")].map((li) => li.id)).toEqual(["post-DFkL1xrsnOH", "post-older"]);
    expect(text(doc.querySelector("#post-DFkL1xrsnOH .entry-head"))).toBe("02.02.25 · bondi, sydney");
    expect(doc.querySelector("#post-DFkL1xrsnOH .entry-head time")!.getAttribute("datetime")).toBe("2025-02-02");
    expect(text(doc.querySelector("#post-older .entry-head"))).toBe("25.12.24");
    expect([...doc.querySelectorAll("#post-DFkL1xrsnOH .frame-no")].map(text)).toEqual(["01", "03"]);
    expect([...doc.querySelectorAll("#post-DFkL1xrsnOH a.frame-link")].map((a) => a.getAttribute("href"))).toEqual(["/photos/DFkL1xrsnOH-01", "/photos/DFkL1xrsnOH-03"]);
    const img = doc.querySelectorAll("#post-DFkL1xrsnOH img")[1];
    expect(attrs(img, "alt", "width", "height", "sizes", "src", "decoding")).toEqual([
      "photo 2 of 2 from 2 february 2025, bondi, sydney", "160", "240", "(max-width: 680px) 59px, 80px", "/media/photos/previews/DFkL1xrsnOH-03/s/240.webp", "async",
    ]);
    expect(img.getAttribute("srcset")).toBe("/media/photos/previews/DFkL1xrsnOH-03/s/240.webp 160w, /media/photos/previews/DFkL1xrsnOH-03/s/480.webp 320w");
    // A phone takes only the 240, whatever its pixel density; wider screens choose between the 240 and the 480
    const sources = [...doc.querySelectorAll("#post-DFkL1xrsnOH .sheet-frame")[1].querySelectorAll("picture > source")];
    expect(sources.map((source) => attrs(source, "media", "type", "srcset"))).toEqual([
      ["(max-width: 680px)", "image/avif", "/media/photos/previews/DFkL1xrsnOH-03/s/240.avif 160w"],
      ["(max-width: 680px)", "image/webp", "/media/photos/previews/DFkL1xrsnOH-03/s/240.webp 160w"],
      [null, "image/avif", "/media/photos/previews/DFkL1xrsnOH-03/s/240.avif 160w, /media/photos/previews/DFkL1xrsnOH-03/s/480.avif 320w"],
    ]);
    expect(sources.every((source) => source.getAttribute("sizes") === "(max-width: 680px) 59px, 80px")).toBe(true);
    // Each entry's heading sits under the entries row's h2
    expect(doc.querySelector("#post-DFkL1xrsnOH h3.entry-head")).not.toBeNull();
  });

  test("only the first eight frames of the page's first entry load eagerly, the first with high priority; numbers keep three digits", async () => {
    const ids = [...Array.from({ length: 19 }, (_, i) => `big-${String(i + 1).padStart(2, "0")}`), "big-100"];
    const doc = await render(Gallery, { entries: [entry("big", "2025-02-02", null, ids), PAGE[1]], next: null, older: false });
    const loading = [...doc.querySelectorAll("ol.entries img")].map((img) => [img.getAttribute("loading"), img.getAttribute("fetchpriority")]);
    expect(loading).toEqual([["eager", "high"], ...Array(7).fill(["eager", null]), ...Array(13).fill(["lazy", null])]);
    expect(text([...doc.querySelectorAll("#post-big .frame-no")].at(-1)!)).toBe("100");
  });

  test("older entries is a plain link to the next page's cursor; at the end the line says so", async () => {
    let doc = await render(Gallery, { entries: PAGE, next: 1735092000, older: false });
    const more = doc.querySelector("a.more")!;
    expect(attrs(more, "href", "data-next")).toEqual(["/photos?before=1735092000", "1735092000"]);
    expect(text(more)).toBe("older entries");
    expect(doc.querySelector(".more-end")).toBeNull();
    doc = await render(Gallery, { entries: PAGE, next: null, older: false });
    expect(doc.querySelector("a.more")).toBeNull();
    expect(text(doc.querySelector(".more-end"))).toBe("that's every entry.");
  });

  test("an older page links back to the newest entries, and one past the oldest post says that's every entry, not that nothing is up", async () => {
    let doc = await render(Gallery, { entries: PAGE, next: null, older: true });
    expect(text(doc.querySelector(".where"))).toBe("back to the logbook · newest entries");
    expect(doc.querySelector('.where a[href="/photos"]')).not.toBeNull();
    doc = await render(Gallery, { entries: [], next: null, older: true });
    expect(text(doc.querySelector(".more-end"))).toBe("that's every entry.");
    expect(doc.querySelector(".empty")).toBeNull();
  });

  test("with nothing published, the entries row says so, with no pager", async () => {
    const doc = await render(Gallery, { entries: [], next: null, older: false });
    expect(text(doc.querySelector("#entries .empty"))).toBe("no photos up yet.");
    expect(doc.querySelector("ol.entries")).toBeNull();
    expect(doc.querySelector(".more-end")).toBeNull();
  });

  test("when D1 fails, only the head row renders, saying so", async () => {
    const doc = await render(Gallery, { entries: null, next: null, older: false });
    expect(labels(doc)).toEqual(["photos of"]);
    expect(text(doc.querySelector(".down"))).toBe("photos aren't loading right now. try again in a bit.");
  });

  test("a title is text, never markup", async () => {
    const doc = await render(Gallery, { entries: [entry("t", "2025-02-02", null, ["t-01"], { title: '<b>dawn</b> & "co"' })], next: null, older: false });
    expect(doc.querySelector("ol.entries img")!.getAttribute("alt")).toBe('<b>dawn</b> & "co"');
    expect(doc.querySelector("ol.entries b")).toBeNull();
  });
});
