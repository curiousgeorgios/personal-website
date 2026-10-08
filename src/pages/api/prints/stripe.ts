import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { printDeps } from "../../../lib/prints/config";
import { jsonAnswer, readCapped } from "../../../lib/prints/http";
import { handleStripeEvent, readEvent } from "../../../lib/prints/stripe-events";
import { verifyStripeSignature } from "../../../lib/prints/stripe";

// Stripe's webhook (spec 18.1): the signature first, before anything in the body is read; Stripe sends no Origin
export const POST: APIRoute = async ({ request, locals }) => {
  const deps = printDeps(env, (promise) => locals.cfContext.waitUntil(promise));
  const raw = await readCapped(request, 256 * 1024);
  if (raw === "big") return jsonAnswer({ error: "too large" }, 413);
  if (raw === null || !(await verifyStripeSignature(deps.config.secrets.STRIPE_WEBHOOK_SECRET, request.headers.get("stripe-signature"), raw, deps.now()))) return jsonAnswer({ error: "invalid signature" }, 400);
  let event: ReturnType<typeof readEvent> = null;
  try {
    event = readEvent(JSON.parse(raw));
  } catch {
    event = null;
  }
  if (!event) return jsonAnswer({ error: "not an event" }, 400);
  const status = await handleStripeEvent(deps, event);
  return jsonAnswer(status === 200 ? { received: true } : { error: "try again" }, status);
};
