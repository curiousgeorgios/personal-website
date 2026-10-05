import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { KEEP_SUPERSEDED_MS, reshootOne, runAll, sweep, type RunDeps } from "../../workers/snapshots/src/run";
import { fakeBrowser, type FakeSite } from "./fake-browser";
import { sqliteD1 } from "./sqlite-d1";

const NOW = new Date("2026-10-04T17:00:05.000Z");
const ID = "01k6d4x3n9e5r2q7w8y0z1a2b3";

// R2 as a map; `uploaded` and `customMetadata` can be set per object for the sweep
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string; uploaded: Date; customMetadata?: Record<string, string> }>();
  return {
    objects,
    seed(key: string, uploaded: Date, customMetadata?: Record<string, string>) {
      objects.set(key, { bytes: new Uint8Array(1), uploaded, customMetadata });
    },
    put: vi.fn(async (key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => {
      objects.set(key, { bytes, type: options?.httpMetadata?.contentType, uploaded: NOW, customMetadata: options?.customMetadata });
      return {};
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) objects.delete(key);
    }),
    // Like R2, a listing carries custom metadata only when it's asked for
    list: vi.fn(async ({ prefix, include }: { prefix?: string; cursor?: string; include?: string[] }) => ({
      objects: [...objects]
        .filter(([key]) => key.startsWith(prefix ?? ""))
        .map(([key, object]) => ({ key, uploaded: object.uploaded, ...(include?.includes("customMetadata") && object.customMetadata ? { customMetadata: object.customMetadata } : {}) })),
      truncated: false,
    })),
  };
}

const fakeImages = {
  input: () => ({
    transform() {
      return this;
    },
    async output({ format }: { format: string }) {
      return { image: () => new Blob([new Uint8Array(2_000)]).stream(), contentType: () => format, response: () => new Response() };
    },
  }),
};

// A D1 whose update that moves a line to a capture rejects, as when the connection drops: `committed` says whether the
// write went through first (it can do either), and `rereadFails` makes the check of what the line names fail as well
function flakyDb(real: D1Database, { committed, rereadFails = false }: { committed: boolean; rereadFails?: boolean }): D1Database {
  const lost = () => new Error("D1_ERROR: Network connection lost.");
  const failing = (statement: D1PreparedStatement, run: (statement: D1PreparedStatement) => Promise<never>): D1PreparedStatement =>
    ({ bind: (...values: unknown[]) => failing(statement.bind(...values), run), run: () => run(statement), first: () => run(statement) }) as unknown as D1PreparedStatement;
  return {
    prepare(sql: string) {
      const statement = real.prepare(sql);
      if (sql.includes("snapshot_status = 'ok'")) {
        return failing(statement, async (bound) => {
          if (committed) await bound.run();
          throw lost();
        });
      }
      if (rereadFails && sql.startsWith("SELECT snapshot_key FROM items WHERE id")) {
        return failing(statement, async () => {
          throw lost();
        });
      }
      return statement;
    },
  } as unknown as D1Database;
}

let db: D1Database;
let bucket: ReturnType<typeof fakeBucket>;
let browser: ReturnType<typeof fakeBrowser>;
let site: (url: string) => FakeSite;
const deps = (): RunDeps => ({
  db,
  media: bucket as unknown as R2Bucket,
  images: fakeImages as unknown as ImagesBinding,
  launch: async () => {
    browser = fakeBrowser(site);
    launches += 1;
    return browser;
  },
  now: () => NOW,
  id: () => ID,
});
let launches = 0;
const row = (slug: string) =>
  db.prepare("SELECT id, snapshot_url, snapshot_key, snapshot_at, snapshot_status FROM items WHERE slug = ?").bind(slug).first<{
    id: number;
    snapshot_url: string | null;
    snapshot_key: string | null;
    snapshot_at: string | null;
    snapshot_status: string | null;
  }>();

beforeEach(() => {
  db = sqliteD1();
  bucket = fakeBucket();
  launches = 0;
  site = () => ({});
});
afterEach(() => vi.restoreAllMocks());

