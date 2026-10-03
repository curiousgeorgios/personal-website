# Plan 1: follow-ups for later plans

Plan 1 (foundation) finished on `redesign/logbook` with every task review and the whole-branch review clean. These are the deferred items its reviewers raised, grouped by the plan that should pick them up. Each was judged not to block building on plan 1.

## Plan 2 (listening corner)

Done in [plan 2](2026-10-04-plan-2-listening-corner.md): the deck runner is inlined and every deploy purges the cached page (ADR-0010, in place of a `version_metadata` binding); 12:xx and daylight-saving cases are in `tests/unit/time.test.ts` beside the lighting tests; `log` runs in the phone project; the three MP3s outside the starting crate are gone and the four in it left `public/` for R2.

## Plan 3 (admin)

- Validation: unique `(section, position)` for items; set `updated_at` on every update; log dates as `YYYY-MM-DD` (month precision stored as the first of the month); a label `note` requires a `kind` and vice versa; warn on `)` inside link URLs (the inline parser stops at the first `)`).
- Define the `snapshot_status` values (plan 4 writes them).
- Admin tests that write must use their own persisted D1 store (like the empty store on port 4332), because the seed migration is both production content and the e2e fixture and specs run in parallel. Replace seed copy through `/admin`, not by editing `0002_seed.sql`, or several e2e assertions break.
- Astro's `checkOrigin` 403 responses skip the security-header middleware; harmless today, revisit with the admin POST routes.

## Plan 4 (snapshots and analytics)

- `src/scripts/labels.ts` and `src/scripts/log-toggle.ts`: keep the close timer id and `clearTimeout` it in `setOpen` (a close, reopen, close within 320ms lets the stale timer cut the second animation short, confirmed by measurement); add `.open` synchronously in the `beforematch` path so find-in-page reveals instantly; ignore line clicks that end a text selection.
- Assert that drawers actually expand (height above 0 after the transition), since `toBeVisible()` passes on a collapsed drawer.
- Rename the `NEXT_PUBLIC_POSTHOG_*` variables; until then `wrangler types` picks them up from a local `.env`. Add `!.env.example` to `.gitignore` if an example file is added.
- Add `public/_headers` giving `/fonts/*` a long cache lifetime and `nosniff` on static assets (fonts currently revalidate on every visit).
- Lighthouse LCP and INP checks, including layout shift at phone width.

## Launch checklist additions

- Regenerate `public/og.png` (`bun run build`, `bun run serve`, `bun run og`) after the final copy is in; it bakes in the now and lately rows.
- Create a `production` environment in the GitHub repository with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and disconnect Workers Builds before merging (otherwise the merge triggers an unchecked build).
- Consider declaring the custom domain in `wrangler.jsonc` (`routes: [{ "pattern": "curiousgeorge.dev", "custom_domain": true }]`) instead of relying on the dashboard attachment.
- After the first deploy, confirm the second request for `/` is a cache hit.

## Small polish, any time

- The clock reserves 8 characters, so a one-digit hour leaves a slightly wider gap before "· last entry".
- `Log.astro` repeats the row markup in both lists; the `datetime` month rule has no unit assertion.
- `og:url` is still emitted on `noindex` pages; the retired `/jobs/video-editor` 301 has no `Cache-Control`.
- Non-breaking spaces: `src/lib/time.ts` and `tests/unit/time.test.ts` contain the raw U+00A0 character (pinned by the test); `tests/e2e/logbook.spec.ts` uses the ` ` escape. Keep it that way when editing.
