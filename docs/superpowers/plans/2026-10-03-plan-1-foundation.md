# Plan 1: foundation, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Next.js site with an Astro 7 logbook on Cloudflare Workers that renders every section from D1 (with text-only wall labels and the turntable empty state), is edge cached, secure, fast and fully tested, with CI that gates deploys.

**Architecture:** Astro 7 with `@astrojs/cloudflare` 14 in `output: "server"` mode, deployed as a Worker with static assets. `src/pages/index.astro` reads D1 once through `loadLogbookSafely()` and hands plain data to a pure `Logbook.astro` component, so rendering is unit-testable without Cloudflare. Interactivity is three tiny vanilla TypeScript page scripts (clock, labels, log toggle). Route caching uses Astro's Cloudflare cache provider with the `logbook` tag.

**Tech stack:** Astro 7.3.5, @astrojs/cloudflare 14.3.3, wrangler 4.147.0, Cloudflare D1, bun 1.2, TypeScript 6, Vitest 5 with the Astro container and linkedom, Playwright 1.63 (Chromium, WebKit, iPhone 13), subset-font, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md](../specs/2026-10-03-personal-site-redesign-design.md) (sections 1 to 4, 6, 8, 11 to 14 apply to this plan). Roadmap: [2026-10-03-redesign-roadmap.md](2026-10-03-redesign-roadmap.md). Visual reference: [docs/prototypes/2026-10-03-logbook/](../../prototypes/2026-10-03-logbook/).

## Prerequisites (before Task 1)

- The working tree on `main` has George's uncommitted edit to `components/sections/SectionContent.tsx`. George decides whether it is committed to `main` (for the live site) or dropped before the branch is created. Do not start Task 1 until `git status` shows only `.gitignore` and `docs/` changes.
- The docs written during brainstorming (`docs/`, `.gitignore`) are committed on the branch in Task 1.

## Global constraints

- Package manager is bun; never add `package-lock.json`. Pin exact versions as listed in Task 1.
- `output: "server"`, `session: false`, `cache: { provider: cacheCloudflare() }`. No `client:*` components, no UI framework, no Tailwind.
- Copy is lowercase, Australian spelling, spaced hyphen " - " as the dash, no em dashes, no Oxford comma, no invented claims. Copy strings in this plan are final for plan 1; seeded content marked "placeholder" is replaced by George later.
- Tokens exactly: `--paper #f3f2ec`, `--ink #1f201c`, `--muted #6b6b63`, `--faint #b4b3aa`, `--rule #dddcd3`, `--red #c94a31`, `--mat #fbfbf8`, `--dot rgba(31,32,28,.075)`.
- Fonts: Schibsted Grotesk (variable, weights 400 to 500) and DM Mono 400, self-hosted woff2 in `public/fonts/`, preloaded, no third-party font requests.
- Motion: ease-out by default, 200 to 300ms, hover transitions 200ms `ease` only under `(hover: hover) and (pointer: fine)`, nothing animates on load or scroll, transitions removed under `prefers-reduced-motion`.
- Nothing sets a cookie or uses localStorage or sessionStorage. Every request from the page goes to the site's own origin.
- D1 migrations are applied with `wrangler d1 migrations apply`, never `wrangler d1 execute --file`.
- Budgets (spec section 11): JS before interaction under 10KB gzipped, HTML under 30KB gzipped, CSS under 15KB gzipped, two font files under 60KB total, CLS under 0.01.
- `/` cache: `Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["logbook"] })` (deploys show within minutes; admin saves purge the tag globally in plan 3); browsers get `Cache-Control: no-cache`; degraded renders get `Cache-Control: no-store` and no cache hint. Stylesheets are always inlined (`build.inlineStylesheets: "always"`) so a cached page never points at a stylesheet a later deploy removed.
- Run `bun run typecheck` in every task's verify step; `astro check` must report 0 errors.

## Review focus

- Item text with markup characters or unsafe links (`<b>`, `&`, `[x](javascript:alert(1))`) must render as escaped text and never as a working link. Pinned in Task 3 (`parseInline`) and Task 7 (rendered output).
- Partial data (no log entries, three or fewer entries, no facts, no now or before items, labels with only some fields) must omit rows, toggles and `· last entry` cleanly rather than render empty shells. Pinned in Task 6.
- D1 failing must still produce a 200 page with the static sections, `Cache-Control: no-store` and no cache hint. Pinned in Task 4 and Task 6.
- Visitors arriving with query strings (`/?utm_source=instagram&fbclid=…`) must get the same page. Pinned in Task 9.
- Long unbroken words or URLs in admin-entered text must not cause horizontal scrolling on a 375px phone. Pinned in Task 6 (`tests/e2e/layout.spec.ts`).

## File structure

```
astro.config.mjs                 Astro + adapter + route cache + CSP
wrangler.jsonc                   Worker config, D1 binding
worker-configuration.d.ts        generated by `wrangler types` (committed)
tsconfig.json
package.json                     bun scripts
playwright.config.ts
vitest.config.ts
migrations/0001_schema.sql       D1 tables
migrations/0002_seed.sql         initial content
scripts/build-fonts.mjs          subsets fonts into public/fonts
scripts/og-image.mjs             renders public/og.png from the running site
public/fonts/*.woff2             generated, committed
public/robots.txt, site.webmanifest, favicons, og.png
src/env.d.ts                     Astro types reference
src/lib/text.ts                  parseInline, primaryName, formatLogDate, sideFor
src/lib/time.ts                  sydneyTime
src/lib/logbook.ts               types, loadLogbook, loadLogbookSafely
src/styles/notebook.css          tokens and all page styles
src/layouts/Notebook.astro       <html>, head metadata, fonts
src/components/Row.astro         margin label + body
src/components/Inline.astro      renders parseInline output
src/components/Intro.astro       name, intro, Sydney clock
src/components/ItemLines.astro   now/before lines with wall labels
src/components/Lately.astro      shelf and kettle
src/components/Log.astro         dated entries with toggle
src/components/Turntable.astro   empty state (plan 2 replaces)
src/components/SayHi.astro
src/components/VisitorInfo.astro
src/components/Logbook.astro     composes the page from data (pure)
src/scripts/clock.ts, labels.ts, log-toggle.ts
src/middleware.ts                security headers
src/pages/index.astro            D1 read, caching, renders Logbook
src/pages/404.astro
src/pages/ig.ts                  302 with UTM
src/pages/jobs/video-editor.ts   301 to /
tests/unit/*.test.ts             Vitest
tests/unit/render.ts             container + linkedom helper
tests/e2e/*.spec.ts              Playwright
.github/workflows/ci.yml
```

---

### Task 1: Replace Next.js with an Astro 7 skeleton

**Files:**
- Delete: `app/`, `components/`, `hooks/`, `lib/`, `styles/`, `scripts/patch-worker.mjs`, `scripts/generate-audio-manifest.mjs`, `next.config.mjs`, `next-env.d.ts`, `components.json`, `tailwind.config.js`, `postcss.config.mjs`, `jsconfig.json`, `open-next.config.ts`, `package-lock.json`, `tsconfig.tsbuildinfo`, `.DS_Store`, `public/.DS_Store`, `public/audio/README.md`, `public/placeholder-logo.png`, `public/placeholder-logo.svg`, `public/placeholder-user.jpg`, `public/placeholder.jpg`, `public/placeholder.svg`
- Move: `linkedin-banner.html` → `docs/brand/linkedin-banner.html`
- Create: `package.json`, `astro.config.mjs`, `wrangler.jsonc`, `tsconfig.json`, `src/env.d.ts`, `src/pages/index.astro`, `playwright.config.ts`, `vitest.config.ts`, `tests/e2e/smoke.spec.ts`, `.gitignore`
- Keep: `public/audio/*.mp3` (moved to R2 in plan 2), favicons (moved in Task 5), `.env` (gitignored, used in plan 4)

**Interfaces:**
- Produces: `bun run build` → `dist/` with `dist/server/wrangler.json`; `bun run serve` serves the build on `http://localhost:4331` with local D1 at `.wrangler/state`; `bun run test:unit`; `bun run test:e2e`.

- [ ] **Step 1: Create the branch and commit the brainstorming docs**

```bash
git checkout -b redesign/logbook
git add docs .gitignore
git commit -m "docs: redesign spec, ADRs 0001-0008, prototype and plans"
```

- [ ] **Step 2: Remove the Next.js app**

```bash
git rm -r -q app components hooks lib styles scripts/patch-worker.mjs scripts/generate-audio-manifest.mjs \
  next.config.mjs components.json tailwind.config.js postcss.config.mjs jsconfig.json \
  open-next.config.ts package-lock.json public/audio/README.md public/placeholder-logo.png \
  public/placeholder-logo.svg public/placeholder-user.jpg public/placeholder.jpg public/placeholder.svg .npmrc
git rm -q --cached .DS_Store public/.DS_Store 2>/dev/null; rm -f .DS_Store public/.DS_Store tsconfig.tsbuildinfo next-env.d.ts
# public/audio/artwork and manifest.json were made by the old prebuild script and are only ignored until Step 11
rm -rf node_modules .next .open-next .wrangler data types utils public/audio/artwork public/audio/manifest.json
mkdir -p docs/brand && git mv linkedin-banner.html docs/brand/linkedin-banner.html
```

Expected: `git status --short` lists only deletions, the rename and `.gitignore`/docs changes already committed in Step 1.

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "personal-website",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "typecheck": "astro check",
    "cf-typegen": "wrangler types",
    "fonts": "node scripts/build-fonts.mjs",
    "og": "node scripts/og-image.mjs",
    "db:migrate:local": "wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/state",
    "db:migrate:remote": "wrangler d1 migrations apply curiousgeorge-logbook --remote",
    "serve": "wrangler dev -c dist/server/wrangler.json --port 4331 --persist-to .wrangler/state",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "check": "bun run typecheck && bun run test:unit && bun run db:migrate:local && bun run build && bun run test:e2e"
  }
}
```

- [ ] **Step 4: Install pinned dependencies**

```bash
bun add astro@7.3.5 @astrojs/cloudflare@14.3.3
bun add -d wrangler@4.147.0 typescript@6.0.3 @types/node@24.19.1 @astrojs/check@0.9.10 @playwright/test@1.63.0 vitest@5.0.3 \
  linkedom@0.18.13 subset-font@2.9.0 @fontsource-variable/schibsted-grotesk@5.3.0 @fontsource/dm-mono@5.3.0
