// Local only: gives two labelled lines a snapshot, so the e2e server (4331) shows hover cards, framed snapshots and the
// closer look without running the snapshots Worker. Production snapshots come from the Worker (spec 9).
//   bun run seed:snapshots --local
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

if (!process.argv.includes("--local")) {
  console.error("usage: bun run seed:snapshots --local (fixtures never go to production)");
  process.exit(1);
}
const WHERE = ["--local", "--persist-to", ".wrangler/state"];
const LINES = [
  ["digital-nachos", "#c94a31"],
  ["canberra-events", "#2f5d8a"],
];
const dir = mkdtempSync(join(tmpdir(), "snapshots-"));
for (const [slug, colour] of LINES) {
  const base = `snapshots/fixture-${slug}`;
  const blocks = Array.from({ length: 24 }, (_, i) => `<rect x="${160 + (i % 6) * 420}" y="${520 + Math.floor(i / 6) * 300}" width="360" height="240" rx="18" fill="${colour}" opacity="${0.35 + (i % 4) * 0.15}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2880" height="1800"><rect width="100%" height="100%" fill="#f6f4ee"/><text x="160" y="360" font-family="Helvetica" font-size="150" fill="#1f201c">${slug}</text>${blocks}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  for (const width of [480, 960, 1920]) {
    for (const format of ["avif", "webp"]) {
      const file = join(dir, `${slug}-${width}.${format}`);
      await sharp(png).resize({ width }).toFormat(format).toFile(file);
      execFileSync("wrangler", ["r2", "object", "put", `curiousgeorge-media/${base}-${width}.${format}`, "--file", file, "--content-type", `image/${format}`, ...WHERE], { stdio: "inherit" });
    }
  }
  // Local test data, not a migration (migrations only go through `wrangler d1 migrations apply`)
  execFileSync("wrangler", ["d1", "execute", "curiousgeorge-logbook", ...WHERE, "--command", `UPDATE items SET snapshot_key = '${base}', snapshot_at = '2026-10-04T17:00:00.000Z', snapshot_status = 'ok' WHERE slug = '${slug}'`], { stdio: "inherit" });
}
rmSync(dir, { recursive: true, force: true });
