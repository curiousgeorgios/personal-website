import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { forwardEvent, ingestAnswer } from "../../lib/ingest";

// The analytics proxy (spec 6.2 and 10): only POST /ingest/i/v0/e/; everything else under /ingest is a 404
export const ALL: APIRoute = ({ request, params }) => {
  if (request.method !== "POST" || params.path?.replace(/\/$/, "") !== "i/v0/e") return ingestAnswer(404);
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
  // A test build never forwards, whatever a local .env holds
  return forwardEvent(request, { key: __TEST_HOOKS__ ? undefined : env.POSTHOG_KEY, host: env.POSTHOG_HOST, country });
};