bunx playwright install chromium webkit
```

Expected: `bun.lock` created, no `package-lock.json`.

- [ ] **Step 5: Write `astro.config.mjs`**

```js
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";

export default defineConfig({
  site: "https://curiousgeorge.dev",
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  // No sessions: Astro must never set a cookie on this site
  session: false,
  // Route caching through Cloudflare's Worker cache; purged by tag from /admin (plan 3)
  cache: { provider: cacheCloudflare() },
  // Inline every stylesheet, so a page cached at the edge never references a hashed file a later deploy removed
  build: { inlineStylesheets: "always" },
  // No syntax highlighting: Shiki's inline styles conflict with the CSP
  markdown: { syntaxHighlight: false },
  security: {
    // Astro hashes inline scripts and styles and sends the policy as a response header; bundled files need 'self'
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'"] },
    },
  },
});
```

- [ ] **Step 6: Write `wrangler.jsonc`**

The `database_id` is a placeholder for local runs; it is replaced with the real id at launch (roadmap launch gate).

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "personal-website",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "assets": { "directory": "./dist", "binding": "ASSETS" },
  "observability": { "logs": { "enabled": true } },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "curiousgeorge-logbook",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 7: Write `tsconfig.json`, `src/env.d.ts` and generate Worker types**

`tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "worker-configuration.d.ts", "src", "tests", "scripts", "*.ts", "*.mjs"],
  "exclude": ["dist", "docs", ".superpowers", ".playwright-mcp"]
}
```

`src/env.d.ts`:

```ts
/// <reference types="astro/client" />
```

Run:

```bash
bunx wrangler types
```

Expected: `worker-configuration.d.ts` created, containing `DB: D1Database`.

- [ ] **Step 8: Write the placeholder page `src/pages/index.astro`**

```astro
---
---
<!doctype html>
<html lang="en-AU">
  <head><meta charset="utf-8" /><title>george vlachos</title></head>
  <body><h1>george vlachos</h1></body>
</html>
```

- [ ] **Step 9: Write `playwright.config.ts` and `vitest.config.ts`**

`playwright.config.ts`:

```ts
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
```

`vitest.config.ts`:

```ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// Unit tests render components with Astro's container, without the Cloudflare adapter
// (the adapter starts its own Vite server, which clashes with Vitest's).
export default getViteConfig(
  { test: { include: ["tests/unit/**/*.test.ts"], environment: "node" } },
  { configFile: false, session: false },
);
```

- [ ] **Step 10: Write the failing smoke test `tests/e2e/smoke.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("home responds with the logbook shell", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-AU");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("george vlachos");
});
```

- [ ] **Step 11: Write `.gitignore`**

```
node_modules/
dist/
.astro/
.wrangler/
.dev.vars*
.env*
.DS_Store
test-results/
playwright-report/
# brainstorming mockups and browser scratch
.superpowers/
.playwright-mcp/
```

- [ ] **Step 12: Build and run the smoke test**

Run: `bun run typecheck && bun run build && bun run test:e2e -- tests/e2e/smoke.spec.ts`
Expected: `astro check` reports 0 errors; 3 passed (chromium, webkit, phone).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: replace Next.js with an Astro 7 skeleton on Workers"
```

---

### Task 2: D1 schema and seed

**Files:**
- Create: `migrations/0001_schema.sql`, `migrations/0002_seed.sql`

**Interfaces:**
- Produces: tables `items`, `log_entries`, `facts`, `records` with the columns below; seed rows with slugs `digital-nachos`, `canberra-events`, `linear-gratis`, `r4r-with-me`, `good-people`, `onestack`, `blocksolve`, `shecreates`, `startups`, `finance-policy`, `kpmg`.

- [ ] **Step 1: Write `migrations/0001_schema.sql`**

```sql
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL CHECK (section IN ('now', 'before')),
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  aside TEXT,
  label_era TEXT,
  label_status TEXT CHECK (label_status IN ('live', 'retired')),
  label_made_of TEXT,
  label_text TEXT,
  label_kind TEXT CHECK (label_kind IN ('decision', 'lesson')),
  label_note TEXT,
  snapshot_url TEXT,
  snapshot_key TEXT,
  snapshot_at TEXT,
  snapshot_status TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX items_section_position ON items (section, position);

CREATE TABLE log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  precision TEXT NOT NULL CHECK (precision IN ('day', 'month')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX log_entries_order ON log_entries (date DESC, created_at DESC, id DESC);

CREATE TABLE facts (
  key TEXT PRIMARY KEY CHECK (key IN ('shelf', 'kettle')),
  title TEXT NOT NULL,
  subtitle TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  cover_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX records_active_position ON records (active, position);
```

- [ ] **Step 2: Write `migrations/0002_seed.sql`**

Label sentences marked placeholder in spec section 13 are replaced by George through `/admin` (plan 3).

```sql
INSERT INTO items (slug, section, position, text, aside, label_era, label_status, label_made_of, label_text, label_kind, label_note, snapshot_url) VALUES
('digital-nachos', 'now', 1, 'growing [digital nachos](https://digitalnachos.com.au)', NULL,
  'the studio', 'live', 'plain english, fixed fees and a refund guarantee',
  'reporting pipelines, dashboards and software that take the repeated exports and spreadsheet clean-up off a team.',
  'decision', 'you only pay once it''s live and working. if the risk sits with me, i''m careful about what i promise.',
  'https://digitalnachos.com.au'),
('canberra-events', 'now', 2, 'building [canberra.events](https://canberra.events)', 'things worth leaving the house for',
  '2025 to now', 'live', 'a city calendar, local venues and a lot of local knowledge',
  'canberra doesn''t have an events problem. it has a finding-out problem. so this is one calendar for the whole city, updated every day.',
  'decision', 'start with the people who run things, not the people who scroll. if organisers can list in a minute, the calendar fills itself.',
  'https://canberra.events'),
('linear-gratis', 'now', 3, 'building [linear.gratis](https://linear.gratis)', NULL,
  'open source', 'live', 'linear''s api, public boards and feedback forms',
  'clients shouldn''t need a paid seat to see how their project is going. this turns a linear project into a live board and a feedback form anyone can open.',
  'lesson', 'i once merged a pull request here that was ai slop. i said so publicly. every line gets read now.',
  'https://linear.gratis'),
('r4r-with-me', 'now', 4, 'helping [r4r](https://runningforresilience.com) and [with-me](https://www.with-me.co/) grow through technology', NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('good-people', 'now', 5, 'looking for good people to build things with', NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('onestack', 'before', 1, 'founded and built [onestack.cloud](https://onestack.cloud)', NULL,
  'founder', 'retired', 'open-source tools in one place',
  'an early attempt at one home for a small business''s tools. it taught me most of what i know about building something people pay for.',
  NULL, NULL, 'https://onestack.cloud'),
('blocksolve', 'before', 2, '[blocksolveinfrastructure.com](https://blocksolveinfrastructure.com)', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('shecreates', 'before', 3, '[shecreatesmgmt.com](https://shecreatesmgmt.com)', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('startups', 'before', 4, 'dev and data at a few startups', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('finance-policy', 'before', 5, 'finance and policy', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('kpmg', 'before', 6, 'management consulting at kpmg', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO facts (key, title, subtitle) VALUES
('shelf', 'the scout mindset', 'julia galef'),
('kettle', 'fellow stagg', 'slightly hacked');

INSERT INTO log_entries (date, precision, text) VALUES
('2026-03-01', 'month', 'started helping with-me grow.'),
('2026-03-01', 'month', 'moved to sydney.'),
('2026-09-01', 'month', 'shipped the new digital nachos site.'),
('2026-10-01', 'month', 'working on a spring redesign for canberra.events.'),
('2026-10-03', 'day', 'redesigning this site. you''re reading a draft.');
```

- [ ] **Step 3: Apply locally and verify**

Run: `bun run db:migrate:local && bunx wrangler d1 execute curiousgeorge-logbook --local --persist-to .wrangler/state --command "SELECT section, count(*) AS n FROM items GROUP BY section"`
Expected: migrations `0001_schema.sql` and `0002_seed.sql` show ✅; the query prints `before 6` and `now 5`. (Read-only `execute --command` is fine; only migrations must go through `migrations apply`.)

- [ ] **Step 4: Commit**

```bash
git add migrations
git commit -m "feat(db): logbook schema and seed content"
```

---

### Task 3: Text and time helpers

**Files:**
- Create: `src/lib/text.ts`, `src/lib/time.ts`
- Test: `tests/unit/text.test.ts`, `tests/unit/time.test.ts`

**Interfaces:**
- Produces:
  - `type Inline = { kind: "text"; value: string } | { kind: "link"; text: string; href: string }`
  - `parseInline(source: string): Inline[]` (links only for `https:` and `mailto:`)
  - `primaryName(source: string): string` (first link text, else the plain text)
  - `formatLogDate(iso: string, precision: "day" | "month"): string` (`"03.10.26"` or `"oct 26"`)
  - `sideFor(index: number): string` (`0 → "a1"` … `5 → "c2"`)
  - `sydneyTime(now: Date): string` (`"3:17 pm"`)

- [ ] **Step 1: Write the failing tests**

`tests/unit/text.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { formatLogDate, parseInline, primaryName, sideFor } from "../../src/lib/text";

describe("parseInline", () => {
  test("plain text stays one text part", () => {
    expect(parseInline("finance and policy")).toEqual([{ kind: "text", value: "finance and policy" }]);
  });
  test("links become link parts around text", () => {
    expect(parseInline("growing [digital nachos](https://digitalnachos.com.au) today")).toEqual([
      { kind: "text", value: "growing " },
      { kind: "link", text: "digital nachos", href: "https://digitalnachos.com.au" },
      { kind: "text", value: " today" },
    ]);
  });
  test("two links in one line", () => {
    const parts = parseInline("helping [r4r](https://runningforresilience.com) and [with-me](https://www.with-me.co/) grow");
    expect(parts.filter((p) => p.kind === "link")).toHaveLength(2);
  });
  test("mailto links are allowed", () => {
    expect(parseInline("[say hi](mailto:hello@curiousgeorge.dev)")).toEqual([
      { kind: "link", text: "say hi", href: "mailto:hello@curiousgeorge.dev" },
    ]);
  });
  test("unsafe or non-https links stay as literal text", () => {
    for (const source of ["[x](javascript:alert(1))", "[x](http://example.com)", "[x](data:text/html,hi)"]) {
      expect(parseInline(source)).toEqual([{ kind: "text", value: source }]);
    }
  });
  test("markup characters are left for the renderer to escape", () => {
    expect(parseInline("<b>bold</b> & co")).toEqual([{ kind: "text", value: "<b>bold</b> & co" }]);
  });
});

test("primaryName prefers the first link text", () => {
  expect(primaryName("building [canberra.events](https://canberra.events)")).toBe("canberra.events");
  expect(primaryName("finance and policy")).toBe("finance and policy");
});

test("formatLogDate", () => {
  expect(formatLogDate("2026-10-03", "day")).toBe("03.10.26");
  expect(formatLogDate("2026-10-01", "month")).toBe("oct 26");
  expect(formatLogDate("2026-03-01", "month")).toBe("mar 26");
});

test("sideFor walks a1 to c2", () => {
  expect([0, 1, 2, 3, 4, 5].map(sideFor)).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
});
```

