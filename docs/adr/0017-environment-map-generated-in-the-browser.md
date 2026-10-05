# ADR-0017: The listening corner's environment map is generated in the browser

- Status: Accepted
- Date: 2026-10-05
- Authors: George Vlachos
- Sign-off: accepted under George's delegated sign-off during plan 5

## Context

The 3D scene lights its materials with an environment map made by `PMREMGenerator.fromScene` from three's `RoomEnvironment`. Plan 2 measured that step at 66 to 75ms at 4× CPU throttle (about 18ms unthrottled), one main-thread task before the canvas shows, against spec 11's rule of no scene task over 50ms. The alternative was to precompute the map and ship it. In three 0.169, `fromScene` always renders a 256 cube and its output is a 768 × 1024 half-float texture, megabytes raw; a precompute that really is a few KB (six small faces or a small equirect) still goes through the PMREM blur in the browser, whose shader compile is probably most of the 70ms.

## Decision

Generate the map in the browser and accept the one-off hitch. The step runs in an idle task of its own at the start of `buildStage`, once per visit, before the canvas replaces the poster, so nothing on screen is moving for it to jank and touch scrolling runs off the main thread. Spec 11 names it as the single allowed exception: "No scene task over 50ms at 4× CPU throttle, except one: generating the environment map, about 70ms at 4×, once, before the canvas shows, while the poster is still on screen." It also keeps the other boot work out of the way so it stays the only exception: an idle moment follows the measure, so nothing else shares its task, and every texture goes to the GPU with `renderer.initTexture` in an idle moment of its own before the first frame, which took the first frame from 106 to 118ms down to 6 to 8ms at 4×. Test builds wrap it in a `deck:environment` measure, and the opt-in `scene-perf.spec.ts` allows one long task overlapping that measure, under 100ms, and fails on any other.

## Consequences

Nobody downloads extra bytes or makes an extra request for a 70ms step nobody sees. A press that lands inside those 70ms waits up to 70ms more; on a slow phone that one press could go over the 200ms interaction budget, at most once per visit. The budget is checked locally on a GPU (`SCENE_PERF=1 ... --headed`); CI draws WebGL in software, so it is reported there, not gated. If a real phone shows far more than 70ms, revisit with a measured breakdown of compile time against GPU time.

## Alternatives considered

- **Precompute the map and ship it:** swaps 70ms nobody sees for bytes and a request every visitor pays for, and a small precompute would likely not remove the hitch, since the blur still compiles in the browser.
- **Let the first frame upload the textures:** simpler, but it made the first frame a second long task (106 to 118ms at 4×), which would have needed a second exception.
- **Leave the step where it was:** it shared a task with the last texture slice, the glow canvas and the cover promise's continuation, about 8ms more on top.
