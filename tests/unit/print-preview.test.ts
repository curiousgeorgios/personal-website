import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { FAMILIES, printsFor, TIERS } from "../../src/lib/prints/catalogue";
import { CM_PER_INCH, familyClass, ppiAt, FRAME_FACE_CM, ORIGIN_CM, previewArea, previewChoice, previewSizes, rulerMarks, trimNote } from "../../src/lib/prints/preview";

// One master per ratio family, each sharp enough for all three of its sizes, upright and on its side
const MASTERS: Record<string, [number, number]> = { "2:3": [4000, 6000], "3:4": [4284, 5712], "4:5": [4000, 5000], "iso a": [4000, 5657], "1:1": [4000, 4000] };
const nbsp = (text: string) => text.replace(/ /g, " ");

describe("the preview's sizes", () => {
  test("every family's tiers, short side across a portrait and along a landscape, in the order the row offers them", () => {
    for (const family of FAMILIES) {
      const [w, h] = MASTERS[family.name];
      const upright = printsFor(w, h)!;
      expect(upright.family).toBe(family.name);
      const portrait = previewSizes(upright, w, h);
      expect(portrait.map((size) => size.tier)).toEqual(TIERS);
      for (const size of portrait) expect([size.width, size.height]).toEqual([family.tiers[size.tier].short, family.tiers[size.tier].long]);
      if (family.name === "1:1") continue;
      const sideways = printsFor(h, w)!;
      expect(sideways.orientation).toBe("Horizontal");
      for (const size of previewSizes(sideways, h, w)) expect([size.width, size.height]).toEqual([family.tiers[size.tier].long, family.tiers[size.tier].short]);
    }
  });

  test("each larger tier is larger on both sides, so the drawing grows as the size goes up", () => {
    for (const family of FAMILIES) {
      const [w, h] = MASTERS[family.name];
      const sizes = previewSizes(printsFor(w, h)!, w, h);
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i].width).toBeGreaterThan(sizes[i - 1].width);
        expect(sizes[i].height).toBeGreaterThan(sizes[i - 1].height);
      }
    }
  });

  test("names the print's own dimensions, width first, in centimetres and inches", () => {
    const upright = previewSizes(printsFor(4000, 6000)!, 4000, 6000).map((size) => nbsp(size.dimensions));
    expect(upright).toEqual([
      "the print: 20 cm wide, 30 cm tall (8 × 12 in)",
      "the print: 30 cm wide, 46 cm tall (12 × 18 in)",
      "the print: 41 cm wide, 61 cm tall (16 × 24 in)",
    ]);
    expect(nbsp(previewSizes(printsFor(6000, 4000)!, 6000, 4000)[1].dimensions)).toBe("the print: 46 cm wide, 30 cm tall (18 × 12 in)");
    expect(nbsp(previewSizes(printsFor(4000, 5657)!, 4000, 5657)[0].dimensions)).toBe("the print: 21 cm wide, 30 cm tall (8.3 × 11.7 in)");
  });

  test("a photo with one size gets one", () => {
    const prints = printsFor(2048, 2048)!;
    expect(previewSizes(prints, 2048, 2048).map((size) => [size.tier, size.width, size.height])).toEqual([["small", 10, 10]]);
  });
});

describe("the pixels per inch", () => {
  test("is the lesser side's density when the master fills the paper, rounded down, and at least 200 for every size offered", () => {
    expect(ppiAt(3648, 5472, FAMILIES[0].tiers.large)).toBe(228);
    expect(ppiAt(5472, 3648, FAMILIES[0].tiers.large)).toBe(228);
    // 4:5 on 11 × 14 trims the width, so the height sets the density: 5000 / 14 = 357.1, not 4000 / 11 = 363.6
    expect(ppiAt(4000, 5000, FAMILIES[2].tiers.medium)).toBe(357);
    for (const [w, h] of [[3648, 5472], [3024, 4032], [2858, 3811], [2194, 3291], [1660, 2340], [2048, 2048], [4000, 5657]]) {
      const prints = printsFor(w, h);
      for (const size of prints ? previewSizes(prints, w, h) : []) expect(size.ppi, `${w} × ${h} ${size.tier}`).toBeGreaterThanOrEqual(200);
    }
  });
});

