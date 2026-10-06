import { describe, expect, test } from "vitest";
import {
  checkFact,
  checkItem,
  checkLogEntry,
  checkRecordMeta,
  checkUpload,
  linkProblem,
  readFields,
} from "../../src/lib/admin/validate";

const item = (overrides: Record<string, string> = {}) => ({
  section: "now",
  slug: "garden-club",
  text: "started [the garden club](https://example.com)",
  aside: "",
  label_status: "",
  label_era: "",
  label_made_of: "",
  label_text: "",
  label_kind: "",
  label_note: "",
  snapshot_url: "",
  ...overrides,
});

function refusal<T>(result: { ok: true; value: T } | { ok: false; errors: Record<string, string> }, field: string) {
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.errors[field];
}

describe("readFields", () => {
  test("trims every named field and turns missing ones and files into empty strings", () => {
    const form = new FormData();
    form.append("slug", "  garden-club ");
    form.append("text", new File(["x"], "x.txt"));
    expect(readFields(form, ["slug", "text", "aside"])).toEqual({ slug: "garden-club", text: "", aside: "" });
  });
});

describe("linkProblem", () => {
  test.each([
    ["plain text", "just words", null],
    ["an https link", "see [this](https://example.com/a?b=c)", null],
    ["a mailto link", "[email me](mailto:hi@example.com)", null],
    ["an http link", "[x](http://example.com)", "links need an https:// or mailto: address"],
    ["a relative link", "[x](/about)", "links need an https:// or mailto: address"],
    ["brackets in the address", "[x](https://en.wikipedia.org/wiki/Foo_(bar))", "a link's address can't contain brackets"],
    ["empty link text", "[](https://example.com)", "a link needs some text between the [ ]"],
    ["whitespace-only link text", "[ ](https://example.com)", "a link needs some text between the [ ]"],
    ["space in the address", "[x](https://a.com/b c)", "a link's address can't contain spaces"],
    ["space before address", "[x]( https://example.com)", "a link's address can't contain spaces"],
    ["link inside brackets", "(see [x](https://a.com))", null],
  ])("%s", (_name, text, expected) => {
    expect(linkProblem(text)).toBe(expected);
  });
});

describe("checkItem", () => {
  test("accepts a line with no label", () => {
    expect(checkItem(item())).toEqual({
      ok: true,
      value: { section: "now", slug: "garden-club", text: "started [the garden club](https://example.com)", aside: null, label: null, snapshotUrl: null },
    });
  });

  test("accepts a full label", () => {
    const result = checkItem(
      item({ label_status: "live", label_era: "2026 to now", label_made_of: "volunteers", label_text: "a club.", label_kind: "lesson", label_note: "start small.", snapshot_url: "https://example.com" }),
    );
    expect(result.ok && result.value.label).toEqual({ status: "live", era: "2026 to now", madeOf: "volunteers", text: "a club.", kind: "lesson", note: "start small." });
    expect(result.ok && result.value.snapshotUrl).toBe("https://example.com");
  });

  test("lets markup-looking and accented text through (the page escapes it)", () => {
    expect(checkItem(item({ text: "<b>bold</b> & lépi" })).ok).toBe(true);
  });

  test("accepts a 40-character slug", () => {
    expect(checkItem(item({ slug: "a".repeat(40) })).ok).toBe(true);
  });

  test("accepts a 240-character text", () => {
    expect(checkItem(item({ text: "x".repeat(240) })).ok).toBe(true);
  });

  test.each([
    ["section", { section: "later" }, "choose now or before"],
    ["slug", { slug: "" }, "a slug is needed"],
    ["slug", { slug: "Garden Club" }, "lowercase letters, numbers and single hyphens only"],
    ["slug", { slug: "garden--club" }, "lowercase letters, numbers and single hyphens only"],
    ["slug", { slug: "a".repeat(41) }, "40 characters at most"],
    ["text", { text: "" }, "the line needs some text"],
    ["text", { text: "[x](http://example.com)" }, "links need an https:// or mailto: address"],
    ["text", { text: "x".repeat(241) }, "240 characters at most"],
    ["aside", { aside: "x".repeat(81) }, "80 characters at most"],
    ["label_status", { label_era: "2026" }, "choose live or retired to show a label, or clear its fields"],
    ["label_status", { snapshot_url: "https://example.com" }, "choose live or retired to show a label, or clear its fields"],
    ["label_status", { label_status: "maybe" }, "choose live or retired"],
    ["label_kind", { label_status: "live", label_kind: "idea", label_note: "x" }, "choose decision or lesson"],
    ["label_note", { label_status: "live", label_kind: "decision" }, "the decision or lesson needs a sentence"],
    ["label_kind", { label_status: "live", label_note: "x" }, "say whether this is a decision or a lesson"],
    ["snapshot_url", { label_status: "live", snapshot_url: "http://example.com" }, "an https:// address"],
    ["snapshot_url", { label_status: "live", snapshot_url: "not a url" }, "an https:// address"],
    ["snapshot_url", { label_status: "live", snapshot_url: "https:example.com" }, "an https:// address"],
    ["snapshot_url", { label_status: "live", snapshot_url: "https:///example.com" }, "an https:// address"],
    ["snapshot_url", { label_status: "live", snapshot_url: "https://example.com/a b" }, "an https:// address"],
    ["label_text", { label_status: "retired", label_text: "x".repeat(401) }, "400 characters at most"],
  ])("refuses a bad %s (%j)", (field, overrides, message) => {
    expect(refusal(checkItem(item(overrides)), field)).toBe(message);
  });
});

