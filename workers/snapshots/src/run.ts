import { ulid } from "../../../src/lib/admin/ulid";
import { snapshotBase, variantBase, type SnapshotStatus } from "../../../src/lib/snapshots";
import { capture, type CaptureBrowser } from "./capture";
import { makeVariants } from "./variants";

export interface RunDeps {
  db: D1Database;
  media: R2Bucket;
  images: ImagesBinding;
  /** Starts a Browser Rendering session: one to start a run, and a fresh one when it can't open a page, up to SESSIONS_PER_RUN */
  launch: () => Promise<CaptureBrowser>;
  now?: () => Date;
  /** The id in new keys (tests pass a fixed one) */
  id?: () => string;
}

export interface ShotTarget {
  id: number;
  slug: string;
  url: string;
}

/** "discarded": the line was given another address, or removed, while it was being captured */
export type ShotOutcome = SnapshotStatus | "discarded";

/** What "re-shoot now" answers: a capture's outcome; "gone" when the line has no page to snapshot; "no-browser" when
 *  Browser Rendering wouldn't give a working session (a rate or concurrency limit, or an outage) */
export type ReshootOutcome = ShotOutcome | "gone" | "no-browser";

/** Files no line points at stay this long, so a cached page that still names them keeps working (spec 9) */
export const KEEP_SUPERSEDED_MS = 7 * 24 * 60 * 60 * 1000;

/** A night's browser sessions at most: one to start, and a fresh one each time a session can't open a page, twice */
export const SESSIONS_PER_RUN = 3;

/** The session couldn't open a page: it has gone, and nothing of the line was captured */
class SessionGone extends Error {}

/** The session as a capture sees it, with a page that can't be opened told apart from a page's own failure */
const watched = (browser: CaptureBrowser): CaptureBrowser => ({
  newPage: () =>
    browser.newPage().catch((error: unknown) => {
      throw new SessionGone("the browser session is gone", { cause: error });
    }),
  close: () => browser.close(),
});

/** Every line with a page to snapshot, in section order; or just the one with this id */
export async function shotTargets(db: D1Database, id?: number): Promise<ShotTarget[]> {
  const select = "SELECT id, slug, snapshot_url AS url FROM items WHERE snapshot_url IS NOT NULL";
  const statement = id === undefined ? db.prepare(`${select} ORDER BY section, position`) : db.prepare(`${select} AND id = ?`).bind(id);
  return (await statement.all<ShotTarget>()).results;
}

/**
 * Captures one line and records the outcome (spec 9). A good capture's six files go under a fresh key and then the
 * line points at them; a failure only records why, so the previous snapshot stays. Both updates require the line to
 * still have the address that was captured, so a line edited or removed meanwhile keeps what George saved: the outcome
 * is "discarded" and a good capture's new files are deleted again. A line that was moved is never left naming files
 * that were deleted: if the update rejects, the files go only once the line is seen not to name them.
 */
export async function shootOne(deps: RunDeps, browser: CaptureBrowser, target: ShotTarget): Promise<ShotOutcome> {
  const result = await capture(browser, target.url);
  if (result.status !== "ok") {
    console.error(`snapshots: ${target.slug} failed (${result.status}): ${result.detail}`);
    const update = await deps.db.prepare("UPDATE items SET snapshot_status = ? WHERE id = ? AND snapshot_url = ?").bind(result.status, target.id, target.url).run();
    return update.meta.changes > 0 ? result.status : "discarded";
  }
  const base = snapshotBase(target.slug, (deps.id ?? (() => ulid()))());
  const variants = await makeVariants(deps.images, result.png, base);
  const keys = variants.map((variant) => variant.key);
  try {
    // The item id lets the sweep tell which line a capture belongs to even if the line's slug is edited later
    for (const variant of variants) {
      await deps.media.put(variant.key, variant.bytes, { httpMetadata: { contentType: variant.type }, customMetadata: { item: String(target.id) } });
    }
  } catch (error) {
    // No line names any of these files yet
    await discard(deps.media, target, keys);
    throw error;
  }
  let moved: boolean;
  try {
    const at = (deps.now ?? (() => new Date()))().toISOString();
    const update = await deps.db
      .prepare("UPDATE items SET snapshot_key = ?, snapshot_at = ?, snapshot_status = 'ok' WHERE id = ? AND snapshot_url = ?")
      .bind(base, at, target.id, target.url)
      .run();
    moved = update.meta.changes > 0;
  } catch (error) {
    // A write can commit and still reject (the connection drops before the answer arrives), so the line may name these files
    if ((await namesCapture(deps.db, target, base)) === false) await discard(deps.media, target, keys);
    throw error;
  }
  if (moved) return "ok";
  await discard(deps.media, target, keys);
  return "discarded";
}

