import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import sharp from "sharp";
import { photoPlatform } from "./photo-platform.mjs";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (!arg("--manifest") || !arg("--selection") || (args.includes("--local") === args.includes("--remote"))) {
  console.error("usage: bun run photos:import --manifest private-folder/manifest.json --selection gallery-selection.json --local | --remote [--persist-to .wrangler/state]");
  process.exit(1);
}
const manifestPath = resolve(arg("--manifest"));
const root = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const selection = JSON.parse(await readFile(resolve(arg("--selection")), "utf8"));
if (selection.schema_version !== 1 || !Array.isArray(selection.included)) throw new Error("Unsupported selection");
const allowed = new Set(selection.included.map((p) => p.id));
if (allowed.size !== selection.included.length) throw new Error("Duplicate photo in selection");
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.photos)) throw new Error("Unsupported prepared manifest");
if (manifest.photos.length !== allowed.size) throw new Error("Prepared manifest must contain the complete selected catalogue");
const ids = new Set();
const positions = new Set();
const hash = (data) => createHash("sha256").update(data).digest("hex");
for (const photo of manifest.photos) {
  if (!allowed.has(photo.id) || !/^[A-Za-z0-9_-]{1,64}-\d{2,3}$/.test(photo.id) || ids.has(photo.id) || positions.has(photo.position)) throw new Error("Excluded, invalid or duplicate photo");
  ids.add(photo.id); positions.add(photo.position);
  if (!Number.isSafeInteger(photo.position) || photo.position < 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(photo.collection)) throw new Error("Invalid catalogue record");
  if (photo.print.key !== `prints/${photo.id}/${photo.print.sha256}.jpg` || !/^[a-f0-9]{64}$/.test(photo.print.sha256)) throw new Error("Invalid print key");
  if (photo.previews.length !== 6 || new Set(photo.previews.map((p) => p.key)).size !== 6) throw new Error("Missing responsive variants");
  for (const asset of [photo.print, ...photo.previews]) {
    const path = resolve(root, asset.file);
    if (!path.startsWith(root + sep) || asset.file !== asset.key) throw new Error("Asset path escapes preparation directory");
    if (asset !== photo.print && (!asset.key.startsWith(`photos/previews/${photo.id}/${photo.print.sha256}/`) || !/\/(480|960|1600)\.(avif|webp)$/.test(asset.key))) throw new Error("Invalid preview key");
    const data = await readFile(path);
    const metadata = await sharp(data).metadata();
    if (data.length !== asset.bytes || hash(data) !== asset.sha256 || metadata.width !== asset.width || metadata.height !== asset.height) throw new Error(`Asset validation failed: ${photo.id}`);
    const expected = asset === photo.print ? "jpeg" : asset.format;
    const validFormat = expected === "avif" ? metadata.format === "heif" && metadata.compression === "av1" : metadata.format === expected;
    if (!validFormat || metadata.exif || metadata.xmp || metadata.iptc) throw new Error("Unexpected image format or private metadata");
    if (asset === photo.print && (!metadata.icc || metadata.space !== "srgb")) throw new Error("Print file has no sRGB colour profile");
  }
}
// Validate the whole import before changing storage. Each row is saved only after its objects are present.
const platform = await photoPlatform({ remote: args.includes("--remote"), persistTo: arg("--persist-to") ?? ".wrangler/state" });
try {
  for (const photo of manifest.photos) {
    for (const asset of [photo.print, ...photo.previews]) {
      const bucket = asset === photo.print ? platform.env.PHOTO_PRINTS : platform.env.MEDIA;
      const type = asset === photo.print ? "image/jpeg" : `image/${asset.format}`;
      const existing = await bucket.head(asset.key);
      if (existing?.size === asset.bytes && existing.customMetadata?.sha256 === asset.sha256 && existing.httpMetadata?.contentType === type) continue;
      const data = await readFile(resolve(root, asset.file));
      await bucket.put(asset.key, data, { httpMetadata: { contentType: type }, customMetadata: { sha256: asset.sha256 }, sha256: Uint8Array.from(Buffer.from(asset.sha256, "hex")) });
      const stored = await bucket.head(asset.key);
      if (stored?.size !== asset.bytes || stored.httpMetadata?.contentType !== type) throw new Error("Upload validation failed");
    }
    const previews = photo.previews.map(({ key, width, height, format }) => ({ key, width, height, format }));
    await platform.env.DB.prepare(`INSERT INTO photos (id, collection, position, title, previews, print_key, print_width, print_height, print_bytes, print_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET collection=excluded.collection, position=excluded.position, title=excluded.title,
      previews=excluded.previews, print_key=excluded.print_key, print_width=excluded.print_width, print_height=excluded.print_height,
      print_bytes=excluded.print_bytes, print_sha256=excluded.print_sha256,
      published=CASE WHEN photos.print_sha256=excluded.print_sha256 THEN photos.published ELSE 0 END`)
      .bind(photo.id, photo.collection, photo.position, photo.title, JSON.stringify(previews), photo.print.key, photo.print.width, photo.print.height, photo.print.bytes, photo.print.sha256).run();
    console.log(`Imported ${photo.id} (${args.includes("--remote") ? "remote" : "local"})`);
  }
} finally { await platform.dispose(); }
console.log(`Imported ${manifest.photos.length} photos. New or changed masters remain unpublished.`);
