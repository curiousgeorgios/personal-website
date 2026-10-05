# Plan 5: polish implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the redesign's open ends before launch: the admin gate checks the signed-in email and shows when the session ends, the seven product answers and a night poster, every plan 4 follow-up that is code, the six known test flakes fixed at their root and the docs brought up to date.

**Architecture:** No new subsystem. The Access check in `src/lib/admin/` gains an email comparison and returns the token's expiry; the listening corner gets a truthful hint, links that play without JavaScript, posters with a plain sleeve (and a night pair chosen by an inline script before first paint), a runner that never moves a record whose press was undone while the scene downloaded, a mouse-only scratch and an audio graph built before the first press. The labels' hover card stays inside the page and waits for its picture; the closer look opens at once with the frame's own picture and swaps the big file in. The snapshots Worker replaces a session that dies mid-run, counts a page drawn only in CSS and says when the browser couldn't start. The known flakes are fixed at causes measured on 5 October 2026, in the specs and, for the scratch, in the loop (a scratch's moves no longer redraw the shadow map).

**Tech Stack:** Astro 7.3.5 on Cloudflare Workers, D1, R2, Images, Browser Rendering with `@cloudflare/puppeteer` 1.4.0, Three.js 0.169.0, `jose` 6.2.12, Vitest 5 with `node:sqlite` and `linkedom`, Playwright 1.63, sharp 0.35.5, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md](../specs/2026-10-03-personal-site-redesign-design.md), mainly sections 4.1, 5.2 to 5.5, 7, 9, 11, 13 and 14. Decisions: [ADR-0016](../../adr/0016-admin-worker-checks-the-signed-in-email.md) (the email check); Task 2 writes ADR-0017 (the environment map is generated in the browser). The product answers behind Tasks 1 to 7 are George's seven answers of 5 October 2026 (the environment map, the hint, the posters, a changed mind during the download, pen, no-JavaScript play and the Access session) plus the night poster decided after them; each task quotes what it needs. Follow-ups this plan takes on: [plan 4](2026-10-05-plan-4-followups.md) ("Later", "Test gaps" and "Known flakes"), and the questions in [plan 2](2026-10-04-plan-2-followups.md) and [plan 3](2026-10-04-plan-3-followups.md).

## Global constraints

- Copy is lowercase George-voice: Australian spelling, spaced hyphen ` - `, no em dashes, no Oxford comma, sentence case. This applies to every message, label, comment and doc line.
- Motion: ease-out by default, most transitions 200 to 300ms; hover transitions 200ms `ease`, only under `(hover: hover) and (pointer: fine)`; no transforms under `prefers-reduced-motion`; motion grows from its trigger (origin-aware); animate `transform` and `opacity` only.
- Budgets (spec 11): JavaScript before any interaction under 10KB gzipped (about 5.9KB now), HTML under 30KB, CSS under 15KB; posters under 60KB each; covers under 40KB; interaction to next paint under 200ms; layout shift under 0.01.
- `ADMIN_EMAIL` is `hello@curiousgeorge.dev`, compared ignoring case and surrounding spaces; empty refuses everyone, as an empty team domain does (ADR-0016). The test build's localhost bypass is unchanged.
- The page is cached at the edge for five minutes with a day of stale-while-revalidate (spec 6.1), so nothing the server renders may depend on the time of day.
- Three.js stays pinned at 0.169.0; no new dependency anywhere in this plan.
- Use bun, never npm. D1 migrations only through `wrangler d1 migrations apply`; `wrangler d1 execute --command` is used only to set test data in local stores.
- Never run `wrangler deploy` (except `--dry-run`), any `--remote` command or `bun run seed:media --remote`; never put a secret in a task.
- Run scripts and tests under Node 24 (`mise exec node@24 --` outside the home directory).
- The e2e servers: 4331 is the main local server (`.wrangler/state`, seeded with fixtures); 4332 has an empty store; 4333 is the admin server with its own store, recreated every run; 4334 runs both Workers against a fixture site on 4400. Specs that write use only 4333 and 4334.
- Every task ends with `bun run typecheck` at 0 errors and the unit tests passing; tasks that touch pages rebuild with `bun run build:test` and run the e2e specs they name (stop stale servers first with `pkill -f "port 433[1234]"`). Match the existing code style: 2-space indent, double quotes, semicolons, short comments that say why.

## Review focus

1. **Sydney's hour boundaries for the night poster** (18:59 and 19:00, 05:59 and 06:00, both sides of daylight saving): the poster must agree with the scene's own light, or the take-over swaps day for night. Task 7 pins every boundary against `lightFor` in a unit test.
2. **A visitor without JavaScript, or whose inline script is blocked** (scripts off, a CSP hash that no longer matches after an edit): the day poster shows, every track is a link that plays and the hint says only what's true. Task 6 pins the links and the hint without JavaScript; Task 7 pins the day poster without JavaScript and a night poster that only shows if the CSP allowed its script.
3. **An Access token for another address or for George's in other case or with spaces, and an empty `ADMIN_EMAIL`**: another address is a 403 logged without the address; `Hello@CuriousGeorge.dev ` is George; an empty var refuses everyone before any key is fetched. Task 1 pins each.
4. **Presses while the scene downloads** (a second record, a stop, a scene that never arrives): only the last choice moves, and a record that never left its sleeve never makes a journey. Task 3 pins each in unit tests and the two-record case end to end.
5. **A big snapshot file that's slow, never answers or 404s, and a double click on a frame**: the closer look opens at once and closes cleanly; no frame ever ignores clicks. Task 10 pins each end to end.

## Decisions made while planning

Recorded so reviewers know they are deliberate:

- **The admin's "until" date comes from the token, not a setting.** Access puts the session's end in the token's `exp`, so the page shows exactly what Access will do. It's Sydney's date in the log's day format (`05.11.26`), from the same helpers the log and the clock use.
- **ADR-0017, not ADR-0016, records the environment map.** ADR-0016 went to the admin email check while this plan was written.
- **The runner waits for the scene only while one is downloading** (`if (pending)`). The product answer's code awaited `viewForStep()` unconditionally; that adds a microtask to every load, so synchronous presses with a scene attached (the "several quick presses" unit test) would skip journeys they make today. Guarded, nothing changes with a scene attached, as the answer requires.
- **The night poster's script is one string shared by the component and the CSP.** `src/scripts/night-poster.mjs` exports it; `Turntable.astro` renders it with `set:html` and `astro.config.mjs` adds its SHA-256 to `script-src`. Astro hashes only the scripts it bundles, not `is:inline` ones, so a hand-copied hash would break silently on the next edit.
- **The night poster swaps the `<picture>`'s sources in a classic inline script placed straight after it**, before the browser lays it out, so only one poster is ever fetched (the image is `loading="lazy"`). Without JavaScript the day poster's markup stands.
- **No-JavaScript tracks use a shared `.pick` class and a tiny `src/deck/rows.ts`** that turns links into buttons before the runner reads them. It also holds `playedProperties`, so a row without `data-id` (a plan 4 test gap) is unit-tested.
- **The audio graph is built in an idle moment after `load`**, suspended; the press resumes it. `createAudioPort` returns `DeckAudio` (`AudioPort` plus `prepare()` and `ready`), so the runner's port interface and its fakes don't change.
- **The closer look takes the big file in the frame's own format.** It opens with the frame's picture (`currentSrc`, already decoded), then loads the 1920 in a detached `Image` whose URL ends like the frame's (`.avif` where the browser chose AVIF) and swaps it in once decoded. The dialog loses its `<source>`. The image's width is set from the window (every snapshot is 16:10), so the swap can't move it and a fallback picture fills the window instead of growing to twice the frame.
- **A night's run starts at most three browser sessions.** A line that errors may have taken the session with it, so the next line gets a fresh one, twice at most, so a Browser Rendering outage isn't hammered. A line left with no session keeps its status (`no-browser`), as a refused re-shoot does, so the admin never reads an outage as broken captures.
- **"The browser couldn't start" is its own re-shoot outcome, `no-browser`.** The Worker returns it when the launch throws, rather than throwing, so the admin can say so without guessing from an error message.
- **The flakes are fixed where they start, mostly in the specs.** Each was reproduced on 5 October 2026 under `--workers=14` on George's 14-core Mac (CI runs one worker on Linux and has passed every run): a headless renderer that stalled up to 6.6s, timers and frames alike, past Playwright's 5s wait; a state that lasts 2.5s asserted with round trips of 2 to 3s each; a test that brings the 3D scene in under the default 30s budget; a `close` event dispatched a task after the browser had already returned focus; wrangler dev's proxy, which retries a dropped connection only for GET and HEAD; and every scratch move redrawing the 2048 shadow map (the one fix in product code, Task 15). Tasks 15 and 16 give the evidence for each.
- **The poster budgets live in `tests/unit/media-files.test.ts`**, not `budgets.spec.ts`; Task 7 extends them to the night pair. `budgets.spec.ts` keeps the JavaScript budget, which Task 7 runs with the night poster's script in the page.
- **ADR-0017 is written in Task 2, beside the code it records.** The ADR amendments that landed while this plan was written (0009 to 0015 Accepted, 0016 new) need nothing more from Task 17 than the spec's link to the latest.
- **The three post-deploy checks stay on the launch checklist:** the Images quality steps (the local binding ignores `quality`), Lighthouse `--strict` once its runs prove steady and the RPC exception's `remote` flag deployed.

## File structure

```
wrangler.jsonc                                  modify: var ADMIN_EMAIL
worker-configuration.d.ts                       regenerate
astro.config.mjs                                modify: the night poster script's hash in script-src
src/env.d.ts                                    modify: adminUntil; the audio hook's ready
src/middleware.ts                               modify: ADMIN_EMAIL into the gate; adminUntil
src/lib/admin/access.ts                         modify: AccessIdentity, sessionEnds
src/lib/admin/gate.ts                           modify: AdminConfig, the email comparison
src/lib/admin/actions.ts                        modify: the no-browser re-shoot answer
src/pages/admin/index.astro                     modify: "until <date>"
src/components/Turntable.astro                  modify: two-sentence hint, track links, the night poster script
src/components/CloserLook.astro                 modify: no <source>
src/scripts/night-poster.mjs                    create: the night poster's inline script
src/scripts/deck.ts                             modify: rows upgraded, audio prepared after load
src/scripts/labels.ts                           modify: hover card nudge, card shown once its picture is ready
src/scripts/closer.ts                           modify: opens at once, swaps the big file in
src/deck/rows.ts                                create: links to buttons, a row's track, record_played's properties
src/deck/runner.ts                              modify: a press undone during the download moves nothing
src/deck/audio.ts                               modify: DeckAudio, prepare(), ready
src/deck/scene/build.ts                         modify: the environment map in its own idle task, measured in test builds
src/deck/scene/hooks.ts                         modify: poster() keeps one plain sleeve; shadows()
src/deck/scene/pointer.ts                       modify: mouse only; a scratch's moves ask for no frame
src/deck/scene/loop.ts                          modify: counts shadow-map redraws
src/styles/deck.css                             modify: hint cell, .pick
src/styles/notebook.css                         modify: --nudge, the closer look's width, no aria-busy cursor
workers/snapshots/src/capture.ts                modify: SHOWS_SOMETHING exported, CSS backgrounds count
workers/snapshots/src/run.ts                    modify: sessions replaced mid-run, ReshootOutcome
scripts/poster.mjs                              modify: plain sleeve, day and night, try/finally
public/posters/deck-{desktop,phone}{,-night}.webp   re-render (2), create (2)
.github/workflows/ci.yml                        modify: the Chrome cache saved whatever the result
docs/adr/0017-environment-map-generated-in-the-browser.md   create
tests/unit/access, gate, middleware, runner, audio, turntable, media-files, snapshot-run, actions, loop   modify
tests/unit/rows, night-poster, snapshots-worker                                                    create
tests/unit/fake-browser.ts                      modify: a page that kills its session
tests/e2e/admin-gate, scene-perf, deck-scene, deck-scratch, deck-list, deck-phone, perf, labels, analytics, log, deck-crate, privacy   modify
tests/e2e/posters.spec.ts, shows-something.spec.ts, load.ts, site.ts                               create
docs: spec, roadmap, plan 2, 3 and 4 follow-ups, plan 5 follow-ups, README                         modify or create
```

Tasks touch shared files in this order, so each builds on the last: `Turntable.astro` (5, 6, 7), `deck.css` (5, 6), `deck.ts` (6, 8), `deck-scene.spec.ts` (3, 5), `deck-scratch.spec.ts` and `pointer.ts` (4, 15), `perf.spec.ts` (8, 10), `labels.spec.ts` (9, 10, 16), `notebook.css` (9, 10), `admin-gate.spec.ts` (1, 16), `run.ts` and `snapshot-run.test.ts` (11, 13), `env.d.ts` (1, 8), `hooks.ts` (7, 15), `tests/unit/turntable.test.ts` (5, 6, 7).

---

### Task 1: the admin gate checks the email and shows when the session ends

A valid Access token now has to name `ADMIN_EMAIL` (ADR-0016), and `/admin` says when the session ends: `signed in as hello@curiousgeorge.dev until 05.11.26 · the logbook`. Under the local bypass there's no session, so no date.

**Files:**
- Modify: `wrangler.jsonc` (var `ADMIN_EMAIL`), `worker-configuration.d.ts` (regenerated), `src/lib/admin/access.ts`, `src/lib/admin/gate.ts`, `src/middleware.ts`, `src/env.d.ts`, `src/pages/admin/index.astro`
- Test: `tests/unit/access.test.ts`, `tests/unit/gate.test.ts`, `tests/unit/middleware.test.ts`, `tests/e2e/admin-gate.spec.ts`

**Interfaces:**
- Consumes: `formatLogDate(iso, "day")` from `src/lib/text.ts` and `sydneyDate(now)` from `src/lib/time.ts` (both existing).
- Produces:
  - `access.ts`: `interface AccessIdentity { email: string; expires: number | null }` (`expires` is the token's `exp`, seconds since 1970); `verifyAccessJwt(token, config, keys): Promise<AccessIdentity | null>`; `sessionEnds(expires: number): string` (`"05.11.26"`)
  - `gate.ts`: `interface AdminConfig extends AccessConfig { adminEmail: string }`; `adminIdentity(request, config: AdminConfig, keys?): Promise<AccessIdentity | null>`
  - `App.Locals.adminUntil?: number`, set by the middleware when the token has an expiry
  - `env.ADMIN_EMAIL: string`

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/access.test.ts`, change the import line to:

```ts
import { sessionEnds, verifyAccessJwt } from "../../src/lib/admin/access";
```

and replace the test `"returns the email from a valid token"` with:

```ts
  test("returns the email and the session's end from a valid token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    expect(await verifyAccessJwt(await sign({ exp }), config, keys)).toEqual({ email: "george@example.com", expires: exp });
  });
```

Then add at the end of the file:

```ts
describe("sessionEnds", () => {
  // The day the Access session ends, as /admin shows it: Sydney's date in the log's format
  test.each([
    ["2026-11-04T14:00:00Z", "05.11.26"], // 1am on the 5th in Sydney (AEDT, UTC+11)
    ["2026-11-04T12:59:00Z", "04.11.26"], // 11:59pm on the 4th
    ["2026-06-30T14:00:00Z", "01.07.26"], // midnight in winter (AEST, UTC+10)
  ])("an expiry at %s reads %s", (iso, day) => {
    expect(sessionEnds(Date.parse(iso) / 1000)).toBe(day);
  });
});
```

In `tests/unit/gate.test.ts`, replace the `config` line with:

```ts
const config = { teamDomain: "team.cloudflareaccess.com", audience: "aud-123", adminEmail: "george@example.com" };
```

Replace the test `"returns the email for a valid Access token, fetching keys for the configured team"` with:

```ts
  test("returns the identity for the admin's valid Access token, fetching keys for the configured team", async () => {
    const keyFor = vi.fn(() => keys);
    expect(await adminIdentity(request("GET", { "Cf-Access-Jwt-Assertion": token }), config, keyFor)).toEqual({ email: "george@example.com", expires: expect.any(Number) });
    expect(keyFor).toHaveBeenCalledWith("team.cloudflareaccess.com");
  });

  test("lets the admin's address in whatever its case or surrounding spaces", async () => {
    const identity = await adminIdentity(request("GET", { "Cf-Access-Jwt-Assertion": token }), { ...config, adminEmail: "  George@Example.COM " }, () => keys);
    expect(identity?.email).toBe("george@example.com");
  });

  test("refuses a valid token for any other address, and logs why without the address", async () => {
    const identity = await adminIdentity(request("GET", { "Cf-Access-Jwt-Assertion": token }), { ...config, adminEmail: "hello@curiousgeorge.dev" }, () => keys);
    expect(identity).toBeNull();
    expect(warn).toHaveBeenCalledWith("admin: access token refused", "not the admin's email");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("george@example.com");
  });

  test("refuses everyone while ADMIN_EMAIL is empty, before fetching any keys", async () => {
    const keyFor = vi.fn(() => keys);
    for (const adminEmail of ["", "   "]) {
      expect(await adminIdentity(request("GET", { "Cf-Access-Jwt-Assertion": token }), { ...config, adminEmail }, keyFor)).toBeNull();
    }
    expect(keyFor).not.toHaveBeenCalled();
  });
```

In the same file, in `"refuses, rather than throws, when the team domain isn't a valid host"`, change `{ teamDomain: "not a host", audience: "aud-123" }` to `{ ...config, teamDomain: "not a host" }`, and in `"fails closed until the team domain and audience are set"` change the two config objects to `{ ...config, teamDomain: "" }` and `{ ...config, audience: "" }`.

In `tests/unit/middleware.test.ts`, add at the end:

```ts
test("under the local bypass the admin is signed in with no session end", async () => {
  const url = new URL("http://localhost/admin/");
  const locals: Record<string, unknown> = {};
  await onRequest({ request: new Request(url), url, locals }, () => Promise.resolve(new Response("ok")));
  expect(locals).toEqual({ adminEmail: "admin-bypass@localhost" });
});
```

Run: `bun run test:unit tests/unit/access.test.ts tests/unit/gate.test.ts tests/unit/middleware.test.ts`
Expected: FAIL: `sessionEnds` is not exported, `verifyAccessJwt` returns a string, the other-address test gets an identity and `adminEmail` isn't part of the config's type (Vitest runs it anyway).

- [ ] **Step 2: The identity, its end and the email check**

Replace `src/lib/admin/access.ts` with:

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { formatLogDate } from "../text";
import { sydneyDate } from "../time";

export interface AccessConfig {
  /** The Access team domain, e.g. curiousgeorge.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's audience (AUD) tag */
  audience: string;
}

/** Who a valid Access token says is signed in, and until when */
export interface AccessIdentity {
  email: string;
  /** When the Access session ends: the token's exp, in seconds since 1970; null for a token without one */
  expires: number | null;
}

const keySets = new Map<string, JWTVerifyGetKey>();

/** Access's signing keys for a team, fetched once per isolate (jose refetches when they rotate) */
export function accessKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/** Workers Logs line for a refused admin request: the jose error code (or the error's name), never the token */
export function logRefusal(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const reason = typeof code === "string" ? code : error instanceof Error ? error.name : "unknown";
  console.warn("admin: access token refused", reason);
}

/** The signed-in identity from a Cloudflare Access JWT, or null unless signature, audience, issuer and expiry all check out */
export async function verifyAccessJwt(token: string, config: AccessConfig, keys: JWTVerifyGetKey): Promise<AccessIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${config.teamDomain}`, audience: config.audience, algorithms: ["RS256"] });
    if (typeof payload.email !== "string" || payload.email === "") return null;
    return { email: payload.email, expires: typeof payload.exp === "number" ? payload.exp : null };
  } catch (error) {
    logRefusal(error);
    return null;
  }
}

