# ADR-0013: The analytics proxy holds the PostHog key and forwards only the logbook's events

- Status: Accepted
- Date: 2026-10-05
- Authors: George Vlachos

## Context

ADR-0003 chose PostHog in cookieless server hash mode through a first-party beacon and an `/ingest` proxy. Spec 10 at first named a public `PUBLIC_POSTHOG_KEY` for the page, the usual PostHog set-up, where the browser sends the project key with each event and the proxy passes requests through. Planning plan 4 showed two costs of that: the key would sit in every edge-cached page (so changing it means a rebuild and a purge), and a pass-through proxy would forward anything sent to it, so any site could post arbitrary events to George's project through his domain, including ones that create person profiles or turn cookieless mode off.

## Decision

The PostHog project key is a Worker secret, `POSTHOG_KEY`, and the proxy adds it to each event; the page carries no key. The proxy forwards only the four events the logbook sends (`$pageview`, `label_opened`, `record_played`, `scratch_found`) and refuses anything else with a 400 before it reaches PostHog. It sets `distinct_id: "$posthog_cookieless"`, `$cookieless_mode: true`, `$process_person_profile: false` and the timestamp itself, and forwards only the properties the beacon sends (a fixed list in `src/lib/ingest.ts`), so `$ip`, `$set` or anything else a page adds is dropped, whatever the page sent. This narrows ADR-0003's proxy: the visitor's country is still the only data about the visitor it adds to an event. The host is a var, `POSTHOG_HOST` (`https://us.i.posthog.com`). Without a key the proxy accepts events and drops them, and a test build (`bun run build:test`, which CI checks) never forwards, whatever a local `.env` holds. The beacon applies the same rule to the page's address: `$current_url` is the origin, the path and any `utm_*` parameters, never the rest of the query string or the fragment, and `$referrer` is the referring page's origin only, because any of those can carry an identifier (an ad platform's click ID, a mail campaign's subscriber ID) and a list of known ones is never complete.

## Consequences

The HTML is key-free and a changed key needs only `wrangler secret put`. Tests never send events to PostHog: test builds ignore the key, and the checks against the live site switch the beacon off with Global Privacy Control, send the proxy an event it refuses or block `/ingest`. A plain `bun run dev` would forward if a local `.env` held `POSTHOG_KEY`. The proxy is no open relay, but it can't vouch for what it forwards: a script that sets its own `Origin` can post the four events with made-up values (any address, slug or record id) as often as it likes, which is noise in George's numbers that PostHog stores like any visit. When PostHog is down, events are lost, with a line in Workers Logs and nothing the visitor sees. Adding a new event means changing the proxy's list as well as the page. The beacon can't be pointed at PostHog directly any more, and PostHog's own SDK features (feature flags, session replay) stay out of reach, which the site doesn't want anyway (ADR-0003).

## Alternatives considered

- **A public key in the page, as spec 10 first said:** PostHog's standard way, but it puts the key in cached HTML and leaves the proxy forwarding whatever it is sent.
- **Pass-through proxy with a filter on the page only:** simpler, but the filter would be in code the visitor controls.
- **Strip known click IDs from the address and send the rest:** keeps query strings for pages whose meaning lives there (the logbook has none), but misses every identifier not on the list.
