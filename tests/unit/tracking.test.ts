import { expect, test } from "vitest";
import { cleanShipment } from "../../src/lib/prints/artelo";
import { trackingHref } from "../../src/lib/prints/tracking";

test("only an https address with no whitespace is a link, trimmed", () => {
  expect(trackingHref("https://www.ups.com/track?tracknum=1Z")).toBe("https://www.ups.com/track?tracknum=1Z");
  expect(trackingHref("  HTTPS://example.com/t  ")).toBe("HTTPS://example.com/t");
  for (const text of ["", "http://example.com", "javascript:alert(1)", "//example.com", "https://exa mple.com", "https://", "ups 1Z"]) expect(trackingHref(text), text).toBeNull();
});

test("a stored link passes trackingHref's rule and adds only its own: nothing invisible and a bounded length (final review m4)", () => {
  const stored = (url: string) => cleanShipment("ups", "1Z", url)?.url;
  for (const text of ["https://www.ups.com/track?tracknum=1Z", "  HTTPS://example.com/t  ", "", "http://example.com", "javascript:alert(1)", "https://exa mple.com", "https://"]) {
    expect(stored(text), text).toBe(trackingHref(text) ?? "");
  }
  for (const text of ["https://example.com/‮t", "https://example.com/​t", "https://example.com/\u0007t", `https://example.com/${"t".repeat(500)}`]) expect(stored(text), text).toBe("");
});
