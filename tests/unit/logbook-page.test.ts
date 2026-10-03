import { describe, expect, test } from "vitest";
import Logbook from "../../src/components/Logbook.astro";
import type { Logbook as Data } from "../../src/lib/logbook";
import { render, text } from "./render";

const full: Data = {
  now: [{ slug: "good-people", section: "now", text: "looking for <good> people & [friends](https://example.com)", aside: "always", label: null }],
  before: [{ slug: "kpmg", section: "before", text: "management consulting at kpmg", aside: null, label: null }],
  facts: [
    { key: "shelf", title: "the scout mindset", subtitle: "julia galef" },
    { key: "kettle", title: "fellow stagg", subtitle: "slightly hacked" },
  ],
  log: [
    { id: 1, date: "2026-10-03", precision: "day", text: "one." },
    { id: 2, date: "2026-10-01", precision: "month", text: "two." },
  ],
  records: [],
};

const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map((el) => text(el));

describe("Logbook", () => {
  test("renders every section in order", async () => {
    const doc = await render(Logbook, { data: full });
    expect(labels(doc)).toEqual(["logbook of", "now", "lately", "log", "on the turntable", "before", "say hi", "visitor info"]);
    expect(text(doc.querySelector("h1"))).toBe("george vlachos");
    expect(text(doc.querySelector(".where"))).toContain("· last entry 03.10.26");
  });

  test("escapes markup in item text and only links https", async () => {
    const doc = await render(Logbook, { data: full });
    const line = doc.querySelector("#now .line")!;
    expect(line.querySelector("good")).toBeNull();
    expect(text(line)).toContain("looking for <good> people &");
    expect(line.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(text(line.querySelector(".aside"))).toBe("- always");
  });

  test("unsafe links render as text, never as links", async () => {
    const doc = await render(Logbook, { data: { ...full, now: [{ ...full.now[0], text: "[x](javascript:alert(1)) and [y](http://example.com)" }] } });
    expect(doc.querySelector("#now a")).toBeNull();
    expect(text(doc.querySelector("#now .line"))).toContain("[x](javascript:alert(1)) and [y](http://example.com)");
  });

  test("shows the turntable empty state when there are no records", async () => {
    const doc = await render(Logbook, { data: full });
    expect(text(doc.querySelector("#turntable .empty"))).toBe("nothing on the turntable right now.");
  });

  test("omits rows with no data and the last-entry note", async () => {
    const doc = await render(Logbook, { data: { now: [], before: [], facts: [], log: [], records: [] } });
    expect(labels(doc)).toEqual(["logbook of", "on the turntable", "say hi", "visitor info"]);
    expect(text(doc.querySelector(".where"))).not.toContain("last entry");
  });

  test("renders only the static sections when D1 is unavailable", async () => {
    const doc = await render(Logbook, { data: null });
    expect(labels(doc)).toEqual(["logbook of", "say hi", "visitor info"]);
  });

  test("visitor info says exactly what is collected", async () => {
    const doc = await render(Logbook, { data: null });
    const pairs = [...doc.querySelectorAll("#visitor-info dt")].map((dt) => [text(dt), text(dt.nextElementSibling)]);
    expect(pairs).toEqual([
      ["open", "whenever you are"],
      ["entry", "free"],
      ["cookies", "none. nothing to accept."],
      ["analytics", "anonymous counts of visits and clicks, no cookies"],
      ["based", "sydney and canberra"],
    ]);
    expect(text(doc.querySelector("#visitor-info .signoff"))).toBe("fewer tabs, more arvos.");
  });
});
