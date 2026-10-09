// Print sizes and which photographs get them (spec 14.1). Every print is Artelo's IndividualArtPrint on
// ArchivalMatteFineArt paper, unframed or in its standard oak frame, and every size here is one Artelo frames.

export type Tier = "small" | "medium" | "large";
export type Frame = "unframed" | "oak";
export type Orientation = "Vertical" | "Horizontal";
export const TIERS: readonly Tier[] = ["small", "medium", "large"];
export const FRAMES: readonly Frame[] = ["unframed", "oak"];
export const isTier = (value: string): value is Tier => (TIERS as readonly string[]).includes(value);
export const isFrame = (value: string): value is Frame => (FRAMES as readonly string[]).includes(value);

/** An Artelo ProductSize: inches, short side first (x12x18; x8dot3x11dot7 is 8.3 × 11.7) */
export interface PrintSize {
  size: string;
  short: number;
  long: number;
}

export function parseSize(name: string): PrintSize {
  const [short, long] = name.slice(1).split("x").map((part) => Number(part.replace("dot", ".")));
  return { size: name, short, long };
}

/**
 * Each ratio family's three tiers: the frameable Artelo size of that ratio whose area is nearest the A size the price
 * list names (A4 96.7, A3 193.4, A2 386.9 square inches). The page calls them small, medium and large, because true A
 * sizes would crop every 2:3 photograph by about 6%.
 */
export const FAMILIES: readonly { name: string; ratio: number; tiers: Record<Tier, PrintSize> }[] = [
  { name: "2:3", ratio: 1.5, tiers: { small: parseSize("x8x12"), medium: parseSize("x12x18"), large: parseSize("x16x24") } },
  { name: "3:4", ratio: 4 / 3, tiers: { small: parseSize("x9x12"), medium: parseSize("x12x16"), large: parseSize("x18x24") } },
  { name: "4:5", ratio: 1.25, tiers: { small: parseSize("x8x10"), medium: parseSize("x11x14"), large: parseSize("x16x20") } },
  { name: "iso a", ratio: Math.SQRT2, tiers: { small: parseSize("x8dot3x11dot7"), medium: parseSize("x11dot7x16dot5"), large: parseSize("x16dot5x23dot4") } },
  { name: "1:1", ratio: 1, tiers: { small: parseSize("x10x10"), medium: parseSize("x12x12"), large: parseSize("x20x20") } },
];

export const CROP_TOLERANCE = 0.03;
export const MIN_PPI = 200;

/** The share of the long side cut away when a photograph of ratio r fills a print of ratio p edge to edge */
export const crop = (r: number, p: number) => 1 - Math.min(r, p) / Math.max(r, p);

/** At least MIN_PPI pixels per inch, compared in tenths of an inch so an exact 200 (1660 px on 8.3 in) isn't lost to float drift */
const sharpEnough = (pixels: number, inches: number) => pixels * 10 >= MIN_PPI * Math.round(inches * 10);

export interface Offer {
  tier: Tier;
  size: PrintSize;
}
export interface PhotoPrints {
  family: string;
  orientation: Orientation;
  offers: Offer[];
}

/** The sizes a master of width × height pixels prints at, or null when it gets none (spec 14.1) */
export function printsFor(width: number, height: number): PhotoPrints | null {
  if (!(width > 0 && height > 0)) return null;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const r = long / short;
  const family = [...FAMILIES].sort((a, b) => crop(r, a.ratio) - crop(r, b.ratio))[0];
  if (crop(r, family.ratio) > CROP_TOLERANCE) return null;
  const offers = TIERS.flatMap((tier): Offer[] => {
    const print = family.tiers[tier];
    const fits = crop(r, print.long / print.short) <= CROP_TOLERANCE && sharpEnough(short, print.short) && sharpEnough(long, print.long);
    return fits ? [{ tier, size: print }] : [];
  });
  return offers.length > 0 ? { family: family.name, orientation: width > height ? "Horizontal" : "Vertical", offers } : null;
}

export const offerFor = (prints: PhotoPrints | null, tier: Tier): Offer | undefined => prints?.offers.find((offer) => offer.tier === tier);

const cm = (inches: number) => Math.round(inches * 2.54);
/** 12 × 18 in */
export const sizeInches = (size: PrintSize) => `${size.short} × ${size.long} in`;
/** small · 8 × 12 in (20 × 30 cm) */
export const sizeLabel = (offer: Offer) => `${offer.tier} · ${sizeInches(offer.size)} (${cm(offer.size.short)} × ${cm(offer.size.long)} cm)`;
export const frameLabel = (frame: Frame) => (frame === "oak" ? "oak frame" : "unframed");
/** medium · 12 × 18 in · oak frame */
export const printLine = (tier: Tier, size: PrintSize, frame: Frame) => `${tier} · ${sizeInches(size)} · ${frameLabel(frame)}`;