describe("the trim", () => {
  test("none when the photo has the paper's shape", () => {
    expect(trimNote(4000, 6000, FAMILIES[0].tiers.medium)).toBeNull();
    expect(trimNote(4000, 4000, FAMILIES[4].tiers.small)).toBeNull();
  });

  test("a squarer photo loses a little of its short side; the axis follows the orientation", () => {
    // 4:5 on 11 × 14: 1 - 1.25 / 1.2727 = 1.8%
    expect(trimNote(4000, 5000, FAMILIES[2].tiers.medium)).toBe("trims 1.8% of the photo's width, evenly from both sides");
    expect(trimNote(5000, 4000, FAMILIES[2].tiers.medium)).toBe("trims 1.8% of the photo's height, evenly from top and bottom");
  });

  test("a longer photo loses a little of its long side", () => {
    // 1.36 on 3:4 (1.333): 2.0%
    expect(trimNote(3000, 4080, FAMILIES[1].tiers.small)).toBe("trims 2.0% of the photo's height, evenly from top and bottom");
    expect(trimNote(4080, 3000, FAMILIES[1].tiers.small)).toBe("trims 2.0% of the photo's width, evenly from both sides");
  });

  test("never more than the catalogue's 3% for a size it offers", () => {
    for (const [w, h] of [[3648, 5472], [3024, 4032], [2858, 3811], [4000, 5100], [4100, 5657]]) {
      for (const size of previewSizes(printsFor(w, h)!, w, h)) {
        const share = Number(size.trim?.match(/trims ([\d.]+)%/)?.[1] ?? 0);
        expect(share).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("the drawing area and rulers", () => {
  test("holds every family's largest print with its frame, the same for every photo of an orientation", () => {
    const vertical = previewArea("Vertical");
    const horizontal = previewArea("Horizontal");
    expect([horizontal.width, horizontal.height]).toEqual([vertical.height, vertical.width]);
    for (const family of FAMILIES) {
      const { short, long } = family.tiers.large;
      expect(ORIGIN_CM + short * CM_PER_INCH + FRAME_FACE_CM).toBeLessThanOrEqual(vertical.width);
      expect(ORIGIN_CM + long * CM_PER_INCH + FRAME_FACE_CM).toBeLessThanOrEqual(vertical.height);
    }
  });

  test("numbers every 10 cm from the paper's corner", () => {
    expect(rulerMarks(previewArea("Vertical").width)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(rulerMarks(previewArea("Vertical").height)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  test("the caption's choice line", () => {
    expect(previewChoice("medium", "oak", "$179")).toBe("medium · oak frame · $179");
    expect(previewChoice("small", "unframed", "$59")).toBe("small · unframed · $59");
  });
});

// The page's CSP allows no style attributes, so the drawing's sizes are in prints.css by family. These hold the
// stylesheet to the catalogue and to preview.ts, so a change to one without the other fails here
describe("prints.css", () => {
  const css = readFileSync(new URL("../../src/styles/prints.css", import.meta.url), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} in prints.css`).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
  };

  test("gives each family its catalogue sizes in inches", () => {
    for (const family of FAMILIES) {
      const vars = rule(`.${familyClass(family.name)}`);
      for (const tier of TIERS) {
        expect(Number(vars[`${tier}-s`]), `${family.name} ${tier}`).toBe(family.tiers[tier].short);
        expect(Number(vars[`${tier}-l`]), `${family.name} ${tier}`).toBe(family.tiers[tier].long);
      }
    }
  });

  test("draws the area, the paper's corner and the frame's face at preview.ts's sizes", () => {
    for (const orientation of ["Vertical", "Horizontal"] as const) {
      const vars = rule(`.preview-stage.${orientation.toLowerCase()}`);
      expect([Number(vars["area-w"]), Number(vars["area-h"])]).toEqual(Object.values(previewArea(orientation)));
    }
    const stage = rule(".preview-stage");
    expect(Number(stage.origin)).toBe(ORIGIN_CM);
    expect(Number(stage.face)).toBe(FRAME_FACE_CM);
  });

  test("follows every size and frame radio, and holds still for reduced motion", () => {
    for (const value of [...TIERS, "unframed", "oak"]) expect(css).toContain(`.print-form:has([name="${value === "unframed" || value === "oak" ? "frame" : "size"}"][value="${value}"]:checked)`);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.preview-print, \.preview-print::before, \.preview-print::after \{ transition: none; \}/);
    // The caption's alternatives share a grid cell and wait invisibly rather than leaving the layout, so a longer line
    // (a trim note on one size only) can't move the radios and button below when the choice changes
    expect(css).toMatch(/\.preview-caption \{[^}]*display: grid;[^}]*\}/);
    expect(css).toMatch(/\.preview-caption \.preview-choice \{ grid-area: 1 \/ 1;/);
    expect(css).toMatch(/\.preview-caption \.preview-size \{ grid-area: 2 \/ 1; \}/);
    expect(css).toMatch(/\.preview-caption \[data-frame="unframed"\] \{ visibility: hidden; \}/);
    expect(css).not.toMatch(/\.preview-caption [^{]*\{ display: none; \}/);
    // Hidden unless the browser has :has(), so a browser without it never shows a preview that ignores the radios
    expect(css).toMatch(/\.print-preview \{ display: none;[^}]*\}\s*@supports selector\(:has\(a\)\) \{ \.print-preview \{ display: block; \} \}/);
  });
});
