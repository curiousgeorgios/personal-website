import { expect, test } from "vitest";
import { aud, gstSentence, plural, rateText, usd } from "../../src/lib/prints/money";

test("dollars read the way the spec writes them", () => {
  expect(aud(23800)).toBe("$238");
  expect(aud(23850)).toBe("$238.50");
  expect(usd(3000)).toBe("us$30.00");
  expect(usd(420)).toBe("us$4.20");
});

test("the rate keeps four decimals at most and two at least", () => {
  expect(rateText(1.5)).toBe("a$1.50");
  expect(rateText(1.5237)).toBe("a$1.5237");
  expect(rateText(1.523)).toBe("a$1.523");
  expect(rateText(1.52)).toBe("a$1.52");
});

test("the gst sentence follows the setting", () => {
  expect(gstSentence("none")).toBe("prices include no gst; the seller isn't registered for gst.");
  expect(gstSentence("inclusive")).toBe("prices include gst for orders posted within australia.");
  expect(plural(1, "print", "prints")).toBe("1 print");
  expect(plural(3, "print", "prints")).toBe("3 prints");
});
