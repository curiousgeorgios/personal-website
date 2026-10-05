# ADR-0013: The analytics proxy holds the PostHog key and forwards only the logbook's events

- Status: Proposed
- Date: 2026-10-05
- Authors: George Vlachos

## Context

ADR-0003 chose PostHog in cookieless server hash mode through a first-party beacon and an `/ingest` proxy. Spec 10 then named a public `PUBLIC_POSTHOG_KEY` for the page, the usual PostHog set-up, where the browser sends the project key with each event and the proxy passes requests through. Planning plan 4 showed two costs of that: the key would sit in every edge-cached page (so changing it means a rebuild and a purge), and a pass-through proxy would forward anything sent to it, so any site could post arbitrary events to George's project through his domain, including ones that create person profiles or turn cookieless mode off.

## Decision

The PostHog project key is a Worker secret, `POSTHOG_KEY`, and the proxy adds it to each event; the page carries no key. The proxy forwards only the four events the logbook sends (`$pageview`, `label_opened`, `record_played`, `scratch_found`) and refuses anything else with a 400 before it reaches PostHog. It sets `distinct_id: "$posthog_cookieless"`, `$cookieless_mode: true` and `$process_person_profile: false` itself and drops any `$ip` property, whatever the page sent. The host is a var, `POSTHOG_HOST` (`https://us.i.posthog.com`). Without a key, as in local and test runs, the proxy accepts events and drops them.

## Consequences

The HTML is smaller and key-free, a changed key needs only `wrangler secret put`, and tests can never send events to PostHog because they never have the key. The proxy is no open relay: the worst a stranger can do is add pageview-shaped noise, the same as visiting the site. Adding a new event means changing the proxy's list as well as the page. The beacon can't be pointed at PostHog directly any more, and PostHog's own SDK features (feature flags, session replay) stay out of reach, which the site doesn't want anyway (ADR-0003).

## Alternatives considered

- **A public key in the page, as spec 10 first said:** PostHog's standard way, but it puts the key in cached HTML and leaves the proxy forwarding whatever it is sent.
- **Pass-through proxy with a filter on the page only:** simpler, but the filter would be in code the visitor controls.
