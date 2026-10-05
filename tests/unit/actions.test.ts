import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { newMediaKeys } from "../../src/lib/admin/media";
import * as store from "../../src/lib/admin/store";
import { sqliteD1 } from "./sqlite-d1";
import type { ShotOutcome } from "../../workers/snapshots/src/run";

const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2]);
const KEYS = { audioKey: "audio/test.mp3", coverKey: "covers/test.webp" };

// R2 as a map of key to bytes; `failOn` makes puts for matching keys throw
function fakeBucket(failOn?: RegExp) {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    objects,
    put: vi.fn(async (key: string, value: Blob | Uint8Array) => {
      if (failOn?.test(key)) throw new Error("R2 is down");
      objects.set(key, value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value);
      return {};
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) objects.delete(key);
    }),
  };
  return bucket;
}

// The Images binding: the WebP at each quality has the given size, or the input can't be read. It records the options it
// was given, so the tests can pin the 512px WebP the covers are meant to be.
function fakeImages(sizeAt: (quality: number) => number | "unreadable") {
  const qualities: number[] = [];
  const transforms: unknown[] = [];
  const outputs: unknown[] = [];
  return {
    qualities,
    transforms,
    outputs,
    input: () => ({
      transform(options: unknown) {
        transforms.push(options);
        return this;
      },
      async output(options: { quality: number }) {
        const { quality } = options;
        outputs.push(options);
        qualities.push(quality);
        const size = sizeAt(quality);
        if (size === "unreadable") throw new Error("ImagesError 9412: input is not an image");
        return { image: () => new Blob([new Uint8Array(size)]).stream(), contentType: () => "image/webp", response: () => new Response() };
      },
    }),
  };
}

let db: D1Database;
let bucket: ReturnType<typeof fakeBucket>;
let images: ReturnType<typeof fakeImages>;
const deps = (): ActionDeps => ({ db, media: bucket as unknown as R2Bucket, images: images as unknown as ImagesBinding, keys: () => KEYS });

beforeEach(() => {
  db = sqliteD1();
  bucket = fakeBucket();
  images = fakeImages(() => 20_000);
});
afterEach(() => vi.restoreAllMocks());

const submit = (entries: Record<string, string | Blob>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return runAction(form, deps());
};

const itemFields = {
  section: "now",
  slug: "garden-club",
  text: "started the garden club",
  aside: "",
  label_status: "",
  label_era: "",
  label_made_of: "",
  label_text: "",
  label_kind: "",
  label_note: "",
  snapshot_url: "",
};
const idOf = async (slug: string) => String((await db.prepare("SELECT id FROM items WHERE slug = ?").bind(slug).first<{ id: number }>())!.id);
const slugs = async () => (await store.loadAdmin(db)).now.map((item) => item.slug);
const record = (overrides: Record<string, string | Blob> = {}) => ({
  intent: "record.create",
  title: "slow morning",
  artist: "home alone.",
  audio: new File([MP3], "song.mp3"),
  cover: new File([PNG], "cover.png"),
  ...overrides,
});
const addRecords = async (count: number) => {
  for (let i = 0; i < count; i++) await store.createRecord(db, { title: `extra ${i}`, artist: "x", audioKey: `audio/x${i}.mp3`, coverKey: `covers/x${i}.webp` });
};

