import { describe, expect, test } from "vitest";
import { formatLogDate, parseInline, primaryName, sideFor } from "../../src/lib/text";

describe("parseInline", () => {
  test("plain text stays one text part", () => {
    expect(parseInline("finance and policy")).toEqual([{ kind: "text", value: "finance and policy" }]);
  });
  test("links become link parts around text", () => {
    expect(parseInline("growing [digital nachos](https://digitalnachos.com.au) today")).toEqual([
      { kind: "text", value: "growing " },
      { kind: "link", text: "digital nachos", href: "https://digitalnachos.com.au" },
      { kind: "text", value: " today" },
    ]);
  });
  test("two links in one line", () => {
    const parts = parseInline("helping [r4r](https://runningforresilience.com) and [with-me](https://www.with-me.co/) grow");
    expect(parts.filter((p) => p.kind === "link")).toHaveLength(2);
  });
  test("mailto links are allowed", () => {
    expect(parseInline("[say hi](mailto:hello@curiousgeorge.dev)")).toEqual([
      { kind: "link", text: "say hi", href: "mailto:hello@curiousgeorge.dev" },
    ]);
  });
  test("unsafe or non-https links stay as literal text", () => {
    for (const source of ["[x](javascript:alert(1))", "[x](http://example.com)", "[x](data:text/html,hi)"]) {
      expect(parseInline(source)).toEqual([{ kind: "text", value: source }]);
    }
  });
  test("markup characters are left for the renderer to escape", () => {
    expect(parseInline("<b>bold</b> & co")).toEqual([{ kind: "text", value: "<b>bold</b> & co" }]);
  });
});

test("primaryName prefers the first link text", () => {
  expect(primaryName("building [canberra.events](https://canberra.events)")).toBe("canberra.events");
  expect(primaryName("finance and policy")).toBe("finance and policy");
});

test("formatLogDate", () => {
  expect(formatLogDate("2026-10-03", "day")).toBe("03.10.26");
  expect(formatLogDate("2026-10-01", "month")).toBe("oct 26");
  expect(formatLogDate("2026-03-01", "month")).toBe("mar 26");
});

test("sideFor walks a1 to c2", () => {
  expect([0, 1, 2, 3, 4, 5].map(sideFor)).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
});