test("shoots every line with a page to snapshot in one session, files six variants and points the line at them", async () => {
  expect(await runAll(deps())).toEqual({ "digital-nachos": "ok", "canberra-events": "ok", "linear-gratis": "ok", onestack: "ok" });
  expect(launches).toBe(1);
  expect(browser.closed).toBe(true);
  expect(await row("canberra-events")).toMatchObject({
    snapshot_key: `snapshots/canberra-events-${ID}`,
    snapshot_at: "2026-10-04T17:00:05.000Z",
    snapshot_status: "ok",
  });
  const files = [...bucket.objects.keys()].filter((key) => key.startsWith(`snapshots/canberra-events-${ID}`));
  expect(files.sort()).toEqual(["480", "960", "1920"].flatMap((width) => [`snapshots/canberra-events-${ID}-${width}.avif`, `snapshots/canberra-events-${ID}-${width}.webp`]).sort());
  expect(bucket.objects.get(`snapshots/canberra-events-${ID}-480.avif`)?.type).toBe("image/avif");
  expect(bucket.objects.size).toBe(24);
});

test("a failed capture keeps the old snapshot and records why", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.prepare("UPDATE items SET snapshot_key = 'snapshots/digital-nachos-old', snapshot_at = '2026-10-01T17:00:00.000Z', snapshot_status = 'ok' WHERE slug = 'digital-nachos'").run();
  site = (url) => (url.includes("digitalnachos") ? { status: 503 } : {});
  const outcomes = await runAll(deps());
  expect(outcomes["digital-nachos"]).toBe("http-error");
  expect(await row("digital-nachos")).toMatchObject({ snapshot_key: "snapshots/digital-nachos-old", snapshot_at: "2026-10-01T17:00:00.000Z", snapshot_status: "http-error" });
  expect([...bucket.objects.keys()].some((key) => key.startsWith("snapshots/digital-nachos-"))).toBe(false);
  expect(console.error).toHaveBeenCalledWith("snapshots: digital-nachos failed (http-error): status 503");
});

test("a line given a new address while it was captured keeps what George saved, and the capture's files go", async () => {
  site = (url) =>
    url.includes("canberra.events")
      ? { during: async () => void (await db.prepare("UPDATE items SET snapshot_url = 'https://canberra.events/new', snapshot_key = NULL WHERE slug = 'canberra-events'").run()) }
      : {};
  const outcomes = await runAll(deps());
  expect(outcomes["canberra-events"]).toBe("discarded");
  expect(await row("canberra-events")).toMatchObject({ snapshot_url: "https://canberra.events/new", snapshot_key: null });
  expect([...bucket.objects.keys()].some((key) => key.startsWith("snapshots/canberra-events-"))).toBe(false);
});

test("a line removed while it was captured leaves no files behind", async () => {
  site = (url) => (url.includes("linear.gratis") ? { during: async () => void (await db.prepare("DELETE FROM items WHERE slug = 'linear-gratis'").run()) } : {});
  expect((await runAll(deps()))["linear-gratis"]).toBe("discarded");
  expect([...bucket.objects.keys()].some((key) => key.startsWith("snapshots/linear-gratis-"))).toBe(false);
});

test("one line's unexpected error doesn't stop the others, and the session still closes", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  site = (url) => (url.includes("digitalnachos") ? { broken: true } : {});
  const outcomes = await runAll(deps());
  expect(outcomes["digital-nachos"]).toBe("error");
  expect(outcomes["canberra-events"]).toBe("ok");
  expect(browser.closed).toBe(true);
  // the error itself is logged, so its stack reaches Workers Logs
  expect(console.error).toHaveBeenCalledWith("snapshots: digital-nachos errored:", expect.any(Error));
});

test("re-shoots one line by id, and says when it has no page to snapshot", async () => {
  const canberra = (await row("canberra-events"))!.id;
  const kpmg = (await db.prepare("SELECT id FROM items WHERE slug = 'kpmg'").first<{ id: number }>())!.id;
  expect(await reshootOne(deps(), canberra)).toBe("ok");
  expect(browser.closed).toBe(true);
  expect(await reshootOne(deps(), kpmg)).toBe("gone");
  expect(await reshootOne(deps(), 999)).toBe("gone");
  expect(launches).toBe(1); // no session for a line with nothing to shoot
});

