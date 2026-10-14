import { crop, FAMILIES, frameLabel, type Frame, type Orientation, type PhotoPrints, type Tier } from "./catalogue";

// The print row's preview (spec 15.1 as amended): each size drawn to one scale against a centimetre ruler, unframed or
// in oak. Pure, so the component and the tests share it. The drawing's per-family sizes live in prints.css too, because
// the page's CSP allows no style attributes; a unit test holds the two to the same numbers.

export const CM_PER_INCH = 2.54;

/**
 * The oak frame's face as drawn, in centimetres. Illustrative: Artelo's framing page lists a standard oak profile of
 * 1.4 × 1.6 cm and a premium one of 1.8 × 2.6 cm, but we have not verified which one our NaturalOak payload selects, how
 * much of the paper the frame's lip covers or the outer size. So the drawing shows the paper at its exact size and the
 * frame around it, and the page names no outer dimensions.
 */
export const FRAME_FACE_CM = 1.5;
/** Between the frame's outer edge and the rulers, and above and right of the largest framed print */
export const GAP_CM = 1;
export const HEADROOM_CM = 2;
/** The paper's bottom-left corner sits this far from the rulers, where they read 0 */
export const ORIGIN_CM = GAP_CM + FRAME_FACE_CM;
/** A labelled tick every 10 cm */
export const RULER_STEP_CM = 10;

/** The drawing area in whole centimetres: the same for every photograph of an orientation, so a size looks the same on every page */
export function previewArea(orientation: Orientation): { width: number; height: number } {
  const sizes = FAMILIES.flatMap((family) => Object.values(family.tiers));
  const side = (inches: number) => Math.ceil(ORIGIN_CM + inches * CM_PER_INCH + FRAME_FACE_CM + HEADROOM_CM);
  const short = side(Math.max(...sizes.map((size) => size.short)));
  const long = side(Math.max(...sizes.map((size) => size.long)));
  return orientation === "Horizontal" ? { width: long, height: short } : { width: short, height: long };
}

/** The ruler's numbers along a side of this many centimetres, from the paper's corner: 0, 10, 20 … */
export function rulerMarks(sideCm: number): number[] {
  return Array.from({ length: Math.floor((sideCm - ORIGIN_CM) / RULER_STEP_CM) + 1 }, (_, index) => index * RULER_STEP_CM);
}

/** The class that gives the drawing its family's sizes in prints.css: 2:3 is family-2-3, iso a is family-iso-a */
export const familyClass = (name: string) => `family-${name.replace(/[^a-z0-9]+/g, "-")}`;

const cm = (inches: number) => Math.round(inches * CM_PER_INCH);

export interface PreviewSize {
  tier: Tier;
  /** Inches as printed, width then height: a landscape's long side is its width */
  width: number;
  height: number;
  /** the print: 30 cm wide, 46 cm tall (12 × 18 in) */
  dimensions: string;
  /** How the photograph is trimmed to fill this paper, or null when it fits exactly */
  trim: string | null;
}

/**
 * The trim Artelo's Outside fit makes: the photograph fills the paper and the excess is cut evenly from both edges of
 * one axis. A photograph longer than the paper loses some of its long side; a squarer one some of its short side
 */
export function trimNote(photoWidth: number, photoHeight: number, print: { short: number; long: number }): string | null {
  const r = Math.max(photoWidth, photoHeight) / Math.min(photoWidth, photoHeight);
  const p = print.long / print.short;
  const share = crop(r, p);
  if (share < 0.0005) return null;
  const portrait = photoHeight >= photoWidth;
  // The long side is the height of a portrait or square and the width of a landscape
  const axis = r > p === portrait ? "height" : "width";
  return `trims ${(share * 100).toFixed(1)}% of the photo's ${axis}, evenly from ${axis === "height" ? "top and bottom" : "both sides"}`;
}

/** Every size the row offers, as the preview draws and describes it */
export function previewSizes(prints: PhotoPrints, photoWidth: number, photoHeight: number): PreviewSize[] {
  return prints.offers.map(({ tier, size }) => {
    const [width, height] = prints.orientation === "Horizontal" ? [size.long, size.short] : [size.short, size.long];
    return {
      tier,
      width,
      height,
      dimensions: `the print: ${cm(width)} cm wide, ${cm(height)} cm tall (${width}\u00a0×\u00a0${height}\u00a0in)`,
      trim: trimNote(photoWidth, photoHeight, size),
    };
  });
}

/** medium · oak frame · $179 */
export const previewChoice = (tier: Tier, frame: Frame, price: string) => `${tier} · ${frameLabel(frame)} · ${price}`;
