import type { Section } from "../logbook";
import { sniffAudio, sniffImage } from "./sniff";

export type Fields = Record<string, string>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: Fields };

/** Every named field from a form, trimmed; anything missing (or a file) becomes "" */
export function readFields(form: FormData, names: readonly string[]): Fields {
  const fields: Fields = {};
  for (const name of names) {
    const value = form.get(name);
    fields[name] = typeof value === "string" ? value.trim() : "";
  }
  return fields;
}

const orNull = (value: string) => (value === "" ? null : value);

function tooLong(errors: Fields, fields: Fields, name: string, max: number) {
  if (!errors[name] && fields[name].length > max) errors[name] = `${max} characters at most`;
}

const finish = <T>(errors: Fields, value: () => T): Checked<T> =>
  Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: value() };

// Now and before lines (spec 7)

export const ITEM_FIELDS = ["section", "slug", "text", "aside", "label_status", "label_era", "label_made_of", "label_text", "label_kind", "label_note", "snapshot_url"] as const;
const LABEL_FIELDS = ["label_era", "label_made_of", "label_text", "label_kind", "label_note", "snapshot_url"] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Anything shaped like a link, so mistakes can be named (the page's parser only links https: and mailto:, src/lib/text.ts)
const LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g;

export interface ItemLabel {
  status: "live" | "retired";
  era: string | null;
  madeOf: string | null;
  text: string | null;
  kind: "decision" | "lesson" | null;
  note: string | null;
}

export interface ItemInput {
  section: Section;
  slug: string;
  text: string;
  aside: string | null;
  label: ItemLabel | null;
  snapshotUrl: string | null;
}

/** What's wrong with a line's links, or null; the inline parser stops a link at its first ")" (plan 1 follow-up) */
export function linkProblem(text: string): string | null {
  for (const match of text.matchAll(LINK)) {
    const [fullMatch, label, href] = match;
    if (label.trim() === "") return "a link needs some text between the [ ]";
    if (href.includes("(")) return "a link's address can't contain brackets";
    if (/\s/.test(href)) return "a link's address can't contain spaces";
    if (!/^(https:\/\/|mailto:)\S+$/.test(href)) return "links need an https:// or mailto: address";
    const afterMatch = text[match.index! + fullMatch.length];
    if (afterMatch === ")") return "a link's address can't contain brackets";
  }
  return null;
}

function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\/[^\s/?#]+[^\s]*$/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function checkItem(fields: Fields): Checked<ItemInput> {
  const errors: Fields = {};
  const { section, slug, text, label_status: status, label_kind: kind, label_note: note } = fields;
  if (section !== "now" && section !== "before") errors.section = "choose now or before";
  if (slug === "") errors.slug = "a slug is needed";
  else if (!SLUG.test(slug)) errors.slug = "lowercase letters, numbers and single hyphens only";
  tooLong(errors, fields, "slug", 40);
  if (text === "") errors.text = "the line needs some text";
  else {
    const problem = linkProblem(text);
    if (problem) errors.text = problem;
  }
  tooLong(errors, fields, "text", 240);
  tooLong(errors, fields, "aside", 80);
  if (status === "") {
    if (LABEL_FIELDS.some((name) => fields[name] !== "")) errors.label_status = "choose live or retired to show a label, or clear its fields";
  } else {
    if (status !== "live" && status !== "retired") errors.label_status = "choose live or retired";
    // A label's note and its kind come together (plan 1 follow-up)
    if (kind !== "" && kind !== "decision" && kind !== "lesson") errors.label_kind = "choose decision or lesson";
    else if (kind !== "" && note === "") errors.label_note = "the decision or lesson needs a sentence";
    else if (kind === "" && note !== "") errors.label_kind = "say whether this is a decision or a lesson";
    if (fields.snapshot_url !== "" && !isHttpsUrl(fields.snapshot_url)) errors.snapshot_url = "an https:// address";
    tooLong(errors, fields, "label_era", 40);
    tooLong(errors, fields, "label_made_of", 120);
    tooLong(errors, fields, "label_text", 400);
    tooLong(errors, fields, "label_note", 400);
    tooLong(errors, fields, "snapshot_url", 300);
  }
  return finish(errors, () => ({
    section: section as Section,
    slug,
    text,
    aside: orNull(fields.aside),
    label:
      status === ""
        ? null
        : {
            status: status as ItemLabel["status"],
            era: orNull(fields.label_era),
            madeOf: orNull(fields.label_made_of),
            text: orNull(fields.label_text),
            kind: kind === "" ? null : (kind as ItemLabel["kind"]),
            note: orNull(note),
          },
    snapshotUrl: orNull(fields.snapshot_url),
  }));
}

// Log entries: ISO dates, month precision stored as the first of the month (plan 1 follow-up)

export const LOG_FIELDS = ["date", "precision", "text"] as const;

export interface LogInput {
  date: string;
  precision: "day" | "month";
  text: string;
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function checkLogEntry(fields: Fields): Checked<LogInput> {
  const errors: Fields = {};
  if (!isRealDate(fields.date)) errors.date = "a real date, like 2026-10-04";
  if (fields.precision !== "day" && fields.precision !== "month") errors.precision = "choose day or month";
  if (fields.text === "") errors.text = "the entry needs some text";
  tooLong(errors, fields, "text", 280);
  return finish(errors, () => ({
    date: fields.precision === "month" ? `${fields.date.slice(0, 7)}-01` : fields.date,
    precision: fields.precision as LogInput["precision"],
    text: fields.text,
  }));
}

// Lately: on the shelf and in the kettle

export const FACT_FIELDS = ["key", "title", "subtitle"] as const;

export interface FactInput {
  key: "shelf" | "kettle";
  fact: { title: string; subtitle: string | null } | null;
}

export function checkFact(fields: Fields): Checked<FactInput> {
  const errors: Fields = {};
  if (fields.key !== "shelf" && fields.key !== "kettle") errors.key = "unknown fact";
  if (fields.title === "" && fields.subtitle !== "") errors.title = "a title is needed, or clear both to hide it";
  tooLong(errors, fields, "title", 80);
  tooLong(errors, fields, "subtitle", 80);
  return finish(errors, () => ({
    key: fields.key as FactInput["key"],
    fact: fields.title === "" ? null : { title: fields.title, subtitle: orNull(fields.subtitle) },
  }));
}

// Records

export const RECORD_FIELDS = ["title", "artist"] as const;

export interface RecordMeta {
  title: string;
  artist: string;
}

export function checkRecordMeta(fields: Fields): Checked<RecordMeta> {
  const errors: Fields = {};
  if (fields.title === "") errors.title = "the record needs a title";
  if (fields.artist === "") errors.artist = "the record needs an artist";
  tooLong(errors, fields, "title", 60);
  tooLong(errors, fields, "artist", 60);
  return finish(errors, () => ({ title: fields.title, artist: fields.artist }));
}

export const AUDIO_LIMIT = 15 * 1024 * 1024;
export const COVER_INPUT_LIMIT = 10 * 1024 * 1024;

/** A message if the upload isn't an MP3 (audio) or a JPEG, PNG or WebP (cover) within its limit, otherwise null */
export async function checkUpload(value: FormDataEntryValue | null, kind: "audio" | "cover"): Promise<string | null> {
  const audio = kind === "audio";
  if (!(value instanceof File) || value.size === 0) return audio ? "choose an mp3" : "choose a cover image";
  if (value.size > (audio ? AUDIO_LIMIT : COVER_INPUT_LIMIT)) return audio ? "mp3s can be up to 15MB" : "covers can be up to 10MB";
  const head = new Uint8Array(await value.slice(0, 12).arrayBuffer());
  if (audio) return sniffAudio(head) ? null : "that file isn't an mp3";
  return sniffImage(head) ? null : "covers can be JPEG, PNG or WebP";
}