test("deletes files no line points at once they're a week old, and nothing else", async () => {
  const old = new Date(NOW.getTime() - KEEP_SUPERSEDED_MS - 1);
  const recent = new Date(NOW.getTime() - KEEP_SUPERSEDED_MS + 60_000);
  await db.prepare("UPDATE items SET snapshot_key = 'snapshots/digital-nachos-current' WHERE slug = 'digital-nachos'").run();
  for (const width of [480, 960, 1920]) {
    for (const format of ["avif", "webp"]) {
      bucket.seed(`snapshots/digital-nachos-current-${width}.${format}`, old); // in use: kept, however old
      bucket.seed(`snapshots/digital-nachos-superseded-${width}.${format}`, old); // superseded a week ago: deleted
      bucket.seed(`snapshots/canberra-events-yesterday-${width}.${format}`, recent); // superseded lately: kept for now
    }
  }
  bucket.seed("snapshots/notes.txt", old); // not a variant: left alone
  bucket.seed("covers/simple-things.webp", old); // not a snapshot at all
  expect(await sweep(deps())).toBe(6);
  expect([...bucket.objects.keys()].filter((key) => key.includes("superseded"))).toEqual([]);
  expect(bucket.objects.size).toBe(14);
});

test("a capture is kept for a week after the next one replaced it, however old it is", async () => {
  const previous = "snapshots/canberra-events-01k00000000000000000000000";
  const current = "snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3";
  const older = "snapshots/canberra-events-01j00000000000000000000000";
  await db.prepare("UPDATE items SET snapshot_key = ? WHERE slug = 'canberra-events'").bind(current).run();
  const at = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  for (const width of [480, 960, 1920]) {
    for (const format of ["avif", "webp"]) {
      bucket.seed(`${older}-${width}.${format}`, at(60)); // replaced 30 days ago by `previous`: deleted
      bucket.seed(`${previous}-${width}.${format}`, at(30)); // replaced just now by `current`: kept for a week
      bucket.seed(`${current}-${width}.${format}`, at(0));
    }
  }
  expect(await sweep(deps())).toBe(6);
  expect([...bucket.objects.keys()].some((key) => key.startsWith(older))).toBe(false);
  expect([...bucket.objects.keys()].filter((key) => key.startsWith(previous))).toHaveLength(6);
});

test("an upload that fails part-way deletes the files already stored and leaves the line as it was", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const store = bucket.put.getMockImplementation()!;
  let puts = 0;
  bucket.put.mockImplementation(async (...args) => {
    if (++puts === 4) throw new Error("R2 is down");
    return store(...args);
  });
  const outcomes = await runAll(deps());
  // onestack comes first in section order, so its fourth file is the one that fails
  expect(outcomes).toEqual({ "digital-nachos": "ok", "canberra-events": "ok", "linear-gratis": "ok", onestack: "error" });
  expect([...bucket.objects.keys()].some((key) => key.startsWith("snapshots/onestack-"))).toBe(false);
  expect(await row("onestack")).toMatchObject({ snapshot_key: null, snapshot_at: null, snapshot_status: null });
  expect(bucket.objects.size).toBe(18);
});

test("a listing that comes in pages is read to the end before anything is judged superseded", async () => {
  const day = 24 * 60 * 60 * 1000;
  const first = "snapshots/canberra-events-01j00000000000000000000000";
  const second = "snapshots/canberra-events-01k00000000000000000000000";
  await db.prepare("UPDATE items SET snapshot_key = ? WHERE slug = 'canberra-events'").bind(second).run();
  const page = (base: string, uploaded: Date) => ["avif", "webp"].map((format) => ({ key: `${base}-480.${format}`, uploaded }));
  bucket.seed(`${first}-480.avif`, new Date(NOW.getTime() - 10 * day));
  bucket.seed(`${first}-480.webp`, new Date(NOW.getTime() - 10 * day));
  bucket.seed(`${second}-480.avif`, new Date(NOW.getTime() - day));
  bucket.seed(`${second}-480.webp`, new Date(NOW.getTime() - day));
  bucket.list.mockImplementation(async ({ cursor }: { prefix?: string; cursor?: string }) =>
    cursor === "next"
      ? { objects: page(second, new Date(NOW.getTime() - day)), truncated: false }
      : { objects: page(first, new Date(NOW.getTime() - 10 * day)), truncated: true, cursor: "next" },
  );
  // the first capture was replaced a day ago by the one on the second page, so it stays; judged alone it would go
  expect(await sweep(deps())).toBe(0);
  expect(bucket.list).toHaveBeenCalledTimes(2);
  expect(bucket.objects.size).toBe(4);
});

