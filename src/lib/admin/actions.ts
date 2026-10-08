import type { ReshootOutcome } from "../../../workers/snapshots/src/run";
import { checkPlace } from "../photos/place";
import { publishRefusal, setPublished, type PublishDeps, type PublishOutcome } from "../photos/publish";
import { PHOTO_ID } from "../photos/tokens";
import { snapshotReason } from "../snapshots";
import { makeCover, newMediaKeys, type MediaKeys } from "./media";
import * as store from "./store";
import {
  checkFact,
  checkItem,
  checkLogEntry,
  checkRecordMeta,
  checkTitle,
  checkUpload,
  FACT_FIELDS,
  ITEM_FIELDS,
  LOG_FIELDS,
  PLACE_FIELDS,
  readFields,
  RECORD_FIELDS,
  TITLE_FIELDS,
  type Fields,
} from "./validate";

export type AdminSection = "now" | "before" | "log" | "lately" | "records" | "snapshots" | "photographs";

/** The snapshots Worker's RPC (workers/snapshots/src/index.ts) */
export interface SnapshotsService {
  reshoot(id: number): Promise<ReshootOutcome>;
}

export interface ActionDeps {
  db: D1Database;
  media: R2Bucket;
  images: ImagesBinding;
  /** New R2 keys for a record (tests pass fixed ones) */
  keys?: () => MediaKeys;
  /** The snapshots Worker, through the SNAPSHOTS service binding (spec 9) */
  snapshots?: SnapshotsService;
  /** PHOTO_PRINTS, the private masters a publish verifies (spec 6.2) */
  prints?: R2Bucket;
}

export interface ActionFailure {
  ok: false;
  /** The page section the failed form lives in, or null for a message about the page itself */
  section: AdminSection | null;
  /** The id of the form to reopen with these values and messages ("" when errors.form is a page-level message) */
  form: string;
  errors: Fields;
  values: Fields;
}

export type ActionResult = { ok: true; section: AdminSection } | ActionFailure;

const fail = (section: AdminSection | null, form: string, errors: Fields, values: Fields = {}): ActionFailure => ({ ok: false, section, form, errors, values });
const gone = (what: "line" | "entry" | "record" | "post" | "photo") => fail(null, "", { form: `that ${what} no longer exists` });
const CONFIRM = { confirm: "tick the box to remove it" };

function idOf(form: FormData): number | null {
  const id = Number(form.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}
const directionOf = (form: FormData) => (form.get("direction") === "up" ? "up" : "down");
const sectionOf = (form: FormData) => (form.get("section") === "before" ? "before" : "now");
const confirmed = (form: FormData) => form.get("confirm") === "yes";

/** Runs one admin write from a submitted form (spec 7): validates it, writes it and says which section to show next */
export async function runAction(form: FormData, deps: ActionDeps): Promise<ActionResult> {
  switch (form.get("intent")) {
    case "item.create":
      return createItem(form, deps);
    case "item.update":
      return updateItem(form, deps);
    case "item.move":
      return moveItem(form, deps);
    case "item.remove":
      return removeItem(form, deps);
    case "log.create":
      return createLogEntry(form, deps);
    case "log.update":
      return updateLogEntry(form, deps);
    case "log.remove":
      return removeLogEntry(form, deps);
    case "fact.save":
      return saveFact(form, deps);
    case "record.create":
      return createRecord(form, deps);
    case "record.update":
      return updateRecord(form, deps);
    case "record.move":
      return moveRecord(form, deps);
    case "record.activate":
      return setRecordActive(form, deps, true);
    case "record.deactivate":
      return setRecordActive(form, deps, false);
    case "record.remove":
      return removeRecord(form, deps);
    case "snapshot.reshoot":
      return reshoot(form, deps);
    case "post.place":
      return savePlace(form, deps);
    case "post.publish":
      return publishPost(form, deps, true);
    case "post.hide":
      return publishPost(form, deps, false);
    case "photo.title":
      return saveTitle(form, deps);
    case "photo.publish":
      return publishPhoto(form, deps, true);
    case "photo.hide":
      return publishPhoto(form, deps, false);
    default:
      return fail(null, "", { form: "that action isn't recognised" });
  }
}

// Now and before lines

async function createItem(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, ITEM_FIELDS);
  const formId = `item-new-${sectionOf(form)}`;
  const checked = checkItem(fields);
  if (!checked.ok) return fail(sectionOf(form), formId, checked.errors, fields);
  // The insert refuses a taken slug in the same statement, so two adds at once can't both get it. Taken by this very
  // line means an add that already saved, sent again by a double tap.
  if ((await store.createItem(db, checked.value)) === 0 && !(await store.sameItem(db, checked.value))) {
    return fail(checked.value.section, formId, { slug: "that slug is taken" }, fields);
  }
  return { ok: true, section: checked.value.section };
}