describe("items", () => {
  test("adds a line and says which section to show", async () => {
    expect(await submit({ intent: "item.create", ...itemFields })).toEqual({ ok: true, section: "now" });
    expect((await slugs()).at(-1)).toBe("garden-club");
  });

  test("a taken slug comes back on the new form with its values", async () => {
    const result = await submit({ intent: "item.create", ...itemFields, slug: "digital-nachos" });
    expect(result).toEqual({
      ok: false,
      section: "now",
      form: "item-new-now",
      errors: { slug: "that slug is taken" },
      values: expect.objectContaining({ slug: "digital-nachos", text: "started the garden club" }),
    });
    expect(await slugs()).toHaveLength(5);
  });

  test("invalid fields come back on the new form of the section they were meant for", async () => {
    expect(await submit({ intent: "item.create", ...itemFields, section: "before", text: "" })).toMatchObject({
      ok: false,
      section: "before",
      form: "item-new-before",
      errors: { text: "the line needs some text" },
    });
  });

  test("saves a line by id, keeping its own slug, and reports one that's gone", async () => {
    const id = await idOf("r4r-with-me");
    expect(await submit({ intent: "item.update", id, ...itemFields, slug: "r4r-with-me", text: "running r4r" })).toEqual({ ok: true, section: "now" });
    expect((await store.loadAdmin(db)).now.find((item) => item.slug === "r4r-with-me")?.text).toBe("running r4r");
    expect(await submit({ intent: "item.update", id: "999", ...itemFields })).toEqual({
      ok: false,
      section: null,
      form: "",
      errors: { form: "that line no longer exists" },
      values: {},
    });
  });

  test("a bad edit comes back on that line's form", async () => {
    const id = await idOf("r4r-with-me");
    expect(await submit({ intent: "item.update", id, ...itemFields, slug: "digital-nachos" })).toMatchObject({ ok: false, form: `item-${id}`, errors: { slug: "that slug is taken" } });
  });

  test("the same line sent twice (a double tap) is added once", async () => {
    expect(await submit({ intent: "item.create", ...itemFields })).toEqual({ ok: true, section: "now" });
    expect(await submit({ intent: "item.create", ...itemFields })).toEqual({ ok: true, section: "now" });
    expect((await slugs()).filter((slug) => slug === "garden-club")).toHaveLength(1);
  });

  test("moves a line", async () => {
    expect(await submit({ intent: "item.move", id: await idOf("canberra-events"), direction: "up", section: "now" })).toEqual({ ok: true, section: "now" });
    expect((await slugs())[0]).toBe("canberra-events");
  });

  test("removing a line needs the box ticked", async () => {
    const id = await idOf("good-people");
    expect(await submit({ intent: "item.remove", id, section: "now" })).toMatchObject({ ok: false, section: "now", form: `item-${id}`, errors: { confirm: "tick the box to remove it" } });
    expect(await submit({ intent: "item.remove", id, section: "now", confirm: "yes" })).toEqual({ ok: true, section: "now" });
    expect(await slugs()).not.toContain("good-people");
  });

  test("removing a line that's already gone counts as removed (a double tap), but a bad id does not", async () => {
    const id = await idOf("good-people");
    const remove = { intent: "item.remove", id, section: "now", confirm: "yes" };
    expect(await submit(remove)).toEqual({ ok: true, section: "now" });
    expect(await submit(remove)).toEqual({ ok: true, section: "now" });
    expect(await submit({ ...remove, id: "0" })).toMatchObject({ ok: false, errors: { form: "that line no longer exists" } });
  });
});