test("a failed capture of a line given a new address while it was captured records nothing and says it was discarded", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  site = (url) =>
    url.includes("canberra.events")
      ? { status: 503, during: async () => void (await db.prepare("UPDATE items SET snapshot_url = 'https://canberra.events/new' WHERE slug = 'canberra-events'").run()) }
      : {};
  expect((await runAll(deps()))["canberra-events"]).toBe("discarded");
  expect(await row("canberra-events")).toMatchObject({ snapshot_url: "https://canberra.events/new", snapshot_status: null });
});

test("a failed capture of a line removed while it was captured says it was discarded", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  site = (url) => (url.includes("linear.gratis") ? { status: 503, during: async () => void (await db.prepare("DELETE FROM items WHERE slug = 'linear-gratis'").run()) } : {});
  expect((await runAll(deps()))["linear-gratis"]).toBe("discarded");
});

test("an update that commits and then rejects leaves the line and the files it names alone", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const outcomes = await runAll({ ...deps(), db: flakyDb(db, { committed: true }) });
  expect(outcomes).toEqual({ "digital-nachos": "error", "canberra-events": "error", "linear-gratis": "error", onestack: "error" });
  expect(await row("canberra-events")).toMatchObject({ snapshot_key: `snapshots/canberra-events-${ID}`, snapshot_status: "ok" });
  const files = [...bucket.objects.keys()].filter((key) => key.startsWith(`snapshots/canberra-events-${ID}`));
  expect(files).toHaveLength(6);
  expect(bucket.objects.size).toBe(24);
});

test("an update that rejects before it commits deletes the files, since no line names them", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const outcomes = await runAll({ ...deps(), db: flakyDb(db, { committed: false }) });
  expect(outcomes["canberra-events"]).toBe("error");
  expect(await row("canberra-events")).toMatchObject({ snapshot_key: null, snapshot_status: null });
  expect(bucket.objects.size).toBe(0);
});

test("when the update rejects and what the line names can't be read either, the files are left for the clean-up", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const outcomes = await runAll({ ...deps(), db: flakyDb(db, { committed: true, rereadFails: true }) });
  expect(outcomes["canberra-events"]).toBe("error");
  expect(bucket.objects.size).toBe(24);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("canberra-events couldn't check"), expect.any(Error));
});

test("a clean-up delete that fails is logged, and the capture is still discarded", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  site = (url) =>
    url.includes("canberra.events")
      ? { during: async () => void (await db.prepare("UPDATE items SET snapshot_url = 'https://canberra.events/new' WHERE slug = 'canberra-events'").run()) }
      : {};
  bucket.delete.mockRejectedValueOnce(new Error("R2 is down"));
  expect((await runAll(deps()))["canberra-events"]).toBe("discarded");
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("canberra-events couldn't delete"), expect.any(Error));
});

test("a clean-up that fails doesn't lose the outcomes of the run", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  bucket.list.mockRejectedValue(new Error("R2 is down"));
  expect(await runAll(deps())).toEqual({ "digital-nachos": "ok", "canberra-events": "ok", "linear-gratis": "ok", onestack: "ok" });
  expect(console.error).toHaveBeenCalledWith("snapshots: clean-up failed:", expect.any(Error));
});

test("a line given another slug keeps its old capture for a week after the new one, however old the old one is", async () => {
  const day = 24 * 60 * 60 * 1000;
  const id = (await row("canberra-events"))!.id;
  const old = "snapshots/canberra-events-01j00000000000000000000000";
  for (const width of [480, 960, 1920]) {
    for (const format of ["avif", "webp"]) bucket.seed(`${old}-${width}.${format}`, new Date(NOW.getTime() - 30 * day), { item: String(id) });
  }
  await db.prepare("UPDATE items SET slug = 'canberra-nights', snapshot_key = ? WHERE id = ?").bind(old, id).run();
  expect((await runAll(deps()))["canberra-nights"]).toBe("ok");
  expect(await row("canberra-nights")).toMatchObject({ snapshot_key: `snapshots/canberra-nights-${ID}` });
  const left = () => [...bucket.objects.keys()].filter((key) => key.startsWith(old));
  expect(left()).toHaveLength(6); // replaced just now, though its own upload is a month old
  const later = new Date(NOW.getTime() + KEEP_SUPERSEDED_MS + 1);
  expect(await sweep({ ...deps(), now: () => later })).toBe(6);
  expect(left()).toEqual([]);
  expect([...bucket.objects.keys()].filter((key) => key.startsWith(`snapshots/canberra-nights-${ID}`))).toHaveLength(6); // the line's own is never deleted
});
