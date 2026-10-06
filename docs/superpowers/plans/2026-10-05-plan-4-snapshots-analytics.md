# Plan 4: snapshots and analytics implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the wall labels their always-fresh snapshots (a nightly snapshots Worker, the hover card, the framed snapshot, the closer look and "re-shoot now" in `/admin`), count visits with a cookieless first-party beacon and proxy and check spec 11's performance budgets.

**Architecture:** A second Worker, `curiousgeorge-snapshots`, captures each line's page with Browser Rendering (`@cloudflare/puppeteer`) on a nightly cron, makes AVIF and WebP variants with the Images binding and stores them in R2 under fresh keys, recording the outcome in D1; the main Worker reaches it over RPC through a service binding for "re-shoot now". The logbook renders the snapshots into the labels with images that load only on hover or open. A ~1KB beacon posts PostHog events in cookieless server hash mode to a first-party `/ingest` proxy, which adds the project key and the visitor's country and passes no cookies either way. Capture, variants, the run, the proxy and the beacon's event body are unit-tested with fakes; the whole snapshot pipeline also runs end to end on a developer's machine, because wrangler runs Browser Rendering and the Images binding locally.

**Tech Stack:** Astro 7.3.5 on Cloudflare Workers, D1, R2, the Images binding, Browser Rendering with `@cloudflare/puppeteer` 1.4.0, Workers RPC (`WorkerEntrypoint`) over a service binding, cron triggers, Vitest 5 with `node:sqlite`, Playwright 1.63, Lighthouse 13.5.0 through `bunx`.

**Spec:** [docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md](../specs/2026-10-03-personal-site-redesign-design.md), mainly section 4.1 (wall labels), 9 (snapshots), 10 (analytics and privacy), 11 (budgets), 12 and 14. Decisions: [ADR-0002](../../adr/0002-fresh-snapshots-for-project-previews.md) and [ADR-0003](../../adr/0003-cookieless-posthog-drop-meta-pixel.md). Follow-ups this plan takes on: [plan 1](2026-10-03-plan-1-followups.md), [plan 2](2026-10-04-plan-2-followups.md) and [plan 3](2026-10-04-plan-3-followups.md), each under "Plan 4". The feasibility probes behind it ran on 2026-10-05: local Browser Rendering, AVIF from the local Images binding, cron and RPC across two local Workers, Lighthouse on Playwright's Chromium, `sendBeacon` under Playwright and native lazy loading inside `hidden="until-found"` all work.

## Global constraints

- The snapshots Worker is `curiousgeorge-snapshots` in `workers/snapshots/`, with bindings `DB` (D1), `MEDIA` (R2), `BROWSER` (Browser Rendering) and `IMAGES`; cron `0 17 * * *` (UTC); `workers_dev: false` and `preview_urls: false`; Workers Logs on; no public route. It is deployed before the main Worker, whose `SNAPSHOTS` service binding needs it.
- A capture (spec 9) is 1440 × 900 CSS px at device scale factor 2: navigate, wait for `load` plus a 1.5s quiet period and take the shot at a 15s cap even if the page never goes idle. Requests to PostHog, Google Analytics, Google Tag Manager and Meta hosts are blocked. A capture fails only on a navigation error, a non-2xx status, a Cloudflare challenge (`cf-mitigated` header or the challenge page markup) or an image under 10KB; a failed capture keeps the previous snapshot and records `snapshot_status` (the values in `src/lib/snapshots.ts`). Failures are logged.
- Variants (spec 9 and 11) are AVIF and WebP at 480, 960 and 1920px wide; the 480px under 30KB and the 960px under 70KB. Keys are `snapshots/<slug>-<ulid>-<width>.<avif|webp>`. Files are deleted 7 days after they're superseded.
- Labels (spec 4.1): the hover card is 232px, fine pointers only, with a 90ms intent delay, growing out of the pill (origin bottom centre, 200ms ease-out, opacity 140ms) and showing the snapshot and `click for the label`. No hover card on touch devices or when the line has no snapshot. The framed snapshot is 240px wide (320px at most on phones) and is omitted when there's no snapshot or it fails to load. Images load on first hover or first open, never up front.
- The closer look (spec 4.1) is a modal dialog: the image grows from its frame to fit the viewport (FLIP, 420ms ease-out-quint) over a paper veil; focus moves into the dialog; a click, the close button or Esc returns it into its frame (300ms ease-out) and focus returns to the frame. Esc closes the closer look first, then the label that has focus.
- Analytics (spec 10): a first-party beacon of about 1KB posts PostHog capture events to `/ingest/i/v0/e/` in cookieless server hash mode (`distinct_id: "$posthog_cookieless"`, `$cookieless_mode: true`, `$process_person_profile: false`) with spec 10's properties. Events are `$pageview`, `label_opened` (item slug), `record_played` (record id) and `scratch_found`, and nothing else. Under Global Privacy Control nothing is sent. Nothing is written to cookies, localStorage or sessionStorage.
- The proxy accepts POST only, caps the body at 32KB and answers 404 for everything else under `/ingest`. It forwards the visitor's IP (`X-Forwarded-For` from `CF-Connecting-IP`), adds `$geoip_country_code` from `request.cf.country`, strips `Cookie` from requests and `Set-Cookie` from responses, and posts to PostHog's US host, `https://us.i.posthog.com`.
- Budgets (spec 11): JavaScript before any interaction under 10KB gzipped; HTML under 30KB; CSS under 15KB; largest contentful paint under 1.5s; layout shift under 0.01; interaction to next paint under 200ms.
- Motion: ease-out by default; hover transitions 200ms `ease`, only under `(hover: hover) and (pointer: fine)`; transforms removed under `prefers-reduced-motion`.
- The only new dependency is `@cloudflare/puppeteer`, pinned to exactly `1.4.0`. Lighthouse runs through `bunx lighthouse@13.5.0` and is not added to `package.json`.
- Copy is lowercase George-voice: Australian spelling, spaced hyphen ` - `, no em dashes, no Oxford comma, sentence case. This applies to every message, label, comment and doc line.
- End-to-end specs that write use only stores recreated on every run: the admin server (4333) and the snapshots server (4334). Specs that would send analytics events skip when `PLAYWRIGHT_BASE_URL` is set.
- Never run `wrangler deploy` (except `--dry-run`), any `--remote` command or `bun run seed:media --remote`. D1 migrations only through `wrangler d1 migrations apply`; `wrangler d1 execute --command` is used only to set test data in local stores.
- Regenerate `worker-configuration.d.ts` in a clean directory without the local `.env`, as the steps show.
- Run scripts and tests under Node 24 (`mise exec node@24 --` outside the home directory): wrangler's first Chrome download for local Browser Rendering has hung under Node 26.
- Every task ends with `bun run typecheck` at 0 errors and the unit tests passing; tasks that touch pages also run the e2e specs they name. Match the existing code style: 2-space indent, double quotes, semicolons, short comments that say why.

## Review focus

1. **A page to snapshot that is slow, broken, blocks bots or renders blank** (a 503, a DNS failure, a Cloudflare challenge served with a 200, a page whose network never goes quiet, a white page): the old snapshot stays and the admin says why; a page that loads but never settles is still shot at the cap. Task 3 pins every case with the fake page; Task 5 runs a real 404 end to end.
2. **A line edited or removed while its capture runs** (George changes the page to snapshot, or removes the line, during the nightly run or a re-shoot): the line keeps what George saved and the capture's files are deleted. Task 4 pins both against SQLite.
3. **Visitors who asked not to be counted, use a phone or have no JavaScript** (Global Privacy Control, a touch screen, scripts off): nothing is sent under GPC; there's no hover card on touch; without JavaScript the label still opens by find-in-page and shows its frame, whose file comes with the page (browsers ignore lazy loading while scripting is off). Task 2 pins GPC; Task 7 pins the touch and lazy-loading behaviour in every project.
4. **Requests to `/ingest` that aren't the beacon** (another site's POST, a GET, an event the logbook never sends, a 40KB body, garbage): refused before anything reaches PostHog, and never a cookie either way. Task 1 pins each in unit and end-to-end tests.
5. **Keyboard and focus around the closer look** (Esc twice, the close button, a click on the veil, reduced motion): Esc closes the closer look first and returns focus to the frame, then closes the label and returns focus to the pill; nothing moves under reduced motion. Task 8 pins these end to end.

## Decisions made while planning

Recorded so reviewers know they are deliberate:

