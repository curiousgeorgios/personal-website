// The place rule (spec 6.2), shared by the admin and photos:prepare. No imports, so Node scripts can load this file directly.

export const PLACE_MAX = 60;
// Printable Latin-1: what the subset fonts can draw (R3)
const LATIN1 = /^[\x20-\x7e\xa0-\xff]*$/;

export type PlaceCheck = { ok: true; place: string | null } | { ok: false; error: string };

/** A place as the site stores it: lowercased with en-AU rules and trimmed; empty is no place (null) */
export function checkPlace(text: string): PlaceCheck {
  const place = text.trim().toLocaleLowerCase("en-AU");
  if (place === "") return { ok: true, place: null };
  if (place.length > PLACE_MAX) return { ok: false, error: `${PLACE_MAX} characters at most` };
  if (!LATIN1.test(place)) return { ok: false, error: "plain latin letters only (accents like é are fine)" };
  return { ok: true, place };
}
