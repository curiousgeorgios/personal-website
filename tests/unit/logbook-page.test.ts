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
  photos: false,
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
    const doc = await render(Logbook, { data: { now: [], before: [], facts: [], log: [], records: [], photos: false } });
    expect(labels(doc)).toEqual(["logbook of", "on the turntable", "say hi", "visitor info"]);
    expect(text(doc.querySelector(".where"))).not.toContain("last entry");
  });

  test("a line points to the photos, between the log and the turntable, only while something is published", async () => {
    const doc = await render(Logbook, { data: { ...full, photos: true } });
    expect(labels(doc)).toEqual(["logbook of", "now", "lately", "log", "photos", "on the turntable", "before", "say hi", "visitor info"]);
    expect(text(doc.querySelector("#photos .body"))).toBe("photos i've taken, kept like this log.");
    expect(doc.querySelector("#photos a")!.getAttribute("href")).toBe("/photos");
    expect(labels(await render(Logbook, { data: full }))).not.toContain("photos");
  });

  test("renders only the static sections when D1 is unavailable", async () => {
    const doc = await render(Logbook, { data: null });
    expect(labels(doc)).toEqual(["logbook of", "say hi", "visitor info"]);
  });

  test("the closer look is in the page only when some line has a snapshot", async () => {
    const label = { era: "", status: "live" as const, madeOf: null, text: null, kind: null, note: null };
    const labelled = (item: Data["now"][number], snapshotKey: string | null) => ({ ...item, label: { ...label, snapshotKey } });
    const closer = async (data: Data) => (await render(Logbook, { data })).querySelector("dialog.closer");
    // No label at all, and a label with no snapshot: no dialog
    expect(await closer(full)).toBeNull();
    expect(await closer({ ...full, now: [labelled(full.now[0], null)], before: [labelled(full.before[0], null)] })).toBeNull();
    // A snapshot on a line in now, or only in before
    const dialog = (await closer({ ...full, now: [labelled(full.now[0], "snapshots/fixture-x")] }))!;
    expect(dialog.querySelector("button.closer-close")!.hasAttribute("autofocus")).toBe(true);
    expect(text(dialog.querySelector("button.closer-close"))).toBe("close");
    // No <source>: closer.ts shows the frame's own picture, then the big file in the format that picture chose
    expect(dialog.querySelector("picture > img")).not.toBeNull();
    expect(dialog.querySelector("picture > source")).toBeNull();
    expect(await closer({ ...full, before: [labelled(full.before[0], "snapshots/fixture-y")] })).not.toBeNull();
    // One dialog for the page, however many lines have a snapshot
    const many = await render(Logbook, { data: { ...full, now: [labelled(full.now[0], "snapshots/fixture-x")], before: [labelled(full.before[0], "snapshots/fixture-y")] } });
    expect(many.querySelectorAll("dialog.closer")).toHaveLength(1);
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

  test("while prints are open the photos line says some come as prints", async () => {
    const doc = await render(Logbook, { data: { ...full, photos: true }, prints: true });
    expect(text(doc.querySelector("#photos .body"))).toBe("photos i've taken, kept like this log. some come as prints.");
    expect(text((await render(Logbook, { data: { ...full, photos: true } })).querySelector("#photos .body"))).toBe("photos i've taken, kept like this log.");
  });
});
