import type { PrintConfig } from "./config";
import { b64url, fromB64url, hmacKey } from "./seal";

// The order page's key (spec 17.2 step 4): derived from PRINT_VIEW_SECRET and the order id whenever it's needed, never
// stored. Rotating the secret invalidates every order link already sent, which is accepted.

const LABEL = "order-view:";
const encoder = new TextEncoder();

export async function viewKey(secret: string, orderId: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(LABEL + orderId))));
}

/**
 * Whether a key is of the one canonical spelling: 43 characters that decode to 32 bytes and encode back to themselves.
 * 43 characters carry 258 bits, and decoding ignores the last character's two spare bits, so without the round trip
 * four spellings would match one signature
 */
export function isCanonicalViewKey(key: string | null): key is string {
  if (!key || key.length !== 43) return false;
  const signature = fromB64url(key);
  return !!signature && signature.length === 32 && b64url(signature) === key;
}

/** Compared in constant time by Web Crypto's verify */
export async function viewKeyMatches(secret: string, orderId: string, key: string | null): Promise<boolean> {
  if (!secret || !isCanonicalViewKey(key)) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(key)!, encoder.encode(LABEL + orderId));
}

export async function orderPageUrl(config: PrintConfig, orderId: string): Promise<string> {
  return `${config.siteOrigin}/prints/${orderId}?key=${await viewKey(config.secrets.PRINT_VIEW_SECRET, orderId)}`;
}
