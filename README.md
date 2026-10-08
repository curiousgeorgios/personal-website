# curiousgeorge.dev

George Vlachos's logbook. Astro 7 on Cloudflare Workers, D1 for the living content.

- Spec: `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`
- Decisions: `docs/adr/`
- Plans: `docs/superpowers/plans/`

## Develop

```bash
bun install
bun run db:migrate:local
bun run seed:media --local
bun run seed:snapshots --local
bun run dev
```

## Check everything (what CI runs)

```bash
bunx playwright install chromium webkit   # once per machine
bun run check
```

## The admin page

`/admin` sits behind Cloudflare Access, and the Worker also requires the token's email to be `ADMIN_EMAIL` (`wrangler.jsonc`, ADR-0016); the page shows the day the Access session ends, or on its last day the time (until 14:30). Locally, `bun run dev:admin` skips Access with a test-only build flag that production builds refuse. Saves say "it's on the logbook now" there, because the dev server's cache accepts the purge and does nothing. Against a built Worker under `wrangler dev` (the end-to-end servers on ports 4331 to 4333) there's no cache to purge, so saves say "the logbook may show the old version for a little while".

## Photographs

The photo gallery: `/photos`, a page for each photograph and a private downloads page behind catalogue links, with the owner's photographs and links sections in `/admin`. How the pages, the catalogue, the preparation and the import work: [photo gallery guide](docs/photo-gallery-backend.md). The e2e gallery server (4335) gets the six-post photo fixture afresh on every run (`scripts/seed-photo-test.mjs`), and every local test server passes the fixture signing key explicitly (`PHOTO_KEY_VAR` in `playwright.config.ts`), because `build:test` copies `.dev.vars` into `dist/server`. No test server is reused, so stop your own `bun run serve` before `bun run test:e2e` (Playwright says the port is already used otherwise).

Decisions: [ADR-0020](docs/adr/0020-photo-downloads-use-revocable-signed-links.md) (amended; revocable signed links), [ADR-0022](docs/adr/0022-photo-places-are-area-and-city-only.md) (amended; area and city only), [ADR-0023](docs/adr/0023-the-gallery-stays-light-on-phones.md) (the gallery stays light on phones) and [ADR-0024](docs/adr/0024-test-servers-never-hold-the-real-signing-key.md) (test servers never hold the real signing key).

Launch steps for the gallery, all George's, in this order:

1. Create the `curiousgeorge-photo-prints` R2 bucket before this branch deploys, because `wrangler.jsonc` binds it.
2. Apply migrations 0005 and 0006 with `wrangler d1 migrations apply` (`bun run db:migrate:remote`; the deploy job runs it). Production has never had the photo backend, so both arrive with this merge, along with the owner's JSON photo routes.
3. Set `PHOTO_LINK_SECRET` as a fresh Worker secret.
4. From the Mac, run `bun run photos:prepare` and then `bun run photos:import --remote` (the manifest is now version 2).
5. In `/admin`, review and publish the photographs, including the 96 RAW candidates.
6. Issue the first catalogue link from `/admin`.
7. Once something is published, run the post-publish check against the live site (the image gate and the photo pages' privacy check, then Lighthouse): `PLAYWRIGHT_BASE_URL=https://curiousgeorge.dev bunx playwright test tests/e2e/budgets.spec.ts tests/e2e/privacy.spec.ts -g "images before any scroll|photo pages" --project=chromium` and `bun run lighthouse https://curiousgeorge.dev/`.

Details, and what is still open: the guide's launch steps and [the plan 6 follow-ups](docs/superpowers/plans/2026-10-08-plan-6-followups.md).

## Snapshots and analytics

The snapshots Worker lives in `workers/snapshots/`. `bun run dev:snapshots` runs it on its own, with its own store (`.wrangler/snapshots-dev`, migrated first) and its own dev registry, so the site's servers never reach it; its nightly run, started with `curl http://localhost:8790/__scheduled`, captures the lines' real pages into that store. The end-to-end suite runs it beside the site on port 4334, with local Browser Rendering (wrangler downloads Chrome on first use) capturing a fixture site on port 4400. Run scripts under Node 24 (`mise exec node@24 --` outside your home directory): wrangler's Chrome download has hung under Node 26.

`bun run seed:snapshots --local` gives two labelled lines a snapshot in the local store, so the e2e server shows hover cards and the closer look.

The analytics proxy drops events locally, because the PostHog key is a Worker secret only production has. `bun run lighthouse [url]` measures spec 11's page budgets (median of five mobile runs).

## Notes

- Migrations: always `wrangler d1 migrations apply`, never `wrangler d1 execute --file`.
- Fonts: `bun run fonts` after adding copy with new characters.
- Open Graph image: `bun run build`, then `bun run serve`, then `bun run og`.
- Deploys happen only from GitHub Actions on `main`, after every check passes; the privacy spec and a media check (every record's audio and cover answer) then run against the live site, followed by a Lighthouse run (a warning, not a failed deploy).
- `/` is cached at the edge for five minutes with background refresh, and every deploy purges it (ADR-0010).
- CI runs the end-to-end suite on one worker (ADR-0009), so the end-to-end step takes about 18 minutes.
- Media: the starting crate lives in `media/` (MP3s and 512px covers from `bun run covers`); `bun run seed:media --local` uploads it to the local R2 store, `--remote` to production (a launch step).
- Tests run against `bun run build:test`, which compiles in the listening corner's test hooks; `bun run build` never contains them.
- Posters: `bun run build:test`, then `bun run serve`, then `bun run poster`. It renders four (day and night, desktop and phone); rerun it whenever the scene changes, and look at them before committing.
- Scene long tasks (opt-in, on a GPU): `SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium --headed`. It allows one task over 50ms, the environment map's (ADR-0017), and skips itself under software rendering. It was last measured after plan 5's Task 8, when one cold first press showed a long task of about 64ms (none on the next run), so it can still fail on that press; no run since. It needs Playwright's own Chromium (`bunx playwright install chromium`) for `--headed`.
- The admin specs write, so they run against a third server on port 4333 whose store is deleted and migrated afresh on every run, in Chromium only. If a run stops part way, `pkill -f "port 4333"` before the next.
- Run one end-to-end suite at a time: two at once oversubscribe the CPU, and headless renderers then stall for seconds (plan 5 measured up to 6.6s).
