import { sideFor } from "./text";

export type Section = "now" | "before";

export interface Label {
  era: string;
  status: "live" | "retired";
  madeOf: string | null;
  text: string | null;
  kind: "decision" | "lesson" | null;
  note: string | null;
  snapshotKey: string | null;
}

export interface Item {
  slug: string;
  section: Section;
  text: string;
  aside: string | null;
  label: Label | null;
}

export interface Fact {
  key: "shelf" | "kettle";
  title: string;
  subtitle: string | null;
}

export interface LogEntry {
  id: number;
  date: string;
  precision: "day" | "month";
  text: string;
}

export interface Track {
  id: number;
  title: string;
  artist: string;
  audioKey: string;
  coverKey: string;
  side: string;
}

export interface Logbook {
  now: Item[];
  before: Item[];
  facts: Fact[];
  log: LogEntry[];
  records: Track[];
  /** Whether anything is published, for the photos line (spec 3.7) */
  photos: boolean;
}

export const LOG_LIMIT = 50;
export const RECORD_LIMIT = 6;

interface ItemRow {
  slug: string;
  section: Section;
  text: string;
  aside: string | null;
  label_era: string | null;
  label_status: "live" | "retired" | null;
  label_made_of: string | null;
  label_text: string | null;
  label_kind: "decision" | "lesson" | null;
  label_note: string | null;
  snapshot_key: string | null;
}

interface RecordRow {
  id: number;
  title: string;
  artist: string;
  audio_key: string;
  cover_key: string;
}

function toItem(row: ItemRow): Item {
  return {
    slug: row.slug,
    section: row.section,
    text: row.text,
    aside: row.aside,
    label: row.label_status
      ? {
          era: row.label_era ?? "",
          status: row.label_status,
          madeOf: row.label_made_of,
          text: row.label_text,
          kind: row.label_kind,
          note: row.label_note,
          snapshotKey: row.snapshot_key,
        }
      : null,
  };
}

export async function loadLogbook(db: D1Database): Promise<Logbook> {
  const [items, facts, log, records, photos] = await db.batch([
    db.prepare(
      "SELECT slug, section, text, aside, label_era, label_status, label_made_of, label_text, label_kind, label_note, snapshot_key FROM items ORDER BY section, position",
    ),
    db.prepare("SELECT key, title, subtitle FROM facts ORDER BY CASE key WHEN 'shelf' THEN 0 ELSE 1 END"),
    db.prepare("SELECT id, date, precision, text FROM log_entries ORDER BY date DESC, created_at DESC, id DESC LIMIT ?").bind(LOG_LIMIT),
    db.prepare("SELECT id, title, artist, audio_key, cover_key FROM records WHERE active = 1 ORDER BY position LIMIT ?").bind(RECORD_LIMIT),
    // The same join the gallery uses, so the line never points at an empty gallery. It needs migration 0006: apply it
    // before deploying this, or the whole batch fails and the home page renders only its static rows
    db.prepare("SELECT EXISTS (SELECT 1 FROM photos JOIN photo_posts ON photo_posts.collection = photos.collection WHERE photos.published = 1) AS any"),
  ]);
  const all = (items.results as unknown as ItemRow[]).map(toItem);
  return {
    now: all.filter((item) => item.section === "now"),
    before: all.filter((item) => item.section === "before"),
    facts: facts.results as unknown as Fact[],
    log: log.results as unknown as LogEntry[],
    records: (records.results as unknown as RecordRow[]).map((row, index) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      audioKey: row.audio_key,
      coverKey: row.cover_key,
      side: sideFor(index),
    })),
    photos: (photos.results[0] as { any: number } | undefined)?.any === 1,
  };
}

export async function loadLogbookSafely(db: D1Database): Promise<Logbook | null> {
  try {
    return await loadLogbook(db);
  } catch (error) {
    console.error("logbook: D1 read failed, rendering static sections only", error);
    return null;
  }
}
