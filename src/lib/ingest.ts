/** The only events the beacon sends (spec 10); anything else is refused, so the proxy is no open relay to PostHog */
export const INGEST_EVENTS = ["$pageview", "label_opened", "record_played", "scratch_found"] as const;
/** The beacon's events are a few hundred bytes; a body this size isn't from the beacon */
export const INGEST_LIMIT = 32 * 1024;

export interface IngestConfig {
  /** The PostHog project key, a Worker secret. Unset locally and in tests, where events are dropped */
  key: string | undefined;
  /** PostHog's ingestion host, e.g. https://us.i.posthog.com */
  host: string;
  /** The visitor's country from Cloudflare (request.cf.country): cookieless mode skips PostHog's own GeoIP */
  country: string | null;
}

type Event = { event: (typeof INGEST_EVENTS)[number]; timestamp?: string; properties: Record<string, unknown> };

/** Every answer from /ingest: no body, never cached, never a cookie */
export const ingestAnswer = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

// Reads at most `limit` bytes; null if the body is bigger, however it arrives
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseEvent(text: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { event, timestamp, properties } = value as Record<string, unknown>;
  if (typeof event !== "string" || !(INGEST_EVENTS as readonly string[]).includes(event)) return null;
  if (properties !== undefined && (typeof properties !== "object" || properties === null || Array.isArray(properties))) return null;
  return {
    event: event as Event["event"],
    timestamp: typeof timestamp === "string" ? timestamp : undefined,
    properties: { ...(properties as Record<string, unknown> | undefined) },
  };
}

/**
 * Forwards one beacon event to PostHog's capture endpoint in cookieless server hash mode (spec 10). The key and the
 * country are added here; the visitor's IP and user agent go along for PostHog's daily hash, which it then discards;
 * no cookie goes either way (George's Access cookie never reaches PostHog, and PostHog's never reaches the visitor).
 */
export async function forwardEvent(request: Request, config: IngestConfig, upstream: typeof fetch = fetch): Promise<Response> {
  const text = await readCapped(request, INGEST_LIMIT);
  if (text === null) return ingestAnswer(413);
  const parsed = parseEvent(text);
  if (!parsed) return ingestAnswer(400);
  if (!config.key) return ingestAnswer(204);
  const properties = { ...parsed.properties };
  delete properties.$ip; // PostHog takes the IP from the header below, and only for the hash
  const body = {
    api_key: config.key,
    event: parsed.event,
    distinct_id: "$posthog_cookieless",
    timestamp: parsed.timestamp,
    properties: {
      ...properties,
      $cookieless_mode: true,
      $process_person_profile: false,
      ...(config.country ? { $geoip_country_code: config.country } : {}),
    },
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers["X-Forwarded-For"] = ip;
  const agent = request.headers.get("user-agent");
  if (agent) headers["User-Agent"] = agent;
  try {
    const response = await upstream(`${config.host}/i/v0/e/`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) console.error("ingest: PostHog answered", response.status);
  } catch (error) {
    console.error("ingest: couldn't reach PostHog", error instanceof Error ? error.message : String(error));
  }
  return ingestAnswer(204);
}