- **The proxy adds the PostHog key, not the page.** Spec 10 named a `PUBLIC_POSTHOG_KEY`; the key is a Worker secret (`POSTHOG_KEY`) instead, so the HTML carries no key, the beacon is smaller and a changed key needs no rebuild. Without a key (local and test runs) the proxy drops what it accepts, so tests never reach PostHog.
- **Only the four events are forwarded, and the proxy sets the cookieless fields itself.** The proxy is no open relay to PostHog, and a page can't turn cookieless mode off or create a person profile.
- **Events reach the beacon as a DOM event (`logbook:track`).** The label script, the deck runner and the scene chunk share no runtime code with the beacon: shared code would become a hashed chunk that an edge-cached page depends on (ADR-0010). `src/lib/track.ts` holds types only.
- **The beacon sends a string body.** `sendBeacon` with a string sends `text/plain`, which needs no preflight, and Playwright can read it (a Blob body reads as null in both engines, per the probe).
- **Live-site checks send no events.** The post-deploy privacy and media checks run under Global Privacy Control, the privacy check tests the proxy with an event it refuses, and Lighthouse's post-deploy runs block `/ingest` (Lighthouse 13's mobile user agent doesn't name Lighthouse, so PostHog couldn't filter them).
- **`@cloudflare/puppeteer` rather than `@cloudflare/playwright`:** 134KiB gzipped against 624KiB, and the probe ran every spec 9 case with it.
- **Navigation waits for the document, then for load and quiet within the same 15s cap.** A page whose `load` never fires is still shot (spec 14's "timeout-but-shot"); only a document that never arrives is a navigation error.
- **Each capture gets a fresh key, and the line moves to it only if its address is unchanged.** A cached page keeps working with the old files, which stay a week; a line edited or removed mid-capture is never overwritten.
- **The snapshot pipeline is tested end to end locally.** A fourth local server runs both Workers with local Browser Rendering and Images and captures a fixture site, with every real line's page cleared so nothing real is visited. CI caches the Chrome that wrangler downloads.
- **"Re-shoot now" waits for the capture.** It takes a few seconds; a good capture is a save; a failed one isn't, and says why on its line.
- **INP is measured in Playwright with the Event Timing API at 4× CPU.** Lighthouse's navigation mode doesn't report INP. Lighthouse measures LCP against the live site after each deploy, as a warning rather than a gate, because GitHub's runners make simulated timings vary.
- **Fonts are cached for a month, not a year:** their names aren't hashed.
- **The environment map's hitch stays** (plan 2's question 1 is still George's).
- **Without JavaScript, the framed snapshots come with the page.** Browsers ignore lazy loading while scripting is off, so the rare visitor without JavaScript gets two to four small AVIFs up front; the hover cards and the closer look never load without the script.
- **Click identifiers are dropped from the URL the beacon sends** (`fbclid`, `gclid` and the like), so no visit can be tied to an ad click; the UTM fields stay.
- **A capture also blocks `/ingest/` on any host,** so a snapshot of one of George's sites with its own first-party PostHog proxy isn't counted as a visit there.

## File structure

```
package.json, bun.lock                        modify: @cloudflare/puppeteer 1.4.0; scripts dev:snapshots, seed:snapshots, lighthouse; check
wrangler.jsonc                                modify: var POSTHOG_HOST, service binding SNAPSHOTS
worker-configuration.d.ts                     regenerate
tsconfig.json                                 modify: include workers
playwright.config.ts                          modify: the fixture site (4400) and both Workers (4334)
.github/workflows/ci.yml                      modify: snapshot fixtures, Chrome cache, snapshots Worker deployed first, Lighthouse after deploy
public/_headers                               create: nosniff on static files, a month for fonts
src/env.d.ts                                  modify: the POSTHOG_KEY secret
src/lib/ingest.ts                             create: the proxy's forwarding
src/pages/ingest/[...path].ts                 create: the proxy's route
src/lib/track.ts                              create: event types (types only)
src/lib/beacon.ts                             create: the event body and UUIDv7
src/scripts/beacon.ts                         create: the beacon
src/lib/snapshots.ts                          modify: the key scheme
src/components/Logbook.astro                  modify: the beacon and the closer look
src/components/ItemLines.astro                modify: the hover card and the framed snapshot
src/components/CloserLook.astro               create: the closer look's dialog
src/components/Turntable.astro                modify: data-id on track buttons
src/scripts/labels.ts                         modify: snapshot loading, label_opened, plan 1 follow-ups
src/scripts/log-toggle.ts                     modify: the pending close
src/scripts/closer.ts                         create: the closer look
src/scripts/deck.ts                           modify: record_played
src/deck/runner.ts                            modify: the played option
src/deck/scene/pointer.ts                     modify: scratch_found
src/deck/scene/loop.ts                        modify: shadow map redraws
src/styles/notebook.css                       modify: hover card, frame, closer look
src/lib/admin/actions.ts                      modify: snapshot.reshoot
src/pages/admin/index.astro                   modify: the snapshots row and its binding
src/components/admin/SnapshotsAdmin.astro     modify: re-shoot buttons
src/styles/admin.css                          modify: re-shoot layout
workers/snapshots/wrangler.jsonc              create
workers/snapshots/src/env.ts, index.ts, capture.ts, variants.ts, run.ts   create
scripts/seed-snapshots.mjs                    create: local snapshot fixtures
scripts/lighthouse.mjs                        create: Lighthouse, median of five
tests/fixtures/snapshot-site.mjs              create: the site the snapshot specs capture
tests/unit/ingest, beacon, fake-browser, snapshot-capture, snapshot-variants, snapshot-run, loop   create
tests/unit/runner, turntable, snapshots, labels, logbook-page, actions                            modify
tests/e2e/ingest, analytics, snapshots-live, perf                                                   create
tests/e2e/privacy, deck-scratch, labels, log, admin-page                                            modify
docs: spec 9, 10, 11, 13 and 14; roadmap; plan 1, 2 and 3 follow-ups; plan 4 follow-ups; README     modify or create
```

---

### Task 1: the analytics proxy

`/ingest/i/v0/e/` takes the beacon's events and forwards them to PostHog: only the four events the logbook sends, the PostHog key added here, the visitor's IP and country passed on, no cookies in either direction. Everything else under `/ingest` is a 404.

**Files:**
- Create: `src/lib/ingest.ts`, `src/pages/ingest/[...path].ts`
- Modify: `wrangler.jsonc` (var `POSTHOG_HOST`), `worker-configuration.d.ts` (regenerated), `src/env.d.ts` (the `POSTHOG_KEY` secret)
- Test: `tests/unit/ingest.test.ts`, `tests/e2e/ingest.spec.ts`

**Interfaces:**
- Consumes: the middleware's Origin rule (plan 3): a POST without this site's `Origin` is refused before the route runs.
- Produces:
  - `ingest.ts`: `INGEST_EVENTS` (`["$pageview", "label_opened", "record_played", "scratch_found"]`), `INGEST_LIMIT = 32 * 1024`, `interface IngestConfig { key: string | undefined; host: string; country: string | null }`, `ingestAnswer(status: number): Response`, `forwardEvent(request: Request, config: IngestConfig, upstream?: typeof fetch): Promise<Response>`
  - The endpoint answers 204 to an accepted event (forwarded or, without a key, dropped), 400 to anything that isn't one of the four events, 413 over 32KB and 404 for every other path or method under `/ingest`. All with `Cache-Control: no-store` and no `Set-Cookie`.
  - `env.POSTHOG_HOST: string` (a var) and `env.POSTHOG_KEY?: string` (a secret George sets once with `wrangler secret put POSTHOG_KEY`)

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/ingest.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { forwardEvent, INGEST_LIMIT } from "../../src/lib/ingest";

const config = { key: "phc_test", host: "https://us.i.posthog.com", country: "AU" };
const pageview = {
  event: "$pageview",
  distinct_id: "$posthog_cookieless",
  timestamp: "2026-10-05T01:02:03.000Z",
  properties: { $current_url: "https://curiousgeorge.dev/", $session_id: "s1", $cookieless_mode: true, $process_person_profile: false },
};
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://curiousgeorge.dev/ingest/i/v0/e/", { method: "POST", body, headers: { "Content-Type": "text/plain", ...headers } });
const ok = () => vi.fn(async () => new Response("{}", { status: 200, headers: { "Set-Cookie": "ph_session=1" } }));
const sent = (upstream: ReturnType<typeof ok>) => upstream.mock.calls[0] as unknown as [string, RequestInit];

afterEach(() => vi.restoreAllMocks());

test("forwards a pageview with the key, the country and the visitor's IP, and never a cookie either way", async () => {
  const upstream = ok();
  const response = await forwardEvent(
    post(JSON.stringify(pageview), { Cookie: "CF_Authorization=secret", "CF-Connecting-IP": "203.0.113.7", "User-Agent": "UA/1" }),
    config,
    upstream,
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(upstream).toHaveBeenCalledOnce();
  const [url, init] = sent(upstream);
  expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
  const headers = new Headers(init.headers);
  expect(headers.get("cookie")).toBeNull();
  expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  expect(headers.get("user-agent")).toBe("UA/1");
  expect(JSON.parse(init.body as string)).toEqual({
    api_key: "phc_test",
    event: "$pageview",
    distinct_id: "$posthog_cookieless",
    timestamp: "2026-10-05T01:02:03.000Z",
    properties: { ...pageview.properties, $geoip_country_code: "AU" },
  });
});

test("the cookieless fields are set here, whatever the page sent, and a sent IP is dropped", async () => {
  const upstream = ok();
  const event = { event: "label_opened", distinct_id: "someone", properties: { slug: "canberra-events", $cookieless_mode: false, $process_person_profile: true, $ip: "1.2.3.4" } };
  await forwardEvent(post(JSON.stringify(event)), config, upstream);
  const body = JSON.parse(sent(upstream)[1].body as string);
  expect(body.distinct_id).toBe("$posthog_cookieless");
  expect(body.properties).toEqual({ slug: "canberra-events", $cookieless_mode: true, $process_person_profile: false, $geoip_country_code: "AU" });
});

test.each([
  ["an event the logbook doesn't send", JSON.stringify({ event: "$identify", properties: {} })],
  ["no event", JSON.stringify({ properties: {} })],
  ["properties that aren't an object", JSON.stringify({ event: "$pageview", properties: [1] })],
  ["something that isn't JSON", "event=$pageview"],
])("refuses %s without forwarding it", async (_name, body) => {
  const upstream = ok();
  expect((await forwardEvent(post(body), config, upstream)).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});

test("refuses a body over 32KB, counted as it arrives", async () => {
  const upstream = ok();
  const big = JSON.stringify({ event: "$pageview", properties: { pad: "x".repeat(INGEST_LIMIT) } });
  expect((await forwardEvent(post(big), config, upstream)).status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
});

test("drops events quietly when no key is set (local and test runs)", async () => {
  const upstream = ok();
  expect((await forwardEvent(post(JSON.stringify(pageview)), { ...config, key: undefined }, upstream)).status).toBe(204);
  expect(upstream).not.toHaveBeenCalled();
});

test("a PostHog failure is logged and the beacon still gets a 204", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const offline = vi.fn(async () => {
    throw new Error("offline");
  });
  expect((await forwardEvent(post(JSON.stringify(pageview)), config, offline)).status).toBe(204);
  expect((await forwardEvent(post(JSON.stringify(pageview)), config, vi.fn(async () => new Response("no", { status: 500 })))).status).toBe(204);
  expect(error).toHaveBeenCalledTimes(2);
});

test("without a country, no country property is sent", async () => {
  const upstream = ok();
  await forwardEvent(post(JSON.stringify(pageview)), { ...config, country: null }, upstream);
  expect(JSON.parse(sent(upstream)[1].body as string).properties).not.toHaveProperty("$geoip_country_code");
});
```

Run: `bun run test:unit tests/unit/ingest.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/ingest`.

- [ ] **Step 2: Implement the forwarding**

Create `src/lib/ingest.ts`:

```ts
/** The only events the beacon sends (spec 10); anything else is refused, so the proxy is no open relay to PostHog */
export const INGEST_EVENTS = ["$pageview", "label_opened", "record_played", "scratch_found"] as const;
/** The beacon's events are a few hundred bytes; a body this size isn't from the beacon */
export const INGEST_LIMIT = 32 * 1024;

export interface IngestConfig {
  /** The PostHog project key, a Worker secret. Unset locally and in tests, where events are dropped */
  key: string | undefined;
  /** PostHog's ingestion host, e.g. https://us.i.posthog.com */
  host: string;
  /** The visitor's country from Cloudflare (request.cf.country): cookieless mode skips PostHog's own GeoIP */
  country: string | null;
}

type Event = { event: (typeof INGEST_EVENTS)[number]; timestamp?: string; properties: Record<string, unknown> };

/** Every answer from /ingest: no body, never cached, never a cookie */
export const ingestAnswer = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

// Reads at most `limit` bytes; null if the body is bigger, however it arrives
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseEvent(text: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { event, timestamp, properties } = value as Record<string, unknown>;
  if (typeof event !== "string" || !(INGEST_EVENTS as readonly string[]).includes(event)) return null;
  if (properties !== undefined && (typeof properties !== "object" || properties === null || Array.isArray(properties))) return null;
  return {
    event: event as Event["event"],
    timestamp: typeof timestamp === "string" ? timestamp : undefined,
    properties: { ...(properties as Record<string, unknown> | undefined) },
  };
}

/**
 * Forwards one beacon event to PostHog's capture endpoint in cookieless server hash mode (spec 10). The key and the
 * country are added here; the visitor's IP and user agent go along for PostHog's daily hash, which it then discards;
 * no cookie goes either way (George's Access cookie never reaches PostHog, and PostHog's never reaches the visitor).
 */
export async function forwardEvent(request: Request, config: IngestConfig, upstream: typeof fetch = fetch): Promise<Response> {
  const text = await readCapped(request, INGEST_LIMIT);
  if (text === null) return ingestAnswer(413);
  const parsed = parseEvent(text);
  if (!parsed) return ingestAnswer(400);
  if (!config.key) return ingestAnswer(204);
  const properties = { ...parsed.properties };
  delete properties.$ip; // PostHog takes the IP from the header below, and only for the hash
  const body = {
    api_key: config.key,
    event: parsed.event,
    distinct_id: "$posthog_cookieless",
    timestamp: parsed.timestamp,
    properties: {
      ...properties,
      $cookieless_mode: true,
      $process_person_profile: false,
      ...(config.country ? { $geoip_country_code: config.country } : {}),
    },
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers["X-Forwarded-For"] = ip;
  const agent = request.headers.get("user-agent");
  if (agent) headers["User-Agent"] = agent;
  try {
    const response = await upstream(`${config.host}/i/v0/e/`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) console.error("ingest: PostHog answered", response.status);
  } catch (error) {
    console.error("ingest: couldn't reach PostHog", error instanceof Error ? error.message : String(error));
  }
  return ingestAnswer(204);
}
```

Run: `bun run test:unit tests/unit/ingest.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 3: The route and its configuration**

Create `src/pages/ingest/[...path].ts`:

```ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { forwardEvent, ingestAnswer } from "../../lib/ingest";

// The analytics proxy (spec 6.2 and 10): only POST /ingest/i/v0/e/; everything else under /ingest is a 404
export const ALL: APIRoute = ({ request, params }) => {
  if (request.method !== "POST" || params.path?.replace(/\/$/, "") !== "i/v0/e") return ingestAnswer(404);
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
  // A test build never forwards, whatever a local .env holds
  return forwardEvent(request, { key: __TEST_HOOKS__ ? undefined : env.POSTHOG_KEY, host: env.POSTHOG_HOST, country });
};
```

In `wrangler.jsonc`, extend the `vars` line to:

```jsonc
  "vars": { "ACCESS_TEAM_DOMAIN": "", "ACCESS_AUD": "", "POSTHOG_HOST": "https://us.i.posthog.com" },
```

and replace the comment above it with `// Cloudflare Access for /admin (spec 7), empty until George creates the Access application; and PostHog's US ingestion host for the /ingest proxy, whose project key is a secret (wrangler secret put POSTHOG_KEY).`

Regenerate the binding types in a clean directory, as plan 3 did, so a local `.env` can't leak into them:

```bash
TMP=$(mktemp -d) && cp wrangler.jsonc "$TMP"/ && ln -s "$PWD/node_modules" "$TMP/node_modules" && (cd "$TMP" && ./node_modules/.bin/wrangler types --strict-vars=false) && cp "$TMP/worker-configuration.d.ts" worker-configuration.d.ts && rm -rf "$TMP"
git diff worker-configuration.d.ts | head -40
```

Expected: a new hash in the header, `POSTHOG_HOST: string;` in `__BaseEnv_Env` and `"POSTHOG_HOST"` added to the `ProcessEnv` pick list. Nothing from `.env`.

Secrets aren't in `wrangler.jsonc`, so declare the key in `src/env.d.ts`, after the `App` namespace:

```ts
declare namespace Cloudflare {
  interface Env {
    /** The PostHog project key, a Worker secret (wrangler secret put POSTHOG_KEY). Unset locally, so /ingest drops events */
    POSTHOG_KEY?: string;
  }
}
```

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: The end-to-end checks**

Create `tests/e2e/ingest.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// HTTP behaviour, checked once. The local test build has no PostHog key, so accepted events are dropped, not sent.
test.skip(({ browserName }) => browserName !== "chromium", "HTTP behaviour, checked once");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "would send events to PostHog from the live site");

const event = (name: string) => JSON.stringify({ event: name, properties: {} });

test("the proxy takes the beacon's events with a 204 and sets nothing", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", { data: event("$pageview"), headers: { Origin: new URL(baseURL!).origin, "Content-Type": "text/plain" } });
  expect(response.status()).toBe(204);
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("events the logbook doesn't send are refused", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", { data: event("$identify"), headers: { Origin: new URL(baseURL!).origin } });
  expect(response.status()).toBe(400);
});

test("anything else under /ingest is a 404", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  expect((await request.get("/ingest/i/v0/e/")).status()).toBe(404);
  expect((await request.get("/ingest/")).status()).toBe(404);
  expect((await request.post("/ingest/decide/", { data: "{}", headers: { Origin: origin } })).status()).toBe(404);
});

test("a beacon from another site is refused before it reaches the proxy", async () => {
  // Node's fetch sends no Origin unless asked, unlike a browser
  const response = await fetch(new URL("/ingest/i/v0/e/", "http://localhost:4331"), { method: "POST", body: event("$pageview") });
  expect(response.status).toBe(403);
});
```

Run: `bun run build:test`, then `pkill -f "port 433[123]"`, then `bun run test:e2e tests/e2e/ingest.spec.ts --project=chromium`
Expected: 4 passed.

- [ ] **Step 5: Run everything and commit**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

```bash
git add src/lib/ingest.ts src/pages/ingest wrangler.jsonc worker-configuration.d.ts src/env.d.ts tests/unit/ingest.test.ts tests/e2e/ingest.spec.ts
git commit -m "feat: a first-party analytics proxy that forwards only the logbook's events, cookieless"
```

---

### Task 2: the beacon and its events

A first-party beacon of about 1KB on the logbook: a cookieless `$pageview` on load, then `label_opened`, `record_played` and `scratch_found` as they happen, nothing at all under Global Privacy Control. The label script, the deck runner and the scene announce events as a DOM event the beacon listens for, so they share no code with it.

**Files:**
- Create: `src/lib/track.ts` (types only), `src/lib/beacon.ts`, `src/scripts/beacon.ts`
- Modify: `src/components/Logbook.astro`, `src/scripts/labels.ts`, `src/deck/runner.ts`, `src/scripts/deck.ts`, `src/components/Turntable.astro`, `src/deck/scene/pointer.ts`, `tests/e2e/privacy.spec.ts`, `tests/e2e/media-live.spec.ts`, `tests/e2e/deck-scratch.spec.ts`
- Test: `tests/unit/beacon.test.ts`, `tests/unit/runner.test.ts`, `tests/unit/turntable.test.ts`, `tests/e2e/analytics.spec.ts`

**Interfaces:**
- Consumes: `/ingest/i/v0/e/` (Task 1).
- Produces:
  - `track.ts`: `type TrackEvent = "$pageview" | "label_opened" | "record_played" | "scratch_found"`, `type TrackProperties = Record<string, string | number>`, `interface TrackDetail { event: Exclude<TrackEvent, "$pageview">; properties?: TrackProperties }`, and the `"logbook:track"` entry in `DocumentEventMap`
  - `beacon.ts` (lib): `interface Visit { href: string; referrer: string; userAgent: string; timeZone: string; sessionId: string }`, `uuidv7(now?: number, random?: (count: number) => Uint8Array): string`, `eventBody(event: TrackEvent, visit: Visit, properties?: TrackProperties, now?: Date): object`
  - `DeckOptions.played?: (index: number) => void`, called when a record's audio starts
  - The event properties: `label_opened` has `slug`, `record_played` has `record_id` (the record's D1 id), `scratch_found` has none

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/beacon.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { eventBody, uuidv7 } from "../../src/lib/beacon";

describe("uuidv7", () => {
  test("puts the time first, then the version and variant bits", () => {
    expect(uuidv7(1_700_000_000_000, (count) => new Uint8Array(count))).toBe("018bcfe5-6800-7000-8000-000000000000");
    expect(uuidv7(1_700_000_000_000, (count) => new Uint8Array(count).fill(255))).toBe("018bcfe5-6800-7fff-bfff-ffffffffffff");
  });

  test("is a valid, unique v7 by default", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7()).not.toBe(id);
  });
});

describe("eventBody", () => {
  const visit = {
    href: "https://curiousgeorge.dev/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link&fbclid=x",
    referrer: "https://l.instagram.com/?u=x",
    userAgent: "UA/1",
    timeZone: "Australia/Sydney",
    sessionId: "019a0000-0000-7000-8000-000000000000",
  };
  const now = new Date("2026-10-05T01:02:03.000Z");

  test("a pageview carries the cookieless fields and the visit, and no key", () => {
    expect(eventBody("$pageview", visit, {}, now)).toEqual({
      event: "$pageview",
      distinct_id: "$posthog_cookieless",
      timestamp: "2026-10-05T01:02:03.000Z",
      properties: {
        $current_url: "https://curiousgeorge.dev/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link",
        $host: "curiousgeorge.dev",
        $pathname: "/",
        $referrer: "https://l.instagram.com/?u=x",
        $referring_domain: "l.instagram.com",
        $raw_user_agent: "UA/1",
        $timezone: "Australia/Sydney",
        $session_id: visit.sessionId,
        $cookieless_mode: true,
        $process_person_profile: false,
        utm_source: "instagram",
        utm_medium: "social",
        utm_campaign: "bio_link",
      },
    });
  });

  test("no referrer, or one that isn't a URL, is a direct visit", () => {
    for (const referrer of ["", "not a url"]) {
      const { properties } = eventBody("$pageview", { ...visit, referrer, href: "https://curiousgeorge.dev/" }, {}, now) as { properties: Record<string, unknown> };
      expect(properties).toMatchObject({ $referrer: "$direct", $referring_domain: "$direct" });
      expect(properties).not.toHaveProperty("utm_source");
    }
  });

  test("an event's own properties come along", () => {
    expect(eventBody("label_opened", visit, { slug: "canberra-events" }, now)).toMatchObject({ event: "label_opened", properties: { slug: "canberra-events", $session_id: visit.sessionId } });
  });
});
```

In `tests/unit/runner.test.ts`, inside `describe("deck runner without a scene", …)`, add:

```ts
  test("tells the page when a record's audio starts, but not when it can't play", async () => {
    const audio = fakeAudio();
    const played: number[] = [];
    const deck = createDeck({ tracks, audio, announce: () => {}, now: () => clock, played: (index) => played.push(index) });
    deck.toggle(1);
    await settle();
    expect(played).toEqual([1]);
    clock += DOUBLE_PRESS_MS + 1;
    deck.toggle(1); // stop
    await settle();
    expect(played).toEqual([1]);
    clock += DOUBLE_PRESS_MS + 1;
    audio.result = false;
    deck.toggle(2);
    await settle();
    expect(played).toEqual([1]);
  });
```

In `tests/unit/turntable.test.ts`, in "lists every record with its side, artist and a play state", after the `data-index` assertion, add:

```ts
    expect(button.getAttribute("data-id")).toBe("1");
```

Run: `bun run test:unit tests/unit/beacon.test.ts tests/unit/runner.test.ts tests/unit/turntable.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/beacon`, `played` not called and `data-id` null.

- [ ] **Step 2: The event types and the beacon**

Create `src/lib/track.ts`:

```ts
// The analytics events (spec 10). Scripts announce them as a DOM event, "logbook:track", which the beacon
// (src/scripts/beacon.ts) sends on. Only types live here: a shared runtime module would become a hashed chunk that a
// cached page depends on, and the label script, the deck runner and the scene must stay independent of the beacon.

export type TrackEvent = "$pageview" | "label_opened" | "record_played" | "scratch_found";
export type TrackProperties = Record<string, string | number>;

export interface TrackDetail {
  event: Exclude<TrackEvent, "$pageview">;
  properties?: TrackProperties;
}

declare global {
  interface DocumentEventMap {
    "logbook:track": CustomEvent<TrackDetail>;
  }
}
```

Create `src/lib/beacon.ts`:

```ts
import type { TrackEvent, TrackProperties } from "./track";

/** What the beacon knows about this visit, captured once per page */
export interface Visit {
  href: string;
  referrer: string;
  userAgent: string;
  timeZone: string;
  /** A UUIDv7 held in memory for the tab, never stored */
  sessionId: string;
}

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
// Per-click identifiers from ad platforms: dropped from the URL sent, so no visit can be tied to an ad click
const CLICK_IDS = ["fbclid", "gclid", "gbraid", "wbraid", "msclkid", "dclid", "ttclid"];

/** A time-ordered UUID (RFC 9562 version 7), for PostHog's $session_id */
export function uuidv7(now = Date.now(), random: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count))): string {
  const bytes = random(16);
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function referringDomain(referrer: string): string {
  try {
    return referrer ? new URL(referrer).host : "$direct";
  } catch {
    return "$direct";
  }
}

/**
 * One PostHog capture event in cookieless server hash mode (spec 10). The proxy adds the project key and the
 * country; PostHog derives a daily visitor from a hash of the IP, the user agent and a salt it rotates daily.
 */
export function eventBody(event: TrackEvent, visit: Visit, properties: TrackProperties = {}, now = new Date()) {
  const url = new URL(visit.href);
  for (const name of CLICK_IDS) url.searchParams.delete(name);
  const domain = referringDomain(visit.referrer);
  const utm = Object.fromEntries(UTM.flatMap((name) => (url.searchParams.has(name) ? [[name, url.searchParams.get(name) ?? ""]] : [])));
  return {
    event,
    distinct_id: "$posthog_cookieless",
    timestamp: now.toISOString(),
    properties: {
      $current_url: url.href,
      $host: url.host,
      $pathname: url.pathname,
      $referrer: domain === "$direct" ? "$direct" : visit.referrer,
      $referring_domain: domain,
      $raw_user_agent: visit.userAgent,
      $timezone: visit.timeZone,
      $session_id: visit.sessionId,
      $cookieless_mode: true,
      $process_person_profile: false,
      ...utm,
      ...properties,
    },
  };
}
```

Create `src/scripts/beacon.ts`:

```ts
import { eventBody, uuidv7, type Visit } from "../lib/beacon";
import type { TrackEvent, TrackProperties } from "../lib/track";

// The first-party analytics beacon (spec 10): no cookies, no storage, nothing at all under Global Privacy Control.
const ENDPOINT = "/ingest/i/v0/e/";
const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

if (!gpc) {
  const visit: Visit = {
    href: location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sessionId: uuidv7(),
  };
  const send = (event: TrackEvent, properties?: TrackProperties) => {
    const body = JSON.stringify(eventBody(event, visit, properties));
    // A string body goes as text/plain, which needs no preflight (and tests can read it); sendBeacon outlives the page,
    // and fetch with keepalive covers a refused beacon
    if (!navigator.sendBeacon?.(ENDPOINT, body)) {
      void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
    }
  };
  send("$pageview");
  document.addEventListener("logbook:track", (event) => send(event.detail.event, event.detail.properties));
}
```

In `src/components/Logbook.astro`, add after `</main>`:

```astro
<script>
  import "../scripts/beacon";
</script>
```

Run: `bun run test:unit tests/unit/beacon.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: The events**

In `src/scripts/labels.ts`, add `import type { TrackDetail } from "../lib/track";` at the top, and in the line's click handler, after `setOpen(item, !isOpen(item));`, announce an open (clicks only; a label revealed by find-in-page isn't counted):

```ts
    if (isOpen(item) && item.dataset.slug) {
      document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "label_opened", properties: { slug: item.dataset.slug } } }));
    }
```

In `src/deck/runner.ts`, add to `DeckOptions`:

```ts
  /** Called when a record's audio starts (the page counts it as record_played) */
  played?: (index: number) => void;
```

destructure it in `createDeck`'s parameters (`{ tracks, audio, announce, played, now = … }`) and, in `load`, right after `announce(`now playing ${tracks[index].title}`);`, add `played?.(index);`.

In `src/components/Turntable.astro`, add `data-id={record.id}` to each track button, after `data-index`.

In `src/scripts/deck.ts`, add `import type { TrackDetail } from "../lib/track";`, read the ids beside the tracks:

```ts
  const ids = [...list.querySelectorAll<HTMLButtonElement>("button[data-index]")].map((button) => Number(button.dataset.id));
```

and pass to `createDeck`:

```ts
    played: (index) =>
      document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "record_played", properties: { record_id: ids[index] } } })),
```

In `src/deck/scene/pointer.ts`, add `import type { TrackDetail } from "../../lib/track";`, a flag beside the other state in `bindPointer` (`let found = false;`) and, in `scratch`, inside `if (!drag.live) { … }` after `drag.live = true;`:

```ts
      if (!found) {
        found = true; // counted once per visit
        document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "scratch_found" } }));
      }
```

Run: `bun run test:unit`
Expected: every unit test passes, including the new runner and turntable assertions.

- [ ] **Step 4: The end-to-end checks**

Create `tests/e2e/analytics.spec.ts`:

```ts
import { expect, test, type Page, type Request } from "@playwright/test";
import { SLOW } from "./deck";

// The local test build has no PostHog key: /ingest drops what it accepts, so these specs only watch what the page sends
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "would send events to PostHog from the live site");

const beacon = (page: Page, event: string, timeout = 10_000) =>
  page.waitForRequest((request) => request.url().endsWith("/ingest/i/v0/e/") && request.method() === "POST" && body(request).event === event, { timeout });
const body = (request: Request) => JSON.parse(request.postData() ?? "{}");

test("a visit sends a cookieless pageview, first party, with no key and no storage", async ({ page, baseURL }) => {
  const [request] = await Promise.all([beacon(page, "$pageview"), page.goto("/?utm_source=instagram&utm_medium=social")]);
  const sent = body(request);
  expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
  expect(sent).toMatchObject({
    distinct_id: "$posthog_cookieless",
    properties: { $pathname: "/", $referrer: "$direct", $cookieless_mode: true, $process_person_profile: false, utm_source: "instagram", utm_medium: "social" },
  });
  expect(sent).not.toHaveProperty("api_key");
  expect(sent.properties.$session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await page.evaluate(() => document.cookie + localStorage.length + sessionStorage.length)).toBe("00");
});

test("opening a label is counted with its slug and the visit's session", async ({ page }) => {
  const pageview = beacon(page, "$pageview");
  await page.goto("/");
  const session = body(await pageview).properties.$session_id;
  const [opened] = await Promise.all([beacon(page, "label_opened"), page.locator('[data-slug="canberra-events"] .peek').click()]);
  expect(body(opened).properties).toMatchObject({ slug: "canberra-events", $session_id: session });
});

test("playing a record is counted with its id", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "playback is covered by the deck specs; counted once here");
  test.setTimeout(90_000 * SLOW);
  await page.goto("/");
  const [played] = await Promise.all([beacon(page, "record_played", 60_000 * SLOW), page.locator(".tracks button").first().click()]);
  expect(body(played).properties).toMatchObject({ record_id: 1 });
});

test("Global Privacy Control means nothing is sent", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ingest/")) sent.push(request.url());
  });
  await page.goto("/");
  await page.locator('[data-slug="canberra-events"] .peek').click();
  await page.waitForLoadState("networkidle");
  expect(sent).toEqual([]);
});
```

In `tests/e2e/deck-scratch.spec.ts`, in "dragging the spinning record scratches it…", extend the `page.evaluate` that records playback rates so it also records announced events:

```ts
    const events: string[] = [];
    (window as unknown as { events: string[] }).events = events;
    document.addEventListener("logbook:track", (event) => events.push(event.detail.event));
```

and after the drag, assert the scratch was counted once:

```ts
  expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual(["scratch_found"]);
```

In `tests/e2e/privacy.spec.ts`:
- at the start of the first test, when it runs against the live site, switch the beacon off so the check sends nothing to PostHog (the proxy is checked separately below):

```ts
  if (process.env.PLAYWRIGHT_BASE_URL) {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  }
```

- in `tests/e2e/media-live.spec.ts`, as the first lines of its test (it also runs against the live site after each deploy):

```ts
  // Against the live site the beacon would count this check as a visit; Global Privacy Control switches it off
  if (process.env.PLAYWRIGHT_BASE_URL) {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  }
```

- add a test that proves the live proxy is deployed and cookieless without recording anything:

```ts
// An event the logbook never sends is refused by the proxy before anything reaches PostHog, and nothing is set
test("the analytics proxy answers without a cookie", async ({ request, baseURL }) => {
  const response = await request.post("/ingest/i/v0/e/", {
    data: JSON.stringify({ event: "privacy_check", properties: {} }),
    headers: { Origin: new URL(baseURL!).origin },
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});
```

Run: `bun run build:test`, then `pkill -f "port 433[123]"`, then `bun run test:e2e tests/e2e/analytics.spec.ts tests/e2e/privacy.spec.ts tests/e2e/deck-scratch.spec.ts`
Expected: everything passes (the record and scratch checks in chromium, and skipped where the specs skip them).

- [ ] **Step 5: Budgets, the whole suite and commit**

Run: `bun run test:e2e tests/e2e/budgets.spec.ts --project=chromium`
Expected: PASS, with "JavaScript before any interaction" still under 10KB (the beacon adds about 1KB). If the beacon became an external `/_astro/*.js` file instead of an inline script, a runtime import has crept in: keep `src/lib/track.ts` types-only and import nothing at runtime except `src/lib/beacon.ts`.

Run: `bun run typecheck && bun run test:unit && bun run test:e2e`
Expected: 0 errors; everything passes (rerun a known flake alone if one fails, as the README says).

```bash
git add src/lib/track.ts src/lib/beacon.ts src/scripts/beacon.ts src/components/Logbook.astro src/scripts/labels.ts src/deck/runner.ts src/scripts/deck.ts src/components/Turntable.astro src/deck/scene/pointer.ts tests/unit/beacon.test.ts tests/unit/runner.test.ts tests/unit/turntable.test.ts tests/e2e/analytics.spec.ts tests/e2e/privacy.spec.ts tests/e2e/media-live.spec.ts tests/e2e/deck-scratch.spec.ts
git commit -m "feat: a cookieless first-party beacon for pageviews, labels, plays and the scratch"
```

---

### Task 3: capturing a page and making its variants

The heart of the snapshots Worker as plain functions: capture one page with a Browser Rendering page (spec 9's rules for waiting, blocking and failing) and turn the screenshot into its six AVIF and WebP files with the Images binding. Plus the key scheme the Worker and the logbook share. Everything here is unit-tested with a fake browser page and a fake Images binding.

**Files:**
- Create: `workers/snapshots/src/capture.ts`, `workers/snapshots/src/variants.ts`, `tests/unit/fake-browser.ts`
- Modify: `src/lib/snapshots.ts` (keys), `tsconfig.json` (include `workers`)
- Test: `tests/unit/snapshot-capture.test.ts`, `tests/unit/snapshot-variants.test.ts`, `tests/unit/snapshots.test.ts`

**Interfaces:**
- Consumes: `SnapshotStatus` and `SNAPSHOT_STATUSES` (`src/lib/snapshots.ts`, plan 3).
- Produces:
  - `src/lib/snapshots.ts`: `SNAPSHOT_WIDTHS = [480, 960, 1920] as const`, `type SnapshotWidth`, `type SnapshotFormat = "avif" | "webp"`, `snapshotBase(slug: string, id: string): string` (`snapshots/<slug>-<id>`), `snapshotVariant(base: string, width: SnapshotWidth, format: SnapshotFormat): string` (`<base>-<width>.<format>`), `variantBase(key: string): string | null`
  - `capture.ts`: `interface CapturePage`, `interface CaptureRequest`, `interface CaptureResponse`, `interface CaptureBrowser { newPage(): Promise<CapturePage>; close(): Promise<void> }`, `type CaptureResult = { status: "ok"; png: Uint8Array } | { status: Exclude<SnapshotStatus, "ok">; detail: string }`, `VIEWPORT`, `CAP_MS = 15000`, `QUIET_MS = 1500`, `MIN_BYTES = 10240`, `isBlocked(url: string): boolean`, `capture(browser: CaptureBrowser, url: string, now?: () => number): Promise<CaptureResult>` (opens and closes its own page; the caller owns the browser)
  - `variants.ts`: `VARIANT_BUDGETS` (`{ 480: 30720, 960: 71680 }`), `interface Variant { key: string; type: "image/avif" | "image/webp"; bytes: Uint8Array }`, `makeVariants(images: ImagesBinding, png: Uint8Array, base: string): Promise<Variant[]>` (six variants: widths 480, 960, 1920, each AVIF then WebP)
  - `tests/unit/fake-browser.ts`: `interface FakeSite`, `fakePage(site: (url: string) => FakeSite)`, `fakeBrowser(site: (url: string) => FakeSite)` (both record calls; Task 4 reuses them)

- [ ] **Step 1: The fake browser for tests**

Create `tests/unit/fake-browser.ts`:

```ts
import type { CaptureBrowser, CapturePage, CaptureRequest } from "../../workers/snapshots/src/capture";

/** How a fake site answers: a status and headers, the page's markup, the screenshot or a failure */
export interface FakeSite {
  status?: number;
  headers?: Record<string, string>;
  html?: string;
  /** The screenshot's bytes; 20KB of zeros by default, comfortably over the 10KB floor */
  png?: Uint8Array;
  /** Navigation fails with this error */
  fail?: Error;
  /** The network never goes quiet */
  neverQuiet?: boolean;
  /** Runs while the page is navigating (to change the database mid-capture) */
  during?: () => Promise<void>;
  /** Reading the page throws (an unexpected failure, not a capture verdict) */
  broken?: boolean;
}

export type FakePage = CapturePage & { calls: string[]; intercept(url: string): Promise<"blocked" | "allowed"> };

/** A Browser Rendering page that answers from `site` instead of the network, and records what it was asked to do */
export function fakePage(site: (url: string) => FakeSite): FakePage {
  const calls: string[] = [];
  let listener: ((request: CaptureRequest) => void) | undefined;
  let current: FakeSite = {};
  const page: FakePage = {
    calls,
    async setViewport(viewport) {
      calls.push(`viewport ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}`);
    },
    async setRequestInterception(on) {
      calls.push(`intercept ${on}`);
    },
    on(_event, handler) {
      listener = handler;
      return page;
    },
    async goto(url, options) {
      calls.push(`goto ${url} ${options.waitUntil} ${options.timeout}`);
      current = site(url);
      await current.during?.();
      if (current.fail) throw current.fail;
      return { status: () => current.status ?? 200, headers: () => current.headers ?? {} };
    },
    async waitForFunction(_expression, options) {
      calls.push(`wait load ${options.timeout}`);
    },
    async waitForNetworkIdle(options) {
      calls.push(`wait quiet ${options.idleTime} ${options.timeout}`);
      if (current.neverQuiet) throw new Error("Timeout exceeded while waiting for network idle");
    },
    async content() {
      if (current.broken) throw new Error("Target closed");
      return current.html ?? "<html><head><title>a page</title></head><body>hello</body></html>";
    },
    async screenshot() {
      calls.push("shot");
      return current.png ?? new Uint8Array(20 * 1024);
    },
    async close() {
      calls.push("close");
    },
    async intercept(url) {
      let outcome: "blocked" | "allowed" = "allowed";
      listener!({
        url: () => url,
        abort: async () => {
          outcome = "blocked";
        },
        continue: async () => {
          outcome = "allowed";
        },
      });
      await Promise.resolve();
      return outcome;
    },
  };
  return page;
}

/** A browser session whose pages answer from `site`; counts launches of pages and whether it was closed */
export function fakeBrowser(site: (url: string) => FakeSite) {
  const pages: FakePage[] = [];
  const browser: CaptureBrowser & { pages: FakePage[]; closed: boolean } = {
    pages,
    closed: false,
    async newPage() {
      const page = fakePage(site);
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

Add to `tests/unit/snapshots.test.ts` (and add `snapshotBase, snapshotVariant, variantBase` to its import):

```ts
test("a capture's files share a base: snapshots/<slug>-<id>, then -<width>.<format>", () => {
  const base = snapshotBase("canberra-events", "01k6d4x3n9e5r2q7w8y0z1a2b3");
  expect(base).toBe("snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3");
  expect(snapshotVariant(base, 480, "avif")).toBe("snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3-480.avif");
  expect(variantBase(snapshotVariant(base, 1920, "webp"))).toBe(base);
  expect(variantBase("snapshots/fixture-digital-nachos-960.webp")).toBe("snapshots/fixture-digital-nachos");
  expect(variantBase("snapshots/readme.txt")).toBeNull();
  expect(variantBase("covers/simple-things.webp")).toBeNull();
  expect(variantBase("snapshots/x-640.webp")).toBeNull();
});
```

Create `tests/unit/snapshot-capture.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { capture, isBlocked } from "../../workers/snapshots/src/capture";
import { fakeBrowser, type FakeSite } from "./fake-browser";

const URL_ = "https://canberra.events/";
const shoot = (site: FakeSite, now?: () => number) => {
  const browser = fakeBrowser(() => site);
  return { browser, result: capture(browser, URL_, now ?? (() => 0)) };
};

describe("capture", () => {
  test("shoots 1440 × 900 at scale 2 once the page has loaded and gone quiet for 1.5s", async () => {
    const png = new Uint8Array(30_000);
    const { browser, result } = shoot({ png });
    expect(await result).toEqual({ status: "ok", png });
    expect(browser.pages[0].calls).toEqual([
      "viewport 1440x900@2",
      "intercept true",
      `goto ${URL_} domcontentloaded 15000`,
      "wait load 15000",
      "wait quiet 1500 15000",
      "shot",
      "close",
    ]);
    expect(browser.closed).toBe(false); // the caller owns the browser
  });

  test("a page that never goes quiet is shot at the 15s cap", async () => {
    const times = [0, 14_000, 15_500];
    const { browser, result } = shoot({ neverQuiet: true }, () => times.shift() ?? 15_500);
    expect((await result).status).toBe("ok");
    expect(browser.pages[0].calls).toContain("wait load 1000");
    expect(browser.pages[0].calls).toContain("wait quiet 1500 1");
  });

  test.each([
    ["a navigation error", { fail: new Error("net::ERR_NAME_NOT_RESOLVED") }, "navigation-error"],
    ["a page that doesn't arrive within 15s", { fail: new Error("Navigation timeout of 15000 ms exceeded") }, "navigation-error"],
    ["a 404", { status: 404 }, "http-error"],
    ["a 503", { status: 503 }, "http-error"],
    ["a challenge header", { status: 403, headers: { "cf-mitigated": "challenge" } }, "challenge"],
    ["a challenge page served with a 200", { html: "<html><head><title>Just a moment...</title></head></html>" }, "challenge"],
    ["the challenge platform's script", { html: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>' }, "challenge"],
    ["a blank page", { png: new Uint8Array(4_000) }, "too-small"],
  ])("fails on %s, without shooting, and closes the page", async (_name, site, status) => {
    const { browser, result } = shoot(site as FakeSite);
    const outcome = await result;
    expect(outcome.status).toBe(status);
    expect(outcome).toHaveProperty("detail");
    expect(browser.pages[0].calls.at(-1)).toBe("close");
    if (status !== "too-small") expect(browser.pages[0].calls).not.toContain("shot");
  });

  test("an unexpected failure is thrown, and the page still closes", async () => {
    const { browser, result } = shoot({ broken: true });
    await expect(result).rejects.toThrow("Target closed");
    expect(browser.pages[0].calls.at(-1)).toBe("close");
  });

  test("blocks analytics hosts, so a capture isn't counted as a visit, and lets the page's own requests through", async () => {
    const browser = fakeBrowser(() => ({}));
    await capture(browser, URL_, () => 0);
    const page = browser.pages[0];
    for (const url of [
      "https://us-assets.i.posthog.com/static/array.js",
      "https://us.i.posthog.com/e/",
      "https://www.google-analytics.com/g/collect",
      "https://www.googletagmanager.com/gtag/js?id=G-1",
      "https://connect.facebook.net/en_US/fbevents.js",
      "https://www.facebook.com/tr?id=1",
      "https://digitalnachos.com.au/ingest/i/v0/e/",
    ]) {
      expect(await page.intercept(url), url).toBe("blocked");
    }
    for (const url of ["https://canberra.events/app.js", "https://fonts.googleapis.com/css2", "https://cdn.example.com/x.png", "https://canberra.events/ingest-guide"]) {
      expect(await page.intercept(url), url).toBe("allowed");
    }
  });
});

test("isBlocked takes a malformed URL as not blocked", () => {
  expect(isBlocked("not a url")).toBe(false);
});
```

Create `tests/unit/snapshot-variants.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { makeVariants, VARIANT_BUDGETS } from "../../workers/snapshots/src/variants";

// The Images binding: the size of each output comes from `size(width, format, quality)`
function fakeImages(size: (width: number, format: string, quality: number) => number) {
  const asked: string[] = [];
  return {
    asked,
    input: () => {
      let width = 0;
      return {
        transform(options: { width: number; fit: string }) {
          width = options.width;
          asked.push(`transform ${options.width} ${options.fit}`);
          return this;
        },
        async output({ format, quality }: { format: string; quality: number }) {
          asked.push(`output ${width} ${format} ${quality}`);
          const bytes = new Uint8Array(size(width, format, quality));
          return { image: () => new Blob([bytes]).stream(), contentType: () => format, response: () => new Response() };
        },
      };
    },
  };
}

afterEach(() => vi.restoreAllMocks());

const png = new Uint8Array(600_000);
const base = "snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3";

test("makes AVIF and WebP at 480, 960 and 1920 wide, keeping the aspect ratio", async () => {
  const images = fakeImages(() => 5_000);
  const variants = await makeVariants(images as unknown as ImagesBinding, png, base);
  expect(variants.map((variant) => [variant.key, variant.type, variant.bytes.length])).toEqual([
    [`${base}-480.avif`, "image/avif", 5_000],
    [`${base}-480.webp`, "image/webp", 5_000],
    [`${base}-960.avif`, "image/avif", 5_000],
    [`${base}-960.webp`, "image/webp", 5_000],
    [`${base}-1920.avif`, "image/avif", 5_000],
    [`${base}-1920.webp`, "image/webp", 5_000],
  ]);
  expect(images.asked.filter((line) => line.startsWith("transform"))).toEqual(Array(6).fill("").map((_, i) => `transform ${[480, 480, 960, 960, 1920, 1920][i]} scale-down`));
});

test("steps the quality down until a variant fits its budget; the 1920 has none", async () => {
  // Over budget at quality 70 and 60, fits at 50
  const images = fakeImages((width, _format, quality) => (width === 1920 ? 400_000 : quality > 50 ? VARIANT_BUDGETS[width as 480 | 960]! + 1 : 1_000));
  const variants = await makeVariants(images as unknown as ImagesBinding, png, base);
  expect(images.asked.filter((line) => line.startsWith("output 480 image/avif"))).toEqual(["output 480 image/avif 70", "output 480 image/avif 60", "output 480 image/avif 50"]);
  expect(images.asked.filter((line) => line.startsWith("output 1920"))).toEqual(["output 1920 image/avif 70", "output 1920 image/webp 70"]);
  expect(variants.find((variant) => variant.key.endsWith("-1920.webp"))!.bytes.length).toBe(400_000);
});

test("a variant that never fits keeps its smallest try, with a warning", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const images = fakeImages((width) => (width === 480 ? 40_000 : 1_000));
  const variants = await makeVariants(images as unknown as ImagesBinding, png, base);
  expect(images.asked.filter((line) => line.startsWith("output 480 image/webp"))).toEqual(["output 480 image/webp 70", "output 480 image/webp 60", "output 480 image/webp 50", "output 480 image/webp 40"]);
  expect(variants[0].bytes.length).toBe(40_000);
  expect(warn).toHaveBeenCalledTimes(2);
});
```

Run: `bun run test:unit tests/unit/snapshots.test.ts tests/unit/snapshot-capture.test.ts tests/unit/snapshot-variants.test.ts`
Expected: FAIL: the key helpers aren't exported and `workers/snapshots/src/capture` and `variants` don't exist.

- [ ] **Step 3: Implement the keys, the capture and the variants**

Append to `src/lib/snapshots.ts`:

```ts
/** The widths every capture is stored at (spec 9): the hover card and label, phones and dense screens, the closer look */
export const SNAPSHOT_WIDTHS = [480, 960, 1920] as const;
export type SnapshotWidth = (typeof SNAPSHOT_WIDTHS)[number];
export type SnapshotFormat = "avif" | "webp";

/** Where a capture's files live in R2: one fresh base per capture, so a cached page never sees a key change under it */
export const snapshotBase = (slug: string, id: string) => `snapshots/${slug}-${id}`;
export const snapshotVariant = (base: string, width: SnapshotWidth, format: SnapshotFormat) => `${base}-${width}.${format}`;

/** The base a variant's key belongs to, or null for anything else under snapshots/ */
export function variantBase(key: string): string | null {
  const match = /^(snapshots\/.+)-(?:480|960|1920)\.(?:avif|webp)$/.exec(key);
  return match ? match[1] : null;
}
```

Create `workers/snapshots/src/capture.ts`:

```ts
import type { SnapshotStatus } from "../../../src/lib/snapshots";

// The slice of a Browser Rendering page a capture uses; @cloudflare/puppeteer's Page provides all of it
export interface CaptureRequest {
  url(): string;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}
export interface CaptureResponse {
  status(): number;
  headers(): Record<string, string>;
}
export interface CapturePage {
  setViewport(viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setRequestInterception(on: boolean): Promise<void>;
  on(event: "request", handler: (request: CaptureRequest) => void): unknown;
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<CaptureResponse | null>;
  waitForFunction(expression: string, options: { timeout: number }): Promise<unknown>;
  waitForNetworkIdle(options: { idleTime: number; timeout: number }): Promise<void>;
  content(): Promise<string>;
  screenshot(options: { type: "png" }): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface CaptureBrowser {
  newPage(): Promise<CapturePage>;
  close(): Promise<void>;
}

export type CaptureResult = { status: "ok"; png: Uint8Array } | { status: Exclude<SnapshotStatus, "ok">; detail: string };

export const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };
export const CAP_MS = 15_000;
export const QUIET_MS = 1_500;
/** Spec 9: a capture under 10KB is a blank page, not a snapshot */
export const MIN_BYTES = 10 * 1024;
// Analytics are never reached, so a capture isn't counted as a visit on George's other sites (spec 9): the known hosts,
// and a first-party PostHog proxy at /ingest/ on any host (as this site has)
const BLOCKED_HOSTS = [/(^|\.)posthog\.com$/, /(^|\.)google-analytics\.com$/, /(^|\.)googletagmanager\.com$/, /(^|\.)facebook\.(com|net)$/];

export function isBlocked(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return BLOCKED_HOSTS.some((pattern) => pattern.test(hostname)) || pathname.startsWith("/ingest/");
  } catch {
    return false;
  }
}

// Cloudflare's challenge page, for when the status and header don't give it away
const looksLikeChallenge = (html: string) => html.includes("/cdn-cgi/challenge-platform/") || /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(html);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Captures one page (spec 9): 1440 × 900 CSS px at scale 2, after load and a 1.5s quiet period, shot at the 15s cap
 * even if the page never goes quiet. Fails only on a navigation error, a non-2xx status, a Cloudflare challenge or a
 * screenshot under 10KB, and the caller keeps the previous snapshot then. Anything unexpected is thrown.
 */
export async function capture(browser: CaptureBrowser, url: string, now: () => number = Date.now): Promise<CaptureResult> {
  const start = now();
  // Never 0: puppeteer reads a timeout of 0 as "wait for ever"
  const left = () => Math.max(1, CAP_MS - (now() - start));
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      void (isBlocked(request.url()) ? request.abort("blockedbyclient") : request.continue()).catch(() => {});
    });
    let response: CaptureResponse | null;
    try {
      // The document's own arrival is the navigation; load and quiet are waited for below, within the same cap
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: CAP_MS });
    } catch (error) {
      return { status: "navigation-error", detail: message(error) };
    }
    if (!response) return { status: "navigation-error", detail: "no response" };
    if (response.headers()["cf-mitigated"] === "challenge") return { status: "challenge", detail: "cf-mitigated: challenge" };
    const status = response.status();
    if (status < 200 || status > 299) return { status: "http-error", detail: `status ${status}` };
    // A page whose load or network never settles is shot as it stands at the cap
    await page.waitForFunction("document.readyState === 'complete'", { timeout: left() }).catch(() => {});
    await page.waitForNetworkIdle({ idleTime: QUIET_MS, timeout: left() }).catch(() => {});
    if (looksLikeChallenge(await page.content())) return { status: "challenge", detail: "a challenge page" };
    const png = await page.screenshot({ type: "png" });
    if (png.byteLength < MIN_BYTES) return { status: "too-small", detail: `${png.byteLength} bytes` };
    return { status: "ok", png };
  } finally {
    await page.close().catch(() => {});
  }
}
```

Create `workers/snapshots/src/variants.ts`:

```ts
import { SNAPSHOT_WIDTHS, snapshotVariant, type SnapshotFormat, type SnapshotWidth } from "../../../src/lib/snapshots";

