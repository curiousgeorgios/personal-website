# curiousgeorge.dev

George Vlachos's logbook. Astro 7 on Cloudflare Workers, D1 for the living content.

- Spec: `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`
- Decisions: `docs/adr/`
- Plans: `docs/superpowers/plans/`

## Develop

```bash
bun install
bun run db:migrate:local
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
- Deploys happen only from GitHub Actions on `main`, after every check passes; the privacy spec then runs against the live site.
- `/` is cached at the edge for five minutes with background refresh, so deploys show within minutes.
