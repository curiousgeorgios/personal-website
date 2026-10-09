import { describe, expect, test } from "vitest";
import { checkAddress, postingTo, readAddress, type Address } from "../../src/lib/prints/address";
import { COUNTRY_CODES, countryName, countryOptions } from "../../src/lib/prints/countries";
import { ADDRESS } from "./prints-fakes";

const check = (over: Partial<Address>) => checkAddress({ ...ADDRESS, ...over });
const errorsOf = (over: Partial<Address>) => {
  const result = check(over);
  return result.ok ? {} : result.errors;
};

describe("checkAddress", () => {
  test("a full address passes as it is", () => {
    expect(check({})).toEqual({ ok: true, address: ADDRESS });
  });

  test("required fields say what's missing; optional ones may be empty", () => {
    expect(errorsOf({ name: "", line1: "", city: "", country: "", phone: "" })).toEqual({
      name: "add your name.", line1: "add the street address.", city: "add the city or suburb.", country: "choose a country.", phone: "add a phone number.",
    });
    expect(check({ line2: "", state: "", postcode: "" }).ok).toBe(true);
  });

  test("each field has its length", () => {
    expect(errorsOf({ name: "a".repeat(101), line1: "a".repeat(101), line2: "a".repeat(101), city: "a".repeat(61), state: "a".repeat(61), postcode: "a".repeat(21) })).toEqual({
      name: "100 characters at most.", line1: "100 characters at most.", line2: "100 characters at most.", city: "60 characters at most.", state: "60 characters at most.", postcode: "20 characters at most.",
    });
    expect(check({ name: "a".repeat(100), city: "a".repeat(60), postcode: "a".repeat(20) }).ok).toBe(true);
  });

  test("the phone: 6 to 20 characters of digits, spaces, +, -, ( and ), with at least six digits", () => {
    expect(errorsOf({ phone: "12345" }).phone).toBe("that phone number looks too short.");
    expect(errorsOf({ phone: "+1 (2) -" }).phone).toBe("that phone number looks too short.");
    expect(errorsOf({ phone: "0400 000 000 ext 1" }).phone).toBe("use digits, spaces, +, -, ( and ) only.");
    expect(errorsOf({ phone: "+61 (0) 400-000-00000" }).phone).toBe("20 characters at most.");
    expect(check({ phone: "123456" }).ok).toBe(true);
    expect(check({ phone: "+61 (02) 9000-0000" }).ok).toBe(true);
  });

  test("one line of plain text, and only a country stripe ships to", () => {
    expect(errorsOf({ line1: "12 Example\nStreet" }).line1).toBe("one line of plain text.");
    expect(errorsOf({ country: "ZZ" }).country).toBe("choose a country.");
    expect(errorsOf({ country: "au" }).country).toBe("choose a country.");
  });

  test("line and paragraph separators and bidi controls are not plain text", () => {
    for (const bad of ["\u2028", "\u2029", "\u202e", "\u202a", "\u2066", "\u2069", "\u0007", "\u0085"]) {
      expect(errorsOf({ line1: `12 Example${bad}Street` }).line1).toBe("one line of plain text.");
    }
    expect(check({ name: "Zo\u200d\u00eb", line1: "12 Example Street" }).ok).toBe(true);
  });

  test("names in other scripts and with punctuation pass untouched (review focus 1)", () => {
    const address = { ...ADDRESS, name: "Zoë O'Brien & Sons", line1: "東京都渋谷区 1-2-3", line2: "<b>unit</b> 3", country: "JP" };
    expect(checkAddress(address)).toEqual({ ok: true, address });
  });
});

test("readAddress trims every field and treats a missing one as empty", () => {
  const form = new FormData();
  form.set("name", "  Ada Lovelace ");
  form.set("country", "AU");
  expect(readAddress(form)).toEqual({ name: "Ada Lovelace", line1: "", line2: "", city: "", state: "", postcode: "", country: "AU", phone: "" });
});

test("readAddress cuts a field to one past its limit, so it is still refused but never echoed at any length", () => {
  const form = new FormData();
  for (const [name, value] of Object.entries(ADDRESS)) form.set(name, value);
  form.set("name", "a".repeat(300_000));
  form.set("country", "AUSTRALIA");
  const address = readAddress(form);
  expect([address.name.length, address.country]).toEqual([101, "AUS"]);
  expect(checkAddress(address)).toEqual({ ok: false, errors: { name: "100 characters at most.", country: "choose a country." } });
});

test("posting to reads like an address on an envelope", () => {
  expect(postingTo(ADDRESS)).toBe("Ada Lovelace, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia");
  expect(postingTo({ ...ADDRESS, line2: "", state: "", postcode: "" })).toBe("Ada Lovelace, 12 Example Street, Bondi Beach, australia");
});

test("countries: stripe's list, named in en-AU and lowercased, sorted by name", () => {
  expect(COUNTRY_CODES.has("AU") && COUNTRY_CODES.has("US") && COUNTRY_CODES.has("AQ")).toBe(true);
  expect(COUNTRY_CODES.has("ZZ")).toBe(false);
  expect(countryName("AU")).toBe("australia");
  expect(countryName("US")).toBe("united states");
  const options = countryOptions();
  expect(options).toHaveLength(COUNTRY_CODES.size);
  const names = options.map(([, name]) => name);
  expect([...names].sort(new Intl.Collator("en-AU").compare)).toEqual(names);
  expect(names.every((name) => name === name.toLowerCase())).toBe(true);
});
