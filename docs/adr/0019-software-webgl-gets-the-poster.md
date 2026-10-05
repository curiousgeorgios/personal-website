# ADR-0019: A browser that only has software WebGL gets the poster, not the scene

- Status: Accepted
- Date: 2026-10-05
- Authors: George Vlachos

## Context

The scene's loader probes for WebGL and boots the scene if a context comes back. A browser whose WebGL is software only (a blocklisted GPU, a VM, hardware acceleration turned off) hands one out too, and the scene then runs on the CPU. Plan 5's review of the hover cards traced a multi-second main-thread stall after load to exactly that: under SwiftShader in Playwright's headless shell, the scene's first frame ends in a `ReadPixels` wait of about 2.2s (2.5 to 10s on a busy machine), during which nothing on the page responds. On hardware WebGL the same boot costs at most 71ms at 4× CPU throttle (spec 11), and nothing over 200ms follows. Software WebGL is therefore the one case where the scene can freeze the page it is meant to decorate.

## Decision

In production builds the probe asks for `{ failIfMajorPerformanceCaveat: true }`, so a context that only software can draw fails like no WebGL at all: the poster stays, and the hint and the list work as they do without WebGL. The scene's renderer is created with the same option, so the probe and the real context agree. Test builds (`__TEST_HOOKS__`) probe and create without it, so CI, which draws WebGL in software, still runs the scene. The options live in `src/deck/webgl.ts` and a unit test pins which build uses which.

## Consequences

Some low-end or GPU-blocklisted machines see the poster where they could have had a slow scene. That is the intended trade: the poster is a complete experience, and a frozen page is not. CI still tests the scene, so the two paths stay covered (the scene on software WebGL, and the poster through the existing no-WebGL specs). A production-only difference in what counts as WebGL means the shipped probe isn't what the deck specs exercise; the unit test and the shared helper keep that gap to one line.

## Alternatives considered

- **Let software WebGL run the scene:** keeps the scene on every machine that can draw it at all, but a visitor on one gets a freeze of seconds just after load, whether or not they touch the deck.
- **A time-based probe (boot, measure the first frame, bail out if it is slow):** the stall is a synchronous wait inside the first frame, so the page is already frozen by the time the measurement could say so, and the threshold would be a guess that varies with load.
