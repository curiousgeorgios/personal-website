import { expect, test } from "vitest";
import { ANTARCTICA, COMBINATIONS, drifted, LANDMARKS, marginFor, verdict } from "../../src/lib/prints/margin";

test("every size in the table, unframed and oak: thirty combinations", () => {
  expect(COMBINATIONS).toHaveLength(30);
  expect(COMBINATIONS.slice(0, 2).map((combination) => `${combination.family} ${combination.tier} ${combination.size.size} ${combination.frame}`)).toEqual(["2:3 small x8x12 unframed", "2:3 small x8x12 oak"]);
});

test("the margin: production at the rate plus 3%, the worst card fee, any freight shortfall, out of the price", () => {
  expect(marginFor({ priceCents: 5900, productionUsdCents: 1500, freightUsdCents: 2000, rate: 1.5, buffer: 0.08 })).toEqual({
    productionAud: 2318, cardFee: 237, deliveryAud: 3300, shortfall: 0, margin: 3345, share: 3345 / 5900,
  });
  // No buffer: the card fee on delivery and 3% exchange come out of the margin
  expect(marginFor({ priceCents: 5900, productionUsdCents: 1500, freightUsdCents: 2000, rate: 1.5, buffer: 0 })).toMatchObject({ shortfall: 195, margin: 3150 });
});

test("destination taxes ride on the delivery line, so their card fee and exchange count in the shortfall too", () => {
  const taxes = [{ field: "usSalesTax", label: "us sales tax", cents: 420 }];
  // Delivery: ceil(24.20 × 1.5) = $37; cost: 2420 × 1.545 = 3739 plus 3.5% of 3700 = 130, so 169 short
  expect(marginFor({ priceCents: 5900, productionUsdCents: 1500, freightUsdCents: 2000, taxes, rate: 1.5, buffer: 0 })).toMatchObject({ deliveryAud: 3700, shortfall: 169, margin: 3176 });
  // With the buffer, delivery covers it all
  expect(marginFor({ priceCents: 5900, productionUsdCents: 1500, freightUsdCents: 2000, taxes, rate: 1.5, buffer: 0.08 })).toMatchObject({ deliveryAud: 4000, shortfall: 0, margin: 3345 });
});

test("under 15% fails, under 30% warns", () => {
  expect(verdict(marginFor({ priceCents: 5900, productionUsdCents: 4000, freightUsdCents: 3000, rate: 1.5, buffer: 0.08 }).share)).toBe("fail");
  expect(verdict(marginFor({ priceCents: 5900, productionUsdCents: 2600, freightUsdCents: 3000, rate: 1.5, buffer: 0.08 }).share)).toBe("warn");
  expect(verdict(0.3)).toBe("ok");
  expect(verdict(0.15)).toBe("warn");
});

test("the thresholds sit exactly at 15% and 30%, and a loss fails", () => {
  expect([0.1499, 0.15, 0.2999, 0.3, -0.2].map(verdict)).toEqual(["fail", "warn", "warn", "ok", "fail"]);
  // A 5% drift either way is still within the catalogue; just past it isn't
  expect([drifted(6300, 6000), drifted(5700, 6000), drifted(6301, 6000), drifted(5699, 6000)]).toEqual([false, false, true, true]);
});

test("a quote drifts when it differs from the catalogue's costs by more than 5%", () => {
  expect(drifted(7000, 6000)).toBe(true);
  expect(drifted(6300, 6000)).toBe(false);
  expect(drifted(5600, 6000)).toBe(true);
});

test("the landmark addresses are public places in australia, the us and britain, with antarctica for the refusal", () => {
  expect(LANDMARKS.map((landmark) => [landmark.label, landmark.address.country])).toEqual([
    ["sydney opera house", "AU"], ["parliament house darwin", "AU"], ["the white house", "US"], ["iolani palace", "US"], ["10 downing street", "GB"],
  ]);
  expect(ANTARCTICA.country).toBe("AQ");
});
