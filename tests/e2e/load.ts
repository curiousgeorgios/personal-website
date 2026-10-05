/**
 * How long to wait for work the page does on its own timers and animations. Under parallel load (measured on 5 October
 * 2026 with --workers=14 on a 14-core Mac) a headless renderer stalled for up to 6.6s, timers and frames alike: longer
 * than Playwright's default 5s. CI's single worker never stalls (ADR-0009). A long wait costs nothing when the page is quick.
 * It is a figure measured at that load, not a bound: on 6 October, at load averages of 300 to 389 (more than twice that
 * load), one stall lasted 17.5s. A stall past it under heavier load says the machine is overloaded, not that this is short.
 */
export const STALL_MS = 15_000;
