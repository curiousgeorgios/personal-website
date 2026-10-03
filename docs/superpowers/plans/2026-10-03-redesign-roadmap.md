# curiousgeorge.dev redesign: roadmap

The spec ([2026-10-03-personal-site-redesign-design.md](../specs/2026-10-03-personal-site-redesign-design.md)) covers several independent subsystems, so it ships as four plans, each producing working, tested software on the `redesign/logbook` branch. Each later plan is written after its predecessor lands, against the real interfaces.

| Plan | Scope | Depends on | Status |
|---|---|---|---|
| 1. Foundation | Replace Next.js with Astro 7 on Workers; D1 schema and seed; the full logbook page (intro, now, lately, log, turntable empty state, before, say hi, visitor info) with text-only wall labels; tokens and self-hosted fonts; route caching; redirects, 404, robots; security headers; SEO, favicons, OG image; unit and Playwright suites; budget and privacy tests; GitHub Actions CI | none | [Written](2026-10-03-plan-1-foundation.md) |
| 2. Listening corner | `/media` route with range requests; media seed script (MP3s and covers to R2); deck runner, shared audio and Web Audio gain; track list; Three.js scene port (pinned 0.169) with crate, control, scratch, posters, phone framing; the regression suite in spec section 5.5; keep the deck runner inline (no hashed file on the playback path); add the `version_metadata` binding and decide a post-deploy cache purge so edge-cached HTML never references removed `/_astro/*` chunks | 1 | To write after plan 1 |
| 3. Admin | Cloudflare Access JWT verification; admin forms for now and before lines, log, lately and records; uploads to R2 with the Images binding; validation and `Origin` checks; record cap; route-cache invalidation on save | 1, 2 | To write after plan 2 |
| 4. Snapshots and analytics | Snapshots Worker with Browser Rendering and Images; label hover cards, framed snapshots and the closer look; first-party analytics beacon and `/ingest` proxy (cookieless mode, country from Cloudflare, cookie stripping, GPC); privacy smoke test extended to analytics; Lighthouse LCP and INP checks | 1, 3 | To write after plan 3 |

## Launch gate

The branch merges to `main` (which deploys through GitHub Actions) only when all four plans are done and George has completed the launch checklist in spec section 13: real label sentences and log entries, track licences, the Cloudflare Access application, PostHog's cookieless setting, zone settings, GitHub secrets, disconnecting Workers Builds, creating the remote D1 database (`bunx wrangler d1 create curiousgeorge-logbook --location oc`, then putting its id in `wrangler.jsonc`), confirming the `curiousgeorge.dev` custom domain is still attached to the `personal-website` Worker after the first deploy and a real-device Safari check.