/** Whether the line names this capture now; "unknown" when it can't be read, which is logged, and the files are then left for the sweep */
async function namesCapture(db: D1Database, target: ShotTarget, base: string): Promise<boolean | "unknown"> {
  try {
    return (await db.prepare("SELECT snapshot_key FROM items WHERE id = ?").bind(target.id).first<string>("snapshot_key")) === base;
  } catch (error) {
    console.error(`snapshots: ${target.slug} couldn't check which capture the line names, so its new files are left for the clean-up:`, error);
    return "unknown";
  }
}

/** Deletes files no line names; one that can't go is logged and left for the sweep, which takes it a week after its upload */
async function discard(media: R2Bucket, target: ShotTarget, keys: string[]): Promise<void> {
  try {
    await media.delete(keys);
  } catch (error) {
    console.error(`snapshots: ${target.slug} couldn't delete a capture's files, the clean-up will:`, error);
  }
}

/**
 * A capture that threw (an Images, R2 or session error) is recorded as "error" on the same terms as a failure, so the
 * admin shows it rather than an old "captured"; the error itself is in the logs. A database fault here is only logged
 */
async function recordError(db: D1Database, target: ShotTarget): Promise<void> {
  const status: SnapshotStatus = "error";
  try {
    await db.prepare("UPDATE items SET snapshot_status = ? WHERE id = ? AND snapshot_url = ?").bind(status, target.id, target.url).run();
  } catch (error) {
    console.error(`snapshots: ${target.slug} couldn't record its error:`, error);
  }
}

/**
 * The nightly run: every line in a browser session, then the clean-up. One line's error is logged and recorded, and the
 * run goes on. A session that can't open a page has gone, and would take every later line with it, so the line it
 * couldn't open (untouched) goes again in a fresh session: three sessions a night at most, so a Browser Rendering outage
 * isn't hammered (a refused launch counts as one). A page's own failure is that line's outcome and never replaces the
 * session. A line with no session to run in keeps its status, as a re-shoot's "no-browser" does: nothing was attempted.
 */
export async function runAll(deps: RunDeps): Promise<Record<string, ShotOutcome | "error" | "no-browser">> {
  const targets = await shotTargets(deps.db);
  const outcomes: Record<string, ShotOutcome | "error" | "no-browser"> = {};
  let browser: CaptureBrowser | null = null;
  let sessions = 0;
  // A fresh session while tonight has one to give; a refused launch counts as one
  const open = async (slug: string): Promise<CaptureBrowser | null> => {
    if (sessions >= SESSIONS_PER_RUN) return null;
    sessions += 1;
    return deps.launch().then(watched, (error: unknown) => {
      console.error(`snapshots: no browser for ${slug}:`, error);
      return null;
    });
  };
  try {
    for (const target of targets) {
      let outcome: ShotOutcome | "error" | "no-browser" = "no-browser";
      // Bounded: each retry spends a session, or `open` returns null
      for (;;) {
        browser ??= await open(target.slug);
        if (!browser) break; // nothing was captured, so the line keeps its status
        try {
          outcome = await shootOne(deps, browser, target);
        } catch (error) {
          if (error instanceof SessionGone) {
            // The session died, here or on an earlier line: this line wasn't touched, so it goes again in a fresh one
            console.error(`snapshots: the session was gone for ${target.slug}:`, error.cause);
            await browser.close().catch(() => {});
            browser = null;
            continue;
          }
          console.error(`snapshots: ${target.slug} errored:`, error);
          await recordError(deps.db, target);
          outcome = "error";
        }
        break;
      }
      outcomes[target.slug] = outcome;
    }
  } finally {
    await browser?.close().catch(() => {});
  }
  // The lines are all recorded by now, so a clean-up that fails (it catches up tomorrow) mustn't lose their outcomes
  try {
    await sweep(deps);
  } catch (error) {
    console.error("snapshots: clean-up failed:", error);
  }
  return outcomes;
}

