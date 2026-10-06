// Subsets the two self-hosted fonts to the characters this site can render.
// Covers all of Latin-1 rather than only today's copy, because text typed in /admin
// (names like "Lépi") must not fall back to Arial. Run after adding new symbols: bun run fonts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import subsetFont from "subset-font";

const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const latin1 = Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).join("");
const extras = "‹›·–—‘’“”…×";
const text = ascii + latin1 + extras;

const fonts = [
  {
    from: "node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
    to: "public/fonts/schibsted-grotesk.woff2",
    options: { variationAxes: { wght: { min: 400, max: 500 } } },
  },
  { from: "node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2", to: "public/fonts/dm-mono.woff2", options: {} },
];

await mkdir("public/fonts", { recursive: true });
let total = 0;
for (const font of fonts) {
  const out = await subsetFont(await readFile(font.from), text, { targetFormat: "woff2", ...font.options });
  await writeFile(font.to, out);
  total += out.length;
  console.log(`${font.to}: ${out.length} bytes`);
}
console.log(`total: ${total} bytes`);
if (total > 60_000) throw new Error("fonts exceed the 60KB budget");
