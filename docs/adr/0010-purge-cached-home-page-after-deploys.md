# ADR-0010: Keep cached HTML consistent across deploys

- Status: Accepted
- Date: 2026-10-04
- Corrected against production and current platform documentation: 2026-10-06
- Authors: George Vlachos

## Context

`/` is cached for five minutes and served stale while it refreshes (ADR-0007). Its hashed scene loader and scene chunk must match the deployed assets. The runner and styles stay inline so playback and page styling do not depend on a previous deploy's files.

The original decision assumed the zone's purge API also purged this cache. The Cloudflare adapter actually enables Workers Caching. By default its cache keys include the Worker version, so versions have separate cached responses ([configuration](https://developers.cloudflare.com/workers/cache/configuration/)). A zone purge does not affect Workers Caching; its runtime purge is scoped to the owning Worker and entrypoint ([purging](https://developers.cloudflare.com/workers/cache/purge/)).

## Decision

Keep the default cache separation across Worker versions; do not enable cross-version caching. Admin writes invalidate the `logbook` tag through Astro's Cloudflare provider, which calls the Worker's runtime purge.

The existing deploy job still purges the zone's `logbook` tag with `CLOUDFLARE_ZONE_ID` and the token's Cache Purge permission. That call can clear zone-cache entries, but is not the mechanism that keeps Workers Caching fresh across deploys. Its removal can be a separate workflow cleanup.

## Consequences

A new Worker version starts with its own cached HTML. Deployment propagation can briefly serve the previous version; production checks must observe the actual public page. The poster and track list remain usable if a scene loader fails.

Production verification on 6 October confirmed a warmed `/` was a cache hit. After an admin edit, the next request was a miss and showed the changed text. Restoring the original text also appeared on the next request. The admin's runtime purge therefore works on the deployed Worker; local runs only exercise its failure path.

The zone purge remains a fallible workflow step: if it fails, subsequent smoke checks do not run. It does not determine whether the new Worker's cache contains old HTML.