/** Spec 11: the 480px variant under 30KB and the 960px under 70KB; the closer look's 1920px has no budget */
export const VARIANT_BUDGETS: Partial<Record<SnapshotWidth, number>> = { 480: 30 * 1024, 960: 70 * 1024 };
const QUALITIES = [70, 60, 50, 40];
const FORMATS = [
  { format: "avif", type: "image/avif" },
  { format: "webp", type: "image/webp" },
] as const satisfies readonly { format: SnapshotFormat; type: string }[];

export interface Variant {
  key: string;
  type: "image/avif" | "image/webp";
  bytes: Uint8Array;
}

/**
 * A capture's six files: AVIF and WebP at 480, 960 and 1920 wide (scaled down, aspect kept), each stepped down in
 * quality until it fits its budget. One that never fits keeps its smallest try; the snapshot matters more than a
 * budget, and the warning lands in Workers Logs.
 */
export async function makeVariants(images: ImagesBinding, png: Uint8Array, base: string): Promise<Variant[]> {
  const source = new Blob([png.slice()]);
  const variants: Variant[] = [];
  for (const width of SNAPSHOT_WIDTHS) {
    const budget = VARIANT_BUDGETS[width];
    for (const { format, type } of FORMATS) {
      let bytes = new Uint8Array();
      for (const quality of QUALITIES) {
        const result = await images.input(source.stream()).transform({ width, fit: "scale-down" }).output({ format: type, quality });
        bytes = new Uint8Array(await new Response(result.image()).arrayBuffer());
        if (budget === undefined || bytes.byteLength < budget) break;
      }
      const key = snapshotVariant(base, width, format);
      if (budget !== undefined && bytes.byteLength >= budget) console.warn(`snapshots: ${key} is ${bytes.byteLength} bytes, over its ${budget} budget`);
      variants.push({ key, type, bytes });
    }
  }
  return variants;
}
```

In `tsconfig.json`, add `"workers"` to `include`, after `"scripts"`.

Run: `bun run test:unit tests/unit/snapshots.test.ts tests/unit/snapshot-capture.test.ts tests/unit/snapshot-variants.test.ts`
Expected: PASS (the snapshot tests plus the new key test, 13 capture tests and 3 variant tests).

- [ ] **Step 4: Typecheck and commit**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes. If `new Blob([png.slice()])` still fails the typecheck with a `BlobPart` error, type the copy explicitly: `new Blob([png.slice() as Uint8Array<ArrayBuffer>])`.

```bash
git add src/lib/snapshots.ts tsconfig.json workers/snapshots/src/capture.ts workers/snapshots/src/variants.ts tests/unit/fake-browser.ts tests/unit/snapshots.test.ts tests/unit/snapshot-capture.test.ts tests/unit/snapshot-variants.test.ts
git commit -m "feat: capture a page for its snapshot and make its AVIF and WebP variants"
```

---

### Task 4: the nightly run

Every line with a page to snapshot is captured in one browser session; a good capture's files go under a fresh key and the line points at them, a failure only records why. Both updates check the line still has the address that was captured. A capture's files are deleted a week after the next capture of the line replaced them. Unit-tested on SQLite with the real migrations, a fake R2 bucket, the fake browser and a fake Images binding.

**Files:**
- Create: `workers/snapshots/src/run.ts`
- Test: `tests/unit/snapshot-run.test.ts`

**Interfaces:**
- Consumes: `capture`, `CaptureBrowser` (Task 3); `makeVariants` (Task 3); `snapshotBase`, `variantBase`, `SnapshotStatus` (Task 3 and plan 3); `ulid` (`src/lib/admin/ulid.ts`); `sqliteD1` (`tests/unit/sqlite-d1.ts`); `fakeBrowser` (Task 3).
- Produces:
  - `interface RunDeps { db: D1Database; media: R2Bucket; images: ImagesBinding; launch: () => Promise<CaptureBrowser>; now?: () => Date; id?: () => string }`
  - `interface ShotTarget { id: number; slug: string; url: string }`
  - `type ShotOutcome = SnapshotStatus | "discarded"` ("discarded": the line changed or went while it was being captured)
  - `KEEP_SUPERSEDED_MS` (7 days)
  - `shotTargets(db, id?): Promise<ShotTarget[]>`, `shootOne(deps, browser, target): Promise<ShotOutcome>`, `runAll(deps): Promise<Record<string, ShotOutcome | "error">>`, `reshootOne(deps, id: number): Promise<ShotOutcome | "gone">`, `sweep(deps): Promise<number>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/snapshot-run.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { KEEP_SUPERSEDED_MS, reshootOne, runAll, sweep, type RunDeps } from "../../workers/snapshots/src/run";
