# Plan 5 follow-ups

What plan 5 (polish) found or left for later.

## Launch

- The three post-deploy checks from plan 4 are on spec 13's checklist: the snapshot variants' sizes in R2, Lighthouse `--strict` once its runs are steady and the RPC `remote` flag on a real failure.
- The Access application's 1 month session and SameSite Lax cookie are dashboard settings, on the checklist with the application itself.
- The audio graph is now built before the first press and resumed inside it. The real-device check on the checklist (one play on an iPhone, once with the ringer switch on silent, and Safari for macOS) covers this path too, and `audioSession`, which is set in the press after the context exists.
- The first CI run's play INP annotation is the one to read before widening anything: it is about 80ms locally against a 200ms gate.
- If a real phone shows the environment map taking far more than 70ms, measure compile time against GPU time before revisiting ADR-0017.
- Re-run `scene-perf.spec.ts` on a GPU with headed Chromium (`bunx playwright install chromium` first: the documented `--headed` command needs it). Task 8 measured one 64ms long task on a cold first press (the next run had none) and nothing since, so spec 11, the README and the plan 4 follow-ups say it may still show one. If the cold press persists, find what remains in it; the first journey frame redrawing the 2048 shadow map is the likeliest.

## Accepted

- From 16:00 to 19:00 the scene is golden and the poster is the day one; a golden pair would close it. The difference is a gentle warm shift when the scene takes over, so there is no third poster pair.
- Chrome and Firefox log a console warning on every load, because the deck builds its audio context before the first press (spec 11). The context stays suspended until the press resumes it, and no check counts the warning.
- A page counts as showing something when only its `<html>` or `<body>` has a CSS background image or gradient, so a page drawn only in CSS is captured. The cost: a single-page app whose shell failed to render over a body gradient or texture is captured as that blank, styled page and replaces the last good snapshot. If that bites, count only elements with a box.
- The closer look swaps the 1920 in without a crossfade; a sharper file landing mid-grow is a small change of detail, not of size.
- A browser that offers only software WebGL gets the poster, not the scene (ADR-0019), so some low-end machines never see the scene.

## Later

- A tap, or keyboard focus, in the instant before the inlined deck script runs: the tap follows the track's link to the MP3 instead of cueing the record (the track still plays), and focus on a link drops to the page when the link becomes a button. The window runs to the end of the document's parse, not to the list's; a classic inline script straight after the list would close it, and would need its own CSP hash.
- The label-closed guard in `closer.ts` lost its e2e test with the wait it covered: the window is now one `decode()` of a picture already decoded.
- The hover card measures its nudge on each hover, so a window resized while a card is up keeps the old nudge until the next hover.
- The rate tween after a scratch skips the shadow map now (one redraw, down from about 26), but every other tween's frames still redraw it.
- When Browser Rendering refuses every session, the nightly run leaves every line's status as it was and logs `no browser` for each; the previous snapshots stay.
- Task 13's log-line nits: the SessionGone test in `tests/unit/snapshot-run.test.ts` doesn't assert its log line, and `run.ts` uses one log prefix for a refused launch and for a session that can't open a page, so the log can't tell them apart.
- A pen drag across the record ends in a click that stops it, because `pointer.ts` returns early for a pen and nothing sets `suppressClick`. Before plan 5 the same drag scratched it. If wanted: on a pen `pointerdown` on the record, remember where it went down, and on `pointerup` suppress the click when it moved more than `SCRATCH_PX`.
- Task 4's pen scratch test pins that a pen drag doesn't scratch, but no test pins the comment's other claim, that a pen tap still stops the record; a `pointercancel` and a touch variant aren't covered either.
- Task 6's e2e test is titled "before anything binds" but asserts only the end state after `load`, and the no-JavaScript check doesn't assert that `/media/` sends no `content-disposition`, the header that decides whether the browser plays the file or downloads it.
- Task 5's height test in `deck-scene.spec.ts` assumes the scene is not yet live straight after `goto`; if it flakes, take the baseline height from the no-WebGL path or block the chunk request until after it.
- `scripts/poster.mjs` still waits a fixed 500ms for the scene to settle and reads the page's markup (plan 2).

## Testing

- Under oversubscription (two suites at once, or `--workers` above the default) a headless renderer can stall for seconds. Plan 5 gave the two waits that met it `STALL_MS` (`tests/e2e/load.ts`); other waits on the page's own timers keep Playwright's 5s. Run one suite at a time.
- `STALL_MS` (15s) is a figure measured at 14 workers, not a bound: on 6 October, at load averages of 300 to 389, one stall lasted 17.5s. A stall past it says the machine is overloaded.
- These tests still fail at 14 workers and loads above 120, and pass alone or at the default worker count (CI runs one worker): in `deck-crate.spec.ts`, "browsing while playing" and "a control press then a list press"; in `deck-journeys.spec.ts`, "reduced motion", "mashing" and "changing mind"; and three hover-card tests in `labels.spec.ts`. They wait on round trips and the page's own timers, which a stalled renderer outlasts. The fix, if one is wanted, is to have the page record what each asserts, as plan 5 did for the arrows.
- `ingest.spec.ts:32` (an event the proxy refuses answers 404) returned a 500 once in a full run during plan 7 (8 October) and passed six times alone. Under load the Worker can fail before the proxy's own refusal, so the test would need the 404 body to tell the two apart.
- `ingest.spec.ts:21` (a body over 32KB is refused with a 413) failed once under load in a full run during plan 7 (9 October) and passes alone.
- `prints-basket.spec.ts:67` (later batches of a carried basket's gallery keep it on their frames) failed once in 87 print-spec runs during plan 7 (9 October) and passed 60 of 60 alone.
