import { LIVE_STRIPE_KEY, type PrintDeps } from "./config";

// Stripe's REST API with fetch (spec 17.2): no SDK, form-encoded, the API version pinned on every request. Nothing here
// throws: a result is ok with Stripe's object, or not ok with a status (null for a network error or a timeout).

export const STRIPE_VERSION = "2025-09-30.clover";

export type StripeResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number | null };

export async function stripe(deps: PrintDeps, method: "GET" | "POST", path: string, form?: URLSearchParams, idempotencyKey?: string): Promise<StripeResult> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.config.stripeBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${deps.config.secrets.STRIPE_SECRET_KEY}`,
        "Stripe-Version": STRIPE_VERSION,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form?.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, status: null };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) return { ok: false, status: response.status };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: null };
  return { ok: true, body: body as Record<string, unknown> };
}

/** The slice of a Checkout Session the print code reads */
export interface StripeSession {
  id: string;
  url?: string | null;
  status: "open" | "complete" | "expired" | string;
  payment_status: "paid" | "unpaid" | "no_payment_required" | string;
  client_reference_id: string | null;
  livemode: boolean;
  currency: string | null;
  currency_conversion?: unknown;
  amount_total: number | null;
  payment_intent: string | null;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
}

export const getSession = (deps: PrintDeps, id: string) => stripe(deps, "GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`);
export const expireSession = (deps: PrintDeps, id: string) => stripe(deps, "POST", `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`);
export const getPaymentIntent = (deps: PrintDeps, id: string) => stripe(deps, "GET", `/v1/payment_intents/${encodeURIComponent(id)}`);

/** An order is live or test by the key that made it (spec 17.2 step 3), standard or restricted */
export const livemodeOf = (key: string): 0 | 1 => (LIVE_STRIPE_KEY.test(key) ? 1 : 0);

/** Stripe's signed timestamp may be at most five minutes from now (spec 18.1) */
export const SIGNATURE_TOLERANCE = 300;

export function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(text)) return null;
  return Uint8Array.from(text.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

/** Stripe-Signature: t=<seconds>,v1=<hex>[,v1=…], an HMAC-SHA256 of "<t>.<raw body>", compared in constant time by Web Crypto */
export async function verifyStripeSignature(secret: string, header: string | null, body: string, now: number): Promise<boolean> {
  if (!secret || !header) return false;
  const pairs = header.split(",").map((part) => {
    const at = part.indexOf("=");
    return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
  });
  const t = pairs.find(([name]) => name === "t")?.[1];
  const signatures = pairs.filter(([name]) => name === "v1").map(([, value]) => fromHex(value)).filter((value): value is Uint8Array<ArrayBuffer> => value !== null);
  if (!t || !/^\d{1,12}$/.test(t) || Math.abs(now - Number(t)) > SIGNATURE_TOLERANCE || signatures.length === 0) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${t}.${body}`);
  for (const signature of signatures) if (await crypto.subtle.verify("HMAC", key, signature, data)) return true;
  return false;
}
