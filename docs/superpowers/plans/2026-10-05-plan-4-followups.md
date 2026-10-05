# Plan 4 follow-ups

What plan 4 (snapshots and analytics) found or left for later.

## Later

- The local Images binding ignores `quality`, so the variants' quality steps are only exercised for real in production. Check the first nightly run's file sizes in R2 against spec 11's budgets.
- Lighthouse's post-deploy runs are a warning, not a gate. If they prove steady on GitHub's runners, `--strict` turns them into one.
- The environment map's hitch (plan 2 question 1) is unchanged: the opt-in `scene-perf.spec.ts` still fails on it.
- The hover card for a line near the window's right edge is cut at the edge between about 800 and 860px wide; a small nudge on first hover could slide it left to stay whole.
- The closer look now shows a busy cursor (`aria-busy`) while the 1920px file loads, and a 1920 that fails falls back to the frame's own image, but it still opens only once the file has downloaded and decoded; it could open at once with the frame's image and swap the big one in.
- The Worker's errors now read "the snapshots worker didn't answer" (unreachable, or past 60s) or "the snapshots worker hit an error" (it threw). A refused Browser Rendering session (a rate or concurrency limit) reads as "hit an error"; "the browser couldn't start" would be truer.
- Pressing play costs about 200ms at 4× CPU, most of it the deck building its `AudioContext` inside the first press (plan 2 code). Build it before the press (suspended at load, resumed in the press), then gate the play check in `tests/e2e/perf.spec.ts`.
- A page that is only a CSS background image reads as blank and keeps its previous snapshot.
- If the browser session dies mid-run, the rest of that night's lines error, with no relaunch; they retry the next night.
- `sweep`'s 1000-key delete batches have no suite test (a probe confirmed them).
- No test makes the snapshots Worker's `scheduled()` or `reshoot()` fail, so their error logs are untested.
- The CI Chrome cache is saved only when the job passes.
- The RPC exception's `remote` flag, used to tell a Worker that threw from one that didn't answer, is documented for Durable Objects and seen under `wrangler dev`, but not checked deployed. If it differs, a thrown error reads "didn't answer".
- A slow first hover can fade in an empty card.
- A 1920 request that never settles leaves every frame ignoring clicks until it does.
- The fallback picture (when the 1920 fails) grows to twice the frame, not to fit the window.

### Test gaps

- A Turntable button without `data-id`.
- Closing a label, or a find-in-page reveal, not counted by the beacon.
- A record dropped mid-load.
- A real Tab reaching the pill.

### Known flakes under full-suite load

Each passes alone.

- `log.spec.ts` "older entries expand and collapse".
- `deck-crate.spec.ts` "the arrows are disabled while a record travels".
- `admin-gate.spec.ts` "a write from this site's origin gets through the gate" (wrangler dev's ProxyWorker answers 500 on a cold server).
- `deck-scratch.spec.ts`'s two scratch tests.
- `labels.spec.ts` "two quick Escapes".