import { fakeBrowser, type FakeSite } from "./fake-browser";
import { sqliteD1 } from "./sqlite-d1";

const NOW = new Date("2026-10-04T17:00:05.000Z");
const ID = "01k6d4x3n9e5r2q7w8y0z1a2b3";

// R2 as a map; `uploaded` can be set per object for the sweep
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string; uploaded: Date }>();
  return {
    objects,
    seed(key: string, uploaded: Date) {
      objects.set(key, { bytes: new Uint8Array(1), uploaded });
    },
    put: vi.fn(async (key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => {
      objects.set(key, { bytes, type: options?.httpMetadata?.contentType, uploaded: NOW });
      return {};
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) objects.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix?: string }) => ({
      objects: [...objects].filter(([key]) => key.startsWith(prefix ?? "")).map(([key, object]) => ({ key, uploaded: object.uploaded })),
      truncated: false,
    })),
  };
}

const fakeImages = {
  input: () => ({
    transform() {
      return this;
    },
    async output({ format }: { format: string }) {
      return { image: () => new Blob([new Uint8Array(2_000)]).stream(), contentType: () => format, response: () => new Response() };
    },
  }),
};

let db: D1Database;
let bucket: ReturnType<typeof fakeBucket>;
let browser: ReturnType<typeof fakeBrowser>;
let site: (url: string) => FakeSite;
const deps = (): RunDeps => ({
  db,
  media: bucket as unknown as R2Bucket,
  images: fakeImages as unknown as ImagesBinding,
  launch: async () => {
    browser = fakeBrowser(site);
    launches += 1;
    return browser;
  },
  now: () => NOW,
  id: () => ID,
});
let launches = 0;
const row = (slug: string) =>
  db.prepare("SELECT id, snapshot_url, snapshot_key, snapshot_at, snapshot_status FROM items WHERE slug = ?").bind(slug).first<{
    id: number;
    snapshot_url: string | null;
    snapshot_key: string | null;
    snapshot_at: string | null;
    snapshot_status: string | null;
  }>();

beforeEach(() => {
  db = sqliteD1();
  bucket = fakeBucket();
  launches = 0;
  site = () => ({});
});
afterEach(() => vi.restoreAllMocks());

test("shoots every line with a page to snapshot in one session, files six variants and points the line at them", async () => {
  expect(await runAll(deps())).toEqual({ "digital-nachos": "ok", "canberra-events": "ok", "linear-gratis": "ok", onestack: "ok" });
  expect(launches).toBe(1);
  expect(browser.closed).toBe(true);
  expect(await row("canberra-events")).toMatchObject({
    snapshot_key: `snapshots/canberra-events-${ID}`,
    snapshot_at: "2026-10-04T17:00:05.000Z",
    snapshot_status: "ok",
  });
  const files = [...bucket.objects.keys()].filter((key) => key.startsWith(`snapshots/canberra-events-${ID}`));
  expect(files.sort()).toEqual(["480", "960", "1920"].flatMap((width) => [`snapshots/canberra-events-${ID}-${width}.avif`, `snapshots/canberra-events-${ID}-${width}.webp`]).sort());
  expect(bucket.objects.get(`snapshots/canberra-events-${ID}-480.avif`)?.type).toBe("image/avif");
  expect(bucket.objects.size).toBe(24);
});

test("a failed capture keeps the old snapshot and records why", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.prepare("UPDATE items SET snapshot_key = 'snapshots/digital-nachos-old', snapshot_at = '2026-10-01T17:00:00.000Z', snapshot_status = 'ok' WHERE slug = 'digital-nachos'").run();
  site = (url) => (url.includes("digitalnachos") ? { status: 503 } : {});
  const outcomes = await runAll(deps());
  expect(outcomes["digital-nachos"]).toBe("http-error");
  expect(await row("digital-nachos")).toMatchObject({ snapshot_key: "snapshots/digital-nachos-old", snapshot_at: "2026-10-01T17:00:00.000Z", snapshot_status: "http-error" });
  expect([...bucket.objects.keys()].some((key) => key.startsWith("snapshots/digital-nachos-"))).toBe(false);
  expect(console.error).toHaveBeenCalled();
});

test("a line given a new address while it was captured keeps what George saved, and the capture's files go", async () => {
  site = (url) =>
    url.includes("canberra.events")
      ? { during: async () => void (await db.prepare("UPDATE items SET snapshot_url = 'https://canberra.events/new', snapshot_key = NULL WHERE slug = 'canberra-events'").run()) }
      : {};
  const outcomes = await runAll(deps());
  expect(outcomes["canberra-events"]).toBe("discarded");
  expect(await row("canberra-events")).toMatchObject({ snapshot_url: "https://canberra.events/new", snapshot_key: null });
  expect([...bucket.objects.keys()].some((key) => key.startsWith("snapshots/canberra-events-"))).toBe(false);
});

test("a line removed while it was captured leaves no files behind", async () => {
  site = (url) => (url.includes("linear.gratis") ? { during: async () => void (await db.prepare("DELETE FROM items WHERE slug = 'linear-gratis'").run()) } : {});
  expect((await runAll(deps()))["linear-gratis"]).toBe("discarded");
  expect([...bucket.objects.keys()].some((key) => key.startsWith("snapshots/linear-gratis-"))).toBe(false);
});

test("one line's unexpected error doesn't stop the others, and the session still closes", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  site = (url) => (url.includes("digitalnachos") ? { broken: true } : {});
  const outcomes = await runAll(deps());
  expect(outcomes["digital-nachos"]).toBe("error");
  expect(outcomes["canberra-events"]).toBe("ok");
  expect(browser.closed).toBe(true);
});

test("re-shoots one line by id, and says when it has no page to snapshot", async () => {
  const canberra = (await row("canberra-events"))!.id;
  const kpmg = (await db.prepare("SELECT id FROM items WHERE slug = 'kpmg'").first<{ id: number }>())!.id;
  expect(await reshootOne(deps(), canberra)).toBe("ok");
  expect(browser.closed).toBe(true);
  expect(await reshootOne(deps(), kpmg)).toBe("gone");
  expect(await reshootOne(deps(), 999)).toBe("gone");
  expect(launches).toBe(1); // no session for a line with nothing to shoot
});

test("deletes files no line points at once they're a week old, and nothing else", async () => {
  const old = new Date(NOW.getTime() - KEEP_SUPERSEDED_MS - 1);
  const recent = new Date(NOW.getTime() - KEEP_SUPERSEDED_MS + 60_000);
  await db.prepare("UPDATE items SET snapshot_key = 'snapshots/digital-nachos-current' WHERE slug = 'digital-nachos'").run();
  for (const width of [480, 960, 1920]) {
    for (const format of ["avif", "webp"]) {
      bucket.seed(`snapshots/digital-nachos-current-${width}.${format}`, old); // in use: kept, however old
      bucket.seed(`snapshots/digital-nachos-superseded-${width}.${format}`, old); // superseded a week ago: deleted
      bucket.seed(`snapshots/canberra-events-yesterday-${width}.${format}`, recent); // superseded lately: kept for now
    }
  }
  bucket.seed("snapshots/notes.txt", old); // not a variant: left alone
  bucket.seed("covers/simple-things.webp", old); // not a snapshot at all
  expect(await sweep(deps())).toBe(6);
  expect([...bucket.objects.keys()].filter((key) => key.includes("superseded"))).toEqual([]);
  expect(bucket.objects.size).toBe(14);
});

test("a capture is kept for a week after the next one replaced it, however old it is", async () => {
  const previous = "snapshots/canberra-events-01k00000000000000000000000";
  const current = "snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3";
  const older = "snapshots/canberra-events-01j00000000000000000000000";
  await db.prepare("UPDATE items SET snapshot_key = ? WHERE slug = 'canberra-events'").bind(current).run();
  const at = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  for (const width of [480, 960, 1920]) {
    for (const format of ["avif", "webp"]) {
      bucket.seed(`${older}-${width}.${format}`, at(60)); // replaced 30 days ago by `previous`: deleted
      bucket.seed(`${previous}-${width}.${format}`, at(30)); // replaced just now by `current`: kept for a week
      bucket.seed(`${current}-${width}.${format}`, at(0));
    }
  }
  expect(await sweep(deps())).toBe(6);
  expect([...bucket.objects.keys()].some((key) => key.startsWith(older))).toBe(false);
  expect([...bucket.objects.keys()].filter((key) => key.startsWith(previous))).toHaveLength(6);
});
```

Run: `bun run test:unit tests/unit/snapshot-run.test.ts`
Expected: FAIL, cannot resolve `../../workers/snapshots/src/run`.

- [ ] **Step 2: Implement the run**

Create `workers/snapshots/src/run.ts`:

```ts
import { ulid } from "../../../src/lib/admin/ulid";
import { snapshotBase, variantBase, type SnapshotStatus } from "../../../src/lib/snapshots";
import { capture, type CaptureBrowser } from "./capture";
import { makeVariants } from "./variants";

export interface RunDeps {
  db: D1Database;
  media: R2Bucket;
  images: ImagesBinding;
  /** Starts a Browser Rendering session: one per run, a page per line */
  launch: () => Promise<CaptureBrowser>;
  now?: () => Date;
  /** The id in new keys (tests pass a fixed one) */
  id?: () => string;
}

export interface ShotTarget {
  id: number;
  slug: string;
  url: string;
}

/** "discarded": the line was given another address, or removed, while it was being captured */
export type ShotOutcome = SnapshotStatus | "discarded";

/** Files no line points at stay this long, so a cached page that still names them keeps working (spec 9) */
export const KEEP_SUPERSEDED_MS = 7 * 24 * 60 * 60 * 1000;

/** Every line with a page to snapshot, in section order; or just the one with this id */
export async function shotTargets(db: D1Database, id?: number): Promise<ShotTarget[]> {
  const select = "SELECT id, slug, snapshot_url AS url FROM items WHERE snapshot_url IS NOT NULL";
  const statement = id === undefined ? db.prepare(`${select} ORDER BY section, position`) : db.prepare(`${select} AND id = ?`).bind(id);
  return (await statement.all<ShotTarget>()).results;
}

/**
 * Captures one line and records the outcome (spec 9). A good capture's six files go under a fresh key and then the
 * line points at them; a failure only records why, so the previous snapshot stays. Both updates require the line to
 * still have the address that was captured, so a line edited or removed meanwhile keeps what George saved, and the
 * new files are deleted again.
 */
export async function shootOne(deps: RunDeps, browser: CaptureBrowser, target: ShotTarget): Promise<ShotOutcome> {
  const result = await capture(browser, target.url);
  if (result.status !== "ok") {
    console.error(`snapshots: ${target.slug} failed (${result.status}): ${result.detail}`);
    await deps.db.prepare("UPDATE items SET snapshot_status = ? WHERE id = ? AND snapshot_url = ?").bind(result.status, target.id, target.url).run();
    return result.status;
  }
  const base = snapshotBase(target.slug, (deps.id ?? (() => ulid()))());
  const variants = await makeVariants(deps.images, result.png, base);
  const keys = variants.map((variant) => variant.key);
  try {
    for (const variant of variants) await deps.media.put(variant.key, variant.bytes, { httpMetadata: { contentType: variant.type } });
    const at = (deps.now ?? (() => new Date()))().toISOString();
    const update = await deps.db
      .prepare("UPDATE items SET snapshot_key = ?, snapshot_at = ?, snapshot_status = 'ok' WHERE id = ? AND snapshot_url = ?")
      .bind(base, at, target.id, target.url)
      .run();
    if (update.meta.changes > 0) return "ok";
  } catch (error) {
    await deps.media.delete(keys).catch(() => {});
    throw error;
  }
  await deps.media.delete(keys);
  return "discarded";
}

