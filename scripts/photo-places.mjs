// Turning the geocoder's names into "area, city" (spec 7.2, ADR-0022). Pure functions: prepare does the lookups.
import { checkPlace } from "../src/lib/photos/place.ts";

const LATIN1 = /^[\x20-\x7e\xa0-\xff]*$/;
// Stroke letters NFKD can't split into a letter and a mark
const STROKES = { ħ: "h", Ħ: "H", ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i" };

/** A name outside Latin-1 loses its marks (Gżira becomes Gzira); a name inside it keeps its accents */
export function transliterate(name) {
  if (LATIN1.test(name)) return name;
  return name.replace(/[ħĦłŁđĐı]/g, (letter) => STROKES[letter]).normalize("NFKD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** The city map's key: country, administrative area and the sub-administrative area (or the locality) */
export const cityKey = (placemark) => `${placemark.isoCountryCode}/${placemark.administrativeArea}/${placemark.subAdministrativeArea ?? placemark.locality}`;

const named = (name) => typeof name === "string" && name.trim() !== "";

/**
 * One photo's place from the geocoder's names. The area is the sub-locality, else the locality; the city comes from the
 * map, else the locality when the sub-locality was used, else the administrative area. An Australian place with no map
 * entry gives its missing key, because there the geocoder never names a metropolitan city.
 */
export function placeFromPlacemark(placemark, cities) {
  if (!placemark) return { place: null };
  const area = named(placemark.subLocality) ? placemark.subLocality : placemark.locality;
  if (!named(area)) return { place: null };
  const key = cityKey(placemark);
  let city = Object.hasOwn(cities, key) ? cities[key] : undefined;
  if (city === undefined) {
    if (placemark.isoCountryCode === "AU") return { place: null, missingKey: key };
    city = named(placemark.subLocality) ? placemark.locality : placemark.administrativeArea;
  }
  const names = [area, city].filter(named).map((name) => transliterate(name).trim().toLocaleLowerCase("en-AU"));
  const checked = checkPlace(names.filter((name, i) => names.indexOf(name) === i).join(", "));
  if (!checked.ok) return { place: null, review: `${[area, city].filter(named).join(", ")} (${checked.error})` };
  return { place: checked.place };
}

/** The post's place: the most common of its photos' places, the first slide's on a tie */
export function postPlace(places) {
  const counts = new Map();
  for (const place of places) if (place !== null) counts.set(place, (counts.get(place) ?? 0) + 1);
  let best = null;
  for (const [place, count] of counts) if (best === null || count > counts.get(best)) best = place;
  return best;
}

/** At most three lookups per post: the first, middle and last photos that have GPS */
export function pickGeocoded(photos) {
  if (photos.length <= 3) return photos;
  return [photos[0], photos[Math.floor((photos.length - 1) / 2)], photos.at(-1)];
}