`tests/unit/time.test.ts`:

```ts
import { expect, test } from "vitest";
import { sydneyTime } from "../../src/lib/time";

test("formats Sydney time in lowercase with a non-breaking space", () => {
  // 05:17 UTC on 3 Oct 2026 is 3:17 pm AEST (daylight saving starts on 4 Oct 2026)
  expect(sydneyTime(new Date("2026-10-03T05:17:00Z"))).toBe("3:17 pm");
  expect(sydneyTime(new Date("2026-10-02T23:05:00Z"))).toBe("9:05 am");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test:unit`
Expected: FAIL, `Cannot find module '../../src/lib/text'` and `'../../src/lib/time'`.

- [ ] **Step 3: Implement `src/lib/text.ts`**

```ts
export type Inline = { kind: "text"; value: string } | { kind: "link"; text: string; href: string };

// Only https: and mailto: links are recognised; anything else stays literal text.
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;

export function parseInline(source: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", value: source.slice(last, start) });
    parts.push({ kind: "link", text: match[1], href: match[2] });
    last = start + match[0].length;
  }
  if (last < source.length) parts.push({ kind: "text", value: source.slice(last) });
  return parts;
}

export function primaryName(source: string): string {
  const parts = parseInline(source);
  const link = parts.find((p) => p.kind === "link");
  if (link && link.kind === "link") return link.text;
  return parts.map((p) => (p.kind === "text" ? p.value : p.text)).join("");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function formatLogDate(iso: string, precision: "day" | "month"): string {
  const [year, month, day] = iso.split("-");
  const yy = year.slice(2);
  return precision === "day" ? `${day}.${month}.${yy}` : `${MONTHS[Number(month) - 1]} ${yy}`;
}

export function sideFor(index: number): string {
  return `${"abc"[Math.floor(index / 2)]}${(index % 2) + 1}`;
}
```

- [ ] **Step 4: Implement `src/lib/time.ts`**

```ts
const SYDNEY = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" });

export function sydneyTime(now: Date): string {
  return SYDNEY.format(now).replace(/\s?(am|pm)$/i, (_match, period: string) => ` ${period.toLowerCase()}`);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: PASS (all tests in `text.test.ts` and `time.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/lib tests/unit
git commit -m "feat: inline link parsing, log dates, record sides and Sydney time"
```

---

### Task 4: Logbook loader

**Files:**
- Create: `src/lib/logbook.ts`
- Test: `tests/unit/logbook.test.ts`

**Interfaces:**
- Consumes: `sideFor` from `src/lib/text.ts`.
- Produces:
  - Types `Label`, `Item`, `Fact`, `LogEntry`, `Track`, `Logbook` (fields exactly as below)
  - `LOG_LIMIT = 50`, `RECORD_LIMIT = 6`
  - `loadLogbook(db: D1Database): Promise<Logbook>` (one `db.batch`)
  - `loadLogbookSafely(db: D1Database): Promise<Logbook | null>` (null on any failure, logged)

- [ ] **Step 1: Write the failing test `tests/unit/logbook.test.ts`**

```ts
import { describe, expect, test, vi } from "vitest";
import { loadLogbook, loadLogbookSafely } from "../../src/lib/logbook";

function fakeDb(results: unknown[][], fail = false) {
  const statement = { bind: () => statement };
  const db = {
    prepare: vi.fn(() => statement),
    batch: vi.fn(async () => {
      if (fail) throw new Error("D1 unavailable");
      return results.map((rows) => ({ results: rows }));
    }),
  };
  return db as unknown as D1Database & { batch: ReturnType<typeof vi.fn> };
}

const itemRows = [
  { slug: "onestack", section: "before", text: "founded [onestack.cloud](https://onestack.cloud)", aside: null, label_era: "founder", label_status: "retired", label_made_of: "tools", label_text: "early.", label_kind: null, label_note: null, snapshot_key: null },
  { slug: "good-people", section: "now", text: "looking for good people", aside: null, label_era: null, label_status: null, label_made_of: null, label_text: null, label_kind: null, label_note: null, snapshot_key: null },
];

describe("loadLogbook", () => {
  test("reads everything in one batch and maps rows", async () => {
    const db = fakeDb([
      itemRows,
      [{ key: "shelf", title: "the scout mindset", subtitle: "julia galef" }],
      [{ id: 5, date: "2026-10-03", precision: "day", text: "redesigning." }],
      [{ id: 9, title: "simple things", artist: "loom room", audio_key: "audio/a.mp3", cover_key: "covers/a.webp" }],
    ]);
    const data = await loadLogbook(db);
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(data.now).toEqual([{ slug: "good-people", section: "now", text: "looking for good people", aside: null, label: null }]);
    expect(data.before[0].label).toEqual({ era: "founder", status: "retired", madeOf: "tools", text: "early.", kind: null, note: null, snapshotKey: null });
    expect(data.facts).toEqual([{ key: "shelf", title: "the scout mindset", subtitle: "julia galef" }]);
    expect(data.log).toEqual([{ id: 5, date: "2026-10-03", precision: "day", text: "redesigning." }]);
    expect(data.records).toEqual([{ id: 9, title: "simple things", artist: "loom room", audioKey: "audio/a.mp3", coverKey: "covers/a.webp", side: "a1" }]);
  });
});

