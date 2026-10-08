import { countryName, COUNTRY_CODES } from "./countries";

// The delivery address (spec 15.4). It travels only in form bodies, to Stripe and to Artelo, and is never stored or
// logged (spec 21.2): these rules run on the server, which trusts nothing the form sends.

export const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "state", "postcode", "country", "phone"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type Address = Record<AddressField, string>;
export type AddressErrors = Partial<Record<AddressField, string>>;

export const EMPTY_ADDRESS: Address = { name: "", line1: "", line2: "", city: "", state: "", postcode: "", country: "", phone: "" };

/** Every field from a posted form, trimmed; anything missing (or a file) is "" */
export function readAddress(form: FormData): Address {
  const address = { ...EMPTY_ADDRESS };
  for (const name of ADDRESS_FIELDS) {
    const value = form.get(name);
    address[name] = typeof value === "string" ? value.trim() : "";
  }
  return address;
}

const RULES: Record<AddressField, { required?: string; max: number }> = {
  name: { required: "add your name.", max: 100 },
  line1: { required: "add the street address.", max: 100 },
  line2: { max: 100 },
  city: { required: "add the city or suburb.", max: 60 },
  state: { max: 60 },
  postcode: { max: 20 },
  country: { required: "choose a country.", max: 2 },
  phone: { required: "add a phone number.", max: 20 },
};
/** Control characters and line or paragraph separators: every field is one line of printable text */
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function checkAddress(fields: Address): { ok: true; address: Address } | { ok: false; errors: AddressErrors } {
  const errors: AddressErrors = {};
  for (const name of ADDRESS_FIELDS) {
    const value = fields[name];
    const rule = RULES[name];
    if (NOT_ONE_LINE.test(value)) errors[name] = "one line of plain text.";
    else if (value === "" && rule.required) errors[name] = rule.required;
    else if (name !== "country" && value.length > rule.max) errors[name] = `${rule.max} characters at most.`;
  }
  if (!errors.country && !COUNTRY_CODES.has(fields.country)) errors.country = "choose a country.";
  if (!errors.phone) {
    // The carrier may need it; digits and the usual separators only
    if (!/^[0-9 +()-]+$/.test(fields.phone)) errors.phone = "use digits, spaces, +, -, ( and ) only.";
    else if (fields.phone.length < 6 || (fields.phone.match(/\d/g) ?? []).length < 6) errors.phone = "that phone number looks too short.";
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, address: { ...fields } };
}

/** The address on one line, for Stripe's page: name, street, unit, "city state postcode", country (spec 17.1) */
export function postingTo(address: Address): string {
  const place = [address.city, address.state, address.postcode].filter(Boolean).join(" ");
  return [address.name, address.line1, address.line2, place, countryName(address.country)].filter(Boolean).join(", ");
}
