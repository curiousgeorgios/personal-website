# ADR-0010: Purge the edge-cached home page after every deploy

- Status: Proposed
- Date: 2026-10-04
- Authors: George Vlachos

## Context

`/` is cached at Cloudflare's edge for five minutes and served stale for up to a day while it refreshes (ADR-0007). The listening corner adds the first hashed file the page depends on: a small scene loader under `/_astro/` that imports the Three.js scene chunk. Workers static assets serve only the current deploy's files, so a page cached before a deploy can point at a loader the new deploy removed. The deck runner is inlined into the HTML for exactly this reason, so playback never depends on a hashed file, but the 3D scene would quietly stay a poster for anyone served that stale page. The options were to version the cache by deploy with the `version_metadata` binding, to keep old assets around or to purge the cached page when a deploy lands.

## Decision

The GitHub Actions deploy job purges the `logbook` cache tag through the Cloudflare API straight after `wrangler deploy`, using a `CLOUDFLARE_ZONE_ID` secret and the existing API token with the zone's Cache Purge permission. The deck runner stays inline, and if the scene loader is ever missing the poster and the track list carry on.

## Consequences

The first request after a deploy gets fresh HTML, so the page and its scripts always match. The deploy needs one more secret and one more token permission, both on the launch checklist. If the purge call fails, the job fails after the deploy, visibly in Actions, and the five-minute freshness window still bounds the effect. Local and pull-request runs are unaffected.

## Alternatives considered

- **Versioning the cache with `version_metadata`:** Astro's route cache keys on the URL, so the version could only label responses, not separate them.
- **Keeping earlier deploys' assets:** Workers static assets don't keep earlier versions, and hosting them elsewhere adds a moving part for one small script.
