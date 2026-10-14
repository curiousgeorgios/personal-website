// Subsets the two self-hosted fonts to the characters this site can render.
// Covers all of Latin-1 rather than only today's copy, because text typed in /admin
// (names like "Lépi") must not fall back to Arial. Run after adding new symbols: bun run fonts
//
// Each font is two files with the same family name, split by unicode-range: a core file, which Notebook.astro preloads,
// with ASCII, the punctuation the site's own copy uses and Latin-1's lowercase letters (the site writes in lowercase, so
// a place like "københavn" stays in the core), and the rest of Latin-1 (capitals and symbols), which a browser fetches
// only for a page that shows one of them. The usual preloaded core is 7.6 KB lighter than the old full files, and a page
// that needs a capital or symbol still draws it in the web font: full Latin-1 coverage is 54.6 KB, still under 60 KB. notebook.css's @font-face rules carry the same unicode-range lists; this script checks
// them. The files keep their names: an old copy in a browser's or the edge's cache is a superset of the new core
import { mkdir, readFile, writeFile } from "node:fs/promises";
import subsetFont from "subset-font";

const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const latin1 = Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).join("");
// The no-break space, middle dot and times sign are Latin-1 but in the site's own copy ("small · 8 × 12 in")
const extras = "\u00a0·×‹›–—‘’“”…";
// ß to ÿ, the lowercase letters (÷ among them)
const lowercase = Array.from({ length: 33 }, (_, i) => String.fromCharCode(0xdf + i)).join("");
const core = ascii + extras + lowercase;
const rest = [...latin1].filter((char) => !core.includes(char)).join("");

/** A CSS unicode-range for these characters, consecutive code points joined: U+0020-007E, U+00A0 */
function rangeOf(chars) {
  const points = [...new Set([...chars].map((char) => char.codePointAt(0)))].sort((a, b) => a - b);
  const hex = (point) => point.toString(16).toUpperCase().padStart(4, "0");
  const runs = [];
  for (const point of points) {
    const last = runs.at(-1);
    if (last && point === last[1] + 1) last[1] = point;
    else runs.push([point, point]);
  }
  return runs.map(([from, to]) => (from === to ? `U+${hex(from)}` : `U+${hex(from)}-${hex(to)}`)).join(", ");
}
const css = await readFile("src/styles/notebook.css", "utf8");
for (const range of [rangeOf(core), rangeOf(rest)]) {
  if (css.split(`unicode-range: ${range};`).length !== 3) throw new Error(`notebook.css needs unicode-range: ${range}; on both families`);
}

const fonts = [
  {
    from: "node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
    to: "public/fonts/schibsted-grotesk",
    options: { variationAxes: { wght: { min: 400, max: 500 } } },
  },
  { from: "node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2", to: "public/fonts/dm-mono", options: {} },
];

await mkdir("public/fonts", { recursive: true });
let total = 0;
for (const font of fonts) {
  const source = await readFile(font.from);
  for (const [suffix, text] of [["", core], ["-latin1", rest]]) {
    const out = await subsetFont(source, text, { targetFormat: "woff2", ...font.options });
    await writeFile(`${font.to}${suffix}.woff2`, out);
    total += out.length;
    console.log(`${font.to}${suffix}.woff2: ${out.length} bytes`);
  }
}
console.log(`total: ${total} bytes`);
if (total > 60_000) throw new Error("fonts exceed the 60KB budget");
