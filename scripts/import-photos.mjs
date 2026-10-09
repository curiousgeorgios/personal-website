import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import sharp from "sharp";
import { checkPhotoRecord, checkPosts } from "./photo-manifest.mjs";
import { upsertPhoto, upsertPosts } from "./photo-import-db.mjs";
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
if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.photos)) throw new Error("Unsupported prepared manifest: run photos:prepare again");
if (manifest.photos.length !== allowed.size) throw new Error("Prepared manifest must contain the complete selected catalogue");
const ids = new Set();
const positions = new Set();
const hash = (data) => createHash("sha256").update(data).digest("hex");
for (const photo of manifest.photos) {
  checkPhotoRecord(photo);
  if (!allowed.has(photo.id) || ids.has(photo.id) || positions.has(photo.position)) throw new Error("Excluded, invalid or duplicate photo");
  ids.add(photo.id); positions.add(photo.position);
  for (const asset of [photo.print, ...photo.previews]) {
    const path = resolve(root, asset.file);
    if (!path.startsWith(root + sep) || asset.file !== asset.key) throw new Error("Asset path escapes preparation directory");
    const data = await readFile(path);
    const metadata = await sharp(data).metadata();
    if (data.length !== asset.bytes || hash(data) !== asset.sha256 || metadata.width !== asset.width || metadata.height !== asset.height) throw new Error(`Asset validation failed: ${photo.id}`);
    const expected = asset === photo.print ? "jpeg" : asset.format;
    const validFormat = expected === "avif" ? metadata.format === "heif" && metadata.compression === "av1" : metadata.format === expected;
    if (!validFormat || metadata.exif || metadata.xmp || metadata.iptc) throw new Error("Unexpected image format or private metadata");
    if (asset === photo.print && (!metadata.icc || metadata.space !== "srgb")) throw new Error("Print file has no sRGB colour profile");
  }
}
checkPosts(manifest);
// Validate the whole import before changing storage. Posts go first (every public query joins a photograph to its post),
// then each photograph's row only after its objects are present.
const platform = await photoPlatform({ remote: args.includes("--remote"), persistTo: arg("--persist-to") ?? ".wrangler/state" });
try {
  await upsertPosts(platform.env.DB, manifest.posts);
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
    await upsertPhoto(platform.env.DB, photo);
    console.log(`Imported ${photo.id} (${args.includes("--remote") ? "remote" : "local"})`);
  }
} finally { await platform.dispose(); }
console.log(`Imported ${manifest.posts.length} posts and ${manifest.photos.length} photos. New or changed masters remain unpublished; titles and edited places were kept.`);