describe("loadLogbookSafely", () => {
  test("returns null instead of throwing when D1 fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadLogbookSafely(fakeDb([], true))).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:unit -- tests/unit/logbook.test.ts`
Expected: FAIL, `Cannot find module '../../src/lib/logbook'`.

- [ ] **Step 3: Implement `src/lib/logbook.ts`**

```ts
import { sideFor } from "./text";

export type Section = "now" | "before";

export interface Label {
  era: string;
  status: "live" | "retired";
  madeOf: string | null;
  text: string | null;
  kind: "decision" | "lesson" | null;
  note: string | null;
  snapshotKey: string | null;
}

export interface Item {
  slug: string;
  section: Section;
  text: string;
  aside: string | null;
  label: Label | null;
}

export interface Fact {
  key: "shelf" | "kettle";
  title: string;
  subtitle: string | null;
}

export interface LogEntry {
  id: number;
  date: string;
  precision: "day" | "month";
  text: string;
}

export interface Track {
  id: number;
  title: string;
  artist: string;
  audioKey: string;
  coverKey: string;
  side: string;
}

export interface Logbook {
  now: Item[];
  before: Item[];
  facts: Fact[];
  log: LogEntry[];
  records: Track[];
}

export const LOG_LIMIT = 50;
export const RECORD_LIMIT = 6;

interface ItemRow {
  slug: string;
  section: Section;
  text: string;
  aside: string | null;
  label_era: string | null;
  label_status: "live" | "retired" | null;
  label_made_of: string | null;
  label_text: string | null;
  label_kind: "decision" | "lesson" | null;
  label_note: string | null;
  snapshot_key: string | null;
}

interface RecordRow {
  id: number;
  title: string;
  artist: string;
  audio_key: string;
  cover_key: string;
}

function toItem(row: ItemRow): Item {
  return {
    slug: row.slug,
    section: row.section,
    text: row.text,
    aside: row.aside,
    label: row.label_status
      ? {
          era: row.label_era ?? "",
          status: row.label_status,
          madeOf: row.label_made_of,
          text: row.label_text,
          kind: row.label_kind,
          note: row.label_note,
          snapshotKey: row.snapshot_key,
        }
      : null,
  };
}

export async function loadLogbook(db: D1Database): Promise<Logbook> {
  const [items, facts, log, records] = await db.batch([
    db.prepare(
      "SELECT slug, section, text, aside, label_era, label_status, label_made_of, label_text, label_kind, label_note, snapshot_key FROM items ORDER BY section, position",
    ),
    db.prepare("SELECT key, title, subtitle FROM facts ORDER BY CASE key WHEN 'shelf' THEN 0 ELSE 1 END"),
    db.prepare("SELECT id, date, precision, text FROM log_entries ORDER BY date DESC, created_at DESC, id DESC LIMIT ?").bind(LOG_LIMIT),
    db.prepare("SELECT id, title, artist, audio_key, cover_key FROM records WHERE active = 1 ORDER BY position LIMIT ?").bind(RECORD_LIMIT),
  ]);
  const all = (items.results as unknown as ItemRow[]).map(toItem);
  return {
    now: all.filter((item) => item.section === "now"),
    before: all.filter((item) => item.section === "before"),
    facts: facts.results as unknown as Fact[],
    log: log.results as unknown as LogEntry[],
    records: (records.results as unknown as RecordRow[]).map((row, index) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      audioKey: row.audio_key,
      coverKey: row.cover_key,
      side: sideFor(index),
    })),
  };
}

export async function loadLogbookSafely(db: D1Database): Promise<Logbook | null> {
  try {
    return await loadLogbook(db);
  } catch (error) {
    console.error("logbook: D1 read failed, rendering static sections only", error);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logbook.ts tests/unit/logbook.test.ts
git commit -m "feat: load the logbook from D1 in one batch, with a safe fallback"
```

---

### Task 5: Layout, tokens, fonts and head metadata

**Files:**
- Create: `scripts/build-fonts.mjs`, `public/fonts/schibsted-grotesk.woff2`, `public/fonts/dm-mono.woff2` (generated), `src/styles/notebook.css`, `src/layouts/Notebook.astro`, `public/robots.txt`
- Move: `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png` → `public/`
- Modify: `public/site.webmanifest` (rewrite)
- Test: `tests/e2e/head.spec.ts`

**Interfaces:**
- Produces: `Notebook.astro` layout with props `{ title?: string; description?: string }` and a default slot; global class names used by later tasks: `.book`, `.row`, `.head`, `.label`, `.body`, `.now-dot`, `.mono`, `.intro`, `.where`, `.clock`, `.aside`, `.lines`, `.line-item`, `.labelled`, `.line`, `.peek`, `.plus`, `.drawer`, `.drawer-inner`, `.tag`, `.status`, `.live`, `.made`, `.text`, `.decision`, `.facts`, `.fact`, `.k`, `.v`, `.log`, `.d`, `.older`, `.older-inner`, `.more`, `.chev`, `.lbl`, `.empty`, `.links`, `.visitor`, `.signoff`, `.open`.

- [ ] **Step 1: Write the failing test `tests/e2e/head.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("head carries metadata, preloads two self-hosted fonts and nothing third-party", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => { if (request.resourceType() === "font") fontRequests.push(request.url()); });
  await page.goto("/");
  await expect(page).toHaveTitle("george vlachos");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /does the hard part/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://curiousgeorge.dev/");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f3f2ec");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://curiousgeorge.dev/og.png");
  await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  expect(fontRequests.sort()).toEqual([
    "http://localhost:4331/fonts/dm-mono.woff2",
    "http://localhost:4331/fonts/schibsted-grotesk.woff2",
  ]);
});

test("static files are served", async ({ request }) => {
  expect((await request.get("/robots.txt")).status()).toBe(200);
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /admin");
  expect((await request.get("/favicon-32x32.png")).status()).toBe(200);
  const manifest = await (await request.get("/site.webmanifest")).json();
  expect(manifest.theme_color).toBe("#f3f2ec");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run build && bun run test:e2e -- tests/e2e/head.spec.ts --project=chromium`
Expected: FAIL on the title/description assertions.

- [ ] **Step 3: Write `scripts/build-fonts.mjs` and generate the fonts**

```js
// Subsets the two self-hosted fonts to the characters this site can render.
// Covers all of Latin-1 rather than only today's copy, because text typed in /admin
// (names like "Lépi") must not fall back to Arial. Run after adding new symbols: bun run fonts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import subsetFont from "subset-font";

const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const latin1 = Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).join("");
const extras = "‹›·–—‘’“”…×";
const text = ascii + latin1 + extras;

const fonts = [
  {
    from: "node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
    to: "public/fonts/schibsted-grotesk.woff2",
    options: { variationAxes: { wght: { min: 400, max: 500 } } },
  },
  { from: "node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2", to: "public/fonts/dm-mono.woff2", options: {} },
];

await mkdir("public/fonts", { recursive: true });
let total = 0;
for (const font of fonts) {
  const out = await subsetFont(await readFile(font.from), text, { targetFormat: "woff2", ...font.options });
  await writeFile(font.to, out);
  total += out.length;
  console.log(`${font.to}: ${out.length} bytes`);
}
console.log(`total: ${total} bytes`);
if (total > 60_000) throw new Error("fonts exceed the 60KB budget");
```

Run: `bun run fonts`
Expected: two files written, `total` under 60000 bytes.

- [ ] **Step 4: Move the favicons and rewrite the manifest and robots**

```bash
git mv favicon.ico favicon-16x16.png favicon-32x32.png apple-touch-icon.png android-chrome-192x192.png android-chrome-512x512.png public/
```

`public/site.webmanifest`:

```json
{
  "name": "george vlachos",
  "short_name": "george",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#f3f2ec",
  "background_color": "#f3f2ec",
  "display": "browser"
}
```

`public/robots.txt`:

```
User-agent: *
Disallow: /admin
```

- [ ] **Step 5: Write `src/styles/notebook.css`**

Ported from `docs/prototypes/2026-10-03-logbook/logbook.html`, with `--muted` darkened for contrast and the fallback metrics from Capsize.

```css
@font-face { font-family: "Schibsted Grotesk"; src: url("/fonts/schibsted-grotesk.woff2") format("woff2"); font-weight: 400 500; font-style: normal; font-display: swap; }
@font-face { font-family: "DM Mono"; src: url("/fonts/dm-mono.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
/* Metric-matched fallbacks (Capsize) so the swap to the web fonts does not move text */
@font-face { font-family: "Schibsted Grotesk Fallback"; src: local("Arial"), local("ArialMT"); ascent-override: 93.4593%; descent-override: 24.6733%; line-gap-override: 0%; size-adjust: 104.4907%; }
@font-face { font-family: "DM Mono Fallback"; src: local("Courier New"), local("CourierNewPSMT"); ascent-override: 99.2161%; descent-override: 31.005%; size-adjust: 99.9837%; }

:root {
  --paper: #f3f2ec;
  --ink: #1f201c;
  --muted: #6b6b63;
  --faint: #b4b3aa;
  --rule: #dddcd3;
  --red: #c94a31;
  --mat: #fbfbf8;
  --dot: rgba(31, 32, 28, .075);
  --sans: "Schibsted Grotesk", "Schibsted Grotesk Fallback", Arial, sans-serif;
  --mono: "DM Mono", "DM Mono Fallback", "Courier New", monospace;
  --ease-out: cubic-bezier(.215, .61, .355, 1);
  --ease-out-quint: cubic-bezier(.23, 1, .32, 1);
  --label-w: 150px;
  --gap: 40px;
  color-scheme: light;
}

*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; background: var(--paper); }
body {
  font-family: var(--sans); font-size: 17px; line-height: 1.55; color: var(--ink);
  background-color: var(--paper);
  background-image: radial-gradient(var(--dot) 1px, transparent 1.4px);
  background-size: 24px 24px;
  -webkit-font-smoothing: antialiased;
}
::selection { background: #f0d7cf; }
ul, ol { list-style: none; }
button { font: inherit; color: inherit; }
.mono { font-family: var(--mono); }

a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; text-decoration-color: var(--faint); }
@media (hover: hover) and (pointer: fine) {
  a { transition: text-decoration-color 200ms ease; }
  a:hover { text-decoration-color: var(--red); }
}
a:focus-visible, button:focus-visible { outline: 1.5px solid var(--ink); outline-offset: 3px; border-radius: 3px; }

/* The notebook: labels in the margin, content right of the red rule */
.book { max-width: 940px; margin: 0 auto; padding: clamp(56px, 12vh, 128px) 24px 120px; }
.row { display: grid; grid-template-columns: var(--label-w) 1fr; }
.row > .label {
  font: 400 12.5px/1.55 var(--mono); color: var(--muted); letter-spacing: .01em;
  text-align: right; padding: 28px var(--gap) 0 0;
  display: flex; justify-content: flex-end; align-items: baseline; gap: 8px;
}
.row > .body {
  border-left: 1px solid color-mix(in oklab, var(--red) 62%, transparent);
  padding: 24px 0 20px var(--gap); min-width: 0; overflow-wrap: anywhere;
}
.row.head > .body { padding-top: 0; padding-bottom: 36px; }
.row.head > .label { padding-top: 14px; }
.now-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--red); transform: translateY(-1px); }

h1 { font-size: clamp(30px, 4.4vw, 40px); font-weight: 500; letter-spacing: -.018em; line-height: 1.1; }
.intro { margin-top: 14px; max-width: 30rem; color: #3a3b36; font-size: 18px; }
.where { margin-top: 18px; font: 12.5px/1.55 var(--mono); color: var(--muted); }
.clock { display: inline-block; min-width: 8ch; font-variant-numeric: tabular-nums; }
.aside { color: var(--muted); }

/* Now and before lines, with wall labels */
.lines > li { padding: 3px 0; }
.line-item.labelled > .line { cursor: pointer; }
.peek {
  margin-left: 10px; vertical-align: 1px; font: 11.5px/1 var(--mono); color: var(--muted); cursor: pointer;
  background: rgba(251, 251, 248, .6); border: 1px solid var(--rule); border-radius: 999px; padding: 4px 9px 4px 8px;
  display: inline-flex; align-items: center; gap: 6px;
}
.peek .plus { width: 9px; height: 9px; position: relative; display: inline-block; transition: transform 220ms var(--ease-out); }
.peek .plus::before, .peek .plus::after { content: ""; position: absolute; background: currentColor; }
.peek .plus::before { left: 0; right: 0; top: 4px; height: 1px; }
.peek .plus::after { top: 0; bottom: 0; left: 4px; width: 1px; }
.line-item.open .peek { color: var(--ink); }
.line-item.open .peek .plus { transform: rotate(45deg); }
.peek:active { background: #ebe8df; }
@media (hover: hover) and (pointer: fine) {
  .peek { transition: color 200ms ease, border-color 200ms ease, background-color 200ms ease; }
  .line-item.labelled > .line:hover .peek { color: var(--ink); border-color: color-mix(in oklab, var(--ink) 55%, transparent); background: var(--mat); }
}
.drawer { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 300ms var(--ease-out-quint); }
.drawer > .drawer-inner { overflow: hidden; }
.line-item.open > .drawer { grid-template-rows: 1fr; }
.tag { padding: 14px 0 20px; font-size: 14.5px; line-height: 1.5; max-width: 30rem; }
.tag .status { font: 11.5px/1.5 var(--mono); color: var(--muted); display: flex; align-items: center; gap: 7px; }
.tag .live { width: 7px; height: 7px; border-radius: 50%; background: var(--red); display: inline-block; }
.tag .made { margin-top: 4px; color: var(--muted); }
.tag .text { margin-top: 10px; }
.tag .decision { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--rule); }
.tag .decision span { font: 11.5px/1.5 var(--mono); color: var(--muted); display: block; margin-bottom: 2px; }

/* Lately */
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.fact { padding: 14px 18px 16px 0; }
.fact + .fact { padding-left: 18px; border-left: 1px solid var(--rule); }
.fact .k { font: 11.5px/1.5 var(--mono); color: var(--muted); }
.fact .v { margin-top: 6px; font-size: 15.5px; line-height: 1.4; }
.fact .v small { display: block; color: var(--muted); font-size: 14px; }

/* Log */
.log li { display: grid; grid-template-columns: 92px 1fr; gap: 16px; padding: 7px 0; border-bottom: 1px solid var(--rule); }
.log > ul > li:first-child { border-top: 1px solid var(--rule); }
.log .d { font: 12.5px/1.55 var(--mono); color: var(--muted); padding-top: 3px; font-variant-numeric: tabular-nums; }
.log .older { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 280ms var(--ease-out); }
.log .older > .older-inner { overflow: hidden; }
.log.open .older { grid-template-rows: 1fr; }
.more { margin-top: 12px; font: 12.5px/1.55 var(--mono); color: var(--muted); background: none; border: 0; cursor: pointer; padding: 4px 0; display: inline-flex; gap: 8px; align-items: center; }
/* Drawn chevron: DM Mono has no arrow glyphs */
.more .chev { width: 6px; height: 6px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: translateY(-2px) rotate(45deg); transition: transform 220ms var(--ease-out); }
.log.open .more .chev { transform: translateY(1px) rotate(-135deg); }
@media (hover: hover) and (pointer: fine) {
  .more { transition: color 200ms ease; }
  .more:hover { color: var(--ink); }
}

/* Turntable empty state, say hi, visitor info */
.empty { color: var(--muted); }
.links { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.visitor { display: grid; grid-template-columns: 96px 1fr; font-size: 14.5px; border-top: 1px solid var(--rule); max-width: 30rem; }
.visitor dt, .visitor dd { padding: 7px 0; border-bottom: 1px solid var(--rule); }
.visitor dt { font: 12px/1.5 var(--mono); color: var(--muted); padding-top: 9px; }
.signoff { margin-top: 18px; font-size: 14px; color: var(--muted); }
.home { margin-top: 10px; }

@media (max-width: 680px) {
  :root { --label-w: 0px; --gap: 18px; }
  .row { grid-template-columns: 1fr; }
  .row > .label {
    text-align: left; justify-content: flex-start; padding: 22px 0 0 calc(var(--gap) + 1px);
    border-left: 1px solid color-mix(in oklab, var(--red) 62%, transparent);
  }
  .row > .body { padding-top: 8px; }
  .row.head > .label { display: none; }
  .facts { grid-template-columns: 1fr; }
  .fact + .fact { padding-left: 0; border-left: 0; border-top: 1px solid var(--rule); }
  .log li { grid-template-columns: 76px 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .drawer, .log .older, .peek .plus, .more .chev { transition: none; }
}
```

- [ ] **Step 6: Write `src/layouts/Notebook.astro`**

```astro
---
import "../styles/notebook.css";

interface Props {
  title?: string;
  description?: string;
  /** For pages that should not be indexed (the 404): no canonical, robots noindex */
  noindex?: boolean;
}

const {
  title = "george vlachos",
  description = "i build software that does the hard part, so people can get back to the human part.",
  noindex = false,
} = Astro.props;
const canonical = new URL(Astro.url.pathname, "https://curiousgeorge.dev").href;
---
<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    {noindex ? <meta name="robots" content="noindex" /> : <link rel="canonical" href={canonical} />}
    <meta name="theme-color" content="#f3f2ec" />
    <meta name="color-scheme" content="light" />
    <link rel="preload" href="/fonts/schibsted-grotesk.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/dm-mono.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content="https://curiousgeorge.dev/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 7: Use the layout in `src/pages/index.astro`**

```astro
---
import Notebook from "../layouts/Notebook.astro";
---
<Notebook>
  <main class="book"><h1>george vlachos</h1></main>
</Notebook>
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run typecheck && bun run build && bun run test:e2e -- tests/e2e/head.spec.ts tests/e2e/smoke.spec.ts`
Expected: PASS in all projects.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: notebook layout, tokens, self-hosted fonts, favicons and metadata"
```

---

### Task 6: The logbook page from D1

**Files:**
- Create: `src/components/Row.astro`, `src/components/Inline.astro`, `src/components/Intro.astro`, `src/components/Lately.astro`, `src/components/Log.astro`, `src/components/Turntable.astro`, `src/components/SayHi.astro`, `src/components/VisitorInfo.astro`, `src/components/ItemLines.astro` (plain lines; labels added in Task 7), `src/components/Logbook.astro`, `src/scripts/clock.ts`
- Modify: `src/pages/index.astro`
- Test: `tests/unit/render.ts`, `tests/unit/logbook-page.test.ts`, `tests/e2e/logbook.spec.ts`, `tests/e2e/layout.spec.ts`, `tests/e2e/degraded.spec.ts`

**Interfaces:**
- Consumes: `Logbook`, `Item`, `Fact`, `LogEntry`, `Track`, `loadLogbookSafely` (Task 4); `parseInline`, `formatLogDate` (Task 3); `sydneyTime` (Task 3); `Notebook.astro` (Task 5).
- Produces: `Logbook.astro` with props `{ data: Logbook | null }`; `Row.astro` with props `{ label: string; id?: string; now?: boolean; head?: boolean }`; `ItemLines.astro` with props `{ items: Item[] }`; `Log.astro` with props `{ entries: LogEntry[] }` rendering `.log` (toggle markup added in Task 8); `Turntable.astro` with props `{ records: Track[] }`. Rows carry ids `now`, `lately`, `log`, `turntable`, `before`, `say-hi`, `visitor-info`.

- [ ] **Step 1: Write the render helper `tests/unit/render.ts`**

```ts
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";

// Renders an Astro component to a DOM for querying (the dev renderer adds source attributes,
// so tests query elements rather than matching raw strings).
export async function render(component: Parameters<AstroContainer["renderToString"]>[0], props: Record<string, unknown>) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(component, { props });
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

export const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
```

- [ ] **Step 2: Write the failing component tests `tests/unit/logbook-page.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import Logbook from "../../src/components/Logbook.astro";
import type { Logbook as Data } from "../../src/lib/logbook";
import { render, text } from "./render";

const full: Data = {
  now: [{ slug: "good-people", section: "now", text: "looking for <good> people & [friends](https://example.com)", aside: "always", label: null }],
  before: [{ slug: "kpmg", section: "before", text: "management consulting at kpmg", aside: null, label: null }],
  facts: [
    { key: "shelf", title: "the scout mindset", subtitle: "julia galef" },
    { key: "kettle", title: "fellow stagg", subtitle: "slightly hacked" },
  ],
  log: [
    { id: 1, date: "2026-10-03", precision: "day", text: "one." },
    { id: 2, date: "2026-10-01", precision: "month", text: "two." },
  ],
  records: [],
};

const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map((el) => text(el));

describe("Logbook", () => {
  test("renders every section in order", async () => {
    const doc = await render(Logbook, { data: full });
    expect(labels(doc)).toEqual(["logbook of", "now", "lately", "log", "on the turntable", "before", "say hi", "visitor info"]);
    expect(text(doc.querySelector("h1"))).toBe("george vlachos");
    expect(text(doc.querySelector(".where"))).toContain("· last entry 03.10.26");
  });

  test("escapes markup in item text and only links https", async () => {
    const doc = await render(Logbook, { data: full });
    const line = doc.querySelector("#now .line")!;
    expect(line.querySelector("good")).toBeNull();
    expect(text(line)).toContain("looking for <good> people &");
    expect(line.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(text(line.querySelector(".aside"))).toBe("- always");
  });

  test("unsafe links render as text, never as links", async () => {
    const doc = await render(Logbook, { data: { ...full, now: [{ ...full.now[0], text: "[x](javascript:alert(1)) and [y](http://example.com)" }] } });
    expect(doc.querySelector("#now a")).toBeNull();
    expect(text(doc.querySelector("#now .line"))).toContain("[x](javascript:alert(1)) and [y](http://example.com)");
  });

  test("shows the turntable empty state when there are no records", async () => {
    const doc = await render(Logbook, { data: full });
    expect(text(doc.querySelector("#turntable .empty"))).toBe("nothing on the turntable right now.");
  });

  test("omits rows with no data and the last-entry note", async () => {
    const doc = await render(Logbook, { data: { now: [], before: [], facts: [], log: [], records: [] } });
    expect(labels(doc)).toEqual(["logbook of", "on the turntable", "say hi", "visitor info"]);
    expect(text(doc.querySelector(".where"))).not.toContain("last entry");
  });

  test("renders only the static sections when D1 is unavailable", async () => {
    const doc = await render(Logbook, { data: null });
    expect(labels(doc)).toEqual(["logbook of", "say hi", "visitor info"]);
  });

  test("visitor info says exactly what is collected", async () => {
    const doc = await render(Logbook, { data: null });
    const pairs = [...doc.querySelectorAll("#visitor-info dt")].map((dt) => [text(dt), text(dt.nextElementSibling)]);
    expect(pairs).toEqual([
      ["open", "whenever you are"],
      ["entry", "free"],
      ["cookies", "none. nothing to accept."],
      ["analytics", "anonymous counts of visits and clicks, no cookies"],
      ["based", "sydney and canberra"],
    ]);
    expect(text(doc.querySelector("#visitor-info .signoff"))).toBe("fewer tabs, more arvos.");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run test:unit -- tests/unit/logbook-page.test.ts`
Expected: FAIL, cannot resolve `../../src/components/Logbook.astro`.

- [ ] **Step 4: Write the components**

`src/components/Row.astro`:

```astro
---
interface Props {
  label: string;
  id?: string;
  now?: boolean;
  head?: boolean;
}
const { label, id, now = false, head = false } = Astro.props;
const labelId = id ? `${id}-label` : undefined;
---
<section class:list={["row", { head }]} id={id} aria-labelledby={labelId}>
  {head ? (
    <p class="label">{label}</p>
  ) : (
    <h2 class="label" id={labelId}>{now && <span class="now-dot" aria-hidden="true"></span>}{label}</h2>
  )}
  <div class="body"><slot /></div>
</section>
```

`src/components/Inline.astro`:

```astro
---
import { parseInline } from "../lib/text";
interface Props {
  source: string;
}
const parts = parseInline(Astro.props.source);
---
{parts.map((part) => (part.kind === "text" ? part.value : <a href={part.href}>{part.text}</a>))}
```

`src/components/Intro.astro`:

```astro
---
import { formatLogDate } from "../lib/text";
import type { LogEntry } from "../lib/logbook";
interface Props {
  lastEntry: LogEntry | null;
}
const { lastEntry } = Astro.props;
---
<h1>george vlachos</h1>
<p class="intro">i build software that does the hard part, so people can get back to the human part.</p>
<p class="where">
  sydney · <span class="clock" data-sydney-time>–</span>{lastEntry && <> · last entry {formatLogDate(lastEntry.date, lastEntry.precision)}</>}
</p>
<script>
  import "../scripts/clock";
</script>
```

`src/scripts/clock.ts`:

```ts
import { sydneyTime } from "../lib/time";

function tick() {
  const value = sydneyTime(new Date());
  document.querySelectorAll<HTMLElement>("[data-sydney-time]").forEach((el) => { el.textContent = value; });
}

tick();
setInterval(tick, 30_000);
```

`src/components/ItemLines.astro` (labels are added in Task 7):

```astro
---
import Inline from "./Inline.astro";
import type { Item } from "../lib/logbook";
interface Props {
  items: Item[];
}
const { items } = Astro.props;
---
<ul class="lines">
  {items.map((item) => (
    <li class="line-item" data-slug={item.slug}>
      <div class="line">
        <Inline source={item.text} />{item.aside && <span class="aside"> - {item.aside}</span>}
      </div>
    </li>
  ))}
</ul>
```

`src/components/Lately.astro`:

```astro
---
import type { Fact } from "../lib/logbook";
interface Props {
  facts: Fact[];
}
const names = { shelf: "on the shelf", kettle: "in the kettle" } as const;
const { facts } = Astro.props;
---
<div class="facts">
  {facts.map((fact) => (
    <div class="fact">
      <div class="k">{names[fact.key]}</div>
      <div class="v">{fact.title}{fact.subtitle && <small>{fact.subtitle}</small>}</div>
    </div>
  ))}
</div>
```

`src/components/Log.astro` (the toggle is added in Task 8):

```astro
---
import { formatLogDate } from "../lib/text";
import type { LogEntry } from "../lib/logbook";
interface Props {
  entries: LogEntry[];
}
const { entries } = Astro.props;
---
<div class="log">
  <ul>
    {entries.map((entry) => (
      <li><time class="d" datetime={entry.precision === "month" ? entry.date.slice(0, 7) : entry.date}>{formatLogDate(entry.date, entry.precision)}</time><span>{entry.text}</span></li>
    ))}
  </ul>
</div>
```

`src/components/Turntable.astro` (plan 2 replaces this with the listening corner):

```astro
---
import type { Track } from "../lib/logbook";
interface Props {
  records: Track[];
}
const { records } = Astro.props;
---
{records.length === 0 && <p class="empty">nothing on the turntable right now.</p>}
```

`src/components/SayHi.astro`:

```astro
<div class="links">
  <a href="mailto:hello@curiousgeorge.dev">hello@curiousgeorge.dev</a>
  <a href="https://www.linkedin.com/in/george-vl/">linkedin</a>
  <a href="https://t.me/imcuriousgeorge">telegram</a>
  <a href="https://www.instagram.com/curious.georgios/">instagram</a>
</div>
```

`src/components/VisitorInfo.astro`:

```astro
<dl class="visitor">
  <dt>open</dt><dd>whenever you are</dd>
  <dt>entry</dt><dd>free</dd>
  <dt>cookies</dt><dd>none. nothing to accept.</dd>
  <dt>analytics</dt><dd>anonymous counts of visits and clicks, no cookies</dd>
  <dt>based</dt><dd>sydney and canberra</dd>
</dl>
<p class="signoff">fewer tabs, more arvos.</p>
```

`src/components/Logbook.astro`:

```astro
---
import Row from "./Row.astro";
import Intro from "./Intro.astro";
import ItemLines from "./ItemLines.astro";
import Lately from "./Lately.astro";
import Log from "./Log.astro";
import Turntable from "./Turntable.astro";
import SayHi from "./SayHi.astro";
import VisitorInfo from "./VisitorInfo.astro";
import type { Logbook } from "../lib/logbook";
interface Props {
  data: Logbook | null;
}
const { data } = Astro.props;
---
<main class="book">
  <Row label="logbook of" head><Intro lastEntry={data?.log[0] ?? null} /></Row>
  {data && data.now.length > 0 && <Row label="now" id="now" now><ItemLines items={data.now} /></Row>}
  {data && data.facts.length > 0 && <Row label="lately" id="lately"><Lately facts={data.facts} /></Row>}
  {data && data.log.length > 0 && <Row label="log" id="log"><Log entries={data.log} /></Row>}
  {data && <Row label="on the turntable" id="turntable"><Turntable records={data.records} /></Row>}
  {data && data.before.length > 0 && <Row label="before" id="before"><ItemLines items={data.before} /></Row>}
  <Row label="say hi" id="say-hi"><SayHi /></Row>
  <Row label="visitor info" id="visitor-info"><VisitorInfo /></Row>
</main>
```

- [ ] **Step 5: Wire the page `src/pages/index.astro`**

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../layouts/Notebook.astro";
import Logbook from "../components/Logbook.astro";
import { loadLogbookSafely } from "../lib/logbook";

const data = await loadLogbookSafely(env.DB);
if (data) {
  // Fresh for five minutes at Cloudflare's edge, then served stale while it refreshes in the background.
  // Admin saves purge the tag globally (plan 3); deploys show within minutes.
  Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["logbook"] });
  Astro.response.headers.set("Cache-Control", "no-cache");
} else {
  // Never cache the degraded render
  Astro.response.headers.set("Cache-Control", "no-store");
}
---
<Notebook>
  <Logbook data={data} />
</Notebook>
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Write the e2e tests**

`tests/e2e/logbook.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("renders the seeded logbook", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".row > .label")).toHaveText(["logbook of", "now", "lately", "log", "on the turntable", "before", "say hi", "visitor info"]);
  await expect(page.locator("#now .line").first()).toContainText("growing digital nachos");
  await expect(page.locator("#now a", { hasText: "with-me" })).toHaveAttribute("href", "https://www.with-me.co/");
  await expect(page.locator("#lately .fact")).toHaveCount(2);
  await expect(page.locator("#turntable .empty")).toHaveText("nothing on the turntable right now.");
  await expect(page.locator(".where")).toContainText("last entry 03.10.26");
});

test("the Sydney clock fills in without shifting the line", async ({ page }) => {
  await page.goto("/");
  const clock = page.locator("[data-sydney-time]");
  await expect(clock).toHaveText(/^\d{1,2}:\d{2} (am|pm)$/);
  const width = await clock.evaluate((el) => el.getBoundingClientRect().width);
  const minWidth = await clock.evaluate((el) => parseFloat(getComputedStyle(el).minWidth));
  expect(width).toBeLessThanOrEqual(minWidth + 0.5);
});

test("caches the page at the edge with the logbook tag", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["cloudflare-cdn-cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
  expect(response.headers()["cache-tag"]).toContain("logbook");
  expect(response.headers()["cache-control"]).toBe("no-cache");
});
```

`tests/e2e/layout.spec.ts` (clock frozen; 375px and 1280px; long unbroken text):

```ts
import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`layout holds at ${width}px, even with long unbroken words`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-03T05:17:00Z"));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("[data-sydney-time]")).toHaveText("3:17 pm");
    await page.locator("#now .line").first().evaluate((el) => el.append(` ${"x".repeat(120)} https://example.com/${"a".repeat(120)}`));
    await page.locator("#log li span").first().evaluate((el) => el.append(` ${"y".repeat(120)}`));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const label = (await page.locator("#now > .label").boundingBox())!;
    const body = (await page.locator("#now > .body").boundingBox())!;
    if (width < 680) expect(label.y + label.height).toBeLessThanOrEqual(body.y + 1);
    else expect(label.x + label.width).toBeLessThanOrEqual(body.x + 1);
  });
}
```

`tests/e2e/degraded.spec.ts` (the second web server has an empty D1 store, so every read fails):

```ts
import { expect, test } from "@playwright/test";

