import { beforeEach, describe, expect, test } from "vitest";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { sqliteD1 } from "./sqlite-d1";

const SECRET = "1".repeat(64);
const NONCE = "AbCdEfGhIjKlMnOpQrStUv";
let db: D1Database;

const deps = (over: Partial<ActionDeps> = {}): ActionDeps => ({ db, media: {} as R2Bucket, images: {} as ImagesBinding, photoLinkSecret: SECRET, origin: "https://curiousgeorge.dev", ...over });
const submit = (entries: Record<string, string>, over: Partial<ActionDeps> = {}) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return runAction(form, deps(over));
};
const grants = async () => (await db.prepare("SELECT id, photo_id, expires_at, note, request_nonce, revoked_at FROM photo_download_grants").all()).results as Record<string, unknown>[];
const issue = (over: Record<string, string> = {}) => submit({ intent: "link.issue", days: "7", note: "for mum", nonce: NONCE, ...over });

beforeEach(() => {
  db = sqliteD1();
});

test("a stale issue-link form is refused without creating a bearer grant", async () => {
  expect(await issue()).toMatchObject({ ok: false, errors: { form: "download links have been replaced by approved email sign-in. reload the page." } });
  expect(await grants()).toEqual([]);
});

describe("revoking a link", () => {
  test("needs the box ticked; ticked, it's saved, and a second revoke is still saved", async () => {
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES (?, NULL, 9999999999)").bind(id).run();
    expect(await submit({ intent: "link.revoke", id: String(id) })).toEqual({ ok: false, section: "links", form: `link-${id}`, errors: { confirm: "tick the box to remove it" }, values: {} });
    expect(await submit({ intent: "link.revoke", id: String(id), confirm: "yes" })).toEqual({ ok: true, section: "links" });
    expect((await grants())[0].revoked_at).not.toBeNull();
    expect(await submit({ intent: "link.revoke", id: String(id), confirm: "yes" })).toEqual({ ok: true, section: "links" });
  });

  test("a photo-scoped grant (a print order's) isn't this screen's to revoke", async () => {
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES ('fx-01', 'fx', 1, '', 1, '[]', 'k', 1, 1, 1, 's')").run();
    const order = "b0000000-0000-4000-8000-000000000001";
    await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES (?, 'fx-01', 9999999999)").bind(order).run();
    expect(await submit({ intent: "link.revoke", id: order, confirm: "yes" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that link no longer exists" }, values: {} });
    expect((await grants()).find((grant) => grant.id === order)!.revoked_at).toBeNull();
  });

  test("a malformed id is a message for the page", async () => {
    expect(await submit({ intent: "link.revoke", id: "nope", confirm: "yes" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that link no longer exists" }, values: {} });
  });
});
