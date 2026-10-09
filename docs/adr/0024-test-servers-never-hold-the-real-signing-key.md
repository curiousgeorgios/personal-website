# ADR-0024: Local test servers never hold George's real photo signing key

- Status: Accepted
- Date: 2026-10-08
- Authors: George Vlachos

## Context

Full-resolution photo downloads are protected by tokens signed with `PHOTO_LINK_SECRET` (ADR-0020). George keeps his local signing key in `.dev.vars`, which `bun run photos:key` creates. While building the gallery it emerged that `@astrojs/cloudflare` copies `.dev.vars` into `dist/server/` at build time, `bun run build:test` included, so any `wrangler dev` started from `dist/` silently loads George's real local key unless something overrides it. A reviewer's throwaway server did exactly that for under a minute (it issued and verified nothing), and the 4335 gallery test server in `playwright.config.ts` had the same gap.

## Decision

Every local server started from `dist/` for tests or checks passes `--var PHOTO_LINK_SECRET:<fixture key>` explicitly. `playwright.config.ts` holds the fixture key in one named constant and passes it to every test server (4331, 4332, 4333, 4334 and 4335) with a comment saying why. Tasks and scripts never run `photos:key` or `photos:link` against George's environment and never read `.dev.vars`; links for tests are issued through a fixture server's own route.

Two more rules of the same kind came out of building print ordering (amended 2026-10-08):

- Every probe or local server started for tests sets its own `WRANGLER_REGISTRY_PATH`, as `dev:snapshots` and the 4334 server already do. The shared registry maps a Worker name to whichever local process registered it last, so a probe's cron call once reached another session's dev server running this repository.
- `bun run cf-typegen` never runs in place, because wrangler reads `.dev.vars` and writes George's local secret names into `worker-configuration.d.ts`. Types are regenerated from a clean copy of the configs with the same flags.

## Consequences

No test, review or visual check can sign or verify a token with George's real key, so a test-issued link can never open his real downloads, and his key never appears in a test log or report. Each new test server needs the `--var`, and forgetting it fails silently, which is why the rule lives in this record, the plan constraints and a comment beside the constant. The fixture key is public in the repository, which is fine because it only ever signs fixture data in throwaway stores.

## Alternatives considered

- **Use the shared wrangler registry and the standard typegen command:** the defaults, but the first can route a test's requests to someone else's server and the second publishes local secret names into a committed file.
- **Let test servers load `.dev.vars`:** zero configuration, but every local check would run with George's real key.
- **Stop the adapter copying `.dev.vars`:** cleaner, but it is the adapter's behaviour, and the dev workflow relies on it for George's own local use.
- **Delete `.dev.vars` before tests:** would destroy George's local key, which `photos:link` needs.