/** The nightly run: every line, one session, then the clean-up. One line's error is logged and the run goes on */
export async function runAll(deps: RunDeps): Promise<Record<string, ShotOutcome | "error">> {
  const targets = await shotTargets(deps.db);
  const outcomes: Record<string, ShotOutcome | "error"> = {};
  if (targets.length > 0) {
    const browser = await deps.launch();
    try {
      for (const target of targets) {
        try {
          outcomes[target.slug] = await shootOne(deps, browser, target);
        } catch (error) {
          console.error(`snapshots: ${target.slug} errored:`, error instanceof Error ? error.message : String(error));
          outcomes[target.slug] = "error";
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }
  await sweep(deps);
  return outcomes;
}

/** The admin's "re-shoot now": one line, its own session; "gone" when it has no page to snapshot */
export async function reshootOne(deps: RunDeps, id: number): Promise<ShotOutcome | "gone"> {
  const [target] = await shotTargets(deps.db, id);
  if (!target) return "gone";
  const browser = await deps.launch();
  try {
    return await shootOne(deps, browser, target);
  } finally {
    await browser.close().catch(() => {});
  }
}

// A capture's slug: snapshots/<slug>-<26-character ulid>; fixtures and anything else have none
const slugOf = (base: string) => /^snapshots\/(.+)-[0-9a-hjkmnp-tv-z]{26}$/.exec(base)?.[1] ?? null;

/**
 * Deletes snapshot files a week after they were superseded (spec 9): a capture is superseded when the next capture of
 * the same line was uploaded, so a cached page that still names it keeps working for a week whatever its age. A base
 * no line points at with no later capture (the line's address changed, or it went) counts from its own upload.
 * Returns how many files went.
 */
export async function sweep(deps: Pick<RunDeps, "db" | "media" | "now">): Promise<number> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const { results } = await deps.db.prepare("SELECT snapshot_key AS key FROM items WHERE snapshot_key IS NOT NULL").all<{ key: string }>();
  const inUse = new Set(results.map((row) => row.key));
  const bases = new Map<string, { keys: string[]; uploaded: number }>();
  let cursor: string | undefined;
  do {
    const page = await deps.media.list({ prefix: "snapshots/", cursor });
    for (const object of page.objects) {
      const base = variantBase(object.key);
      if (!base) continue;
      const entry = bases.get(base) ?? { keys: [], uploaded: 0 };
      entry.keys.push(object.key);
      entry.uploaded = Math.max(entry.uploaded, object.uploaded.getTime());
      bases.set(base, entry);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const uploads = new Map<string, number[]>();
  for (const [base, entry] of bases) {
    const slug = slugOf(base);
    if (slug) uploads.set(slug, [...(uploads.get(slug) ?? []), entry.uploaded]);
  }
  const stale: string[] = [];
  for (const [base, entry] of bases) {
    if (inUse.has(base)) continue;
    const slug = slugOf(base);
    const next = slug ? Math.min(...(uploads.get(slug) ?? []).filter((time) => time > entry.uploaded)) : Infinity;
    const supersededAt = Number.isFinite(next) ? next : entry.uploaded;
    if (now - supersededAt > KEEP_SUPERSEDED_MS) stale.push(...entry.keys);
  }
  // R2 deletes at most 1000 keys a call
  for (let i = 0; i < stale.length; i += 1000) await deps.media.delete(stale.slice(i, i + 1000));
  return stale.length;
}
```

Run: `bun run test:unit tests/unit/snapshot-run.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Typecheck and commit**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

```bash
git add workers/snapshots/src/run.ts tests/unit/snapshot-run.test.ts
git commit -m "feat: the nightly snapshot run, guarded against lines that change mid-capture, with a week-old clean-up"
```

---

### Task 5: the snapshots Worker

The Worker itself: a class entrypoint with the nightly `scheduled` run and a `reshoot` RPC method, its configuration, the main Worker's service binding and the deploy job. The whole pipeline is then tested end to end on this machine: both Workers on a fourth local server (port 4334) with their own store, local Browser Rendering and the local Images binding, capturing a small fixture site on port 4400.

**Files:**
- Create: `workers/snapshots/wrangler.jsonc`, `workers/snapshots/src/env.ts`, `workers/snapshots/src/index.ts`, `tests/fixtures/snapshot-site.mjs`, `tests/e2e/snapshots-live.spec.ts`
- Modify: `package.json` and `bun.lock` (`@cloudflare/puppeteer` 1.4.0, script `dev:snapshots`), `wrangler.jsonc` (the `SNAPSHOTS` service binding), `worker-configuration.d.ts` (regenerated), `playwright.config.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `runAll`, `reshootOne`, `RunDeps`, `ShotOutcome` (Task 4); `CaptureBrowser` (Task 3).
- Produces:
  - The Worker `curiousgeorge-snapshots` (class `Snapshots extends WorkerEntrypoint<SnapshotsEnv>`): `scheduled()` runs `runAll`; RPC `reshoot(id: number): Promise<ShotOutcome | "gone">`; `fetch` answers 404 (no public route)
  - `env.SNAPSHOTS` in the main Worker (a service binding to it)
  - Port 4334: both Workers, store `.wrangler/snapshots` recreated every run, with canberra-events pointed at `http://127.0.0.1:4400/` (the fixture page), digital-nachos at `http://127.0.0.1:4400/missing` (a 404) and every other line's page cleared
  - Port 4400: the fixture site (`tests/fixtures/snapshot-site.mjs`)
  - `tests/e2e/snapshots-live.spec.ts` exporting `SNAPS = "http://localhost:4334"` and `nightly(request)` (Tasks 6 and 7 add to this file)

- [ ] **Step 1: The dependency and the Worker**

Run: `bun add @cloudflare/puppeteer@1.4.0`
Expected: `"@cloudflare/puppeteer": "1.4.0"` in `dependencies`, exact.

Create `workers/snapshots/wrangler.jsonc`:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  // The snapshots Worker (spec 9): a nightly capture of every line with a page to snapshot, and the admin's re-shoot
  // over the main Worker's SNAPSHOTS service binding. No public route.
  "name": "curiousgeorge-snapshots",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "observability": { "logs": { "enabled": true } },
  // 17:00 UTC is 03:00 in Sydney in standard time and 04:00 in daylight saving
  "triggers": { "crons": ["0 17 * * *"] },
  "browser": { "binding": "BROWSER" },
  "images": { "binding": "IMAGES" },
  // The same database and bucket as the main Worker (the id is filled in at launch, in both files)
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "curiousgeorge-logbook",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "../../migrations"
    }
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "curiousgeorge-media" }]
}
```

Create `workers/snapshots/src/env.ts`:

```ts
/** The snapshots Worker's bindings (workers/snapshots/wrangler.jsonc) */
export interface SnapshotsEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  BROWSER: Fetcher;
}
```

Create `workers/snapshots/src/index.ts`:

```ts
import puppeteer from "@cloudflare/puppeteer";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { CaptureBrowser } from "./capture";
import type { SnapshotsEnv } from "./env";
import { reshootOne, runAll, type RunDeps } from "./run";

// The snapshots Worker (spec 9): the nightly run on its cron, and "re-shoot now" over RPC for the admin page
export default class Snapshots extends WorkerEntrypoint<SnapshotsEnv> {
  async scheduled(): Promise<void> {
    const outcomes = await runAll(this.deps());
    console.log("snapshots: nightly run", JSON.stringify(outcomes));
  }

  /** Captures one line now (the admin's "re-shoot now"); "gone" when it has no page to snapshot */
  async reshoot(id: number) {
    return reshootOne(this.deps(), id);
  }

  // No public route: the Worker is reached only by its cron and the service binding
  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 });
  }

  private deps(): RunDeps {
    const { DB, MEDIA, IMAGES, BROWSER } = this.env;
    return {
      db: DB,
      media: MEDIA,
      images: IMAGES,
      // @cloudflare/puppeteer's Browser and Page provide the slice capture() uses
      launch: async () => (await puppeteer.launch(BROWSER)) as unknown as CaptureBrowser,
    };
  }
}
```

In `package.json` `scripts`, add after `"dev:admin"`:

```json
    "dev:snapshots": "wrangler dev -c workers/snapshots/wrangler.jsonc --port 8790 --persist-to .wrangler/state --test-scheduled",
```

If the typecheck in Step 2 rejects `puppeteer.launch(BROWSER)` because `Fetcher` isn't the type it names, pass `BROWSER as unknown as Parameters<typeof puppeteer.launch>[0]` with a comment saying the binding is what it expects.

Run: `bunx wrangler deploy -c workers/snapshots/wrangler.jsonc --dry-run --outdir "$(mktemp -d)"`
Expected: a bundle of about 690KiB, 136KiB gzipped; nothing is uploaded (`--dry-run` needs no account).

- [ ] **Step 2: The service binding**

In `wrangler.jsonc`, after the `"images"` line (add a comma after it), add:

```jsonc
  // The admin's "re-shoot now" calls the snapshots Worker over RPC (spec 9)
  "services": [{ "binding": "SNAPSHOTS", "service": "curiousgeorge-snapshots" }]
```

Regenerate the binding types in a clean directory:

```bash
TMP=$(mktemp -d) && cp wrangler.jsonc "$TMP"/ && ln -s "$PWD/node_modules" "$TMP/node_modules" && (cd "$TMP" && ./node_modules/.bin/wrangler types --strict-vars=false) && cp "$TMP/worker-configuration.d.ts" worker-configuration.d.ts && rm -rf "$TMP"
git diff worker-configuration.d.ts | head -30
```

Expected: a new hash and a `SNAPSHOTS` entry in `__BaseEnv_Env` (a `Fetcher` or `Service` type); nothing from `.env`.

Run: `bun run typecheck && bun run build:test && grep -o '"services":\[[^]]*\]' dist/server/wrangler.json`
Expected: 0 errors (`workers/` is type-checked since Task 3); the built config carries the `SNAPSHOTS` service binding. The servers on 4331 to 4333 run without the snapshots Worker: their pages render, and only a call through the binding fails. The 4334 server added in Step 3 keeps its own dev registry, so they never find its snapshots Worker. Stop `bun run dev:snapshots` before running the e2e suite: the shared registry would connect the 4333 server to it.

- [ ] **Step 3: The fixture site and the fourth server**

Create `tests/fixtures/snapshot-site.mjs`:

```js
// A small site for the snapshot specs to capture (tests/e2e/snapshots-live.spec.ts), so nothing real is visited.
//   /         a detailed page: its screenshot is far over the 10KB floor
//   anything else is a 404
import { createServer } from "node:http";

const PORT = 4400;
const tiles = Array.from({ length: 48 }, (_, i) => `<div style="background:hsl(${i * 7.5} 60% ${40 + (i % 5) * 8}%)"></div>`).join("");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>a fixture for snapshots</title>
<style>body{margin:0;font:18px/1.5 system-ui;background:linear-gradient(135deg,#f4efe6,#d9e4f5)}main{padding:48px}
h1{font-size:64px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}.grid div{height:90px;border-radius:8px}</style>
<script async src="https://us-assets.i.posthog.com/static/array.js"></script>
</head><body><main><h1>a fixture page</h1><p>${"a line of text so the capture has something to show. ".repeat(24)}</p>
<div class="grid">${tiles}</div></main></body></html>`;

createServer((request, response) => {
  const found = request.url === "/";
  response.writeHead(found ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  response.end(found ? page : "<!doctype html><title>missing</title><p>nothing here</p>");
}).listen(PORT, "127.0.0.1", () => console.log(`snapshot fixture site on http://127.0.0.1:${PORT}`));
```

In `playwright.config.ts`, add two entries at the end of `webServer`:

```ts
        // The site the snapshot specs capture, so nothing real is visited
        { command: "node tests/fixtures/snapshot-site.mjs", url: "http://127.0.0.1:4400/", reuseExistingServer: !process.env.CI, timeout: 30_000 },
        // A fourth server running both Workers, with its own store recreated every run: canberra-events points at the
        // fixture page, digital-nachos at a 404 and every other line's page is cleared. Local Browser Rendering
        // downloads Chrome on first use.
        {
          command: [
            "rm -rf .wrangler/snapshots",
            "wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/snapshots",
            `wrangler d1 execute curiousgeorge-logbook --local --persist-to .wrangler/snapshots --command "UPDATE items SET snapshot_url = NULL; UPDATE items SET snapshot_url = 'http://127.0.0.1:4400/' WHERE slug = 'canberra-events'; UPDATE items SET snapshot_url = 'http://127.0.0.1:4400/missing' WHERE slug = 'digital-nachos'"`,
            // Its own dev registry: in the shared one, the other servers' SNAPSHOTS bindings would reach this snapshots
            // Worker and re-shoot against this store
            "WRANGLER_REGISTRY_PATH=.wrangler/snapshots/registry wrangler dev -c dist/server/wrangler.json -c workers/snapshots/wrangler.jsonc --port 4334 --persist-to .wrangler/snapshots",
          ].join(" && "),
          url: "http://localhost:4334",
          reuseExistingServer: false,
          timeout: 180_000,
        },
```

(`wrangler d1 execute --command` changes test data in a local store; it is not a migration, which only ever goes through `migrations apply`.)

- [ ] **Step 4: The end-to-end check**

Create `tests/e2e/snapshots-live.spec.ts`:

```ts
import { expect, test, type APIRequestContext } from "@playwright/test";

// The whole snapshot pipeline on this machine (spec 9): both Workers on 4334 with their own store, local Browser
// Rendering (Chrome, downloaded on first use) and the local Images binding, capturing the fixture site on 4400. The
// server's setup points canberra-events at the fixture page and digital-nachos at its 404, and clears every other line.
test.skip(({ browserName }) => browserName !== "chromium", "one run: it writes to its own store");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "local Workers only");
test.describe.configure({ mode: "serial", timeout: 240_000 });

export const SNAPS = "http://localhost:4334";

/** Runs the snapshots Worker's cron now, through wrangler's local explorer (the only route that reaches the second Worker) */
export const nightly = (request: APIRequestContext) =>
  request.post(`${SNAPS}/cdn-cgi/local/explorer/api/local/scheduled?worker=curiousgeorge-snapshots`, { data: { cron: "0 17 * * *" }, timeout: 180_000 });

const status = (slug: string) => `#snapshots li[data-slug="${slug}"] .status`;

test("the nightly run captures a line's page, and a page that answers 404 is recorded as an error", async ({ page, request }) => {
  const response = await nightly(request);
  expect(response.ok(), await response.text()).toBe(true);
  await page.goto(`${SNAPS}/admin/`);
  await expect(page.locator(status("canberra-events"))).toHaveText(/^captured \d{4}-\d{2}-\d{2}$/);
  await expect(page.locator(status("digital-nachos"))).toHaveText("the page returned an error · no good capture yet");
});
```

Run: `bun run build:test`, then `pkill -f "port 43"; pkill -f snapshot-site`, then `bun run test:e2e tests/e2e/snapshots-live.spec.ts --project=chromium`
Expected: PASS. The first run downloads Chrome for local Browser Rendering (about 145MB, a minute); later runs reuse it. If the cron request fails, read the `snapshots:` error lines in the Playwright output (only `console.error` reaches it).

If `node --version` isn't v24, run the e2e under `mise exec node@24 --`: wrangler's first Chrome extraction has hung under Node 26.

- [ ] **Step 5: CI**

In `.github/workflows/ci.yml`:

- in the `check` job, before `- run: bun run test:e2e`, cache the Chrome that local Browser Rendering downloads:

```yaml
      # Local Browser Rendering (the snapshot specs) downloads Chrome on first use; keep it between runs
      - uses: actions/cache@v6
        with:
          path: ~/.cache/.wrangler/chrome
          key: wrangler-chrome-${{ hashFiles('bun.lock') }}
          restore-keys: wrangler-chrome-
```

- in the `deploy` job, directly before `- run: bunx wrangler deploy`, deploy the snapshots Worker first (the main Worker's service binding needs it to exist):

```yaml
      # The snapshots Worker first: the main Worker's SNAPSHOTS binding needs it to exist
      - run: bunx wrangler deploy -c workers/snapshots/wrangler.jsonc
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 6: Run everything and commit**

Run: `bun run typecheck && bun run test:unit`, then the whole e2e suite (`pkill -f "port 43"; pkill -f snapshot-site; bun run test:e2e`).
Expected: 0 errors; everything passes (rerun a known flake alone if one fails).

```bash
git add package.json bun.lock wrangler.jsonc worker-configuration.d.ts workers/snapshots/wrangler.jsonc workers/snapshots/src/env.ts workers/snapshots/src/index.ts tests/fixtures/snapshot-site.mjs tests/e2e/snapshots-live.spec.ts playwright.config.ts .github/workflows/ci.yml
git commit -m "feat: the snapshots Worker, its service binding and an end-to-end run on local Browser Rendering"
```

---

### Task 6: "re-shoot now"

Each line in the admin's snapshots section gets a "re-shoot now" button that calls the snapshots Worker through the service binding and waits for the capture. A good capture is a save; a failed one says why on its line; a Worker that doesn't answer says so.

**Files:**
- Modify: `src/lib/admin/actions.ts`, `src/pages/admin/index.astro`, `src/components/admin/SnapshotsAdmin.astro`, `src/styles/admin.css`, `tests/e2e/admin-page.spec.ts`, `tests/e2e/snapshots-live.spec.ts`
- Test: `tests/unit/actions.test.ts`

**Interfaces:**
- Consumes: `ShotOutcome` (Task 4); `env.SNAPSHOTS` (Task 5); `SNAPSHOT_STATUSES` (plan 3); `formState` and `AdminRow` (plan 3).
- Produces:
  - `AdminSection` gains `"snapshots"`; `interface SnapshotsService { reshoot(id: number): Promise<ShotOutcome | "gone"> }`; `ActionDeps.snapshots?: SnapshotsService`
  - The intent `snapshot.reshoot` (with `id`); its failure form id is `shot-<id>`
  - The re-shoot button's accessible name: `re-shoot <slug> now`

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/actions.test.ts`, add `import type { ShotOutcome } from "../../workers/snapshots/src/run";` to the imports and add:

```ts
describe("snapshots", () => {
  const reshoot = async (answer: ShotOutcome | "gone" | Error | null, id = "1") => {
    const snapshots =
      answer === null
        ? undefined
        : {
            reshoot: vi.fn(async () => {
              if (answer instanceof Error) throw answer;
              return answer;
            }),
          };
    const form = new FormData();
    form.append("intent", "snapshot.reshoot");
    form.append("id", id);
    return { result: await runAction(form, { ...deps(), snapshots }), snapshots };
  };

  test("a re-shoot that captures the page is saved", async () => {
    const { result, snapshots } = await reshoot("ok");
    expect(result).toEqual({ ok: true, section: "snapshots" });
    expect(snapshots!.reshoot).toHaveBeenCalledWith(1);
  });

  test("a capture that fails says why, on its line", async () => {
    expect((await reshoot("challenge")).result).toEqual({
      ok: false,
      section: "snapshots",
      form: "shot-1",
      errors: { form: "couldn't capture it: a bot check blocked it" },
      values: {},
    });
    expect((await reshoot("too-small")).result).toMatchObject({ errors: { form: "couldn't capture it: the capture came out blank" } });
  });

  test("a line that changed while it was captured asks for another go", async () => {
    expect((await reshoot("discarded")).result).toMatchObject({ form: "shot-1", errors: { form: "the line changed while it was being captured. try again." } });
  });

  test("a line with no page to snapshot any more is a message for the page", async () => {
    expect((await reshoot("gone")).result).toMatchObject({ section: null, form: "", errors: { form: "that line has no page to snapshot any more" } });
  });

  test("a snapshots Worker that doesn't answer, or isn't bound, says so on the line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const answer of [new Error('Worker "curiousgeorge-snapshots" not found'), null]) {
      expect((await reshoot(answer)).result).toMatchObject({
        section: "snapshots",
        form: "shot-1",
        errors: { form: "the snapshots worker didn't answer. try again in a minute." },
      });
    }
    expect(error).toHaveBeenCalledTimes(2);
  });

  test("an id that isn't one is gone", async () => {
    expect((await reshoot("ok", "abc")).result).toMatchObject({ section: null, errors: { form: "that line no longer exists" } });
  });
});
```

Run: `bun run test:unit tests/unit/actions.test.ts`
Expected: FAIL, "that action isn't recognised".

- [ ] **Step 2: The action**

In `src/lib/admin/actions.ts`:

- add the imports:

```ts
import type { ShotOutcome } from "../../../workers/snapshots/src/run";
import { SNAPSHOT_STATUSES } from "../snapshots";
```

- extend `AdminSection` to `"now" | "before" | "log" | "lately" | "records" | "snapshots"`;
- add after `ActionDeps`'s `keys` member:

```ts
  /** The snapshots Worker, through the SNAPSHOTS service binding (spec 9) */
  snapshots?: SnapshotsService;
