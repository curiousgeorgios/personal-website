// The prepared manifest's shape, checked before the import touches any storage (spec 2.2 and 7.3)

/** Every photograph has these four sizes in both formats: eight previews (spec 2.2) */
export const PREVIEW_SIZES = [240, 480, 960, 1600];
export const PREVIEW_FORMATS = ["webp", "avif"];
export const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}-\d{2,3}$/;
export const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;

/** Throws unless one photograph's record is well formed: its id, its post, its master's key and its eight previews */
export function checkPhotoRecord(photo) {
  if (typeof photo.id !== "string" || !PHOTO_ID.test(photo.id) || !Number.isSafeInteger(photo.position) || photo.position < 0 || typeof photo.collection !== "string" || !COLLECTION.test(photo.collection)) {
    throw new Error(`Invalid catalogue record: ${photo.id}`);
  }
  if (typeof photo.print?.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(photo.print.sha256) || photo.print.key !== `prints/${photo.id}/${photo.print.sha256}.jpg`) {
    throw new Error(`Invalid print key: ${photo.id}`);
  }
  const expected = PREVIEW_SIZES.flatMap((size) => PREVIEW_FORMATS.map((format) => `photos/previews/${photo.id}/${photo.print.sha256}/${size}.${format}`));
  const keys = Array.isArray(photo.previews) ? photo.previews.map((preview) => preview.key) : [];
  if (keys.length !== expected.length || new Set(keys).size !== keys.length) throw new Error(`Missing responsive variants: ${photo.id}`);
  for (const preview of photo.previews) {
    if (!expected.includes(preview.key) || !preview.key.endsWith(`.${preview.format}`)) throw new Error(`Invalid preview key: ${photo.id}`);
  }
}