/** The day an Access session ends, as /admin shows it: Sydney's date in the log's day format (05.11.26) */
export const sessionEnds = (expires: number): string => formatLogDate(sydneyDate(new Date(expires * 1000)), "day");
```

Replace `src/lib/admin/gate.ts` with:

```ts
import type { JWTVerifyGetKey } from "jose";
import { accessKeys, logRefusal, verifyAccessJwt, type AccessConfig, type AccessIdentity } from "./access";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export const isAdminPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");

/** Writes must come from this site: a missing or different Origin header is refused (spec 7) */
export function originAllowed(request: Request, url: URL): boolean {
  if (SAFE_METHODS.includes(request.method)) return true;
  return request.headers.get("origin") === url.origin;
}

export interface AdminConfig extends AccessConfig {
  /** The one address let in (ADR-0016). Empty refuses everyone, as an unset team domain or audience does */
  adminEmail: string;
}

const address = (email: string) => email.trim().toLowerCase();

/**
 * The admin's identity when the request carries a valid Access token for this application that names ADMIN_EMAIL;
 * null otherwise, and always null until Access and the address are configured. The Access policy decides who may sign
 * in, this decides who may edit, so a policy loosened by mistake doesn't open /admin (ADR-0016).
 */
export async function adminIdentity(
  request: Request,
  config: AdminConfig,
  keys: (teamDomain: string) => JWTVerifyGetKey = accessKeys,
): Promise<AccessIdentity | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  // ?. because an ADMIN_EMAIL missing from wrangler.jsonc arrives as undefined, whatever its type says
  if (!token || !config.teamDomain || !config.audience || !config.adminEmail?.trim()) return null;
  let keySet: JWTVerifyGetKey;
  try {
    keySet = keys(config.teamDomain);
  } catch (error) {
    // A team domain that isn't a valid host is a refusal, not a 500 without the admin headers
    logRefusal(error);
    return null;
  }
  const identity = await verifyAccessJwt(token, config, keySet);
  if (!identity) return null;
  if (address(identity.email) !== address(config.adminEmail)) {
    // A valid token for someone else: the Access policy let in more than George. Logged without the address
    console.warn("admin: access token refused", "not the admin's email");
    return null;
  }
  return identity;
}
```

Run: `bun run test:unit tests/unit/access.test.ts tests/unit/gate.test.ts`
Expected: PASS.

- [ ] **Step 3: The var, the middleware and the page**

In `wrangler.jsonc`, replace the `vars` comment and line with:

```jsonc
  // Cloudflare Access for /admin (spec 7), empty until George creates the Access application, and the one address it
  // lets in (ADR-0016; empty refuses everyone); and PostHog's US ingestion host for the /ingest proxy, whose project key
  // is a secret (wrangler secret put POSTHOG_KEY).
  "vars": { "ACCESS_TEAM_DOMAIN": "", "ACCESS_AUD": "", "ADMIN_EMAIL": "hello@curiousgeorge.dev", "POSTHOG_HOST": "https://us.i.posthog.com" },
```

Regenerate the binding types from both Workers' configs in a clean directory, so a local `.env` can't leak into them:

```bash
TMP=$(mktemp -d) && cp wrangler.jsonc "$TMP"/ && ln -s "$PWD/workers" "$TMP/workers" && ln -s "$PWD/node_modules" "$TMP/node_modules" && (cd "$TMP" && ./node_modules/.bin/wrangler types --config=wrangler.jsonc --config=workers/snapshots/wrangler.jsonc --strict-vars=false) && cp "$TMP/worker-configuration.d.ts" worker-configuration.d.ts && rm -rf "$TMP"
git diff worker-configuration.d.ts | head -30
```

Expected: a new hash in the header, `ADMIN_EMAIL: string;` in `__BaseEnv_Env` and `"ADMIN_EMAIL"` in the `ProcessEnv` pick list. Nothing from `.env`.

In `src/env.d.ts`, replace the `App` namespace with:

```ts
declare namespace App {
  interface Locals {
    /** The signed-in admin's email, set by the middleware on /admin requests */
    adminEmail?: string;
    /** When the admin's Access session ends (the token's exp, seconds since 1970); unset under the local bypass */
    adminUntil?: number;
  }
}
```

In `src/middleware.ts`, change the gate import to:

```ts
import type { AccessIdentity } from "./lib/admin/access";
import { adminIdentity, isAdminPath, originAllowed } from "./lib/admin/gate";
```

and replace the lines from `} else if (admin) {` down to and including `context.locals.adminEmail = email;` with:

```ts
  } else if (admin) {
    let identity: AccessIdentity | null;
    // Test builds skip Access, and only on this machine; a production build can't contain this branch (astro.config.mjs
    // and the deploy job's guard), and a test build deployed by mistake still asks Access
    if (__ADMIN_BYPASS__ && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) identity = { email: "admin-bypass@localhost", expires: null };
    else identity = await adminIdentity(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, adminEmail: env.ADMIN_EMAIL });
    if (identity) {
      context.locals.adminEmail = identity.email;
      if (identity.expires !== null) context.locals.adminUntil = identity.expires;
```

(the `try { response = await next(); } ...` block and the `else { response = refuse("forbidden"); }` that follow stay as they are).

In `src/pages/admin/index.astro`, add to the imports:

```ts
import { sessionEnds } from "../../lib/admin/access";
```

add after the `notice` line:

```ts
// When the Access session runs out, so George can reload before typing rather than lose a save (none under the local bypass)
const until = Astro.locals.adminUntil === undefined ? null : sessionEnds(Astro.locals.adminUntil);
```

and replace the `.where` paragraph with:

```astro
      <p class="where">signed in as {Astro.locals.adminEmail}{until && ` until ${until}`} · <a href="/">the logbook</a></p>
```

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes, the middleware's new test among them.

- [ ] **Step 4: The e2e wording**

In `tests/e2e/admin-gate.spec.ts`, in `"the admin page is private: no-store, noindex and the signed-in identity"`, replace the `.where` assertion with:

```ts
  // The local bypass has no Access session, so no "until <date>"
  await expect(page.locator(".where")).toHaveText("signed in as admin-bypass@localhost · the logbook");
```

Run: `bun run build:test && grep -o '"ADMIN_EMAIL":"[^"]*"' dist/server/wrangler.json`
Expected: `"ADMIN_EMAIL":"hello@curiousgeorge.dev"`.

Run: `pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/admin-gate.spec.ts tests/e2e/admin-page.spec.ts --project=chromium`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc worker-configuration.d.ts src/lib/admin/access.ts src/lib/admin/gate.ts src/middleware.ts src/env.d.ts src/pages/admin/index.astro tests/unit/access.test.ts tests/unit/gate.test.ts tests/unit/middleware.test.ts tests/e2e/admin-gate.spec.ts
git commit -m "feat: /admin lets in only ADMIN_EMAIL and shows when the session ends"
```

---

### Task 2: the environment map, the one allowed hitch

George's answer to plan 2's question 1: accept the one-off hitch of about 70ms and don't precompute. The step moves into an idle task of its own (today it shares a task with the last texture slice, the glow canvas and the cover promise's continuation), test builds measure it, and the opt-in long-task spec allows exactly that one task, under 100ms, and nothing else over 50ms. ADR-0017 records the decision. It is Accepted: George delegated its sign-off.

**Files:**
- Create: `docs/adr/0017-environment-map-generated-in-the-browser.md`
- Modify: `src/deck/scene/build.ts:90-95`
- Test: `tests/e2e/scene-perf.spec.ts` (rewritten)

**Interfaces:**
- Consumes: `idle()` from `src/deck/scene/textures.ts` (existing).
- Produces: in test builds only, the performance measure `deck:environment` (from the mark `deck:environment:start`), which the spec reads.

- [ ] **Step 1: Rewrite the opt-in spec**

Replace `tests/e2e/scene-perf.spec.ts` with:

```ts
import { expect, test } from "@playwright/test";

// Spec 11: no scene task over 50ms at 4× CPU throttle, except one: generating the environment map, about 70ms at 4×,
// once, before the canvas shows, while the poster is still on screen (ADR-0017). Opt-in, and only meaningful with a GPU:
//   SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium --headed
// CI and headless runs draw WebGL in software, which is no guide, so the spec skips itself there.
type Task = { start: number; duration: number };

test("no scene task blocks the main thread for more than 50ms at 4× CPU, the environment map aside", async ({ page, browserName }) => {
  test.skip(process.env.SCENE_PERF !== "1", "opt-in: set SCENE_PERF=1");
  test.skip(browserName !== "chromium", "CPU throttling is Chromium-only");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/", { waitUntil: "networkidle" });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  });
  test.skip(/swiftshader|llvmpipe/i.test(renderer), "software rendering is no guide");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const tasks: { start: number; duration: number }[] = [];
    (window as unknown as { longTasks: typeof tasks }).longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask" });
  });
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 150_000 });
  await page.locator(".tracks button").first().click();
  await expect.poll(() => page.evaluate(() => window.__deck!.state().playing), { timeout: 60_000 }).toBe(0);
  const { tasks, environment } = await page.evaluate(() => {
    const measure = performance.getEntriesByName("deck:environment", "measure")[0];
    return {
      tasks: (window as unknown as { longTasks: { start: number; duration: number }[] }).longTasks,
      environment: measure ? { start: measure.startTime, duration: measure.duration } : null,
    };
  });
  console.log("long tasks (ms)", tasks.map((task) => Math.round(task.duration)), "environment map (ms)", environment && Math.round(environment.duration));
  expect(environment, "a test build marks the environment map").not.toBeNull();
  const overlaps = (task: Task) => task.start < environment!.start + environment!.duration && task.start + task.duration > environment!.start;
  const atEnvironment = tasks.filter(overlaps);
  expect(tasks.filter((task) => !overlaps(task)).map((task) => Math.round(task.duration))).toEqual([]);
  expect(atEnvironment.length).toBeLessThanOrEqual(1);
  for (const task of atEnvironment) expect(task.duration).toBeLessThan(100);
});
```

Run: `bun run build:test && pkill -f "port 433[1234]"; SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium --headed`
Expected: FAIL with "a test build marks the environment map" (no measure yet). If it instead skips with "software rendering is no guide", the machine has no GPU for headed Chromium: run Steps 2 and 3 anyway and record that in the task report.

- [ ] **Step 2: Give the step its own idle task and measure it**

In `src/deck/scene/build.ts`, replace the first four lines of `buildStage`'s body (from `const scene = new Scene();` to `pmrem.dispose();`) with:

```ts
  const scene = new Scene();
  // The one scene task allowed over 50ms (about 70ms at 4× CPU, once, before the canvas shows, while the poster is still
  // on screen; spec 11 and ADR-0017). It gets an idle moment of its own, so nothing else lands in the same task
  await idle();
  if (__TEST_HOOKS__) performance.mark("deck:environment:start");
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  if (__TEST_HOOKS__) performance.measure("deck:environment", "deck:environment:start");
```

Run: `bun run typecheck`
Expected: 0 errors.

Run: `bun run build && grep -l "deck:environment" dist/client/_astro/*.js; echo "exit $?"`
Expected: no file listed and `exit 1`: production builds carry nothing extra.

Run: `bun run build:test && grep -l "deck:environment" dist/client/_astro/scene.*.js`
Expected: the scene chunk is listed.

- [ ] **Step 3: Run the opt-in spec and the scene specs**

Run: `pkill -f "port 433[1234]"; SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium --headed`
Expected: PASS, with the log line showing one task of about 70ms at most and the environment map's measure. If another task over 50ms appears, commit the change and the ADR anyway (the decision is George's), report the task's duration and what overlaps it, and leave the spec failing on that task, named in the task report for Task 17's follow-ups. Don't widen the exception.

Run: `bun run test:e2e tests/e2e/deck-scene.spec.ts tests/e2e/deck-journeys.spec.ts --project=chromium`
Expected: every test passes (the scene still mounts and plays).

- [ ] **Step 4: Write ADR-0017**

Create `docs/adr/0017-environment-map-generated-in-the-browser.md`:

```markdown
# ADR-0017: The listening corner's environment map is generated in the browser

- Status: Accepted
- Date: 2026-10-05
- Authors: George Vlachos

## Context

The 3D scene lights its materials with an environment map made by `PMREMGenerator.fromScene` from three's `RoomEnvironment`. Plan 2 measured that step at 66 to 75ms at 4× CPU throttle (about 18ms unthrottled), one main-thread task before the canvas shows, against spec 11's rule of no scene task over 50ms. The alternative was to precompute the map and ship it. In three 0.169, `fromScene` always renders a 256 cube and its output is a 768 × 1024 half-float texture, megabytes raw; a precompute that really is a few KB (six small faces or a small equirect) still goes through the PMREM blur in the browser, whose shader compile is probably most of the 70ms.

## Decision

Generate the map in the browser and accept the one-off hitch. The step runs in an idle task of its own at the start of `buildStage`, once per visit, before the canvas replaces the poster, so nothing on screen is moving for it to jank and touch scrolling runs off the main thread. Spec 11 names it as the single allowed exception: "No scene task over 50ms at 4× CPU throttle, except one: generating the environment map, about 70ms at 4×, once, before the canvas shows, while the poster is still on screen." Test builds wrap it in a `deck:environment` measure, and the opt-in `scene-perf.spec.ts` allows one long task overlapping that measure, under 100ms, and fails on any other.

## Consequences

Nobody downloads extra bytes or makes an extra request for a 70ms step nobody sees. A press that lands inside those 70ms waits up to 70ms more; on a slow phone that one press could go over the 200ms interaction budget, at most once per visit. The budget is checked locally on a GPU (`SCENE_PERF=1 ... --headed`); CI draws WebGL in software, so it is reported there, not gated. If a real phone shows far more than 70ms, revisit with a measured breakdown of compile time against GPU time.

## Alternatives considered

- **Precompute the map and ship it:** swaps 70ms nobody sees for bytes and a request every visitor pays for, and a small precompute would likely not remove the hitch, since the blur still compiles in the browser.
- **Leave the step where it was:** it shared a task with the last texture slice, the glow canvas and the cover promise's continuation, about 8ms more on top.
```

- [ ] **Step 5: Commit**

```bash
git add src/deck/scene/build.ts tests/e2e/scene-perf.spec.ts docs/adr/0017-environment-map-generated-in-the-browser.md
git commit -m "perf: the environment map gets its own idle task and is the one scene task allowed over 50ms (ADR-0017)"
```

---

### Task 3: a changed mind during the download moves nothing

George's answer to plan 2's question 4: a record that hasn't started moving when `want` changes never leaves the crate. The runner waits for a downloading scene before anything leaves the crate, then checks `want` again. A record that has already moved still makes the full reverse journey (spec 5.3). This task also closes plan 4's test gap "a record dropped mid-load": a record taken back on its way to the platter is never counted as played.

**Files:**
- Modify: `src/deck/runner.ts` (`viewForStep`'s comment, the start of `load`)
- Test: `tests/unit/runner.test.ts`, `tests/e2e/deck-scene.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new names; `Deck`'s behaviour changes only while `connect`'s promise is pending.

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/runner.test.ts`, add inside `describe("deck runner with a scene", ...)`, after `"waits for a scene that is still loading, then animates"`:

```ts
  test("a different press during the download skips the first record's journey", async () => {
    const { deck, audio } = setup();
    const scene = fakeView(100);
    let resolve!: (view: DeckView) => void;
    deck.connect(new Promise((r) => (resolve = r)));
    deck.toggle(0);
    clock = 500;
    deck.toggle(1);
    resolve(scene.view);
    await settle(5000);
    expect(scene.calls).toEqual(["flip 1", "load 1"]);
    expect(starts(audio.calls)).toEqual(["start /media/audio/b.mp3"]);
    expect(deck.getState()).toMatchObject({ want: 1, current: 1, playing: 1, busy: false });
  });

  test("a stop during the download moves nothing", async () => {
    const { deck, audio } = setup();
    const scene = fakeView(100);
    let resolve!: (view: DeckView) => void;
    deck.connect(new Promise((r) => (resolve = r)));
    deck.toggle(0);
    clock = 500;
    deck.toggle(0);
    resolve(scene.view);
    await settle(5000);
    expect(scene.calls).toEqual([]);
    expect(starts(audio.calls)).toEqual([]);
    expect(deck.getState()).toMatchObject({ want: null, current: null, busy: false });
  });

  test("a record taken back on its way to the platter is never counted as played", async () => {
    const audio = fakeAudio();
    const played: number[] = [];
    const deck = createDeck({ tracks, audio, announce: () => {}, now: () => clock, played: (index) => played.push(index) });
    const scene = fakeView(1000);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    await settle(500); // record 0 is on its way
    clock = 500;
    deck.toggle(1);
    await settle(10_000);
    expect(played).toEqual([1]);
    clock = 20_000;
    deck.toggle(1); // stop, so the next press starts from an empty platter
    await settle(10_000);
    clock = 40_000;
    deck.toggle(2);
    await settle(500); // record 2 is on its way
    clock = 40_600;
    deck.toggle(2); // and is taken back before it lands
    await settle(10_000);
    expect(played).toEqual([1]);
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null });
  });
```

Run: `bun run test:unit tests/unit/runner.test.ts`
Expected: the first two new tests FAIL (record 0 is loaded and unloaded: `scene.calls` starts with `"load 0"`, `"unload 0"`); the third passes already (it pins behaviour the change must keep). Every existing test passes.

- [ ] **Step 2: Wait before anything leaves the crate**

In `src/deck/runner.ts`, replace the comment above `viewForStep` with:

```ts
  // A step waits for a scene that is still downloading, so the first record still makes its journey. load() waits here
  // before anything leaves the crate, so a press undone during the download moves nothing (plan 2's question 4)
```

and replace the first line of `load`'s body (`current = index;`) with:

```ts
    if (pending) {
      // Only while a scene downloads: with one attached, or none coming, presses run exactly as before
      await viewForStep();
      if (want !== index) return; // they changed their mind while it downloaded: nothing moved, nothing to take back
    }
    current = index;
```

`current` stays `null` on that return, so `run()`'s loop goes straight to the new `want`, or stops when it's `null`. The waits inside `animate` return at once after this one, because `connect` clears `pending` when the scene settles and the 5s timeout clears it too.

Run: `bun run test:unit tests/unit/runner.test.ts`
Expected: PASS, including `"runs one journey at a time and only the last of several quick presses plays"` (`["load 0", "unload 0", "flip 3", "load 3"]` unchanged) and `"stopping before the record lands plays nothing and takes it back"`.

- [ ] **Step 3: The download case end to end**

In `tests/e2e/deck-scene.spec.ts`, add after `"a press during the scene download waits for it, then plays with one scene"`:

```ts
test("a different press during the scene download plays only the second record; the first never leaves the crate", async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  // How far record 0's sleeve ever rose, and whether its disc ever showed, read on every frame once the scene exists
  await page.addInitScript(() => {
    const first = { lifted: 0, out: false };
    (window as unknown as { first: typeof first }).first = first;
    const watch = () => {
      const record = window.__deckScene?.offsets()[0];
      if (record) {
        first.lifted = Math.max(first.lifted, record.lifted);
        first.out ||= record.visible;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(SCENE, async (route) => {
    await gate;
    await route.continue();
  });
  const asked = page.waitForRequest(SCENE);
  await page.goto("/");
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await asked;
  const rows = page.locator(".tracks li");
  await rows.nth(0).locator("button").click();
  // No wait between: a different record isn't held by the double-press guard, and the runner's 5s wait for the scene
  // starts at the first press
  await rows.nth(1).locator("button").click();
  await expect(rows.nth(1).locator(".st")).toHaveText("cueing");
  release();
  await playing(page, 1, 60_000 * SLOW);
  await settled(page);
  await expectSeated(page);
  expect(await page.evaluate(() => (window as unknown as { first: { lifted: number; out: boolean } }).first)).toEqual({ lifted: 0, out: false });
});
```

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-scene.spec.ts --project=chromium --project=webkit`
Expected: every test passes (the new one skips where there's no WebGL).

- [ ] **Step 4: Commit**

```bash
git add src/deck/runner.ts tests/unit/runner.test.ts tests/e2e/deck-scene.spec.ts
git commit -m "fix: a press undone while the scene downloads moves nothing out of the crate"
```

---

### Task 4: the scratch is mouse only

George's answer to plan 2's question 5: drop pen. With `touch-action: manipulation`, a pen on a touch screen can't scratch anyway, and it can pass the 6px threshold before the browser takes the gesture as a scroll: the music warbles while the page scrolls and `scratch_found` is counted for a scratch that never happened. The hover preview is already mouse only. A pen tap on the record still stops it (the click handler is unchanged).

**Files:**
- Modify: `src/deck/scene/pointer.ts` (the `pointerdown` listener)
- Test: `tests/e2e/deck-scratch.spec.ts`

**Interfaces:**
- Consumes: the `beforeEach` in `deck-scratch.spec.ts` (scene open, `LONG_TRACK` playing, settled) and `platterOnScreen`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `tests/e2e/deck-scratch.spec.ts`, add after the two scratch tests:

```ts
test("a pen on the spinning record doesn't scratch it: pens, like touch, keep scrolling the page", async ({ page }) => {
  const record = await platterOnScreen(page);
  // The page dispatches the pen's drag itself (Playwright has no pen), and records what it hears
  const heard = await page.evaluate(async ({ x, y, rx, ry }) => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-deck] canvas")!;
    const element = document.querySelector<HTMLAudioElement>("audio[data-deck-audio]")!;
    const rates: number[] = [];
    const events: string[] = [];
    element.addEventListener("ratechange", () => rates.push(element.playbackRate));
    document.addEventListener("logbook:track", (event) => events.push(event.detail.event));
    const pen = (type: string, clientX: number, clientY: number) =>
      canvas.dispatchEvent(new PointerEvent(type, { pointerType: "pen", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, clientX, clientY, buttons: type === "pointerup" ? 0 : 1 }));
    pen("pointerdown", x + rx, y);
    for (let step = 1; step <= 12; step++) {
      const angle = (step / 12) * Math.PI;
      pen("pointermove", x + rx * Math.cos(angle), y + ry * Math.sin(angle));
    }
    pen("pointerup", x - rx, y);
    await new Promise((resolve) => setTimeout(resolve, 500)); // ratechange and the event would have arrived by now
    return { rates, events };
  }, record);
  expect(heard).toEqual({ rates: [], events: [] });
  expect((await audioState(page)).rate).toBe(1);
  expect(await deckState(page)).toMatchObject({ want: LONG_TRACK, playing: LONG_TRACK });
});
```

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-scratch.spec.ts --project=chromium -g "a pen"`
Expected: FAIL: `rates` holds the bent rates and `events` holds `"scratch_found"`.

