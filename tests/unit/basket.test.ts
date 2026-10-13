import { describe, expect, test } from "vitest";
import { CAP_NOTE, changeLines, droppedNotes, groupLines, itemsValue, parseItems, printCount, readOp, validate, type BasketEntry } from "../../src/lib/prints/basket";

const offerAll = () => true;
const entries = (value: string) => parseItems(value);

describe("parseItems", () => {
  test("reads comma-separated photo:tier:frame entries", () => {
    expect(entries("fixture-b-01:medium:oak,fixture-b-02:small:unframed")).toEqual([
      { photoId: "fixture-b-01", tier: "medium", frame: "oak" },
      { photoId: "fixture-b-02", tier: "small", frame: "unframed" },
    ]);
  });

  test("anything malformed makes the whole basket empty", () => {
    for (const value of ["", "fixture-b-01:medium:oak,,", "fixture-b-01:MEDIUM:oak", "fixture-b-01: medium:oak", "fixture-b-01:medium", "../x-01:small:oak", "fixture-b-01:medium:oak:2", `${"a".repeat(2001)}`]) {
      expect(entries(value)).toEqual([]);
    }
    expect(parseItems(null)).toEqual([]);
  });

  test("unknown words parse, so validation can count and drop them", () => {
    expect(entries("fixture-b-01:huge:gold")).toEqual([{ photoId: "fixture-b-01", tier: "huge", frame: "gold" }]);
  });
});

describe("validate", () => {
  test("identical entries make one line with a quantity, in the order first seen", () => {
    const { lines } = validate(entries("b-01:medium:oak,b-02:small:unframed,b-01:medium:oak"), offerAll);
    expect(lines).toEqual([
      { photoId: "b-01", tier: "medium", frame: "oak", line: 1, quantity: 2 },
      { photoId: "b-02", tier: "small", frame: "unframed", line: 2, quantity: 1 },
    ]);
    expect(itemsValue(lines)).toBe("b-01:medium:oak,b-01:medium:oak,b-02:small:unframed");
  });

  test("unknown tiers or frames and anything not offered are dropped and counted", () => {
    const offered = (entry: BasketEntry) => entry.photoId !== "gone-01" && !(entry.photoId === "sq-01" && entry.tier !== "small");
    const result = validate(entries("gone-01:small:oak,sq-01:large:oak,sq-01:small:oak,b-01:huge:oak,b-01:small:gold"), offered);
    expect(result.lines.map((line) => `${line.photoId}:${line.tier}`)).toEqual(["sq-01:small"]);
    expect(result.unavailable).toBe(4);
    expect(result.overCap).toBe(0);
  });

  test("a basket holds ten prints; everything past the tenth is dropped and counted", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `p-${String(i + 1).padStart(2, "0")}:small:oak`).join(",");
    const result = validate(entries(eleven), offerAll);
    expect(result.lines).toHaveLength(10);
    expect(result.overCap).toBe(1);
  });

  test("the lines say why prints were taken out", () => {
    expect(droppedNotes(1, 0)).toEqual(["1 print was taken out: that photo isn't available as a print any more."]);
    expect(droppedNotes(2, 1)).toEqual(["2 prints were taken out: those photos aren't available as prints any more.", CAP_NOTE]);
    expect(CAP_NOTE).toBe("a basket holds up to 10 prints.");
    expect(droppedNotes(0, 0)).toEqual([]);
  });
});

describe("changes", () => {
  const lines = groupLines([{ photoId: "b-01", tier: "medium", frame: "oak" }, { photoId: "b-02", tier: "small", frame: "unframed" }]);

  test("add comes from the print row's fields; remove and more name a line", () => {
    expect(readOp(new URLSearchParams("items=x&add=b-01&size=large&frame=oak"))).toEqual({ kind: "add", entry: { photoId: "b-01", tier: "large", frame: "oak" } });
    expect(readOp(new URLSearchParams("remove=2"))).toEqual({ kind: "remove", line: 2 });
    expect(readOp(new URLSearchParams("more=1"))).toEqual({ kind: "more", line: 1 });
    expect(readOp(new URLSearchParams("more=abc"))).toEqual({ kind: "more", line: 0 });
    expect(readOp(new URLSearchParams("items=x"))).toBeNull();
  });

  test("one more adds a print to its line; remove one takes one off and drops an empty line", () => {
    expect(itemsValue(changeLines(lines, { kind: "more", line: 1 }).lines)).toBe("b-01:medium:oak,b-01:medium:oak,b-02:small:unframed");
    const removed = changeLines(lines, { kind: "remove", line: 1 }).lines;
    expect(removed).toEqual([{ photoId: "b-02", tier: "small", frame: "unframed", line: 1, quantity: 1 }]);
    expect(changeLines(lines, { kind: "remove", line: 9 }).lines).toEqual(lines);
  });

  test("one more past ten prints is refused", () => {
    const full = groupLines(Array.from({ length: 10 }, () => ({ photoId: "b-01", tier: "small" as const, frame: "oak" as const })));
    expect(changeLines(full, { kind: "more", line: 1 })).toEqual({ lines: full, refused: true });
  });
});

