import { describe, expect, test } from "vitest";
import { breakdown, deliveryAmount, deliveryLabel, readOrderCosts } from "../../src/lib/prints/quote";

describe("readOrderCosts", () => {
  test("freight is arteloShipping; every tax field is kept with its label, known ones first", () => {
    const costs = readOrderCosts({ productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, gst: 0, hst: 0, pst: 0, total: 114.2 });
    expect(costs).toEqual({ freightCents: 3000, productionCents: 8000, taxes: [{ field: "usSalesTax", label: "us sales tax", cents: 420 }], unknown: [] });
  });

  test("canadian taxes and any field that looks like a tax are passed on; other new charges are named for the log", () => {
    const costs = readOrderCosts({ arteloShipping: 25, gst: 1.25, pst: 1.75, importVat: 2, customsDuty: 0.5, branding: 0, holidayFees: 0, packagingFee: 1 })!;
    expect(costs.taxes).toEqual([
      { field: "gst", label: "canadian gst", cents: 125 },
      { field: "pst", label: "canadian pst", cents: 175 },
      { field: "customsDuty", label: "customsduty", cents: 50 },
      { field: "importVat", label: "importvat", cents: 200 },
    ]);
    expect(costs.unknown).toEqual(["packagingFee"]);
  });

  test("an answer without a usable arteloShipping can't be quoted", () => {
    for (const value of [null, [], {}, { arteloShipping: "30" }, { arteloShipping: -1 }, { arteloShipping: Number.NaN }]) expect(readOrderCosts(value)).toBeNull();
  });
});

describe("deliveryAmount", () => {
  test("freight and tax, converted, plus the buffer, rounded up to the dollar (spec 16.1 and 23.2)", () => {
    expect(deliveryAmount(3000, [], 1.5, 0.08)).toBe(4900);
    expect(deliveryAmount(3000, [{ field: "usSalesTax", label: "us sales tax", cents: 420 }], 1.5, 0.08)).toBe(5600);
  });

  test("an exact dollar stays that dollar, whatever floating point does", () => {
    expect(deliveryAmount(2500, [], 1.6, 0)).toBe(4000);
  });

  test("anything over a dollar rounds up to the next", () => {
    // 10 × 1.1 × 1.1 is 12.1
    expect(deliveryAmount(1000, [], 1.1, 0.1)).toBe(1300);
  });
});

describe("labels and the breakdown", () => {
  const tax = [{ field: "usSalesTax", label: "us sales tax", cents: 420 }];

  test("the line names destination taxes only when there are any", () => {
    expect(deliveryLabel([])).toBe("delivery");
    expect(deliveryLabel(tax)).toBe("delivery and destination taxes");
  });

  test("the breakdown says what artelo charged and how it became dollars", () => {
    expect(breakdown({ freightCents: 3000, taxes: [], rate: 1.5, buffer: 0.08 })).toBe(
      "artelo's freight us$30.00 for this address, converted at a$1.50 per us$1, plus 8% in case the exchange rate moves, rounded up to the dollar.",
    );
    expect(breakdown({ freightCents: 3000, taxes: tax, rate: 1.5, buffer: 0.08 })).toBe(
      "artelo's freight us$30.00 and us sales tax us$4.20 for this address, converted at a$1.50 per us$1, plus 8% in case the exchange rate moves, rounded up to the dollar. artelo charges me that tax for posting to this address, so it's passed on at cost.",
    );
  });

  test("several taxes are listed without an oxford comma; no buffer leaves its clause out", () => {
    const text = breakdown({ freightCents: 2500, taxes: [{ field: "gst", label: "canadian gst", cents: 125 }, { field: "pst", label: "canadian pst", cents: 175 }], rate: 1.5237, buffer: 0 });
    expect(text).toBe(
      "artelo's freight us$25.00, canadian gst us$1.25 and canadian pst us$1.75 for this address, converted at a$1.5237 per us$1, rounded up to the dollar. artelo charges me those taxes for posting to this address, so they're passed on at cost.",
    );
  });
});
