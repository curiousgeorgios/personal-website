import { beforeEach, describe, expect, test } from "vitest";
import * as store from "../../src/lib/admin/store";
import type { ItemInput } from "../../src/lib/admin/validate";
import { sqliteD1 } from "./sqlite-d1";

let db: D1Database;
beforeEach(() => {
  db = sqliteD1();
});

const line = (overrides: Partial<ItemInput> = {}): ItemInput => ({
  section: "now",
  slug: "garden-club",
  text: "started the garden club",
  aside: null,
  label: null,
  snapshotUrl: null,
  ...overrides,
});

// The same line as it stands, as a form would send it back
const asInput = (item: store.AdminItem, overrides: Partial<ItemInput> = {}): ItemInput => ({
  section: item.section,
  slug: item.slug,
  text: item.text,
  aside: item.aside,
  label: item.labelStatus
    ? { status: item.labelStatus, era: item.labelEra, madeOf: item.labelMadeOf, text: item.labelText, kind: item.labelKind, note: item.labelNote }
    : null,
  snapshotUrl: item.snapshotUrl,
  ...overrides,
});

const slugs = async (section: "now" | "before") => (await store.loadAdmin(db))[section].map((item) => item.slug);
const row = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values).first<Record<string, unknown>>();
const itemId = async (slug: string) => (await row("SELECT id FROM items WHERE slug = ?", slug))!.id as number;

describe("loadAdmin", () => {
  test("reads the seeded logbook, every log entry and every record", async () => {
    const data = await store.loadAdmin(db);
    expect(data.now.map((item) => item.slug)).toEqual(["digital-nachos", "canberra-events", "linear-gratis", "r4r-with-me", "good-people"]);
    expect(data.before).toHaveLength(6);
    expect(data.log.map((entry) => entry.date)).toEqual(["2026-10-03", "2026-10-01", "2026-09-01", "2026-03-01", "2026-03-01"]);
    expect(data.facts).toEqual({
      shelf: { title: "the scout mindset", subtitle: "julia galef" },
      kettle: { title: "fellow stagg", subtitle: "slightly hacked" },
    });
    expect(data.records.map((record) => [record.title, record.active])).toEqual([
      ["simple things", true],
      ["nyc in 1940", true],
      ["no bad feelings today", true],
      ["light it up", true],
    ]);
    expect(data.now[0]).toMatchObject({ labelStatus: "live", labelKind: "decision", snapshotStatus: null });
    expect(data.photographs).toEqual([]);
  });
});