```

- and above `ActionDeps`:

```ts
/** The snapshots Worker's RPC (workers/snapshots/src/index.ts) */
export interface SnapshotsService {
  reshoot(id: number): Promise<ShotOutcome | "gone">;
}
```

- add the case to `runAction`'s switch, before `default`:

```ts
    case "snapshot.reshoot":
      return reshoot(form, deps);
```

- and add at the end of the file:

```ts
// Snapshots

/** "Re-shoot now" (spec 9): waits for the capture, which takes a few seconds; a failed capture isn't a save */
async function reshoot(form: FormData, { snapshots }: ActionDeps): Promise<ActionResult> {
  const id = idOf(form);
  if (id === null) return gone("line");
  const formId = `shot-${id}`;
  let outcome: ShotOutcome | "gone";
  try {
    if (!snapshots) throw new Error("no SNAPSHOTS binding");
    outcome = await snapshots.reshoot(id);
  } catch (error) {
    console.error("admin: the snapshots worker didn't answer", error instanceof Error ? error.message : String(error));
    return fail("snapshots", formId, { form: "the snapshots worker didn't answer. try again in a minute." });
  }
  if (outcome === "ok") return { ok: true, section: "snapshots" };
  if (outcome === "gone") return fail(null, "", { form: "that line has no page to snapshot any more" });
  if (outcome === "discarded") return fail("snapshots", formId, { form: "the line changed while it was being captured. try again." });
  return fail("snapshots", formId, { form: `couldn't capture it: ${SNAPSHOT_STATUSES[outcome]}` });
}
```

Run: `bun run test:unit tests/unit/actions.test.ts`
Expected: PASS, including the six new tests.

- [ ] **Step 3: The button and the page**

Replace `src/components/admin/SnapshotsAdmin.astro` with:

```astro
---
import { describeSnapshot } from "../../lib/snapshots";
import { formState } from "../../lib/admin/form-state";
import type { ActionFailure } from "../../lib/admin/actions";
import type { AdminItem } from "../../lib/admin/store";

interface Props {
  items: AdminItem[];
  failure: ActionFailure | null;
}

const { items, failure } = Astro.props;
const shots = items.filter((item) => item.snapshotUrl);
---
{shots.length === 0 ? (
  <p class="empty">no lines have a page to snapshot yet. add one in a line's wall label.</p>
) : (
  <ul class="snapshots">
    {shots.map((item) => {
      const id = `shot-${item.id}`;
      const { errors } = formState(failure, id, {});
      return (
        <li data-slug={item.slug}>
          <span class="mono">{item.slug}</span>
          <span class="url">{item.snapshotUrl}</span>
          <span class="status">{describeSnapshot(item.snapshotStatus, item.snapshotAt)}</span>
          <form method="post" action={`/admin/#${id}`} id={id} class="reshoot">
            <input type="hidden" name="intent" value="snapshot.reshoot" />
            <input type="hidden" name="id" value={item.id} />
            {errors.form && <p class="error" role="alert">{errors.form}</p>}
            <button type="submit" class="button quiet" aria-label={`re-shoot ${item.slug} now`}>re-shoot now</button>
          </form>
        </li>
      );
    })}
  </ul>
)}
<p class="hint">pages are captured every night, around 3am in sydney. re-shoot one when it has changed; it takes a few seconds.</p>
```

In `src/pages/admin/index.astro`:

- add `"snapshots"` to the end of `SECTIONS`;
- import the service type: change the actions import to `import type { ActionFailure, AdminSection, SnapshotsService } from "../../lib/admin/actions";`;
- pass the binding in `deps`:

```ts
  const deps = { db: env.DB, media: env.MEDIA, images: env.IMAGES, snapshots: env.SNAPSHOTS as unknown as SnapshotsService };
```

- replace the snapshots row with:

```astro
    <AdminRow label="snapshots" id="snapshots" notice={notice("snapshots")}><SnapshotsAdmin items={[...data.now, ...data.before]} failure={failure} /></AdminRow>
```

Append to `src/styles/admin.css`:

```css
.snapshots .reshoot { display: grid; gap: 6px; justify-items: start; margin-top: 6px; }
```

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: The end-to-end checks**

In `tests/e2e/admin-page.spec.ts` (the admin server on 4333, which runs without the snapshots Worker), add:

```ts
test("re-shooting without the snapshots Worker says so on the line", async ({ page }) => {
  await openAdmin(page);
  const line = page.locator('#snapshots li[data-slug="digital-nachos"]');
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "POST"),
    line.getByRole("button", { name: "re-shoot digital-nachos now", exact: true }).click(),
  ]);
  expect(response.status()).toBe(422);
  await expect(page.locator('#snapshots li[data-slug="digital-nachos"] .error')).toHaveText("the snapshots worker didn't answer. try again in a minute.");
});
```

In `tests/e2e/snapshots-live.spec.ts`, add after the nightly test:

```ts
test("re-shoot now captures one line again and says it saved", async ({ page }) => {
  await page.goto(`${SNAPS}/admin/`);
  await page.getByRole("button", { name: "re-shoot canberra-events now", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=snapshots(&later=1)?#snapshots$/);
  await expect(page.locator("#snapshots .notice")).toHaveText(/^saved - /);
  await expect(page.locator(status("canberra-events"))).toHaveText(/^captured \d{4}-\d{2}-\d{2}$/);
});

test("a re-shoot that fails says why on its line, and keeps the line as it was", async ({ page }) => {
  await page.goto(`${SNAPS}/admin/`);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "POST"),
    page.getByRole("button", { name: "re-shoot digital-nachos now", exact: true }).click(),
  ]);
  expect(response.status()).toBe(422);
  await expect(page.locator('#snapshots li[data-slug="digital-nachos"] .error')).toHaveText("couldn't capture it: the page returned an error");
  await expect(page.locator(status("digital-nachos"))).toHaveText("the page returned an error · no good capture yet");
});
```

Run: `bun run build:test`, then `pkill -f "port 43"; pkill -f snapshot-site`, then `bun run test:e2e tests/e2e/admin-page.spec.ts tests/e2e/snapshots-live.spec.ts tests/e2e/admin-layout.spec.ts --project=chromium`
Expected: all pass.

- [ ] **Step 5: The whole suite and commit**

Run: `bun run typecheck && bun run test:unit && bun run test:e2e`
Expected: 0 errors; everything passes.

```bash
git add src/lib/admin/actions.ts src/pages/admin/index.astro src/components/admin/SnapshotsAdmin.astro src/styles/admin.css tests/unit/actions.test.ts tests/e2e/admin-page.spec.ts tests/e2e/snapshots-live.spec.ts
git commit -m "feat: re-shoot a line's snapshot from /admin through the snapshots Worker"
```

---

### Task 7: snapshots in the labels

A labelled line with a snapshot gets the hover card (fine pointers only, 90ms intent, growing out of the pill) and, inside its label, the framed snapshot. Images load on the first hover or the first open, never up front: the hover card's picture waits in data attributes until the script loads it, and the frame uses native lazy loading, which the closed drawer's `hidden` attribute defers (browsers ignore lazy loading while scripting is off, so without JavaScript the frames' files come with the page). Plus the label script's follow-ups from plan 1, and local snapshot fixtures so the e2e server shows all this without running the snapshots Worker.

**Files:**
- Create: `scripts/seed-snapshots.mjs`
- Modify: `src/components/ItemLines.astro`, `src/scripts/labels.ts`, `src/scripts/log-toggle.ts`, `src/styles/notebook.css`, `package.json` (script `seed:snapshots`, the `check` script), `.github/workflows/ci.yml`, `tests/e2e/labels.spec.ts`, `tests/e2e/log.spec.ts`, `tests/e2e/snapshots-live.spec.ts`
- Test: `tests/unit/labels.test.ts`

**Interfaces:**
- Consumes: `snapshotVariant` (Task 3); `Label.snapshotKey` (`src/lib/logbook.ts`, plan 1); the beacon's `label_opened` dispatch in `labels.ts` (Task 2).
- Produces:
  - Markup the closer look (Task 8) relies on: `button.frame` with `data-closer-avif` and `data-closer-webp` (the 1920px files) around a `<picture>` whose `img` has the snapshot's alt text; the frame sits in `.wall` inside the drawer
  - `.hovercard` (inside `.peekwrap`, after the pill) with a `<picture>` whose `source` has `data-srcset` and whose `img` has `data-src` until loaded
  - Local fixtures: digital-nachos and canberra-events have snapshots under `snapshots/fixture-<slug>` in the 4331 store; linear-gratis and onestack have none

- [ ] **Step 1: Local snapshot fixtures**

Create `scripts/seed-snapshots.mjs`:

```js
// Local only: gives two labelled lines a snapshot, so the e2e server (4331) shows hover cards, framed snapshots and the
// closer look without running the snapshots Worker. Production snapshots come from the Worker (spec 9).
//   bun run seed:snapshots --local
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