async function updateItem(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("line");
  const fields = readFields(form, ITEM_FIELDS);
  const checked = checkItem(fields);
  if (!checked.ok) return fail(sectionOf(form), `item-${id}`, checked.errors, fields);
  if (await store.slugTaken(db, checked.value.slug, id)) return fail(checked.value.section, `item-${id}`, { slug: "that slug is taken" }, fields);
  if (!(await store.updateItem(db, id, checked.value))) return gone("line");
  return { ok: true, section: checked.value.section };
}

async function moveItem(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  const section = id === null ? null : await store.moveItem(db, id, directionOf(form));
  return section ? { ok: true, section } : gone("line");
}

async function removeItem(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("line");
  if (!confirmed(form)) return fail(sectionOf(form), `item-${id}`, CONFIRM);
  // A line that's already gone counts as removed: a double tap sends the remove twice
  const section = await store.removeItem(db, id);
  return { ok: true, section: section ?? sectionOf(form) };
}

// Log entries

async function createLogEntry(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, LOG_FIELDS);
  const checked = checkLogEntry(fields);
  if (!checked.ok) return fail("log", "log-new", checked.errors, fields);
  await store.createLogEntry(db, checked.value);
  return { ok: true, section: "log" };
}

async function updateLogEntry(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("entry");
  const fields = readFields(form, LOG_FIELDS);
  const checked = checkLogEntry(fields);
  if (!checked.ok) return fail("log", `log-${id}`, checked.errors, fields);
  return (await store.updateLogEntry(db, id, checked.value)) ? { ok: true, section: "log" } : gone("entry");
}

async function removeLogEntry(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("entry");
  if (!confirmed(form)) return fail("log", `log-${id}`, CONFIRM);
  // Already gone counts as removed, for a double tap
  await store.removeLogEntry(db, id);
  return { ok: true, section: "log" };
}

// Lately

async function saveFact(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, FACT_FIELDS);
  const checked = checkFact(fields);
  // An unknown key has no form on the page to show a message on
  if (!checked.ok && checked.errors.key) return fail(null, "", { form: "that fact isn't recognised" });
  if (!checked.ok) return fail("lately", `fact-${fields.key}`, checked.errors, fields);
  await store.saveFact(db, checked.value.key, checked.value.fact);
  return { ok: true, section: "lately" };
}

// Records

async function createRecord(form: FormData, deps: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, RECORD_FIELDS);
  // A repeat of an add that already saved (a double tap) counts as saved, even if that add filled the crate
  if (await store.recordInCrate(deps.db, { title: fields.title, artist: fields.artist })) return { ok: true, section: "records" };
  const full = fail("records", "record-new", { form: "the crate holds six records. deactivate one to add another." }, fields);
  if ((await store.activeRecordCount(deps.db)) >= store.RECORD_CAP) return full;
  const checked = checkRecordMeta(fields);
  const errors: Fields = checked.ok ? {} : { ...checked.errors };
  const audio = form.get("audio");
  const cover = form.get("cover");
  const audioProblem = await checkUpload(audio, "audio");
  const coverProblem = await checkUpload(cover, "cover");
  if (audioProblem) errors.audio = audioProblem;
  if (coverProblem) errors.cover = coverProblem;
  if (!checked.ok || Object.keys(errors).length > 0) return fail("records", "record-new", errors, fields);

  // checkUpload has shown both are non-empty files of the right kind
  let webp: Uint8Array | null;
  try {
    webp = await makeCover(deps.images, cover as File);
  } catch (error) {
    console.error("admin: the cover couldn't be converted", error);
    return fail("records", "record-new", { cover: "that cover couldn't be read as an image" }, fields);
  }
  if (!webp) return fail("records", "record-new", { cover: "that cover won't shrink under 40KB" }, fields);

  const keys = (deps.keys ?? newMediaKeys)();
  const fileKeys = [keys.audioKey, keys.coverKey];
  const notSaved = () => fail("records", "record-new", { form: "couldn't save that record, so nothing was kept. try again." }, fields);
  try {
    await deps.media.put(keys.audioKey, audio as File, { httpMetadata: { contentType: "audio/mpeg" } });
    await deps.media.put(keys.coverKey, webp, { httpMetadata: { contentType: "image/webp" } });
  } catch (error) {
    // All or nothing: no row without its files, and no files without their row
    console.error("admin: storing a record's files failed", error);
    await deleteFiles(deps.media, fileKeys, "a failed record's files");
    return notSaved();
  }
  let id: number;
  try {
    id = await store.createRecord(deps.db, { ...checked.value, ...keys });
  } catch (error) {
    console.error("admin: saving a record's row failed", error);
    // A throw doesn't prove the row wasn't written (it may have committed before the connection dropped), and deleting
    // the files of a row that exists would break it. So look first, and keep the files if we can't tell.
    let written: boolean;
    try {
      written = await store.recordWithAudio(deps.db, keys.audioKey);
    } catch (checkError) {
      console.error("admin: couldn't check whether the record saved, so its files were kept", checkError);
      return notSaved();
    }
    if (written) return { ok: true, section: "records" };
    await deleteFiles(deps.media, fileKeys, "a failed record's files");
    return notSaved();
  }
  if (id === 0) {
    // Nothing was added: the same record arrived while this one uploaded (a double tap), or the crate filled meanwhile
    await deleteFiles(deps.media, fileKeys, "an unneeded record's files");
    return (await store.recordInCrate(deps.db, checked.value)) ? { ok: true, section: "records" } : full;
  }
  return { ok: true, section: "records" };
}

