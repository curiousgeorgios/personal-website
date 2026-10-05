import { eventBody, uuidv7, type Visit } from "../lib/beacon";
import type { TrackEvent, TrackProperties } from "../lib/track";

// The first-party analytics beacon (spec 10): no cookies, no storage, nothing at all under Global Privacy Control.
const ENDPOINT = "/ingest/i/v0/e/";
const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

if (!gpc) {
  const visit: Visit = {
    href: location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sessionId: uuidv7(),
  };
  const send = (event: TrackEvent, properties?: TrackProperties) => {
    const body = JSON.stringify(eventBody(event, visit, properties));
    // A string body goes as text/plain, which needs no preflight (and tests can read it); sendBeacon outlives the page,
    // and fetch with keepalive covers a refused beacon
    if (!navigator.sendBeacon?.(ENDPOINT, body)) {
      void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
    }
  };
  send("$pageview");
  document.addEventListener("logbook:track", (event) => send(event.detail.event, event.detail.properties));
}
