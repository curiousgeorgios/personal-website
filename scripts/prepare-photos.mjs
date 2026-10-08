import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { PREVIEW_FORMATS, PREVIEW_SIZES, PUBLISHED_AT } from "./photo-manifest.mjs";
import { pickGeocoded, placeFromPlacemark, postPlace } from "./photo-places.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (!arg("--selection") || !arg("--index") || !arg("--output")) {
  console.error("usage: bun run photos:prepare --selection selection.json --index photo-index.json --output private-folder [--limit N]");
  process.exit(1);
}
const selection = JSON.parse(await readFile(resolve(arg("--selection")), "utf8"));
const index = JSON.parse(await readFile(resolve(arg("--index")), "utf8"));
const output = resolve(arg("--output"));
const repo = resolve(fileURLToPath(new URL("../", import.meta.url)));
if (output === repo || output.startsWith(`${repo}/`)) throw new Error("Prepare private photo files outside the website checkout");
const limit = arg("--limit") === null ? selection.included.length : Number(arg("--limit"));
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid preparation limit");
if (selection.schema_version !== 1 || !Array.isArray(selection.included)) throw new Error("Unsupported selection manifest");
const identities = new Set(selection.included.map((r) => `${r.post}:${r.slide}`));
if (identities.size !== selection.included.length) throw new Error("Duplicate selected photos");
const rows = new Map(index.map((r) => [`${r.post}:${r.slide}`, r]));
const positions = new Map(index.map((r, position) => [`${r.post}:${r.slide}`, position]));
const excluded = new Set(selection.excluded.map((r) => `${r.post}:${r.slide}`));
const tasks = selection.included.slice(0, limit).map((selected) => {
  const identity = `${selected.post}:${selected.slide}`;
  const row = rows.get(identity);
  if (excluded.has(identity) || !row || row.status !== "matched" || row.media_type !== "photo" || row.largest_original_pixels < 4_000_000) throw new Error(`Ineligible selection: ${selected.id}`);
  if (selected.id !== `${selected.post}-${String(selected.slide).padStart(2, "0")}`) throw new Error("Inconsistent selected identifier");
  const files = row.files.filter((f) => f.resource_role === "primary");
  const source = files.find((f) => f.kind === "edited") ?? files.find((f) => f.kind === "original");
  if (!source) throw new Error(`Missing source: ${selected.id}`);
  return { selected, row, source, position: positions.get(identity) };
});
// Each post's time, with its own offset, from the index: one published_at per post (spec 7.1)
const posts = [];
for (const { selected } of tasks) {
  if (posts.some((post) => post.collection === selected.post)) continue;
  const times = new Set(index.filter((r) => r.post === selected.post).map((r) => r.published_at));
  const [publishedAt] = times;
  if (times.size !== 1 || typeof publishedAt !== "string" || !PUBLISHED_AT.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error(`Missing or inconsistent published_at for post ${selected.post}`);
  }
  posts.push({ collection: selected.post, publishedAt, place: null });
}
await mkdir(join(output, "metadata"), { recursive: true });
await mkdir(join(output, ".work"), { recursive: true });
let renderer;
if (tasks.some(({ source }) => [".arw", ".dng", ".heic"].includes(extname(source.path).toLowerCase()))) {
  if (process.platform !== "darwin") throw new Error("RAW/HEIC preparation requires macOS's native renderer");
  renderer = join(output, ".work/photo-render");
  execFileSync("xcrun", ["swiftc", fileURLToPath(new URL("./photo-render.swift", import.meta.url)), "-o", renderer], { stdio: "inherit" });
}
sharp.concurrency(1);
const hash = (data) => createHash("sha256").update(data).digest("hex");

/** Encodes previews of a master at these sizes (each fitted inside its square) and writes them beside it */
async function encodePreviews(data, id, sha256, sizes) {
  const previews = [];
  for (const size of sizes) {
    for (const format of PREVIEW_FORMATS) {
      const resized = sharp(data).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
      const encoded = format === "webp" ? resized.webp({ quality: 82, effort: 4 }) : resized.avif({ quality: 55, effort: 3 });
      const result = await encoded.toBuffer({ resolveWithObject: true });
      const key = `photos/previews/${id}/${sha256}/${size}.${format}`;
      const path = join(output, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, result.data, { mode: 0o600 });
      previews.push({ key, file: key, width: result.info.width, height: result.info.height, format, bytes: result.data.length, sha256: hash(result.data) });
    }
  }
  return previews;
}

