// The import's writes to D1 (spec 7.3): posts first, because every public query joins a photograph to its post (spec 8).

// The time and date always; the place only until George edits it in /admin (place_edited)
const POST_UPSERT = `INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)
  ON CONFLICT(collection) DO UPDATE SET published_at = excluded.published_at, published_on = excluded.published_on,
  place = CASE WHEN photo_posts.place_edited = 1 THEN photo_posts.place ELSE excluded.place END`;

// A title comes from the manifest only when the row is first inserted, then only from /admin (spec 2.2). A changed master
// is unpublished; an unchanged one keeps its publication.
const PHOTO_UPSERT = `INSERT INTO photos (id, collection, position, title, raw_review, previews, print_key, print_width, print_height, print_bytes, print_sha256)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET collection = excluded.collection, position = excluded.position, raw_review = excluded.raw_review,
  previews = excluded.previews, print_key = excluded.print_key, print_width = excluded.print_width, print_height = excluded.print_height,
  print_bytes = excluded.print_bytes, print_sha256 = excluded.print_sha256,
  published = CASE WHEN photos.print_sha256 = excluded.print_sha256 THEN photos.published ELSE 0 END`;

/** A post's row: seconds since 1970, and the date part of its own time, which is the day in the post's offset (spec 7.1) */
export const postRow = (post) => [post.collection, Math.floor(Date.parse(post.publishedAt) / 1000), post.publishedAt.slice(0, 10), post.place];

export async function upsertPosts(db, posts) {
  if (posts.length === 0) return;
  await db.batch(posts.map((post) => db.prepare(POST_UPSERT).bind(...postRow(post))));
}

export async function upsertPhoto(db, photo) {
  const previews = photo.previews.map(({ key, width, height, format }) => ({ key, width, height, format }));
  await db.prepare(PHOTO_UPSERT)
    .bind(photo.id, photo.collection, photo.position, photo.title, photo.needsRawReview ? 1 : 0, JSON.stringify(previews), photo.print.key, photo.print.width, photo.print.height, photo.print.bytes, photo.print.sha256)
    .run();
}
