import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { applyArteloUpdate, readArteloUpdate, verifyArteloSignature } from "../../../lib/prints/artelo-updates";
import { printDeps } from "../../../lib/prints/config";
import { jsonAnswer, readCapped } from "../../../lib/prints/http";
import { writeSetting } from "../../../lib/prints/store";

// Artelo's webhook (spec 18.3): the body read with a ceiling, then the signature, before anything is parsed or D1 is
// touched. A signed body always answers 200, so Artelo never retries twenty times and deletes the webhook over an order
// it can't match; such a body logs only its top-level keys
export const POST: APIRoute = async ({ request, locals }) => {
  const deps = printDeps(env, (promise) => locals.cfContext.waitUntil(promise));
  const raw = await readCapped(request, 64 * 1024);
  if (raw === "big") return jsonAnswer({ code: "too_large" }, 413);
  if (raw === null || !(await verifyArteloSignature(deps.config.secrets.ARTELO_WEBHOOK_SECRET, request.headers.get("x-artelo-signature"), raw))) return jsonAnswer({ code: "invalid_signature" }, 400);
  await writeSetting(deps.db, "artelo_webhook_at", String(deps.now()), deps.now());
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  // The keys only, a bounded few: a key is Artelo's field name, never a value from the body
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).slice(0, 20).map((key) => key.slice(0, 40)).join(", ") || "none" : "none";
  const update = readArteloUpdate(body);
  if (!update) {
    console.warn("prints: an artelo webhook couldn't be read; its keys:", keys);
    return jsonAnswer({ received: true }, 200);
  }
  if ((await applyArteloUpdate(deps, update)) === "unknown") console.warn("prints: an artelo webhook named an unknown order; its keys:", keys);
  return jsonAnswer({ received: true }, 200);
};