/** Writes JSON beside its final name, then renames, so an interrupted run never leaves half a file; private (0600) */
async function writePrivateJson(path, value) {
  await writeFile(`${path}.partial`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(`${path}.partial`, path);
}

const results = new Array(tasks.length);
let cursor = 0;
async function prepare(task) {
  const { selected, source, position } = task;
  const sourceBytes = await readFile(source.path);
  const fingerprint = hash(Buffer.concat([sourceBytes, Buffer.from(`gallery-v1:${source.kind}:${source.display_width}:${source.display_height}`)]));
  const checkpoint = join(output, "metadata", `${selected.id}.json`);
  try {
    const cached = JSON.parse(await readFile(checkpoint, "utf8"));
    if (cached.fingerprint === fingerprint && (await stat(join(output, cached.print.file))).size === cached.print.bytes) {
      for (const preview of cached.previews) await stat(join(output, preview.file));
      if (!cached.previews.some((preview) => preview.key.endsWith("/240.webp"))) {
        // A checkpoint from before the gallery has no 240s: derive them from the master already on disk, so the master,
        // its SHA-256 and its publication state stay as they are (spec 2.2)
        const master = await readFile(join(output, cached.print.file));
        if (hash(master) !== cached.print.sha256) throw new Error(`Prepared master changed on disk: ${selected.id}`);
        cached.previews = [...(await encodePreviews(master, selected.id, cached.print.sha256, [240])), ...cached.previews];
        await writePrivateJson(checkpoint, cached);
      }
      return { ...cached, position };
    }
  } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  let input = source.path;
  if ([".arw", ".dng", ".heic"].includes(extname(input).toLowerCase())) {
    input = join(output, ".work", `${selected.id}.jpg`);
    execFileSync(renderer, [source.path, input], { stdio: "pipe" });
  }
  const { data, info } = await sharp(input).rotate().withIccProfile("srgb").jpeg({ quality: 96, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
  if (info.width !== source.display_width || info.height !== source.display_height) throw new Error(`Rendered dimensions differ from the source: ${selected.id} (${info.width}x${info.height})`);
  const sha256 = hash(data);
  const printKey = `prints/${selected.id}/${sha256}.jpg`;
  const printPath = join(output, printKey);
  await mkdir(dirname(printPath), { recursive: true });
  await writeFile(printPath, data, { mode: 0o600 });
  const previews = await encodePreviews(data, selected.id, sha256, PREVIEW_SIZES);
  const original = originalOf(task.row);
  const record = {
    id: selected.id, collection: selected.post, position, title: "", published: false,
    fingerprint, sourceKind: source.kind, sourceFormat: extname(source.path).toLowerCase(),
    needsRawReview: source.kind !== "edited" && [".arw", ".dng"].includes(extname(original.path).toLowerCase()),
    print: { key: printKey, file: printKey, width: info.width, height: info.height, bytes: data.length, sha256 }, previews,
  };
  await writePrivateJson(checkpoint, record);
  return record;
}
async function worker() {
  while (cursor < tasks.length) {
    const i = cursor++;
    results[i] = await prepare(tasks[i]);
    console.log(`${i + 1}/${tasks.length} ${results[i].id}`);
  }
}
await Promise.all([worker(), worker()]);

// Places (spec 7.2, ADR-0022). Each post's place comes from the originals (which keep their GPS) of at most three of its
// photos, asked 1.5 seconds apart to stay inside Apple's rate limit. Every answer is cached as names only, so a
// photo's coordinates are sent to Apple once; they never reach the manifest, D1 or R2.
function originalOf(row) {
  return row.files.find((f) => f.kind === "original" && f.resource_role === "primary");
}
async function placeTool() {
  // Tests stand a recorded geocoder in here; George's Mac never sets it
  if (process.env.PHOTO_PLACE_TOOL) return resolve(process.env.PHOTO_PLACE_TOOL);
  if (process.platform !== "darwin") throw new Error("Places need macOS's geocoder (scripts/photo-place.swift)");
  const tool = join(output, ".work/photo-place");
  execFileSync("xcrun", ["swiftc", fileURLToPath(new URL("./photo-place.swift", import.meta.url)), "-o", tool], { stdio: "inherit" });
  return tool;
}
const tool = await placeTool();
const delay = Number(process.env.PHOTO_PLACE_DELAY_MS ?? 1500);
const cities = JSON.parse(await readFile(fileURLToPath(new URL("./photo-cities.json", import.meta.url)), "utf8"));
const placesPath = join(output, "metadata", "places.json");
let places = {};
try { places = JSON.parse(await readFile(placesPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const missing = new Map();
const review = [];
let asked = false;
for (const post of posts) {
  const slides = tasks.filter((task) => task.selected.post === post.collection).sort((a, b) => a.selected.slide - b.selected.slide);
  const withGps = [];
  for (const task of slides) {
    const original = originalOf(task.row);
    if (original && (await run(tool, ["--has-gps", original.path])).stdout.trim() === "true") withGps.push({ id: task.selected.id, path: original.path });
  }
  const found = [];
  for (const photo of pickGeocoded(withGps)) {
    if (!Object.hasOwn(places, photo.id)) {
      if (asked) await new Promise((done) => setTimeout(done, delay));
      asked = true;
      try {
        places[photo.id] = JSON.parse((await run(tool, [photo.path])).stdout);
      } catch {
        // Apple's rate limit or the network: every finished lookup is already saved, so a rerun carries on from here
        console.error(`Geocoding failed for ${photo.id}; run photos:prepare again (finished lookups are kept)`);
        process.exit(1);
      }
      // Saved after every lookup, so an interrupted run never asks again
      await writePrivateJson(placesPath, places);
    }
    const result = placeFromPlacemark(places[photo.id], cities);
    if (result.missingKey) missing.set(result.missingKey, post.collection);
    if (result.review) review.push(`${post.collection}: ${result.review}`);
    found.push(result.place);
  }
  post.place = postPlace(found);
}
if (missing.size > 0) {
  console.error("Add a city for each of these to scripts/photo-cities.json, then run photos:prepare again (nothing is asked twice):");
  for (const [key, collection] of missing) console.error(`  "${key}"  (post ${collection})`);
  process.exit(1);
}
for (const line of review) console.log(`no place for ${line}: set it in /admin`);
for (const post of posts) console.log(`${post.publishedAt.slice(0, 10)} ${post.collection} ${post.place ?? "(no place)"}`);

const manifest = { schemaVersion: 1, preparedAt: new Date().toISOString(), posts, photos: results, exclusions: selection.counts };
await writePrivateJson(join(output, "manifest.json"), manifest);
console.log(`Prepared ${results.length} photos in ${posts.length} posts as unpublished candidates. ${results.filter((r) => r.needsRawReview).length} need RAW colour/crop review.`);