test("when D1 fails the page still renders, uncached, with only the static sections", async ({ page }) => {
  const response = await page.goto("http://localhost:4332/");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["cache-tag"]).toBeUndefined();
  await expect(page.locator(".row > .label")).toHaveText(["logbook of", "say hi", "visitor info"]);
});
```

- [ ] **Step 8: Run the e2e tests to verify they pass**

Run: `bun run typecheck && bun run build && bun run test:e2e -- tests/e2e/logbook.spec.ts tests/e2e/layout.spec.ts tests/e2e/degraded.spec.ts`
Expected: 0 type errors; PASS in chromium, webkit and phone (the degraded spec runs in chromium and webkit).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: render the logbook from D1 with edge caching and a static fallback"
```

---

### Task 7: Wall labels (text only)

**Files:**
- Modify: `src/components/ItemLines.astro`
- Create: `src/scripts/labels.ts`
- Test: `tests/unit/labels.test.ts`, `tests/e2e/labels.spec.ts`

**Interfaces:**
- Consumes: `Item`, `Label` (Task 4); `primaryName` (Task 3).
- Produces: label markup per labelled item: `li.line-item.labelled[data-slug]` > `.line` (with `button.peek[aria-expanded][aria-controls="label-<slug>"]`) and `div.drawer#label-<slug>[hidden="until-found"]` > `.drawer-inner` > `.tag`. Plan 4 adds the snapshot frame inside `.drawer-inner` before `.tag`.

