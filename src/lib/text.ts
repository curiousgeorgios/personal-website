export type Inline = { kind: "text"; value: string } | { kind: "link"; text: string; href: string };

// Only https: and mailto: links are recognised; anything else stays literal text.
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;

export function parseInline(source: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", value: source.slice(last, start) });
    parts.push({ kind: "link", text: match[1], href: match[2] });
    last = start + match[0].length;
  }
  if (last < source.length) parts.push({ kind: "text", value: source.slice(last) });
  return parts;
}

export function primaryName(source: string): string {
  const parts = parseInline(source);
  const link = parts.find((p) => p.kind === "link");
  if (link && link.kind === "link") return link.text;
  return parts.map((p) => (p.kind === "text" ? p.value : p.text)).join("");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function formatLogDate(iso: string, precision: "day" | "month"): string {
  const [year, month, day] = iso.split("-");
  const yy = year.slice(2);
  return precision === "day" ? `${day}.${month}.${yy}` : `${MONTHS[Number(month) - 1]} ${yy}`;
}

export function sideFor(index: number): string {
  return `${"abc"[Math.floor(index / 2)]}${(index % 2) + 1}`;
}
