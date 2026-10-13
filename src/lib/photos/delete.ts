import { PHOTO_ID } from "./tokens";

/** Removes a photo from the catalogue, retaining its row and files for existing print orders. Repeats keep the first timestamp. */
export async function deletePhoto(db: D1Database, id: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!PHOTO_ID.test(id)) return false;
  const result = await db.prepare("UPDATE photos SET published = 0, deleted_at = COALESCE(deleted_at, ?) WHERE id = ?").bind(now, id).run();
  return result.meta.changes > 0;
}