describe("items", () => {
  test("a new line goes to the end of its section", async () => {
    await store.createItem(db, line());
    expect((await slugs("now")).at(-1)).toBe("garden-club");
    await store.createItem(db, line({ slug: "old-club", section: "before" }));
    expect((await slugs("before")).at(-1)).toBe("old-club");
  });

  test("a taken slug adds nothing, and an identical line is recognised as already there", async () => {
    expect(await store.createItem(db, line())).toBeGreaterThan(0);
    expect(await store.createItem(db, line({ text: "something else" }))).toBe(0);
    expect(await store.sameItem(db, line())).toBe(true);
    expect(await store.sameItem(db, line({ text: "something else" }))).toBe(false);
    expect(await store.sameItem(db, line({ section: "before" }))).toBe(false);
    expect((await slugs("now")).filter((slug) => slug === "garden-club")).toHaveLength(1);
  });

  test("knows when a slug is taken, except by the line itself", async () => {
    const id = await itemId("digital-nachos");
    expect(await store.slugTaken(db, "digital-nachos", null)).toBe(true);
    expect(await store.slugTaken(db, "digital-nachos", id)).toBe(false);
    expect(await store.slugTaken(db, "nobody-has-this", null)).toBe(false);
  });

  test("saving a line changes its fields and stamps updated_at", async () => {
    const id = await itemId("r4r-with-me");
    await db.prepare("UPDATE items SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(id).run();
    const item = (await store.loadAdmin(db)).now.find((entry) => entry.id === id)!;
    expect(await store.updateItem(db, id, asInput(item, { text: "running r4r", aside: "weekly" }))).toBe(true);
    expect(await row("SELECT text, aside, updated_at > '2001' AS fresh FROM items WHERE id = ?", id)).toEqual({ text: "running r4r", aside: "weekly", fresh: 1 });
  });

  test("moving a line to before puts it at the end there", async () => {
    const id = await itemId("r4r-with-me");
    const item = (await store.loadAdmin(db)).now.find((entry) => entry.id === id)!;
    await store.updateItem(db, id, asInput(item, { section: "before" }));
    expect((await slugs("before")).at(-1)).toBe("r4r-with-me");
    expect(await slugs("now")).not.toContain("r4r-with-me");
  });

  test("a new snapshot address drops the old snapshot; the same address keeps it", async () => {
    const id = await itemId("digital-nachos");
    await db.prepare("UPDATE items SET snapshot_key = 'snapshots/a', snapshot_at = '2026-10-01T17:00:00Z', snapshot_status = 'ok' WHERE id = ?").bind(id).run();
    const item = (await store.loadAdmin(db)).now[0];
    await store.updateItem(db, id, asInput(item, { aside: "same address" }));
    expect(await row("SELECT snapshot_key, snapshot_status FROM items WHERE id = ?", id)).toEqual({ snapshot_key: "snapshots/a", snapshot_status: "ok" });
    await store.updateItem(db, id, asInput(item, { snapshotUrl: "https://example.com/new" }));
    expect(await row("SELECT snapshot_key, snapshot_at, snapshot_status, snapshot_url FROM items WHERE id = ?", id)).toEqual({
      snapshot_key: null,
      snapshot_at: null,
      snapshot_status: null,
      snapshot_url: "https://example.com/new",
    });
  });

  test("saving a line that's gone reports it", async () => {
    expect(await store.updateItem(db, 999, line())).toBe(false);
  });

  test("moves a line up and down within its section, never past the ends", async () => {
    const canberra = await itemId("canberra-events");
    expect(await store.moveItem(db, canberra, "up")).toBe("now");
    expect((await slugs("now")).slice(0, 2)).toEqual(["canberra-events", "digital-nachos"]);
    await store.moveItem(db, canberra, "up");
    expect((await slugs("now"))[0]).toBe("canberra-events");
    const last = await itemId("good-people");
    await store.moveItem(db, last, "down");
    expect((await slugs("now")).at(-1)).toBe("good-people");
    expect(await store.moveItem(db, 999, "up")).toBeNull();
  });

  test("moves a middle line down, and the positions stay 1 to 5", async () => {
    const canberra = await itemId("canberra-events");
    expect(await store.moveItem(db, canberra, "down")).toBe("now");
    expect(await slugs("now")).toEqual(["digital-nachos", "linear-gratis", "canberra-events", "r4r-with-me", "good-people"]);
    expect((await store.loadAdmin(db)).now.map((item) => item.position)).toEqual([1, 2, 3, 4, 5]);
    await store.moveItem(db, canberra, "down");
    await store.moveItem(db, await itemId("digital-nachos"), "down");
    expect(await slugs("now")).toEqual(["linear-gratis", "digital-nachos", "r4r-with-me", "canberra-events", "good-people"]);
    expect((await store.loadAdmin(db)).now.map((item) => item.position)).toEqual([1, 2, 3, 4, 5]);
  });

  test("moving swaps with the nearest line across gaps left by removals", async () => {
    await store.removeItem(db, await itemId("linear-gratis"));
    await store.moveItem(db, await itemId("r4r-with-me"), "up");
    expect(await slugs("now")).toEqual(["digital-nachos", "r4r-with-me", "canberra-events", "good-people"]);
  });

  test("removes a line, and reports a line that's already gone", async () => {
    const id = await itemId("good-people");
    expect(await store.removeItem(db, id)).toBe("now");
    expect(await slugs("now")).not.toContain("good-people");
    expect(await store.removeItem(db, id)).toBeNull();
  });
});

describe("log entries", () => {
  test("adds, edits and removes entries", async () => {
    const id = await store.createLogEntry(db, { date: "2026-10-05", precision: "day", text: "shipped the admin." });
    expect((await store.loadAdmin(db)).log[0]).toEqual({ id, date: "2026-10-05", precision: "day", text: "shipped the admin." });
    expect(await store.updateLogEntry(db, id, { date: "2026-11-01", precision: "month", text: "shipped it." })).toBe(true);
    expect((await store.loadAdmin(db)).log[0]).toEqual({ id, date: "2026-11-01", precision: "month", text: "shipped it." });
    expect(await store.removeLogEntry(db, id)).toBe(true);
    expect((await store.loadAdmin(db)).log.map((entry) => entry.id)).not.toContain(id);
    expect(await store.updateLogEntry(db, id, { date: "2026-11-01", precision: "month", text: "x" })).toBe(false);
    expect(await store.removeLogEntry(db, id)).toBe(false);
  });

  test("the same entry added twice saves once; a different date or different text still adds", async () => {
    const entry = { date: "2026-10-05", precision: "day" as const, text: "shipped the admin." };
    expect(await store.createLogEntry(db, entry)).toBeGreaterThan(0);
    expect(await store.createLogEntry(db, entry)).toBe(0);
    expect((await store.loadAdmin(db)).log.filter((saved) => saved.text === entry.text)).toHaveLength(1);
    expect(await store.createLogEntry(db, { ...entry, date: "2026-10-06" })).toBeGreaterThan(0);
    expect(await store.createLogEntry(db, { ...entry, text: "shipped it twice." })).toBeGreaterThan(0);
    expect((await store.loadAdmin(db)).log).toHaveLength(5 + 3);
  });
});

describe("facts", () => {
  test("saves, clears and re-adds a fact", async () => {
    await store.saveFact(db, "shelf", { title: "piranesi", subtitle: "susanna clarke" });
    await store.saveFact(db, "kettle", null);
    expect((await store.loadAdmin(db)).facts).toEqual({ shelf: { title: "piranesi", subtitle: "susanna clarke" }, kettle: null });
    await store.saveFact(db, "kettle", { title: "a new kettle", subtitle: null });
    expect((await store.loadAdmin(db)).facts.kettle).toEqual({ title: "a new kettle", subtitle: null });
  });
});

describe("records", () => {
  const record = { title: "slow morning", artist: "home alone.", audioKey: "audio/a.mp3", coverKey: "covers/a.webp" };

  test("adds an active record at the end of the crate", async () => {
    expect(await store.activeRecordCount(db)).toBe(4);
    const id = await store.createRecord(db, record);
    expect(await store.getRecord(db, id)).toEqual({ id, ...record, position: 5, active: true });
    expect(await store.activeRecordCount(db)).toBe(5);
  });

  test("adds nothing when the crate is full or already holds the record", async () => {
    expect(await store.createRecord(db, record)).toBeGreaterThan(0);
    expect(await store.recordInCrate(db, record)).toBe(true);
    expect(await store.recordInCrate(db, { title: "slow morning", artist: "someone else" })).toBe(false);
    expect(await store.createRecord(db, { ...record, audioKey: "audio/b.mp3", coverKey: "covers/b.webp" })).toBe(0);
    expect(await store.createRecord(db, { ...record, title: "sixth" })).toBeGreaterThan(0);
    expect(await store.createRecord(db, { ...record, title: "seventh" })).toBe(0);
    expect(await store.activeRecordCount(db)).toBe(6);
  });

  test("tells whether a record row uses an audio key", async () => {
    expect(await store.recordWithAudio(db, record.audioKey)).toBe(false);
    await store.createRecord(db, record);
    expect(await store.recordWithAudio(db, record.audioKey)).toBe(true);
    expect(await store.recordWithAudio(db, "audio/other.mp3")).toBe(false);
  });

  test("deactivated records sort after the active ones", async () => {
    expect(await store.setRecordActive(db, 1, false)).toBe(true);
    expect(await store.activeRecordCount(db)).toBe(3);
    expect((await store.loadAdmin(db)).records.map((entry) => [entry.id, entry.active])).toEqual([
      [2, true],
      [3, true],
      [4, true],
      [1, false],
    ]);
  });

  test("moves a record among records of the same state, never past the ends", async () => {
    expect(await store.moveRecord(db, 2, "up")).toBe(true);
    expect((await store.loadAdmin(db)).records.map((entry) => entry.id)).toEqual([2, 1, 3, 4]);
    await store.setRecordActive(db, 1, false);
    await store.moveRecord(db, 3, "up");
    expect((await store.loadAdmin(db)).records.map((entry) => entry.id)).toEqual([3, 2, 4, 1]);
    await store.moveRecord(db, 4, "down");
    expect((await store.loadAdmin(db)).records.map((entry) => entry.id)).toEqual([3, 2, 4, 1]);
    expect(await store.moveRecord(db, 999, "up")).toBe(false);
  });

  test("moves a middle record down, swapping past a deactivated record in a gap", async () => {
    expect(await store.moveRecord(db, 2, "down")).toBe(true);
    expect((await store.loadAdmin(db)).records.map((entry) => [entry.id, entry.position])).toEqual([
      [1, 1],
      [3, 2],
      [2, 3],
      [4, 4],
    ]);
    await store.setRecordActive(db, 3, false);
    await store.moveRecord(db, 1, "down");
    // 1 swaps with 2 (the nearest active record), not with the deactivated 3 at position 2
    expect((await store.loadAdmin(db)).records.map((entry) => [entry.id, entry.position, entry.active])).toEqual([
      [2, 1, true],
      [1, 3, true],
      [4, 4, true],
      [3, 2, false],
    ]);
  });

  test("edits and removes a record", async () => {
    expect(await store.updateRecord(db, 1, { title: "simple things (live)", artist: "loom room" })).toBe(true);
    expect((await store.getRecord(db, 1))?.title).toBe("simple things (live)");
    expect(await store.removeRecord(db, 1)).toBe(true);
    expect(await store.getRecord(db, 1)).toBeNull();
    expect(await store.updateRecord(db, 1, { title: "x", artist: "y" })).toBe(false);
  });

  test("positions are unique (migration 0004)", async () => {
    await expect(
      db.prepare("INSERT INTO records (title, artist, audio_key, cover_key, position) VALUES ('a', 'b', 'audio/x.mp3', 'covers/x.webp', 1)").run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("INSERT INTO items (slug, section, position, text) VALUES ('clash', 'now', 1, 'x')").run(),
    ).rejects.toThrow();
  });
});

describe("photographs", () => {
  test("loadAdmin groups every photograph, published or not, by post, newest post first", async () => {
    const add = (sql: string) => db.prepare(sql).run();
    await add("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES ('old', 100, '1970-01-01', NULL), ('new', 200, '1970-01-02', 'bondi, sydney')");
    const previews = JSON.stringify([{ key: "photos/previews/new-01/s/240.webp", width: 160, height: 240, format: "webp" }]);
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, raw_review, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES ('new-02', 'new', 2, '', 0, 1, '[]', 'k', 1, 1, 1, 's'), ('old-01', 'old', 0, 't', 1, 0, '[]', 'k', 1, 1, 1, 's'), ('new-01', 'new', 1, '', 1, 0, ?, 'k', 1, 1, 1, 's')").bind(previews).run();
    const { photographs } = await store.loadAdmin(db);
    expect(photographs.map((post) => [post.collection, post.date, post.place, post.photos.map((p) => p.id)])).toEqual([
      ["new", "1970-01-02", "bondi, sydney", ["new-01", "new-02"]],
      ["old", "1970-01-01", null, ["old-01"]],
    ]);
    expect(photographs[0].photos).toEqual([
      { id: "new-01", title: "", published: true, rawReview: false, thumb: { url: "/media/photos/previews/new-01/s/240.webp", width: 160, height: 240 } },
      { id: "new-02", title: "", published: false, rawReview: true, thumb: null },
    ]);
  });
});
