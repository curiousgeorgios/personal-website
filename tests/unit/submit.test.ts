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

  test("a photographs save purges the gallery and the home page, and redirects to its section", async () => {
    await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES ('post', 1738488468, '2025-02-02', NULL)").run();
    const purge = cache();
    const outcome = await submitForm(formOf({ intent: "post.place", collection: "post", place: "bondi, sydney" }), deps(), purge, waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=photographs#photographs" });
    expect(purge.invalidate).toHaveBeenCalledWith({ tags: ["photos", "logbook"] });
  });

  test("hiding a photograph also purges its previews; publishing purges only the pages", async () => {
    await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES ('post', 1738488468, '2025-02-02', NULL)").run();
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES ('post-01', 'post', 1, '', 1, '[]', 'k', 1, 1, 1, 's')").run();
    const purge = cache();
    expect(await submitForm(formOf({ intent: "photo.hide", id: "post-01" }), deps(), purge, waiter().waitUntil)).toEqual({ redirect: "/admin/?saved=photographs#photographs" });
    expect(purge.invalidate).toHaveBeenCalledWith({ tags: ["photos", "logbook", "photo-post-01"] });
  });

  test("issuing a link answers with it, without a redirect or a purge", async () => {
    const purge = cache();
    const form = formOf({ intent: "link.issue", days: "7", note: "", nonce: "AbCdEfGhIjKlMnOpQrStUv" });
    const outcome = await submitForm(form, { ...deps(), photoLinkSecret: "1".repeat(64), origin: "https://curiousgeorge.dev" }, purge, waiter().waitUntil);
    expect(outcome).toEqual({ issued: { url: expect.stringMatching(/^https:\/\/curiousgeorge\.dev\/photos\/downloads\?token=/) } });
    expect(purge.invalidate).not.toHaveBeenCalled();
  });

  test("revoking a link redirects to its section and purges nothing", async () => {
    await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES ('a0000000-0000-4000-8000-000000000009', NULL, 9999999999)").run();
    const purge = cache();
    const outcome = await submitForm(formOf({ intent: "link.revoke", id: "a0000000-0000-4000-8000-000000000009", confirm: "yes" }), deps(), purge, waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=links#links" });
    expect(purge.invalidate).not.toHaveBeenCalled();
  });

  test("a retry redirects to the orders section with its note, purging nothing", async () => {
    await db.prepare("INSERT INTO print_orders (id, country, print_total, delivery_amount, status, livemode, created_at, updated_at) VALUES ('01k6x00000000000000000000a', 'AU', 1, 1, 'needs_attention', 0, 1, 1)").run();
    const purge = cache();
    const placeLater = vi.fn();
    const outcome = await submitForm(formOf({ intent: "order.retry", id: "01k6x00000000000000000000a" }), { ...deps(), orders: { placeLater, retryWindow: 86_400 } }, purge, waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=orders&note=retry#orders" });
    expect(purge.invalidate).not.toHaveBeenCalled();
    expect(placeLater).toHaveBeenCalledWith("01k6x00000000000000000000a");
  });

  test("a buffer save redirects to the orders section and purges nothing: only the next quote reads it", async () => {
    const purge = cache();
    const outcome = await submitForm(formOf({ intent: "prints.buffer", buffer: "10" }), deps(), purge, waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=orders#orders" });
    expect(purge.invalidate).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT value FROM print_settings WHERE key = 'delivery_buffer'").first("value")).toBe("0.1");
  });
});