/**
 * The admin's "re-shoot now": one line, its own session; "gone" when it has no page to snapshot, "no-browser" when the
 * session won't start or can't open a page (nothing was captured, so the line keeps its status, as at night). A capture
 * that throws is recorded on the line and thrown on, so the admin says the worker hit an error (the Worker's RPC method
 * logs it)
 */
export async function reshootOne(deps: RunDeps, id: number): Promise<ReshootOutcome> {
  const [target] = await shotTargets(deps.db, id);
  if (!target) return "gone";
  let browser: CaptureBrowser;
  try {
    browser = watched(await deps.launch());
  } catch (error) {
    console.error(`snapshots: no browser for the re-shoot of ${target.slug}:`, error);
    return "no-browser";
  }
  try {
    return await shootOne(deps, browser, target);
  } catch (error) {
    if (error instanceof SessionGone) {
      console.error(`snapshots: no browser for the re-shoot of ${target.slug}:`, error.cause);
      return "no-browser";
    }
    await recordError(deps.db, target);
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}

// A capture's slug: snapshots/<slug>-<26-character ulid>; fixtures and anything else have none
const slugOf = (base: string) => /^snapshots\/(.+)-[0-9a-hjkmnp-tv-z]{26}$/.exec(base)?.[1] ?? null;

/**
 * Deletes snapshot files a week after they were superseded (spec 9): a capture is superseded when the next capture of
 * the same line was uploaded, so a cached page that still names it keeps working for a week whatever its age. A line is
 * told by the item id its files carry as custom metadata (so renaming its slug doesn't lose the old capture), or by the
 * slug in the key when there's no id. A base no line points at with no later capture (the line's address changed, or it
 * went) counts from its own upload. Returns how many files went.
 */
export async function sweep(deps: Pick<RunDeps, "db" | "media" | "now">): Promise<number> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const { results } = await deps.db.prepare("SELECT snapshot_key AS key FROM items WHERE snapshot_key IS NOT NULL").all<{ key: string }>();
  const inUse = new Set(results.map((row) => row.key));
  const bases = new Map<string, { keys: string[]; uploaded: number; item?: string }>();
  let cursor: string | undefined;
  do {
    const page = await deps.media.list({ prefix: "snapshots/", cursor, include: ["customMetadata"] });
    for (const object of page.objects) {
      const base = variantBase(object.key);
      if (!base) continue;
      const entry = bases.get(base) ?? { keys: [], uploaded: 0 };
      entry.keys.push(object.key);
      entry.uploaded = Math.max(entry.uploaded, object.uploaded.getTime());
      entry.item ??= object.customMetadata?.item;
      bases.set(base, entry);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const lineOf = (base: string, item?: string) => {
    const slug = slugOf(base);
    return item !== undefined ? `item ${item}` : slug ? `slug ${slug}` : null;
  };
  const uploads = new Map<string, number[]>();
  for (const [base, entry] of bases) {
    const line = lineOf(base, entry.item);
    if (line) uploads.set(line, [...(uploads.get(line) ?? []), entry.uploaded]);
  }
  const stale: string[] = [];
  for (const [base, entry] of bases) {
    if (inUse.has(base)) continue;
    const line = lineOf(base, entry.item);
    const next = line ? Math.min(...(uploads.get(line) ?? []).filter((time) => time > entry.uploaded)) : Infinity;
    const supersededAt = Number.isFinite(next) ? next : entry.uploaded;
    if (now - supersededAt > KEEP_SUPERSEDED_MS) stale.push(...entry.keys);
  }
  // R2 deletes at most 1000 keys a call
  for (let i = 0; i < stale.length; i += 1000) await deps.media.delete(stale.slice(i, i + 1000));
  return stale.length;
}
