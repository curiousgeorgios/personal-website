import { describe, expect, test } from "vitest";
import { dateAndPlace, EAGER_FRAMES, frameNumber, frameSizes, frameView, longDate, photoAlt, photoName, photoSizes, previewOf, srcsetOf } from "../../src/lib/photos/gallery";
import type { PublicPhoto } from "../../src/lib/photos/store";

const ID = "DFkL1xrsnOH-02";
const preview = (size: number, format: "webp" | "avif", width: number, height: number) => ({ url: `/media/photos/previews/${ID}/s/${size}.${format}`, width, height, format });
const portrait = (over: Partial<PublicPhoto> = {}): PublicPhoto => ({
  id: ID, collection: "DFkL1xrsnOH", title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2025-02-02", place: "bondi, sydney",
  previews: [preview(240, "webp", 160, 240), preview(240, "avif", 160, 240), preview(480, "webp", 320, 480), preview(480, "avif", 320, 480)],
  ...over,
});

describe("dates and names", () => {
  test("a post's date in words and in the log's format, with its place when known", () => {
    expect(longDate("2025-02-02")).toBe("2 february 2025");
    expect(longDate("2026-12-31")).toBe("31 december 2026");
    expect(dateAndPlace("2025-02-02", "bondi, sydney")).toBe("02.02.25 · bondi, sydney");
    expect(dateAndPlace("2025-02-02", null)).toBe("02.02.25");
  });

  test("a frame's number is its slide number, three digits included", () => {
    expect(frameNumber("DFkL1xrsnOH-02")).toBe("02");
    expect(frameNumber("a-b_c-100")).toBe("100");
  });

  test("alt text is the title when there is one, otherwise which photo of the post it is", () => {
    expect(photoAlt(portrait(), 1, 14)).toBe("photo 2 of 14 from 2 february 2025, bondi, sydney");
    expect(photoAlt(portrait({ place: null }), 0, 1)).toBe("photo 1 of 1 from 2 february 2025");
    expect(photoAlt(portrait({ title: '<b>dawn</b> & "co"' }), 0, 1)).toBe('<b>dawn</b> & "co"');
  });
});

describe("frames", () => {
  test("sizes are the frame's rendered width: 120px tall, 88px at the notebook's phone breakpoint", () => {
    expect(frameSizes(160, 240)).toBe("(max-width: 680px) 59px, 80px");
    expect(frameSizes(240, 160)).toBe("(max-width: 680px) 132px, 180px");
  });

  test("srcsets describe each preview by its real width", () => {
    expect(srcsetOf(portrait(), [240, 480], "avif")).toBe(`/media/photos/previews/${ID}/s/240.avif 160w, /media/photos/previews/${ID}/s/480.avif 320w`);
    expect(previewOf(portrait(), 480, "webp")?.width).toBe(320);
    expect(previewOf(portrait(), 960, "webp")).toBeUndefined();
  });

  test("a frame's view holds everything its markup needs, sized by the 240 preview", () => {
    expect(frameView(portrait(), 1, 14)).toEqual({
      href: `/photos/${ID}`,
      avif: `/media/photos/previews/${ID}/s/240.avif 160w, /media/photos/previews/${ID}/s/480.avif 320w`,
      webp: `/media/photos/previews/${ID}/s/240.webp 160w, /media/photos/previews/${ID}/s/480.webp 320w`,
      phoneAvif: `/media/photos/previews/${ID}/s/240.avif 160w`,
      phoneWebp: `/media/photos/previews/${ID}/s/240.webp 160w`,
      src: `/media/photos/previews/${ID}/s/240.webp`,
      sizes: "(max-width: 680px) 59px, 80px",
      width: 160,
      height: 240,
      alt: "photo 2 of 14 from 2 february 2025, bondi, sydney",
      number: "02",
    });
    expect(frameView(portrait({ previews: portrait().previews.slice(2) }), 0, 1)).toBeNull();
    expect(EAGER_FRAMES).toBe(8);
  });
});

describe("the photo page", () => {
  test("sizes follow the photograph's ratio under the 82svh cap", () => {
    expect(photoSizes(4000, 6000)).toBe("(max-width: 679px) min(calc(100vw - 48px), calc(82svh * 0.6667)), min(710px, calc(82svh * 0.6667))");
    expect(photoSizes(6000, 4000)).toBe("(max-width: 679px) min(calc(100vw - 48px), calc(82svh * 1.5)), min(710px, calc(82svh * 1.5))");
  });

  test("a photograph's name is its title in quotes, or which photo of the post it is", () => {
    expect(photoName(portrait({ title: "the long jetty" }), 0, 1)).toBe('"the long jetty"');
    expect(photoName(portrait(), 1, 14)).toBe("photo 2 of 14 from 02.02.25");
  });
});
