import { parseItems } from "./basket";
import { resolveBasket } from "./store";

// The basket carried through the gallery (spec 15.3): with a valid items parameter, every link to a gallery page keeps it

export interface Carry {
  /** The canonical items value */
  items: string;
  count: number;
}

/** The basket a gallery page was reached with, validated and canonical, or null; a failed read carries nothing */
export async function readCarry(db: D1Database, url: URL): Promise<Carry | null> {
  const raw = url.searchParams.get("items");
  if (raw === null) return null;
  try {
    const basket = await resolveBasket(db, parseItems(raw));
    return basket.items ? { items: basket.items, count: basket.count } : null;
  } catch (error) {
    console.error("prints: couldn't read a carried basket", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** A gallery link with the basket on it: after any query, before any fragment */
export function carried(href: string, carry: Carry | null): string {
  if (!carry) return href;
  const hash = href.indexOf("#");
  const [path, fragment] = hash < 0 ? [href, ""] : [href.slice(0, hash), href.slice(hash)];
  return `${path}${path.includes("?") ? "&" : "?"}items=${carry.items}${fragment}`;
}

export const carryLabel = (carry: Carry) => `basket · ${carry.count} ${carry.count === 1 ? "print" : "prints"}`;
