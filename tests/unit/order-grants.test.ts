import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadAdmin } from "../../src/lib/admin/store";
import { downloadPhoto } from "../../src/lib/photos/download";
import { insertGrant, issueOrderGrant, ORDER_GRANT_SECONDS, revokeCatalogueLink, revokeOrderGrants } from "../../src/lib/photos/store";
import { signPhotoToken, verifyPhotoToken } from "../../src/lib/photos/tokens";
import { NOW, PHOTO_KEY, printDb } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";
let db: D1Database;
let errors: ReturnType<typeof vi.spyOn>;

const bucket = () =>
  ({
    head: vi.fn(async () => ({ size: 1000, httpEtag: '"e"', httpMetadata: { contentType: "image/jpeg" } })),
    get: vi.fn(async () => ({ size: 1000, httpEtag: '"e"', httpMetadata: { contentType: "image/jpeg" }, body: new Blob([new Uint8Array(1000)]).stream() })),
  }) as unknown as R2Bucket;
const get = (url: string) => new Request(url);

beforeEach(async () => {
  db = await printDb();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("order grants", () => {
  test("an order grant is scoped to one photo, carries its order and links to the master's route", async () => {
    const link = await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 72 * 3600, "https://curiousgeorge.dev", NOW);
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe("https://curiousgeorge.dev/photos/downloads/fixture-b-01");
    const token = await verifyPhotoToken(PHOTO_KEY, url.searchParams.get("token")!, NOW);
    expect(token).toMatchObject({ photoId: "fixture-b-01", expiresAt: NOW + 72 * 3600 });
    expect(await db.prepare("SELECT photo_id, order_id FROM photo_download_grants WHERE id = ?").bind(token!.grantId).first()).toEqual({ photo_id: "fixture-b-01", order_id: ORDER });
  });

  test("it serves its photo's master after the photo is hidden; a catalogue link doesn't", async () => {
    const link = new URL(await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW));
    await db.prepare("UPDATE photos SET published = 0 WHERE id = 'fixture-b-01'").run();
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(link.href), NOW)).status).toBe(200);
    // Its token names one photo: another is refused
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-02", get(link.href.replace("fixture-b-01", "fixture-b-02")), NOW)).status).toBe(403);
    const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: NOW + 3600 };
    await insertGrant(db, grant);
    const catalogue = await signPhotoToken(PHOTO_KEY, grant, NOW);
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(`https://curiousgeorge.dev/photos/downloads/fixture-b-01?token=${catalogue}`), NOW)).status).toBe(404);
  });

  test("revoking an order's grants stops them, and the admin's revoke can't touch them", async () => {
    const link = new URL(await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW));
    const token = await verifyPhotoToken(PHOTO_KEY, link.searchParams.get("token")!, NOW);
    expect(await revokeCatalogueLink(db, token!.grantId, NOW)).toBe("photo");
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(link.href), NOW)).status).toBe(200);
    expect(await revokeOrderGrants(db, ORDER, NOW)).toBe(1);
    expect(await revokeOrderGrants(db, ORDER, NOW)).toBe(0);
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(link.href), NOW)).status).toBe(403);
  });

  test("revoking one order's grants leaves another order's and a catalogue link working", async () => {
    const mine = new URL(await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW));
    const other = new URL(await issueOrderGrant(db, PHOTO_KEY, "01k6x00000000000000000000b", "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW));
    const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: NOW + 3600 };
    await insertGrant(db, grant);
    const catalogue = `https://curiousgeorge.dev/photos/downloads/fixture-b-01?token=${await signPhotoToken(PHOTO_KEY, grant, NOW)}`;
    expect(await revokeOrderGrants(db, ORDER, NOW)).toBe(1);
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(mine.href), NOW)).status).toBe(403);
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(other.href), NOW)).status).toBe(200);
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(catalogue), NOW)).status).toBe(200);
  });

  test("a grant lives at most 72 hours, and nothing is written for a refused one", async () => {
    expect(ORDER_GRANT_SECONDS).toBe(72 * 3600);
    await expect(issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", ORDER_GRANT_SECONDS + 1, "https://curiousgeorge.dev", NOW)).rejects.toThrow("Invalid order grant lifetime");
    await expect(issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 0, "https://curiousgeorge.dev", NOW)).rejects.toThrow("Invalid order grant lifetime");
    await expect(issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 1.5, "https://curiousgeorge.dev", NOW)).rejects.toThrow("Invalid order grant lifetime");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants").first("n")).toBe(0);
    await expect(issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", ORDER_GRANT_SECONDS, "https://curiousgeorge.dev", NOW)).resolves.toContain("/photos/downloads/fixture-b-01");
  });

  test("order grants never appear among the admin's working links", async () => {
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", Math.floor(Date.now() / 1000));
    expect((await loadAdmin(db)).links).toEqual([]);
  });
});
