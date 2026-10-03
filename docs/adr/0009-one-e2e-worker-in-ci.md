# ADR-0009: Run the end-to-end tests on one worker in CI

- Status: Proposed
- Date: 2026-10-04
- Authors: George Vlachos

## Context

The GitHub Actions `check` job gates every deploy (ADR-0008). Once the listening corner's 3D scene arrived, the Playwright suite started rendering Three.js on GitHub's ubuntu runners, which have no GPU, so Chromium and WebKit draw WebGL in software on the CPU. With Playwright's default of two workers, two scene specs rendering at once starved each other. Behaviour that depends on wall-clock time then failed for reasons that had nothing to do with the code: the two clicks of a double-click arrived more than 450ms apart, a four-second failure window ran out between two assertions and record journeys were still running after 60 seconds. On a developer's machine with a GPU the same suite passes.

## Decision

CI runs the end-to-end suite with a single Playwright worker (`workers: process.env.CI ? 1 : undefined` in `playwright.config.ts`). Local runs keep Playwright's default parallelism. Scene specs keep generous per-test timeouts for software rendering rather than loosening what they assert, and on CI every one of those budgets and waits is scaled by one shared factor (`SLOW` in `tests/e2e/deck.ts`), so there is a single number to revisit.

## Consequences

Timing checks such as the 450ms double-press guard and the four-second "couldn't play" window mean the same thing in CI as in a browser, so a red check job is a real failure. The check job, and therefore every deploy, takes longer: about 18 minutes for the end-to-end step instead of about 2. If the suite grows much further, the slow part should be split into its own job rather than parallelised back onto shared cores.

## Alternatives considered

- **Keep two workers and widen every timeout:** wall-clock checks like the double-press guard can't be fixed by a longer timeout, so they would stay flaky.
- **Lighten the scene when software rendering is detected:** it would test a different scene from the one visitors see, and change behaviour for real visitors on software rendering.
- **GPU runners:** they cost money and add setup for a personal site.