- [ ] **Step 2: Mouse only**

In `src/deck/scene/pointer.ts`, in the `pointerdown` listener, replace:

```ts
    if (event.pointerType === "touch") return; // touch keeps scrolling the page
```

with:

```ts
    if (event.pointerType !== "mouse") return; // touch and pen keep scrolling the page; a pen tap still stops the record (click)
```

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-scratch.spec.ts --project=chromium --project=webkit`
Expected: every test passes; the mouse scratches still bend the rate.

- [ ] **Step 3: Commit**

```bash
git add src/deck/scene/pointer.ts tests/e2e/deck-scratch.spec.ts
git commit -m "fix: only a mouse scratches the record; pens, like touch, scroll the page"
```

---

### Task 5: the hint says only what's true

George's answer to plan 2's question 2: the hint names ‹ › only while the scene is live; otherwise it reads `pick a track. nothing plays until you do.` Both sentences sit in one grid cell, so the line always keeps the longer one's height and nothing shifts. `.live` already follows the scene (added on its first frame, removed on a lost context), so no script changes. `visibility: hidden` also takes the hidden sentence out of the accessibility tree. The rules are scoped to `.corner > .hint`, because the crate control's buttons use a `.hint` class too (a plan 2 follow-up).

**Files:**
- Modify: `src/components/Turntable.astro` (the hint), `src/styles/deck.css` (the `.hint` rule)
- Test: `tests/unit/turntable.test.ts`, `tests/e2e/deck-scene.spec.ts`

**Interfaces:**
- Consumes: `.deck.live` (existing).
- Produces: `.corner > .hint` holding `.hint-scene` and `.hint-list`; Task 6's no-JavaScript spec reads `.hint-list`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/turntable.test.ts`, in `"has the deck, the hint, a polite live region and one audio element that preloads nothing"`, replace the `.hint` assertion with:

```ts
    expect(text(doc.querySelector(".hint .hint-scene"))).toBe("flip through the crate with ‹ ›, or pick a track. nothing plays until you do.");
    expect(text(doc.querySelector(".hint .hint-list"))).toBe("pick a track. nothing plays until you do.");
```

In `tests/e2e/deck-scene.spec.ts`, in `"without WebGL the scene never loads and the list plays and stops every record"`, add after the poster's `expect.poll`:

```ts
  // No scene, no ‹ ›: only the short hint shows
  await expect(page.locator(".corner > .hint .hint-list")).toBeVisible();
  await expect(page.locator(".corner > .hint .hint-scene")).toBeHidden();
```

and add these tests at the end of the file:

```ts
for (const viewport of [{ width: 1280, height: 720 }, { width: 375, height: 812 }]) {
  test(`at ${viewport.width}px the hint names ‹ › only while the scene is live, and its line never changes height`, async ({ page }) => {
    test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
    // At 375px the long sentence wraps to two lines, and the short one must keep that height
    await page.setViewportSize(viewport);
    await page.goto("/");
    const hint = page.locator(".corner > .hint");
    const full = hint.locator(".hint-scene");
    const short = hint.locator(".hint-list");
    await expect(short).toBeVisible();
    await expect(full).toBeHidden();
    const height = (await hint.boundingBox())!.height;
    await page.locator("[data-deck]").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 45_000 * SLOW });
    await expect(full).toBeVisible();
    await expect(short).toBeHidden();
    expect((await hint.boundingBox())!.height).toBe(height);
    await page.evaluate(() => window.__deckScene!.loseContext());
    await expect(page.locator("[data-deck].live")).toHaveCount(0);
    await expect(short).toBeVisible();
    await expect(full).toBeHidden();
  });
}
  await expect(full).toBeVisible();
  await expect(short).toBeHidden();
  expect((await hint.boundingBox())!.height).toBe(height);
  await page.evaluate(() => window.__deckScene!.loseContext());
  await expect(page.locator("[data-deck].live")).toHaveCount(0);
  await expect(short).toBeVisible();
  await expect(full).toBeHidden();
});
```

Run: `bun run test:unit tests/unit/turntable.test.ts`
Expected: FAIL: no `.hint-scene`.

- [ ] **Step 2: Two sentences in one cell**

In `src/components/Turntable.astro`, replace the hint paragraph with:

```astro
    <p class="hint mono">
      <span class="hint-scene">flip through the crate with ‹ ›, or pick a track. nothing plays until you do.</span>
      <span class="hint-list">pick a track. nothing plays until you do.</span>
    </p>
```

In `src/styles/deck.css`, replace `.hint { margin-top: 12px; font-size: 12px; color: var(--muted); }` with:

```css
/* The hint names ‹ › only while the scene, and so the crate control, is live; otherwise the short sentence shows. Both
   share one grid cell, so the line keeps the longer one's height and nothing shifts, and the hidden one is out of the
   accessibility tree. Scoped to the corner's own line: the crate control's buttons use a .hint class too */
.corner > .hint { display: grid; margin-top: 12px; font-size: 12px; color: var(--muted); }
.corner > .hint > span { grid-area: 1 / 1; }
.deck:not(.live) ~ .hint .hint-scene, .deck.live ~ .hint .hint-list { visibility: hidden; }
```

Run: `bun run test:unit tests/unit/turntable.test.ts`
Expected: PASS.

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-scene.spec.ts tests/e2e/deck-crate.spec.ts tests/e2e/perf.spec.ts tests/e2e/layout.spec.ts`
Expected: every test passes, including the hint's height at 1280px and at 375px, where the long sentence wraps.

- [ ] **Step 3: Commit**

```bash
git add src/components/Turntable.astro src/styles/deck.css tests/unit/turntable.test.ts tests/e2e/deck-scene.spec.ts
git commit -m "fix: the hint names the crate's arrows only while the scene shows them"
```

---

### Task 6: without JavaScript, each track is a link that plays

George's answer to plan 2's question 6: each track is a plain link to its MP3 in the HTML, and the deck script turns each link into the play button it is today. Without JavaScript, `play` opens the track in the browser's own player, so every word on the row (and Task 5's short hint) is true in both modes. `/media/` already serves MP3s with their stored type, no `Content-Disposition` and range support, so the browser plays the file inline. This task also closes plan 4's test gap "a Turntable button without `data-id`".

**Files:**
- Create: `src/deck/rows.ts`
- Modify: `src/components/Turntable.astro` (the rows), `src/scripts/deck.ts`, `src/styles/deck.css` (the track rows)
- Test: `tests/unit/rows.test.ts`, `tests/unit/turntable.test.ts`, `tests/e2e/deck-list.spec.ts`

**Interfaces:**
- Consumes: `.corner > .hint .hint-list` (Task 5); `bindList` (binds `button[data-index]`, unchanged); `TrackProperties` from `src/lib/track.ts`.
- Produces: `rows.ts`: `upgradeRows(list: HTMLElement): HTMLButtonElement[]`, `trackOf(button: HTMLElement): DeckTrack`, `playedProperties(id: string | undefined): TrackProperties`. Each row is `a.pick` in the HTML and `button.pick` once the script runs. Task 8 edits `src/scripts/deck.ts` as written here.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/rows.test.ts`:

```ts
import { parseHTML } from "linkedom";
import { describe, expect, test } from "vitest";
import { playedProperties, trackOf, upgradeRows } from "../../src/deck/rows";

// Two rows as Turntable.astro renders them; the second has no id
const html = `<ol class="tracks">
  <li><a class="pick" href="/media/audio/a.mp3" data-index="0" data-id="1" data-src="/media/audio/a.mp3" data-cover="/media/covers/a.webp" data-title="simple things" data-artist="loom room"><span class="side mono">a1</span> <span class="tt">simple things <span class="aside">- loom room</span></span> <span class="st mono">play</span></a></li>
  <li><a class="pick" href="/media/audio/b.mp3" data-index="1" data-src="/media/audio/b.mp3" data-cover="/media/covers/b.webp" data-title="nyc in 1940" data-artist="berlioz"><span class="side mono">a2</span> <span class="tt">nyc in 1940</span> <span class="st mono">play</span></a></li>
</ol>`;
const list = () => parseHTML(html).document.querySelector(".tracks") as unknown as HTMLElement;

describe("upgradeRows", () => {
  test("turns each track's link into a play button with the same data and words, and no address", () => {
    const tracks = list();
    const buttons = upgradeRows(tracks);
    expect(tracks.querySelectorAll("a")).toHaveLength(0);
    expect(buttons).toHaveLength(2);
    const [first] = buttons;
    expect(first.tagName).toBe("BUTTON");
    expect(first.getAttribute("type")).toBe("button");
    expect(first.getAttribute("class")).toBe("pick");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(first.hasAttribute("href")).toBe(false);
    expect([first.dataset.index, first.dataset.id, first.dataset.src, first.dataset.title]).toEqual(["0", "1", "/media/audio/a.mp3", "simple things"]);
    expect(first.querySelector(".st")?.textContent).toBe("play");
    expect(first.textContent?.replace(/\s+/g, " ").trim()).toBe("a1 simple things - loom room play");
  });

  test("leaves buttons that are already buttons alone", () => {
    const tracks = list();
    upgradeRows(tracks);
    expect(upgradeRows(tracks)).toHaveLength(2);
  });
});

test("a row's track is what the runner plays", () => {
  const [first] = upgradeRows(list());
  expect(trackOf(first)).toEqual({ title: "simple things", artist: "loom room", src: "/media/audio/a.mp3", cover: "/media/covers/a.webp" });
});

test("record_played carries the record's id, and a row without one is still counted, without it", () => {
  expect(playedProperties("1")).toEqual({ record_id: 1 });
  expect(playedProperties(undefined)).toEqual({});
  expect(playedProperties("not a number")).toEqual({});
});
```

In `tests/unit/turntable.test.ts`, replace the body of `"lists every record with its side, artist and a play state"` after its first `expect` with:

```ts
    // A link to the MP3, so the row plays without JavaScript; the deck script makes it a button
    const link = doc.querySelector(".tracks a.pick")!;
    expect(link.getAttribute("href")).toBe("/media/audio/simple-things.mp3");
    expect(link.hasAttribute("type")).toBe(false);
    expect(link.hasAttribute("aria-pressed")).toBe(false);
    expect(link.getAttribute("data-index")).toBe("0");
    expect(link.getAttribute("data-id")).toBe("1");
    expect(link.getAttribute("data-src")).toBe("/media/audio/simple-things.mp3");
    expect(link.getAttribute("data-cover")).toBe("/media/covers/simple-things.webp");
    expect(link.getAttribute("data-title")).toBe("simple things");
    expect(link.getAttribute("data-artist")).toBe("loom room");
    expect(doc.querySelector(".tracks button")).toBeNull();
```

Run: `bun run test:unit tests/unit/rows.test.ts tests/unit/turntable.test.ts`
Expected: FAIL: `src/deck/rows` doesn't exist; the turntable test finds no `a.pick`.

- [ ] **Step 2: The rows**

Create `src/deck/rows.ts`:

```ts
import type { TrackProperties } from "../lib/track";
import type { DeckTrack } from "./types";

/**
 * Without JavaScript each track is a link to its MP3, which the browser plays in its own player (spec 4.1). The deck
 * script turns each link into the play button it binds, keeping its data and its words, before anything reads the rows.
 * Both forms share the .pick class and look the same, so the swap can't shift anything.
 */
export function upgradeRows(list: HTMLElement): HTMLButtonElement[] {
  for (const link of [...list.querySelectorAll<HTMLAnchorElement>("a.pick")]) {
    const button = link.ownerDocument.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("class", "pick");
    button.setAttribute("aria-pressed", "false");
    for (const { name, value } of Array.from(link.attributes)) {
      if (name.startsWith("data-")) button.setAttribute(name, value);
    }
    button.append(...Array.from(link.childNodes));
    link.replaceWith(button);
  }
  return [...list.querySelectorAll<HTMLButtonElement>("button[data-index]")];
}

/** A row's record, as the runner plays it */
export const trackOf = (button: HTMLElement): DeckTrack => ({
  title: button.dataset.title ?? "",
  artist: button.dataset.artist ?? "",
  src: button.dataset.src ?? "",
  cover: button.dataset.cover ?? "",
});

/** record_played's properties: the record's id, or none for a row without one, which is still counted */
export function playedProperties(id: string | undefined): TrackProperties {
  const value = Number.parseInt(id ?? "", 10);
  return Number.isNaN(value) ? {} : { record_id: value };
}
```

Replace `src/scripts/deck.ts` with:

```ts
import { createAudioPort } from "../deck/audio";
import { bindList } from "../deck/list";
import { playedProperties, trackOf, upgradeRows } from "../deck/rows";
import { createDeck } from "../deck/runner";
import type { Deck } from "../deck/types";
import type { TrackDetail } from "../lib/track";

// The deck runner: no Three.js, no dynamic import, inlined into the page, so playback never depends on a hashed
// file or on WebGL (spec 5.1). The scene loader finds the runner on the deck host.
const host = document.querySelector<HTMLElement & { deck?: Deck }>("[data-deck]");
const list = document.querySelector<HTMLElement>(".tracks");
const element = document.querySelector<HTMLAudioElement>("[data-deck-audio]");
const status = document.querySelector<HTMLElement>("[data-deck-status]");

if (host && list && element && status) {
  // Links to the MP3s in the HTML, play buttons from here on
  const buttons = upgradeRows(list);
  const ids = buttons.map((button) => button.dataset.id);
  const deck = createDeck({
    tracks: buttons.map(trackOf),
    audio: createAudioPort(element),
    // Cleared first and set on the next frame, so a repeated message is announced again
    announce: (message) => {
      status.textContent = "";
      requestAnimationFrame(() => {
        status.textContent = message;
      });
    },
    played: (index) => {
      document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "record_played", properties: playedProperties(ids[index]) } }));
    },
  });
  host.deck = deck;
  bindList(list, deck);
  if (__TEST_HOOKS__) {
    window.__deck = {
      state: () => deck.getState(),
      audio: () => ({
        paused: element.paused,
        src: element.currentSrc ? new URL(element.currentSrc).pathname : (element.getAttribute("src") ?? ""),
        rate: element.playbackRate,
      }),
    };
  }
}
```

In `src/components/Turntable.astro`, replace the `<li>` inside `records.map` with:

```astro
        <li>
          <a
            class="pick"
            href={media(record.audioKey)}
            data-index={index}
            data-id={record.id}
            data-src={media(record.audioKey)}
            data-cover={media(record.coverKey)}
            data-title={record.title}
            data-artist={record.artist}
          >
            <span class="side mono">{record.side}</span>{" "}
            <span class="tt">{record.title} <span class="aside">- {record.artist}</span></span>{" "}
            <span class="st mono">play</span>
          </a>
        </li>
```

In `src/styles/deck.css`, replace the `.tracks button { ... }` rule with:

```css
/* A link to its MP3 without JavaScript, a play button with it (src/deck/rows.ts): both look the same */
.tracks .pick {
  width: 100%; display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: baseline; text-align: left;
  background: none; border: 0; padding: 8px 0; cursor: pointer; color: inherit; text-decoration: none;
}
```

and, in the hover block below it, replace `.tracks button:hover .st` with `.tracks .pick:hover .st`.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes, `rows.test.ts` and `list.test.ts` among them.

- [ ] **Step 3: The rows end to end, with and without JavaScript**

In `tests/e2e/deck-list.spec.ts`, add at the end:

