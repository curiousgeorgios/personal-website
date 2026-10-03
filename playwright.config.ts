import { defineConfig, devices } from "@playwright/test";

// Set PLAYWRIGHT_BASE_URL to run specs against a deployed site (CI runs the privacy spec after deploy)
const remote = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: remote ?? "http://localhost:4331", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "phone", use: { ...devices["iPhone 13 Mini"] }, testMatch: /(smoke|logbook|labels|layout)\.spec\.ts/ },
  ],
  webServer: remote
    ? undefined
    : [
        { command: "bun run serve", url: "http://localhost:4331", reuseExistingServer: !process.env.CI, timeout: 90_000 },
        // A second server with an empty D1 store, for the degraded-render spec
        {
          command: "wrangler dev -c dist/server/wrangler.json --port 4332 --persist-to .wrangler/empty",
          url: "http://localhost:4332",
          reuseExistingServer: !process.env.CI,
          timeout: 90_000,
        },
      ],
});
