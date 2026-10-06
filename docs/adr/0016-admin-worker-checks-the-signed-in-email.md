# ADR-0016: The admin Worker also checks the signed-in email against ADMIN_EMAIL

- Status: Accepted
- Date: 2026-10-05
- Authors: George Vlachos

## Context

ADR-0004 put `/admin` behind Cloudflare Access, and the Worker verifies the Access token on every admin request: its signature, audience, issuer and expiry (spec 7). Any email in a valid token is let in, so the Worker trusts the Access policy to name George alone. That policy lives in the Cloudflare dashboard, outside the repo and its tests. One careless change there (an "everyone" or email-domain rule, another identity provider, one-time PINs for any address) would open the admin page to whoever it then lets through, and nothing in the Worker would notice. Plan 3's final review asked whether the Worker should check the email too and recommended it, and George agreed.

## Decision

Once the token checks out, the Worker compares its `email` claim with an `ADMIN_EMAIL` var, `hello@curiousgeorge.dev`, ignoring case and surrounding spaces, and refuses any other address with the same 403 as a bad token. The comparison lives in `adminIdentity` in `src/lib/admin/gate.ts`, with a unit test that a valid token for another address is refused. The var sits in `wrangler.jsonc` beside `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, not in the dashboard, because each deploy replaces dashboard vars with the file's. An empty or missing `ADMIN_EMAIL` refuses everyone, as an unset team domain or audience already does. A refusal is logged without the address. The test build's localhost bypass is unchanged.

## Consequences

The Access policy decides who may sign in and the Worker decides who may edit, so a policy loosened by mistake no longer opens `/admin`. The address is now named in two places, the Access policy and `wrangler.jsonc`, and they must agree: changing the admin address means editing the policy and deploying, and a mismatch locks George out (a 403, never an open page) until a deploy fixes it. Signing in must produce a token whose `email` is that address, so an identity provider that knows George by another address won't do. Access service tokens carry no email and stay refused, as they already are. The address is public on the logbook's say hi line, so keeping it in a var reveals nothing, and the check adds no secret and no request.

## Alternatives considered

- **Trust the Access policy alone (ADR-0004 as first built):** one place to change, but a policy loosened in the dashboard opens `/admin` with nothing in the repo or its tests to catch it.
- **A list of allowed addresses:** room for a second editor the site doesn't have; one address can become a list if that changes.
- **Keep the address in a Worker secret:** hides nothing, since the address is on the page, and a secret lives outside the repo, where a review of the deploy can't see it.
