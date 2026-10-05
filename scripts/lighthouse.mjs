// Spec 11's page budgets with Lighthouse: mobile preset (simulated 4G, 4× CPU), median of five runs, Playwright's
// Chromium. Over budget is a warning (a GitHub annotation in CI); --strict makes it a failure.
//   bun run lighthouse                                  the local test server (bun run serve)
//   bun run lighthouse https://curiousgeorge.dev/       the live site, after a request that warms the edge cache
// Lighthouse's runs block /ingest, so they never count as visits (its mobile user agent doesn't name Lighthouse).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const url = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "http://localhost:4331/";
const strict = process.argv.includes("--strict");
const RUNS = 5;
const BUDGET = { lcp: 1500, cls: 0.01 };

await fetch(url); // warm the edge cache, so the runs measure what visitors get
const dir = mkdtempSync(join(tmpdir(), "lighthouse-"));
const runs = [];
try {
  for (let run = 1; run <= RUNS; run++) {
    const output = join(dir, `run-${run}.json`);
    execFileSync(
      "bunx",
      ["lighthouse@13.5.0", url, "--output=json", `--output-path=${output}`, "--only-categories=performance", `--chrome-flags=--headless=new${process.env.CI ? " --no-sandbox" : ""}`, "--quiet", "--blocked-url-patterns=*/ingest/*"],
      { stdio: "inherit", env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH ?? chromium.executablePath() } },
    );
    const { audits } = JSON.parse(readFileSync(output, "utf8"));
    runs.push({ lcp: audits["largest-contentful-paint"].numericValue, cls: audits["cumulative-layout-shift"].numericValue, tbt: audits["total-blocking-time"].numericValue });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const median = (key) => runs.map((run) => run[key]).sort((a, b) => a - b)[Math.floor(RUNS / 2)];
const result = { lcp: Math.round(median("lcp")), cls: Number(median("cls").toFixed(3)), tbt: Math.round(median("tbt")) };
console.log(`lighthouse, median of ${RUNS} mobile runs of ${url}:`, result);
const over = [
  result.lcp >= BUDGET.lcp && `largest contentful paint ${result.lcp}ms is over ${BUDGET.lcp}ms`,
  result.cls >= BUDGET.cls && `layout shift ${result.cls} is over ${BUDGET.cls}`,
].filter(Boolean);
for (const message of over) console.log(process.env.GITHUB_ACTIONS ? `::warning title=Lighthouse budget::${message}` : `over budget: ${message}`);
if (strict && over.length > 0) process.exit(1);
