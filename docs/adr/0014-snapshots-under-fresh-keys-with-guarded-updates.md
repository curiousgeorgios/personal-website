# ADR-0014: Store each snapshot under a fresh key, move a line to it only if its address is unchanged

- Status: Accepted
- Date: 2026-10-05
- Authors: George Vlachos

## Context

ADR-0002 chose always-fresh snapshots: a separate Worker captures each line's page nightly with Browser Rendering, makes variants with the Images binding and stores them in R2. Three things shaped how the files are kept. The logbook page is cached at Cloudflare's edge for up to a day (spec 6.1), so a page can still name yesterday's files after a new capture. George can edit or remove a line in `/admin` while the nightly run, or his own "re-shoot now", is capturing it. And the capture library runs inside a Worker, where bundle size matters; `@cloudflare/puppeteer` and `@cloudflare/playwright` both work with Browser Rendering, including locally under `wrangler dev`.

## Decision

- Every good capture is stored under a fresh base key, `snapshots/<slug>-<ulid>`, as six files (`-480`, `-960` and `-1920`, each AVIF and WebP). Keys are never overwritten.
- The line is pointed at the new base with an update that also requires its `snapshot_url` to still be the address that was captured; a failed capture only records `snapshot_status` under the same condition. If the line's address was changed or the line removed meanwhile, nothing changes and the new files are deleted; other edits leave the snapshot columns alone, so they and the capture both stand.
- Files no line names are deleted by the nightly run a week after the next capture of the same line was uploaded, however old they are; files with no later capture of their line (a line removed, or given a new address and not captured since) go a week after their own upload. Each capture's files carry their line's id in R2 metadata, so a line renamed in `/admin` keeps its old files for the full week. A database update that fails after it may have committed never deletes the new files unless the line is known not to name them; the sweep collects any left over.
- Captures use `@cloudflare/puppeteer` (134KiB gzipped) rather than `@cloudflare/playwright` (624KiB).

## Consequences

A cached page never names a half-replaced file, and George's changes always win over a capture that was already running. It never names a missing one either, with one narrow exception: a line removed or given a new address in `/admin` whose newest capture is over a week old (its captures have been failing) loses those files at the next nightly run, and if that save's purge failed, a stale copy of the page can still name them for up to a day. R2 holds each line's previous capture for a week after it was replaced, a few hundred KB per line per day, which costs next to nothing. Changing a line's page to snapshot clears its old snapshot at once (plan 3), and the old files go with the next week-old clean-up. The design depends on keys never being reused, which the ULID guarantees. Two faults together (a capture's clean-up failing, then a later capture of the same line) can start a file's week early, and the re-read after a failed update assumes D1 reads come from the primary; turning on read replication would mean pinning that read to it. Moving to Playwright later would mean a larger Worker for the same capture.

## Alternatives considered

- **One fixed key per line, overwritten nightly:** simpler, but a cached page could show a file mid-replacement, and the old image would be gone before the cache let go of it.
- **Delete superseded files at once:** saves a little storage, but breaks pages still cached at the edge.
- **Check the line before capturing, then write unconditionally:** leaves a window where an edit made during the capture is overwritten.
- **Group a line's captures by the slug in their keys:** needs no metadata, but a line renamed in `/admin` would look removed, and its old files, if over a week old, would go in the same run that replaced them while cached pages still name them.
