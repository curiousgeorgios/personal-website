import { describe, expect, test } from "vitest";
import PhotoView from "../../src/components/photos/PhotoView.astro";
import type { PhotoPage, PublicPhoto } from "../../src/lib/photos/store";
import { render, text } from "./render";

const photo = (over: Partial<PublicPhoto> = {}): PublicPhoto => ({
  id: "DFkL1xrsnOH-02", collection: "DFkL1xrsnOH", title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2025-02-02", place: "bondi, sydney",
  previews: [960, 1600].flatMap((size) => (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/DFkL1xrsnOH-02/s/${size}.${format}`, width: Math.round((size * 2) / 3), height: size, format }))),
  ...over,
});
const page = (over: Partial<PhotoPage> = {}): PhotoPage => ({ photo: photo(), publishedAt: 1738488468, index: 1, total: 14, previous: "DFkL1xrsnOH-01", next: "DFkL1xrsnOH-03", ...over });

describe("PhotoView", () => {
  test("an untitled photo is headed by its date and place, and walks its post", async () => {
    const doc = await render(PhotoView, { page: page() });
    expect([...doc.querySelectorAll(".row > .label")].map(text)).toEqual(["photo", "say hi"]);
    expect(text(doc.querySelector("h1"))).toBe("02.02.25 · bondi, sydney");
    expect(doc.querySelector(".where")).toBeNull();
    expect(text(doc.querySelector(".photo-nav"))).toBe("photo 2 of 14 · previous · next · the whole entry");
    expect(doc.querySelector('a[rel="prev"]')!.getAttribute("href")).toBe("/photos/DFkL1xrsnOH-01");
    expect(doc.querySelector('a[rel="next"]')!.getAttribute("href")).toBe("/photos/DFkL1xrsnOH-03");
    expect([...doc.querySelectorAll(".photo-nav a")].at(-1)!.getAttribute("href")).toBe("/photos?before=1738488469#post-DFkL1xrsnOH");
  });

  test("the picture is eager and high priority, sized by the 1600 preview and its ratio", async () => {
    const doc = await render(PhotoView, { page: page() });
    const img = doc.querySelector(".photo img")!;
    expect(["alt", "width", "height", "loading", "fetchpriority", "src"].map((name) => img.getAttribute(name))).toEqual([
      "photo 2 of 14 from 2 february 2025, bondi, sydney", "1067", "1600", "eager", "high", "/media/photos/previews/DFkL1xrsnOH-02/s/960.webp",
    ]);
    expect(img.getAttribute("sizes")).toBe("(max-width: 679px) min(calc(100vw - 48px), calc(82svh * 0.6667)), min(710px, calc(82svh * 0.6667))");
    expect(img.getAttribute("srcset")).toBe("/media/photos/previews/DFkL1xrsnOH-02/s/960.webp 640w, /media/photos/previews/DFkL1xrsnOH-02/s/1600.webp 1067w");
    expect(doc.querySelector(".photo source")!.getAttribute("type")).toBe("image/avif");
  });

  test("a titled photo leads with its title, with the date and place under it; the ends of a post have one neighbour", async () => {
    const doc = await render(PhotoView, { page: page({ photo: photo({ title: "the long jetty" }), index: 0, total: 2, previous: null, next: "DFkL1xrsnOH-03" }) });
    expect(text(doc.querySelector("h1"))).toBe("the long jetty");
    expect(text(doc.querySelector(".where"))).toBe("02.02.25 · bondi, sydney");
    expect(text(doc.querySelector(".photo-nav"))).toBe("photo 1 of 2 · next · the whole entry");
    expect(doc.querySelector('a[rel="prev"]')).toBeNull();
  });

  test("a title is text, never markup", async () => {
    const doc = await render(PhotoView, { page: page({ photo: photo({ title: '<b>dawn</b> & "co"' }) }) });
    expect(text(doc.querySelector("h1"))).toBe('<b>dawn</b> & "co"');
    expect(doc.querySelector("h1 b")).toBeNull();
    expect(doc.querySelector(".photo img")!.getAttribute("alt")).toBe('<b>dawn</b> & "co"');
  });
});