```ts
test("the script turns each track's link into a play button before anything binds", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tracks a.pick")).toHaveCount(0);
  const first = page.locator(".tracks .pick").first();
  await expect(first).toHaveJSProperty("tagName", "BUTTON");
  await expect(first).toHaveAttribute("type", "button");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(first).not.toHaveAttribute("href", /.*/);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("each track is a link to its MP3, and the hint says only what's true", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator(".tracks li")).toHaveCount(4);
    await expect(page.locator(".tracks button")).toHaveCount(0);
    const hrefs = await page.locator(".tracks a.pick").evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    expect(hrefs).toHaveLength(4);
    for (const href of hrefs) {
      // Two bytes are enough to show the browser would get the file, as audio, ready to stream
      const response = await request.get(href, { headers: { Range: "bytes=0-1" } });
      expect(response.status(), href).toBe(206);
      expect(response.headers()["content-type"], href).toBe("audio/mpeg");
    }
    await expect(page.locator(".corner > .hint .hint-list")).toBeVisible();
    await expect(page.locator(".corner > .hint .hint-scene")).toBeHidden();
  });
});
```

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-list.spec.ts tests/e2e/deck-scene.spec.ts tests/e2e/analytics.spec.ts tests/e2e/privacy.spec.ts tests/e2e/logbook.spec.ts tests/e2e/budgets.spec.ts`
Expected: every test passes; `analytics.spec.ts` still sees `record_id: 1`; the budgets still hold.

- [ ] **Step 4: Commit**

```bash
git add src/deck/rows.ts src/scripts/deck.ts src/components/Turntable.astro src/styles/deck.css tests/unit/rows.test.ts tests/unit/turntable.test.ts tests/e2e/deck-list.spec.ts
git commit -m "feat: without JavaScript each track is a link to its MP3; the deck makes it a play button"
```

---

### Task 7: posters with a plain sleeve, by day and by night

George's answer to plan 2's question 3: re-render both posters with one plain, unprinted sleeve in the crate's front slot instead of an empty crate. The corner only renders with at least one active record, so a record in the crate is always true, and at take-over the cover art arrives on a sleeve that's already there. Decided after the answers: between 19:00 and 06:00 in Sydney the scene renders by candlelight, so a night pair of posters stands in for it then. The page is edge-cached for a day, so an inline script picks the night pair before the poster paints; without JavaScript the day pair shows.

**Files:**
- Create: `src/scripts/night-poster.mjs`, `public/posters/deck-desktop-night.webp`, `public/posters/deck-phone-night.webp`, `tests/unit/night-poster.test.ts`, `tests/e2e/posters.spec.ts`
- Modify: `src/deck/scene/hooks.ts` (`poster()`), `scripts/poster.mjs`, `public/posters/deck-desktop.webp`, `public/posters/deck-phone.webp`, `src/components/Turntable.astro` (the deck box), `astro.config.mjs` (`scriptDirective`)
- Test: `tests/unit/media-files.test.ts`, `tests/unit/turntable.test.ts`, `tests/e2e/deck-phone.spec.ts` (its poster check runs at noon)

**Interfaces:**
- Consumes: `lightFor(date)` from `src/deck/scene/lighting.ts` (the test checks the script against it); `withoutWebGL` from `tests/e2e/deck.ts`.
- Produces: `NIGHT_POSTER: string` from `src/scripts/night-poster.mjs`; `/posters/deck-desktop-night.webp` and `/posters/deck-phone-night.webp`; `SceneHooks.poster()` now leaves one plain sleeve.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/night-poster.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { lightFor } from "../../src/deck/scene/lighting";
import { NIGHT_POSTER } from "../../src/scripts/night-poster.mjs";

// Runs the inline script against a picture like the deck's, at a given moment, and returns its two addresses
function posterAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const element = (tagName: string, name: string, value: string) => {
    const attributes = new Map([[name, value]]);
    return { tagName, getAttribute: (key: string) => attributes.get(key) ?? null, setAttribute: (key: string, next: string) => void attributes.set(key, next) };
  };
  const source = element("SOURCE", "srcset", "/posters/deck-phone.webp");
  const img = element("IMG", "src", "/posters/deck-desktop.webp");
  const picture = { querySelectorAll: () => [source, img] };
  new Function("document", NIGHT_POSTER)({ currentScript: { previousElementSibling: picture } });
  return [source.getAttribute("srcset"), img.getAttribute("src")];
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test.each([
  ["2026-10-05T02:00:00Z", false], // 13:00 in Sydney (AEDT)
  ["2026-10-05T07:59:00Z", false], // 18:59
  ["2026-10-05T08:00:00Z", true], // 19:00
  ["2026-10-04T18:59:00Z", true], // 05:59 on the 5th
  ["2026-10-04T19:00:00Z", false], // 06:00
  ["2026-07-01T08:59:00Z", false], // 18:59 in winter (AEST)
  ["2026-07-01T09:00:00Z", true], // 19:00 in winter
])("at %s the night poster is %s, as the scene's own light says", (iso, night) => {
  expect(lightFor(new Date(iso)).mood === "night").toBe(night);
  const suffix = night ? "-night" : "";
  expect(posterAt(iso)).toEqual([`/posters/deck-phone${suffix}.webp`, `/posters/deck-desktop${suffix}.webp`]);
});
```

In `tests/unit/media-files.test.ts`, replace the `test.each` table in `describe("the posters", ...)` with:

```ts
  test.each([
    ["deck-desktop", 16 / 10.8],
    ["deck-phone", 375 / 320],
    ["deck-desktop-night", 16 / 10.8],
    ["deck-phone-night", 375 / 320],
  ])("%s is a WebP under 60KB in the deck's shape", async (name, aspect) => {
```

(the test's body is unchanged).

In `tests/unit/turntable.test.ts`, add the import:

```ts
import { NIGHT_POSTER } from "../../src/scripts/night-poster.mjs";
```

and in `"has the deck, the hint, a polite live region and one audio element that preloads nothing"`, after the two poster assertions:

```ts
    // The night poster's script runs straight after the picture, before it paints, with exactly the text the CSP hashes
    expect(doc.querySelector("[data-deck] .poster + script")?.textContent).toBe(NIGHT_POSTER);
```

Create `tests/e2e/posters.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { withoutWebGL } from "./deck";

// Spec 5.2: the poster stands in for the scene, so from 19:00 to 06:00 in Sydney it shows the room by candlelight. The
// page is cached at the edge for a day, so an inline script picks the poster before it paints (only one is ever
// fetched); without JavaScript the day poster shows. The night poster showing also proves the CSP allowed the script.
const NOON = new Date("2026-10-05T02:00:00Z"); // 13:00 in Sydney
const NIGHT = new Date("2026-10-05T11:00:00Z"); // 22:00 in Sydney

async function poster(page: Page) {
  const img = page.locator("[data-deck] .poster img");
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return img.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname);
}

const fetched = (page: Page) => {
  const posters: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/posters/")) posters.push(path);
  });
  return posters;
};

test.beforeEach(({ page }) => withoutWebGL(page));

test("by day, the day poster", async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  await page.goto("/");
  expect(await poster(page)).toBe("/posters/deck-desktop.webp");
});

test("at night, the night poster, and only it is fetched", async ({ page }) => {
  const posters = fetched(page);
  await page.clock.setFixedTime(NIGHT);
  await page.goto("/");
  expect(await poster(page)).toBe("/posters/deck-desktop-night.webp");
  expect(posters).toEqual(["/posters/deck-desktop-night.webp"]);
});

test("on a phone at night, the phone's night poster", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.setFixedTime(NIGHT);
  await page.goto("/");
  expect(await poster(page)).toBe("/posters/deck-phone-night.webp");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the day poster, whatever the time", async ({ page }) => {
    await page.goto("/");
    expect(await poster(page)).toBe("/posters/deck-desktop.webp");
  });
});
```

In `tests/e2e/deck-phone.spec.ts`, in `"without WebGL a phone gets the phone poster"`, add before `await page.goto("/");` (after dark the phone would rightly get the night poster):

```ts
  await page.clock.setFixedTime(new Date("2026-10-05T02:00:00Z")); // 13:00 in Sydney: the day poster
```

Run: `bun run test:unit tests/unit/night-poster.test.ts tests/unit/media-files.test.ts tests/unit/turntable.test.ts`
Expected: FAIL: `night-poster.mjs` doesn't exist and the night WebPs are missing (`ENOENT`).

- [ ] **Step 2: The script, its hash and the markup**

Create `src/scripts/night-poster.mjs`:

```js
// The poster that stands in for the scene (spec 5.2). From 19:00 to 06:00 in Sydney the scene is candlelit (lighting.ts),
// so its poster is the night one. The page is cached at the edge for a day, so the server can't choose: this runs inline,
// straight after the poster's <picture> and before it paints, so only one poster is ever fetched. Without JavaScript the
// day poster shows. astro.config.mjs allows exactly this text by its hash, and Turntable.astro renders it unchanged.
export const NIGHT_POSTER = `(() => {
  const picture = document.currentScript.previousElementSibling;
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).format(new Date()));
  } catch {
    return;
  }
  if (hour >= 6 && hour < 19) return;
  for (const element of picture.querySelectorAll("source, img")) {
    const name = element.tagName === "IMG" ? "src" : "srcset";
    element.setAttribute(name, element.getAttribute(name).replace(/\\.webp$/, "-night.webp"));
  }
})();`;
```

In `src/components/Turntable.astro`, add to the frontmatter imports:

```ts
import { NIGHT_POSTER } from "../scripts/night-poster.mjs";
```

and replace the deck box with:

```astro
    <div class="deck" data-deck>
      <picture class="poster">
        <source media="(max-width: 680px)" srcset="/posters/deck-phone.webp" />
        <img src="/posters/deck-desktop.webp" alt="" decoding="async" loading="lazy" />
      </picture>
      <script is:inline set:html={NIGHT_POSTER}></script>
    </div>
```

In `astro.config.mjs`, add after the existing imports:

```js
import { createHash } from "node:crypto";
import { NIGHT_POSTER } from "./src/scripts/night-poster.mjs";
```

and replace `scriptDirective: { resources: ["'self'"] },` with:

```js
      // Astro hashes the scripts it bundles but not inline ones, so the night poster's script is hashed here, from the
      // same string Turntable.astro renders: an edit to one is an edit to both
      scriptDirective: { resources: ["'self'"], hashes: [`sha256-${createHash("sha256").update(NIGHT_POSTER).digest("base64")}`] },
```

Run: `bun run test:unit tests/unit/night-poster.test.ts tests/unit/turntable.test.ts`
Expected: PASS.

- [ ] **Step 3: One plain sleeve, by day and by night**

In `src/deck/scene/hooks.ts`, change the three import to:

```ts
import { Vector3, type MeshStandardMaterial, type WebGLRenderer } from "three";
```

replace the `poster(): void;` line's doc comment in `SceneHooks` with:

```ts
  /** Leaves one plain, unprinted sleeve in the crate's front slot and hides the crate control, for `bun run poster` */
```

and replace the `poster: () => { ... },` entry with:

```ts
    poster: () => {
      // One plain sleeve (the colour a cover that fails to load gets) at rest in the front slot, the rest of the crate and
      // every disc hidden: true whatever /admin does, since the corner only shows with at least one active record
      stage.records.forEach((record, i) => {
        record.holder.visible = i === 0;
        record.disc.visible = false;
      });
      const front = (stage.records[0]?.sleeve.material as MeshStandardMaterial[] | undefined)?.[4];
      if (front) {
        front.map = null;
        front.color.set(0xe9e4d8);
        front.needsUpdate = true;
      }
      canvas.parentElement?.querySelector<HTMLElement>(".crate-hud")?.style.setProperty("visibility", "hidden");
      loop.invalidate();
    },
```

Replace `scripts/poster.mjs` with:

```js
// Renders the posters the deck shows until (or instead of) the 3D scene (spec 5.2): no record on the platter and one
// plain, unprinted sleeve in the crate's front slot, which is true whenever the corner shows (it only shows with at least
// one active record). A day pair and a night pair (the scene is candlelit from 19:00 to 06:00 in Sydney), each in desktop
// and phone framing. Rerun whenever the scene changes, and look at all four before committing them.
//   bun run build:test && bun run serve    (leave it running)
//   bun run poster
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const BASE = process.env.POSTER_URL ?? "http://localhost:4331";
const LIMIT = 60 * 1024;
const MIDDAY = new Date("2026-10-05T02:00:00Z"); // 13:00 in Sydney: daylight
const NIGHT = new Date("2026-10-05T11:00:00Z"); // 22:00 in Sydney: candlelight
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 812 };

async function render(name, viewport, time) {
  const browser = await chromium.launch();
  let png;
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, reducedMotion: "reduce" });
    await page.clock.setFixedTime(time);
    await page.goto(BASE);
    await page.locator("[data-deck]").scrollIntoViewIfNeeded();
    await page.locator("[data-deck].live").waitFor({ timeout: 60_000 });
    await page.evaluate(() => {
      window.__deckScene.poster();
      // Transparent around the room, so the page's own dot grid shows through the poster
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      // The full-bleed phone canvas sits over the margin rule; keep the rule out of the poster
      for (const el of document.querySelectorAll(".row > .label, .row > .body")) el.style.borderLeftColor = "transparent";
    });
    await page.waitForTimeout(500);
    png = await page.locator("[data-deck] canvas").screenshot({ omitBackground: true });
  } finally {
    await browser.close();
  }
  let quality = 80;
  let out = await sharp(png).webp({ quality, alphaQuality: 80, effort: 6 }).toBuffer();
  while (out.length >= LIMIT && quality > 30) out = await sharp(png).webp({ quality: (quality -= 5), alphaQuality: 70, effort: 6 }).toBuffer();
  if (out.length >= LIMIT) throw new Error(`${name}: still ${out.length} bytes at quality ${quality}`);
  writeFileSync(`public/posters/${name}.webp`, out);
  console.log(`public/posters/${name}.webp: ${out.length} bytes at quality ${quality}`);
}

mkdirSync("public/posters", { recursive: true });
for (const [suffix, time] of [["", MIDDAY], ["-night", NIGHT]]) {
  await render(`deck-desktop${suffix}`, DESKTOP, time);
  await render(`deck-phone${suffix}`, PHONE, time);
}
```

Run: `bun run typecheck && bun run build:test && pkill -f "port 433[1234]"; (bun run serve > "$TMPDIR/serve.log" 2>&1 &) && until curl -sf http://localhost:4331/ > /dev/null; do sleep 1; done && bun run poster; pkill -f "port 4331"`
Expected: four lines, each `public/posters/<name>.webp: <bytes> bytes at quality <q>` with bytes under 61440; the plain sleeve adds little.

- [ ] **Step 4: Look at the four posters yourself; the task reviewer looks again**

George doesn't review intermediate artefacts, so this check is yours, and the task reviewer repeats it. Convert the new posters and the two committed ones to PNG outside the repo, then Read each PNG:

```bash
OUT=$(mktemp -d) && for name in deck-desktop deck-phone; do git show HEAD:public/posters/$name.webp > "$OUT/$name-before.webp"; done
mise exec node@24 -- node -e 'const sharp = require("sharp"); const out = process.argv[1]; const pairs = [...["deck-desktop", "deck-phone", "deck-desktop-night", "deck-phone-night"].map((n) => [`public/posters/${n}.webp`, `${out}/${n}.png`]), ...["deck-desktop", "deck-phone"].map((n) => [`${out}/${n}-before.webp`, `${out}/${n}-before.png`])]; Promise.all(pairs.map(([from, to]) => sharp(from).png().toFile(to))).then(() => console.log(out));' "$OUT"
```

Read the six PNGs and say in the task report what you saw for each check:

1. Each new poster: no record on the platter, one cream sleeve standing in the crate's front slot, lit like the sleeve edges and backs (not a flat grey box, and not something that reads as a broken image), no other sleeves, no crate control and a transparent surround.
2. Day against night: the same camera, crop and room; only the light differs (daylight against candlelight, with the candle lit).
3. Old against new (the `-before` PNGs): the same camera, crop and room; the only change is the plain sleeve in the front slot.
4. Desktop against phone: each in its own framing (16:10.8 and 375:320).

If any check fails, stop and report what you saw with the PNG paths, and don't commit the posters.

- [ ] **Step 5: Run the checks and commit**

Rebuild first: the build copies `public/` into `dist/client/`, so posters rendered after Step 3's build aren't served until it runs again.

Run: `bun run test:unit && bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/posters.spec.ts tests/e2e/deck-scene.spec.ts tests/e2e/deck-phone.spec.ts tests/e2e/budgets.spec.ts tests/e2e/routes.spec.ts`
Expected: every test passes: the night poster shows (so the CSP allowed its script), "pages work under the CSP with no violations" passes and the JavaScript budget still holds (the script adds about 300 bytes gzipped to about 5.9KB).

```bash
git add src/scripts/night-poster.mjs src/components/Turntable.astro astro.config.mjs src/deck/scene/hooks.ts scripts/poster.mjs public/posters tests/unit/night-poster.test.ts tests/unit/media-files.test.ts tests/unit/turntable.test.ts tests/e2e/posters.spec.ts tests/e2e/deck-phone.spec.ts
git commit -m "feat: the posters show one plain sleeve, and a night pair stands in for the candlelit scene"
```

---

### Task 8: the audio graph is built before the first press

Plan 4 measured pressing play at about 200ms at 4× CPU, most of it the deck building its `AudioContext` inside the first press. The graph is now built in an idle moment after `load`, suspended (browsers only let a context start in a gesture); the press only resumes it. `tests/e2e/perf.spec.ts` then gates the play check like the others. The same spec's scene wait, which wasn't scaled by `SLOW` like every other e2e wait, is scaled.

