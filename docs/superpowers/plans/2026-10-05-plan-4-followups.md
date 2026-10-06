# Plan 4 follow-ups

What plan 4 (snapshots and analytics) found or left for later. [Plan 5](2026-10-05-plan-5-polish.md) did every item that is code; the three that can only be checked after a deploy are on the launch checklist (spec 13).

## Later

- The local Images binding ignores `quality`, so the variants' quality steps are only exercised for real in production. Check the first nightly run's file sizes in R2 against spec 11's budgets. **Launch check (spec 13).**
- Lighthouse's post-deploy runs are a warning, not a gate. If they prove steady on GitHub's runners, `--strict` turns them into one. **Launch check (spec 13).**
- The environment map's hitch (plan 2 question 1) is unchanged: the opt-in `scene-perf.spec.ts` still fails on it. **Done in plan 5 (Task 2, ADR-0017):** accepted as the one allowed long task, and the spec is written to pass on that basis. A cold first press measured one 64ms long task after Task 8 and no run since, so it may still fail on that press; see the plan 5 follow-ups.
- The hover card for a line near the window's right edge is cut at the edge between about 800 and 860px wide. **Done in plan 5 (Task 9):** it slides back inside on each hover.
- The closer look opened only once the 1920px file had downloaded and decoded. **Done in plan 5 (Task 10):** it opens at once with the frame's picture and swaps the big file in.
- A refused Browser Rendering session read as "the snapshots worker hit an error". **Done in plan 5 (Task 13):** "the browser couldn't start".
- Pressing play cost about 200ms at 4× CPU, most of it building the `AudioContext` inside the first press. **Done in plan 5 (Task 8):** built after load, and the play check is gated.
- A page that is only a CSS background image read as blank and kept its previous snapshot. **Done in plan 5 (Task 12).**
- If the browser session died mid-run, the rest of that night's lines errored, with no relaunch. **Done in plan 5 (Task 11):** a fresh session after a session that can't open a page, at most three a night.
- `sweep`'s 1000-key delete batches had no suite test. **Done in plan 5 (Task 11).**
- No test made the snapshots Worker's `scheduled()` or `reshoot()` fail. **Done in plan 5 (Task 11).**
- The CI Chrome cache was saved only when the job passed. **Done in plan 5 (Task 14).**
- The RPC exception's `remote` flag, used to tell a Worker that threw from one that didn't answer, is documented for Durable Objects and seen under `wrangler dev`, but not checked deployed. If it differs, a thrown error reads "didn't answer". **Launch check (spec 13).**
- A slow first hover could fade in an empty card. **Done in plan 5 (Task 9).**
- A 1920 request that never settled left every frame ignoring clicks. **Done in plan 5 (Task 10).**
- The fallback picture (when the 1920 fails) grew to twice the frame, not to fit the window. **Done in plan 5 (Task 10).**

### Test gaps

All closed in plan 5.

- A Turntable button without `data-id` (Task 6, `playedProperties`).
- Closing a label, or a find-in-page reveal, not counted by the beacon (Task 9).
- A record dropped mid-load (Task 3).
- A real Tab reaching the pill (Task 9).

### Known flakes under full-suite load

All fixed at their causes in plan 5 (Tasks 15 and 16), each reproduced with `--workers=14`.

- `log.spec.ts` "older entries expand and collapse": the renderer stalled up to 6.6s, past the 5s wait.
- `deck-crate.spec.ts` "the arrows are disabled while a record travels": round trips slower than the journey; the page now records the states.
- `admin-gate.spec.ts` "a write from this site's origin gets through the gate": wrangler dev's proxy retries a dropped connection only for GET and HEAD.
- `deck-scratch.spec.ts`'s two scratch tests: every scratch move redrew the 2048 shadow map.
- `privacy.spec.ts` "cookies none, storage empty, every request first party": the scene came in under the default 30s budget.
- `labels.spec.ts` "two quick Escapes": the `close` event is dispatched a task after the browser returns focus.