describe("checkLogEntry", () => {
  test("keeps a day entry's date", () => {
    expect(checkLogEntry({ date: "2026-10-05", precision: "day", text: "shipped." })).toEqual({
      ok: true,
      value: { date: "2026-10-05", precision: "day", text: "shipped." },
    });
  });

  test("stores a month entry as the first of its month", () => {
    expect(checkLogEntry({ date: "2026-11-17", precision: "month", text: "x" })).toEqual({ ok: true, value: { date: "2026-11-01", precision: "month", text: "x" } });
  });

  test.each([
    ["date", { date: "2026-02-30" }, "a real date, like 2026-10-04"],
    ["date", { date: "04/10/2026" }, "a real date, like 2026-10-04"],
    ["precision", { precision: "year" }, "choose day or month"],
    ["text", { text: "" }, "the entry needs some text"],
    ["text", { text: "x".repeat(281) }, "280 characters at most"],
  ])("refuses a bad %s (%j)", (field, overrides, message) => {
    expect(refusal(checkLogEntry({ date: "2026-10-05", precision: "day", text: "shipped.", ...overrides }), field)).toBe(message);
  });
});

describe("checkFact", () => {
  test("accepts a title and subtitle", () => {
    expect(checkFact({ key: "shelf", title: "piranesi", subtitle: "susanna clarke" })).toEqual({
      ok: true,
      value: { key: "shelf", fact: { title: "piranesi", subtitle: "susanna clarke" } },
    });
  });

  test("both fields empty clears the fact", () => {
    expect(checkFact({ key: "kettle", title: "", subtitle: "" })).toEqual({ ok: true, value: { key: "kettle", fact: null } });
  });

  test.each([
    ["title", { subtitle: "susanna clarke" }, "a title is needed, or clear both to hide it"],
    ["key", { key: "fridge" }, "unknown fact"],
    ["title", { title: "x".repeat(81) }, "80 characters at most"],
  ])("refuses a bad %s (%j)", (field, overrides, message) => {
    expect(refusal(checkFact({ key: "shelf", title: "", subtitle: "", ...overrides }), field)).toBe(message);
  });
});

describe("checkRecordMeta", () => {
  test("accepts a title and artist", () => {
    expect(checkRecordMeta({ title: "slow morning", artist: "home alone." })).toEqual({ ok: true, value: { title: "slow morning", artist: "home alone." } });
  });

  test.each([
    ["title", { title: "" }, "the record needs a title"],
    ["artist", { artist: "" }, "the record needs an artist"],
    ["title", { title: "x".repeat(61) }, "60 characters at most"],
  ])("refuses a bad %s (%j)", (field, overrides, message) => {
    expect(refusal(checkRecordMeta({ title: "slow morning", artist: "home alone.", ...overrides }), field)).toBe(message);
  });
});

describe("checkUpload", () => {
  const mp3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const file = (bytes: Uint8Array<ArrayBuffer>, name = "upload") => new File([bytes], name);

  test("accepts an mp3 and a png", async () => {
    expect(await checkUpload(file(mp3, "song.mp3"), "audio")).toBeNull();
    expect(await checkUpload(file(png, "cover.png"), "cover")).toBeNull();
  });

  test.each([
    ["no file", null, "audio", "choose an mp3"],
    ["a text value instead of a file", "song.mp3", "audio", "choose an mp3"],
    ["an empty file", new File([], "cover.png"), "cover", "choose a cover image"],
    ["a png named .mp3", new File([png], "song.mp3"), "audio", "that file isn't an mp3"],
    ["an svg named .png", new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "cover.png"), "cover", "covers can be JPEG, PNG or WebP"],
  ] as const)("refuses %s", async (_name, value, kind, message) => {
    expect(await checkUpload(value, kind)).toBe(message);
  });

  test("accepts files at their limits", async () => {
    const mp3AtLimit = new Uint8Array(15 * 1024 * 1024);
    mp3AtLimit.set([0x49, 0x44, 0x33, 4, 0]);
    expect(await checkUpload(new File([mp3AtLimit], "song.mp3"), "audio")).toBeNull();
    const pngAtLimit = new Uint8Array(10 * 1024 * 1024);
    pngAtLimit.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await checkUpload(new File([pngAtLimit], "cover.png"), "cover")).toBeNull();
  });

  test("refuses files over their limits", async () => {
    expect(await checkUpload(new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.mp3"), "audio")).toBe("mp3s can be up to 15MB");
    expect(await checkUpload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png"), "cover")).toBe("covers can be up to 10MB");
  });
});