**Files:**
- Modify: `src/deck/audio.ts`, `src/scripts/deck.ts`, `src/env.d.ts` (the `__deck` hook's `audio()`)
- Test: `tests/unit/audio.test.ts`, `tests/e2e/perf.spec.ts`

**Interfaces:**
- Consumes: `src/scripts/deck.ts` as Task 6 left it.
- Produces: `interface DeckAudio extends AudioPort { prepare(): void; readonly ready: boolean }`; `createAudioPort(element, makeContext?): DeckAudio`; `window.__deck.audio()` gains `ready: boolean`.

- [ ] **Step 1: Write the failing unit test**

In `tests/unit/audio.test.ts`, add inside `describe("audio port", ...)`, after the first test:

```ts
  test("prepare builds the graph ahead of the press, suspended; the press then only resumes it", () => {
    const { element, ctx, port } = setup();
    expect(port.ready).toBe(false);
    port.prepare();
    port.prepare();
    expect(port.ready).toBe(true);
    expect(ctx.make).toHaveBeenCalledTimes(1);
    expect(ctx.context.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(ctx.context.resume).not.toHaveBeenCalled();
    expect(element.play).not.toHaveBeenCalled();
    port.unlock("/media/audio/a.mp3");
    expect(ctx.make).toHaveBeenCalledTimes(1);
    expect(ctx.context.resume).toHaveBeenCalledTimes(1);
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  test("a graph that can't be built still leaves the port ready, fading with the element's volume", async () => {
    const element = new FakeAudio();
    const port = createAudioPort(element as unknown as HTMLAudioElement, () => {
      throw new Error("no Web Audio");
    });
    port.prepare();
    expect(port.ready).toBe(true);
    port.unlock("/media/audio/a.mp3");
    expect(element.volume).toBe(0);
  });
```

Run: `bun run test:unit tests/unit/audio.test.ts`
Expected: FAIL: `port.prepare is not a function`.

- [ ] **Step 2: Prepare, ready and the call after load**

In `src/deck/audio.ts`, add after the `Graph` type:

```ts
/** The deck's audio port, plus building its graph ahead of the first press */
export interface DeckAudio extends AudioPort {
  /** Builds the Web Audio graph now, suspended: a context made outside a gesture starts suspended, and the press resumes
   *  it. Keeps that work out of the first press (spec 11's interaction budget). Safe to call more than once */
  prepare(): void;
  /** The graph has been built, or building it failed and fades use the element's volume */
  readonly ready: boolean;
}
```

change the function's signature to:

```ts
export function createAudioPort(element: HTMLAudioElement, makeContext: () => AudioContext = () => new AudioContext()): DeckAudio {
```

replace the comment above `function connect()` with:

```ts
  // Built once: ahead of the first press (prepare), or inside it. A context made outside a gesture starts suspended,
  // and every press resumes it, because browsers only let audio start from a user gesture
```

and add to the returned object, before `unlock(src) {`:

```ts
    prepare() {
      connect();
    },
    get ready() {
      return tried;
    },
```

In `src/scripts/deck.ts`, replace `audio: createAudioPort(element),` with `audio,` and add before `const deck = createDeck({`:

```ts
  const audio = createAudioPort(element);
  // The audio graph is built in an idle moment once the page has loaded, not inside the first press, where it cost about
  // 200ms at 4× CPU. It starts suspended; the press resumes it
  const prepare = () => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => audio.prepare(), { timeout: 2000 });
    else setTimeout(() => audio.prepare(), 200);
  };
  if (document.readyState === "complete") prepare();
  else addEventListener("load", prepare, { once: true });
```

and in the test hook, replace the `audio: () => ({ ... })` entry with:

```ts
      audio: () => ({
        paused: element.paused,
        src: element.currentSrc ? new URL(element.currentSrc).pathname : (element.getAttribute("src") ?? ""),
        rate: element.playbackRate,
        ready: audio.ready,
      }),
```

In `src/env.d.ts`, change the hook's type to:

```ts
    audio(): { paused: boolean; src: string; rate: number; ready: boolean };
```

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes (`runner.test.ts`'s fake still satisfies `AudioPort`).

- [ ] **Step 3: Gate the play check, and scale the scene wait**

In `tests/e2e/perf.spec.ts`, change the deck import to:

```ts
import { hasWebGL, settled, SLOW } from "./deck";
```

in `throttled`, replace `{ timeout: 45_000 }` with `{ timeout: 45_000 * SLOW }` (every other e2e wait on the scene is scaled for CI's software rendering), and add before `await page.evaluate(() => {` (the observer):

```ts
  // The deck builds its audio graph in an idle moment after load; the press is measured once that's done, as a visitor's is
  await expect.poll(() => page.evaluate(() => window.__deck?.audio().ready ?? false), { timeout: 10_000 * SLOW }).toBe(true);
```

Replace the play test and its comment with:

```ts
test("pressing play responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  await page.locator(".tracks button").first().click();
  const latency = await slowest(page);
  test.info().annotations.push({ type: "inp", description: `pressing play: ${latency}ms at 4× CPU` });
  expect(latency).toBeLessThan(200);
});
```

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/perf.spec.ts tests/e2e/deck-list.spec.ts tests/e2e/deck-journeys.spec.ts tests/e2e/budgets.spec.ts --project=chromium --reporter=list`
Expected: every test passes. Report the play annotation's number. CI's runners measured this press slower than this machine (plan 4), so if the local reading is over 120ms, stop and report it with a performance profile of the press (Chromium's trace) rather than gating it.

- [ ] **Step 4: Commit**

```bash
git add src/deck/audio.ts src/scripts/deck.ts src/env.d.ts tests/unit/audio.test.ts tests/e2e/perf.spec.ts
git commit -m "perf: the deck builds its audio graph after load, so pressing play stays inside 200ms"
```

---

### Task 9: the hover card stays whole and never shows empty

Two plan 4 follow-ups and two of its test gaps, all about a label's hover card and pill. A card centred on a pill near the page's right edge was cut at the edge between about 800 and 860px wide (`.book` clips sideways, so the page never scrolls); on each hover it now slides back inside, still growing out of its pill. A slow first hover could fade in an empty card; the card now shows only once its picture has decoded. The test gaps: a real Tab reaching the pill, and closing a label or a find-in-page reveal not being counted by the beacon.

**Files:**
- Modify: `src/scripts/labels.ts` (`loadCard`, a new `nudge`), `src/styles/notebook.css` (the `.hovercard` transforms)
- Test: `tests/e2e/labels.spec.ts`, `tests/e2e/analytics.spec.ts`

**Interfaces:**
- Consumes: `.hovercard.ready` (the CSS gate that shows the card, existing).
- Produces: the custom property `--nudge` on `.hovercard` (a length, `0px` when centred).

- [ ] **Step 1: Write the failing tests**

In `tests/e2e/labels.spec.ts`, add after `"the hover cards never scroll the page sideways"`:

```ts
test("a hover card near the page's right edge slides back inside it, still growing out of its pill", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover cards on a phone");
  for (const width of [800, 830, 860]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // The labelled line with a snapshot whose pill sits furthest right
    const slug = await page.evaluate(() => {
      const items = [...document.querySelectorAll<HTMLElement>(".line-item.labelled")].filter((item) => item.querySelector(".hovercard"));
      const right = (item: HTMLElement) => item.querySelector(".peek")!.getBoundingClientRect().right;
      return items.sort((a, b) => right(b) - right(a))[0].dataset.slug!;
    });
    const item = page.locator(`[data-slug="${slug}"]`);
    const card = item.locator(".hovercard");
    await item.locator(".peek").hover();
    await expect(card).toHaveCSS("opacity", "1");
    await card.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)).then(() => undefined));
    const box = (await card.boundingBox())!;
    const pill = (await item.locator(".peek").boundingBox())!;
    expect(box.x, `${width}px wide`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${width}px wide`).toBeLessThanOrEqual(width - 7.5);
    const centre = pill.x + pill.width / 2;
    expect(centre, `${width}px wide: the pill is under the card`).toBeGreaterThan(box.x);
    expect(centre, `${width}px wide: the pill is under the card`).toBeLessThan(box.x + box.width);
    await page.locator("h1").hover();
  }
});

test("a slow first hover shows the card only once its picture is ready, never an empty card", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover cards on a phone");
  await page.route(/fixture-canberra-events-480\.(avif|webp)$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const card = item.locator(".hovercard");
  await item.locator(".aside").hover();
  await page.waitForTimeout(600); // well past the 90ms intent delay and the 140ms fade
  await expect(card).toHaveCSS("opacity", "0");
  await expect(card).toHaveCSS("opacity", "1", { timeout: 10_000 });
  expect(await card.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test("a real Tab reaches the pill and brings its card up", async ({ page, browserName, isMobile }) => {
  test.skip(isMobile || browserName !== "chromium", "WebKit on macOS doesn't Tab to buttons, and phones have no hover cards");
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator("a").first().focus(); // the line's own link, just before its pill
  await page.keyboard.press("Tab");
  await expect(item.locator(".peek")).toBeFocused();
  await expect(item.locator(".hovercard")).toHaveCSS("opacity", "1");
});
```

In `tests/e2e/analytics.spec.ts`, add after `"opening a label is counted with its slug and the visit's session"`:

```ts
test("closing a label, or find-in-page opening one, isn't counted", async ({ page }) => {
  const opened: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ingest/i/v0/e/") && body(request).event === "label_opened") opened.push(body(request).properties.slug);
  });
  await page.goto("/");
  const pill = page.locator('[data-slug="canberra-events"] .peek');
  const [first] = await Promise.all([beacon(page, "label_opened"), pill.click()]);
  await accepted(first);
  await pill.click(); // closes it
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  // What find-in-page does to a match inside hidden="until-found": beforematch, then the attribute goes
  await page.locator("#label-digital-nachos").evaluate((drawer) => {
    drawer.dispatchEvent(new Event("beforematch"));
    drawer.removeAttribute("hidden");
  });
  await expect(page.locator('[data-slug="digital-nachos"] .peek')).toHaveAttribute("aria-expanded", "true");
  // A label opened by a click, which is counted: once its beacon is here, any the steps above sent would be too
  const [last] = await Promise.all([beacon(page, "label_opened"), page.locator('[data-slug="linear-gratis"] .peek').click()]);
  await accepted(last);
  expect(opened).toEqual(["canberra-events", "linear-gratis"]);
});
```

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/labels.spec.ts tests/e2e/analytics.spec.ts --project=chromium -g "right edge|slow first hover|real Tab|isn't counted"`
Expected: the edge test FAILS at one of the widths (the card's right edge is past `width - 7.5`); the slow-hover test FAILS (opacity 1 while the picture is still on its way); the Tab and analytics tests pass already (they pin behaviour that had no test).

- [ ] **Step 2: Nudge the card and wait for its picture**

In `src/scripts/labels.ts`, replace `loadCard` and its comment with:

```ts
// A card centred on its pill near the page's edge would be cut there (.book clips sideways rather than scroll): it slides
// back inside (8px from the edge) and still grows out of the pill, because its transform origin moves with it
const EDGE = 8;
function nudge(item: HTMLElement, card: HTMLElement) {
  const wrap = item.querySelector(".peekwrap");
  if (!wrap) return;
  const box = wrap.getBoundingClientRect();
  const bounds = item.closest(".book")?.getBoundingClientRect();
  const left = Math.max(bounds?.left ?? 0, 0) + EDGE;
  const right = Math.min(bounds?.right ?? Infinity, document.documentElement.clientWidth) - EDGE;
  const half = card.offsetWidth / 2;
  const centre = box.left + box.width / 2;
  const shift = centre + half > right ? right - (centre + half) : centre - half < left ? left - (centre - half) : 0;
  card.style.setProperty("--nudge", `${Math.round(shift)}px`);
}

// The hover card's picture is named in data attributes until the first hover or focus, on fine pointers only (spec 4.1).
// The card shows only once that picture has decoded, so a slow first hover never fades in an empty card
function loadCard(item: HTMLElement) {
  if (!finePointer()) return;
  const card = item.querySelector<HTMLElement>(".hovercard");
  if (!card) return;
  nudge(item, card); // on every hover: the window may have changed size since
  const waiting = [...card.querySelectorAll<HTMLElement>("[data-srcset], [data-src]")];
  if (waiting.length === 0) return; // named on an earlier hover
  for (const element of waiting) {
    if (element.dataset.srcset) element.setAttribute("srcset", element.dataset.srcset);
    if (element.dataset.src) element.setAttribute("src", element.dataset.src);
    delete element.dataset.srcset;
    delete element.dataset.src;
  }
  // Shown only from here on: without this script the card would be blank, and its "click for the label" untrue. A picture
  // that won't load removes the card instead (its error listener below)
  card.querySelector("img")?.decode().then(() => card.classList.add("ready"), () => {});
}
```

In `src/styles/notebook.css`, in the `.hovercard` rule, replace `transform: translateX(-50%) translateY(6px) scale(.94); transform-origin: 50% 100%;` with:

```css
  transform: translateX(calc(-50% + var(--nudge, 0px))) translateY(6px) scale(.94); transform-origin: calc(50% - var(--nudge, 0px)) 100%;
```

in the shown rule (`.line-item:not(.open):not(.dismissed) > .line:hover .hovercard.ready, ...`), replace `transform: translateX(-50%);` with `transform: translateX(calc(-50% + var(--nudge, 0px)));`, and in the `prefers-reduced-motion` block replace `.hovercard { transform: translateX(-50%);` with `.hovercard { transform: translateX(calc(-50% + var(--nudge, 0px)));`.

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/labels.spec.ts tests/e2e/analytics.spec.ts`
Expected: every test passes in every project, the four new ones among them; the existing hover tests (opacity 1, crossing the gap onto the card, Escape) still pass.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/labels.ts src/styles/notebook.css tests/e2e/labels.spec.ts tests/e2e/analytics.spec.ts
git commit -m "fix: a hover card near the edge slides back inside, and shows only once its picture is ready"
```

---

### Task 10: the closer look opens at once

Three plan 4 follow-ups about the closer look, fixed together because they share one cause: it waited for the 1920px file before opening. It now opens at once with the frame's own picture (already downloaded and decoded), loads the big file on the side in the format the frame's picture chose, and swaps it in once decoded. So nothing waits on the network: a 1920 that never settles no longer leaves every frame ignoring clicks, and the busy cursor goes. The image's width is now set by the window (every snapshot is 16:10), so the swap can't move it, and a picture whose big file failed fills the window instead of growing to twice the frame. The second click of a double click on a frame, which now lands on the open dialog, doesn't close it.

**Files:**
- Modify: `src/scripts/closer.ts` (rewritten), `src/components/CloserLook.astro` (no `<source>`), `src/styles/notebook.css` (`.closer img`, no `aria-busy` cursor)
- Test: `tests/e2e/labels.spec.ts`, `tests/e2e/perf.spec.ts` (a comment)

**Interfaces:**
- Consumes: the frame's `data-closer-avif` and `data-closer-webp` (existing); `BIG` and `delayBig` in `labels.spec.ts` (existing).
- Produces: nothing new. The frame no longer gets `aria-busy`.

- [ ] **Step 1: Rewrite the tests for a look that opens at once**

In `tests/e2e/labels.spec.ts`:

In `"a snapshot opens a closer look; Esc returns it to its frame, then closes the label"`, replace the `src` assertion with:

```ts
  await expect(dialog.locator("img")).toHaveAttribute("src", /fixture-digital-nachos-1920\.(avif|webp)$/);
```

In `"a double click on a frame still grows the snapshot out of it, instead of popping it open"`, delete `await delayBig(page, 300);` and add at the end of the test:

```ts
  // The double click's second click lands on the open look, and doesn't close it
  await expect(page.locator("dialog.closer")).toHaveAttribute("open", "");
  await expect(page.locator("dialog.closer")).toHaveClass(/\bon\b/);
```

Replace the test `"a second frame clicked while the first one's big file loads is ignored, and the first frame's snapshot comes back"` with:

```ts
test("the closer look opens at once with the frame's own picture, and the big file takes its place in the same box", async ({ page }) => {
  await delayBig(page, 3000);
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  const own = await item.locator(".frame img").evaluate((img: HTMLImageElement) => img.currentSrc);
  await item.locator(".frame").click();
  const dialog = page.locator("dialog.closer");
  const big = dialog.locator("img");
  await expect(dialog).toHaveAttribute("open", "");
  // Open before the 1920 could have arrived: the picture is the frame's own
  expect(await big.evaluate((img: HTMLImageElement) => img.currentSrc)).toBe(own);
  await expect.poll(() => big.evaluate((img) => getComputedStyle(img).transform)).toBe("none");
  const before = await big.boundingBox();
  await expect(big).toHaveAttribute("src", /fixture-digital-nachos-1920\.(avif|webp)$/, { timeout: 10_000 });
  expect(await big.boundingBox()).toEqual(before);
});

test("a big file that never arrives holds nothing up: the look closes, and the next frame opens its own", async ({ page }) => {
  await page.route(BIG, () => {}); // never answered
  await page.goto("/");
  const first = page.locator('[data-slug="digital-nachos"]');
  const second = page.locator('[data-slug="canberra-events"]');
  await first.locator(".peek").click();
  await second.locator(".peek").click();
  await expect(first.locator(".frame img")).toBeVisible();
  await expect(second.locator(".frame img")).toBeVisible();
  const dialog = page.locator("dialog.closer");
  await first.locator(".frame").click();
  await expect(dialog).toHaveAttribute("open", "");
  await dialog.locator(".closer-close").click();
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(first.locator(".frame")).toBeFocused();
  await second.locator(".frame").click();
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog).toHaveAccessibleName("closer look: a snapshot of canberra.events");
  await dialog.locator(".closer-close").click();
  await expect(second.locator(".frame")).toBeFocused();
  await expect(first.locator(".frame img")).toHaveCSS("visibility", "visible");
});
```

Replace the test `"a label closed while its closer look loads never gets one, and focus stays where it was put"` with:

```ts
test("a big file that arrives after the look has closed changes nothing", async ({ page }) => {
  await delayBig(page, 1500);
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  const dialog = page.locator("dialog.closer");
  await item.locator(".frame").click();
  await expect(dialog).toHaveAttribute("open", "");
  await dialog.locator(".closer-close").click();
  await expect(dialog).not.toHaveAttribute("open", "");
  await page.waitForTimeout(2500); // the big file has arrived by now
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(dialog.locator("img")).not.toHaveAttribute("src", /.*/);
  await expect(item.locator(".frame img")).toHaveCSS("visibility", "visible");
  await expect(item.locator(".frame")).toBeFocused();
});
```

Replace the test `"a closer look whose big file won't load grows from the frame's own picture instead of a broken one"` with:

```ts
test("a closer look whose big file won't load keeps the frame's own picture, grown to fit the window", async ({ page }) => {
  await page.route(BIG, (route) => route.abort());
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  await item.locator(".frame").click();
  const dialog = page.locator("dialog.closer");
  await expect(dialog).toHaveAttribute("open", "");
  await expect.poll(() => dialog.locator("img").evaluate((big) => getComputedStyle(big).transform)).toBe("none");
  const same = await item.locator(".frame").evaluate((frame) => {
    const big = document.querySelector<HTMLImageElement>("dialog.closer img")!;
    return { loaded: big.naturalWidth > 0, current: big.currentSrc === frame.querySelector("img")!.currentSrc };
  });
  expect(same).toEqual({ loaded: true, current: true });
  // The window decides its size, not the file: 88vw, or the height left by the room above and below, at 16:10
  const fit = await page.evaluate(() => Math.min(innerWidth * 0.88, (innerHeight - 2 * Math.max(innerHeight * 0.06, 72)) * 1.6));
  expect(Math.abs((await dialog.locator("img").boundingBox())!.width - fit)).toBeLessThan(1);
});
```

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/labels.spec.ts --project=chromium -g "closer look|big file|double click"`
Expected: three FAIL: 'opens at once with the frame's own picture' (the look waits for the 3s file), 'a big file that never arrives' (the hung file blocks the second frame) and 'whose big file won't load' (the fallback is 480px wide, not the window's fit). 'A big file that arrives after the look has closed' passes already, and so may the double click test: both pin behaviour the rewrite must keep. The others pass.

- [ ] **Step 2: Open at once, swap the big file in**

Replace `src/scripts/closer.ts` with:

```ts
// The closer look (spec 4.1): a framed snapshot grows from its frame to fit the window over a paper veil (FLIP, 420ms
// ease-out-quint), and goes back into its frame (300ms ease-out) on a click, the close button or Esc. It opens at once
// with the frame's own picture, which is already here, and the 1920px file takes its place once it has arrived, so a slow
// or missing file never holds anything up. The dialog is modal, so focus moves into it, and returns to the frame.
// Nothing moves under reduced motion.
const dialog = document.querySelector<HTMLDialogElement>("dialog.closer");
const big = dialog?.querySelector("img");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// The transform that puts `to` where `from` is
const flip = (from: DOMRect, to: DOMRect) => `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
// The image's box with no transform, for a FLIP to aim at. A grow still running when it's closed is put back as it was,
// with no frame painted between, so the close starts from where the image has got to
function restBox(img: HTMLElement) {
  const now = getComputedStyle(img).transform;
  img.style.transition = "none";
  img.style.transform = "none";
  const box = img.getBoundingClientRect();
  img.style.transform = now;
  img.getBoundingClientRect(); // settles the style, so the transition that follows starts from `now`
  return box;
}
let frame: HTMLAnchorElement | null = null; // the frame whose snapshot is in the dialog
let opening = false; // a frame's picture is still decoding: one open at a time
let closing = false;
let timer = 0;

const empty = () => big?.removeAttribute("src");

// The big file in the format the frame's own picture chose (AVIF where the browser takes it)
const bigFile = (link: HTMLAnchorElement, shot: HTMLImageElement) => (shot.currentSrc.endsWith(".avif") ? link.dataset.closerAvif : link.dataset.closerWebp) ?? "";

// Loads the big file on the side and swaps it in once decoded, unless this look has closed meanwhile. The window sets the
// image's box, not the file, so the swap moves nothing; a file that won't load leaves the frame's picture, which fits too
function swapIn(link: HTMLAnchorElement, url: string) {
  if (!url) return;
  const loader = new Image();
  loader.src = url;
  loader.decode().then(
    () => {
      if (frame === link && !closing && big) big.src = url;
    },
    () => {},
  );
}

async function open(link: HTMLAnchorElement) {
  if (!dialog || !big || dialog.open || opening) return;
  const shot = link.querySelector("img");
  if (!shot) return;
  opening = true;
  // Decoded already once the frame shows; this waits only for a frame clicked the moment its picture arrives
  await shot.decode().catch(() => {});
  const own = shot.currentSrc;
  if (own) {
    big.src = own;
    big.alt = shot.alt;
    dialog.setAttribute("aria-label", `closer look: ${shot.alt}`);
    await big.decode().catch(() => {});
  }
  opening = false;
  // The label may have been closed meanwhile (its pill's aria-expanded is the state), and nothing opens over that
  const labelOpen = link.isConnected && link.closest(".line-item")?.querySelector(".peek")?.getAttribute("aria-expanded") === "true";
  if (!own || !labelOpen || big.naturalWidth === 0) return empty();
  frame = link;
  // A classic scrollbar goes while the dialog is open (overflow: hidden), and the page would shift under the picture and
  // its frame. Its width stays as padding instead: scrollbar-gutter doesn't hold on the root in Chromium (ADR-0015)
  const bar = Math.max(0, innerWidth - document.documentElement.clientWidth);
  if (bar) document.documentElement.style.paddingRight = `${bar}px`;
  dialog.showModal();
  const from = shot.getBoundingClientRect(); // reading a rect also settles the dialog's first style, so the veil fades in from clear
  dialog.classList.add("on");
  shot.style.visibility = "hidden";
  swapIn(link, bigFile(link, shot));
  if (reduced()) return;
  big.style.transition = "none";
  big.style.transform = flip(from, big.getBoundingClientRect());
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (closing) return; // closed in these two frames: the close has its own transform
      big.style.transition = "transform 420ms var(--ease-out-quint)";
      big.style.transform = "none";
    }),
  );
}

// Back in the frame: its snapshot shown, the dialog emptied and focus on the frame. A close the browser forces comes
// here too, as it cuts the return short
function restore() {
  if (!dialog || !big || !frame) return;
  const link = frame;
  const shot = link.querySelector("img");
  window.clearTimeout(timer);
  big.removeEventListener("transitionend", restore);
  if (dialog.open) dialog.close();
  if (shot) shot.style.visibility = "";
  big.style.transition = "none";
  big.style.transform = "";
  empty();
  document.documentElement.style.paddingRight = "";
  closing = false;
  frame = null;
  link.focus();
}

function close() {
  if (!dialog?.open || !big || !frame || closing) return;
  const shot = frame.querySelector("img");
  closing = true;
  dialog.classList.remove("on");
  if (reduced() || !shot) return restore();
  const rest = restBox(big);
  big.style.transition = "transform 300ms var(--ease-out)";
  big.style.transform = flip(shot.getBoundingClientRect(), rest);
  big.addEventListener("transitionend", restore, { once: true });
  timer = window.setTimeout(restore, 400); // in case the transition never ends (a tab in the background)
}

if (dialog) {
  // A frame is a link to its big file, which is what it opens without this script (or with a modifier key, in a new tab)
  document.querySelectorAll<HTMLAnchorElement>("a.frame").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void open(link);
    }),
  );
  // The veil, the image and the close button all put it back. The second click of a double click on a frame lands here
  // once the look has opened, and isn't a request to close it (a keyboard press on the close button has detail 0)
  dialog.addEventListener("click", (event) => {
    if (event.detail > 1) return;
    close();
  });
  // Esc closes the closer look first; the label's own Esc handler only hears the next one, once focus is back in it
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  // A second Esc inside the return can't be stopped: the browser closes the dialog itself, so settle it at once
  dialog.addEventListener("close", restore);
}
```

Replace `src/components/CloserLook.astro`'s dialog with:

```astro
<dialog class="closer">
  <button class="closer-close" type="button" autofocus>close</button>
  <picture>
    <img alt="" decoding="async" />
  </picture>
