import { describe, expect, test, vi } from "vitest";
import { loadLogbook, loadLogbookSafely } from "../../src/lib/logbook";

function fakeDb(results: unknown[][], fail = false) {
  const statement = { bind: () => statement };
  const db = {
    prepare: vi.fn(() => statement),
    batch: vi.fn(async () => {
      if (fail) throw new Error("D1 unavailable");
      return results.map((rows) => ({ results: rows }));
    }),
  };
  return db as unknown as D1Database & { batch: ReturnType<typeof vi.fn> };
}

const itemRows = [
  { slug: "onestack", section: "before", text: "founded [onestack.cloud](https://onestack.cloud)", aside: null, label_era: "founder", label_status: "retired", label_made_of: "tools", label_text: "early.", label_kind: null, label_note: null, snapshot_key: null },
  { slug: "good-people", section: "now", text: "looking for good people", aside: null, label_era: null, label_status: null, label_made_of: null, label_text: null, label_kind: null, label_note: null, snapshot_key: null },
];

describe("loadLogbook", () => {
  test("reads everything in one batch and maps rows", async () => {
    const db = fakeDb([
      itemRows,
      [{ key: "shelf", title: "the scout mindset", subtitle: "julia galef" }],
      [{ id: 5, date: "2026-10-03", precision: "day", text: "redesigning." }],
      [{ id: 9, title: "simple things", artist: "loom room", audio_key: "audio/a.mp3", cover_key: "covers/a.webp" }],
      [{ any: 1 }],
    ]);
    const data = await loadLogbook(db);
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(data.now).toEqual([{ slug: "good-people", section: "now", text: "looking for good people", aside: null, label: null }]);
    expect(data.before[0].label).toEqual({ era: "founder", status: "retired", madeOf: "tools", text: "early.", kind: null, note: null, snapshotKey: null });
    expect(data.facts).toEqual([{ key: "shelf", title: "the scout mindset", subtitle: "julia galef" }]);
    expect(data.log).toEqual([{ id: 5, date: "2026-10-03", precision: "day", text: "redesigning." }]);
    expect(data.records).toEqual([{ id: 9, title: "simple things", artist: "loom room", audioKey: "audio/a.mp3", coverKey: "covers/a.webp", side: "a1" }]);
    expect(data.photos).toBe(true);
  });

  test("there are photos only when something is published", async () => {
    const data = await loadLogbook(fakeDb([[], [], [], [], [{ any: 0 }]]));
    expect(data.photos).toBe(false);
  });
});

describe("loadLogbookSafely", () => {
  test("returns null instead of throwing when D1 fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadLogbookSafely(fakeDb([], true))).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
