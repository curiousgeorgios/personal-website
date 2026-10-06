# ADR-0003: Keep PostHog in cookieless mode and remove the Meta Pixel

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

The previous site ran the Meta Pixel and PostHog, and the `/ig` route redirects Instagram visitors to the home page with UTM tags. The redesign's visitor info says "cookies: none, nothing to accept", which has to be true. George was offered cookieless Cloudflare Web Analytics, no analytics at all, cookieless PostHog or keeping both existing tools.

## Decision

We remove the Meta Pixel entirely and keep PostHog in its cookieless server hash mode, which George chose so he still gets daily unique visitors:

- A first-party beacon of about 1KB sends events through a narrow `/ingest` proxy instead of the `posthog-js` SDK, to stay inside the page's 10KB JavaScript budget.
- Events carry PostHog's cookieless placeholder distinct id. PostHog derives a daily unique visitor from a hash of IP, user agent and a salt that rotates daily, and strips the IP before storing the event.
- Cookieless mode skips PostHog's GeoIP enrichment, so the proxy adds only the visitor's country code from Cloudflare (`request.cf.country`) to each event.
- The proxy strips cookies in both directions so George's Cloudflare Access cookie never reaches PostHog.
- Nothing is sent when the browser signals Global Privacy Control.

The `/ig` redirect stays so Instagram traffic remains visible in PostHog.

## Consequences

"Cookies: none" stays accurate and no consent banner is needed. George gets daily uniques, countries, referrers, UTM sources and a few named clicks (label opened, record played, scratch found) but no cross-day identity, no city-level location, no PostHog bot detection and no Meta retargeting. Visitor data still goes to a third party, so the site must not claim "no trackers"; the visitor info line reads "analytics: anonymous counts of visits and clicks, no cookies". The PostHog project needs "Cookieless server hash mode" turned on, and the Cloudflare zone must not set its own cookies (Bot Fight Mode, JavaScript detections, Web Analytics auto-inject and Zaraz off).

## Alternatives considered

- **Cloudflare Web Analytics only:** cookieless and minimal, but fewer insights than George wanted.
- **No analytics at all:** the purest version of the brief, with no visibility into visits.
- **Keep the Meta Pixel and PostHog as they were:** contradicts the visitor info and would need a consent banner for some visitors.
