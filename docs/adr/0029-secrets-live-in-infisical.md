# ADR-0029: Infisical holds every secret, and the Worker's secrets are synced copies

- Status: Accepted
- Date: 2026-10-09
- Authors: George Vlachos

## Context

The site's secrets lived only in Cloudflare: `POSTHOG_KEY` from plan 4, and `PHOTO_LINK_SECRET` and `PRINT_VIEW_SECRET`, generated and piped straight into `wrangler secret put` during the prints launch. Cloudflare can't show a secret's value once it is set, so a secret held only there can't be seen, copied to another tool or recovered, only replaced. Print ordering adds several more (Stripe's live key and webhook secret, Artelo's key and webhook secret), and George's other projects already keep secrets in Infisical. On 9 October 2026, while setting the Stripe key, George made Infisical the source of truth for every secret.

## Decision

Every secret the site uses is set in the `personal-website` Infisical project's `prod` environment first. The Worker's secrets are copies, pushed by Infisical's Cloudflare Workers secret sync to the `personal-website` Worker; nobody sets a Worker secret with `wrangler secret put` by hand. Random secrets an agent generates go straight into Infisical without being displayed. Keys from a provider's dashboard (Stripe, Artelo, PostHog) George pastes into Infisical himself. The launch guide (`docs/prints.md`) says "set it in Infisical" wherever it used to say `wrangler secret put`.

## Consequences

Every secret can be seen, rotated and recovered in one place, and a change in Infisical reaches the Worker without a manual step. Because Cloudflare can't hand secrets back, the sync can only overwrite: every secret the Worker needs must be in Infisical before the sync starts, or the Worker loses it. `prints:webhook` stores Artelo's webhook secret straight on the Worker, because Artelo shows it only once at creation; it changes to store the secret in Infisical so the sync carries it. The sync needs a Cloudflare API token with Workers Scripts edit access held in Infisical, which is one more credential to guard. GitHub Actions secrets (the Cloudflare deploy token, `STRIPE_TEST_SECRET_KEY`) are outside this decision for now.

## Alternatives considered

- **Cloudflare as the only store:** the previous practice, but values can't be read back, so nothing else can use or recover them.
- **A repo script that copies Infisical into the Worker before deploys:** needs no dashboard set-up, but only syncs when someone remembers to run it.
- **`infisical run` around the deploy, as canberra.events does:** injects secrets into the build environment, not the Worker's runtime secrets, so it doesn't help a Worker that reads them at runtime.