describe("log", () => {
  test("adds, edits and removes an entry", async () => {
    expect(await submit({ intent: "log.create", date: "2026-10-05", precision: "day", text: "shipped." })).toEqual({ ok: true, section: "log" });
    const id = String((await store.loadAdmin(db)).log[0].id);
    expect(await submit({ intent: "log.update", id, date: "2026-11-17", precision: "month", text: "shipped it." })).toEqual({ ok: true, section: "log" });
    expect((await store.loadAdmin(db)).log[0]).toMatchObject({ date: "2026-11-01", text: "shipped it." });
    expect(await submit({ intent: "log.remove", id })).toMatchObject({ ok: false, form: `log-${id}`, errors: { confirm: "tick the box to remove it" } });
    expect(await submit({ intent: "log.remove", id, confirm: "yes" })).toEqual({ ok: true, section: "log" });
  });

  test("removing an entry that's already gone counts as removed (a double tap), but a bad id does not", async () => {
    await submit({ intent: "log.create", date: "2026-10-05", precision: "day", text: "shipped." });
    const id = String((await store.loadAdmin(db)).log[0].id);
    expect(await submit({ intent: "log.remove", id, confirm: "yes" })).toEqual({ ok: true, section: "log" });
    expect(await submit({ intent: "log.remove", id, confirm: "yes" })).toEqual({ ok: true, section: "log" });
    expect(await submit({ intent: "log.remove", id: "abc", confirm: "yes" })).toMatchObject({ ok: false, errors: { form: "that entry no longer exists" } });
  });

  test("the same entry sent twice (a double tap) is saved once", async () => {
    const entry = { intent: "log.create", date: "2026-10-05", precision: "day", text: "shipped." };
    expect(await submit(entry)).toEqual({ ok: true, section: "log" });
    expect(await submit(entry)).toEqual({ ok: true, section: "log" });
    expect((await store.loadAdmin(db)).log.filter((row) => row.text === "shipped.")).toHaveLength(1);
  });

  test("a bad entry comes back on the new entry form", async () => {
    expect(await submit({ intent: "log.create", date: "2026-02-30", precision: "day", text: "x" })).toMatchObject({
      ok: false,
      section: "log",
      form: "log-new",
      errors: { date: "a real date, like 2026-10-04" },
      values: { date: "2026-02-30", precision: "day", text: "x" },
    });
  });
});

