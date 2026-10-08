import { GRANT_ID, PHOTO_ID, type PhotoToken } from "./tokens";

export interface Preview {
  key: string;
  width: number;
  height: number;
  format: "avif" | "webp";
}
export interface PhotoRow {
  id: string;
  collection: string;
  position: number;
  title: string;
  published: number;
  raw_review: number;
  previews: string;
  print_key: string;
  print_width: number;
  print_height: number;
  print_bytes: number;
  print_sha256: string;
}
/** A photograph joined to its post: every public query joins the two, so a photograph without a post isn't shown (spec 8) */
export interface PublicPhotoRow extends PhotoRow {
  published_at: number;
  published_on: string;
  place: string | null;
}
export interface PublicPreview {
  url: string;
  width: number;
  height: number;
  format: "avif" | "webp";
}
export interface PublicPhoto {
  id: string;
  collection: string;
  title: string;
  width: number;
  height: number;
  downloadBytes: number;
  /** The day the post went up, in the post's own offset (YYYY-MM-DD) */
  date: string;
  /** "area, city", or null (ADR-0022) */
  place: string | null;
  previews: PublicPreview[];
}
/** One Instagram post with its published photographs in post order: an entry in the gallery (spec 3.2) */
export interface Entry {
  collection: string;
  date: string;
  place: string | null;
  /** Seconds since 1970: the sort key and the pager's cursor */
  publishedAt: number;
  photos: PublicPhoto[];
}
export interface EntryPage {
  entries: Entry[];
  /** The cursor for the next page (the last entry's publishedAt), or null at the end */
  next: number | null;
}
export const CATALOGUE_LIMIT = 24;
export const MAX_CATALOGUE_LIMIT = 48;
export const ENTRY_LIMIT = 4;
export const MAX_ENTRY_LIMIT = 12;
/** The previews the gallery uses (spec 3.3) */
export const GALLERY_SIZES = [240, 480] as const;

/** Every photograph has four sizes (240, 480, 960, 1600) in two formats (spec 2.2) */
export const PREVIEW_COUNT = 8;

const PUBLIC = "SELECT photos.*, photo_posts.published_at, photo_posts.published_on, photo_posts.place FROM photos JOIN photo_posts ON photo_posts.collection = photos.collection";
/** A page of posts that have a published photograph, newest first; bound with (cursor, limit + 1) */
const POSTS =
  "SELECT collection, published_at, published_on, place FROM photo_posts WHERE published_at < ? AND EXISTS (SELECT 1 FROM photos WHERE photos.collection = photo_posts.collection AND photos.published = 1) ORDER BY published_at DESC LIMIT ?";
/** Later than any post: ?before= allows ten digits */
const NEWEST = 9_999_999_999;

interface PostRow {
  collection: string;
  published_at: number;
  published_on: string;
  place: string | null;
}

/** A preview's size from its key: photos/previews/<id>/<sha>/240.avif is 240 */
export const previewSize = (key: string) => Number(/\/(\d+)\.(?:avif|webp)$/.exec(key)?.[1] ?? 0);

/** The public face of a photograph: no private key, no hash. `sizes` keeps only those previews (the gallery's 240 and 480) */
export function publicPhoto(row: PublicPhotoRow, sizes: readonly number[] | null = null): PublicPhoto {
  const previews = (JSON.parse(row.previews) as Preview[]).filter((preview) => sizes === null || sizes.includes(previewSize(preview.key)));
  return {
    id: row.id, collection: row.collection, title: row.title,
    width: row.print_width, height: row.print_height, downloadBytes: row.print_bytes,
    date: row.published_on, place: row.place,
    previews: previews.map(({ key, width, height, format }) => ({ url: `/media/${key}`, width, height, format })),
  };
}

export async function photoById(db: D1Database, id: string): Promise<PublicPhotoRow | null> {
  if (!PHOTO_ID.test(id)) return null;
  return db.prepare(`${PUBLIC} WHERE photos.id = ? AND photos.published = 1`).bind(id).first<PublicPhotoRow>();
}

export async function photoPage(db: D1Database, after = -1, limit = CATALOGUE_LIMIT, collection: string | null = null) {
  const result = collection === null
    ? await db.prepare(`${PUBLIC} WHERE photos.published = 1 AND photos.position > ? ORDER BY photos.position LIMIT ?`).bind(after, limit + 1).all<PublicPhotoRow>()
    : await db.prepare(`${PUBLIC} WHERE photos.published = 1 AND photos.position > ? AND photos.collection = ? ORDER BY photos.position LIMIT ?`).bind(after, collection, limit + 1).all<PublicPhotoRow>();
  const rows = result.results.slice(0, limit);
  return { photos: rows.map((row) => publicPhoto(row)), next: result.results.length > limit ? rows.at(-1)!.position : null };
}

/**
 * A page of entries posted before `before` (seconds; null for the newest), each with its published photographs in post
 * order (spec 3.2 and 3.6). One batch: the page of posts, then their photographs, which repeats the page's subquery so
 * both run in the same round trip (spec 3.5). It asks for limit + 1 posts to know whether a next page exists.
 */
export async function entryPage(db: D1Database, before: number | null, limit: number, sizes: readonly number[] = GALLERY_SIZES): Promise<EntryPage> {
  const cursor = before ?? NEWEST;
  const [posts, photos] = await db.batch([
    db.prepare(POSTS).bind(cursor, limit + 1),
    db.prepare(
      `SELECT photos.*, page.published_at, page.published_on, page.place FROM photos JOIN (${POSTS}) AS page ON page.collection = photos.collection WHERE photos.published = 1 ORDER BY page.published_at DESC, photos.position`,
    ).bind(cursor, limit + 1),
  ]);
  const postRows = posts.results as unknown as PostRow[];
  const shown = postRows.slice(0, limit);
  const byPost = new Map(shown.map((post) => [post.collection, [] as PublicPhoto[]]));
  for (const row of photos.results as unknown as PublicPhotoRow[]) byPost.get(row.collection)?.push(publicPhoto(row, sizes));
  return {
    entries: shown.map((post) => ({ collection: post.collection, date: post.published_on, place: post.place, publishedAt: post.published_at, photos: byPost.get(post.collection) ?? [] })),
    next: postRows.length > limit ? shown.at(-1)!.published_at : null,
  };
}

export async function grantIsActive(db: D1Database, token: PhotoToken, now: number): Promise<boolean> {
  const row = await db.prepare("SELECT photo_id, expires_at, revoked_at FROM photo_download_grants WHERE id = ?").bind(token.grantId)
    .first<{ photo_id: string | null; expires_at: number; revoked_at: number | null }>();
  return !!row && row.revoked_at === null && row.expires_at > now && row.expires_at === token.expiresAt && row.photo_id === token.photoId;
}

export async function insertGrant(db: D1Database, token: PhotoToken): Promise<void> {
  await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES (?, ?, ?)").bind(token.grantId, token.photoId, token.expiresAt).run();
}

export async function revokeGrant(db: D1Database, id: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!GRANT_ID.test(id)) return false;
  const result = await db.prepare("UPDATE photo_download_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, id).run();
  return result.meta.changes > 0;
}