</dialog>
```

In `src/styles/notebook.css`, delete the line `.frame[aria-busy="true"] { cursor: progress; } /* its closer look's file is on the way */`, and replace the `.closer img { ... }` rule with:

```css
.closer img {
  /* The window sets its size, not the file it shows (the frame's own picture first, then the 1920): every snapshot is
     16:10, so the width alone fixes the box, and swapping the big file in can't move it */
  display: block; width: min(88vw, calc((100vh - 2 * var(--room)) * 1.6)); height: auto; aspect-ratio: 16 / 10; transform-origin: 0 0;
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, .4), 0 0 0 1px rgba(0, 0, 0, .08);
}
```

In `tests/e2e/perf.spec.ts`, replace the two comment lines above `"opening the closer look responds within 200ms at 4× CPU"` with:

```ts
// The click's latency runs to the next paint after it. The look opens once the frame's own picture is decoded, which it
// already is, and the 1920 is swapped in later, off the interaction.
```

Run: `bun run typecheck`
Expected: 0 errors.

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/labels.spec.ts tests/e2e/perf.spec.ts tests/e2e/routes.spec.ts`
Expected: every test passes in every project, including "the close pill never covers the picture, at any size", the classic-scrollbar check and the closer look's interaction gate in `perf.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/closer.ts src/components/CloserLook.astro src/styles/notebook.css tests/e2e/labels.spec.ts tests/e2e/perf.spec.ts
git commit -m "fix: the closer look opens at once with the frame's picture and swaps the big file in when it arrives"
```

---

### Task 11: the nightly run outlives a dead session

Three plan 4 follow-ups about the snapshots Worker's run. If the browser session died mid-run, every later line errored, with no relaunch; now a line that errors gets the next line a fresh session, three sessions a night at most, so a Browser Rendering outage isn't hammered. A line left with no session (a refused launch, or none left) reads `no-browser` and keeps its status, as Task 13's re-shoot does. Two gaps get the tests they lacked: the clean-up's 1000-key delete batches, and `scheduled()` and `reshoot()` failing (their error logs).

**Files:**
- Create: `tests/unit/snapshots-worker.test.ts`
- Modify: `workers/snapshots/src/run.ts` (`runAll`, a new `SESSIONS_PER_RUN`), `tests/unit/fake-browser.ts` (a page that kills its session)
- Test: `tests/unit/snapshot-run.test.ts`

**Interfaces:**
- Consumes: `shootOne`, `recordError`, `sweep` in `run.ts` (existing); `fakeBrowser` and `sqliteD1`.
- Produces: `SESSIONS_PER_RUN = 3` exported from `run.ts`; `runAll(deps): Promise<Record<string, ShotOutcome | "error" | "no-browser">>`; `FakeSite.kills?: boolean`; `fakeBrowser(...)` gains `dead: boolean`.

- [ ] **Step 1: A fake session that dies**

In `tests/unit/fake-browser.ts`, add to `FakeSite`, after `broken?: boolean;`:

```ts
  /** The whole session dies while reading this page: it throws, and every later page in the session fails to open */
  kills?: boolean;
```

change `fakePage`'s signature to:

```ts
export function fakePage(site: (url: string) => FakeSite, kill?: () => void): FakePage {
```

replace its `content()` with:

```ts
    async content() {
      if (current.kills) {
        kill?.();
        throw new Error("Target closed");
      }
      if (current.broken) throw new Error("Target closed");
      return current.html ?? "<html><head><title>a page</title></head><body>hello</body></html>";
    },
```

and replace `fakeBrowser` with:

```ts
/** A browser session whose pages answer from `site`; counts launches of pages, whether it was closed and whether it died */
export function fakeBrowser(site: (url: string) => FakeSite) {
  const pages: FakePage[] = [];
  const browser: CaptureBrowser & { pages: FakePage[]; closed: boolean; dead: boolean } = {
    pages,
    closed: false,
    dead: false,
    async newPage() {
      if (browser.dead) throw new Error("Protocol error: Connection closed.");
      const page = fakePage(site, () => {
        browser.dead = true;
      });
      pages.push(page);
      return page;
    },
    async close() {
      browser.closed = true;
    },
  };
  return browser;
}
```

- [ ] **Step 2: Write the failing tests**

In `tests/unit/snapshot-run.test.ts`, change the run import to:

```ts
import { KEEP_SUPERSEDED_MS, reshootOne, runAll, SESSIONS_PER_RUN, sweep, type RunDeps } from "../../workers/snapshots/src/run";
```

and add at the end of the file:

```ts
test("a session that dies mid-run is replaced, so the lines after it are still captured", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  site = (url) => (url.includes("digitalnachos") ? { kills: true } : {});
  expect(await runAll(deps())).toEqual({ "digital-nachos": "error", "canberra-events": "ok", "linear-gratis": "ok", onestack: "ok" });
  expect(launches).toBe(2);
  expect(browser.closed).toBe(true);
});

test("sessions that keep dying are replaced only twice a night; the lines after that error", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  site = () => ({ kills: true });
  expect(Object.values(await runAll(deps()))).toEqual(["error", "error", "error", "error"]);
  expect(launches).toBe(SESSIONS_PER_RUN);
});

test("Browser Rendering refusing every session leaves every line as it was, after three tries at most; the clean-up still runs", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.prepare("UPDATE items SET snapshot_status = 'ok' WHERE slug = 'canberra-events'").run();
  const refused: RunDeps = {
    ...deps(),
    launch: async () => {
      launches += 1;
      throw new Error("Unable to create new browser: code: 429: message: Too many browsers");
    },
  };
  expect(Object.values(await runAll(refused))).toEqual(["no-browser", "no-browser", "no-browser", "no-browser"]);
  expect(launches).toBe(SESSIONS_PER_RUN);
  expect(bucket.list).toHaveBeenCalled();
  expect(await row("canberra-events")).toMatchObject({ snapshot_status: "ok" });
});

test("the clean-up deletes in batches of 1000 keys, as R2 allows", async () => {
  const old = new Date(NOW.getTime() - KEEP_SUPERSEDED_MS - 1);
  for (let i = 0; i < 167; i++) {
    for (const width of [480, 960, 1920]) {
      for (const format of ["avif", "webp"]) bucket.seed(`snapshots/gone-${String(i).padStart(3, "0")}-${width}.${format}`, old);
    }
  }
  expect(await sweep(deps())).toBe(1002);
  expect(bucket.delete.mock.calls.map(([keys]) => [keys].flat().length)).toEqual([1000, 2]);
  expect(bucket.objects.size).toBe(0);
});
```

Create `tests/unit/snapshots-worker.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";

// The Worker's entrypoint without the Workers runtime: a plain base class, and a puppeteer that's never reached
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(async () => {
      throw new Error("no browser in unit tests");
    }),
  },
}));

const { default: Snapshots } = await import("../../workers/snapshots/src/index");

// A database that can't be read, so the run fails as a whole before any capture
const brokenDb = {
  prepare: () => {
    throw new Error("D1_ERROR: no such table: items");
  },
} as unknown as D1Database;
const worker = () => new Snapshots({} as ExecutionContext, { DB: brokenDb, MEDIA: {} as R2Bucket, IMAGES: {} as ImagesBinding, BROWSER: {} as Fetcher });

afterEach(() => vi.restoreAllMocks());

test("a nightly run that fails as a whole is logged with its error, and still fails", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(worker().scheduled()).rejects.toThrow("no such table");
  expect(error).toHaveBeenCalledWith("snapshots: nightly run failed:", expect.any(Error));
});

test("a re-shoot that fails is logged with its error, and the admin still gets it", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(worker().reshoot(7)).rejects.toThrow("no such table");
  expect(error).toHaveBeenCalledWith("snapshots: re-shoot of line 7 failed:", expect.any(Error));
});
```

Run: `bun run test:unit tests/unit/snapshot-run.test.ts tests/unit/snapshots-worker.test.ts`
Expected: the first three new run tests FAIL (`SESSIONS_PER_RUN` isn't exported; a dead session errors every later line; a refused launch records `error` on every line); the batch test and both Worker tests pass already (they pin behaviour that had no test).

- [ ] **Step 3: Replace a session that may have died**

In `workers/snapshots/src/run.ts`, add after `KEEP_SUPERSEDED_MS`:

```ts
/** A night's browser sessions at most: one to start, and a fresh one after each of two lines that error */
export const SESSIONS_PER_RUN = 3;
```

and replace `runAll` with:

```ts
/**
 * The nightly run: every line, one session, then the clean-up. One line's error is logged and recorded, and the run goes
 * on. The error may have been the session dying, which would take every later line with it, so the next line starts a
 * fresh session: three sessions a night at most, so a Browser Rendering outage isn't hammered (a refused launch counts as
 * one). A line with no session to run in keeps its status, as a re-shoot's "no-browser" does: nothing was captured.
 */
