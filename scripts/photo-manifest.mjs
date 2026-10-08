import { checkPlace } from "../src/lib/photos/place.ts";

// The prepared manifest's shape, checked before the import touches any storage (spec 2.2 and 7.3)

/** Every photograph has these four sizes in both formats: eight previews (spec 2.2) */
export const PREVIEW_SIZES = [240, 480, 960, 1600];
export const PREVIEW_FORMATS = ["webp", "avif"];
export const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}-\d{2,3}$/;
export const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;

/** A post's time as the index gives it, with its own offset: 2025-02-02T20:27:48+11:00 */
export const PUBLISHED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Throws unless one photograph's record is well formed: its id, its post, its master's key and its eight previews */
export function checkPhotoRecord(photo) {
  if (typeof photo.needsRawReview !== "boolean" || typeof photo.id !== "string" || !PHOTO_ID.test(photo.id) || !Number.isSafeInteger(photo.position) || photo.position < 0 || typeof photo.collection !== "string" || !COLLECTION.test(photo.collection)) {
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

/** Throws unless the manifest's posts are well formed and match its photographs one for one (spec 7.1) */
export function checkPosts(manifest) {
  if (!Array.isArray(manifest.posts)) throw new Error("Prepared manifest has no posts: run photos:prepare again");
  const collections = new Set();
  const seconds = new Set();
  for (const post of manifest.posts) {
    if (typeof post.collection !== "string" || !COLLECTION.test(post.collection) || collections.has(post.collection)) throw new Error(`Invalid or duplicate post: ${post.collection}`);
    collections.add(post.collection);
    if (typeof post.publishedAt !== "string" || !PUBLISHED_AT.test(post.publishedAt) || !Number.isFinite(Date.parse(post.publishedAt))) throw new Error(`Invalid post time: ${post.collection}`);
    // published_at is unique in D1: two posts in one second would fail the import half way
    const second = Math.floor(Date.parse(post.publishedAt) / 1000);
    if (seconds.has(second)) throw new Error(`Two posts share a time: ${post.collection}`);
    seconds.add(second);
    if (post.place !== null) {
      const checked = typeof post.place === "string" ? checkPlace(post.place) : null;
      if (!checked?.ok || checked.place !== post.place) throw new Error(`Invalid place: ${post.collection}`);
    }
  }
  for (const photo of manifest.photos) if (!collections.has(photo.collection)) throw new Error(`Photo without a post: ${photo.id}`);
  for (const collection of collections) if (!manifest.photos.some((photo) => photo.collection === collection)) throw new Error(`Post without photos: ${collection}`);
}
