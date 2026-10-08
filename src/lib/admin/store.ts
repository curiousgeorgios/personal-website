import type { Section } from "../logbook";
import type { ItemInput, LogInput, RecordMeta } from "./validate";

/** The crate holds six active records (spec 5.4 and 7) */
export const RECORD_CAP = 6;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export interface AdminItem {
  id: number;
  slug: string;
  section: Section;
  position: number;
  text: string;
  aside: string | null;
  labelStatus: "live" | "retired" | null;
  labelEra: string | null;
  labelMadeOf: string | null;
  labelText: string | null;
  labelKind: "decision" | "lesson" | null;
  labelNote: string | null;
  snapshotUrl: string | null;
  snapshotAt: string | null;
  snapshotStatus: string | null;
}

export interface AdminLogEntry {
  id: number;
  date: string;
  precision: "day" | "month";
  text: string;
}

export interface AdminFact {
  title: string;
  subtitle: string | null;
}

export interface AdminRecord {
  id: number;
  title: string;
  artist: string;
  audioKey: string;
  coverKey: string;
  position: number;
  active: boolean;
}

/** One photograph in the photographs section (spec 6.2) */
export interface AdminPhoto {
  id: string;
  title: string;
  published: boolean;
  rawReview: boolean;
  /** Its 240 WebP preview, or null if it has none */
  thumb: { url: string; width: number; height: number } | null;
}

/** One Instagram post and every photograph in it, published or not */
export interface AdminPost {
  collection: string;
  date: string;
  place: string | null;
  photos: AdminPhoto[];
}

export interface AdminData {
  now: AdminItem[];
  before: AdminItem[];
  log: AdminLogEntry[];
  facts: { shelf: AdminFact | null; kettle: AdminFact | null };
  records: AdminRecord[];
  photographs: AdminPost[];
}

interface ItemRow {
  id: number;
  slug: string;
  section: Section;
  position: number;
  text: string;
  aside: string | null;
  label_status: AdminItem["labelStatus"];
  label_era: string | null;
  label_made_of: string | null;
  label_text: string | null;
  label_kind: AdminItem["labelKind"];
  label_note: string | null;
  snapshot_url: string | null;
  snapshot_at: string | null;
  snapshot_status: string | null;
}

interface RecordRow {
  id: number;
  title: string;
  artist: string;
  audio_key: string;
  cover_key: string;
  position: number;
  active: number;
}

interface PhotographRow {
  collection: string;
  published_on: string;
  place: string | null;
  id: string;
  title: string;
  published: number;
  raw_review: number;
  previews: string;
}

const PHOTOGRAPHS =
  "SELECT photo_posts.collection, photo_posts.published_on, photo_posts.place, photos.id, photos.title, photos.published, photos.raw_review, photos.previews FROM photo_posts JOIN photos ON photos.collection = photo_posts.collection ORDER BY photo_posts.published_at DESC, photos.position";

/** A photograph's previews, or none when the column isn't a list (the schema keeps it valid JSON): one odd row mustn't take the whole admin page down */
function previewsOf(json: string): { key: string; width: number; height: number }[] {
  const previews: unknown = JSON.parse(json);
  return Array.isArray(previews) ? previews : [];
}

/** Rows in post order, newest post first, grouped into posts */
function toPosts(rows: PhotographRow[]): AdminPost[] {
  const posts: AdminPost[] = [];
  for (const row of rows) {
    const last = posts.at(-1);
    const post = last && last.collection === row.collection ? last : { collection: row.collection, date: row.published_on, place: row.place, photos: [] as AdminPhoto[] };
    if (post !== last) posts.push(post);
    const thumb = previewsOf(row.previews).find((preview) => preview.key.endsWith("/240.webp"));
    post.photos.push({ id: row.id, title: row.title, published: row.published === 1, rawReview: row.raw_review === 1, thumb: thumb ? { url: `/media/${thumb.key}`, width: thumb.width, height: thumb.height } : null });
  }
  return posts;
}

type Placed = { id: number; position: number };

const ITEM_COLUMNS = "id, slug, section, position, text, aside, label_status, label_era, label_made_of, label_text, label_kind, label_note, snapshot_url, snapshot_at, snapshot_status";
const RECORD_COLUMNS = "id, title, artist, audio_key, cover_key, position, active";