async function updateRecord(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("record");
  const fields = readFields(form, RECORD_FIELDS);
  const checked = checkRecordMeta(fields);
  if (!checked.ok) return fail("records", `record-${id}`, checked.errors, fields);
  return (await store.updateRecord(db, id, checked.value)) ? { ok: true, section: "records" } : gone("record");
}

async function moveRecord(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  return id !== null && (await store.moveRecord(db, id, directionOf(form))) ? { ok: true, section: "records" } : gone("record");
}

async function setRecordActive(form: FormData, { db }: ActionDeps, active: boolean): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("record");
  const record = await store.getRecord(db, id);
  if (!record) return gone("record");
  // Already in that state counts as done: a double-tapped activate that filled the crate must not read as a refusal
  if (record.active === active) return { ok: true, section: "records" };
  if (active && (await store.activeRecordCount(db)) >= store.RECORD_CAP) {
    return fail("records", `record-${id}`, { form: "the crate holds six records. deactivate one first." });
  }
  return (await store.setRecordActive(db, id, active)) ? { ok: true, section: "records" } : gone("record");
}

async function removeRecord(form: FormData, { db, media }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("record");
  if (!confirmed(form)) return fail("records", `record-${id}`, CONFIRM);
  const record = await store.getRecord(db, id);
  // Already gone counts as removed, for a double tap; whoever removed it deletes its files
  if (!record || !(await store.removeRecord(db, id))) return { ok: true, section: "records" };
  // The row goes first, so the logbook never points at a missing file
  await deleteFiles(media, [record.audioKey, record.coverKey], "a record's files");
  return { ok: true, section: "records" };
}

/** Deletes files from R2; a failure only leaves an orphan there, so it's logged, not thrown */
async function deleteFiles(media: R2Bucket, keys: string[], what: string) {
  await media.delete(keys).catch((error: unknown) => console.error(`admin: couldn't delete ${what}`, error));
}

// Snapshots

/** How long a re-shoot waits for the snapshots Worker: a capture takes up to about half a minute, with launch and encoding */
const RESHOOT_DEADLINE_MS = 60_000;
const NOTHING_TO_SNAPSHOT = "that line has no page to snapshot any more";

/** The snapshots Worker didn't answer within its deadline */
class Late extends Error {}

/** Wrangler's local dev reports a Worker that isn't running from its own proxy, so that error arrives marked remote too */
const NOT_RUNNING = /^Worker ".+" not found/;

