# ADR-0028: End-to-end specs open a fresh connection for every request

- Status: Proposed
- Date: 2026-10-09
- Authors: George Vlachos

## Context

The end-to-end specs talk to their servers directly as well as through the browser: they `fetch` the print stand-in (`tests/fixtures/artelo-site.mjs`), the prints test server and wrangler's local explorer, and they read D1 through `printsD1`, which runs `wrangler d1 execute` synchronously and blocks the worker's event loop for a second or more each time. Node's `fetch` keeps connections alive and reuses them. The first CI run with print ordering (run 37847366341) failed one spec twice, its retry included, with `fetch failed: other side closed` on a call to the stand-in. Locally the failure appeared only when the machine was heavily loaded, as GitHub's small runners are, and then on requests to both the stand-in and the prints server: a reused connection was reset mid-request. With connection reuse turned off, the same loaded runs passed. A plain Node client and server reproduced nothing on their own, so the exact mechanism is unproven.

## Decision

`playwright.config.ts`, which every Playwright worker loads, sets undici's global dispatcher to `new Agent({ pipelining: 0 })`, so every `fetch` a spec makes opens a fresh connection and never reuses a kept-alive one. `undici` is a dev dependency for this alone, pinned to the version Node's own `fetch` is compatible with. Browser traffic is unaffected; only the specs' direct requests change.

## Consequences

The connection-reset failure is gone from the loaded runs that reproduced it, and a new spec gets the same behaviour without doing anything. Each direct request costs a TCP handshake on loopback, which is negligible at the specs' volume. Because the mechanism is unproven, a reset seen again later means this wasn't the whole story; the next suspect is the blocking `printsD1`, which could be made asynchronous. Removing the dispatcher or the `undici` dependency should only happen with a loaded run showing the resets don't return.

## Alternatives considered

- **Retry a failed request in the helpers:** hides the reset but can double a request that isn't idempotent, such as delivering a webhook.
- **Send `Connection: close` on each request:** the same effect, but every direct `fetch` across the specs would have to remember it.
- **Make `printsD1` asynchronous:** removes the event-loop blocking that may be the trigger, but touches every spec that reads D1; kept as the next step if resets return.
