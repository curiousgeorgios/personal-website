import { createHash } from "node:crypto";
import sharp from "sharp";
import { photoPlatform } from "./photo-platform.mjs";

const i = process.argv.indexOf("--persist-to");
if (i < 0 || !process.argv[i + 1] || process.argv.includes("--remote")) throw new Error("usage: node scripts/seed-photo-test.mjs --persist-to local-fixture-directory");
const platform = await photoPlatform({ persistTo: process.argv[i + 1], remote: false });
try {
  const jpeg = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: "#25475e" } }).withIccProfile("srgb").jpeg().toBuffer();
  const sha = createHash("sha256").update(jpeg).digest("hex");
  for (const [position, id] of ["fixture-01", "fixture-02", "fixture-03"].entries()) {
    const printKey = `prints/${id}/${sha}.jpg`;
    await platform.env.PHOTO_PRINTS.put(printKey, jpeg, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: sha } });
    const previews = [];
    for (const size of [480, 960, 1600]) for (const format of ["webp", "avif"]) {
      const resize = sharp(jpeg).resize(size);
      const bytes = await (format === "webp" ? resize.webp() : resize.avif({ effort: 0 })).toBuffer();
      const key = `photos/previews/${id}/${sha}/${size}.${format}`;
      await platform.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: `image/${format}` } });
      previews.push({ key, width: size, height: size, format });
    }
    await platform.env.DB.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, "fixture", position, "Test photograph", id === "fixture-03" ? 0 : 1, JSON.stringify(previews), printKey, 2048, 2048, jpeg.length, sha).run();
  }
  console.log("Seeded three synthetic photo fixtures into local storage.");
} finally { await platform.dispose(); }