/** The binding's answer, or a `Late` if it takes longer than `ms`; the timer is cleared either way */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Late(`no answer within ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** "Re-shoot now" (spec 9): waits for the capture, which takes a few seconds; a failed capture isn't a save */
async function reshoot(form: FormData, { db, snapshots }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("line");
  const formId = `shot-${id}`;
  let outcome: ReshootOutcome;
  try {
    if (!snapshots) throw new Error("no SNAPSHOTS binding");
    outcome = await within(snapshots.reshoot(id), RESHOOT_DEADLINE_MS);
  } catch (error) {
    // An exception the Worker's own code threw crosses RPC marked `remote`: it was reached, and it failed. Anything else
    // (no binding, no Worker, no answer in time) is a Worker that couldn't be got hold of.
    const message = error instanceof Error ? error.message : String(error);
    const failed = !(error instanceof Late) && (error as { remote?: unknown } | null)?.remote === true && !NOT_RUNNING.test(message);
    console.error(`admin: the snapshots worker ${failed ? "failed" : "didn't answer"}`, message);
    return fail("snapshots", formId, { form: failed ? "the snapshots worker hit an error. try again in a minute." : "the snapshots worker didn't answer. try again in a minute." });
  }
  if (outcome === "ok") return { ok: true, section: "snapshots" };
  if (outcome === "no-browser") return fail("snapshots", formId, { form: "the browser couldn't start. try again in a minute." });
  if (outcome === "gone") return fail(null, "", { form: NOTHING_TO_SNAPSHOT });
  if (outcome === "discarded") {
    // Removing a line or clearing its page mid-capture also discards the capture, and then the line has no form left to
    // carry the message, so it goes to the page like "gone"
    if (!(await store.hasSnapshotUrl(db, id))) return fail(null, "", { form: NOTHING_TO_SNAPSHOT });
    return fail("snapshots", formId, { form: "the line changed while it was being captured. try again." });
  }
  return fail("snapshots", formId, { form: `couldn't capture it: ${snapshotReason(outcome)}` });
}

// Photographs (spec 6.2)

const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;
const postForm = (collection: string) => `post-${collection}`;
const photoForm = (id: string) => `photo-${id}`;
const unchecked = (ids: string[]) => `${ids.length} ${ids.length === 1 ? "photo" : "photos"} couldn't be checked: ${ids.join(", ")}. publish the others one at a time.`;

function publishDeps({ db, media, prints }: ActionDeps): PublishDeps {
  if (!prints) throw new Error("no PHOTO_PRINTS binding");
  return { db, media, prints };
}

/** Why a publish was refused: a photo with no post says so (publishRefusal's words), then the ones whose files didn't check out */
function refusal(outcome: Extract<PublishOutcome, { postless: string[] }>, unverified: string): string {
  const postless = outcome.postless.length > 0 ? publishRefusal({ postless: outcome.postless, unverified: [], ok: false }) : "";
  return [postless, outcome.unverified.length > 0 ? unverified : ""].filter(Boolean).join(" ");
}

async function savePlace(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, PLACE_FIELDS);
  if (!COLLECTION.test(fields.collection)) return gone("post");
  const checked = checkPlace(fields.place);
  if (!checked.ok) return fail("photographs", postForm(fields.collection), { place: checked.error }, fields);
  return (await store.savePostPlace(db, fields.collection, checked.place)) ? { ok: true, section: "photographs" } : gone("post");
}

/** Publishes or hides every photograph in a post: all of them or none, after checking each (spec 6.2) */
async function publishPost(form: FormData, deps: ActionDeps, published: boolean): Promise<ActionResult> {
  const collection = String(form.get("collection") ?? "");
  const ids = COLLECTION.test(collection) ? await store.postPhotoIds(deps.db, collection) : null;
  if (!ids || ids.length === 0) return gone("post");
  const outcome = await setPublished(publishDeps(deps), ids, published);
  if (outcome.ok) return { ok: true, section: "photographs" };
  if ("missing" in outcome) return gone("post");
  return fail("photographs", postForm(collection), { form: refusal(outcome, unchecked(outcome.unverified.map(({ id }) => id))) });
}

async function saveTitle(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, TITLE_FIELDS);
  if (!PHOTO_ID.test(fields.id)) return gone("photo");
  const checked = checkTitle(fields);
  if (!checked.ok) return fail("photographs", photoForm(fields.id), checked.errors, fields);
  return (await store.savePhotoTitle(db, fields.id, checked.value)) ? { ok: true, section: "photographs" } : gone("photo");
}

async function publishPhoto(form: FormData, deps: ActionDeps, published: boolean): Promise<ActionResult> {
  const id = String(form.get("id") ?? "");
  if (!PHOTO_ID.test(id)) return gone("photo");
  const outcome = await setPublished(publishDeps(deps), [id], published);
  if (outcome.ok) return { ok: true, section: "photographs" };
  if ("missing" in outcome) return gone("photo");
  return fail("photographs", photoForm(id), { form: refusal(outcome, "that photo couldn't be checked, so it stays hidden. run the import for it again.") });
}