if (!process.argv.includes("--local")) {
  console.error("usage: bun run seed:snapshots --local (fixtures never go to production)");
  process.exit(1);
}
const WHERE = ["--local", "--persist-to", ".wrangler/state"];
const LINES = [
  ["digital-nachos", "#c94a31"],
  ["canberra-events", "#2f5d8a"],
];
const dir = mkdtempSync(join(tmpdir(), "snapshots-"));
for (const [slug, colour] of LINES) {
  const base = `snapshots/fixture-${slug}`;
  const blocks = Array.from({ length: 24 }, (_, i) => `<rect x="${160 + (i % 6) * 420}" y="${520 + Math.floor(i / 6) * 300}" width="360" height="240" rx="18" fill="${colour}" opacity="${0.35 + (i % 4) * 0.15}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2880" height="1800"><rect width="100%" height="100%" fill="#f6f4ee"/><text x="160" y="360" font-family="Helvetica" font-size="150" fill="#1f201c">${slug}</text>${blocks}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  for (const width of [480, 960, 1920]) {
    for (const format of ["avif", "webp"]) {
      const file = join(dir, `${slug}-${width}.${format}`);
      await sharp(png).resize({ width }).toFormat(format).toFile(file);
      execFileSync("wrangler", ["r2", "object", "put", `curiousgeorge-media/${base}-${width}.${format}`, "--file", file, "--content-type", `image/${format}`, ...WHERE], { stdio: "inherit" });
    }
  }
  // Local test data, not a migration (migrations only go through `wrangler d1 migrations apply`)
  execFileSync("wrangler", ["d1", "execute", "curiousgeorge-logbook", ...WHERE, "--command", `UPDATE items SET snapshot_key = '${base}', snapshot_at = '2026-10-04T17:00:00.000Z', snapshot_status = 'ok' WHERE slug = '${slug}'`], { stdio: "inherit" });
}
rmSync(dir, { recursive: true, force: true });
```

In `package.json`, add `"seed:snapshots": "node scripts/seed-snapshots.mjs",` after `"seed:media"`, and in `"check"` add `&& bun run seed:snapshots --local` after `bun run seed:media --local`. In `.github/workflows/ci.yml`'s `check` job, add `- run: bun run seed:snapshots --local` after `- run: bun run seed:media --local`.

Run: `bun run db:migrate:local && bun run seed:media --local && bun run seed:snapshots --local`
Expected: twelve `r2 object put` lines and two `d1 execute` results, all succeeding.

- [ ] **Step 2: Write the failing tests**

In `tests/unit/labels.test.ts`, give the first fixture item a snapshot (`snapshotKey: "snapshots/fixture-canberra-events"` in its label) and add:

```ts
test("a line with a snapshot gets a hover card that waits to load, and a framed, lazy snapshot in its label", async () => {
  const doc = await render(ItemLines, { items });
  const item = doc.querySelector('[data-slug="canberra-events"]')!;
  const card = item.querySelector(".peekwrap > .hovercard")!;
  expect(card.getAttribute("aria-hidden")).toBe("true");
  expect(card.querySelector("source")!.getAttribute("data-srcset")).toBe("/media/snapshots/fixture-canberra-events-480.avif");
  expect(card.querySelector("source")!.hasAttribute("srcset")).toBe(false);
  expect(card.querySelector("img")!.getAttribute("data-src")).toBe("/media/snapshots/fixture-canberra-events-480.webp");
  expect(card.querySelector("img")!.hasAttribute("src")).toBe(false);
  expect(text(card.querySelector(".cap"))).toBe("click for the label");
  const frame = item.querySelector(".drawer .wall.framed > button.frame")!;
  expect(frame.getAttribute("aria-label")).toBe("look closer at canberra.events");
  expect(frame.getAttribute("data-closer-avif")).toBe("/media/snapshots/fixture-canberra-events-1920.avif");
  expect(frame.getAttribute("data-closer-webp")).toBe("/media/snapshots/fixture-canberra-events-1920.webp");
  expect(frame.querySelector("source")!.getAttribute("srcset")).toBe(
    "/media/snapshots/fixture-canberra-events-480.avif 480w, /media/snapshots/fixture-canberra-events-960.avif 960w",
  );
  const img = frame.querySelector("img")!;
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("src")).toBe("/media/snapshots/fixture-canberra-events-480.webp");
  expect(img.getAttribute("alt")).toBe("a snapshot of canberra.events");
});

test("a line without a snapshot has no hover card and no frame", async () => {
  const doc = await render(ItemLines, { items });
  const item = doc.querySelector('[data-slug="onestack"]')!;
  expect(item.querySelector(".hovercard")).toBeNull();
  expect(item.querySelector(".frame")).toBeNull();
  expect(item.querySelector(".wall")!.classList.contains("framed")).toBe(false);
});
```

In `tests/e2e/labels.spec.ts`, add (the 4331 store has fixture snapshots for digital-nachos and canberra-events, none for linear-gratis):

```ts
const SNAPSHOT = /\/media\/snapshots\//;

test("no snapshot is fetched before a label is hovered or opened", async ({ page }) => {
  const fetched: string[] = [];
  page.on("request", (request) => {
    if (SNAPSHOT.test(request.url())) fetched.push(request.url());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(fetched).toEqual([]);
});

test("hovering a labelled line grows its snapshot out of the pill; it goes when the label opens", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover on a phone");
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  const card = item.locator(".hovercard");
  const [request] = await Promise.all([page.waitForRequest(SNAPSHOT), item.locator(".aside").hover()]);
  expect(request.url()).toMatch(/fixture-canberra-events-480\.(avif|webp)$/);
  await expect(card).toHaveCSS("opacity", "1");
  await item.locator(".aside").click();
  await expect(card).toHaveCSS("opacity", "0");
});

test("a phone shows no hover card", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phones only");
  await page.goto("/");
  await expect(page.locator('[data-slug="canberra-events"] .hovercard')).toBeHidden();
});

test("a line without a snapshot has no hover card, and its label no frame", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="linear-gratis"]');
  await expect(item.locator(".hovercard")).toHaveCount(0);
  await item.locator(".peek").click();
  await expect(item.locator(".made")).toBeVisible();
  await expect(item.locator(".frame")).toHaveCount(0);
});

test("opening a label fetches its framed snapshot, and the drawer really opens", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  await expect.poll(() => item.locator(".frame img").evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect.poll(() => item.locator(".drawer").evaluate((drawer) => drawer.getBoundingClientRect().height)).toBeGreaterThan(100);
});

test("a snapshot that won't load leaves the label without its frame", async ({ page }) => {
  await page.route(SNAPSHOT, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".wall")).toHaveClass(/\bno-shot\b/);
  await expect(item.locator(".frame")).toBeHidden();
  await expect(item.locator(".made")).toBeVisible();
});

test("closing, reopening and closing quickly lets the last close finish its animation", async ({ page }) => {
  await page.goto("/");
  const hiddenAfter = await page.locator('[data-slug="canberra-events"]').evaluate(async (item) => {
    const line = item.querySelector<HTMLElement>(".line")!;
    const drawer = item.querySelector<HTMLElement>(".drawer")!;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    line.click();
    await wait(400);
    line.click();
    await wait(100);
    line.click();
    await wait(100);
    line.click();
    const closedAt = performance.now();
    await new Promise<void>((resolve) =>
      new MutationObserver((_records, observer) => {
        if (drawer.hasAttribute("hidden")) {
          observer.disconnect();
          resolve();
        }
      }).observe(drawer, { attributes: true }),
    );
    return performance.now() - closedAt;
  });
  // The first close's timer used to hide the drawer about 120ms into the last close's 320ms animation
  expect(hiddenAfter).toBeGreaterThanOrEqual(290);
});

test("find-in-page opens a label at once", async ({ page }) => {
  await page.goto("/");
  const opened = await page.locator('[data-slug="canberra-events"]').evaluate((item) => {
    item.querySelector(".drawer")!.dispatchEvent(new Event("beforematch"));
    return item.classList.contains("open") && item.querySelector(".peek")!.getAttribute("aria-expanded") === "true";
  });
  expect(opened).toBe(true);
});

test.describe("snapshots without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  // Browsers ignore loading="lazy" while scripting is off (an anti-tracking rule in the HTML spec), so without
  // JavaScript the frames' files come with the page; the hover cards' and the closer look's never do
  test("only the frames' snapshots are fetched, and find-in-page opens a label to show its frame", async ({ page }) => {
    const fetched: string[] = [];
    page.on("request", (request) => {
      if (SNAPSHOT.test(request.url())) fetched.push(request.url());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((url) => /fixture-(digital-nachos|canberra-events)-(480|960)\.avif$/.test(url))).toBe(true);
    // What find-in-page does to a match inside hidden="until-found"
    await page.locator("#label-digital-nachos").evaluate((drawer) => drawer.removeAttribute("hidden"));
    await expect.poll(() => page.locator("#label-digital-nachos").evaluate((drawer) => drawer.getBoundingClientRect().height)).toBeGreaterThan(100);
  });
});

test("the hover cards never scroll the page sideways", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover cards on a phone");
  for (const width of [800, 820, 840]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test("selecting a line's text doesn't toggle its label", async ({ page, isMobile }) => {
  test.skip(isMobile, "a mouse selection");
  await page.goto("/");
  const aside = page.locator('[data-slug="canberra-events"] .aside');
  const box = (await aside.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-slug="canberra-events"] .peek')).toHaveAttribute("aria-expanded", "false");
});
```

In `tests/e2e/log.spec.ts`, add the same quick close, reopen and close check for the log toggle:

```ts
test("closing, reopening and closing quickly lets the last close finish its animation", async ({ page }) => {
  await page.goto("/");
  const hiddenAfter = await page.locator("#log").evaluate(async (log) => {
    const more = log.querySelector<HTMLButtonElement>(".more")!;
    const older = log.querySelector<HTMLElement>(".older")!;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    more.click();
    await wait(400);
    more.click();
    await wait(100);
    more.click();
    await wait(100);
    more.click();
    const closedAt = performance.now();
    await new Promise<void>((resolve) =>
      new MutationObserver((_records, observer) => {
        if (older.hasAttribute("hidden")) {
          observer.disconnect();
          resolve();
        }
      }).observe(older, { attributes: true }),
    );
    return performance.now() - closedAt;
  });
  expect(hiddenAfter).toBeGreaterThanOrEqual(270);
});
```

Run: `bun run test:unit tests/unit/labels.test.ts`
Expected: FAIL, no `.hovercard` or `.frame` in the markup.

- [ ] **Step 3: The markup**

Replace `src/components/ItemLines.astro` with:

```astro
---
import Inline from "./Inline.astro";
import { primaryName } from "../lib/text";
import { snapshotVariant, type SnapshotFormat, type SnapshotWidth } from "../lib/snapshots";
import type { Item } from "../lib/logbook";
interface Props {
  items: Item[];
}
const { items } = Astro.props;
// Snapshots (spec 4.1). The hover card's picture waits in data attributes until the first hover or focus on a fine
// pointer (src/scripts/labels.ts). The frame's is lazy inside a hidden drawer, so it loads
// only when the label opens (browsers ignore lazy loading without JavaScript, so then it comes with the page).
const file = (base: string, width: SnapshotWidth, format: SnapshotFormat) => `/media/${snapshotVariant(base, width, format)}`;
const FRAME_SIZES = "(max-width: 680px) 320px, 240px";
---
<ul class="lines">
  {items.map((item) => {
    const name = primaryName(item.text);
    const shot = item.label?.snapshotKey ?? null;
    return (
      <li class:list={["line-item", { labelled: item.label }]} data-slug={item.slug}>
        <div class="line">
          <Inline source={item.text} />{item.aside && <span class="aside"> - {item.aside}</span>}
          {item.label && (
            <span class="peekwrap">
              <button class="peek" type="button" aria-expanded="false" aria-controls={`label-${item.slug}`} aria-label={`label for ${name}`}>
                <span class="plus" aria-hidden="true"></span>label
              </button>
              {shot && (
                <span class="hovercard" aria-hidden="true">
                  <picture>
                    <source type="image/avif" data-srcset={file(shot, 480, "avif")} />
                    <img data-src={file(shot, 480, "webp")} alt="" width="218" height="136" decoding="async" />
                  </picture>
                  <span class="cap">click for the label</span>
                </span>
              )}
            </span>
          )}
        </div>
        {item.label && (
          <div class="drawer" id={`label-${item.slug}`} hidden="until-found">
            <div class="drawer-inner">
              <div class:list={["wall", { framed: shot }]}>
                {shot && (
                  <button class="frame" type="button" aria-label={`look closer at ${name}`} data-closer-avif={file(shot, 1920, "avif")} data-closer-webp={file(shot, 1920, "webp")}>
                    <picture>
                      <source type="image/avif" srcset={`${file(shot, 480, "avif")} 480w, ${file(shot, 960, "avif")} 960w`} sizes={FRAME_SIZES} />
                      <img
                        src={file(shot, 480, "webp")}
                        srcset={`${file(shot, 480, "webp")} 480w, ${file(shot, 960, "webp")} 960w`}
                        sizes={FRAME_SIZES}
                        alt={`a snapshot of ${name}`}
                        width="1440"
                        height="900"
                        loading="lazy"
                        decoding="async"
                      />
                    </picture>
                  </button>
                )}
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
          </div>
        )}
      </li>
    );
  })}
</ul>
<script>
  import "../scripts/labels";
</script>
```

(The pill's markup and its accessible name are unchanged; the existing label unit tests keep passing.)

Run: `bun run test:unit tests/unit/labels.test.ts`
Expected: PASS.

- [ ] **Step 4: The styles**

In `src/styles/notebook.css`, in the `.peek` rule, remove `margin-left: 10px; vertical-align: 1px; ` (the wrapper takes them) and add before it:

```css
.peekwrap { position: relative; display: inline-block; margin-left: 10px; vertical-align: 1px; }
```

Add after the `.peek` rules (before `.drawer`):

```css
/* The hover card: the snapshot grows out of the pill on fine pointers, after a 90ms intent delay (spec 4.1) */
.hovercard {
  position: absolute; left: 50%; bottom: calc(100% + 10px); z-index: 5; width: 232px; padding: 7px 7px 8px; pointer-events: none;
  background: var(--mat); box-shadow: 0 0 0 1px rgba(0, 0, 0, .06), 0 2px 4px rgba(0, 0, 0, .05), 0 18px 34px -14px rgba(0, 0, 0, .32);
  opacity: 0; transform: translateX(-50%) translateY(6px) scale(.94); transform-origin: 50% 100%;
  transition: opacity 140ms ease, transform 200ms var(--ease-out);
}
.hovercard img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 10; object-fit: cover; object-position: top left; background: #ecebe5; box-shadow: 0 0 0 1px rgba(0, 0, 0, .07); }
.hovercard .cap { display: block; margin-top: 6px; font: 11px/1.4 var(--mono); color: var(--muted); text-align: center; }
@media (hover: hover) and (pointer: fine) {
  .line-item:not(.open) > .line:hover .hovercard.ready,
  .line-item:not(.open) .peek:focus-visible + .hovercard.ready { opacity: 1; transform: translateX(-50%); transition-delay: 90ms; }
}
@media (hover: none), (pointer: coarse) { .hovercard { display: none; } }

/* The label's wall: the framed snapshot beside the tag; without a snapshot, or when it won't load, just the tag */
.wall.framed { display: grid; grid-template-columns: 240px 1fr; gap: 24px; align-items: start; padding-top: 16px; }
.wall.framed:not(.no-shot) > .tag { padding-top: 0; }
.wall.no-shot { display: block; padding-top: 0; }
.wall.no-shot .frame { display: none; }
.frame {
  display: block; width: 100%; padding: 12px; border: 0; background: var(--mat); cursor: zoom-in;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .05), 0 1px 2px rgba(0, 0, 0, .04), 0 14px 28px -16px rgba(0, 0, 0, .28);
}
.frame img { display: block; width: 100%; height: auto; box-shadow: 0 0 0 1px rgba(0, 0, 0, .08); }
.frame:focus-visible { outline: 1.5px solid var(--ink); outline-offset: -6px; } /* inside the mat: the drawer clips anything outside */
@media (hover: hover) and (pointer: fine) {
  .frame { transition: box-shadow 200ms ease; }
  .frame:hover { box-shadow: 0 0 0 1px rgba(0, 0, 0, .06), 0 2px 3px rgba(0, 0, 0, .05), 0 20px 36px -16px rgba(0, 0, 0, .34); }
}
```

After `.log.open .older { grid-template-rows: 1fr; }`, add (a drawer revealed by find-in-page without JavaScript otherwise stays 0px tall, a plan 1 bug):

```css
/* Without JavaScript nothing adds .open, so whatever find-in-page reveals opens by itself */
@media (scripting: none) {
  .drawer:not([hidden]), .log .older:not([hidden]) { grid-template-rows: 1fr; }
}
```

After the `.book` rule, add (the hover card is laid out, unseen, at rest, and would otherwise scroll a narrow window sideways):

```css
/* A hover card near the window's edge is cut there rather than scrolling the page sideways */
.book { overflow-x: clip; }
```

Inside the existing `@media (max-width: 680px)` block, add:

```css
  .wall.framed { grid-template-columns: 1fr; gap: 14px; }
  .frame { max-width: 320px; }
```

and in the existing `@media (prefers-reduced-motion: reduce)` block, add `.hovercard { transform: translateX(-50%); transition: opacity 140ms ease; }`.

- [ ] **Step 5: The label script**

Replace `src/scripts/labels.ts` with:

```ts
import type { TrackDetail } from "../lib/track";

// Wall labels open in place. Closed drawers stay hidden="until-found", so find-in-page can still reach them and a
// label's lazy snapshot isn't fetched until it opens. The pill's aria-expanded is the state (the .open class lags a
// frame behind for the animation).
const CLOSE_MS = 320;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
// Each label's pending hide, so a close still animating can't hide a label opened again since
const closing = new WeakMap<HTMLElement, number>();

function isOpen(item: HTMLElement) {
  return item.querySelector(".peek")?.getAttribute("aria-expanded") === "true";
}

// Queued a frame later for the animation; skipped if the label was closed again in the meantime
function showOpen(item: HTMLElement) {
  requestAnimationFrame(() => {
    if (isOpen(item)) item.classList.add("open");
  });
}

function setOpen(item: HTMLElement, open: boolean) {
  const pill = item.querySelector<HTMLButtonElement>(".peek");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  if (!pill || !drawer) return;
  window.clearTimeout(closing.get(item));
  pill.setAttribute("aria-expanded", String(open));
  if (open) {
    drawer.removeAttribute("hidden");
    showOpen(item);
    return;
  }
  item.classList.remove("open");
  closing.set(
    item,
    window.setTimeout(() => {
      if (pill.getAttribute("aria-expanded") === "false") drawer.setAttribute("hidden", "until-found");
    }, reduced() ? 0 : CLOSE_MS),
  );
}

// The hover card's picture is named in data attributes until the first hover or focus, on fine pointers only (spec 4.1)
function loadCard(item: HTMLElement) {
  if (!finePointer()) return;
  for (const element of item.querySelectorAll<HTMLElement>(".hovercard [data-srcset], .hovercard [data-src]")) {
    if (element.dataset.srcset) element.setAttribute("srcset", element.dataset.srcset);
    if (element.dataset.src) element.setAttribute("src", element.dataset.src);
    delete element.dataset.srcset;
    delete element.dataset.src;
  }
  // Shown only from here on: without this script the card would be blank, and its "click for the label" untrue
  item.querySelector(".hovercard")?.classList.add("ready");
}

document.querySelectorAll<HTMLElement>(".line-item.labelled").forEach((item) => {
  const line = item.querySelector<HTMLElement>(".line");
  const drawer = item.querySelector<HTMLElement>(".drawer");
  const pill = item.querySelector<HTMLButtonElement>(".peek");
  if (!line || !drawer || !pill) return;
  line.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) return; // links still navigate
    // The end of a text selection in this line, not a toggle. The pill always toggles: a click on a button leaves a
    // selection elsewhere on the page in place
    const selection = window.getSelection();
    if (!(event.target as HTMLElement).closest(".peek") && selection && !selection.isCollapsed && selection.containsNode(line, true)) return;
    setOpen(item, !isOpen(item));
    if (isOpen(item) && item.dataset.slug) {
      document.dispatchEvent(new CustomEvent<TrackDetail>("logbook:track", { detail: { event: "label_opened", properties: { slug: item.dataset.slug } } }));
    }
  });
  line.addEventListener("pointerenter", () => loadCard(item));
  pill.addEventListener("focus", () => loadCard(item));
  // A snapshot that won't load: the label shows just its tag (spec 4.1), and the hover card goes
  item.querySelector(".frame img")?.addEventListener("error", () => item.querySelector(".wall")?.classList.add("no-shot"));
  item.querySelector(".hovercard img")?.addEventListener("error", () => item.querySelector(".hovercard")?.remove());
  // Find-in-page revealed a closed label: reflect it as open at once, so the match shows straight away
  drawer.addEventListener("beforematch", () => {
    window.clearTimeout(closing.get(item));
    pill.setAttribute("aria-expanded", "true");
    item.classList.add("open");
  });
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen(item)) return;
    setOpen(item, false);
    pill.focus();
  });
});
```

In `src/scripts/log-toggle.ts`, keep the pending hide and clear it in `setOpen`: add `let closing = 0;` after the `older` constant, add `window.clearTimeout(closing);` as the first line inside `setOpen` (after the guard), and change the last line of `setOpen` to:

```ts
  closing = window.setTimeout(() => { if (button.getAttribute("aria-expanded") === "false") older.setAttribute("hidden", "until-found"); }, reduced() ? 0 : CLOSE_MS);
```

- [ ] **Step 6: The live pipeline's files**

In `tests/e2e/snapshots-live.spec.ts`, add after the nightly test:

```ts
test("the logbook names the new capture, and its six files are within budget", async ({ page, request }) => {
  await page.goto(`${SNAPS}/?fresh=${Date.now()}`);
  const src = await page.locator('[data-slug="canberra-events"] .hovercard img').getAttribute("data-src");
  expect(src).toMatch(/^\/media\/snapshots\/canberra-events-[0-9a-hjkmnp-tv-z]{26}-480\.webp$/);
  const files: [string, string, number][] = [
    ["480", "avif", 30 * 1024],
    ["480", "webp", 30 * 1024],
    ["960", "avif", 70 * 1024],
    ["960", "webp", 70 * 1024],
    ["1920", "avif", Infinity],
    ["1920", "webp", Infinity],
  ];
  for (const [width, format, budget] of files) {
    const response = await request.get(`${SNAPS}${src!.replace("-480.webp", `-${width}.${format}`)}`);
    expect(response.status(), `${width}.${format}`).toBe(200);
    expect(response.headers()["content-type"]).toBe(`image/${format}`);
    expect((await response.body()).length, `${width}.${format}`).toBeLessThan(budget);
  }
});
```

- [ ] **Step 7: Run everything and commit**

Run: `bun run typecheck && bun run test:unit && bun run build:test`, then `pkill -f "port 43"; pkill -f snapshot-site`, then `bun run test:e2e tests/e2e/labels.spec.ts tests/e2e/log.spec.ts tests/e2e/snapshots-live.spec.ts tests/e2e/budgets.spec.ts`, then the whole suite with `bun run test:e2e`.
Expected: 0 errors; everything passes in every project (the hover checks skip on the phone, the phone check skips on desktops).

```bash
git add scripts/seed-snapshots.mjs package.json .github/workflows/ci.yml src/components/ItemLines.astro src/scripts/labels.ts src/scripts/log-toggle.ts src/styles/notebook.css tests/unit/labels.test.ts tests/e2e/labels.spec.ts tests/e2e/log.spec.ts tests/e2e/snapshots-live.spec.ts
git commit -m "feat: snapshots in the labels, a hover card on fine pointers, images only on first hover or open"
```

---

### Task 8: the closer look

Clicking a framed snapshot opens it as a modal dialog: the image grows from its frame to fit the viewport (FLIP, 420ms ease-out-quint) over a paper veil, and focus moves into the dialog. A click, the close button or Esc returns it to its frame (300ms ease-out) and focus to the frame; the next Esc closes the label. No movement under reduced motion.

**Files:**
- Create: `src/components/CloserLook.astro`, `src/scripts/closer.ts`
- Modify: `src/components/Logbook.astro`, `src/styles/notebook.css`, `tests/e2e/labels.spec.ts`
- Test: `tests/unit/logbook-page.test.ts`

**Interfaces:**
- Consumes: `button.frame` with `data-closer-avif` and `data-closer-webp` around a `picture > img` (Task 7); the label's Esc handler (Task 7).
- Produces: one `dialog.closer` per page (only when some line has a snapshot), with `button.closer-close` and a `picture` (`source` then `img`)

- [ ] **Step 1: Write the failing tests**

In `tests/unit/logbook-page.test.ts`, add:

```ts
test("the closer look is in the page only when some line has a snapshot", async () => {
  expect((await render(Logbook, { data: full })).querySelector("dialog.closer")).toBeNull();
  const shot = { ...full, now: [{ ...full.now[0], label: { era: "", status: "live" as const, madeOf: null, text: null, kind: null, note: null, snapshotKey: "snapshots/fixture-x" } }] };
  const dialog = (await render(Logbook, { data: shot })).querySelector("dialog.closer")!;
  expect(dialog.querySelector("button.closer-close")!.hasAttribute("autofocus")).toBe(true);
  expect(text(dialog.querySelector("button.closer-close"))).toBe("close");
  expect(dialog.querySelector("picture > source[type='image/avif'] + img")).not.toBeNull();
});
```

In `tests/e2e/labels.spec.ts`, add:

```ts
test("a snapshot opens a closer look; Esc returns it to its frame, then closes the label", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  const frame = item.locator(".frame");
  await expect(frame.locator("img")).toBeVisible();
  await frame.click();
  const dialog = page.locator("dialog.closer");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog.locator(".closer-close")).toBeFocused();
  await expect(dialog.locator("img")).toHaveAttribute("src", /fixture-digital-nachos-1920\.webp$/);
  await expect(dialog).toHaveAccessibleName("closer look: a snapshot of digital nachos");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(frame).toBeFocused();
  await expect(frame.locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(item.locator(".peek")).toHaveAttribute("aria-expanded", "false");
  await expect(item.locator(".peek")).toBeFocused();
});

test("a click anywhere in the closer look, or its close button, puts the snapshot back", async ({ page }) => {
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  const dialog = page.locator("dialog.closer");
  for (const close of [() => dialog.locator("img").click(), () => dialog.locator(".closer-close").click()]) {
    await item.locator(".frame").click();
    await expect(dialog).toHaveAttribute("open", "");
    await close();
    await expect(dialog).not.toHaveAttribute("open", "");
    await expect(item.locator(".frame")).toBeFocused();
  }
});

test("with reduced motion the closer look opens and closes without moving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const item = page.locator('[data-slug="canberra-events"]');
  await item.locator(".peek").click();
  await item.locator(".frame").click();
  const img = page.locator("dialog.closer img");
  await expect(page.locator("dialog.closer")).toHaveAttribute("open", "");
  expect(await img.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.closer")).not.toHaveAttribute("open", "");
});
```

Run: `bun run test:unit tests/unit/logbook-page.test.ts`
Expected: FAIL, no `dialog.closer`.

- [ ] **Step 2: The dialog and its script**

Create `src/components/CloserLook.astro`:

```astro
---
// The closer look (spec 4.1): one modal dialog for the page; src/scripts/closer.ts fills it from the frame clicked
---
<dialog class="closer">
  <button class="closer-close" type="button" autofocus>close</button>
  <picture>
    <source type="image/avif" />
    <img alt="" decoding="async" />
  </picture>
</dialog>
<script>
  import "../scripts/closer";
</script>
```

Create `src/scripts/closer.ts`:

```ts
// The closer look (spec 4.1): a framed snapshot grows from its frame to fit the viewport over a paper veil (FLIP,
// 420ms ease-out-quint), and goes back into its frame (300ms ease-out) on a click, the close button or Esc. The dialog
// is modal, so focus moves into it, and returns to the frame. Nothing moves under reduced motion.
const dialog = document.querySelector<HTMLDialogElement>("dialog.closer");
const big = dialog?.querySelector("img");
const source = dialog?.querySelector("source");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// The transform that puts `to` where `from` is
const flip = (from: DOMRect, to: DOMRect) => `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
let frame: HTMLButtonElement | null = null;
let closing = false;

async function open(button: HTMLButtonElement) {
  if (!dialog || !big || !source || dialog.open) return;
  const shot = button.querySelector("img");
  if (!shot) return;
  frame = button;
  source.srcset = button.dataset.closerAvif ?? "";
  big.src = button.dataset.closerWebp ?? "";
  big.alt = shot.alt;
  dialog.setAttribute("aria-label", `closer look: ${shot.alt}`);
  await big.decode().catch(() => {}); // a big file that won't decode still opens, as the browser draws it
  dialog.showModal();
  dialog.classList.add("on");
  const from = shot.getBoundingClientRect();
  shot.style.visibility = "hidden";
  if (reduced()) return;
  big.style.transition = "none";
  big.style.transform = flip(from, big.getBoundingClientRect());
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      big.style.transition = "transform 420ms var(--ease-out-quint)";
      big.style.transform = "none";
    }),
  );
}

function close() {
  if (!dialog?.open || !big || !frame || closing) return;
  const button = frame;
  const shot = button.querySelector("img");
  closing = true;
  dialog.classList.remove("on");
  const done = () => {
    dialog.close();
    if (shot) shot.style.visibility = "";
    big.style.transition = "none";
    big.style.transform = "";
    big.removeAttribute("src");
    source?.removeAttribute("srcset");
    closing = false;
    frame = null;
    button.focus();
  };
  if (reduced() || !shot) return done();
  big.style.transition = "transform 300ms var(--ease-out)";
  big.style.transform = flip(shot.getBoundingClientRect(), big.getBoundingClientRect());
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };
  big.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, 400); // in case the transition never ends (a tab in the background)
}