export async function runAll(deps: RunDeps): Promise<Record<string, ShotOutcome | "error" | "no-browser">> {
  const targets = await shotTargets(deps.db);
  const outcomes: Record<string, ShotOutcome | "error" | "no-browser"> = {};
  let browser: CaptureBrowser | null = null;
  let sessions = 0;
  try {
    for (const target of targets) {
      if (!browser && sessions < SESSIONS_PER_RUN) {
        sessions += 1;
        browser = await deps.launch().catch((error: unknown) => {
          console.error(`snapshots: no browser for ${target.slug}:`, error);
          return null;
        });
      }
      if (!browser) {
        // Nothing was captured, so the line keeps its status, as a re-shoot's "no-browser" does
        outcomes[target.slug] = "no-browser";
        continue;
      }
      try {
        outcomes[target.slug] = await shootOne(deps, browser, target);
      } catch (error) {
        console.error(`snapshots: ${target.slug} errored:`, error);
        await recordError(deps.db, target);
        outcomes[target.slug] = "error";
        // The error may have been the session dying: the next line gets a fresh one, while tonight has one to give
        if (sessions < SESSIONS_PER_RUN) {
          await browser.close().catch(() => {});
          browser = null;
        }
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }
  // The lines are all recorded by now, so a clean-up that fails (it catches up tomorrow) mustn't lose their outcomes
  try {
    await sweep(deps);
  } catch (error) {
    console.error("snapshots: clean-up failed:", error);
  }
  return outcomes;
}
```

Run: `bun run test:unit tests/unit/snapshot-run.test.ts tests/unit/snapshots-worker.test.ts tests/unit/snapshot-capture.test.ts`
Expected: PASS, the existing run tests among them (`"shoots every line ... in one session"` still sees one launch).

- [ ] **Step 4: Check the Worker still runs end to end, and commit**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/snapshots-live.spec.ts --project=chromium`
Expected: every test passes (the nightly run and "re-shoot now" against the fixture site).

```bash
git add workers/snapshots/src/run.ts tests/unit/fake-browser.ts tests/unit/snapshot-run.test.ts tests/unit/snapshots-worker.test.ts
git commit -m "fix: the nightly run replaces a browser session that died, twice a night at most"
```

---

### Task 12: a page drawn only in CSS isn't blank

A plan 4 follow-up: a page that is only a CSS background image read as blank, so it kept its previous snapshot. The capture's question to the page now also counts a CSS background (an image or gradient) on the page itself, or on any element with a box. The question runs in a real browser in a new spec, against pages written for each case.

**Files:**
- Create: `tests/e2e/shows-something.spec.ts`
- Modify: `workers/snapshots/src/capture.ts` (`SHOWS_SOMETHING`, now exported)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const SHOWS_SOMETHING: string` (an expression the capture evaluates in the page; true when it shows anything).

- [ ] **Step 1: Export the question and write the failing spec**

In `workers/snapshots/src/capture.ts`, change `const SHOWS_SOMETHING = ` to `export const SHOWS_SOMETHING = ` (nothing else yet).

Create `tests/e2e/shows-something.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { SHOWS_SOMETHING } from "../../workers/snapshots/src/capture";

// The snapshots Worker asks each page whether it shows anything before taking the shot (spec 9), because a blank 2x
// screenshot is too big for the size floor to catch. The question runs here in a real browser, against a page per case.
test.skip(({ browserName }) => browserName !== "chromium", "the Worker's browser is Chromium");

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const cases: [string, string, boolean][] = [
  ["text", "<p>hello</p>", true],
  ["an image", `<img src="${GIF}" width="40" height="40" alt="">`, true],
  ["only a background image on the page", "<style>body{margin:0;min-height:100vh;background:linear-gradient(#f4efe6,#d9e4f5)}</style>", true],
  ["only a background image on an element", "<style>div{width:200px;height:200px;background-image:linear-gradient(red,blue)}</style><div></div>", true],
  ["a background image on an element with no box", "<style>div{background-image:linear-gradient(red,blue)}</style><div></div>", false],
  ["nothing at all", "", false],
  ["only spaces", "<p>   </p>", false],
];

for (const [name, html, expected] of cases) {
  test(`a page with ${name} ${expected ? "shows something" : "is blank"}`, async ({ page }) => {
    await page.setContent(`<!doctype html><html><head><title>a case</title></head><body>${html}</body></html>`);
    expect(await page.evaluate(SHOWS_SOMETHING)).toBe(expected);
  });
}
```

Run: `bun run test:e2e tests/e2e/shows-something.spec.ts --project=chromium`
Expected: the two "only a background image" cases FAIL (`false`); the rest pass.

- [ ] **Step 2: Count CSS backgrounds**

In `workers/snapshots/src/capture.ts`, replace the comment and the `SHOWS_SOMETHING` string with:

```ts
// Whether the page shows anything: some text, media with a box or a CSS background (an image or a gradient) on the page
// itself or on an element with a box. A blank 2x screenshot is too big for MIN_BYTES to catch, so the page is asked
export const SHOWS_SOMETHING = `(() => {
  const body = document.body;
  if (!body) return false;
  if (body.innerText.trim() !== "") return true;
  const shown = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  if ([...document.querySelectorAll("img, svg, canvas, video, picture, iframe, object, embed")].some(shown)) return true;
  const painted = (element) => getComputedStyle(element).backgroundImage !== "none";
  return painted(document.documentElement) || painted(body) || [...body.querySelectorAll("*")].some((element) => painted(element) && shown(element));
})()`;
```

Run: `bun run test:e2e tests/e2e/shows-something.spec.ts --project=chromium && bun run test:unit tests/unit/snapshot-capture.test.ts`
Expected: PASS.

Run: `bun run typecheck && bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/snapshots-live.spec.ts --project=chromium`
Expected: 0 errors; every test passes: the fixture's blank page still reads "the capture came out blank" and its detailed page is still captured.

- [ ] **Step 3: Commit**

```bash
git add workers/snapshots/src/capture.ts tests/e2e/shows-something.spec.ts
git commit -m "fix: a page drawn only with a CSS background counts as showing something"
```

---

### Task 13: "the browser couldn't start"

A plan 4 follow-up: a re-shoot whose Browser Rendering session was refused (a rate or concurrency limit) said "the snapshots worker hit an error". The Worker now answers `no-browser` when the launch throws, leaving the line's status alone (nothing was captured), and the admin says "the browser couldn't start. try again in a minute." on the line.

**Files:**
- Modify: `workers/snapshots/src/run.ts` (`reshootOne`, a new `ReshootOutcome`), `src/lib/admin/actions.ts` (the snapshots service type and `reshoot`)
- Test: `tests/unit/snapshot-run.test.ts`, `tests/unit/actions.test.ts`

**Interfaces:**
- Consumes: `runAll` and `SESSIONS_PER_RUN` as Task 11 left them.
- Produces: `export type ReshootOutcome = ShotOutcome | "gone" | "no-browser"`; `reshootOne(deps, id): Promise<ReshootOutcome>`; `SnapshotsService.reshoot(id): Promise<ReshootOutcome>`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/snapshot-run.test.ts`, add at the end:

```ts
test("a re-shoot whose browser won't start says so, and the line keeps its status", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.prepare("UPDATE items SET snapshot_status = 'ok' WHERE slug = 'canberra-events'").run();
  const canberra = (await row("canberra-events"))!.id;
  const refused: RunDeps = {
    ...deps(),
    launch: async () => {
      throw new Error("Unable to create new browser: code: 429: message: Too many browsers");
    },
  };
  expect(await reshootOne(refused, canberra)).toBe("no-browser");
  expect(await row("canberra-events")).toMatchObject({ snapshot_status: "ok" });
  expect(console.error).toHaveBeenCalledWith("snapshots: no browser for the re-shoot of canberra-events:", expect.any(Error));
});
```

In `tests/unit/actions.test.ts`, change the run import to:

```ts
import type { ReshootOutcome, ShotOutcome } from "../../workers/snapshots/src/run";
```

change the `reshoot` helper's signature to `const reshoot = async (answer: ReshootOutcome | Error | null, id = "1") => {`, and add after `"a capture that fails says why, on its line"`:

```ts
  test("a browser that couldn't start says so, on its line", async () => {
    expect((await reshoot("no-browser")).result).toEqual({
      ok: false,
      section: "snapshots",
      form: "shot-1",
      errors: { form: "the browser couldn't start. try again in a minute." },
      values: {},
    });
  });
```

Run: `bun run test:unit tests/unit/snapshot-run.test.ts tests/unit/actions.test.ts`
Expected: FAIL: `reshootOne` throws the launch error; `ReshootOutcome` isn't exported (Vitest still runs), and the action says "couldn't capture it: no-browser".

- [ ] **Step 2: The outcome and its message**

In `workers/snapshots/src/run.ts`, add after the `ShotOutcome` type:

```ts
/** What "re-shoot now" answers: a capture's outcome; "gone" when the line has no page to snapshot; "no-browser" when
 *  Browser Rendering wouldn't start a session (a rate or concurrency limit, or an outage) */
export type ReshootOutcome = ShotOutcome | "gone" | "no-browser";
```

and replace `reshootOne` and its comment with:

```ts
/**
 * The admin's "re-shoot now": one line, its own session; "gone" when it has no page to snapshot, "no-browser" when the
 * session won't start (nothing was captured, so the line keeps its status). A capture that throws is recorded on the line
 * and thrown on, so the admin says the worker hit an error (the Worker's RPC method logs it)
 */
export async function reshootOne(deps: RunDeps, id: number): Promise<ReshootOutcome> {
  const [target] = await shotTargets(deps.db, id);
  if (!target) return "gone";
  let browser: CaptureBrowser;
  try {
    browser = await deps.launch();
  } catch (error) {
    console.error(`snapshots: no browser for the re-shoot of ${target.slug}:`, error);
    return "no-browser";
  }
  try {
    return await shootOne(deps, browser, target);
  } catch (error) {
    await recordError(deps.db, target);
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}
```

In `src/lib/admin/actions.ts`, change the import to:

```ts
import type { ReshootOutcome } from "../../../workers/snapshots/src/run";
```

in `SnapshotsService`, change `reshoot(id: number): Promise<ShotOutcome | "gone">;` to `reshoot(id: number): Promise<ReshootOutcome>;`; in `reshoot`, change `let outcome: ShotOutcome | "gone";` to `let outcome: ReshootOutcome;` and add after `if (outcome === "ok") return { ok: true, section: "snapshots" };`:

```ts
  if (outcome === "no-browser") return fail("snapshots", formId, { form: "the browser couldn't start. try again in a minute." });
```

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors (any other `ShotOutcome` use in `actions.ts` takes `ReshootOutcome` too); every unit test passes.

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/snapshots-live.spec.ts tests/e2e/admin-page.spec.ts --project=chromium`
Expected: every test passes.

Mention in the task report (no change needed): the deploy job ships the snapshots Worker first, so for the seconds before the site Worker deploys, a refused re-shoot would read "couldn't capture it: no-browser" (`snapshotReason` falls back to the raw status).

- [ ] **Step 3: Commit**

```bash
git add workers/snapshots/src/run.ts src/lib/admin/actions.ts tests/unit/snapshot-run.test.ts tests/unit/actions.test.ts
git commit -m "fix: a re-shoot whose browser wouldn't start says so, and leaves the line as it was"
```

---

### Task 14: CI keeps wrangler's Chrome whatever the result

A plan 4 follow-up: the CI cache of the Chrome that wrangler downloads for local Browser Rendering was saved only when the job passed, so a red run made the next one download it again. The cache is now restored before the e2e step and saved after it whatever the result, unless it was an exact hit.

**Files:**
- Modify: `.github/workflows/ci.yml` (the check job's cache step)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks use.

- [ ] **Step 1: Restore, then save always**

In `.github/workflows/ci.yml`, replace the comment, the `actions/cache@v6` step and the `bun run test:e2e` step with:

```yaml
      # Local Browser Rendering (the snapshot specs) downloads Chrome on first use; keep it between runs. Saved after the
      # e2e step whatever its result, so a red run doesn't make the next one download Chrome again
      - uses: actions/cache/restore@v6
        id: chrome
        with:
          path: ~/.cache/.wrangler/chrome
          key: wrangler-chrome-${{ hashFiles('bun.lock') }}
          restore-keys: wrangler-chrome-
      - run: bun run test:e2e
      - uses: actions/cache/save@v6
        if: always() && steps.chrome.outcome == 'success' && steps.chrome.outputs.cache-hit != 'true'
        with:
          path: ~/.cache/.wrangler/chrome
          key: wrangler-chrome-${{ hashFiles('bun.lock') }}
```

(the `actions/upload-artifact@v7` step after it stays as it is).

- [ ] **Step 2: Check the workflow still parses and reads in order**

Run: `bun -e 'const y = Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text()); console.log(y.jobs.check.steps.map((s) => s.uses ?? s.run).join("\n"))'`
Expected: the check job's steps in order, with `actions/cache/restore@v6` just before `bun run test:e2e` and `actions/cache/save@v6` just after it, then `actions/upload-artifact@v7`.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: keep wrangler's Chrome in the cache even when a check fails"
```

---

### Task 15: a scratch draws no shadow map per move

A known flake's cause (Step 3 confirms it under the same load), and a real cost on the visitor's machine. Each pointer move of a scratch asked the loop for a frame (`loop.invalidate()`), and a frame asked for redraws the 2048 shadow map, although turning a disc changes no shadow (the reason spinning-only frames already skip it). While scratching the loop already draws every frame, so the moves needn't ask. Measured on 5 October 2026 under `--workers=14`: each `mouse.move` of a scratch took about 3.5s while the scene drew in software, so the two scratch tests' 24 moves ran past their 90s budget in 18 of 20 runs. The page keeps a count of shadow-map redraws for the test hooks, so the e2e spec can pin it.

**Files:**
- Modify: `src/deck/scene/loop.ts` (a `shadows` count, the comment), `src/deck/scene/hooks.ts` (`shadows()`), `src/deck/scene/pointer.ts` (`scratch()`)
- Test: `tests/unit/loop.test.ts`, `tests/e2e/deck-scratch.spec.ts`

**Interfaces:**
- Consumes: `src/deck/scene/pointer.ts` as Task 4 left it.
- Produces: `Loop.shadows: number` (frames that redrew the shadow map); `SceneHooks.shadows(): number`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/loop.test.ts`, add at the end:

```ts
test("a scratch draws every frame and redraws the shadow map only on its first, and the loop counts the redraws", async () => {
  const { loop, shadows } = setup();
  loop.setVisible(true);
  await vi.advanceTimersByTimeAsync(20);
  expect(loop.shadows).toBe(1);
  const before = shadows.length;
  loop.setScratching(true);
  await vi.advanceTimersByTimeAsync(200);
  const scratching = shadows.slice(before);
  expect(scratching.length).toBeGreaterThan(8); // every frame, not capped at 30 a second
  expect(scratching[0]).toBe(true); // the frame setScratching asked for
  expect(scratching.slice(1).every((redrawn) => redrawn === false)).toBe(true);
  expect(loop.shadows).toBe(2);
  loop.stop();
});
```

In `tests/e2e/deck-scratch.spec.ts`, in `"dragging the spinning record scratches it; letting go plays on at normal speed"`, add before `await page.mouse.down();`:

```ts
  const shadowsBefore = await page.evaluate(() => window.__deckScene!.shadows());
```

add before `await page.mouse.up();`:

```ts
  // Turning a disc changes no shadow: the drag's moves draw frames but leave the 2048 shadow map alone (the one redraw is
  // the frame the scratch's start asks for)
  expect((await page.evaluate(() => window.__deckScene!.shadows())) - shadowsBefore).toBeLessThanOrEqual(1);
```

and in both scratch tests replace `{ timeout: 3000 * SLOW }` (the waits for the rate to settle back to 1) with `{ timeout: 10_000 * SLOW }`: the release is a 420ms tween stepped by frames, and each read of the rate is a round trip to a page drawing in software.

Run: `bun run test:unit tests/unit/loop.test.ts`
Expected: FAIL: `loop.shadows` is `undefined`.

- [ ] **Step 2: Count the redraws, and stop asking for them per move**

In `src/deck/scene/loop.ts`, add to the `Loop` interface after `readonly frames: number;`:

```ts
  /** Frames that redrew the shadow map, for the test hooks */
  readonly shadows: number;
```

replace the comment above `renderer.shadowMap.autoUpdate = false;` with:

```ts
  // The shadow map is redrawn only when something casting a shadow may have moved: a tween, or a frame asked for.
  // Spinning, a scratch turning the platter by hand and the candle's flicker change nothing a shadow shows (the record's
  // shadow is a disc), so the 2048 map isn't redrawn 30 times a second for a whole track, or on every move of a scratch
  // (plan 2 and plan 4 follow-ups).
```

add `let shadows = 0;` after `let frames = 0;`, replace `renderer.shadowMap.needsUpdate = dirty || stepping;` with:

```ts
      renderer.shadowMap.needsUpdate = dirty || stepping;
      if (renderer.shadowMap.needsUpdate) shadows += 1;
```

and add to the returned object, after the `frames` getter:

```ts
    get shadows() {
      return shadows;
    },
```

In `src/deck/scene/hooks.ts`, add to `SceneHooks` after `frames(): number;`:

```ts
  /** Frames that redrew the shadow map */
  shadows(): number;
```

and to `window.__deckScene`, after `frames: () => loop.frames,`:

```ts
    shadows: () => loop.shadows,
```

In `src/deck/scene/pointer.ts`, in `scratch()`, delete the last line, `loop.invalidate();` (the loop draws every frame while scratching, since `setScratching(true)`).

Run: `bun run typecheck && bun run test:unit tests/unit/loop.test.ts`
Expected: 0 errors; PASS.

- [ ] **Step 3: The scratch end to end, alone and under load**

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-scratch.spec.ts --project=chromium --project=webkit`
Expected: every test passes: the rate still bends, the platter still moves and a drag redraws the shadow map at most once.

Now the same load on the same build with and without the `pointer.ts` edit, so the cause is measured, not assumed. First without it:

```bash
git stash push src/deck/scene/pointer.ts && bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-scratch.spec.ts --project=chromium --repeat-each=10 --workers=14 --reporter=line --trace=on; git stash pop && bun run build:test
```

Then with it:

Run: `pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/deck-scratch.spec.ts --project=chromium --repeat-each=10 --workers=14 --reporter=line --trace=on`
Expected: no failures (on 5 October, before this task, 18 of 20 timed out here). Report both runs' failure counts and the slowest `mouse.move` from a trace of each (`npx playwright show-trace`). If any still times out, commit Steps 1 and 2 anyway (the change stands on its own), say in the task report how far it moved the per-move time and that the flake remains, so Task 17 lists it under the plan 5 follow-ups' Testing, and go on. Never raise the 90s budget.

- [ ] **Step 4: Commit**

```bash
git add src/deck/scene/loop.ts src/deck/scene/hooks.ts src/deck/scene/pointer.ts tests/unit/loop.test.ts tests/e2e/deck-scratch.spec.ts
git commit -m "perf: a scratch's moves no longer redraw the shadow map, which also steadies the scratch specs"
```

---

### Task 16: the other known flakes, fixed at their root

The rest of plan 4's "Known flakes under full-suite load", each reproduced on 5 October 2026 on George's Mac (14 cores) with `--repeat-each` and `--workers=14`, roughly the load of two full suites at once. CI runs one worker (ADR-0009) and has passed every run. What each was, and its fix:

- **`labels.spec.ts` "two quick Escapes"** (2 of 3 runs, at the default 7 workers too). Not load: the trace shows both Escapes 2.4ms apart, as meant. The browser closing the dialog returns focus to the frame at once, but dispatches the `close` event, whose listener records `atClose`, a task later; the test read `atClose` in between. Fix: poll for it.
- **`deck-crate.spec.ts` "the arrows are disabled while a record travels"** (10 of 12). The press took 2.8s and each of the three assertions after it 2 to 3s, as the page drew the scene in software, so by the third (7.5s after the press) the 2.5s journey had ended and the control read `stop`. Fix: the page records the control's states from before the press, and the test reads them once.
- **`log.spec.ts` "older entries expand and collapse"** (1 of 12; 15 of 42 in an instrumented run). After the close, the page's 300ms timer and the drawer's `transitionend` both arrived 4.1 to 6.6s late: the whole renderer stalled, timers and frames alike, longer than Playwright's default 5s wait. Fix: that wait gets 15s (`STALL_MS`). The labels' first test waits on the same kind of close timer (320ms) and gets the same.
- **`privacy.spec.ts` "cookies none, storage empty, every request first party"** (4 of 10). Pressing play scrolls the list into view, which brings in the 3D scene; with the scene drawing in software, the clicks took 2 to 10s each and the test ran past the default 30s. Fix: the scene specs' budget, `90_000 * SLOW`.
- **`admin-gate.spec.ts` "a write from this site's origin gets through the gate"** (500 on a cold server; not reproduced in 10 runs). wrangler dev's proxy retries a dropped connection to the Worker only for GET and HEAD (`node_modules/wrangler/wrangler-dist/ProxyWorker.js`); a POST that meets one gets the proxy's own 500, which carries none of the headers the site puts on every response it sends, its own 500s included. Fix: the test's writes go through a helper that sends a POST again only after that proxy 500, and logs what it absorbed, so a run that meets one confirms the cause.
- **`deck-scratch.spec.ts`'s two scratch tests:** Task 15.

**Files:**
- Create: `tests/e2e/load.ts`, `tests/e2e/site.ts`
- Modify: `tests/e2e/labels.spec.ts`, `tests/e2e/deck-crate.spec.ts`, `tests/e2e/log.spec.ts`, `tests/e2e/privacy.spec.ts`, `tests/e2e/admin-gate.spec.ts`

**Interfaces:**
- Consumes: `SLOW` from `tests/e2e/deck.ts`.
- Produces: `STALL_MS = 15_000` (`tests/e2e/load.ts`); `postToSite(url: URL | string, init: RequestInit): Promise<Response>` (`tests/e2e/site.ts`).

- [ ] **Step 1: Reproduce them**

Run: `bun run build:test && pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/labels.spec.ts tests/e2e/deck-crate.spec.ts tests/e2e/log.spec.ts tests/e2e/privacy.spec.ts tests/e2e/admin-gate.spec.ts --project=chromium --repeat-each=10 --workers=14 --reporter=line`
Expected: failures among "two quick Escapes" (`Received: undefined`), "the arrows are disabled while a record travels" (`Expected: "cueing"`, `Received: "stop"`), "older entries expand and collapse" (`hidden` still `null` after 5s) and "cookies none, storage empty ..." (`Test timeout of 30000ms exceeded`). Note the counts for the report.

- [ ] **Step 2: Two quick Escapes**

In `tests/e2e/labels.spec.ts`, in `"two quick Escapes put the snapshot back and focus on the frame as the browser closes the dialog, then a third closes the label"`, replace:

```ts
  expect(await page.evaluate(() => (window as unknown as { atClose: object }).atClose)).toEqual({ snapshot: "visible", focused: true });
```

with:

```ts
  // The browser returns focus to the frame as it closes the dialog, but dispatches "close" a task later: wait for it
  await expect.poll(() => page.evaluate(() => (window as unknown as { atClose?: object }).atClose)).toEqual({ snapshot: "visible", focused: true });
```

- [ ] **Step 3: The travelling control, recorded by the page**

In `tests/e2e/deck-crate.spec.ts`, replace the test `"the arrows are disabled while a record travels"` with:

```ts
test("the arrows are disabled while a record travels", async ({ page }) => {
  // From record 1, so both arrows are live at rest (on record 0 the previous arrow is disabled anyway)
  await control(page, "next").click();
  await settled(page);
  // The page records the control's every state from before the press: with the scene drawing in software, each round
  // trip to the page can take longer than the 2.5s journey, so asking afterwards can miss the travelling state entirely
  await page.evaluate(() => {
    const states: string[] = [];
    (window as unknown as { states: string[] }).states = states;
    const hud = document.querySelector(".crate-hud")!;
    const read = (act: string, name: string) => hud.querySelector(`[data-act="${act}"]`)!.getAttribute(name);
    new MutationObserver(() => states.push(`${read("prev", "aria-disabled")} ${read("play", "data-state")} ${read("next", "aria-disabled")}`)).observe(hud, {
      attributes: true,
      subtree: true,
      attributeFilter: ["aria-disabled", "data-state"],
    });
  });
  await control(page, "play").click();
  await playing(page, 1);
  const states = await page.evaluate(() => (window as unknown as { states: string[] }).states);
  // It travelled, and whenever it did, both arrows were disabled
  expect(states).toContain("true cueing true");
  expect(states.filter((state) => state.includes("cueing")).every((state) => state === "true cueing true")).toBe(true);
  await expect(control(page, "next")).toHaveAttribute("aria-disabled", "false");
  await expect(control(page, "play")).toHaveAttribute("data-state", "stop");
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});
```

- [ ] **Step 4: Waits that cover a stalled renderer**

Create `tests/e2e/load.ts`:

```ts
/**
 * How long to wait for work the page does on its own timers and animations. Under parallel load (measured on 5 October
 * 2026 with --workers=14 on a 14-core Mac) a headless renderer stalled for up to 6.6s, timers and frames alike: longer
 * than Playwright's default 5s. CI's single worker never stalls (ADR-0009). A long wait costs nothing when the page is quick.
 */
export const STALL_MS = 15_000;
```

In `tests/e2e/log.spec.ts`, add the import:

```ts
import { STALL_MS } from "./load";
```

and in `"older entries expand and collapse"` replace the last assertion with:

```ts
  // Hidden again by a 300ms timer once the drawer has closed, which a loaded machine can run seconds late
  await expect(page.locator("#older-entries")).toHaveAttribute("hidden", "until-found", { timeout: STALL_MS });
```

In `tests/e2e/labels.spec.ts`, add `import { STALL_MS } from "./load";` after the first import, and in `"clicking a labelled line opens its label in place; Esc closes and returns focus"` replace the last assertion with:

```ts
  await expect(drawer).toHaveAttribute("hidden", "until-found", { timeout: STALL_MS }); // a 320ms timer, which load can delay
```

In `tests/e2e/privacy.spec.ts`, add the import:

```ts
import { SLOW } from "./deck";
```

and add as the first line of `"cookies none, storage empty, every request first party"`'s body:

```ts
  // Playing a record brings the 3D scene in (the list scrolls into view), so this gets the scene specs' budget
  test.setTimeout(90_000 * SLOW);
```

- [ ] **Step 5: Writes that survive wrangler's proxy**

Create `tests/e2e/site.ts`:

```ts
/**
 * A write to the local site through wrangler dev. Its proxy retries a dropped connection to the Worker only for GET and
 * HEAD; a POST that meets one (on a server just started, or under load) gets the proxy's own 500, without the headers
 * every response from the site carries, its own 500s included (the middleware's Strict-Transport-Security). That 500, and
 * only that one, is sent again.
 */
export async function postToSite(url: URL | string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, method: "POST" });
  if (response.status !== 500 || response.headers.has("strict-transport-security")) return response;
  // Not the site's 500: say what it was, so a run that meets one shows the cause instead of hiding it
  console.warn(`postToSite: a 500 without the site's headers from ${url}, sent again: ${(await response.text()).slice(0, 200)}`);
  return fetch(url, { ...init, method: "POST" });
}
```

In `tests/e2e/admin-gate.spec.ts`, add the import:

```ts
import { postToSite } from "./site";
```

in `"a write without this site's origin is refused, with the security headers"`, replace the `fetch` call with:

```ts
      const response = await postToSite(new URL(path, baseURL), { body, headers: origin ? { Origin: origin } : {} });
```

and in `"a write from this site's origin gets through the gate"`, replace `const response = await fetch(new URL("/admin/", baseURL), { method: "POST", ... });` with:

```ts
  const response = await postToSite(new URL("/admin/", baseURL), {
    body: new URLSearchParams({ intent: "nothing-at-all" }),
    headers: { Origin: new URL(baseURL!).origin },
  });
```

- [ ] **Step 6: Run them under the same load, and the whole suite**

Run: `bun run typecheck`
Expected: 0 errors.

Run: `pkill -f "port 433[1234]"; bun run test:e2e tests/e2e/labels.spec.ts tests/e2e/deck-crate.spec.ts tests/e2e/log.spec.ts tests/e2e/privacy.spec.ts tests/e2e/admin-gate.spec.ts --project=chromium --repeat-each=10 --workers=14 --reporter=line`
Expected: no failures. If one remains, leave that spec's change out of the commit, commit the rest, report the remaining one's trace (`npx playwright show-trace`) in the task report so Task 17 lists it under the plan 5 follow-ups' Testing, and go on. Don't add a retry.

Run: `pkill -f "port 433[1234]"; bun run test:e2e`
Expected: everything passes at the default worker count.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/load.ts tests/e2e/site.ts tests/e2e/labels.spec.ts tests/e2e/deck-crate.spec.ts tests/e2e/log.spec.ts tests/e2e/privacy.spec.ts tests/e2e/admin-gate.spec.ts
git commit -m "test: the known flakes fixed at their causes: event order, round trips, renderer stalls, the scene's budget and wrangler's proxy"
```

---

### Task 17: the docs

The spec, the roadmap, the follow-up files and the README brought up to what plan 5 built, and a plan 5 follow-ups file for what's left. ADR-0016 is already written and Accepted; ADR-0017 came with Task 2.

**Files:**
- Create: `docs/superpowers/plans/2026-10-05-plan-5-followups.md`
- Modify: `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`, `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`, `docs/superpowers/plans/2026-10-04-plan-2-followups.md`, `docs/superpowers/plans/2026-10-04-plan-3-followups.md`, `docs/superpowers/plans/2026-10-05-plan-4-followups.md`, `README.md`

**Interfaces:**
- Consumes: everything plan 5 built.
- Produces: nothing later tasks use.

- [ ] **Step 1: The spec**

In `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`, make these replacements (each "old" text appears once; a span in double backticks is quoted exactly, its inner backticks included):

1. Header: `to [ADR-0016](../../adr/0016-admin-worker-checks-the-signed-in-email.md)` becomes `to [ADR-0017](../../adr/0017-environment-map-generated-in-the-browser.md)`.
2. Section 4.1, the hover bullet: `` The card shows the snapshot and `click for the label`. `` becomes `` The card shows the snapshot and `click for the label`, once its picture has loaded (never an empty card), and slides back inside the page when its pill is near the edge. ``
3. Section 4.1, the closer look bullet: `The image grows from its frame to fit the viewport (FLIP, 420ms ease-out-quint) over a paper veil;` becomes `It opens at once with the frame's own picture, which grows from its frame to fit the viewport (FLIP, 420ms ease-out-quint) over a paper veil, and the 1920px file (AVIF or WebP, as the frame chose) takes its place in the same box when it arrives;`
4. Section 4.1, the last bullet: `and the page is otherwise complete.` becomes `and the page is otherwise complete. Without JavaScript each track is a link to its MP3, which the browser plays in its own player.`
5. Section 5.2, replace the whole `- Posters: two WebP stills ...` bullet with:

```markdown
- Posters: four WebP stills, each under 60KB: day, and night (candlelight, as the scene renders from 19:00 to 06:00 in Sydney), each in desktop and phone framing. They show no record on the platter and one plain, unprinted sleeve in the crate's front slot, which is true whenever the corner shows, because it only shows with at least one active record. A Playwright script (`bun run poster`) renders them locally with WebGL and the output is committed; rerun it whenever the scene changes. The page is cached at the edge for a day, so the server can't choose: an inline script straight after the poster's markup picks the night pair before it paints (only one poster is ever fetched), allowed by its hash in the CSP. Without JavaScript the day pair shows.
```

6. Section 5.3, after the `- Load: ...` bullet, add:

```markdown
- A press made while the scene is still downloading waits for it. If `want` changes before the scene arrives, that record never leaves the crate.
```

7. Section 5.4, the track list bullet: `including while the scene chunk is still loading.` becomes `including while the scene chunk is still loading. Without JavaScript each track is a link to its MP3, which the browser plays in its own player; the deck script turns each link into its play button.`
8. Section 5.4, replace the `- Hint line: ...` bullet with:

```markdown
- Hint line: `flip through the crate with ‹ ›, or pick a track. nothing plays until you do.` while the scene is live, and `pick a track. nothing plays until you do.` otherwise (no WebGL, before the scene arrives, after a lost context and without JavaScript). Both share one grid cell, so the line keeps the longer one's height and nothing shifts.
```

9. Section 5.4, the easter egg: `Easter egg (mouse and pen; touch keeps scrolling the page):` becomes `Easter egg (mouse only; touch and pen keep scrolling the page):`.
10. Section 5.5: `a press during the scene chunk download mounts exactly one scene;` becomes `a press during the scene chunk download mounts exactly one scene, and a different press or a stop during it moves nothing out of the crate;`.
11. Section 7, the first bullet: `with the Access cookie set to SameSite Lax or Strict.` becomes `` with a 1 month session and the Access cookie set to SameSite Lax (HttpOnly on). `/admin` shows when the session ends (`signed in as hello@curiousgeorge.dev until 05.11.26 · the logbook`), from the token's `exp` as Sydney's date, so an expiry shows before a save is typed; the local bypass shows none. ``
12. Section 9: `a blank page (nothing visible: no text, images, video, canvas or frames)` becomes `a blank page (nothing visible: no text, images, video, canvas, frames or CSS background)`.
13. Section 9: `The nightly run captures every line in one browser session.` becomes `The nightly run captures every line in one browser session; a line that errors gets the next line a fresh session (the error may have been the session dying), at most three sessions a night, and a line left with no session keeps its status.`
14. Section 9: `A Worker that doesn't answer within 60s, and one that fails, each say so on the line.` becomes `A Worker that doesn't answer within 60s, and one that fails, each say so on the line, and so does a session Browser Rendering won't start ("the browser couldn't start"; the line keeps its status).`
15. Section 11, the first paragraph: `for opening a label, showing older log entries and opening the closer look (pressing play is reported, at about 200ms at 4× CPU, not gated, until the deck builds its audio context before the first press).` becomes `for opening a label, showing older log entries, opening the closer look and pressing play (the deck builds its audio context in an idle moment after load, so the press only resumes it).`
16. Section 11, the scene chunk bullet: `` No scene task over 50ms at 4× CPU throttle, measured locally with `SCENE_PERF=1` (CI renders WebGL in software, so it is reported there, not gated). `` becomes `` No scene task over 50ms at 4× CPU throttle, except one: generating the environment map, about 70ms at 4×, once, before the canvas shows, while the poster is still on screen (ADR-0017). Measured locally with `SCENE_PERF=1` in a browser drawing WebGL on a GPU (CI renders in software, so it is reported there, not gated). ``
17. Section 11: `Posters: under 60KB each.` becomes `Posters (four): under 60KB each.`
18. Section 13, the Access line: `cookie SameSite Lax or Strict and a session long enough for a phone: when it runs out, a save in progress is lost)` becomes `` a 1 month session (`730h` through the API) and its cookie set to SameSite Lax with HttpOnly on: when the session runs out, a save in progress is lost, and `/admin` shows the day it ends) ``.
19. Section 13, after the `- [ ] After the first nightly run (17:00 UTC), ...` line, add:

