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
