// One-off: turns the cover art embedded in each MP3's ID3 tags into a 512px WebP under 40KB (spec 5.2 and 11).
// bun run covers  (reads media/audio/*.mp3, writes media/covers/<same name>.webp)
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { parseFile } from "music-metadata";
import sharp from "sharp";

const LIMIT = 40 * 1024;
const encode = (data, quality) => sharp(data).resize(512, 512, { fit: "cover" }).webp({ quality, effort: 6 }).toBuffer();

mkdirSync("media/covers", { recursive: true });
for (const file of readdirSync("media/audio").filter((name) => name.endsWith(".mp3"))) {
  const picture = (await parseFile(`media/audio/${file}`)).common.picture?.[0];
  if (!picture) throw new Error(`${file} has no embedded cover art`);
  // Start high and step down until the cover fits the budget
  let quality = 80;
  let out = await encode(picture.data, quality);
  while (out.length >= LIMIT && quality > 40) out = await encode(picture.data, (quality -= 4));
  if (out.length >= LIMIT) throw new Error(`${file}: the cover is still ${out.length} bytes at quality ${quality}`);
  const name = file.replace(/\.mp3$/, ".webp");
  writeFileSync(`media/covers/${name}`, out);
  console.log(`media/covers/${name}: ${out.length} bytes at quality ${quality}`);
}
