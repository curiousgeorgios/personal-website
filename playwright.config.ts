import { defineConfig, devices } from "@playwright/test";
import { FIXTURE_STRIPE_KEY, PRINTS, PRINTS_NO_RATE, PRINTS_STRIPE, STAND_IN, printStore, printVars } from "./tests/e2e/prints-site";
import { Agent, setGlobalDispatcher } from "undici";

// Set PLAYWRIGHT_BASE_URL to run specs against a deployed site (CI runs the privacy spec after deploy)
const remote = process.env.PLAYWRIGHT_BASE_URL;

// build:test copies George's .dev.vars into dist/server, so a test server started without this would load his real
// photo signing key. Every test server passes this fixture key instead, and the specs that sign links use the same one.
const PHOTO_KEY_VAR = `--var PHOTO_LINK_SECRET:${"1".repeat(64)}`;

// Every worker loads this file, so the specs' own fetches (to the stand-in and the test servers) open a fresh connection
// each time rather than reusing a kept-alive one. On a loaded runner, a reused connection was reset mid-request (CI run
// 37847366341: "other side closed" on a stand-in call; reproduced locally under load, on both the stand-in and the
// prints server, and gone with reuse off). The specs make few requests, so the cost is small
setGlobalDispatcher(new Agent({ pipelining: 0 }));

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
        // The print providers' stand-in: Artelo, the exchange rate, Stripe's three endpoints and the mail sink (spec 23.3)
        { command: "node tests/fixtures/artelo-site.mjs", url: `${STAND_IN}/__requests`, reuseExistingServer: false, timeout: 30_000 },
        // A sixth server for the print specs, every provider stood in, recreated every run like the admin server. Stripe
        // points at the stand-in too, so the money specs run on every run; a first failed order goes straight to
        // needs_attention (PRINT_RETRY_WINDOW=0, spec 19). Specs trigger the cron through wrangler's local explorer (runCron). Its own dev registry, as the snapshots server has
        {
          command: `${printStore(".wrangler/prints")} && WRANGLER_REGISTRY_PATH=.wrangler/prints/registry wrangler dev -c dist/server/wrangler.json --port 4337 --persist-to .wrangler/prints ${PHOTO_KEY_VAR} ${printVars(PRINTS)} --var STRIPE_SECRET_KEY:${FIXTURE_STRIPE_KEY} --var STRIPE_API_BASE:${STAND_IN}/stripe --var PRINT_RETRY_WINDOW:0`,
          url: PRINTS,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        // A seventh: prints switched on with every secret but no exchange rate stored, so the basket shows and edits but
        // quotes nothing (spec 16.5 as ruled). Its own store and dev registry, the same fixture vars and stand-in
        {
          command: `${printStore(".wrangler/prints-no-rate", { rate: false })} && WRANGLER_REGISTRY_PATH=.wrangler/prints-no-rate/registry wrangler dev -c dist/server/wrangler.json --port 4339 --persist-to .wrangler/prints-no-rate ${PHOTO_KEY_VAR} ${printVars(PRINTS_NO_RATE)} --var STRIPE_SECRET_KEY:${FIXTURE_STRIPE_KEY} --var STRIPE_API_BASE:${STAND_IN}/stripe`,
          url: PRINTS_NO_RATE,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        // An eighth, only when STRIPE_TEST_SECRET_KEY is set (George's GitHub secret; locally, your own test key): the
        // full test order through Stripe's hosted page in test mode (spec 23.2). The key reaches wrangler through the
        // shell, never this file, though it shows on the process's command line in ps while the server runs, which is
        // acceptable for a test key; a test build refuses a live key (spec 21.4). Stripe's base and the retry window are
        // pinned too, so nothing in .dev.vars can change them (ADR-0024's reasoning). Its own store and dev registry
        ...(process.env.STRIPE_TEST_SECRET_KEY
          ? [{
              command: `${printStore(".wrangler/stripe")} && WRANGLER_REGISTRY_PATH=.wrangler/stripe/registry wrangler dev -c dist/server/wrangler.json --port 4338 --persist-to .wrangler/stripe ${PHOTO_KEY_VAR} ${printVars(PRINTS_STRIPE)} --var STRIPE_SECRET_KEY:$STRIPE_TEST_SECRET_KEY --var STRIPE_API_BASE:https://api.stripe.com --var PRINT_RETRY_WINDOW:86400`,
              url: PRINTS_STRIPE,
              reuseExistingServer: false,
              timeout: 120_000,
            }]
          : []),
      ],
});
