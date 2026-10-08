import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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
  const previews = [];
  for (const size of [480, 960, 1600]) {
    for (const format of ["webp", "avif"]) {
      const resized = sharp(data).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
      const encoded = format === "webp" ? resized.webp({ quality: 82, effort: 4 }) : resized.avif({ quality: 55, effort: 3 });
      const result = await encoded.toBuffer({ resolveWithObject: true });
      const key = `photos/previews/${selected.id}/${sha256}/${size}.${format}`;
      const path = join(output, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, result.data, { mode: 0o600 });
      previews.push({ key, file: key, width: result.info.width, height: result.info.height, format, bytes: result.data.length, sha256: hash(result.data) });
    }
  }
  const original = task.row.files.find((f) => f.kind === "original" && f.resource_role === "primary");
  const record = {
    id: selected.id, collection: selected.post, position, title: "", published: false,
    fingerprint, sourceKind: source.kind, sourceFormat: extname(source.path).toLowerCase(),
    needsRawReview: source.kind !== "edited" && [".arw", ".dng"].includes(extname(original.path).toLowerCase()),
    print: { key: printKey, file: printKey, width: info.width, height: info.height, bytes: data.length, sha256 }, previews,
  };
  await writeFile(`${checkpoint}.partial`, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  await rename(`${checkpoint}.partial`, checkpoint);
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
const manifest = { schemaVersion: 1, preparedAt: new Date().toISOString(), photos: results, exclusions: selection.counts };
await writeFile(join(output, "manifest.json.partial"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
await rename(join(output, "manifest.json.partial"), join(output, "manifest.json"));
console.log(`Prepared ${results.length} photos as unpublished candidates. ${results.filter((r) => r.needsRawReview).length} need RAW colour/crop review.`);