describe("lately", () => {
  test("saves and clears facts", async () => {
    expect(await submit({ intent: "fact.save", key: "shelf", title: "piranesi", subtitle: "susanna clarke" })).toEqual({ ok: true, section: "lately" });
    expect(await submit({ intent: "fact.save", key: "kettle", title: "", subtitle: "" })).toEqual({ ok: true, section: "lately" });
    expect((await store.loadAdmin(db)).facts).toEqual({ shelf: { title: "piranesi", subtitle: "susanna clarke" }, kettle: null });
  });

  test("an unknown fact is reported for the page, since it has no form to show it on", async () => {
    expect(await submit({ intent: "fact.save", key: "bogus", title: "x", subtitle: "" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that fact isn't recognised" }, values: {} });
  });

  test("a subtitle without a title comes back on that fact's form", async () => {
    expect(await submit({ intent: "fact.save", key: "shelf", title: "", subtitle: "susanna clarke" })).toMatchObject({ ok: false, form: "fact-shelf", errors: { title: "a title is needed, or clear both to hide it" } });
  });
});

describe("records", () => {
  test("adds a record: the mp3 and a 512px WebP cover go to R2, then the row", async () => {
    expect(await submit(record())).toEqual({ ok: true, section: "records" });
    expect(bucket.objects.get(KEYS.audioKey)).toEqual(MP3);
    expect(bucket.objects.get(KEYS.coverKey)?.length).toBe(20_000);
    expect(bucket.put).toHaveBeenCalledWith(KEYS.audioKey, expect.anything(), { httpMetadata: { contentType: "audio/mpeg" } });
    expect(bucket.put).toHaveBeenCalledWith(KEYS.coverKey, expect.anything(), { httpMetadata: { contentType: "image/webp" } });
    expect(images.transforms).toEqual([{ width: 512, height: 512, fit: "cover" }]);
    expect(images.outputs).toEqual([{ format: "image/webp", quality: 80 }]);
    expect((await store.loadAdmin(db)).records.at(-1)).toMatchObject({ title: "slow morning", artist: "home alone.", ...KEYS, active: true });
  });

  test("steps the cover quality down until it's under 40KB", async () => {
    images = fakeImages((quality) => (quality >= 72 ? 50_000 : 30_000));
    expect(await submit(record())).toEqual({ ok: true, section: "records" });
    expect(images.qualities).toEqual([80, 72, 64]);
    expect(bucket.objects.get(KEYS.coverKey)?.length).toBe(30_000);
  });

  test("a cover that never gets under 40KB, or can't be read, is refused and nothing is kept", async () => {
    images = fakeImages(() => 50_000);
    expect(await submit(record())).toMatchObject({ ok: false, form: "record-new", errors: { cover: "that cover won't shrink under 40KB" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    images = fakeImages(() => "unreadable");
    expect(await submit(record())).toMatchObject({ ok: false, form: "record-new", errors: { cover: "that cover couldn't be read as an image" } });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(await store.activeRecordCount(db)).toBe(4);
  });

  test("files that aren't what they claim come back with messages and the typed values, and nothing is stored", async () => {
    const result = await submit(record({ audio: new File([PNG], "song.mp3"), cover: new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "cover.png") }));
    expect(result).toEqual({
      ok: false,
      section: "records",
      form: "record-new",
      errors: { audio: "that file isn't an mp3", cover: "covers can be JPEG, PNG or WebP" },
      values: { title: "slow morning", artist: "home alone." },
    });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  test("missing details and files are all named at once", async () => {
    expect(await submit({ intent: "record.create", title: "", artist: "home alone." })).toMatchObject({
      ok: false,
      errors: { title: "the record needs a title", audio: "choose an mp3", cover: "choose a cover image" },
    });
  });

  test("the crate holds six", async () => {
    await addRecords(2);
    expect(await submit(record())).toMatchObject({ ok: false, form: "record-new", errors: { form: "the crate holds six records. deactivate one to add another." } });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  test("if storing fails half way, nothing is kept", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    bucket = fakeBucket(/^covers\//);
    expect(await submit(record())).toMatchObject({ ok: false, form: "record-new", errors: { form: "couldn't save that record, so nothing was kept. try again." } });
    expect(bucket.objects.size).toBe(0);
    expect(await store.activeRecordCount(db)).toBe(4);
  });

  test("if the row can't be saved, the stored files are deleted again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db.prepare("CREATE TRIGGER refuse_records BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT, 'D1 is down'); END").run();
    expect(await submit(record())).toMatchObject({ ok: false, errors: { form: "couldn't save that record, so nothing was kept. try again." } });
    expect(bucket.objects.size).toBe(0);
  });

  test("if the rollback's delete fails too, it's logged and the failure is still reported", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    bucket = fakeBucket(/^covers\//);
    bucket.delete.mockRejectedValueOnce(new Error("R2 is down"));
    expect(await submit(record())).toMatchObject({ ok: false, form: "record-new", errors: { form: "couldn't save that record, so nothing was kept. try again." } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("couldn't delete"), expect.any(Error));
  });

  // The insert commits, then the connection drops before D1 answers
  const insertThenThrow = () => {
    const insert = store.createRecord;
    vi.spyOn(store, "createRecord").mockImplementation(async (database, meta) => {
      await insert(database, meta);
      throw new Error("connection dropped");
    });
  };

  test("if the insert throws after the row was written, the record counts as saved and keeps its files", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    insertThenThrow();
    expect(await submit(record())).toEqual({ ok: true, section: "records" });
    expect(await store.recordWithAudio(db, KEYS.audioKey)).toBe(true);
    expect(bucket.delete).not.toHaveBeenCalled();
    expect([...bucket.objects.keys()].sort()).toEqual([KEYS.audioKey, KEYS.coverKey]);
  });

  test("if it can't tell whether the row was written, the files are kept and the failure is reported", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    insertThenThrow();
    vi.spyOn(store, "recordWithAudio").mockRejectedValue(new Error("D1 is down"));
    expect(await submit(record())).toMatchObject({ ok: false, form: "record-new", errors: { form: "couldn't save that record, so nothing was kept. try again." } });
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("couldn't check"), expect.any(Error));
  });

  test("the same record sent twice (a double tap) is added once, uploading once", async () => {
    expect(await submit(record())).toEqual({ ok: true, section: "records" });
    expect(await submit(record())).toEqual({ ok: true, section: "records" });
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(await store.activeRecordCount(db)).toBe(5);
  });

  test("a copy that arrives while this one uploads is kept once, and this one's files are deleted", async () => {
    bucket.put.mockImplementationOnce(async () => {
      await store.createRecord(db, { title: "slow morning", artist: "home alone.", audioKey: "audio/first.mp3", coverKey: "covers/first.webp" });
      return {};
    });
    expect(await submit(record())).toEqual({ ok: true, section: "records" });
    expect((await store.loadAdmin(db)).records.filter((entry) => entry.title === "slow morning")).toHaveLength(1);
    expect(bucket.delete).toHaveBeenCalledWith([KEYS.audioKey, KEYS.coverKey]);
    expect(bucket.objects.size).toBe(0);
  });

  test("if the crate fills while this one uploads, it's refused and its files are deleted", async () => {
    bucket.put.mockImplementationOnce(async () => {
      await addRecords(2);
      return {};
    });
    expect(await submit(record())).toMatchObject({ ok: false, form: "record-new", errors: { form: "the crate holds six records. deactivate one to add another." } });
    expect(bucket.delete).toHaveBeenCalledWith([KEYS.audioKey, KEYS.coverKey]);
    expect(bucket.objects.size).toBe(0);
    expect(await store.activeRecordCount(db)).toBe(6);
  });

  test("edits a record's title and artist", async () => {
    expect(await submit({ intent: "record.update", id: "1", title: "simple things (live)", artist: "loom room" })).toEqual({ ok: true, section: "records" });
    expect((await store.getRecord(db, 1))?.title).toBe("simple things (live)");
    expect(await submit({ intent: "record.update", id: "1", title: "", artist: "loom room" })).toMatchObject({ ok: false, form: "record-1", errors: { title: "the record needs a title" } });
  });

  test("deactivates and activates, but never past six active", async () => {
    expect(await submit({ intent: "record.deactivate", id: "1" })).toEqual({ ok: true, section: "records" });
    expect(await store.activeRecordCount(db)).toBe(3);
    expect(await submit({ intent: "record.activate", id: "1" })).toEqual({ ok: true, section: "records" });
    await submit({ intent: "record.deactivate", id: "1" });
    await addRecords(3);
    expect(await submit({ intent: "record.activate", id: "1" })).toMatchObject({ ok: false, form: "record-1", errors: { form: "the crate holds six records. deactivate one first." } });
  });

  test("activating an active record, or deactivating an inactive one, counts as done (a double tap)", async () => {
    await addRecords(2);
    expect(await store.activeRecordCount(db)).toBe(6);
    expect(await submit({ intent: "record.activate", id: "1" })).toEqual({ ok: true, section: "records" });
    await store.setRecordActive(db, 1, false);
    expect(await submit({ intent: "record.deactivate", id: "1" })).toEqual({ ok: true, section: "records" });
    expect(await store.activeRecordCount(db)).toBe(5);
  });

  test("a record that's gone can't be activated or deactivated", async () => {
    for (const intent of ["record.activate", "record.deactivate"]) {
      expect(await submit({ intent, id: "999" })).toMatchObject({ ok: false, section: null, errors: { form: "that record no longer exists" } });
    }
  });

  test("moves a record", async () => {
    expect(await submit({ intent: "record.move", id: "2", direction: "up" })).toEqual({ ok: true, section: "records" });
    expect((await store.loadAdmin(db)).records[0].id).toBe(2);
    expect(await submit({ intent: "record.move", id: "999", direction: "up" })).toMatchObject({ ok: false, section: null, errors: { form: "that record no longer exists" } });
  });

  test("removing a record needs the box ticked, then deletes its files too", async () => {
    bucket.objects.set("audio/simple-things.mp3", MP3);
    bucket.objects.set("covers/simple-things.webp", PNG);
    expect(await submit({ intent: "record.remove", id: "1" })).toMatchObject({ ok: false, form: "record-1", errors: { confirm: "tick the box to remove it" } });
    expect(await submit({ intent: "record.remove", id: "1", confirm: "yes" })).toEqual({ ok: true, section: "records" });
    expect(await store.getRecord(db, 1)).toBeNull();
    expect(bucket.objects.size).toBe(0);
  });

  test("removing a record that's already gone counts as removed (a double tap), but a bad id does not", async () => {
    expect(await submit({ intent: "record.remove", id: "1", confirm: "yes" })).toEqual({ ok: true, section: "records" });
    expect(await submit({ intent: "record.remove", id: "1", confirm: "yes" })).toEqual({ ok: true, section: "records" });
    expect(await submit({ intent: "record.remove", id: "-3", confirm: "yes" })).toMatchObject({ ok: false, errors: { form: "that record no longer exists" } });
  });
});

describe("snapshots", () => {
  const reshoot = async (answer: ShotOutcome | "gone" | Error | null, id = "1") => {
    const snapshots =
      answer === null
        ? undefined
        : {
            reshoot: vi.fn(async () => {
              if (answer instanceof Error) throw answer;
              return answer;
            }),
          };
    const form = new FormData();
    form.append("intent", "snapshot.reshoot");
    form.append("id", id);
    return { result: await runAction(form, { ...deps(), snapshots }), snapshots };
  };

  test("a re-shoot that captures the page is saved", async () => {
    const { result, snapshots } = await reshoot("ok");
    expect(result).toEqual({ ok: true, section: "snapshots" });
    expect(snapshots!.reshoot).toHaveBeenCalledWith(1);
  });

  test("a capture that fails says why, on its line", async () => {
    expect((await reshoot("challenge")).result).toEqual({
      ok: false,
      section: "snapshots",
      form: "shot-1",
      errors: { form: "couldn't capture it: a bot check blocked it" },
      values: {},
    });
    expect((await reshoot("too-small")).result).toMatchObject({ errors: { form: "couldn't capture it: the capture came out blank" } });
  });

  test("a line that changed while it was captured asks for another go", async () => {
    expect((await reshoot("discarded")).result).toMatchObject({ form: "shot-1", errors: { form: "the line changed while it was being captured. try again." } });
  });

  test("a line with no page to snapshot any more is a message for the page", async () => {
    expect((await reshoot("gone")).result).toMatchObject({ section: null, form: "", errors: { form: "that line has no page to snapshot any more" } });
  });

  test("a snapshots Worker that doesn't answer, or isn't bound, says so on the line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const answer of [new Error('Worker "curiousgeorge-snapshots" not found'), null]) {
      expect((await reshoot(answer)).result).toMatchObject({
        section: "snapshots",
        form: "shot-1",
        errors: { form: "the snapshots worker didn't answer. try again in a minute." },
      });
    }
    expect(error).toHaveBeenCalledTimes(2);
  });

  test("an id that isn't one is gone", async () => {
    expect((await reshoot("ok", "abc")).result).toMatchObject({ section: null, errors: { form: "that line no longer exists" } });
  });
});

test("an unknown intent is reported for the page", async () => {
  expect(await submit({ intent: "drop.tables" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that action isn't recognised" }, values: {} });
});

test("new media keys are unique, matched and under the prefixes /media serves", () => {
  const keys = newMediaKeys();
  expect(keys.audioKey).toMatch(/^audio\/[0-9a-hjkmnp-tv-z]{26}\.mp3$/);
  expect(keys.coverKey).toBe(keys.audioKey.replace(/^audio\/(.+)\.mp3$/, "covers/$1.webp"));
  expect(newMediaKeys().audioKey).not.toBe(keys.audioKey);
});
