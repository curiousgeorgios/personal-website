import { ADDRESS_FIELDS, type Address } from "./address";
import type { TaxLine } from "./quote";

// A successful quote is sealed so checkout charges exactly what was shown without asking Artelo again, and so an edited
// address can't keep an old price (spec 16.2). It lives only in the form body and the rendered page.

/** A quote is good for 30 minutes */
export const QUOTE_SECONDS = 30 * 60;

export interface QuotePayload {
  /** The canonical items value quoted */
  items: string;
  /** Every field exactly as validated */
  address: Address;
  /** AUD cents */
  printTotal: number;
  /** AUD cents */
  deliveryAmount: number;
  /** Artelo's freight, US cents */
  freightCents: number;
  taxes: TaxLine[];
  buffer: number;
  rate: number;
  /** Seconds since 1970 */
  expires: number;
}

const encoder = new TextEncoder();
const LABEL = "print-quote:";

export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function fromB64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** PRINT_VIEW_SECRET as an HMAC-SHA256 key; each use signs under its own label */
export const hmacKey = (secret: string) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function sealQuote(secret: string, payload: QuotePayload): Promise<string> {
  const json = JSON.stringify(payload);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(LABEL + json)));
  return `${b64url(encoder.encode(json))}.${b64url(signature)}`;
}

/** The sealed payload when the signature holds (checked in constant time by Web Crypto) and it hasn't run out; null otherwise */
export async function openQuote(secret: string, token: string, now: number): Promise<QuotePayload | null> {
  if (!secret || token.length > 8000) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const body = fromB64url(parts[0]);
  const signature = fromB64url(parts[1]);
  if (!body || !signature || body.length === 0) return null;
  const json = new TextDecoder().decode(body);
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, encoder.encode(LABEL + json)))) return null;
  let payload: QuotePayload;
  try {
    payload = JSON.parse(json) as QuotePayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.expires !== "number" || payload.expires <= now) return null;
  return payload;
}

/** The URL's items and every posted address field exactly as sealed (spec 17.2 step 2) */
export function sameQuote(payload: QuotePayload, items: string, address: Address): boolean {
  return payload.items === items && ADDRESS_FIELDS.every((name) => payload.address?.[name] === address[name]);
}
