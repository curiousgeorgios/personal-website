import { isPhotoId } from "../photos/photo-id";
import { isFrame, isTier, type Frame, type Tier } from "./catalogue";

// The basket lives only in the URL's query string (spec 15.2, ADR-0021 as amended), so anyone can edit it: these pure
// functions parse it, keep what is still on offer and write it back in one canonical form.

export const MAX_PRINTS = 10;
export const CAP_NOTE = "a basket holds up to 10 prints.";

/** An entry as written in the URL, its words not yet checked */
export interface RawEntry {
  photoId: string;
  tier: string;
  frame: string;
}
export interface BasketEntry {
  photoId: string;
  tier: Tier;
  frame: Frame;
}
/** Identical entries make one line; line numbers start at 1 */
export interface BasketLine extends BasketEntry {
  line: number;
  quantity: number;
}

const WORD = /^[a-z]{1,12}$/;

/** The entries of an items value; anything malformed makes the whole basket empty (spec 15.2) */
export function parseItems(value: string | null): RawEntry[] {
  if (!value || value.length > 2000) return [];
  const entries: RawEntry[] = [];
  for (const part of value.split(",")) {
    const [photoId, tier, frame, ...rest] = part.split(":");
    if (rest.length > 0 || !isPhotoId(photoId) || !WORD.test(tier ?? "") || !WORD.test(frame ?? "")) return [];
    entries.push({ photoId, tier, frame });
  }
  return entries;
}

export const printCount = (lines: readonly { quantity: number }[]) => lines.reduce((count, line) => count + line.quantity, 0);

export function groupLines(entries: readonly BasketEntry[]): BasketLine[] {
  const lines: BasketLine[] = [];
  for (const entry of entries) {
    const same = lines.find((line) => line.photoId === entry.photoId && line.tier === entry.tier && line.frame === entry.frame);
    if (same) same.quantity += 1;
    else lines.push({ ...entry, line: lines.length + 1, quantity: 1 });
  }
  return lines;
}

/**
 * What is still on offer, grouped into lines; anything else, and anything past the tenth print, dropped and counted.
 * A photo id of the wrong shape counts as unavailable too: a second layer behind parseItems and readOp, so a comma or
 * colon can never reach itemsValue however the entries were built.
 */
export function validate(entries: readonly RawEntry[], offered: (entry: BasketEntry) => boolean): { lines: BasketLine[]; unavailable: number; overCap: number } {
  const kept: BasketEntry[] = [];
  let unavailable = 0;
  let overCap = 0;
  for (const raw of entries) {
    const entry = isPhotoId(raw.photoId) && isTier(raw.tier) && isFrame(raw.frame) ? { photoId: raw.photoId, tier: raw.tier, frame: raw.frame } : null;
    if (!entry || !offered(entry)) unavailable += 1;
    else if (kept.length >= MAX_PRINTS) overCap += 1;
    else kept.push(entry);
  }
  return { lines: groupLines(kept), unavailable, overCap };
}

/** The canonical items value: one entry per print, a line's prints together, lines in order */
export const itemsValue = (lines: readonly BasketLine[]) =>
  lines.flatMap((line) => Array.from({ length: line.quantity }, () => `${line.photoId}:${line.tier}:${line.frame}`)).join(",");
/** "?items=…", or "" for an empty basket. Every character of a canonical value is safe in a query string */
export const itemsQuery = (items: string) => (items ? `?items=${items}` : "");
export const basketHref = (items: string) => `/basket${itemsQuery(items)}`;

export type BasketOp = { kind: "add"; entry: RawEntry } | { kind: "remove" | "more"; line: number };

/**
 * The one change a basket link or the print row asks for, or null. An add whose photo id is not well-formed is no
 * change at all, so an unchecked id never leaves the parser; its tier and frame are checked later, by validate.
 */
export function readOp(params: URLSearchParams): BasketOp | null {
  const add = params.get("add");
  if (add !== null) return !isPhotoId(add) ? null : { kind: "add", entry: { photoId: add, tier: params.get("size") ?? "", frame: params.get("frame") ?? "" } };
  for (const kind of ["remove", "more"] as const) {
    const value = params.get(kind);
    if (value !== null) return { kind, line: /^\d{1,2}$/.test(value) ? Number(value) : 0 };
  }
  return null;
}

/** one more or remove one on a line; one more past ten prints is refused, and an unknown line changes nothing */
export function changeLines(lines: readonly BasketLine[], op: { kind: "remove" | "more"; line: number }): { lines: BasketLine[]; refused: boolean } {
  const next = lines.map((line) => ({ ...line }));
  const target = next.find((line) => line.line === op.line);
  if (!target) return { lines: next, refused: false };
  if (op.kind === "more") {
    if (printCount(next) >= MAX_PRINTS) return { lines: next, refused: true };
    target.quantity += 1;
    return { lines: next, refused: false };
  }
  target.quantity -= 1;
  return { lines: next.filter((line) => line.quantity > 0).map((line, index) => ({ ...line, line: index + 1 })), refused: false };
}

/** Why prints were taken out of a basket (spec 15.2) */
export function droppedNotes(unavailable: number, overCap: number): string[] {
  const notes: string[] = [];
  if (unavailable === 1) notes.push("1 print was taken out: that photo isn't available as a print any more.");
  if (unavailable > 1) notes.push(`${unavailable} prints were taken out: those photos aren't available as prints any more.`);
  if (overCap > 0) notes.push(CAP_NOTE);
  return notes;
}
