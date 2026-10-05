import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { forwardEvent, ingestAnswer } from "../../lib/ingest";

let warned = false;

// The analytics proxy (spec 6.2 and 10): only POST /ingest/i/v0/e/; everything else under /ingest is a 404
export const ALL: APIRoute = ({ request, params }) => {
  if (request.method !== "POST" || params.path?.replace(/\/$/, "") !== "i/v0/e") return ingestAnswer(404);
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
  // A test build never forwards, whatever a local .env holds
  const key = __TEST_HOOKS__ ? undefined : env.POSTHOG_KEY;
  // Once per isolate, so a secret nobody set isn't silent in production (and a test build never warns)
  if (!key && !__TEST_HOOKS__ && !warned) {
    warned = true;
    console.warn("ingest: POSTHOG_KEY isn't set, so events are dropped");
  }
  return forwardEvent(request, { key, host: env.POSTHOG_HOST, country });
};
