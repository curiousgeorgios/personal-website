import { eventBody, uuidv7, type Visit } from "../lib/beacon";
import type { TrackDetail, TrackEvent, TrackProperties } from "../lib/track";

// The first-party analytics beacon (spec 10): no cookies, no storage, nothing at all under Global Privacy Control.
const ENDPOINT = "/ingest/i/v0/e/";
const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

if (!gpc) {
  let visit: Visit | null = null;
  const held: TrackDetail[] = [];
  const send = (event: TrackEvent, properties?: TrackProperties) => {
    const body = JSON.stringify(eventBody(event, visit!, properties));
    // A string body goes as text/plain, which needs no preflight (and tests can read it); sendBeacon outlives the page,
    // and fetch with keepalive covers a refused beacon
    if (!navigator.sendBeacon?.(ENDPOINT, body)) {
      void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
    }
  };
  document.addEventListener("logbook:track", (event) => (visit ? send(event.detail.event, event.detail.properties) : held.push(event.detail)));
  // The visit starts after the page's first frame: reading the time zone builds an Intl formatter, about 55ms of a
  // 4x-throttled phone's main thread, which run straight away can hold the first paint. An event before then waits for it
  requestAnimationFrame(() => setTimeout(() => {
    visit = {
      href: location.href,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sessionId: uuidv7(),
    };
    send("$pageview");
    for (const detail of held.splice(0)) send(detail.event, detail.properties);
  }));
}
