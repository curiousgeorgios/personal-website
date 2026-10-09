import { describe, expect, test } from "vitest";
import { crop, offerFor, parseSize, printLine, printsFor, sizeLabel } from "../../src/lib/prints/catalogue";

const tiers = (width: number, height: number) => printsFor(width, height)?.offers.map((offer) => `${offer.tier} ${offer.size.size}`) ?? null;

describe("printsFor", () => {
  test("the real dimension classes of spec 14.1", () => {
    expect(tiers(3648, 5472)).toEqual(["small x8x12", "medium x12x18", "large x16x24"]);
    expect(tiers(3024, 4032)).toEqual(["small x9x12", "medium x12x16"]);
    expect(tiers(6048, 8064)).toEqual(["small x9x12", "medium x12x16", "large x18x24"]);
    expect(tiers(2194, 3291)).toEqual(["small x8x12"]);
    expect(tiers(2048, 2048)).toEqual(["small x10x10"]);
    expect(tiers(3575, 4172)).toBeNull();
    expect(tiers(1756, 3097)).toBeNull();
  });

  test("the crop tolerance is 3%: 2.9% gets prints, 3.1% doesn't", () => {
    expect(crop(6179 / 4000, 1.5)).toBeCloseTo(0.029, 3);
    expect(tiers(4000, 6179)).toEqual(["small x8x12", "medium x12x18", "large x16x24"]);
    expect(crop(6192 / 4000, 1.5)).toBeCloseTo(0.031, 3);
    expect(tiers(4000, 6192)).toBeNull();
  });

  test("the family is the one that crops least, and each size still checks its own crop", () => {
    expect(printsFor(4000, 5000)?.family).toBe("4:5");
    // x11x14 is 1.273, so a 4:5 photograph's medium crops 1.8% and qualifies
    expect(tiers(4000, 5000)).toEqual(["small x8x10", "medium x11x14", "large x16x20"]);
    expect(printsFor(4200, 5940)?.family).toBe("iso a");
  });

  test("a print needs 200 pixels per inch on both sides", () => {
    // 3200 / 16 is exactly 200: large qualifies; one pixel less and it doesn't
    expect(tiers(3200, 4800)).toContain("large x16x24");
    expect(tiers(3199, 4800)).not.toContain("large x16x24");
  });

  test("an exact 200 pixels per inch on an ISO size isn't lost to float drift", () => {
    // 1660 / 8.3 is 199.99999999999997 in floating point, but it is exactly 200 ppi
    expect(1660 / 8.3).toBeLessThan(200);
    expect(tiers(1660, 2340)).toEqual(["small x8dot3x11dot7"]);
    expect(tiers(1659, 2340)).toBeNull();
    expect(tiers(1660, 2339)).toBeNull();
  });

  test("portraits and squares print vertical, landscapes horizontal", () => {
    expect(printsFor(4000, 6000)?.orientation).toBe("Vertical");
    expect(printsFor(2048, 2048)?.orientation).toBe("Vertical");
    expect(printsFor(6000, 4000)?.orientation).toBe("Horizontal");
    expect(tiers(6000, 4000)).toEqual(tiers(4000, 6000));
  });

  test("nothing for an empty or nonsense size", () => {
    expect(printsFor(0, 100)).toBeNull();
    expect(printsFor(Number.NaN, 100)).toBeNull();
  });
});

describe("labels", () => {
  test("both units, rounded to whole centimetres; the ISO sizes keep their decimal", () => {
    expect(sizeLabel(offerFor(printsFor(4000, 6000), "small")!)).toBe("small · 8 × 12 in (20 × 30 cm)");
    expect(sizeLabel(offerFor(printsFor(4000, 6000), "large")!)).toBe("large · 16 × 24 in (41 × 61 cm)");
    expect(sizeLabel({ tier: "small", size: parseSize("x8dot3x11dot7") })).toBe("small · 8.3 × 11.7 in (21 × 30 cm)");
    expect(printLine("medium", parseSize("x12x18"), "oak")).toBe("medium · 12 × 18 in · oak frame");
    expect(printLine("small", parseSize("x8x12"), "unframed")).toBe("small · 8 × 12 in · unframed");
  });
});