const toItem = (row: ItemRow): AdminItem => ({
  id: row.id,
  slug: row.slug,
  section: row.section,
  position: row.position,
  text: row.text,
  aside: row.aside,
  labelStatus: row.label_status,
  labelEra: row.label_era,
  labelMadeOf: row.label_made_of,
  labelText: row.label_text,
  labelKind: row.label_kind,
  labelNote: row.label_note,
  snapshotUrl: row.snapshot_url,
  snapshotAt: row.snapshot_at,
  snapshotStatus: row.snapshot_status,
});

const toRecord = (row: RecordRow): AdminRecord => ({
  id: row.id,
  title: row.title,
  artist: row.artist,
  audioKey: row.audio_key,
  coverKey: row.cover_key,
  position: row.position,
  active: row.active === 1,
});

/** Everything the admin page shows, in one batch: unlike the logbook, every log entry, every record and every photograph */
export async function loadAdmin(db: D1Database): Promise<AdminData> {
  const [items, log, facts, records, photographs] = await db.batch([
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY section, position`),
    db.prepare("SELECT id, date, precision, text FROM log_entries ORDER BY date DESC, created_at DESC, id DESC"),
    db.prepare("SELECT key, title, subtitle FROM facts"),
    db.prepare(`SELECT ${RECORD_COLUMNS} FROM records ORDER BY active DESC, position`),
    db.prepare(PHOTOGRAPHS),
  ]);
  const all = (items.results as unknown as ItemRow[]).map(toItem);
  const factRows = facts.results as unknown as { key: string; title: string; subtitle: string | null }[];
  const fact = (key: string): AdminFact | null => {
    const found = factRows.find((entry) => entry.key === key);
    return found ? { title: found.title, subtitle: found.subtitle } : null;
  };
  return {
    now: all.filter((item) => item.section === "now"),
    before: all.filter((item) => item.section === "before"),
    log: (log.results as unknown as AdminLogEntry[]).map(({ id, date, precision, text }) => ({ id, date, precision, text })),
    facts: { shelf: fact("shelf"), kettle: fact("kettle") },
    records: (records.results as unknown as RecordRow[]).map(toRecord),
    photographs: toPosts(photographs.results as unknown as PhotographRow[]),
  };
}

// Positions are unique (migration 0004), so a swap goes through a free negative position
async function swap(db: D1Database, table: "items" | "records", a: Placed, b: Placed) {
  const touch = table === "items" ? `, updated_at = ${NOW}` : "";
  await db.batch([
    db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).bind(-a.id, a.id),
    db.prepare(`UPDATE ${table} SET position = ?${touch} WHERE id = ?`).bind(a.position, b.id),
    db.prepare(`UPDATE ${table} SET position = ?${touch} WHERE id = ?`).bind(b.position, a.id),
  ]);
}

// Now and before lines

const itemValues = (input: ItemInput) => [
  input.slug,
  input.text,
  input.aside,
  input.label?.status ?? null,
  input.label?.era ?? null,
  input.label?.madeOf ?? null,
  input.label?.text ?? null,
  input.label?.kind ?? null,
  input.label?.note ?? null,
];

export async function slugTaken(db: D1Database, slug: string, exceptId: number | null): Promise<boolean> {
  return (await db.prepare("SELECT id FROM items WHERE slug = ? AND id IS NOT ?").bind(slug, exceptId).first()) !== null;
}

/** Adds a line at the end of its section and returns its id, or 0 if the slug is taken (checked in the same statement) */
export async function createItem(db: D1Database, input: ItemInput): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO items (section, position, slug, text, aside, label_status, label_era, label_made_of, label_text, label_kind, label_note, snapshot_url)
       VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE section = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO NOTHING`,
    )
    .bind(input.section, input.section, ...itemValues(input), input.snapshotUrl)
    .run();
  return result.meta.changes > 0 ? result.meta.last_row_id : 0;
}

/** Whether a line is saved with a page to snapshot, which is what gives it a line (and a re-shoot form) on the admin page */
export async function hasSnapshotUrl(db: D1Database, id: number): Promise<boolean> {
  return (await db.prepare("SELECT id FROM items WHERE id = ? AND snapshot_url IS NOT NULL AND snapshot_url != ''").bind(id).first()) !== null;
}

/** Whether this exact line (slug, section and text) is already saved: a double-tapped add arrives twice */
export async function sameItem(db: D1Database, input: ItemInput): Promise<boolean> {
  const found = await db.prepare("SELECT id FROM items WHERE slug = ? AND section = ? AND text = ?").bind(input.slug, input.section, input.text).first();
  return found !== null;
}

/**
 * Saves a line and stamps updated_at. Moving it to the other section puts it at the end there; a new snapshot address
 * drops the old snapshot, so one site's capture never shows under another's address. False if the line is gone.
 */
export async function updateItem(db: D1Database, id: number, input: ItemInput): Promise<boolean> {
  const current = await db.prepare("SELECT section FROM items WHERE id = ?").bind(id).first<{ section: Section }>();
  if (!current) return false;
  const moved = current.section !== input.section;
  const position = moved ? "(SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE section = ?)" : "position";
  const keepIfSameUrl = (column: string) => `${column} = CASE WHEN snapshot_url IS ? THEN ${column} ELSE NULL END`;
  await db
    .prepare(
      `UPDATE items SET section = ?, position = ${position},
         slug = ?, text = ?, aside = ?, label_status = ?, label_era = ?, label_made_of = ?, label_text = ?, label_kind = ?, label_note = ?,
         ${keepIfSameUrl("snapshot_key")}, ${keepIfSameUrl("snapshot_at")}, ${keepIfSameUrl("snapshot_status")}, snapshot_url = ?,
         updated_at = ${NOW}
       WHERE id = ?`,
    )
    .bind(
      input.section,
      ...(moved ? [input.section] : []),
      ...itemValues(input),
      input.snapshotUrl,
      input.snapshotUrl,
      input.snapshotUrl,
      input.snapshotUrl,
      id,
    )
    .run();
  return true;
}

/** Swaps a line with its nearest neighbour above or below in its section; returns the section, or null if the line is gone */
export async function moveItem(db: D1Database, id: number, direction: "up" | "down"): Promise<Section | null> {
  const item = await db.prepare("SELECT section, position FROM items WHERE id = ?").bind(id).first<{ section: Section; position: number }>();
  if (!item) return null;
  const neighbour = await db
    .prepare(
      direction === "up"
        ? "SELECT id, position FROM items WHERE section = ? AND position < ? ORDER BY position DESC LIMIT 1"
        : "SELECT id, position FROM items WHERE section = ? AND position > ? ORDER BY position LIMIT 1",
    )
    .bind(item.section, item.position)
    .first<Placed>();
  if (neighbour) await swap(db, "items", { id, position: item.position }, neighbour);
  return item.section;
}

/** Removes a line; returns its section, or null if it was already gone */
export async function removeItem(db: D1Database, id: number): Promise<Section | null> {
  const item = await db.prepare("SELECT section FROM items WHERE id = ?").bind(id).first<{ section: Section }>();
  if (!item) return null;
  await db.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  return item.section;
}

// Log entries

/** Adds an entry and returns its id, or 0 when the same entry is already there (a double-tapped add saves once) */
export async function createLogEntry(db: D1Database, entry: LogInput): Promise<number> {
  // One statement, so two taps that arrive together can't both insert
  const result = await db
    .prepare(
      `INSERT INTO log_entries (date, precision, text) SELECT ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM log_entries WHERE date = ? AND precision = ? AND text = ?)`,
    )
    .bind(entry.date, entry.precision, entry.text, entry.date, entry.precision, entry.text)
    .run();
  return result.meta.changes > 0 ? result.meta.last_row_id : 0;
}

export async function updateLogEntry(db: D1Database, id: number, entry: LogInput): Promise<boolean> {
  const result = await db
    .prepare("UPDATE log_entries SET date = ?, precision = ?, text = ? WHERE id = ?")
    .bind(entry.date, entry.precision, entry.text, id)
    .run();
  return result.meta.changes > 0;
}

export async function removeLogEntry(db: D1Database, id: number): Promise<boolean> {
  return (await db.prepare("DELETE FROM log_entries WHERE id = ?").bind(id).run()).meta.changes > 0;
}

// Lately

/** Saves the shelf or kettle fact; null clears it, which hides that half of the lately row */
export async function saveFact(db: D1Database, key: "shelf" | "kettle", fact: AdminFact | null): Promise<void> {
  if (!fact) {
    await db.prepare("DELETE FROM facts WHERE key = ?").bind(key).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO facts (key, title, subtitle) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, updated_at = ${NOW}`,
    )
    .bind(key, fact.title, fact.subtitle)
    .run();
}

// Records

export async function activeRecordCount(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM records WHERE active = 1").first<number>("n")) ?? 0;
}

export async function getRecord(db: D1Database, id: number): Promise<AdminRecord | null> {
  const found = await db.prepare(`SELECT ${RECORD_COLUMNS} FROM records WHERE id = ?`).bind(id).first<RecordRow>();
  return found ? toRecord(found) : null;
}

/**
 * Adds an active record at the end of the crate and returns its id. Returns 0, adding nothing, when the crate is full
 * or already holds this record; one statement checks both, so two adds at once can't get past either.
 */
export async function createRecord(db: D1Database, record: RecordMeta & { audioKey: string; coverKey: string }): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO records (title, artist, audio_key, cover_key, position, active)
       SELECT ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM records), 1
       WHERE (SELECT COUNT(*) FROM records WHERE active = 1) < ?
         AND NOT EXISTS (SELECT 1 FROM records WHERE active = 1 AND title = ? AND artist = ?)`,
    )
    .bind(record.title, record.artist, record.audioKey, record.coverKey, RECORD_CAP, record.title, record.artist)
    .run();
  return result.meta.changes > 0 ? result.meta.last_row_id : 0;
}

/** Whether the crate already holds a record with this title and artist: a double-tapped add arrives twice */
export async function recordInCrate(db: D1Database, meta: RecordMeta): Promise<boolean> {
  const found = await db.prepare("SELECT id FROM records WHERE active = 1 AND title = ? AND artist = ?").bind(meta.title, meta.artist).first();
  return found !== null;
}

/** Whether a record row uses this audio key: after a failed add, tells whether the insert landed anyway */
export async function recordWithAudio(db: D1Database, audioKey: string): Promise<boolean> {
  return (await db.prepare("SELECT id FROM records WHERE audio_key = ?").bind(audioKey).first()) !== null;
}

export async function updateRecord(db: D1Database, id: number, meta: RecordMeta): Promise<boolean> {
  return (await db.prepare("UPDATE records SET title = ?, artist = ? WHERE id = ?").bind(meta.title, meta.artist, id).run()).meta.changes > 0;
}

export async function setRecordActive(db: D1Database, id: number, active: boolean): Promise<boolean> {
  return (await db.prepare("UPDATE records SET active = ? WHERE id = ?").bind(active ? 1 : 0, id).run()).meta.changes > 0;
}

/** Swaps a record with its nearest neighbour of the same state (active or not); false if it's gone */
export async function moveRecord(db: D1Database, id: number, direction: "up" | "down"): Promise<boolean> {
  const record = await getRecord(db, id);
  if (!record) return false;
  const neighbour = await db
    .prepare(
      direction === "up"
        ? "SELECT id, position FROM records WHERE active = ? AND position < ? ORDER BY position DESC LIMIT 1"
        : "SELECT id, position FROM records WHERE active = ? AND position > ? ORDER BY position LIMIT 1",
    )
    .bind(record.active ? 1 : 0, record.position)
    .first<Placed>();
  if (neighbour) await swap(db, "records", { id, position: record.position }, neighbour);
  return true;
}

export async function removeRecord(db: D1Database, id: number): Promise<boolean> {
  return (await db.prepare("DELETE FROM records WHERE id = ?").bind(id).run()).meta.changes > 0;
}

// Photographs

/** A post's photographs in post order, or null when the post doesn't exist */
export async function postPhotoIds(db: D1Database, collection: string): Promise<string[] | null> {
  const [post, photos] = await db.batch([
    db.prepare("SELECT collection FROM photo_posts WHERE collection = ?").bind(collection),
    db.prepare("SELECT id FROM photos WHERE collection = ? ORDER BY position").bind(collection),
  ]);
  if (post.results.length === 0) return null;
  return (photos.results as unknown as { id: string }[]).map((row) => row.id);
}

/** Sets a post's place and marks it edited, so a later import keeps it (spec 6.2); false when the post doesn't exist */
export async function savePostPlace(db: D1Database, collection: string, place: string | null): Promise<boolean> {
  const result = await db.prepare("UPDATE photo_posts SET place = ?, place_edited = 1 WHERE collection = ?").bind(place, collection).run();
  return result.meta.changes > 0;
}

/** False when the photograph doesn't exist */
export async function savePhotoTitle(db: D1Database, id: string, title: string): Promise<boolean> {
  const result = await db.prepare("UPDATE photos SET title = ? WHERE id = ?").bind(title, id).run();
  return result.meta.changes > 0;
}
