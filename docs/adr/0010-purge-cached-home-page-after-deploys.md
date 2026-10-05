# ADR-0010: Purge the edge-cached home page after every deploy

- Status: Accepted
- Date: 2026-10-04
- Authors: George Vlachos

## Context

`/` is cached at Cloudflare's edge for five minutes and served stale for up to a day while it refreshes (ADR-0007). The listening corner adds the first hashed file the page depends on: a small scene loader under `/_astro/` that imports the Three.js scene chunk. Workers static assets serve only the current deploy's files, so a page cached before a deploy can point at a loader the new deploy removed. The deck runner is inlined into the HTML for exactly this reason, so playback never depends on a hashed file, but the 3D scene would quietly stay a poster for anyone served that stale page. The options were to version the cache by deploy with the `version_metadata` binding, to keep old assets around or to purge the cached page when a deploy lands.

## Decision

The GitHub Actions deploy job purges the `logbook` cache tag through the Cloudflare API straight after `wrangler deploy`, using a `CLOUDFLARE_ZONE_ID` secret and the existing API token with the zone's Cache Purge permission. The deck runner stays inline, and if the scene loader is ever missing the poster and the track list carry on. The job checks that `CLOUDFLARE_ZONE_ID` is set before it migrates or deploys anything, so a missing secret fails before production changes.

## Consequences

Once the purge lands, the next request gets fresh HTML, so the page and its scripts match. In the seconds between `wrangler deploy` and the purge a cached page can still name the old loader, and the poster and the track list cover that. The deploy needs one more secret and one more token permission, both on the launch checklist. If the purge call fails, the job fails after the deploy, visibly in Actions, and the cached copy keeps being served until it's refreshed: the first request after its five fresh minutes can still get the old copy while the edge refreshes it in the background, so a manual purge is the quick fix. A failed purge also ends the job before the post-deploy privacy, media and Lighthouse checks run. Whether a purge by tag reaches the Worker cache can only be confirmed on the production zone, and the launch checklist has that check. Local and pull-request runs are unaffected.

## Alternatives considered

- **Versioning the cache with `version_metadata`:** Astro's route cache keys on the URL, so the version could only label responses, not separate them.
- **Keeping earlier deploys' assets:** Workers static assets don't keep earlier versions, and hosting them elsewhere adds a moving part for one small script.
- **Relying on the five-minute freshness:** needs no secret or permission, but stale-while-revalidate can serve the pre-deploy page, and its missing loader, to the first visitor after a quiet spell for up to a day.
