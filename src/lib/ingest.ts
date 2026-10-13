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

/** The properties the beacon sends (spec 10); anything else a page sends is dropped, so a stray $set or token never reaches PostHog */
const INGEST_PROPERTIES = [
  "$current_url",
  "$host",
  "$pathname",
  "$referrer",
  "$referring_domain",
  "$raw_user_agent",
  "$timezone",
  "$session_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "slug",
  "record_id",
] as const;

/** What the proxy keeps of a beacon event; the rest of the body is ignored */
type IngestEvent = { event: (typeof INGEST_EVENTS)[number]; properties: Record<string, unknown> };

/** Every answer from /ingest: no body, never cached, never a cookie */
export const ingestAnswer = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

// Reads at most `limit` bytes. "big" if the body is bigger, however it arrives; "unreadable" if the read fails, as when
// a client aborts or a chunked body is cut short (common with sendBeacon as a page closes)
async function readCapped(request: Request, limit: number): Promise<string | "big" | "unreadable"> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch {
      return "unreadable";
    }
    if (result.done) break;
    size += result.value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return "big";
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseEvent(text: string): IngestEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { event, properties } = value as Record<string, unknown>;
  if (typeof event !== "string" || !(INGEST_EVENTS as readonly string[]).includes(event)) return null;
  if (properties !== undefined && (typeof properties !== "object" || properties === null || Array.isArray(properties))) return null;
  return { event: event as IngestEvent["event"], properties: (properties as Record<string, unknown> | undefined) ?? {} };
}

/** Whether a URL is a private page (the downloads, an order page) or carries a token or a view key in its query */
function isPrivateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname.startsWith("/photos/downloads") || url.pathname.startsWith("/prints/") || url.searchParams.has("token") || url.searchParams.has("key");
  } catch {
    return false;
  }
}

/**
 * Forwards one beacon event to PostHog's capture endpoint in cookieless server hash mode (spec 10). The key, the
 * country and the time are added here: the visitor's clock could put a visit in the wrong day of PostHog's daily hash.
 * The visitor's IP and user agent go along as headers for that hash, which PostHog then discards. No cookie goes either
 * way (George's Access cookie never reaches PostHog, and PostHog's never reaches the visitor).
 */
export async function forwardEvent(
  request: Request,
  config: IngestConfig,
  upstream: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<Response> {
  const text = await readCapped(request, INGEST_LIMIT);
  if (text === "big") return ingestAnswer(413);
  if (text === "unreadable") return ingestAnswer(400);
  const parsed = parseEvent(text);
  if (!parsed) return ingestAnswer(400);
  // Neither the downloads page nor an order page carries a beacon; should one ever be added, its events are still never
  // counted (spec 2.2, 13.3). $current_url is checked too: it is forwarded as sent, and a hand-made event could carry it
  const pathname = parsed.properties.$pathname;
  if (typeof pathname === "string" && (pathname.startsWith("/photos/downloads") || pathname.startsWith("/prints/"))) return ingestAnswer(400);
  const currentUrl = parsed.properties.$current_url;
  if (typeof currentUrl === "string" && isPrivateUrl(currentUrl)) return ingestAnswer(400);
  if (!config.key) return ingestAnswer(204);
  const properties: Record<string, unknown> = {};
  for (const name of INGEST_PROPERTIES) if (parsed.properties[name] !== undefined) properties[name] = parsed.properties[name];
  const body = {
    api_key: config.key,
    event: parsed.event,
    distinct_id: "$posthog_cookieless",
    timestamp: now().toISOString(),
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
    // A timeout so a stalled PostHog can't hold the request open
    const response = await upstream(`${config.host}/i/v0/e/`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (!response.ok) console.error("ingest: PostHog answered", response.status);
    await response.body?.cancel(); // nothing here reads the reply, so free the connection
  } catch (error) {
    console.error("ingest: couldn't reach PostHog", error instanceof Error ? error.message : String(error));
  }
  return ingestAnswer(204);
}
