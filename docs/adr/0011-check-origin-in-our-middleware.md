# ADR-0011: Check the Origin header in our middleware instead of Astro's built-in check

- Status: Proposed
- Date: 2026-10-04
- Authors: George Vlachos

## Context

The admin page (ADR-0004) saves through plain form POSTs, and spec 7 requires every write to carry an `Origin` header equal to the site's own. Astro has a built-in check for this (`security.checkOrigin`), and it rejects the same requests. A probe for plan 3 showed that its 403 responses are returned before the site's middleware runs, so they go out without the security headers every other response carries (spec 12.1). Plan 4 adds another write, the analytics beacon at `/ingest/i/v0/e/`, which needs the same protection.

## Decision

Astro's `security.checkOrigin` is turned off, and `src/middleware.ts` checks every request that isn't GET, HEAD or OPTIONS, anywhere on the site: a missing `Origin` or one that differs from the request's own origin gets a 403 with `Cache-Control: no-store` and the usual security headers. The rule lives in `originAllowed` in `src/lib/admin/gate.ts`, which is unit-tested, and an end-to-end spec checks both `/admin/` and `/`.

## Consequences

Every refusal carries the security headers, and one function covers the admin page and any later write route, including plan 4's beacon. The site now owns this check: a future change that turns `checkOrigin` back on would only duplicate it, but one that removes the middleware check would leave writes unprotected. `Referrer-Policy` must stay at `strict-origin-when-cross-origin` (or similar), because under `no-referrer` browsers send `Origin: null` on POSTs and every write would be refused; the header has a comment saying so. Hand-made requests and tests must send `Origin` to write.

## Alternatives considered

- **Keep Astro's check:** it works, but its 403s skip the security headers, which spec 12.1 requires on every response.
- **Check only under `/admin`:** less code today, but plan 4's beacon would need its own copy of the rule.
