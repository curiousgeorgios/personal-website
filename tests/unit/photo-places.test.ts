import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { cityKey, pickGeocoded, placeFromPlacemark, postPlace, transliterate } from "../../scripts/photo-places.mjs";
import { checkPlace } from "../../src/lib/photos/place";

// Shaped like the geocoder's answers (spec 7.2's sample of 2026-10-08: in Australia the suburb comes as the locality)
const BONDI = { subLocality: null, locality: "Bondi Beach", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
// An invented council, so the test names a key that is in no map; the geocoder gives "Council of the City of Sydney" for the centre
const SURRY = { subLocality: null, locality: "Surry Hills", subAdministrativeArea: "Imaginary Council", administrativeArea: "NSW", isoCountryCode: "AU" };
// The geocoder's real answer for the Sydney Opera House (2026-10-08): a landmark in the sub-locality
const OPERA = { subLocality: "Sydney Opera House and Botanical Garden", locality: "Sydney", subAdministrativeArea: "Council of the City of Sydney", administrativeArea: "NSW", isoCountryCode: "AU" };
const BRADDON = { subLocality: null, locality: "Braddon", subAdministrativeArea: null, administrativeArea: "ACT", isoCountryCode: "AU" };
const PERTH = { subLocality: null, locality: "Perth", subAdministrativeArea: "Perth", administrativeArea: "WA", isoCountryCode: "AU" };
const MANHATTAN = { subLocality: "Manhattan", locality: "New York", subAdministrativeArea: "New York County", administrativeArea: "NY", isoCountryCode: "US" };
const SLIEMA = { subLocality: null, locality: "Sliema", subAdministrativeArea: null, administrativeArea: "Northern Harbour", isoCountryCode: "MT" };
const HAMRUN = { subLocality: null, locality: "Ħamrun", subAdministrativeArea: null, administrativeArea: "Ħamrun", isoCountryCode: "MT" };
const GZIRA = { subLocality: null, locality: "Gżira", subAdministrativeArea: null, administrativeArea: "Northern Harbour", isoCountryCode: "MT" };
const SAO_PAULO = { subLocality: "Bela Vista", locality: "São Paulo", subAdministrativeArea: null, administrativeArea: "SP", isoCountryCode: "BR" };
const TOKYO = { subLocality: "渋谷", locality: "東京", subAdministrativeArea: null, administrativeArea: "東京都", isoCountryCode: "JP" };
const CITIES = { "AU/NSW/Waverley Council": "sydney", "AU/NSW/Council of the City of Sydney": "sydney", "AU/WA/Perth": "perth", "AU/ACT": "canberra" };

describe("checkPlace, the place rule", () => {
  test("lowercases with en-AU rules and trims; empty is no place", () => {
    expect(checkPlace("  Bondi Beach, Sydney ")).toEqual({ ok: true, place: "bondi beach, sydney" });
    expect(checkPlace("ÉPINAL, VOSGES")).toEqual({ ok: true, place: "épinal, vosges" });
    expect(checkPlace("o'connor, canberra")).toEqual({ ok: true, place: "o'connor, canberra" });
    expect(checkPlace("")).toEqual({ ok: true, place: null });
    expect(checkPlace("   ")).toEqual({ ok: true, place: null });
  });

  test("refuses more than 60 characters and anything outside printable Latin-1", () => {
    expect(checkPlace("a".repeat(60))).toEqual({ ok: true, place: "a".repeat(60) });
    expect(checkPlace("a".repeat(61))).toEqual({ ok: false, error: "60 characters at most" });
    for (const place of ["東京", "gżira, malta", "bondi\tbeach", "bondi\nbeach"]) {
      expect(checkPlace(place)).toEqual({ ok: false, error: "plain latin letters only (accents like é are fine)" });
    }
  });
});

describe("placeFromPlacemark", () => {
  test("an Australian suburb is the area, and its city comes from the map", () => {
    expect(cityKey(BONDI)).toBe("AU/NSW/Waverley Council");
    expect(placeFromPlacemark(BONDI, CITIES)).toEqual({ place: "bondi beach, sydney" });
  });

  test("without a map entry, a sub-locality takes its locality as the city, and anything else its administrative area", () => {
    expect(placeFromPlacemark(MANHATTAN, CITIES)).toEqual({ place: "manhattan, new york" });
    expect(placeFromPlacemark(SLIEMA, CITIES)).toEqual({ place: "sliema, northern harbour" });
  });

  test("an area that is its own city is said once", () => {
    expect(placeFromPlacemark(PERTH, CITIES)).toEqual({ place: "perth" });
  });

  test("an Australian place missing from the map names the key prepare stops for", () => {
    expect(placeFromPlacemark(SURRY, CITIES)).toEqual({ place: null, missingKey: "AU/NSW/Imaginary Council" });
  });

  test("a territory with one city finds it for every suburb, with or without a council", () => {
    expect(placeFromPlacemark(BRADDON, CITIES)).toEqual({ place: "braddon, canberra" });
  });

  test("the area is never a landmark: Australia uses the locality, elsewhere a landmark-like sub-locality is dropped", () => {
    expect(placeFromPlacemark(OPERA, CITIES)).toEqual({ place: "sydney" });
    const LOUVRE = { subLocality: "Louvre and Tuileries", locality: "Paris", subAdministrativeArea: null, administrativeArea: "Île-de-France", isoCountryCode: "FR" };
    expect(placeFromPlacemark(LOUVRE, CITIES)).toEqual({ place: "paris, île-de-france" });
    expect(placeFromPlacemark({ ...LOUVRE, subLocality: "Fish & Chips Quarter" }, CITIES)).toEqual({ place: "paris, île-de-france" });
  });

  test("a placemark with no administrative area keys with an empty segment, not the word null", () => {
    expect(cityKey({ ...SURRY, administrativeArea: null })).toBe("AU//Imaginary Council");
  });

  test("no GPS, or no names, is no place", () => {
    expect(placeFromPlacemark(null, CITIES)).toEqual({ place: null });
    expect(placeFromPlacemark({ subLocality: null, locality: null, subAdministrativeArea: null, administrativeArea: null, isoCountryCode: "AU" }, CITIES)).toEqual({ place: null });
  });

  test("names outside Latin-1 are transliterated; accents inside it are kept", () => {
    expect(transliterate("Ħamrun")).toBe("Hamrun");
    expect(transliterate("Gżira")).toBe("Gzira");
    expect(transliterate("Łódź")).toBe("Lodz");
    expect(transliterate("São Paulo")).toBe("São Paulo");
    expect(placeFromPlacemark(HAMRUN, CITIES)).toEqual({ place: "hamrun" });
    expect(placeFromPlacemark(GZIRA, CITIES)).toEqual({ place: "gzira, northern harbour" });
    expect(placeFromPlacemark(SAO_PAULO, CITIES)).toEqual({ place: "bela vista, são paulo" });
  });

  test("a name still outside Latin-1 is no place, and is listed for review", () => {
    expect(placeFromPlacemark(TOKYO, CITIES)).toEqual({ place: null, review: "渋谷, 東京 (plain latin letters only (accents like é are fine))" });
  });
});

describe("a post's place", () => {
  test("is the most common of its lookups, the first slide's on a tie", () => {
    expect(postPlace(["bronte, sydney", "bondi beach, sydney", "bondi beach, sydney"])).toBe("bondi beach, sydney");
    expect(postPlace(["bronte, sydney", "bondi beach, sydney"])).toBe("bronte, sydney");
    expect(postPlace([null, "bondi beach, sydney"])).toBe("bondi beach, sydney");
    expect(postPlace([null])).toBeNull();
    expect(postPlace([])).toBeNull();
  });

  test("comes from the first, middle and last photos that have GPS", () => {
    expect(pickGeocoded([1, 2, 3, 4, 5])).toEqual([1, 3, 5]);
    expect(pickGeocoded([1, 2, 3, 4])).toEqual([1, 2, 4]);
    expect(pickGeocoded([1, 2])).toEqual([1, 2]);
    expect(pickGeocoded([])).toEqual([]);
  });
});

test("the committed city map starts with the spec's two entries, and every city in it follows the place rule", () => {
  const cities = JSON.parse(readFileSync(new URL("../../scripts/photo-cities.json", import.meta.url), "utf8")) as Record<string, string>;
  expect(cities).toMatchObject({ "AU/NSW/Waverley Council": "sydney", "AU/NSW/Council of the City of Sydney": "sydney", "AU/ACT/City": "canberra", "AU/ACT": "canberra" });
  for (const city of Object.values(cities)) expect(checkPlace(city)).toEqual({ ok: true, place: city });
});
