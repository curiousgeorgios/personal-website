# Plan 2: follow-ups for later plans

Plan 2 (the listening corner) finished on `redesign/logbook` with every task review and the whole-branch review done. These are the deferred items its reviewers raised, grouped by where they belong. Each was judged not to block building on plan 2. "Task" numbers refer to the tasks in [plan 2](2026-10-04-plan-2-listening-corner.md).

## Plan 3 (admin)

Done in [plan 3](2026-10-04-plan-3-admin.md).

- Records are seeded by migration 0003 and changed through `/admin` from here on. The admin form must keep covers inside the spec 11 budget (512px WebP under 40KB; two of the four starting covers already sit near 40KB) and keep audio and cover keys under the `audio/` and `covers/` prefixes the `/media` route allows.

## Plan 4 (snapshots, analytics, Lighthouse) and launch

[Plan 4](2026-10-05-plan-4-snapshots-analytics.md) did the shadow map, the analytics events and the Lighthouse, INP and layout checks. The environment map is still question 1 below, and the real-device items are launch work.

### Scene performance

- **The environment map hitch.** Decided: accept it, done in [plan 5](2026-10-05-plan-5-polish.md) (Task 2, ADR-0017). Spec 11 asks for no scene task over 50ms at 4× CPU throttle. Task 11 measured `PMREMGenerator.fromScene` at 66 to 75ms at 4× (about 18ms unthrottled), on the main thread before the canvas shows. `tests/e2e/scene-perf.spec.ts` (opt-in) allows that one task and skips itself under software rendering. The 50ms budget is measured locally rather than gated in CI; gating it would need a GPU runner, which is George's cost call.
- **The shadow map is redrawn every frame while only the platter spins.** Nothing that casts a shadow changes while spinning or scratching (the record's shadow is a disc), yet three redraws the 2048 shadow map at 30fps for the whole of every track (`src/deck/scene/build.ts:72`, `src/deck/scene/loop.ts`). Set `shadowMap.autoUpdate = false` and set `needsUpdate` when tweens run or the loop is dirty. It saves GPU and battery on phones and cuts the per-frame cost under CI's software rendering.
- Re-measure long tasks and frame times on a real GPU and on a real phone; the Task 11 numbers are from a laptop.
- Lighthouse LCP, CLS and INP on real devices, including the scene arriving over the poster.

### Analytics

- The `record_played` and `scratch_found` events belong with the first-party beacon.

### Launch

- Real-device audio: iOS Safari and Safari for macOS (gesture unlock, the ringer switch, `audioSession`). The launch checklist already has this item; keep it. It also covers two unverified paths in the audio port: `unlocked` is set before the priming `play()` is known to be accepted, and re-priming after a pause and a `src` swap on iOS has not been checked.
- Production R2 range semantics: the range arithmetic in the `/media` route trusts R2 to normalise `offset` and `length`. The post-deploy media check (`tests/e2e/media-live.spec.ts`) covers it; clamping the values in the route is the optional belt and braces.
- Purge by tag against the Workers cache needs the production zone; the launch checklist covers it.
- George's visual sign-off on the 3D room against the signed-off prototype, including the hard-edged ground shadow Task 11 noted. The posters match the prototype screenshot's composition.
- Track licences and how titles and artists are written (for example "home alone."): content, already on the checklist.

## Questions for George

All six were answered on 5 October 2026 and are done in [plan 5](2026-10-05-plan-5-polish.md): 1, accept the hitch (Task 2, ADR-0017); 2, two hint sentences in one cell (Task 5); 3, posters with one plain sleeve and a night pair (Task 7); 4, a record whose press is undone during the download never leaves the crate (Task 3); 5, the scratch is mouse only (Task 4); 6, each track is a link to its MP3 that the deck makes a play button (Task 6).

These are product calls the reviews could not make.

1. **The environment map.** Precompute it (a few KB and a request) or accept a one-off hitch of about 70ms on slow phones before the canvas shows.
2. **The hint clause.** The hint keeps the spec's full sentence in every state. Without WebGL, or while the poster shows, "flip through the crate with ‹ ›" names controls that never appear, which strains the "every claim on the page is true" value. The alternative is to show that clause only with the scene and reserve the line's height so nothing shifts. It is small.
3. **Empty-crate posters.** The posters show an empty crate, as ruled. Know that the records appear in an empty crate the moment the scene takes over, which on most desktops happens soon after load, so many visitors see the swap.
4. **The out-and-back journey on a changed mind during the download.** A press, then a different press or a stop while the scene is still downloading, still plays a full out-and-back once the scene arrives: record 0 flies out and back before record 1 loads. The recommendation is to skip a journey whose step had not started moving when `want` changed. The unit test that mandates the current behaviour would change with it.
5. **Pen versus `touch-action`.** Pen scratching conflicts with `touch-action: manipulation`. Either drop "pen" from spec 5.4 or accept that pens on touch screens scroll the page.
6. **The no-JavaScript play buttons.** Without JavaScript the list shows "play" buttons that do nothing, although spec 4.1 asks that the page without JavaScript be otherwise complete. Either render the state words only once the script binds, or add a one-line `noscript` note.

## Small polish, any time

### Deck behaviour

- A press can be ignored for up to 15s on a slow network: a press after a stop waits behind `audio.start` until `play()` settles or the 15s timeout passes, with the old record still on the platter. Make `start` abandonable: guard the failure path's `pause` with the token first (it has none today), then let the runner abandon the start when `want` changes.
- The double-press guard times the handler, not the input, so a long task between the two clicks of a real double-click can stretch the gap past 450ms and turn "play" into "play, then stop". Pass `event.timeStamp` from `list.ts`, `hud.ts` and `pointer.ts` as an optional second argument to `toggle`, falling back to `now()`.
- A context loss while the scene mounts can be missed: without `KHR_parallel_shader_compile`, a loss while textures are built goes unnoticed and the first tick marks the dead canvas live; with the extension, `compileAsync` polls every 10ms forever. Register the listener straight after `createRenderer` and check `isContextLost()` after each `await` (`src/deck/scene.ts`).
- Runner: a stale `connect`; a few untested branches; a throwing list subscriber propagates; an idle flip overlaps a load's sleeve lift (visual only, and the flip ends before the lift).
- Audio port: fades without Web Audio are hard cuts (add a comment saying so); tests are missing for `audioSession`, the rate edges and a stop during a pending play.
- Media route: a failed precondition answers 304 rather than 412, and HEAD behaviour is unchecked. The degraded server's log is noisy.

### Scene

- `frame()` caps at distance 200; the phone cover is under 90px tall below 360px wide (the spec's acceptance is at 375).
- The WebGL1 probe; `.live` is re-added every frame; nothing is disposed on context loss; there is no guard in `tick`; there is a window of up to 500ms in which the runner holds a dead view.
- A throwing tween `apply` repeats on every step.
- Lighting is fixed at mount, so a visit that crosses 16:00 keeps daylight. The spec is silent and the effect is trivial.
- Arrow keys ignore `aria-disabled`; the hover preview and hint go stale after a click flip; a pointer cursor shows on inert targets; the `.hint` class name is shared with the track list's hint paragraph (plan 5 scoped the hint's rules to `.corner > .hint`).
- Scratching: there is no `Number.isFinite` guard in `setRate`; a re-grab within 420ms fights the release tween; there is no primary-button guard. Held still, the rate holds at its last value, as in the prototype; how that feels is George's call.

### Markup and styles

- `.sr-only` lives in `deck.css` and should move to the shared styles.
- `ol` loses list semantics in Safari once its bullets are removed: a site-wide `role="list"` pass.
- The second turntable row is unasserted in the markup test.

### Tests and scripts

- Task 2's `media-files` test breaks on a stray `.DS_Store`: filter to `.mp3`.
- The "nothing marked in view" test is vacuous; helper errors are opaque on a build without hooks; list label precedence is untested; the double-click spec asserts only the final state; place and keydown coverage is thin; scratch spec coverage is thin; lighting boundaries are untested.
- The context-loss spec does not assert that the poster returns; the poster test does not check alpha.
- `scripts/poster.mjs` uses a fixed 500ms wait and couples to the markup (plan 5 added the `try`/`finally`).
- The deploy job's hook guard (`grep -rq "__deck" dist`) would pass if `dist` were missing; that is unreachable, because the build fails first.