```markdown
- [ ] In the same first nightly run, check the snapshot variants' sizes in R2 against section 11's budgets (480px under 30KB, 960px under 70KB): the local Images binding ignores `quality`, so the quality steps only run for real in production.
- [ ] The first time "re-shoot now" fails on the deployed pair, check the admin said "the snapshots worker hit an error" and not "didn't answer": the RPC exception's `remote` flag that tells them apart is documented for Durable Objects and seen under `wrangler dev`, but not checked deployed.
- [ ] Once Lighthouse's post-deploy runs have proven steady on GitHub's runners, add `--strict` to the deploy job's `bun run lighthouse` step and drop its `continue-on-error`, so a page over budget fails the deploy.
```

20. Section 13: `- [x] ADR-0001 to ADR-0016 are Accepted (signed off on 5 October 2026).` becomes `- [x] ADR-0001 to ADR-0017 are Accepted (signed off on 5 October 2026).`
21. Section 14, the first bullet: `the listening corner suite (section 5.5);` becomes `the listening corner suite (section 5.5) and the posters (by day, by night and without JavaScript);`.
22. Section 14, the snapshots bullet: `a line changed or removed mid-capture and the week-old clean-up;` becomes `a line changed or removed mid-capture, a session that dies mid-run, a browser that won't start, the week-old clean-up and its 1000-key batches; the blank-page question runs in a real browser against a page per case, a CSS background among them;`.
23. Section 12.1, the CSP bullet: `` (`security.csp`, which adds hashes for inline scripts and styles) `` becomes `` (`security.csp`, which adds hashes for inline scripts and styles; the night poster's inline script is the one Astro doesn't hash, so `astro.config.mjs` hashes it from `src/scripts/night-poster.mjs`, the same string `Turntable.astro` renders) ``.
24. Section 5.3, the audio bullet: `` (resume the `AudioContext` and prime the element inside the gesture) `` becomes `` (resume the `AudioContext`, built suspended in an idle moment after load, and prime the element inside the gesture) ``.

- [ ] **Step 2: The roadmap**

In `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`:

- `so it ships as four plans,` becomes `so it ships as four plans and a fifth that closes their open ends before launch,`.
- After the plan 4 row, add:

```markdown
| 5. Polish | The admin email check and the session's end on `/admin`; George's seven product answers (the environment map, the hint, posters with a plain sleeve and a night pair, a changed mind during the download, a mouse-only scratch, tracks that play without JavaScript and the Access session); every plan 4 follow-up that is code; the known e2e flakes fixed at their causes | 1 to 4 | [Done](2026-10-05-plan-5-polish.md); [follow-ups](2026-10-05-plan-5-followups.md) |
```

- Replace the launch gate paragraph (under `## Launch gate`) with:

```markdown
The branch merges to `main` (which deploys through GitHub Actions) only when all five plans are done and George has completed the launch checklist in spec section 13: real label sentences and log entries, track licences, the Cloudflare Access application (a 1 month session with its cookie SameSite Lax; its team domain and AUD tag go in wrangler.jsonc, beside `ADMIN_EMAIL`), the PostHog key as a Worker secret, PostHog's cookieless setting, zone settings, GitHub secrets (including `CLOUDFLARE_ZONE_ID` and the token's Cache Purge permission), disconnecting Workers Builds, creating the R2 bucket and uploading the starting crate (`bun run seed:media --remote`), creating the remote D1 database (`bunx wrangler d1 create curiousgeorge-logbook --location oc`, then putting its id in `wrangler.jsonc` and `workers/snapshots/wrangler.jsonc`), confirming the `curiousgeorge.dev` custom domain is still attached to the `personal-website` Worker after the first deploy, the post-deploy checks plan 5 left (the snapshot variants' sizes, Lighthouse `--strict` and the RPC `remote` flag) and a real-device Safari check.
```

- [ ] **Step 3: The earlier follow-ups**

In `docs/superpowers/plans/2026-10-04-plan-2-followups.md`:

- In `### Scene performance`, `- **The environment map hitch.** Spec 11 asks` becomes `- **The environment map hitch.** Decided: accept it, done in [plan 5](2026-10-05-plan-5-polish.md) (Task 2, ADR-0017). Spec 11 asks`.
- Under `## Questions for George`, add before the existing first paragraph, followed by a blank line:

```markdown
All six were answered on 5 October 2026 and are done in [plan 5](2026-10-05-plan-5-polish.md): 1, accept the hitch (Task 2, ADR-0017); 2, two hint sentences in one cell (Task 5); 3, posters with one plain sleeve and a night pair (Task 7); 4, a record whose press is undone during the download never leaves the crate (Task 3); 5, the scratch is mouse only (Task 4); 6, each track is a link to its MP3 that the deck makes a play button (Task 6).
```

- `` the `.hint` class name is shared with the track list's hint paragraph. `` becomes `` the `.hint` class name is shared with the track list's hint paragraph (plan 5 scoped the hint's rules to `.corner > .hint`). ``
- `` `scripts/poster.mjs` uses a fixed 500ms wait, couples to the markup and has no `try`/`finally`. `` becomes `` `scripts/poster.mjs` uses a fixed 500ms wait and couples to the markup (plan 5 added the `try`/`finally`). ``

In `docs/superpowers/plans/2026-10-04-plan-3-followups.md`, under `## Questions for George`, add straight after the heading, followed by a blank line:

```markdown
Both answered on 5 October 2026 and done in [plan 5](2026-10-05-plan-5-polish.md) (Task 1, ADR-0016): a 1 month session with the cookie SameSite Lax (dashboard settings, on the launch checklist), `/admin` shows when it ends and the Worker checks the email against `ADMIN_EMAIL`.
```

Replace `docs/superpowers/plans/2026-10-05-plan-4-followups.md` with:

```markdown
# Plan 4 follow-ups

What plan 4 (snapshots and analytics) found or left for later. [Plan 5](2026-10-05-plan-5-polish.md) did every item that is code; the three that can only be checked after a deploy are on the launch checklist (spec 13).

## Later

- The local Images binding ignores `quality`, so the variants' quality steps are only exercised for real in production. Check the first nightly run's file sizes in R2 against spec 11's budgets. **Launch check (spec 13).**
- Lighthouse's post-deploy runs are a warning, not a gate. If they prove steady on GitHub's runners, `--strict` turns them into one. **Launch check (spec 13).**
- The environment map's hitch (plan 2 question 1) is unchanged: the opt-in `scene-perf.spec.ts` still fails on it. **Done in plan 5 (Task 2, ADR-0017):** accepted as the one allowed long task; the spec passes on that basis.
- The hover card for a line near the window's right edge is cut at the edge between about 800 and 860px wide. **Done in plan 5 (Task 9):** it slides back inside on each hover.
- The closer look opened only once the 1920px file had downloaded and decoded. **Done in plan 5 (Task 10):** it opens at once with the frame's picture and swaps the big file in.
- A refused Browser Rendering session read as "the snapshots worker hit an error". **Done in plan 5 (Task 13):** "the browser couldn't start".
- Pressing play cost about 200ms at 4× CPU, most of it building the `AudioContext` inside the first press. **Done in plan 5 (Task 8):** built after load, and the play check is gated.
- A page that is only a CSS background image read as blank and kept its previous snapshot. **Done in plan 5 (Task 12).**
- If the browser session died mid-run, the rest of that night's lines errored, with no relaunch. **Done in plan 5 (Task 11):** a fresh session after a line that errors, at most three a night.
- `sweep`'s 1000-key delete batches had no suite test. **Done in plan 5 (Task 11).**
- No test made the snapshots Worker's `scheduled()` or `reshoot()` fail. **Done in plan 5 (Task 11).**
- The CI Chrome cache was saved only when the job passed. **Done in plan 5 (Task 14).**
- The RPC exception's `remote` flag, used to tell a Worker that threw from one that didn't answer, is documented for Durable Objects and seen under `wrangler dev`, but not checked deployed. If it differs, a thrown error reads "didn't answer". **Launch check (spec 13).**
- A slow first hover could fade in an empty card. **Done in plan 5 (Task 9).**
- A 1920 request that never settled left every frame ignoring clicks. **Done in plan 5 (Task 10).**
- The fallback picture (when the 1920 fails) grew to twice the frame, not to fit the window. **Done in plan 5 (Task 10).**

### Test gaps

All closed in plan 5.

- A Turntable button without `data-id` (Task 6, `playedProperties`).
- Closing a label, or a find-in-page reveal, not counted by the beacon (Task 9).
- A record dropped mid-load (Task 3).
- A real Tab reaching the pill (Task 9).

### Known flakes under full-suite load

All fixed at their causes in plan 5 (Tasks 15 and 16), each reproduced with `--workers=14`.

- `log.spec.ts` "older entries expand and collapse": the renderer stalled up to 6.6s, past the 5s wait.
- `deck-crate.spec.ts` "the arrows are disabled while a record travels": round trips slower than the journey; the page now records the states.
- `admin-gate.spec.ts` "a write from this site's origin gets through the gate": wrangler dev's proxy retries a dropped connection only for GET and HEAD.
- `deck-scratch.spec.ts`'s two scratch tests: every scratch move redrew the 2048 shadow map.
- `privacy.spec.ts` "cookies none, storage empty, every request first party": the scene came in under the default 30s budget.
- `labels.spec.ts` "two quick Escapes": the `close` event is dispatched a task after the browser returns focus.
```

- [ ] **Step 4: The plan 5 follow-ups and the README**

Create `docs/superpowers/plans/2026-10-05-plan-5-followups.md`:

```markdown
# Plan 5 follow-ups

What plan 5 (polish) found or left for later.

## Launch

- The three post-deploy checks from plan 4 are on spec 13's checklist: the snapshot variants' sizes in R2, Lighthouse `--strict` once its runs are steady and the RPC `remote` flag on a real failure.
- The Access application's 1 month session and SameSite Lax cookie are dashboard settings, on the checklist with the application itself.
- The audio graph is now built before the first press and resumed inside it. The real-device check on the checklist (an iPhone, once with the ringer switch on silent, and Safari for macOS) covers this path too.
- If a real phone shows the environment map taking far more than 70ms, measure compile time against GPU time before revisiting ADR-0017.

## Later

- A visit that crosses 19:00 or 06:00 in Sydney keeps the poster, and the scene's light, it had at load (plan 2 noted the light; the spec is silent).
- A tap, or keyboard focus, in the instant before the inlined deck script runs: the tap follows the track's link to the MP3 instead of cueing the record (the track still plays), and focus on a link drops to the page when the link becomes a button.
- From 16:00 to 19:00 the scene is golden and the poster is the day one; a golden pair would close it.
- Chrome logs "The AudioContext was not allowed to start" on every load, because the deck builds its graph before the first press (plan 5); it's a warning: the press resumes the context and no check counts it.
- The label-closed guard in `closer.ts` lost its e2e test with the wait it covered: the window is now one `decode()` of a picture already decoded.
- A page counts as showing something when only its `<html>` or `<body>` has a CSS background (plan 5 chose this, so a page drawn only in CSS is captured). The cost: a single-page app whose shell failed to render over a body gradient or texture is captured as that blank, styled page and replaces the last good snapshot. If that bites, count only elements with a box.
- The closer look swaps the 1920 in without a crossfade; a sharper file landing mid-grow is a small change of detail, not of size.
- The hover card measures its nudge on each hover, so a window resized while a card is up keeps the old nudge until the next hover.
- The rate tween after a scratch still redraws the shadow map for its 420ms, as every tween's frames do; nothing it moves casts a shadow.
- When Browser Rendering refuses every session, the nightly run leaves every line's status as it was and logs `no browser` for each; the previous snapshots stay.
- `scripts/poster.mjs` still waits a fixed 500ms for the scene to settle and reads the page's markup (plan 2).

## Testing

- Under oversubscription (two suites at once, or `--workers` above the default) a headless renderer can stall for seconds. Plan 5 gave the two waits that met it `STALL_MS`; other waits on the page's own timers keep Playwright's 5s. Run one suite at a time.
```

In `README.md`:

- In "The admin page", replace the first sentence, `/admin` sits behind Cloudflare Access., with:

```markdown
`/admin` sits behind Cloudflare Access, and the Worker also requires the token's email to be `ADMIN_EMAIL` (`wrangler.jsonc`, ADR-0016); the page shows the day the Access session ends.
```

- Replace the `- Posters: ...` note with:

```markdown
- Posters: `bun run build:test`, then `bun run serve`, then `bun run poster`. It renders four (day and night, desktop and phone); rerun it whenever the scene changes, and look at them before committing.
```

- Replace the `- Scene long tasks (opt-in): ...` note with:

```markdown
- Scene long tasks (opt-in, on a GPU): `SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium --headed`. It allows one task over 50ms, the environment map's (ADR-0017), and skips itself under software rendering.
```

- Add after the last note (the admin specs' server on port 4333):

```markdown
- Run one end-to-end suite at a time: two at once oversubscribe the CPU, and headless renderers then stall for seconds (plan 5 measured up to 6.6s).
```

- [ ] **Step 5: Check and commit**

Run: `grep -nE "—" docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md docs/superpowers/plans/2026-10-0[45]-plan-*-followups.md README.md docs/adr/0017-environment-map-generated-in-the-browser.md`
Expected: no matches (no em dashes).

Run: `grep -nE ", (and|or) [a-z]" docs/superpowers/plans/2026-10-05-plan-5-followups.md docs/superpowers/plans/2026-10-05-plan-4-followups.md README.md`
Expected: read each match for an Oxford comma (a comma before the last "and" or "or" of a list) and fix it; a comma before "and" that joins two clauses is fine.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

```bash
git add docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md docs/superpowers/plans/2026-10-04-plan-2-followups.md docs/superpowers/plans/2026-10-04-plan-3-followups.md docs/superpowers/plans/2026-10-05-plan-4-followups.md docs/superpowers/plans/2026-10-05-plan-5-followups.md README.md
git commit -m "docs: plan 5 polish in the spec, roadmap, follow-ups and README"
```
