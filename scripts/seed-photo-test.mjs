import { createHash } from "node:crypto";
import sharp from "sharp";
import { photoPlatform } from "./photo-platform.mjs";

const i = process.argv.indexOf("--persist-to");
if (i < 0 || !process.argv[i + 1] || process.argv.includes("--remote")) throw new Error("usage: node scripts/seed-photo-test.mjs --persist-to local-fixture-directory");

// The gallery fixture (spec 11.3), newest first: six posts, so the gallery has a second page. fixture-03 is unpublished,
// fixture-b has no place, fixture-c-01 awaits RAW review and only fixture-01 has a title.
const POSTS = [
  { collection: "fixture", publishedAt: "2026-09-27T18:30:00+10:00", place: "bondi, sydney", photos: [["fixture-01", 2048, 2048, "a test photograph"], ["fixture-02", 2048, 2048], ["fixture-03", 2048, 2048]] },
  { collection: "fixture-b", publishedAt: "2026-06-14T09:15:00+10:00", place: null, photos: [["fixture-b-01", 4000, 6000], ["fixture-b-02", 6000, 4000]] },
  { collection: "fixture-c", publishedAt: "2026-03-01T12:00:00+11:00", place: "fremantle, perth", photos: [["fixture-c-01", 1200, 1800]] },
  { collection: "fixture-d", publishedAt: "2025-12-25T08:00:00+11:00", place: "manly, sydney", photos: [["fixture-d-01", 2048, 2048]] },
  { collection: "fixture-e", publishedAt: "2025-08-09T16:45:00+10:00", place: "braddon, canberra", photos: [["fixture-e-01", 2048, 2048]] },
  { collection: "fixture-f", publishedAt: "2025-02-02T20:27:48+11:00", place: "valletta, malta", photos: [["fixture-f-01", 2048, 2048]] },
];
const UNPUBLISHED = new Set(["fixture-03"]);
const RAW = new Set(["fixture-c-01"]);
const SIZES = [480, 960, 1600];
const COLOURS = ["#25475e", "#5e4a25", "#3d5e25", "#5e2541", "#2f2f5e", "#5e3b25"];

const platform = await photoPlatform({ persistTo: process.argv[i + 1], remote: false });
try {
  // Fixtures only: a store that already holds real photographs (a local import) is refused, so they can never mix
  const real = await platform.env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE collection NOT LIKE 'fixture%'").first("n");
  if (real > 0) throw new Error("This store holds real photos; seed a separate store (--persist-to)");
  let position = 0;
  for (const [index, post] of POSTS.entries()) {
    // Upserts, so seeding the main store again (bun run check) refreshes it rather than failing
    await platform.env.DB.prepare(`INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)
      ON CONFLICT(collection) DO UPDATE SET published_at = excluded.published_at, published_on = excluded.published_on, place = excluded.place, place_edited = 0`)
      .bind(post.collection, Date.parse(post.publishedAt) / 1000, post.publishedAt.slice(0, 10), post.place).run();
    for (const [id, width, height, title = ""] of post.photos) {
      const jpeg = await sharp({ create: { width, height, channels: 3, background: COLOURS[index] } }).withIccProfile("srgb").jpeg().toBuffer();
      const sha = createHash("sha256").update(jpeg).digest("hex");
      const printKey = `prints/${id}/${sha}.jpg`;
      await platform.env.PHOTO_PRINTS.put(printKey, jpeg, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: sha } });
      const previews = [];
      for (const size of SIZES) for (const format of ["webp", "avif"]) {
        // Fitted inside the square, as photos:prepare does, so each preview has its real width and height
        const resized = sharp(jpeg).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
        const { data, info } = await (format === "webp" ? resized.webp() : resized.avif({ effort: 0 })).toBuffer({ resolveWithObject: true });
        const key = `photos/previews/${id}/${sha}/${size}.${format}`;
        await platform.env.MEDIA.put(key, data, { httpMetadata: { contentType: `image/${format}` } });
        previews.push({ key, width: info.width, height: info.height, format });
      }
      await platform.env.DB.prepare(`INSERT INTO photos (id, collection, position, title, published, raw_review, previews, print_key, print_width, print_height, print_bytes, print_sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET collection = excluded.collection, position = excluded.position, title = excluded.title, published = excluded.published,
        raw_review = excluded.raw_review, previews = excluded.previews, print_key = excluded.print_key, print_width = excluded.print_width,
        print_height = excluded.print_height, print_bytes = excluded.print_bytes, print_sha256 = excluded.print_sha256`)
        .bind(id, post.collection, position++, title, UNPUBLISHED.has(id) ? 0 : 1, RAW.has(id) ? 1 : 0, JSON.stringify(previews), printKey, width, height, jpeg.length, sha).run();
    }
  }
  console.log(`Seeded ${POSTS.length} synthetic photo posts into local storage.`);
} finally { await platform.dispose(); }
