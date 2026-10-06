// Uploads the committed starting crate (media/audio and media/covers) to R2 under the same keys.
//   bun run seed:media --local    the local store the e2e server uses (.wrangler/state)
//   bun run seed:media --remote   production; George runs this once before launch (spec 13)
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const where = process.argv.includes("--remote")
  ? ["--remote"]
  : process.argv.includes("--local")
    ? ["--local", "--persist-to", ".wrangler/state"]
    : null;
if (!where) {
  console.error("usage: bun run seed:media --local | --remote");
  process.exit(1);
}
const TYPES = { mp3: "audio/mpeg", webp: "image/webp" };
for (const dir of ["audio", "covers"]) {
  for (const file of readdirSync(`media/${dir}`)) {
    const type = TYPES[file.split(".").pop()];
    if (!type) continue;
    execFileSync("wrangler", ["r2", "object", "put", `curiousgeorge-media/${dir}/${file}`, "--file", `media/${dir}/${file}`, "--content-type", type, ...where], { stdio: "inherit" });
  }
}
