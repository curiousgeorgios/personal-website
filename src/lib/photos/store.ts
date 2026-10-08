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
  previews: string;
  print_key: string;
  print_width: number;
  print_height: number;
  print_bytes: number;
  print_sha256: string;
}
export const CATALOGUE_LIMIT = 24;
export const MAX_CATALOGUE_LIMIT = 48;

export function publicPhoto(row: PhotoRow) {
  const previews = JSON.parse(row.previews) as Preview[];
  return {
    id: row.id, collection: row.collection, title: row.title,
    width: row.print_width, height: row.print_height, downloadBytes: row.print_bytes,
    previews: previews.map(({ key, width, height, format }) => ({ url: `/media/${key}`, width, height, format })),
  };
}

export async function photoById(db: D1Database, id: string): Promise<PhotoRow | null> {
  if (!PHOTO_ID.test(id)) return null;
  return db.prepare("SELECT * FROM photos WHERE id = ? AND published = 1").bind(id).first<PhotoRow>();
}

export async function photoPage(db: D1Database, after = -1, limit = CATALOGUE_LIMIT, collection: string | null = null) {
  const result = collection === null
    ? await db.prepare("SELECT * FROM photos WHERE published = 1 AND position > ? ORDER BY position LIMIT ?").bind(after, limit + 1).all<PhotoRow>()
    : await db.prepare("SELECT * FROM photos WHERE published = 1 AND position > ? AND collection = ? ORDER BY position LIMIT ?").bind(after, collection, limit + 1).all<PhotoRow>();
  const rows = result.results.slice(0, limit);
  return { photos: rows.map(publicPhoto), next: result.results.length > limit ? rows.at(-1)!.position : null };
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