if (dialog) {
  document.querySelectorAll<HTMLButtonElement>("button.frame").forEach((button) => button.addEventListener("click", () => void open(button)));
  dialog.addEventListener("click", close); // the veil, the image and the close button all put it back
  // Esc closes the closer look first; the label's own Esc handler only hears the next one, once focus is back in it
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
}
```

In `src/components/Logbook.astro`, import it (`import CloserLook from "./CloserLook.astro";`) and add after `</main>`, before the beacon script:

```astro
{data && [...data.now, ...data.before].some((item) => item.label?.snapshotKey) && <CloserLook />}
```

Append to `src/styles/notebook.css` (before the `@media (max-width: 680px)` block):

```css
/* The closer look: a modal dialog over a paper veil; the image grows from its frame and goes back (spec 4.1) */
.closer {
  position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0;
  padding: 6vh 6vw; border: 0; background: transparent; color: var(--ink); place-items: center; cursor: zoom-out; overflow: hidden;
}
.closer[open] { display: grid; }
.closer::backdrop { background: transparent; }
.closer::before { content: ""; position: fixed; inset: 0; background: rgba(243, 242, 236, .96); opacity: 0; transition: opacity 260ms ease; }
.closer.on::before { opacity: 1; }
.closer picture { position: relative; display: block; max-width: 100%; max-height: 100%; }
.closer img {
  display: block; max-width: 100%; max-height: 88vh; width: auto; height: auto; transform-origin: 0 0;
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, .4), 0 0 0 1px rgba(0, 0, 0, .08);
}
.closer-close {
  position: fixed; top: 16px; right: 16px; z-index: 1; min-height: 44px; padding: 0 14px; cursor: pointer;
  font: 12.5px/1 var(--mono); color: var(--ink); background: var(--mat); border: 1px solid var(--rule); border-radius: 999px;
}
html:has(.closer[open]) { overflow: hidden; }
```

and in the `@media (prefers-reduced-motion: reduce)` block add `.closer::before { transition: none; }`.

Run: `bun run test:unit tests/unit/logbook-page.test.ts`
Expected: PASS.

- [ ] **Step 3: Run everything and commit**

Run: `bun run typecheck && bun run test:unit && bun run build:test`, then `pkill -f "port 43"; pkill -f snapshot-site`, then `bun run test:e2e tests/e2e/labels.spec.ts tests/e2e/budgets.spec.ts tests/e2e/privacy.spec.ts`, then the whole suite with `bun run test:e2e`.
Expected: 0 errors; everything passes in every project. Check the budgets spec still has the JavaScript before any interaction under 10KB with the closer look's script added; it should be inline like the label script.

```bash
git add src/components/CloserLook.astro src/scripts/closer.ts src/components/Logbook.astro src/styles/notebook.css tests/unit/logbook-page.test.ts tests/e2e/labels.spec.ts
git commit -m "feat: the closer look, a snapshot grown from its frame in a modal dialog"
```

---

### Task 9: performance checks

Spec 11's interaction and layout budgets checked on every run, Lighthouse measured against the live site after each deploy, a month's caching for the fonts with `nosniff` on every static file, and the scene's shadow map redrawn only when something casting a shadow may have moved.

**Files:**
- Create: `tests/e2e/perf.spec.ts`, `scripts/lighthouse.mjs`, `public/_headers`
- Modify: `src/deck/scene/loop.ts`, `package.json` (script `lighthouse`), `.github/workflows/ci.yml`
- Test: `tests/unit/loop.test.ts`

**Interfaces:**
- Consumes: the closer look (Task 8) and the labels (Task 7) as interactions to measure.
- Produces: `bun run lighthouse [url] [--strict]` (median of five mobile runs; warnings over budget, a failure only with `--strict`)

- [ ] **Step 1: Write the failing tests**

Create `tests/e2e/perf.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

// Spec 11 on every run: interaction to next paint under 200ms at 4× CPU and layout shift under 0.01 at phone width.
// INP comes from the Event Timing API (an interaction's latency is its longest event entry), because Lighthouse's
// navigation mode doesn't report it. LCP is Lighthouse's, against the live site after each deploy (scripts/lighthouse.mjs).
test.skip(({ browserName }) => browserName !== "chromium", "CPU throttling and Event Timing through CDP: Chromium only");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "measured locally");

async function throttled(page: Page) {
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => {
    const store = window as unknown as { latencies: Map<number, number> };
    store.latencies = new Map();
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { interactionId?: number })[]) {
        if (entry.interactionId) store.latencies.set(entry.interactionId, Math.max(store.latencies.get(entry.interactionId) ?? 0, entry.duration));
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(500); // let the page settle at the new speed
}

/** The slowest interaction so far, once its entries have arrived (after the next paint) */
const slowest = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return Math.max(0, ...(window as unknown as { latencies: Map<number, number> }).latencies.values());
  });

test("opening a label responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  await page.locator('[data-slug="canberra-events"] .peek').click();
  expect(await slowest(page)).toBeLessThan(200);
});

test("showing older log entries responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  await page.locator("#log .more").click();
  expect(await slowest(page)).toBeLessThan(200);
});

// Reported, not gated: the first press builds the deck's AudioContext (plan 2 code), about 150 to 185ms at 4× CPU
// here and more on CI's runners. The plan 4 follow-ups move that work out of the press, then this becomes a gate.
test("pressing play: its interaction latency is reported", async ({ page }) => {
  await throttled(page);
  await page.locator(".tracks button").first().click();
  test.info().annotations.push({ type: "inp", description: `pressing play: ${await slowest(page)}ms at 4× CPU` });
});

test("opening the closer look responds within 200ms at 4× CPU", async ({ page }) => {
  await throttled(page);
  const item = page.locator('[data-slug="digital-nachos"]');
  await item.locator(".peek").click();
  await expect(item.locator(".frame img")).toBeVisible();
  await item.locator(".frame").click();
  await expect(page.locator("dialog.closer")).toHaveAttribute("open", "");
  expect(await slowest(page)).toBeLessThan(200);
});

test("nothing shifts while the page settles at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 1500);
      }),
  );
  expect(cls).toBeLessThan(0.01);
});

test("fonts are cached for a month, and static files are never sniffed", async ({ request }) => {
  const font = await request.get("/fonts/dm-mono.woff2");
  expect(font.headers()["cache-control"]).toBe("public, max-age=2592000");
  expect(font.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await request.get("/favicon.ico")).headers()["x-content-type-options"]).toBe("nosniff");
});
```

Create `tests/unit/loop.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createLoop } from "../../src/deck/scene/loop";

// A renderer that records, for each frame drawn, whether the shadow map was to be redrawn
function setup() {
  const shadows: boolean[] = [];
  const renderer = {
    shadowMap: { autoUpdate: true, needsUpdate: false },
    render: vi.fn(() => {
      shadows.push(renderer.shadowMap.needsUpdate);
    }),
  };
  const stage = {
    scene: {},
    camera: {},
    platter: { rotation: { y: 0 } },
    candle: { light: { intensity: 1 }, flame: { scale: { set: () => {} }, rotation: { z: 0 } }, intensity: 1 },
  };
  let tweening = false;
  const loop = createLoop({ renderer: renderer as never, stage: stage as never, tweens: { step: () => tweening } as never, reduce: true, onFrame: () => {} });
  return { loop, renderer, shadows, tween: (on: boolean) => void (tweening = on) };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Frames on the faked clock, so spinning-only frames come due at 30 a second as they would in a browser
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the shadow map is redrawn for a frame asked for and while tweens run, not while the platter only spins", async () => {
  const { loop, renderer, shadows, tween } = setup();
  expect(renderer.shadowMap.autoUpdate).toBe(false);
  loop.setVisible(true);
  await vi.advanceTimersByTimeAsync(20);
  expect(shadows).toEqual([true]);

  loop.spinTo(5);
  await vi.advanceTimersByTimeAsync(1000);
  expect(shadows[1]).toBe(true); // the frame the spin asked for
  expect(shadows.slice(2).length).toBeGreaterThan(5);
  expect(shadows.slice(2).every((redrawn) => redrawn === false)).toBe(true);

  const before = shadows.length;
  tween(true);
  loop.invalidate();
  await vi.advanceTimersByTimeAsync(200);
  expect(shadows.slice(before).every((redrawn) => redrawn === true)).toBe(true);
  loop.stop();
});
```

Run: `bun run test:unit tests/unit/loop.test.ts`
Expected: FAIL: `autoUpdate` is still true.

- [ ] **Step 2: The shadow map, the headers and the Lighthouse script**

In `src/deck/scene/loop.ts`, in `createLoop`, after `let frames = 0;`, add:

```ts
  // The shadow map is redrawn only when something casting a shadow may have moved: a tween, or a frame asked for.
  // Spinning, scratching and the candle's flicker change nothing a shadow shows (the record's shadow is a disc), so the
  // 2048 map isn't redrawn 30 times a second for a whole track (plan 2 follow-up).
  renderer.shadowMap.autoUpdate = false;
```

and in `tick`, directly before `renderer.render(scene, camera);`:

```ts
      renderer.shadowMap.needsUpdate = dirty || tweening;
```

Create `public/_headers` (Cloudflare serves static files with these; the Worker's own responses get theirs from `src/middleware.ts`, and the adapter adds the year-long rule for `/_astro/*`):

```
# Every static file: never sniffed (spec 12.1)
/*
  X-Content-Type-Options: nosniff

# The fonts' names aren't hashed, so a month rather than a year
/fonts/*
  Cache-Control: public, max-age=2592000
```

Create `scripts/lighthouse.mjs`:

```js
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
```

In `package.json` `scripts`, add after `"poster"`: `"lighthouse": "node scripts/lighthouse.mjs",`.

In `.github/workflows/ci.yml`, at the end of the `deploy` job, add:

```yaml
      # Spec 11's page budgets on the live site (Lighthouse, mobile, median of five). Over budget is a warning on the
      # run, not a failed deploy; the interaction and layout budgets are gated in the check job.
      - run: bun run lighthouse https://curiousgeorge.dev/
        continue-on-error: true
```

- [ ] **Step 3: Run the checks**

Run: `bun run test:unit tests/unit/loop.test.ts`
Expected: PASS.

Run: `bun run build:test`, then `pkill -f "port 43"; pkill -f snapshot-site`, then `bun run test:e2e tests/e2e/perf.spec.ts --project=chromium`
Expected: 6 passed. If the font check fails because the local server ignores `public/_headers`, confirm `dist/client/_headers` contains both rules (the adapter merges its own `/_astro/*` rule into the file); if it does, the file is right and the local server is at fault: say so in the report and keep the check.

Run: `bun run serve` in one terminal (port 4331), then `bun run lighthouse`
Expected: a median LCP well under 1500ms and CLS 0 on this machine (about 1.3s and 0 in the probe). Stop the server afterwards. This needs Playwright's full Chromium (`bunx playwright install chromium`), or `CHROME_PATH` pointing at a Chrome or Playwright's headless shell.

- [ ] **Step 4: The whole suite and commit**

Run: `bun run typecheck && bun run test:unit && bun run test:e2e`
Expected: 0 errors; everything passes. The scene specs exercise the loop change: a record still lands, spins and casts its shadow.

```bash
git add tests/e2e/perf.spec.ts tests/unit/loop.test.ts src/deck/scene/loop.ts public/_headers scripts/lighthouse.mjs package.json .github/workflows/ci.yml
git commit -m "perf: INP and phone layout checks, Lighthouse after deploys, font caching and fewer shadow redraws"
```

---

### Task 10: the docs

The spec, the roadmap, the follow-ups and the README brought up to what plan 4 built.

**Files:**
- Create: `docs/superpowers/plans/2026-10-05-plan-4-followups.md`
- Modify: `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`, `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`, `docs/superpowers/plans/2026-10-03-plan-1-followups.md`, `docs/superpowers/plans/2026-10-04-plan-2-followups.md`, `docs/superpowers/plans/2026-10-04-plan-3-followups.md`, `README.md`

**Interfaces:**
- Consumes: everything plan 4 built.
- Produces: nothing later tasks use.

- [ ] **Step 1: The spec**

In `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`:

Section 4.1, after "Images load on first hover or first open, never up front.", add: "Without JavaScript browsers ignore lazy loading, so the framed snapshots come with the page."

Section 9, add these bullets at the end:

```markdown
- Captures use `@cloudflare/puppeteer`. A capture's six files go under a fresh key, `snapshots/<slug>-<ulid>-<width>.<avif|webp>`, and the line points at the new base only if it still has the address that was captured; a line edited or removed meanwhile keeps what George saved and the new files are deleted. Variants step their quality down until they fit their budget; one that never fits keeps its smallest try, with a warning in the logs.
- The nightly run captures every line in one browser session. A capture's files are deleted a week after the next capture of that line replaced them, however old they are, so a cached page that names them keeps working.
- "Re-shoot now" waits for the capture (a few seconds): a good one is a save; a failed one says why on its line and the line keeps its previous snapshot.
- The whole pipeline is tested on a developer's machine: wrangler runs Browser Rendering and the Images binding locally, so both Workers capture a small fixture site in the end-to-end suite.
```

Section 10, replace the last bullet ("Environment variables are renamed …") with:

```markdown
- The PostHog project key is added by the proxy, from a Worker secret (`POSTHOG_KEY`, set with `wrangler secret put POSTHOG_KEY`); the host is a var (`POSTHOG_HOST`, `https://us.i.posthog.com`). The page carries neither, and the old `NEXT_PUBLIC_POSTHOG_*` variables are no longer used. Without a key (local and test runs) the proxy drops what it accepts.
- The proxy forwards only the four events above; anything else is refused with a 400 before it reaches PostHog. It sets `distinct_id`, `$cookieless_mode` and `$process_person_profile` itself and drops any `$ip` property.
- The beacon sends a plain-text JSON body with `sendBeacon` (no preflight), falling back to `fetch` with `keepalive`. Scripts announce events as a DOM event (`logbook:track`), so the label script, the deck runner and the scene share no code with the beacon.
- Checks against the live site send no events: the post-deploy privacy and media checks run under Global Privacy Control, the privacy check tests the proxy with an event it refuses, and Lighthouse's post-deploy runs block `/ingest`.
```

Section 11, replace the first paragraph ("Measured with Lighthouse CLI, …") with:

```markdown
Largest contentful paint is measured with Lighthouse (mobile preset: simulated 4G, 4× CPU; median of five runs) against the deployed site after every deploy, with a warning when it's over budget. Interaction to next paint is checked on every run in Playwright at 4× CPU, with the Event Timing API (Lighthouse's navigation mode doesn't report it), for opening a label, showing older log entries and opening the closer look (pressing play is reported, not gated, until the deck builds its audio context before the first press). Layout shift is checked on every run at desktop and phone widths.
```

Section 13, in the launch checklist, add after the Images binding line:

```markdown
- [ ] Set the PostHog project key as a Worker secret: `bunx wrangler secret put POSTHOG_KEY`. Remove the old `NEXT_PUBLIC_POSTHOG_*` lines from your local `.env`.
- [ ] Put the D1 database id in `workers/snapshots/wrangler.jsonc` as well as `wrangler.jsonc`.
- [ ] Check the account can use Browser Rendering (the nightly snapshots and "re-shoot now").
- [ ] After the first nightly run (17:00 UTC), check `/admin`'s snapshots section says "captured" for each line, then re-shoot one.
```

Section 14, replace the "Snapshots Worker:" bullet with:

```markdown
- Snapshots Worker: unit tests with a fake browser page for success, a page that never goes quiet (shot at the cap), navigation errors, non-2xx statuses, challenge headers and pages and a blank image (each keeps the old snapshot), the variants' budgets, a line changed or removed mid-capture and the week-old clean-up; end to end, both Workers on a local server (port 4334) with local Browser Rendering and Images capture a fixture site (port 4400), nightly and through "re-shoot now".
- Analytics: unit tests for the proxy (the key, the country, the forwarded IP, no cookies either way, refusals, the size cap) and the beacon's event body; end to end, the pageview and the events the page sends, nothing under Global Privacy Control and the proxy's answers.
```

- [ ] **Step 2: The roadmap, the follow-ups and the README**

In `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`, in row 4, replace `To write after plan 3` with `[Done](2026-10-05-plan-4-snapshots-analytics.md); [follow-ups](2026-10-05-plan-4-followups.md)`, and in the launch gate paragraph, after "the Cloudflare Access application (its team domain and AUD tag go in wrangler.jsonc)", add ", the PostHog key as a Worker secret", and replace "then putting its id in `wrangler.jsonc`" with "then putting its id in `wrangler.jsonc` and `workers/snapshots/wrangler.jsonc`".

In `docs/superpowers/plans/2026-10-03-plan-1-followups.md` and `docs/superpowers/plans/2026-10-04-plan-3-followups.md`, add under their `## Plan 4 (snapshots and analytics)` heading, followed by a blank line:

```markdown
Done in [plan 4](2026-10-05-plan-4-snapshots-analytics.md).
```

In `docs/superpowers/plans/2026-10-04-plan-2-followups.md`, add under `## Plan 4 (snapshots, analytics, Lighthouse) and launch`, followed by a blank line:

```markdown
[Plan 4](2026-10-05-plan-4-snapshots-analytics.md) did the shadow map, the analytics events and the Lighthouse, INP and layout checks. The environment map is still question 1 below, and the real-device items are launch work.
```

Create `docs/superpowers/plans/2026-10-05-plan-4-followups.md`:

```markdown
# Plan 4 follow-ups

What plan 4 (snapshots and analytics) found or left for later.

## Later

- The local Images binding ignores `quality`, so the variants' quality steps are only exercised for real in production. Check the first nightly run's file sizes in R2 against spec 11's budgets.
- Lighthouse's post-deploy runs are a warning, not a gate. If they prove steady on GitHub's runners, `--strict` turns them into one.
- The environment map's hitch (plan 2 question 1) is unchanged: the opt-in `scene-perf.spec.ts` still fails on it.
- The hover card for a line near the window's right edge is cut at the edge between about 800 and 860px wide; a small nudge on first hover could slide it left to stay whole.
- The closer look opens only once the 1920px file has downloaded and decoded, with nothing on screen in between on a slow network; it could open at once with the frame's image and swap the big one in.
- A refused Browser Rendering session (a rate or concurrency limit) reads as "the snapshots worker didn't answer"; "the browser couldn't start" would be truer.
- Pressing play costs about 150 to 185ms at 4× CPU, most of it the deck building its `AudioContext` inside the first press (plan 2 code). Build it before the press (suspended at load, resumed in the press), then gate the play check in `tests/e2e/perf.spec.ts`.
```

In `README.md`:

- add to the "Develop" block, after `bun run seed:media --local`:

```bash
bun run seed:snapshots --local
```

- add after the "The admin page" section:

````markdown
## Snapshots and analytics

The snapshots Worker lives in `workers/snapshots/`. `bun run dev:snapshots` runs it on its own; the end-to-end suite runs it beside the site on port 4334, with local Browser Rendering (wrangler downloads Chrome on first use) capturing a fixture site on port 4400. Run scripts under Node 24 (`mise exec node@24 --` outside your home directory): wrangler's Chrome download has hung under Node 26.

`bun run seed:snapshots --local` gives two labelled lines a snapshot in the local store, so the e2e server shows hover cards and the closer look.

The analytics proxy drops events locally, because the PostHog key is a Worker secret only production has. `bun run lighthouse [url]` measures spec 11's page budgets (median of five mobile runs).
````

- [ ] **Step 3: Check and commit**

Run: `grep -nE "—|, (and|or) [a-z]+\.$" docs/superpowers/plans/2026-10-05-plan-4-followups.md README.md`
Expected: no em dashes; read any match for an Oxford comma and fix it.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

```bash
git add docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md docs/superpowers/plans/2026-10-03-plan-1-followups.md docs/superpowers/plans/2026-10-04-plan-2-followups.md docs/superpowers/plans/2026-10-04-plan-3-followups.md docs/superpowers/plans/2026-10-05-plan-4-followups.md README.md
git commit -m "docs: plan 4 snapshots and analytics in the spec, roadmap, follow-ups and README"
```
