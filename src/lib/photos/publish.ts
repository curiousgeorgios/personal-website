import { hasAllPreviews, previewSize, type PhotoRow, type Preview } from "./store";

export interface PublishDeps {
  db: D1Database;
  /** PHOTO_PRINTS: the private masters */
  prints: R2Bucket;
  /** MEDIA: the public previews */
  media: R2Bucket;
}

/** A photograph that failed verification, and what failed: "master", "previews" (not the eight) or a preview as "240.avif" */
export interface Unverified {
  id: string;
  failed: string[];
}

/**
 * `missing`: ids with no photograph. Otherwise a publish that was refused lists every problem found, so George can fix
 * them in one go: `postless` are photographs with no post row (the public queries join photo_posts, so they would never
 * show) and `unverified` are those whose master or previews aren't in R2 as recorded. Both are in input order.
 */
export type PublishOutcome = { ok: true } | { ok: false; missing: string[] } | { ok: false; postless: string[]; unverified: Unverified[] };

/**
 * R2 head requests in flight at once. A 20-photo post needs 180 (one master and eight previews each), well within
 * Workers Paid's default of 10,000 subrequests per invocation (Cloudflare's limits page, checked 2026-10-08; R2 and D1
 * binding calls count towards it). R2 calls also count towards Workers' cap of 6 simultaneous outgoing connections, so
 * ten are in flight and six run at a time while the rest wait: ten is an upper bound, and harmless since a head has no body.
 */
export const VERIFY_CONCURRENCY = 10;

const MASTER_KEY = /^prints\/[A-Za-z0-9_-]+\/[a-f0-9]{64}\.jpg$/;

async function masterChecks(prints: R2Bucket, row: PhotoRow): Promise<boolean> {
  if (!MASTER_KEY.test(row.print_key)) return false;
  const object = await prints.head(row.print_key);
  return !!object && object.size === row.print_bytes && object.httpMetadata?.contentType === "image/jpeg" && object.customMetadata?.sha256 === row.print_sha256;
}

async function previewChecks(media: R2Bucket, preview: Preview): Promise<boolean> {
  const stored = await media.head(preview.key);
  return !!stored && stored.httpMetadata?.contentType === `image/${preview.format}`;
}

/** Runs every check, at most `limit` at a time, and says which passed */
async function pooled(checks: (() => Promise<boolean>)[], limit: number): Promise<boolean[]> {
  const passed = new Array<boolean>(checks.length);
  let next = 0;
  const worker = async () => {
    while (next < checks.length) {
      const i = next++;
      passed[i] = await checks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, checks.length) }, worker));
  return passed;
}

/**
 * Publishes or hides photographs, all of them or none (spec 2.2 and 6.2). Publishing verifies each first: that it has a
 * post, its private JPEG (size, type and SHA-256) and its eight previews. Hiding asks R2 nothing. A repeat is fine
 * (ADR-0012). It doesn't purge: callers purge photos and logbook, since the home page's photo line depends on whether
 * anything is published.
 */
export async function setPublished(deps: PublishDeps, ids: string[], published: boolean): Promise<PublishOutcome> {
  // One parameter however many ids: D1 caps a statement at 100 bound parameters
  const list = JSON.stringify(ids);
  const rows = (await deps.db.prepare("SELECT * FROM photos WHERE id IN (SELECT value FROM json_each(?))").bind(list).all<PhotoRow>()).results;
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (ids.length === 0 || missing.length > 0) return { ok: false, missing };
  if (published) {
    const withPost = (await deps.db.prepare("SELECT photos.id FROM photos JOIN photo_posts ON photo_posts.collection = photos.collection WHERE photos.id IN (SELECT value FROM json_each(?))").bind(list).all<{ id: string }>()).results;
    const posted = new Set(withPost.map((row) => row.id));
    const postless = ids.filter((id) => !posted.has(id));
    const failed = new Map<string, string[]>();
    const fail = (id: string, what: string) => failed.set(id, [...(failed.get(id) ?? []), what]);
    const checks: { id: string; what: string; run: () => Promise<boolean> }[] = [];
    for (const row of rows) {
      const previews = JSON.parse(row.previews) as Preview[];
      if (!hasAllPreviews(previews) || previews.some((preview) => !preview.key.startsWith("photos/previews/"))) {
        fail(row.id, "previews");
        continue;
      }
      checks.push({ id: row.id, what: "master", run: () => masterChecks(deps.prints, row) });
      for (const preview of previews) checks.push({ id: row.id, what: `${previewSize(preview.key)}.${preview.format}`, run: () => previewChecks(deps.media, preview) });
    }
    const passed = await pooled(checks.map((check) => check.run), VERIFY_CONCURRENCY);
    checks.forEach((check, i) => { if (!passed[i]) fail(check.id, check.what); });
    if (postless.length > 0 || failed.size > 0) {
      return { ok: false, postless, unverified: ids.filter((id) => failed.has(id)).map((id) => ({ id, failed: failed.get(id)! })) };
    }
  }
  await deps.db.prepare("UPDATE photos SET published = ? WHERE id IN (SELECT value FROM json_each(?))").bind(published ? 1 : 0, list).run();
  return { ok: true };
}

/** Says everything that stopped a publish, in the admin's error voice: the post, the master and which previews failed */
export function publishRefusal(outcome: Extract<PublishOutcome, { postless: string[] }>): string {
  const reasons = outcome.postless.length > 0 ? ["Photo has no post, so it would stay hidden. Import its post first."] : [];
  for (const { failed } of outcome.unverified) {
    if (failed.includes("master")) reasons.push("Verified print master unavailable.");
    if (failed.includes("previews")) reasons.push("Responsive previews unavailable.");
    const previews = failed.filter((what) => what !== "master" && what !== "previews");
    if (previews.length > 0) reasons.push(`Preview ${previews.join(", ")} unavailable.`);
  }
  return reasons.join(" ");
}
