import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionDeps } from "../../src/lib/admin/actions";
import { submitForm, type SubmitOutcome } from "../../src/lib/admin/submit";
import { sqliteD1 } from "./sqlite-d1";

let db: D1Database;
// The bucket and images are never reached by lately's forms
const deps = (): ActionDeps => ({ db, media: {} as R2Bucket, images: {} as ImagesBinding });

const formOf = (entries: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return form;
};
const SHELF = { intent: "fact.save", key: "shelf", title: "piranesi", subtitle: "susanna clarke" };

const cache = (invalidate: (options: { tags: string[] }) => Promise<unknown> = async () => {}) => ({ invalidate: vi.fn(invalidate) });
const waiter = () => {
  const promises: Promise<unknown>[] = [];
  return { promises, waitUntil: vi.fn((promise: Promise<unknown>) => void promises.push(promise)) };
};
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  db = sqliteD1();
});
afterEach(() => vi.restoreAllMocks());

describe("submitForm", () => {
  test("a save redirects to its section once the logbook is purged", async () => {
    const purge = cache();
    const { waitUntil } = waiter();
    const outcome = await submitForm(formOf(SHELF), deps(), purge, waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=lately#lately" });
    expect(purge.invalidate).toHaveBeenCalledWith({ tags: ["logbook"] });
    expect(await db.prepare("SELECT title FROM facts WHERE key = 'shelf'").first("title")).toBe("piranesi");
  });

  test("a save whose purge fails still redirects, and says the logbook will catch up", async () => {
    const error = quiet();
    const outcome = await submitForm(formOf(SHELF), deps(), cache(() => Promise.reject(new TypeError("cache.purge is not a function"))), waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=lately&later=1#lately" });
    expect(error).toHaveBeenCalledTimes(1);
  });

  test("a form that doesn't pass its checks comes back as a 422 with the action's failure, and nothing is purged", async () => {
    const purge = cache();
    const outcome = await submitForm(formOf({ ...SHELF, title: "" }), deps(), purge, waiter().waitUntil);
    expect(outcome).toEqual({
      failure: {
        ok: false,
        section: "lately",
        form: "fact-shelf",
        errors: { title: "a title is needed, or clear both to hide it" },
        values: { key: "shelf", title: "", subtitle: "susanna clarke" },
      },
      status: 422,
    });
    expect(purge.invalidate).not.toHaveBeenCalled();
  });

  test("an unexpected throw is logged once and comes back as a 500 with a message for the top of the page", async () => {
    const error = quiet();
    const broken = new Proxy({}, { get: () => { throw new Error("D1 is down"); } }) as D1Database;
    const purge = cache();
    const outcome = await submitForm(formOf(SHELF), { ...deps(), db: broken }, purge, waiter().waitUntil);
    expect(outcome).toEqual({
      failure: { ok: false, section: null, form: "", errors: { form: "couldn't save that. try again." }, values: {} },
      status: 500,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("admin: a save failed unexpectedly", expect.objectContaining({ message: "D1 is down" }));
    expect(purge.invalidate).not.toHaveBeenCalled();
  });

  test("a form that couldn't be read is a 422 with nothing to finish", async () => {
    const { waitUntil } = waiter();
    const outcome = await submitForm(null, deps(), cache(), waitUntil);
    expect(outcome).toEqual({
      failure: { ok: false, section: null, form: "", errors: { form: "that form couldn't be read. try again." }, values: {} },
      status: 422,
    });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  test("the write and the purge are handed to waitUntil as one promise, so a cancelled request still finishes both", async () => {
    let finishPurge!: () => void;
    const purge = cache(() => new Promise<void>((resolve) => (finishPurge = resolve)));
    const { waitUntil, promises } = waiter();
    const pending = submitForm(formOf(SHELF), deps(), purge, waitUntil);

    // Let the write run and the purge start; the promise handed over must still be waiting on the purge
    await vi.waitFor(() => expect(purge.invalidate).toHaveBeenCalledTimes(1));
    expect(waitUntil).toHaveBeenCalledTimes(1);
    let settled = false;
    void promises[0].then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    finishPurge();
    await promises[0];
    expect(settled).toBe(true);
    expect(await pending).toEqual<SubmitOutcome>({ redirect: "/admin/?saved=lately#lately" });
  });

  test("the promise handed to waitUntil never rejects, even when the save throws", async () => {
    quiet();
    const broken = new Proxy({}, { get: () => { throw new Error("D1 is down"); } }) as D1Database;
    const { waitUntil, promises } = waiter();
    await submitForm(formOf(SHELF), { ...deps(), db: broken }, cache(), waitUntil);
    await expect(promises[0]).resolves.toMatchObject({ status: 500 });
  });
});
