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
bun run dev
```

## Check everything (what CI runs)

```bash
bunx playwright install chromium webkit   # once per machine
bun run check
```

## Notes

- Migrations: always `wrangler d1 migrations apply`, never `wrangler d1 execute --file`.
- Fonts: `bun run fonts` after adding copy with new characters.
- Open Graph image: `bun run build`, then `bun run serve`, then `bun run og`.
- Deploys happen only from GitHub Actions on `main`, after every check passes; the privacy spec and a media check (every record's audio and cover answer) then run against the live site.
- `/` is cached at the edge for five minutes with background refresh, and every deploy purges it (ADR-0010).
- CI runs the end-to-end suite on one worker (ADR-0009), so the end-to-end step takes about 18 minutes.
- Media: the starting crate lives in `media/` (MP3s and 512px covers from `bun run covers`); `bun run seed:media --local` uploads it to the local R2 store, `--remote` to production (a launch step).
- Tests run against `bun run build:test`, which compiles in the listening corner's test hooks; `bun run build` never contains them.
- Posters: `bun run build:test`, then `bun run serve`, then `bun run poster`. Rerun whenever the scene changes.
- Scene long tasks (opt-in): `SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium`. It currently fails, on the environment-map step and on headless software-rendering readback, pending a plan 4 decision (see the plan 2 follow-ups).
