// Spec 11's page budgets with Lighthouse: mobile preset (simulated 4G, 4× CPU), median of five runs, Playwright's
// Chromium. Over budget is a warning (a GitHub annotation in CI); --strict makes it a failure.
//   bun run lighthouse                                  the local test server (bun run serve)
//   bun run lighthouse https://curiousgeorge.dev/       the live site, after a request that warms the edge cache
//   bun run lighthouse URL URL ...                      exactly those pages
// Given one root URL it also measures /photos and the newest photograph's page (photo gallery spec 10), once one is published.
// Lighthouse's runs block /ingest, so they never count as visits (its mobile user agent doesn't name Lighthouse).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const given = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const strict = process.argv.includes("--strict");
const RUNS = 5;
const BUDGET = { lcp: 1500, cls: 0.01 };
const warn = (message) => console.log(process.env.GITHUB_ACTIONS ? `::warning title=Lighthouse budget::${message}` : `warning: ${message}`);

/** The pages to measure: those given, or for one root, the root, the gallery and its newest photograph */
async function pagesFor(urls) {
  const list = urls.length > 0 ? urls : ["http://localhost:4331/"];
  if (list.length > 1 || new URL(list[0]).pathname !== "/") return list;
  const root = list[0];
  const pages = [root, new URL("/photos", root).href];
  try {
    const answer = await (await fetch(new URL("/api/photos?by=entry&limit=1", root))).json();
    const id = answer.entries?.[0]?.photos?.[0]?.id;
    if (id) pages.push(new URL(`/photos/${id}`, root).href);
  } catch {
    // Nothing published yet, or no catalogue to ask: the gallery page alone
  }
  return pages;
}

/** Five runs of one page; true when its medians are inside the budget */
async function measure(url) {
  await fetch(url).catch(() => {}); // warm the edge cache, so the runs measure what visitors get (a failure shows in the runs)
  const dir = mkdtempSync(join(tmpdir(), "lighthouse-"));
  const runs = [];
  const failures = [];
  try {
    for (let run = 1; run <= RUNS; run++) {
      const output = join(dir, `run-${run}.json`);
      let lhr;
      try {
        execFileSync(
          "bunx",
          ["lighthouse@13.5.0", url, "--output=json", `--output-path=${output}`, "--only-categories=performance", `--chrome-flags=--headless=new${process.env.CI ? " --no-sandbox" : ""}`, "--quiet", "--blocked-url-patterns=*/ingest/*"],
          { stdio: "inherit", env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH ?? chromium.executablePath() } },
        );
        lhr = JSON.parse(readFileSync(output, "utf8"));
      } catch (error) {
        failures.push(`run ${run}: no report (lighthouse exited with ${error?.status ?? error?.code ?? "an error"})`);
        continue;
      }
      const { audits = {}, runtimeError } = lhr;
      const lcp = audits["largest-contentful-paint"]?.numericValue;
      const cls = audits["cumulative-layout-shift"]?.numericValue;
      // An error page or a page that never paints has no usable numbers: say what went wrong rather than a median of nothing
      if (runtimeError || typeof lcp !== "number" || typeof cls !== "number") {
        failures.push(`run ${run}: ${runtimeError?.code ?? "NO_METRICS"}${runtimeError?.message ? ` (${runtimeError.message})` : ""}`);
        continue;
      }
      runs.push({ lcp, cls, tbt: audits["total-blocking-time"]?.numericValue ?? 0 });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures.length > 0) console.log(`lighthouse: ${failures.length} of ${RUNS} runs of ${url} gave no numbers\n  ${failures.join("\n  ")}`);
  // Fewer than three usable runs has no honest median: report it and count it as over
  if (runs.length < Math.ceil(RUNS / 2)) {
    warn(`lighthouse measured only ${runs.length} of ${RUNS} runs of ${url}, so there is no median`);
    return false;
  }
  const median = (key) => {
    const sorted = runs.map((run) => run[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const result = { lcp: Math.round(median("lcp")), cls: Number(median("cls").toFixed(3)), tbt: Math.round(median("tbt")) };
  console.log(`lighthouse, median of ${runs.length} mobile runs of ${url}:`, result);
  const over = [
    result.lcp >= BUDGET.lcp && `largest contentful paint ${result.lcp}ms on ${url} is over ${BUDGET.lcp}ms`,
    result.cls >= BUDGET.cls && `layout shift ${result.cls} on ${url} is over ${BUDGET.cls}`,
  ].filter(Boolean);
  for (const message of over) warn(message);
  return over.length === 0;
}

let inside = true;
for (const url of await pagesFor(given)) {
  if (!(await measure(url))) inside = false;
}
if (strict && !inside) process.exit(1);
