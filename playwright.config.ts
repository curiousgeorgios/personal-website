import { defineConfig, devices } from "@playwright/test";

// Set PLAYWRIGHT_BASE_URL to run specs against a deployed site (CI runs the privacy spec after deploy)
const remote = process.env.PLAYWRIGHT_BASE_URL;

// build:test copies George's .dev.vars into dist/server, so a test server started without this would load his real
// photo signing key. Every test server passes this fixture key instead, and the specs that sign links use the same one.
const PHOTO_KEY_VAR = `--var PHOTO_LINK_SECRET:${"1".repeat(64)}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // GitHub's runner renders WebGL in software, so parallel scene specs starve each other of CPU and wall-clock timing checks fail
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: remote ?? "http://localhost:4331", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "phone", use: { ...devices["iPhone 13 Mini"] }, testMatch: /\/(smoke|logbook|labels|layout|log|deck-list|admin-layout|admin-links-view|gallery|photo-page)\.spec\.ts$/ },
  ],
  webServer: remote
    ? undefined
    : [
        // Never reused, like every server here that loads dist/server: a `bun run serve` left running holds George's
        // real local key (ADR-0024), so Playwright stops with "port already used" until it's closed
        { command: `bun run serve ${PHOTO_KEY_VAR}`, url: "http://localhost:4331", reuseExistingServer: false, timeout: 90_000 },
        // A second server with an empty D1 store, for the degraded-render spec
        {
          command: `wrangler dev -c dist/server/wrangler.json --port 4332 --persist-to .wrangler/empty ${PHOTO_KEY_VAR}`,
          url: "http://localhost:4332",
          reuseExistingServer: false,
          timeout: 90_000,
        },
        // A third server with its own store for the admin specs, which write: deleted and migrated (with the seed)
        // afresh on every run, so it's never reused
        {
          command: `rm -rf .wrangler/admin && wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/admin && node scripts/seed-photo-test.mjs --persist-to .wrangler/admin && wrangler dev -c dist/server/wrangler.json --port 4333 --persist-to .wrangler/admin ${PHOTO_KEY_VAR}`,
          url: "http://localhost:4333",
          reuseExistingServer: false,
          timeout: 120_000,
        },
        // The site the snapshot specs capture, so nothing real is visited
        { command: "node tests/fixtures/snapshot-site.mjs", url: "http://127.0.0.1:4400/", reuseExistingServer: !process.env.CI, timeout: 30_000 },
        // A fourth server running both Workers, with its own store recreated every run: canberra-events points at the
        // fixture page, digital-nachos at a 404, linear-gratis at a page that never goes quiet, r4r-with-me at a blank
        // page and every other line's page is cleared. Local Browser Rendering downloads Chrome on first use.
        {
          command: [
            "rm -rf .wrangler/snapshots",
            "wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/snapshots",
            `wrangler d1 execute curiousgeorge-logbook --local --persist-to .wrangler/snapshots --command "UPDATE items SET snapshot_url = NULL; UPDATE items SET snapshot_url = 'http://127.0.0.1:4400/' WHERE slug = 'canberra-events'; UPDATE items SET snapshot_url = 'http://127.0.0.1:4400/missing' WHERE slug = 'digital-nachos'; UPDATE items SET snapshot_url = 'http://127.0.0.1:4400/busy' WHERE slug = 'linear-gratis'; UPDATE items SET snapshot_url = 'http://127.0.0.1:4400/blank' WHERE slug = 'r4r-with-me'"`,
            // Its own dev registry: in the shared one, the other servers' SNAPSHOTS bindings would reach this snapshots
            // Worker and re-shoot against this store
            `WRANGLER_REGISTRY_PATH=.wrangler/snapshots/registry wrangler dev -c dist/server/wrangler.json -c workers/snapshots/wrangler.jsonc --port 4334 --persist-to .wrangler/snapshots ${PHOTO_KEY_VAR}`,
          ].join(" && "),
          url: "http://localhost:4334",
          reuseExistingServer: false,
          timeout: 180_000,
        },
        // A fifth server with the photo fixture alone (spec 11.3), for the read-only gallery, photo-page, budget,
        // layout-shift and privacy specs: deleted, migrated (with the logbook seed) and seeded afresh on every run, so
        // George's own import in .wrangler/state is never read or changed
        {
          command: `rm -rf .wrangler/gallery && wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/gallery && node scripts/seed-photo-test.mjs --persist-to .wrangler/gallery && wrangler dev -c dist/server/wrangler.json --port 4335 --persist-to .wrangler/gallery ${PHOTO_KEY_VAR}`,
          url: "http://localhost:4335",
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
