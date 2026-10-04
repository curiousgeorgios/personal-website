import { makeCover, newMediaKeys, type MediaKeys } from "./media";
import * as store from "./store";
import {
  checkFact,
  checkItem,
  checkLogEntry,
  checkRecordMeta,
  checkUpload,
  FACT_FIELDS,
  ITEM_FIELDS,
  LOG_FIELDS,
  readFields,
  RECORD_FIELDS,
  type Fields,
} from "./validate";

export type AdminSection = "now" | "before" | "log" | "lately" | "records";

export interface ActionDeps {
  db: D1Database;
  media: R2Bucket;
  images: ImagesBinding;
  /** New R2 keys for a record (tests pass fixed ones) */
  keys?: () => MediaKeys;
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
const gone = (what: "line" | "entry" | "record") => fail(null, "", { form: `that ${what} no longer exists` });
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
  const section = await store.removeItem(db, id);
  return section ? { ok: true, section } : gone("line");
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
  return (await store.removeLogEntry(db, id)) ? { ok: true, section: "log" } : gone("entry");
}

// Lately

async function saveFact(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, FACT_FIELDS);
  const checked = checkFact(fields);
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
  let id: number;
  try {
    await deps.media.put(keys.audioKey, audio as File, { httpMetadata: { contentType: "audio/mpeg" } });
    await deps.media.put(keys.coverKey, webp, { httpMetadata: { contentType: "image/webp" } });
    id = await store.createRecord(deps.db, { ...checked.value, ...keys });
  } catch (error) {
    // All or nothing: no row without its files, and no files without their row
    console.error("admin: saving a record failed", error);
    await deleteFiles(deps.media, [keys.audioKey, keys.coverKey], "a failed record's files");
    return fail("records", "record-new", { form: "couldn't save that record, so nothing was kept. try again." }, fields);
  }
  if (id === 0) {
    // Nothing was added: the same record arrived while this one uploaded (a double tap), or the crate filled meanwhile
    await deleteFiles(deps.media, [keys.audioKey, keys.coverKey], "an unneeded record's files");
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
  if (!record || !(await store.removeRecord(db, id))) return gone("record");
  // The row goes first, so the logbook never points at a missing file
  await deleteFiles(media, [record.audioKey, record.coverKey], "a record's files");
  return { ok: true, section: "records" };
}

/** Deletes files from R2; a failure only leaves an orphan there, so it's logged, not thrown */
async function deleteFiles(media: R2Bucket, keys: string[], what: string) {
  await media.delete(keys).catch((error: unknown) => console.error(`admin: couldn't delete ${what}`, error));
}
