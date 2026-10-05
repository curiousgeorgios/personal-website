import type { TrackEvent, TrackProperties } from "./track";

/** What the beacon knows about this visit, captured once per page */
export interface Visit {
  href: string;
  referrer: string;
  userAgent: string;
  timeZone: string;
  /** A UUIDv7 held in memory for the tab, never stored */
  sessionId: string;
}

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
// Per-click identifiers from ad platforms: dropped from the URL sent, so no visit can be tied to an ad click
const CLICK_IDS = ["fbclid", "gclid", "gbraid", "wbraid", "msclkid", "dclid", "ttclid"];

/** A time-ordered UUID (RFC 9562 version 7), for PostHog's $session_id */
export function uuidv7(now = Date.now(), random: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count))): string {
  const bytes = random(16);
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function referringDomain(referrer: string): string {
  try {
    return referrer ? new URL(referrer).host : "$direct";
  } catch {
    return "$direct";
  }
}

/**
 * One PostHog capture event in cookieless server hash mode (spec 10). The proxy adds the project key and the
 * country; PostHog derives a daily visitor from a hash of the IP, the user agent and a salt it rotates daily.
 */
export function eventBody(event: TrackEvent, visit: Visit, properties: TrackProperties = {}, now = new Date()) {
  const url = new URL(visit.href);
  for (const name of CLICK_IDS) url.searchParams.delete(name);
  const domain = referringDomain(visit.referrer);
  const utm = Object.fromEntries(UTM.flatMap((name) => (url.searchParams.has(name) ? [[name, url.searchParams.get(name) ?? ""]] : [])));
  return {
    event,
    distinct_id: "$posthog_cookieless",
    timestamp: now.toISOString(),
    properties: {
      $current_url: url.href,
      $host: url.host,
      $pathname: url.pathname,
      $referrer: domain === "$direct" ? "$direct" : visit.referrer,
      $referring_domain: domain,
      $raw_user_agent: visit.userAgent,
      $timezone: visit.timeZone,
      $session_id: visit.sessionId,
      $cookieless_mode: true,
      $process_person_profile: false,
      ...utm,
      ...properties,
    },
  };
}