describe("a crafted query string", () => {
  test("an add whose photo id carries a separator or the wrong shape is no change at all", () => {
    for (const photoId of ["", "b-01:small:oak,c-01", "b-01,c-01", "b-01\n", "../b-01", "b-1", "é-01", "a".repeat(65) + "-01"]) {
      expect(readOp(new URLSearchParams({ add: photoId, size: "small", frame: "oak" }))).toBeNull();
    }
    // a well-formed id still reaches validate, which checks tier and frame
    const op = readOp(new URLSearchParams({ add: "b-01", size: "gold", frame: "oak" }));
    expect(op).toEqual({ kind: "add", entry: { photoId: "b-01", tier: "gold", frame: "oak" } });
    expect(validate(op?.kind === "add" ? [op.entry] : [], offerAll)).toEqual({ lines: [], unavailable: 1, overCap: 0 });
  });

  test("validate refuses a badly shaped id even when it is handed one directly", () => {
    const result = validate([{ photoId: "b-01:small:oak,c-01", tier: "small", frame: "oak" }], offerAll);
    expect(result).toEqual({ lines: [], unavailable: 1, overCap: 0 });
  });

  test("hostile values give an empty basket, or the canonical one, and never throw", () => {
    const empty = ["__proto__-01:small:oak,constructor-01:small", "%00", "a-01:small:oak\n", " ", ",", ":", "a-01:small:oak:", "a-01:small:oak,", ",a-01:small:oak", "a-01:small:oak,".repeat(300), "a-01:small:oak;b-01:small:oak"];
    for (const value of empty) expect(validate(parseItems(value), offerAll)).toEqual({ lines: [], unavailable: 0, overCap: 0 });
    // __proto__ is only a string: a well-formed id, an ordinary line
    expect(itemsValue(validate(parseItems("__proto__-01:small:oak"), offerAll).lines)).toBe("__proto__-01:small:oak");
    // a tier named like an object property is dropped as unavailable, not looked up
    expect(parseItems("a-01:toString:oak")).toEqual([]);
    for (const tier of ["constructor", "length", "prototype"]) expect(validate(parseItems(`a-01:${tier}:oak`), offerAll)).toEqual({ lines: [], unavailable: 1, overCap: 0 });
  });

  test("the query string is decoded once, by URLSearchParams; the module never decodes", () => {
    const items = (query: string) => new URLSearchParams(query).get("items");
    // %2C and %3A decode to the real separators, so an encoded basket reads the same as a plain one
    expect(itemsValue(validate(parseItems(items("items=a-01%3Asmall%3Aoak%2Cb-02%3Alarge%3Aunframed")), offerAll).lines)).toBe("a-01:small:oak,b-02:large:unframed");
    // double encoding decodes to a literal %3A, which is no part of an entry: the whole basket is empty
    expect(items("items=a-01%253Asmall%253Aoak")).toBe("a-01%3Asmall%3Aoak");
    expect(parseItems(items("items=a-01%253Asmall%253Aoak"))).toEqual([]);
    expect(parseItems(items("items=a-01%3Asmall%3Aoak%252Cb-02%3Asmall%3Aoak"))).toEqual([]);
    // an encoded newline, space or NUL is rejected after the one decode
    for (const encoded of ["%0A", "%20", "%00"]) expect(parseItems(items(`items=a-01%3Asmall%3Aoak${encoded}`))).toEqual([]);
    // and the canonical value written back never contains a character that needs encoding
    expect(itemsValue(validate(parseItems("a-01:small:oak,b-02:large:unframed"), offerAll).lines)).toMatch(/^[A-Za-z0-9_:,-]+$/);
  });

  test("odd line numbers read as line 0, which changes nothing", () => {
    for (const query of ["remove=-1", "more=1e1", "more=%20", "remove=100", "remove=01x"]) {
      const op = readOp(new URLSearchParams(query));
      expect(op?.kind === "add" ? null : op?.line).toBe(0);
    }
    expect(readOp(new URLSearchParams("remove=999"))).toEqual({ kind: "remove", line: 0 });
    expect(readOp(new URLSearchParams("remove=2&more=1"))).toEqual({ kind: "remove", line: 2 });
    expect(readOp(new URLSearchParams("add&size=small"))).toBeNull();
  });

  test("a basket of many entries is capped at ten prints however it is padded", () => {
    const many = Array.from({ length: 100 }, () => "a-01:small:oak").join(",");
    const result = validate(parseItems(many), offerAll);
    expect(printCount(result.lines)).toBe(10);
    expect(result.overCap).toBe(90);
    expect(itemsValue(result.lines).split(",")).toHaveLength(10);
  });
});
