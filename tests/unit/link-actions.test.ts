import { beforeEach, describe, expect, test } from "vitest";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { verifyPhotoToken } from "../../src/lib/photos/tokens";
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

describe("issuing a link", () => {
  test("answers with it once, signed for the days asked; the grant keeps its note and nonce but never the token", async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await issue();
    expect(result).toMatchObject({ ok: true, section: "links", issued: { url: expect.stringMatching(/^https:\/\/curiousgeorge\.dev\/photos\/downloads\?token=/) } });
    const token = new URL((result as { issued: { url: string } }).issued.url).searchParams.get("token")!;
    const [grant] = await grants();
    expect(await verifyPhotoToken(SECRET, token)).toEqual({ grantId: grant.id, photoId: null, expiresAt: grant.expires_at });
    expect(Number(grant.expires_at) - before).toBeGreaterThanOrEqual(7 * 86400);
    expect(Number(grant.expires_at) - before).toBeLessThanOrEqual(7 * 86400 + 5);
    expect(grant).toMatchObject({ photo_id: null, note: "for mum", request_nonce: NONCE, revoked_at: null });
    expect(JSON.stringify(await grants())).not.toContain(token);
  });

  test("the same form sent again (a double tap, a reload) makes no second link, and says so", async () => {
    await issue();
    expect(await issue()).toEqual({ ok: true, section: "links", issued: { repeat: true } });
    expect(await grants()).toHaveLength(1);
    expect(await issue({ nonce: "ZyXwVuTsRqPoNmLkJiHgFe" })).toMatchObject({ issued: { url: expect.any(String) } });
    expect(await grants()).toHaveLength(2);
  });

  test("takes 1 to 30 days and a one-line note of 60 characters at most", async () => {
    for (const days of ["0", "31", "abc", "", "7.5"]) {
      expect(await issue({ days })).toEqual({ ok: false, section: "links", form: "link-new", errors: { days: "a number of days from 1 to 30" }, values: { days, note: "for mum" } });
    }
    expect(await issue({ note: "x".repeat(61) })).toMatchObject({ errors: { note: "60 characters at most" } });
    expect(await issue({ note: "for\tmum" })).toMatchObject({ errors: { note: "one line of plain text" } });
    expect(await issue({ days: "30", note: "" })).toMatchObject({ ok: true });
    expect((await grants())[0]).toMatchObject({ note: null });
  });

  test("a form without a proper nonce is out of date: a message for the page, and nothing made", async () => {
    expect(await issue({ nonce: "short" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that form is out of date. reload the page and try again." }, values: {} });
    expect(await grants()).toHaveLength(0);
  });

  test("without the signing key nothing is made, and the form says why", async () => {
    expect(await submit({ intent: "link.issue", days: "7", note: "", nonce: NONCE }, { photoLinkSecret: undefined })).toEqual({
      ok: false, section: "links", form: "link-new", errors: { form: "links can't be made until PHOTO_LINK_SECRET is set." }, values: { days: "7", note: "" },
    });
    expect(await grants()).toHaveLength(0);
  });
});

describe("revoking a link", () => {
  test("needs the box ticked; ticked, it's saved, and a second revoke is still saved", async () => {
    await issue();
    const [{ id }] = await grants();
    expect(await submit({ intent: "link.revoke", id: String(id) })).toEqual({ ok: false, section: "links", form: `link-${id}`, errors: { confirm: "tick the box to remove it" }, values: {} });
    expect(await submit({ intent: "link.revoke", id: String(id), confirm: "yes" })).toEqual({ ok: true, section: "links" });
    expect((await grants())[0].revoked_at).not.toBeNull();
    expect(await submit({ intent: "link.revoke", id: String(id), confirm: "yes" })).toEqual({ ok: true, section: "links" });
  });

  test("a malformed id is a message for the page", async () => {
    expect(await submit({ intent: "link.revoke", id: "nope", confirm: "yes" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that link no longer exists" }, values: {} });
  });
});
