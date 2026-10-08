import { expect, test } from "vitest";
import { trackingHref } from "../../src/lib/prints/tracking";

test("only an https address with no whitespace is a link, trimmed", () => {
  expect(trackingHref("https://www.ups.com/track?tracknum=1Z")).toBe("https://www.ups.com/track?tracknum=1Z");
  expect(trackingHref("  HTTPS://example.com/t  ")).toBe("HTTPS://example.com/t");
  for (const text of ["", "http://example.com", "javascript:alert(1)", "//example.com", "https://exa mple.com", "https://", "ups 1Z"]) expect(trackingHref(text), text).toBeNull();
});
