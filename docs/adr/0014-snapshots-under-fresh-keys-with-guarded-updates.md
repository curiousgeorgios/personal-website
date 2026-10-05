# ADR-0014: Store each snapshot under a fresh key, move a line to it only if its address is unchanged

- Status: Proposed
- Date: 2026-10-05
- Authors: George Vlachos

## Context

ADR-0002 chose always-fresh snapshots: a separate Worker captures each line's page nightly with Browser Rendering, makes variants with the Images binding and stores them in R2. Three things shaped how the files are kept. The logbook page is cached at Cloudflare's edge for up to a day (spec 6.1), so a page can still name yesterday's files after a new capture. George can edit or remove a line in `/admin` while the nightly run, or his own "re-shoot now", is capturing it. And the capture library runs inside a Worker, where bundle size matters; `@cloudflare/puppeteer` and `@cloudflare/playwright` both work with Browser Rendering, including locally under `wrangler dev`.

## Decision

- Every good capture is stored under a fresh base key, `snapshots/<slug>-<ulid>`, as six files (`-480`, `-960` and `-1920`, each AVIF and WebP). Keys are never overwritten.
- The line is pointed at the new base with an update that also requires its `snapshot_url` to still be the address that was captured; a failed capture only records `snapshot_status` under the same condition. If the line was edited or removed meanwhile, nothing changes and the new files are deleted.
- Files no line points at are deleted by the nightly run once they are a week old.
- Captures use `@cloudflare/puppeteer` (134KiB gzipped) rather than `@cloudflare/playwright` (624KiB).

## Consequences

A cached page never names a missing or half-replaced file, and George's edits always win over a capture that was already running. R2 holds up to a week of superseded files, a few hundred KB per line per day, which costs next to nothing. Changing a line's page to snapshot clears its old snapshot at once (plan 3), and the old files go with the next week-old clean-up. The design depends on keys never being reused, which the ULID guarantees. Moving to Playwright later would mean a larger Worker for the same capture.

## Alternatives considered

- **One fixed key per line, overwritten nightly:** simpler, but a cached page could show a file mid-replacement, and the old image would be gone before the cache let go of it.
- **Delete superseded files at once:** saves a little storage, but breaks pages still cached at the edge.
- **Check the line before capturing, then write unconditionally:** leaves a window where an edit made during the capture is overwritten.