- [ ] **Step 1: Write the failing unit test `tests/unit/labels.test.ts`**

```ts
import { expect, test } from "vitest";
import ItemLines from "../../src/components/ItemLines.astro";
import type { Item } from "../../src/lib/logbook";
import { render, text } from "./render";

const items: Item[] = [
  {
    slug: "canberra-events", section: "now", text: "building [canberra.events](https://canberra.events)", aside: null,
    label: { era: "2025 to now", status: "live", madeOf: "a city calendar", text: "one calendar.", kind: "decision", note: "start with organisers.", snapshotKey: null },
  },
  {
    slug: "onestack", section: "before", text: "founded [onestack.cloud](https://onestack.cloud)", aside: null,
    label: { era: "founder", status: "retired", madeOf: null, text: null, kind: null, note: null, snapshotKey: null },
  },
  { slug: "kpmg", section: "before", text: "management consulting at kpmg", aside: null, label: null },
];

test("labelled lines get a named pill and a hidden-until-found drawer", async () => {
  const doc = await render(ItemLines, { items });
  const pill = doc.querySelector('[data-slug="canberra-events"] .peek')!;
  expect(pill.getAttribute("aria-label")).toBe("label for canberra.events");
  expect(pill.getAttribute("aria-expanded")).toBe("false");
  expect(pill.getAttribute("aria-controls")).toBe("label-canberra-events");
  const drawer = doc.querySelector("#label-canberra-events")!;
  expect(drawer.getAttribute("hidden")).toBe("until-found");
  expect(text(drawer.querySelector(".status"))).toBe("live and in use · 2025 to now");
  expect(text(drawer.querySelector(".made"))).toBe("made of a city calendar");
  expect(text(drawer.querySelector(".decision span"))).toBe("the decision");
  expect(drawer.querySelector(".decision")!.lastChild!.textContent).toBe("start with organisers.");
});

test("partial labels render only the fields they have", async () => {
  const doc = await render(ItemLines, { items });
  const drawer = doc.querySelector("#label-onestack")!;
  expect(text(drawer.querySelector(".status"))).toBe("retired · founder");
  expect(drawer.querySelector(".made")).toBeNull();
  expect(drawer.querySelector(".decision")).toBeNull();
});

test("a label without an era has no dangling separator", async () => {
  const doc = await render(ItemLines, { items: [{ ...items[1], slug: "no-era", label: { ...items[1].label!, era: "" } }] });
  expect(text(doc.querySelector("#label-no-era .status"))).toBe("retired");
});

test("lines without a label get no pill", async () => {
  const doc = await render(ItemLines, { items });
  expect(doc.querySelector('[data-slug="kpmg"] .peek')).toBeNull();
  expect(doc.querySelector('[data-slug="kpmg"]')!.classList.contains("labelled")).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:unit -- tests/unit/labels.test.ts`
