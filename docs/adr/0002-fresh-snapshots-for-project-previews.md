# ADR-0002: Use scheduled snapshots, not live embeds, for project previews

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

The wall labels (ADR-0001) show a preview of each project, and George wanted those previews to be live rather than stale screenshots, while staying fast. A check of his sites showed canberra.events, linear.gratis and digitalnachos.com.au can be framed, but onestack.cloud blocks framing (`frame-ancestors 'self'`). canberra.events, Digital Nachos and onestack also load PostHog, so embedding them would run third-party analytics inside the personal site and break its "cookies: none" line.

## Decision

Project previews are always-fresh snapshots. A scheduled Cloudflare Worker re-captures each project site with Cloudflare Browser Rendering and stores small AVIF and WebP images in R2. The page loads a preview only on first hover or when a label is opened, so visitors who never look download nothing. Previews are images, not interactive frames.

## Consequences

Previews never go stale and the site runs no third-party code from the projects it shows. Snapshot jobs add a cron trigger, a Browser Rendering binding and an R2 bucket to the deployment, and a capture can fail (a site down, a cookie banner in the shot), so the job keeps the last good image when a capture fails. Visitors can't click around inside a preview; the project link is how they visit the real thing.

## Alternatives considered

- **Live embeds everywhere:** truly live, but loads PostHog from the embedded sites, is heavier and can't include onestack.cloud.
- **Snapshot plus live on request:** adds an iframe path and a cookie caveat for little gain.
- **Short auto-recorded moving previews:** feel alive without third-party code, but need a larger capture and encoding pipeline.
