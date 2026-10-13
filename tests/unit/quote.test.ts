import { afterEach, describe, expect, test, vi } from "vitest";
import { breakdown, cents, deliveryAmount, deliveryLabel, readOrderCosts } from "../../src/lib/prints/quote";
import { captureLogs } from "./prints-fakes";

afterEach(() => vi.restoreAllMocks());

describe("readOrderCosts", () => {
  test("freight is arteloShipping; the four documented taxes are kept with their labels, known order, zeros dropped", () => {
    expect(readOrderCosts({ productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, gst: 0, hst: 0, pst: 0, total: 114.2 })).toEqual({
      freightCents: 3000, productionCents: 8000, taxes: [{ field: "usSalesTax", label: "us sales tax", cents: 420 }],
    });
    expect(readOrderCosts({ arteloShipping: 25, pst: 1.75, gst: 1.25, hst: 0.004 })!.taxes).toEqual([
      { field: "gst", label: "canadian gst", cents: 125 },
      { field: "pst", label: "canadian pst", cents: 175 },
    ]);
  });

  test("a total that adds up to its parts, with the other documented charges, is accepted within a cent", () => {
    expect(readOrderCosts({ productionCost: 80, arteloShipping: 25, gst: 1.25, pst: 1.75, branding: 2, holidayFees: 1, wholesaleDiscount: 3, total: 108 })).not.toBeNull();
    expect(readOrderCosts({ productionCost: 80, arteloShipping: 30, total: 110.01 })).not.toBeNull();
    expect(readOrderCosts({ productionCost: 80, arteloShipping: 30, amountRefunded: 0, total: 109.99 })).not.toBeNull();
  });

  test("an answer without a usable arteloShipping can't be quoted", () => {
    for (const value of [null, [], {}, { arteloShipping: "30" }, { arteloShipping: -1 }, { arteloShipping: Number.NaN }]) expect(readOrderCosts(value)).toBeNull();
  });

  test("a negative or non-finite amount in any field refuses the quote", () => {
    const logs = captureLogs();
    for (const extra of [{ usSalesTax: -4.2 }, { gst: -1 }, { productionCost: -80 }, { holidayFees: -1 }, { taxCredit: -50 }, { pst: Number.POSITIVE_INFINITY }, { total: Number.NaN }]) {
      expect(readOrderCosts({ arteloShipping: 30, ...extra })).toBeNull();
    }
    expect(logs()).toContain("usSalesTax is not a usable amount");
  });

  test("a recognised charge that isn't a number refuses the quote; a note or currency doesn't", () => {
    captureLogs();
    expect(readOrderCosts({ arteloShipping: 30, usSalesTax: "4.20" })).toBeNull();
    expect(readOrderCosts({ arteloShipping: 30, total: [] })).toBeNull();
    expect(readOrderCosts({ arteloShipping: 30, usSalesTax: null, currency: "USD", note: "hello" })).not.toBeNull();
  });

  test("any other numeric field is a charge this site doesn't know: it refuses, by name, instead of being guessed (totalTax, totalWithTax, heavyDutyBox)", () => {
    const logs = captureLogs();
    for (const field of ["totalTax", "totalWithTax", "heavyDutyBox", "taxRate", "importVat", "customsDuty", "remoteAreaFee", "elevatedShippingFee"]) {
      expect(readOrderCosts({ productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, total: 114.2, [field]: 4.2 })).toBeNull();
      expect(logs()).toContain(field);
    }
  });

  test("parts that don't reconcile with the total refuse the quote, and the mismatch is logged", () => {
    const logs = captureLogs();
    expect(readOrderCosts({ productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, total: 118.4 })).toBeNull();
    expect(readOrderCosts({ productionCost: 80, arteloShipping: 30, total: 110.02 })).toBeNull();
    expect(readOrderCosts({ productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, total: 110 })).toBeNull();
    expect(logs()).toContain("total 11840 against its parts 11420");
  });

  test("cents rounds to the nearest cent, not down", () => {
    expect(cents(1.15)).toBe(115);
    expect(cents(4.2)).toBe(420);
  });
});

describe("deliveryAmount", () => {
  test("freight and tax, converted, plus the buffer, rounded up to the dollar (spec 16.1 and 23.2)", () => {
    expect(deliveryAmount(3000, [], 1.5, 0.08)).toBe(4900);
    expect(deliveryAmount(3000, [{ field: "usSalesTax", label: "us sales tax", cents: 420 }], 1.5, 0.08)).toBe(5600);
  });

  test("an exact dollar stays that dollar, whatever floating point does", () => {
    // 150 × 1.5 × 1.08 is 243.00000000000003, and 60 × 1.5 × 1.1 is 99.00000000000001
    expect(deliveryAmount(15000, [], 1.5, 0.08)).toBe(24300);
    expect(deliveryAmount(6000, [], 1.5, 0.1)).toBe(9900);
    expect(deliveryAmount(2500, [], 1.6, 0)).toBe(4000);
  });

  test("a real fraction over a dollar still rounds up, however small", () => {
    // 95.48 × 0.8049 × 1.08 is 83.00000016
    expect(deliveryAmount(9548, [], 0.8049, 0.08)).toBe(8400);
  });

  test("every tax is summed", () => {
    const taxes = [{ field: "gst", label: "canadian gst", cents: 125 }, { field: "pst", label: "canadian pst", cents: 175 }];
    // (25 + 1.25 + 1.75) × 1.5 × 1.08 is 45.36
    expect(deliveryAmount(2500, taxes, 1.5, 0.08)).toBe(4600);
    expect(deliveryAmount(2500, taxes.slice(0, 1), 1.5, 0.08)).toBe(4300);
  });

  test("a zero freight is a zero delivery, not negative zero", () => {
    expect(Object.is(deliveryAmount(0, [], 1.5, 0.08), 0)).toBe(true);
  });

  test("inputs the settings never allow are refused", () => {
    for (const [freight, rate, buffer] of [[-1, 1.5, 0.08], [10.5, 1.5, 0.08], [3000, 0, 0.08], [3000, Number.NaN, 0.08], [3000, 1.5, -0.01], [3000, 1.5, 0.21], [3000, 1.5, Number.NaN]]) {
      expect(() => deliveryAmount(freight, [], rate, buffer)).toThrow(RangeError);
    }
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

test("the breakdown states a buffer that isn't a whole percent as it is", () => {
  expect(breakdown({ freightCents: 3000, taxes: [], rate: 1.5, buffer: 0.075 })).toContain("plus 7.5% in case");
  expect(breakdown({ freightCents: 3000, taxes: [], rate: 1.5, buffer: 0.004 })).toContain("plus 0.4% in case");
});