Expected: FAIL (no `.peek` rendered yet).

- [ ] **Step 3: Rewrite `src/components/ItemLines.astro`**

```astro
---
import Inline from "./Inline.astro";
import { primaryName } from "../lib/text";
import type { Item } from "../lib/logbook";
interface Props {
  items: Item[];
}
const { items } = Astro.props;
---
<ul class="lines">
  {items.map((item) => (
    <li class:list={["line-item", { labelled: item.label }]} data-slug={item.slug}>
      <div class="line">
        <Inline source={item.text} />{item.aside && <span class="aside"> - {item.aside}</span>}
        {item.label && (
          <button
            class="peek"
            type="button"
            aria-expanded="false"
            aria-controls={`label-${item.slug}`}
            aria-label={`label for ${primaryName(item.text)}`}
          ><span class="plus" aria-hidden="true"></span>label</button>
        )}
      </div>
      {item.label && (
        <div class="drawer" id={`label-${item.slug}`} hidden="until-found">
          <div class="drawer-inner">
            <div class="tag">
              <p class="status">
                {item.label.status === "live" ? <><span class="live" aria-hidden="true"></span>live and in use</> : "retired"}{item.label.era && <> · {item.label.era}</>}
              </p>
              {item.label.madeOf && <p class="made">made of {item.label.madeOf}</p>}
              {item.label.text && <p class="text">{item.label.text}</p>}
              {item.label.kind && item.label.note && <p class="decision"><span>the {item.label.kind}</span>{item.label.note}</p>}
            </div>
          </div>
        </div>
      )}
    </li>
  ))}
</ul>
<script>
  import "../scripts/labels";
</script>
```

- [ ] **Step 4: Write `src/scripts/labels.ts`**

```ts
export {};

// Wall labels open in place. Closed drawers stay hidden="until-found" so find-in-page can still reach them.
// The pill's aria-expanded is the state (the .open class lags a frame behind for the animation).
const CLOSE_MS = 320;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function setOpen(item: HTMLElement, open: boolean) {
  const pill = item.querySelector<HTMLButtonElement>(".peek");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  if (!pill || !drawer) return;
  pill.setAttribute("aria-expanded", String(open));
  if (open) {
    drawer.removeAttribute("hidden");
    requestAnimationFrame(() => item.classList.add("open"));
    return;
  }
  item.classList.remove("open");
  window.setTimeout(() => {
    if (pill.getAttribute("aria-expanded") === "false") drawer.setAttribute("hidden", "until-found");
  }, reduced() ? 0 : CLOSE_MS);
}

const isOpen = (item: HTMLElement) => item.querySelector(".peek")?.getAttribute("aria-expanded") === "true";

document.querySelectorAll<HTMLElement>(".line-item.labelled").forEach((item) => {
  const line = item.querySelector<HTMLElement>(".line");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  if (!line || !drawer) return;
  line.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) return; // links still navigate
    setOpen(item, !isOpen(item));
  });
  // Find-in-page revealed a closed label: reflect it as open
  drawer.addEventListener("beforematch", () => {
    item.querySelector(".peek")?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => item.classList.add("open"));
  });
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen(item)) return;
    setOpen(item, false);
    item.querySelector<HTMLButtonElement>(".peek")?.focus();
  });
});
```

- [ ] **Step 5: Write the e2e test `tests/e2e/labels.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("clicking a labelled line opens its label in place; Esc closes and returns focus", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const pill = item.locator(".peek");
  const drawer = page.locator("#label-canberra-events");
  await expect(drawer).toHaveAttribute("hidden", "until-found");
  await item.locator(".aside").click();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).not.toHaveAttribute("hidden", /.*/);
  await expect(drawer.locator(".made")).toBeVisible();
  await pill.focus();
  await page.keyboard.press("Escape");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect(pill).toBeFocused();
  await expect(drawer).toHaveAttribute("hidden", "until-found");
});

test("the pill toggles with the keyboard and several labels can be open", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-slug="digital-nachos"] .peek').press("Enter");
  await page.locator('[data-slug="linear-gratis"] .peek').press("Enter");
  await expect(page.locator(".line-item.open")).toHaveCount(2);
});

test("links inside a labelled line navigate instead of toggling", async ({ page }) => {
  await page.goto("/");
  const link = page.locator('[data-slug="canberra-events"] a');
  await expect(link).toHaveAttribute("href", "https://canberra.events");
  await page.route("https://canberra.events/**", (route) => route.fulfill({ body: "ok" }));
  await link.click();
  await expect(page).toHaveURL("https://canberra.events/");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("label contents stay in the page for find-in-page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#label-canberra-events")).toHaveAttribute("hidden", "until-found");
    await expect(page.locator("#label-canberra-events .made")).toHaveCount(1);
  });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run typecheck && bun run test:unit && bun run build && bun run test:e2e -- tests/e2e/labels.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wall labels that open in place, keyboard and find-in-page friendly"
```

---

### Task 8: Log toggle

**Files:**
- Modify: `src/components/Log.astro`
- Create: `src/scripts/log-toggle.ts`
- Test: `tests/unit/log.test.ts`, `tests/e2e/log.spec.ts`

**Interfaces:**
- Consumes: `LogEntry` (Task 4), `formatLogDate` (Task 3).
- Produces: `.log` > `ul` (first three) + `div.older#older-entries[hidden="until-found"]` > `.older-inner` > `ul` + `button.more[aria-expanded][aria-controls="older-entries"]`, only when there are more than three entries.

- [ ] **Step 1: Write the failing unit test `tests/unit/log.test.ts`**

```ts
import { expect, test } from "vitest";
import Log from "../../src/components/Log.astro";
import type { LogEntry } from "../../src/lib/logbook";
import { render, text } from "./render";

const entries = (n: number): LogEntry[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, date: `2026-0${9 - i}-01`, precision: "month" as const, text: `entry ${i + 1}.` }));

test("three or fewer entries render with no toggle", async () => {
  const doc = await render(Log, { entries: entries(3) });
  expect(doc.querySelectorAll(".log li")).toHaveLength(3);
  expect(doc.querySelector(".more")).toBeNull();
  expect(doc.querySelector(".older")).toBeNull();
});

test("more than three entries tuck the rest behind a toggle", async () => {
  const doc = await render(Log, { entries: entries(5) });
  expect(doc.querySelectorAll(".log > ul > li")).toHaveLength(3);
  expect(doc.querySelector("#older-entries")!.getAttribute("hidden")).toBe("until-found");
  expect(doc.querySelectorAll("#older-entries li")).toHaveLength(2);
  expect(text(doc.querySelector(".more .lbl"))).toBe("older entries");
  expect(doc.querySelector(".more")!.getAttribute("aria-expanded")).toBe("false");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:unit -- tests/unit/log.test.ts`
Expected: FAIL on the second test (no `#older-entries`).

- [ ] **Step 3: Rewrite `src/components/Log.astro`**

```astro
---
import { formatLogDate } from "../lib/text";
import type { LogEntry } from "../lib/logbook";
interface Props {
  entries: LogEntry[];
}
const { entries } = Astro.props;
const visible = entries.slice(0, 3);
const older = entries.slice(3);
---
<div class="log">
  <ul>
    {visible.map((entry) => (
      <li><time class="d" datetime={entry.precision === "month" ? entry.date.slice(0, 7) : entry.date}>{formatLogDate(entry.date, entry.precision)}</time><span>{entry.text}</span></li>
    ))}
  </ul>
  {older.length > 0 && (
    <>
      <div class="older" id="older-entries" hidden="until-found">
        <div class="older-inner">
          <ul>
            {older.map((entry) => (
              <li><time class="d" datetime={entry.precision === "month" ? entry.date.slice(0, 7) : entry.date}>{formatLogDate(entry.date, entry.precision)}</time><span>{entry.text}</span></li>
            ))}
          </ul>
        </div>
      </div>
      <button class="more" type="button" aria-expanded="false" aria-controls="older-entries">
        <span class="chev" aria-hidden="true"></span><span class="lbl">older entries</span>
      </button>
    </>
  )}
</div>
{older.length > 0 && (
  <script>
    import "../scripts/log-toggle";
  </script>
)}
```

- [ ] **Step 4: Write `src/scripts/log-toggle.ts`**

```ts
export {};

const CLOSE_MS = 300;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const log = document.querySelector<HTMLElement>(".log");
const button = log?.querySelector<HTMLButtonElement>(".more");
const older = log?.querySelector<HTMLElement>(".older");

function setOpen(open: boolean) {
  if (!log || !button || !older) return;
  button.setAttribute("aria-expanded", String(open));
  const label = button.querySelector(".lbl");
  if (label) label.textContent = open ? "fewer entries" : "older entries";
  if (open) {
    older.removeAttribute("hidden");
    requestAnimationFrame(() => log.classList.add("open"));
    return;
  }
  log.classList.remove("open");
  window.setTimeout(() => { if (button.getAttribute("aria-expanded") === "false") older.setAttribute("hidden", "until-found"); }, reduced() ? 0 : CLOSE_MS);
}

button?.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
older?.addEventListener("beforematch", () => setOpen(true));
```

- [ ] **Step 5: Write the e2e test `tests/e2e/log.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("older entries expand and collapse", async ({ page }) => {
  await page.goto("/");
  const more = page.locator("#log .more");
  await expect(page.locator("#log .log > ul > li")).toHaveCount(3);
  await expect(page.locator("#older-entries")).toHaveAttribute("hidden", "until-found");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(more.locator(".lbl")).toHaveText("fewer entries");
  await expect(page.locator("#older-entries li").first()).toBeVisible();
  await more.click();
  await expect(more.locator(".lbl")).toHaveText("older entries");
  await expect(page.locator("#older-entries")).toHaveAttribute("hidden", "until-found");
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run typecheck && bun run test:unit && bun run build && bun run test:e2e -- tests/e2e/log.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: older log entries behind a toggle"
```

---

### Task 9: Redirects, 404 and security headers

**Files:**
- Create: `src/pages/ig.ts`, `src/pages/jobs/video-editor.ts`, `src/pages/404.astro`, `src/middleware.ts`
- Test: `tests/e2e/routes.spec.ts`

**Interfaces:**
- Produces: security headers on every Worker response; `/ig` 302; `/jobs/video-editor` 301; custom 404 with status 404 and `no-store`.

- [ ] **Step 1: Write the failing test `tests/e2e/routes.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("/ig redirects home with UTM tags", async ({ request }) => {
  const response = await request.get("/ig", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe("/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link");
});

test("the old job page is retired", async ({ request }) => {
  const response = await request.get("/jobs/video-editor", { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()["location"]).toBe("/");
});

test("query strings from Instagram still get the logbook", async ({ page }) => {
  const response = await page.goto("/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link&fbclid=abc123");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("george vlachos");
});

test("unknown pages get the notebook 404, uncached", async ({ page }) => {
  const response = await page.goto("/nothing-here");
  expect(response?.status()).toBe(404);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.locator("main")).toContainText("nothing written on this page.");
  await expect(page.getByRole("link", { name: "back to the logbook" })).toHaveAttribute("href", "/");
});

test("security headers and a CSP are present", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  // Astro sends its CSP as a header for on-demand pages, so there is no <meta> CSP
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toMatch(/script-src 'self'( 'sha256-[^']+')+/);
  expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
  await expect(page.locator('meta[http-equiv="content-security-policy"]')).toHaveCount(0);
});

test("pages work under the CSP with no violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto("/");
  await page.locator('[data-slug="canberra-events"] .peek').click();
  await page.locator("#log .more").click();
  await expect(page.locator("[data-sydney-time]")).toHaveText(/\d/);
  await page.goto("/nothing-here");
  await expect(page.getByRole("link", { name: "back to the logbook" })).toBeVisible();
  expect(violations).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run build && bun run test:e2e -- tests/e2e/routes.spec.ts --project=chromium`
Expected: FAIL (`/ig` returns 404, headers missing).

- [ ] **Step 3: Write the routes**

`src/pages/ig.ts`:

```ts
import type { APIRoute } from "astro";

export const GET: APIRoute = () =>
  new Response(null, {
    status: 302,
    headers: { Location: "/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link", "Cache-Control": "no-store" },
  });
```

`src/pages/jobs/video-editor.ts`:

```ts
import type { APIRoute } from "astro";

// Retired in the 2026 redesign (ADR-0007)
export const GET: APIRoute = () => new Response(null, { status: 301, headers: { Location: "/" } });
```

`src/pages/404.astro`:

```astro
---
import Notebook from "../layouts/Notebook.astro";
import Row from "../components/Row.astro";
Astro.response.headers.set("Cache-Control", "no-store");
---
<Notebook title="nothing here · george vlachos" noindex>
  <main class="book">
    <Row label="404" id="not-found">
      <p>nothing written on this page.</p>
      <p class="home"><a href="/">back to the logbook</a></p>
    </Row>
  </main>
</Notebook>
```

- [ ] **Step 4: Write `src/middleware.ts`**

```ts
import { defineMiddleware } from "astro:middleware";

// Astro sends Content-Security-Policy itself (security.csp in astro.config.mjs); these are the rest.
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  // Redirect responses have immutable headers, so always copy before setting
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run typecheck && bun run build && bun run test:e2e -- tests/e2e/routes.spec.ts`
Expected: 0 type errors; PASS in chromium and webkit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: redirects, notebook 404 and security headers"
```

---

### Task 10: Budgets, privacy smoke test and the OG image

**Files:**
- Create: `tests/e2e/budgets.spec.ts`, `tests/e2e/privacy.spec.ts`, `scripts/og-image.mjs`, `public/og.png` (generated)

**Interfaces:**
- Produces: the budget and privacy checks that every later plan must keep passing; `bun run og` regenerates `public/og.png` from the running site.

- [ ] **Step 1: Write `tests/e2e/budgets.spec.ts`**

```ts
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

test("page weight stays inside the budgets", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  const sizes = { js: 0, css: 0, html: 0, font: 0 };
  let fonts = 0;
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!["script", "stylesheet", "document", "font"].includes(type) || response.status() >= 300) return;
    reads.push(
      response.body().then((body) => {
        if (type === "font") { sizes.font += body.length; fonts += 1; return; }
        const bytes = gzipSync(body).length;
        if (type === "script") sizes.js += bytes;
        if (type === "stylesheet") sizes.css += bytes;
        if (type === "document") sizes.html += bytes;
      }),
    );
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await Promise.all(reads);
  // Astro inlines small page scripts and every stylesheet into the HTML, so count those too
  const inline = await page.evaluate(() => ({
    js: [...document.querySelectorAll("script:not([src])")].map((s) => s.textContent ?? "").join("\n"),
    css: [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n"),
  }));
  sizes.js += gzipSync(inline.js).length;
  sizes.css += gzipSync(inline.css).length;
  console.log("budgets (bytes)", sizes);
  expect(sizes.js).toBeGreaterThan(0);
  expect(sizes.js).toBeLessThan(10 * 1024);
  expect(sizes.css).toBeLessThan(15 * 1024);
  expect(sizes.html).toBeLessThan(30 * 1024);
  expect(fonts).toBe(2);
  expect(sizes.font).toBeLessThan(60 * 1024);
});

test("no layout shift while the page settles", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "layout-shift entries are Chromium-only");
  await page.goto("/");
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceEntry[] & { value: number; hadRecentInput: boolean }[]) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 1500);
      }),
  );
  expect(cls).toBeLessThan(0.01);
});
```

- [ ] **Step 2: Write `tests/e2e/privacy.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("cookies none, storage empty, every request first party", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const setCookies: string[] = [];
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("data:") && new URL(url).origin !== origin) foreign.push(url);
  });
  const checks: Promise<void>[] = [];
  page.on("response", (response) => {
    checks.push(
      response.allHeaders().then((headers) => {
        if (headers["set-cookie"]) setCookies.push(`${response.url()}: ${headers["set-cookie"]}`);
      }),
    );
  });
  await page.goto("/");
  await page.locator('[data-slug="canberra-events"] .peek').click();
  await page.locator("#log .more").click();
  await page.waitForLoadState("networkidle");
  await Promise.all(checks);
  expect(setCookies).toEqual([]);
  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
});
```

- [ ] **Step 3: Run them to verify they pass**

Run: `bun run typecheck && bun run build && bun run test:e2e -- tests/e2e/budgets.spec.ts tests/e2e/privacy.spec.ts`
Expected: PASS; the budget log line shows JS, CSS, HTML and font bytes. If a budget fails, reduce the asset (do not raise the budget) and rerun.

- [ ] **Step 4: Write `scripts/og-image.mjs` and generate the image**

```js
// Renders the 1200 × 630 Open Graph image from the running site (bun run serve in another terminal).
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// A fixed, unremarkable morning time so the image doesn't show whenever it happened to be rendered
await page.clock.setFixedTime(new Date("2026-10-02T23:00:00Z"));
await page.goto(process.env.OG_URL ?? "http://localhost:4331/");
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "public/og.png" });
await browser.close();
console.log("wrote public/og.png");
```

Run (two terminals): `bun run serve` then `bun run og`
Expected: `public/og.png` exists, 1200 × 630.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: weight, layout-shift and privacy budgets; open graph image"
```

---

### Task 11: CI that gates deploys

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md` (replace)

**Interfaces:**
- Consumes: scripts from Task 1 (`typecheck`, `test:unit`, `db:migrate:local`, `build`, `test:e2e`, `db:migrate:remote`).
- Produces: checks on every push and pull request; deploy on `main` only after checks pass (ADR-0008).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  # Never cancel a run on main part-way through a deploy or a remote migration
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.2.21
      - run: bun install --frozen-lockfile
      - run: bunx playwright install --with-deps chromium webkit
      - run: bun run typecheck
      - run: bun run test:unit
      - run: bun run db:migrate:local
      - run: bun run build
      - run: bun run test:e2e
      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-report
          path: test-results

  deploy:
    needs: check
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.2.21
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: bun run db:migrate:remote
      - run: bunx wrangler deploy
      # The visitor info's promises, checked against the live site
      - run: bunx playwright install --with-deps chromium
      - run: bunx playwright test tests/e2e/privacy.spec.ts --project=chromium
        env:
          PLAYWRIGHT_BASE_URL: https://curiousgeorge.dev
```

- [ ] **Step 2: Write `README.md`**

````markdown
# curiousgeorge.dev

George Vlachos's logbook. Astro 7 on Cloudflare Workers, D1 for the living content.

- Spec: `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`
- Decisions: `docs/adr/`
- Plans: `docs/superpowers/plans/`

## Develop

```bash
bun install
bun run db:migrate:local
bun run dev
```

## Check everything (what CI runs)

```bash
bun run check
```

## Notes

- Migrations: always `wrangler d1 migrations apply`, never `wrangler d1 execute --file`.
- Fonts: `bun run fonts` after adding copy with new characters.
- Open Graph image: `bun run serve`, then `bun run og`.
- Deploys happen only from GitHub Actions on `main`, after every check passes; the privacy spec then runs against the live site.
- `/` is cached at the edge for five minutes with background refresh, so deploys show within minutes.
````

- [ ] **Step 3: Run the full local check**

Run: `bun run check`
Expected: typecheck clean, all unit tests pass, migrations apply, build succeeds, all Playwright projects pass.

- [ ] **Step 4: Commit**

```bash
git add .github README.md
git commit -m "ci: run every check on push and gate deploys on main"
```

- [ ] **Step 5: Verify CI on the branch (only when George has asked to push)**

Push `redesign/logbook` and open a pull request only with George's go-ahead, then confirm the `check` job is green on the pull request and no `deploy` job runs.
