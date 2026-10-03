# Plan 2: the listening corner implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "on the turntable" row: R2 media served with range requests, a deck runner that owns playback and works from a plain track list and the 3D walnut console scene (Three.js 0.169) with the flip-through crate, its control, the scratch easter egg, phone framing and posters.

**Architecture:** Two modules, so playback never depends on WebGL (spec 5.1). The deck runner (`src/deck/runner.ts`, `audio.ts`, `list.ts`) is one small page script that Astro inlines into the HTML, so the playback path never references a hashed file. The scene (`src/deck/scene.ts` and `src/deck/scene/*`) is a separate chunk that a tiny loader script imports after `load`, an idle callback and the row coming within 200px; it attaches to the runner as a `DeckView` and turns each runner step into motion. Without a scene every step completes instantly, and a scene that is off screen, in a hidden tab, under reduced motion or with a lost context finishes its steps at once.

**Tech Stack:** Astro 7.3.5 on Cloudflare Workers, R2 (`MEDIA`), D1, Three.js 0.169.0, Web Audio, Vitest 5 with linkedom, Playwright 1.63, sharp and music-metadata for the one-off media scripts.

**Spec:** [docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md](../specs/2026-10-03-personal-site-redesign-design.md), mainly section 5 (listening corner), 6.2 (`/media`), 8 (seed), 11 (budgets) and 14 (testing). Behavioural reference: [docs/prototypes/2026-10-03-logbook/turntable.js](../../prototypes/2026-10-03-logbook/turntable.js) and the `.deck`, `.crate-hud` and `.crate` rules in `logbook.html`. Plan 1 follow-ups for this plan: [2026-10-03-plan-1-followups.md](2026-10-03-plan-1-followups.md).

## Global Constraints

- Three.js is pinned to exactly `three@0.169.0` with `@types/three@0.169.0`. Plain Three.js only: no React Three Fiber, no Spline, no other 3D or animation library.
- Package manager is bun. `astro@7.3.5` and `@astrojs/cloudflare@14.3.3` stay as they are.
- Copy is lowercase and follows the george-voice rules: spaced hyphen ` - ` as the dash, no em dashes, no Oxford comma, Australian spelling. Exact strings: hint `flip through the crate with ‹ ›, or pick a track. nothing plays until you do.`; empty state `nothing on the turntable right now.`; list states `play`, `cueing`, `playing · stop`, `couldn't play`; live region `now playing <title>`, `stopped`, `couldn't play <title>`.
- Motion (spec 4.3): ease-out by default, most transitions 200 to 300ms, nothing over 1s except the illustrative record journey, hover transitions 200ms `ease` and only under `@media (hover: hover) and (pointer: fine)`, transforms removed under `prefers-reduced-motion`, nothing animates on scroll or on load, icons morph rather than swap.
- Budgets (spec 11): JavaScript before any interaction under 10KB gzipped (page scripts plus the deck runner); scene chunk under 190KB gzipped; no scene task over 50ms at 4× CPU throttle; covers 512px WebP under 40KB each; posters under 60KB each; audio streams with range requests and nothing preloads (`preload="none"`).
- The deck runner page script (`src/scripts/deck.ts` and everything it imports) has no dynamic `import()` and shares no runtime module with any other script or chunk; `src/scripts/deck-scene.ts` and everything under `src/deck/scene*` import only types (`import type`) from `src/deck/types.ts`. Astro only inlines a script chunk that has no imports and no dynamic imports, and the inlining is what keeps playback working when edge-cached HTML outlives a deploy.
- Test hooks (`window.__deck`, `window.__deckScene`) exist only inside `if (__TEST_HOOKS__)` blocks. `bun run build:test` sets them; `bun run build` must produce no `__deck` anywhere in `dist/`.
- Privacy stays true: no cookies, no storage, every request first party (the existing privacy spec must stay green).
- Accessibility (spec 12.2): the `<canvas>` is `aria-hidden`; the crate control stays exposed; `aria-pressed` on list buttons; a polite live region; focus-visible outlines; arrows use `aria-disabled`, never `disabled`.
- D1 migrations only through `wrangler d1 migrations apply` (the existing `db:migrate:*` scripts), never `wrangler d1 execute --file`.
- Never run `wrangler deploy`, `bun run db:migrate:remote` or `bun run seed:media --remote`. Uploading production media is George's launch step.
- Every task ends with `bun run typecheck` reporting 0 errors and the unit tests passing; tasks that touch the page also run the e2e specs they name.
- Match the existing code: 2-space indent, double quotes, semicolons, short comments that say why, no new lint or format tooling.
- DOM code uses `appendChild` and other `Node` methods, never `Element.append`, `prepend`, `before`, `after` or `replaceWith`: the Workers types in `worker-configuration.d.ts` redeclare those for HTMLRewriter, so they fail typecheck.

## Review Focus

1. **Conflicting input across surfaces in the same second** (a list press, a crate-control press and a canvas click, including while the scene chunk is still downloading): exactly one record ends on the platter, centred, and the list, the control and the audio agree. Task 9 adds a cross-surface test.
2. **Media that fails mid-session** (a 404 after a key changes, a network error part-way through a track): the record returns to the crate, the row says `couldn't play` and the next press works. Task 5 pins the mid-play error in the runner; Task 6 pins the 404 end to end.
3. **Leaving mid-journey** (scrolling away or switching tabs while a record is in the air): the journey finishes at once instead of stalling, audio starts or stops as asked and coming back shows the deck at rest. Task 8 adds a scroll-away-mid-flight test.
4. **Crates at the edges of the cap** (one record, six records): one record disables both arrows and still plays; six records fit inside the crate. Tasks 7 and 9 pin these in unit tests.
5. **Stale HTML after a deploy** (edge-cached HTML referencing hashed scripts a newer deploy removed): the list still plays every record and the poster stays. Task 6 blocks every hashed script and plays from the list; Task 12 purges the cached page after each deploy.

## Decisions made while planning

Recorded so reviewers know they are deliberate (each is also noted in the task that implements it):

- **Records are seeded by a migration** (`0003_records.sql`), not by the media script, so local, CI and production D1 all get them through `migrations apply`. `bun run seed:media` only uploads the committed files in `media/` to R2. Spec 8 had the script insert the rows.
- **Posters show an empty crate** (console, turntable, candle, rug, no sleeves), so they stay true when records change in `/admin`. The scene fills the crate when it replaces the poster. A design call listed for George: the alternative is the current records, re-rendered with `bun run poster` whenever they change.
- **The hint keeps the spec's full sentence** in every state (spec 5.4), even while the poster shows and there are no arrows on screen. Hiding its first clause would change George's copy and, at 375px, shift the page when the scene arrives. Listed for George as a choice.
- **The red `›` in the list** marks the record in view only while a scene is attached.
- **Phone framing** (measured in a probe at 375 × 320): crop to x −3.35 to 6.25, y −0.9 to 3.4, z −2.0 to 2.7, view direction (0, 0.45, 1), canvas aspect 375 / 320. The cover is about 95px tall, so the side-by-side layout stays and the crate does not move in front of the turntable.
- **Deploys purge the cached home page** by tag from CI (ADR-0009, filed as Proposed until George signs it off; Task 12). The `version_metadata` binding is not added: the purge already guarantees edge-cached HTML never outlives the hashed scene loader for more than a moment, and the runner is inline anyway.
- **The 50ms long-task budget is measured locally** (`SCENE_PERF=1`, Task 11) and reported, not gated in CI, because CI renders WebGL in software. Listed for George.
- **Media is cached by browsers, not at the edge.** The adapter adds `Cloudflare-CDN-Cache-Control: no-store` to routes without a cache hint, which includes `/media`; `Cache-Control: public, max-age=31536000, immutable` still lets browsers keep every file. Fine at this traffic.
- **Covers and slugs are stable keys** (`audio/simple-things.mp3`, `covers/simple-things.webp`). Admin uploads in plan 3 use random keys as spec 7 says.

## Execution checkpoints (controller)

- After Task 6 and again after Task 8, the controller pushes the branch to the open pull request and reads the `check` job's result on ubuntu (through the session's PR status tools, not by polling) before starting the next task. Local runs are macOS; CI is the deploy gate.
- If Linux WebKit cannot start audio there, a fix round gates the audio assertions with `test.skip(browserName === "webkit" && process.platform === "linux", "no audio sink in headless Linux WebKit; the real-device launch check covers it")` and the report says so. If SwiftShader makes `openScene` exceed its timeout, raise the timeout rather than loosen an assertion.

## File structure

```
astro.config.mjs                       modify: vite define __TEST_HOOKS__, build.assetsInlineLimit
wrangler.jsonc                         modify: r2_buckets MEDIA
worker-configuration.d.ts              regenerate: MEDIA: R2Bucket
package.json                           modify: three, scripts build:test, seed:media, covers, poster
.github/workflows/ci.yml               modify: seed media, build:test, hooks guard, purge
playwright.config.ts                   modify: phone testMatch
migrations/0003_records.sql            create: the starting crate
media/audio/*.mp3                      move from public/audio (four tracks; three others deleted)
media/covers/*.webp                    create: 512px covers from the MP3s' ID3 art
public/posters/deck-desktop.webp       create: poster, desktop framing
public/posters/deck-phone.webp         create: poster, phone framing
scripts/covers.mjs                     create: one-off ID3 art to WebP
scripts/seed-media.mjs                 create: upload media/ to R2 (--local or --remote)
scripts/poster.mjs                     create: render both posters with Playwright
src/env.d.ts                           modify: __TEST_HOOKS__, window.__deck, window.__deckScene
src/lib/media.ts                       create: R2 streaming with ranges (pure, unit-tested)
src/pages/media/[...key].ts            create: route
src/components/Turntable.astro         modify: deck host, poster, track list, hint, live region, audio, scripts
src/styles/deck.css                    create: listening corner styles
src/deck/types.ts                      create: DeckTrack, DeckState, DeckView, AudioPort, Deck
src/deck/audio.ts                      create: shared <audio> through a Web Audio GainNode
src/deck/runner.ts                     create: want/current/browsed runner
src/deck/list.ts                       create: track list binding
src/scripts/deck.ts                    create: page script (inlined)
src/scripts/deck-scene.ts              create: scene loader (hashed chunk)
src/deck/scene.ts                      create: mount(): the scene chunk entry
src/deck/scene/layout.ts               create: world constants, slots, tilts, play angle
src/deck/scene/tween.ts                create: keyed tweens with an instant mode
src/deck/scene/lighting.ts             create: Sydney time to light settings
src/deck/scene/framing.ts              create: camera fit, desktop and phone framings
src/deck/scene/textures.ts             create: walnut, grooves, fur, glow (idle slices), covers
src/deck/scene/build.ts                create: renderer and every object in the room
src/deck/scene/loop.ts                 create: on-demand render loop, spin, candle flicker
src/deck/scene/journeys.ts             create: flip, load, unload, sync, hover preview
src/deck/scene/hud.ts                  create: crate control
src/deck/scene/pointer.ts              create: picking, hover, clicks, scratch
src/deck/scene/hooks.ts                create: test hooks (compiled out of production)
tests/unit/media.test.ts               create
tests/unit/media-files.test.ts         create: cover and poster sizes
tests/unit/turntable.test.ts           create
tests/unit/audio.test.ts               create
tests/unit/runner.test.ts              create
tests/unit/list.test.ts                create
tests/unit/tween.test.ts               create
tests/unit/layout.test.ts              create
tests/unit/lighting.test.ts            create
tests/unit/framing.test.ts             create
tests/unit/hud.test.ts                 create
tests/unit/time.test.ts                modify: 12:xx and AEDT cases
tests/e2e/deck.ts                      create: shared helpers for the deck specs
tests/e2e/media.spec.ts                create
tests/e2e/deck-list.spec.ts            create
tests/e2e/deck-scene.spec.ts           create
tests/e2e/deck-journeys.spec.ts        create
tests/e2e/deck-crate.spec.ts           create
tests/e2e/deck-scratch.spec.ts         create
tests/e2e/deck-phone.spec.ts           create
tests/e2e/scene-perf.spec.ts           create: opt-in (SCENE_PERF=1)
tests/e2e/logbook.spec.ts              modify: the turntable row now has records
tests/e2e/budgets.spec.ts              modify: scene chunk measured separately
docs/adr/0009-purge-cached-home-page-after-deploys.md   create
docs/adr/README.md, roadmap, plan 1 follow-ups, spec 6.1 and 13, README.md   modify
```

---

### Task 1: the `/media` route

Streams R2 objects under allowlisted prefixes with range support (spec 6.2). The logic lives in a pure function so it is unit-tested against a fake bucket; the route is a one-liner.

**Files:**
- Modify: `wrangler.jsonc` (add the R2 binding)
- Regenerate: `worker-configuration.d.ts`
- Create: `src/lib/media.ts`, `src/pages/media/[...key].ts`
- Test: `tests/unit/media.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `env.MEDIA: R2Bucket`; `isMediaKey(key: string): boolean`; `serveMedia(bucket: R2Bucket, key: string, request: Request): Promise<Response>`; the route `GET /media/<key>`.

- [ ] **Step 1: Add the R2 binding**

In `wrangler.jsonc`, after the `d1_databases` array (add a comma after its closing `]`):

```jsonc
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "curiousgeorge-media" }]
```

Then regenerate the binding types:

Run: `bun run cf-typegen`
Expected: `worker-configuration.d.ts` gains `MEDIA: R2Bucket;` in `__BaseEnv_Env`. Check with `git diff --stat worker-configuration.d.ts` and `git diff worker-configuration.d.ts | head -20`: the only change besides the header hash must be the `MEDIA` line. If wrangler picked up anything from a local `.env` (for example `NEXT_PUBLIC_POSTHOG_*`), delete those lines so the diff is only the binding.

- [ ] **Step 2: Write the failing unit tests**

Create `tests/unit/media.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { isMediaKey, serveMedia } from "../../src/lib/media";

const BYTES = Uint8Array.from({ length: 2000 }, (_, i) => i % 256);

// Mimics R2: ranges come back as { offset, length }, { offset } or { suffix }; a matching If-None-Match returns no body
function fakeBucket(objects: Record<string, string>) {
  return {
    get: vi.fn(async (key: string, options?: { range?: Headers; onlyIf?: Headers }) => {
      const type = objects[key];
      if (!type) return null;
      const size = BYTES.length;
      const base = {
        key,
        size,
        httpEtag: `"etag-${key}"`,
        writeHttpMetadata: (headers: Headers) => headers.set("Content-Type", type),
      };
      if (options?.onlyIf?.get("If-None-Match") === base.httpEtag) return base;
      const match = /^bytes=(\d*)-(\d*)$/.exec(options?.range?.get("Range") ?? "");
      if (match && match[1] !== "" && Number(match[1]) >= size) throw new Error("The requested range is not satisfiable");
      let range: { offset?: number; length?: number; suffix?: number } | undefined;
      let slice = BYTES;
      if (match && match[1] === "") {
        range = { suffix: Number(match[2]) };
        slice = BYTES.slice(size - Number(match[2]));
      } else if (match && match[2] === "") {
        range = { offset: Number(match[1]) };
        slice = BYTES.slice(Number(match[1]));
      } else if (match) {
        const offset = Number(match[1]);
        range = { offset, length: Number(match[2]) - offset + 1 };
        slice = BYTES.slice(offset, Number(match[2]) + 1);
      }
      return { ...base, range, body: new Blob([slice]).stream() };
    }),
  } as unknown as R2Bucket & { get: ReturnType<typeof vi.fn> };
}

const bucket = () => fakeBucket({ "audio/a.mp3": "audio/mpeg", "covers/a.webp": "image/webp" });
const get = (headers: Record<string, string> = {}) => new Request("https://curiousgeorge.dev/media/x", { headers });

describe("isMediaKey", () => {
  test("allows only the audio, covers and snapshots prefixes", () => {
    expect(["audio/a.mp3", "covers/a.webp", "snapshots/s/480.avif"].every(isMediaKey)).toBe(true);
    expect(["", "a.mp3", "secret/a", "audio", "audios/a.mp3"].some(isMediaKey)).toBe(false);
  });

  test("rejects dot segments and empty segments", () => {
    expect(["audio/../secret", "audio/./a.mp3", "audio//a.mp3", "audio/a/.."].some(isMediaKey)).toBe(false);
    expect(isMediaKey("audio/a..b.mp3")).toBe(true);
  });
});

describe("serveMedia", () => {
  test("streams a whole object with its type and long-lived caching", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get());
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "audio/mpeg",
      "content-length": "2000",
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag: '"etag-audio/a.mp3"',
    });
    expect((await response.arrayBuffer()).byteLength).toBe(2000);
  });

  test("answers a byte range with 206 and Content-Range", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=100-1099" }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-1099/2000");
    expect(response.headers.get("content-length")).toBe("1000");
    expect(new Uint8Array(await response.arrayBuffer())[0]).toBe(100);
  });

  test("answers open-ended and suffix ranges", async () => {
    const open = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=1500-" }));
    expect([open.status, open.headers.get("content-range")]).toEqual([206, "bytes 1500-1999/2000"]);
    const suffix = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=-500" }));
    expect([suffix.status, suffix.headers.get("content-range"), suffix.headers.get("content-length")]).toEqual([206, "bytes 1500-1999/2000", "500"]);
  });

  test("answers a range past the end with 416, uncached", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=5000-" }));
    expect([response.status, response.headers.get("content-range"), response.headers.get("cache-control")]).toEqual([416, "bytes */*", "no-store"]);
  });

  test("returns 304 when the browser's copy is current", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get({ "If-None-Match": '"etag-audio/a.mp3"' }));
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"etag-audio/a.mp3"');
  });

  test("404s, uncached, for missing objects and disallowed keys without touching R2 for the latter", async () => {
    const b = bucket();
    for (const key of ["audio/missing.mp3", "secret/a", "audio/../covers/a.webp"]) {
      const response = await serveMedia(b, key, get());
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(b.get).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `bun run test:unit tests/unit/media.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/media`.

- [ ] **Step 4: Implement the media helper**

Create `src/lib/media.ts`:

```ts
// Media lives in R2 and is served same-origin under /media/<key> (spec 6.2). Keys are unique and never reused,
// so a file can be cached for a year.
export const MEDIA_PREFIXES = ["audio/", "covers/", "snapshots/"];

export function isMediaKey(key: string): boolean {
  if (!MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  return key.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

const missing = () =>
  new Response("not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

type ByteRange = { offset?: number; length?: number; suffix?: number };

export async function serveMedia(bucket: R2Bucket, key: string, request: Request): Promise<Response> {
  if (!isMediaKey(key)) return missing();
  let object: R2ObjectBody | R2Object | null;
  try {
    object = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  } catch (error) {
    // R2 throws for a range it can't serve, such as one past the end; anything else is a real failure
    if (!request.headers.has("Range")) throw error;
    return new Response(null, { status: 416, headers: { "Cache-Control": "no-store", "Content-Range": "bytes */*" } });
  }
  if (!object) return missing();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  // R2 leaves the body out when the request's conditions say the browser already has this version
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  const range = object.range as ByteRange | undefined;
  if (range && request.headers.has("Range")) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? object.size - offset);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun run test:unit tests/unit/media.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Add the route**

Create `src/pages/media/[...key].ts`:

```ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { serveMedia } from "../../lib/media";

export const GET: APIRoute = ({ params, request }) => serveMedia(env.MEDIA, params.key ?? "", request);
```

- [ ] **Step 7: Typecheck and build**

Run: `bun run typecheck && bun run test:unit && bun run build`
Expected: 0 errors, all unit tests pass, build succeeds. (The route is exercised end to end in Task 2, once there is media to serve.)

- [ ] **Step 8: Commit**

```bash
git add wrangler.jsonc worker-configuration.d.ts src/lib/media.ts "src/pages/media/[...key].ts" tests/unit/media.test.ts
git commit -m "feat: stream R2 media with range requests under /media"
```

---

### Task 2: the starting crate's media and seeding

Moves the four prototype tracks out of `public/`, deletes the three that are not in the crate, makes 512px WebP covers from their ID3 art and adds `bun run seed:media` to upload `media/` to R2. Local and CI e2e runs seed the local store.

**Files:**
- Modify: `package.json`, `.github/workflows/ci.yml`
- Move: `public/audio/*.mp3` to `media/audio/` (four files); delete the other three
- Create: `scripts/covers.mjs`, `scripts/seed-media.mjs`, `media/covers/*.webp`
- Test: `tests/unit/media-files.test.ts`, `tests/e2e/media.spec.ts`

**Interfaces:**
- Consumes: `GET /media/<key>` (Task 1).
- Produces: R2 keys `audio/<slug>.mp3` and `covers/<slug>.webp` for the slugs `simple-things`, `nyc-in-1940`, `no-bad-feelings-today`, `light-it-up`; scripts `bun run covers` and `bun run seed:media --local|--remote`.

- [ ] **Step 1: Add the tools**

Run: `bun add -d sharp@0.35.5 music-metadata@12.0.0`
Expected: both appear in `devDependencies` with exact versions; `bun.lock` updates.

- [ ] **Step 2: Move the four tracks and delete the rest**

```bash
mkdir -p media/audio media/covers
git mv "public/audio/Loom room - simple things.mp3" media/audio/simple-things.mp3
git mv "public/audio/berlioz, Ted Jasper - nyc in 1940.mp3" media/audio/nyc-in-1940.mp3
git mv "public/audio/Juando - No Bad Feelings Today.mp3" media/audio/no-bad-feelings-today.mp3
git mv "public/audio/home alone. - light it up.mp3" media/audio/light-it-up.mp3
git rm "public/audio/Garabato Beats - Vintage Vibes.mp3" "public/audio/dublon - debris.mp3" "public/audio/home alone. - fling.mp3"
ls public/audio 2>/dev/null || echo "public/audio is gone"
```

Expected: `public/audio is gone` (git removes the empty directory).

- [ ] **Step 3: Write the failing media-files test**

Create `tests/unit/media-files.test.ts`:

```ts
import { readdirSync, statSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, test } from "vitest";

const SLUGS = ["simple-things", "nyc-in-1940", "no-bad-feelings-today", "light-it-up"];

describe("the starting crate's media", () => {
  test("has exactly the four tracks", () => {
    expect(readdirSync("media/audio").sort()).toEqual(SLUGS.map((slug) => `${slug}.mp3`).sort());
  });

  test.each(SLUGS)("%s has a 512px WebP cover under 40KB", async (slug) => {
    const file = `media/covers/${slug}.webp`;
    expect(statSync(file).size).toBeLessThan(40 * 1024);
    const meta = await sharp(file).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
  });
});
```

Run: `bun run test:unit tests/unit/media-files.test.ts`
Expected: the track test passes; the four cover tests FAIL with `ENOENT`.

- [ ] **Step 4: Write the covers script and make the covers**

Create `scripts/covers.mjs`:

```js
// One-off: turns the cover art embedded in each MP3's ID3 tags into a 512px WebP under 40KB (spec 5.2 and 11).
// bun run covers  (reads media/audio/*.mp3, writes media/covers/<same name>.webp)
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { parseFile } from "music-metadata";
import sharp from "sharp";

const LIMIT = 40 * 1024;
const encode = (data, quality) => sharp(data).resize(512, 512, { fit: "cover" }).webp({ quality, effort: 6 }).toBuffer();

mkdirSync("media/covers", { recursive: true });
for (const file of readdirSync("media/audio").filter((name) => name.endsWith(".mp3"))) {
  const picture = (await parseFile(`media/audio/${file}`)).common.picture?.[0];
  if (!picture) throw new Error(`${file} has no embedded cover art`);
  // Start high and step down until the cover fits the budget
  let quality = 80;
  let out = await encode(picture.data, quality);
  while (out.length >= LIMIT && quality > 40) out = await encode(picture.data, (quality -= 4));
  if (out.length >= LIMIT) throw new Error(`${file}: the cover is still ${out.length} bytes at quality ${quality}`);
  const name = file.replace(/\.mp3$/, ".webp");
  writeFileSync(`media/covers/${name}`, out);
  console.log(`media/covers/${name}: ${out.length} bytes at quality ${quality}`);
}
```

In `package.json` `scripts`, add after `"og"`:

```json
    "covers": "node scripts/covers.mjs",
    "seed:media": "node scripts/seed-media.mjs",
```

Run: `bun run covers`
Expected: four lines, each under 40960 bytes (in the probe, quality 80 fitted two covers and two needed 72 or lower).

Run: `bun run test:unit tests/unit/media-files.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the seed script**

Create `scripts/seed-media.mjs`:

```js
// Uploads the committed starting crate (media/audio and media/covers) to R2 under the same keys.
//   bun run seed:media --local    the local store the e2e server uses (.wrangler/state)
//   bun run seed:media --remote   production; George runs this once before launch (spec 13)
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const where = process.argv.includes("--remote")
  ? ["--remote"]
  : process.argv.includes("--local")
    ? ["--local", "--persist-to", ".wrangler/state"]
    : null;
if (!where) {
  console.error("usage: bun run seed:media --local | --remote");
  process.exit(1);
}
const TYPES = { mp3: "audio/mpeg", webp: "image/webp" };
for (const dir of ["audio", "covers"]) {
  for (const file of readdirSync(`media/${dir}`)) {
    const type = TYPES[file.split(".").pop()];
    if (!type) continue;
    execFileSync("wrangler", ["r2", "object", "put", `curiousgeorge-media/${dir}/${file}`, "--file", `media/${dir}/${file}`, "--content-type", type, ...where], { stdio: "inherit" });
  }
}
```

Run: `bun run seed:media --local`
Expected: eight successful uploads (four `audio/…mp3`, four `covers/…webp`). If `wrangler` is not on the PATH in your shell, run it through `bun run` as shown (bun adds `node_modules/.bin`).

- [ ] **Step 6: Write the e2e media spec**

Create `tests/e2e/media.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "HTTP behaviour, checked once");

test("streams a seeded track with range support and long caching", async ({ request }) => {
  const full = await request.get("/media/audio/simple-things.mp3");
  expect(full.status()).toBe(200);
  const headers = full.headers();
  expect(headers["content-type"]).toBe("audio/mpeg");
  expect(headers["accept-ranges"]).toBe("bytes");
  expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const size = Number(headers["content-length"]);
  expect(size).toBeGreaterThan(100_000);
  const part = await request.get("/media/audio/simple-things.mp3", { headers: { Range: "bytes=100-1099" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toBe(`bytes 100-1099/${size}`);
  expect((await part.body()).length).toBe(1000);
});

test("serves covers as WebP", async ({ request }) => {
  const cover = await request.get("/media/covers/nyc-in-1940.webp");
  expect(cover.status()).toBe(200);
  expect(cover.headers()["content-type"]).toBe("image/webp");
});

test("unknown keys and other prefixes are 404 and never cached", async ({ request }) => {
  for (const path of ["/media/audio/missing.mp3", "/media/secret/simple-things.mp3"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});
```

- [ ] **Step 7: Seed in `check` and in CI**

In `package.json`, change `check` to seed the local store after migrating it:

```json
    "check": "bun run typecheck && bun run test:unit && bun run db:migrate:local && bun run seed:media --local && bun run build && bun run test:e2e"
```

In `.github/workflows/ci.yml`, in the `check` job, add a step directly after `- run: bun run db:migrate:local`:

```yaml
      - run: bun run seed:media --local
```

- [ ] **Step 8: Build and run the media checks**

Run: `bun run build && bun run test:e2e tests/e2e/media.spec.ts`
Expected: 3 passed in chromium, 3 skipped in webkit.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; all unit tests pass.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock .github/workflows/ci.yml media scripts/covers.mjs scripts/seed-media.mjs tests/unit/media-files.test.ts tests/e2e/media.spec.ts
git commit -m "feat: starting crate media with covers and an R2 seed script"
```

(The `git mv` and `git rm` from Step 2 are already staged.)

---

### Task 3: the records seed and the listening corner's markup

Seeds the four records and renders the row's server markup: the deck box (empty until the scene or poster fills it), the track list, the hint, the live region and the shared `<audio>` element. No behaviour yet.

**Files:**
- Create: `migrations/0003_records.sql`, `src/styles/deck.css`
- Modify: `src/components/Turntable.astro`, `tests/e2e/logbook.spec.ts`
- Test: `tests/unit/turntable.test.ts`

**Interfaces:**
- Consumes: `Track` from `src/lib/logbook.ts` (`{ id, title, artist, audioKey, coverKey, side }`); media keys from Task 2.
- Produces (markup contract later tasks query):
  - `[data-deck]`: the deck host (`.deck`), later holding the poster, canvas and crate control
  - `.tracks button[data-index]` with `data-src`, `data-cover`, `data-title`, `data-artist`, `aria-pressed`; inside it `.side`, `.tt`, `.st`
  - `.hint`
  - `[data-deck-status]`: the polite live region
  - `[data-deck-audio]`: the one `<audio preload="none">`

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/turntable.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import Turntable from "../../src/components/Turntable.astro";
import type { Track } from "../../src/lib/logbook";
import { render, text } from "./render";

const records: Track[] = [
  { id: 1, title: "simple things", artist: "loom room", audioKey: "audio/simple-things.mp3", coverKey: "covers/simple-things.webp", side: "a1" },
  { id: 2, title: "nyc in 1940", artist: "berlioz, ted jasper", audioKey: "audio/nyc-in-1940.mp3", coverKey: "covers/nyc-in-1940.webp", side: "a2" },
];

describe("Turntable", () => {
  test("lists every record with its side, artist and a play state", async () => {
    const doc = await render(Turntable, { records });
    expect([...doc.querySelectorAll(".tracks li")].map((row) => text(row))).toEqual([
      "a1 simple things - loom room play",
      "a2 nyc in 1940 - berlioz, ted jasper play",
    ]);
    const button = doc.querySelector(".tracks button")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("data-index")).toBe("0");
    expect(button.getAttribute("data-src")).toBe("/media/audio/simple-things.mp3");
    expect(button.getAttribute("data-cover")).toBe("/media/covers/simple-things.webp");
    expect(button.getAttribute("data-title")).toBe("simple things");
    expect(button.getAttribute("data-artist")).toBe("loom room");
  });

  test("has the deck, the hint, a polite live region and one audio element that preloads nothing", async () => {
    const doc = await render(Turntable, { records });
    expect(doc.querySelector("[data-deck]")).not.toBeNull();
    expect(text(doc.querySelector(".hint"))).toBe("flip through the crate with ‹ ›, or pick a track. nothing plays until you do.");
    const status = doc.querySelector("[data-deck-status]")!;
    expect([status.getAttribute("role"), status.getAttribute("aria-live")]).toEqual(["status", "polite"]);
    expect([...doc.querySelectorAll("audio")].map((audio) => audio.getAttribute("preload"))).toEqual(["none"]);
  });

  test("shows only the empty line when there are no records", async () => {
    const doc = await render(Turntable, { records: [] });
    expect(text(doc.querySelector(".empty"))).toBe("nothing on the turntable right now.");
    expect(doc.querySelector("[data-deck]")).toBeNull();
    expect(doc.querySelector("audio")).toBeNull();
  });
});
```

Run: `bun run test:unit tests/unit/turntable.test.ts`
Expected: the first two tests FAIL (no `.tracks`); the empty-state test passes.

- [ ] **Step 2: Write the component**

Replace `src/components/Turntable.astro` with:

```astro
---
import "../styles/deck.css";
import type { Track } from "../lib/logbook";

interface Props {
  records: Track[];
}
const { records } = Astro.props;
const media = (key: string) => `/media/${key}`;
---
{records.length === 0 ? (
  <p class="empty">nothing on the turntable right now.</p>
) : (
  <div class="corner">
    <div class="deck" data-deck></div>
    <ol class="tracks" aria-label="records">
      {records.map((record, index) => (
        <li>
          <button
            type="button"
            aria-pressed="false"
            data-index={index}
            data-src={media(record.audioKey)}
            data-cover={media(record.coverKey)}
            data-title={record.title}
            data-artist={record.artist}
          >
            <span class="side mono">{record.side}</span>{" "}
            <span class="tt">{record.title} <span class="aside">- {record.artist}</span></span>{" "}
            <span class="st mono">play</span>
          </button>
        </li>
      ))}
    </ol>
    <p class="hint mono">flip through the crate with ‹ ›, or pick a track. nothing plays until you do.</p>
    <p class="sr-only" role="status" aria-live="polite" data-deck-status></p>
    <audio preload="none" data-deck-audio></audio>
  </div>
)}
```

- [ ] **Step 3: Write the styles**

Create `src/styles/deck.css` (from the prototype's `.deck` and `.crate` rules; the list is `.tracks` here):

```css
/* The listening corner (spec 5). The deck box keeps its size whether it shows the poster, the scene or nothing yet. */
.corner { position: relative; }
.deck { position: relative; aspect-ratio: 16 / 10.8; margin: -10px 0 8px calc(-1 * var(--gap) + 1px); }

.tracks li { border-bottom: 1px solid var(--rule); }
.tracks li:first-child { border-top: 1px solid var(--rule); }
.tracks button {
  width: 100%; display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: baseline; text-align: left;
  background: none; border: 0; padding: 8px 0; cursor: pointer;
}
.tracks .side { font-size: 12px; color: var(--muted); }
.tracks .browsed .side { color: var(--ink); }
.tracks .browsed .side::before { content: "› "; color: var(--red); }
/* Room for the widest state ("playing · stop" and its dot), so the columns never move when a record lands */
.tracks .st { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; justify-content: flex-end; gap: 7px; min-width: calc(14ch + 14px); }
.tracks .on .st, .tracks .failed .st { color: var(--ink); }
.tracks .on .st::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
@media (hover: hover) and (pointer: fine) {
  .tracks .st { transition: color 200ms ease; }
  .tracks button:hover .st { color: var(--ink); }
}

.hint { margin-top: 12px; font-size: 12px; color: var(--muted); }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 680px) {
  /* Full bleed: 25px is the book's 24px gutter plus the 1px rule, then the gap; 24px more on the right */
  .deck { aspect-ratio: 375 / 320; margin: 0 0 8px calc(-25px - var(--gap)); width: calc(100% + 49px + var(--gap)); }
}
```

Run: `bun run test:unit tests/unit/turntable.test.ts`
Expected: PASS (3 tests). The `{" "}` between the spans matters: Astro drops the line breaks between elements, which would run the row's text, and its accessible name, together.

- [ ] **Step 4: Seed the records**

Create `migrations/0003_records.sql`:

```sql
-- The starting crate: the four tracks from the agreed prototype. Their media is in media/ and in R2 under these keys
-- (bun run seed:media). Like 0002, this is both production content and the e2e fixture; change records through /admin.
INSERT INTO records (title, artist, audio_key, cover_key, position) VALUES
  ('simple things', 'loom room', 'audio/simple-things.mp3', 'covers/simple-things.webp', 1),
  ('nyc in 1940', 'berlioz, ted jasper', 'audio/nyc-in-1940.mp3', 'covers/nyc-in-1940.webp', 2),
  ('no bad feelings today', 'juando', 'audio/no-bad-feelings-today.mp3', 'covers/no-bad-feelings-today.webp', 3),
  ('light it up', 'home alone.', 'audio/light-it-up.mp3', 'covers/light-it-up.webp', 4);
```

Run: `bun run db:migrate:local`
Expected: `0003_records.sql` applied (0001 and 0002 already applied).

- [ ] **Step 5: Update the seeded-logbook e2e check**

In `tests/e2e/logbook.spec.ts`, replace the line

```ts
  await expect(page.locator("#turntable .empty")).toHaveText("nothing on the turntable right now.");
```

with

```ts
  await expect(page.locator("#turntable .tracks li")).toHaveCount(4);
  await expect(page.locator("#turntable .tracks li").first()).toHaveText(/a1\s*simple things - loom room\s*play/);
```

- [ ] **Step 6: Build and run the page checks**

Run: `bun run typecheck && bun run test:unit && bun run build && bun run test:e2e tests/e2e/logbook.spec.ts tests/e2e/layout.spec.ts tests/e2e/smoke.spec.ts tests/e2e/degraded.spec.ts tests/e2e/budgets.spec.ts`
Expected: 0 errors; all pass (the layout spec proves the full-bleed deck adds no horizontal scroll at 375px).

- [ ] **Step 7: Commit**

```bash
git add migrations/0003_records.sql src/components/Turntable.astro src/styles/deck.css tests/unit/turntable.test.ts tests/e2e/logbook.spec.ts
git commit -m "feat: seed the starting crate and render the turntable row"
```

---

### Task 4: the deck's types and the audio port

One shared `<audio>` element routed through a Web Audio `GainNode` (spec 5.3). The press handler unlocks it synchronously, because WebKit only lets media play when playback started inside a gesture and a journey takes about 2.5s; fades use the gain, which also works on iOS where `volume` is ignored.

**Files:**
- Create: `src/deck/types.ts`, `src/deck/audio.ts`
- Test: `tests/unit/audio.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type in `src/deck/types.ts` (used by every later task, exactly as written below) and `createAudioPort(element: HTMLAudioElement, makeContext?: () => AudioContext): AudioPort`, plus the constants `FADE_IN_MS = 500`, `FADE_OUT_MS = 260`, `START_TIMEOUT_MS = 15_000`.

- [ ] **Step 1: Write the types**

Create `src/deck/types.ts`:

```ts
// The listening corner's shared types. Everything under src/deck/scene* and the scene loader imports these with
// `import type` only, so the deck runner stays one inlined script that shares no chunk with the scene.

export interface DeckTrack {
  title: string;
  artist: string;
  /** Same-origin URL of the MP3, e.g. /media/audio/simple-things.mp3 */
  src: string;
  /** Same-origin URL of the 512px WebP cover */
  cover: string;
}

export interface DeckState {
  /** The record the visitor wants on the platter, or null for none */
  want: number | null;
  /** The record out of its sleeve (travelling or on the platter), or null */
  current: number | null;
  /** The record the crate shows */
  browsed: number;
  /** A journey is running */
  busy: boolean;
  /** The record whose audio is playing, or null */
  playing: number | null;
  /** The record whose row says "couldn't play", or null */
  failed: number | null;
  /** A scene is attached */
  scene: boolean;
}

/** What the scene does for the runner. Each promise resolves when its motion ends (at once when nobody can see it). */
export interface DeckView {
  /** Tilt the crate so `browsed` is in view; a new flip retargets one still running */
  flip(browsed: number): Promise<void>;
  /** Carry a record from its sleeve to the platter, then, if `wanted()` is still true, spin up and drop the needle */
  load(index: number, wanted: () => boolean): Promise<void>;
  /** Lift the needle, stop the platter and carry the record back into its sleeve */
  unload(index: number): Promise<void>;
  /** Called after every state change */
  update(state: DeckState): void;
}

export interface AudioPort {
  /** Call inside the press handler: resumes Web Audio and primes the element, because WebKit only plays media started in a gesture */
  unlock(src: string): void;
  /** Plays `src` from the start with a fade-in. False when it can't load, decode or play; no fade-in if `wanted()` turned false meanwhile */
  start(src: string, wanted: () => boolean): Promise<boolean>;
  /** Fades out, then pauses */
  stop(): void;
  /** Playback rate for the scratch (pitch follows the rate) */
  setRate(rate: number): void;
  onEnded(listener: () => void): void;
  onError(listener: () => void): void;
}

export interface Deck {
  readonly tracks: readonly DeckTrack[];
  getState(): DeckState;
  subscribe(listener: (state: DeckState) => void): () => void;
  /** Plays the record, or stops it if it is the one wanted. A second press on the same record within 450ms is ignored */
  toggle(index: number): void;
  /** Shows a record in the crate; during a journey the flip waits until the runner is idle */
  browse(index: number): void;
  setRate(rate: number): void;
  /** The scene loader hands over the scene while it is still loading; steps wait for it (up to 5s) */
  connect(view: Promise<DeckView | null>): void;
  /** The scene went away (lost WebGL context); the runner carries on without it */
  disconnect(view: DeckView): void;
}
```

- [ ] **Step 2: Write the failing audio tests**

Create `tests/unit/audio.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAudioPort, FADE_IN_MS, FADE_OUT_MS, START_TIMEOUT_MS } from "../../src/deck/audio";

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 42;
  playbackRate = 1;
  volume = 1;
  preservesPitch = true;
  paused = true;
  error: MediaError | null = null;
  outcome: "play" | "fail" | "hang" = "play";
  play = vi.fn(() => {
    if (this.outcome === "fail") return Promise.reject(new DOMException("no supported source", "NotSupportedError"));
    if (this.outcome === "hang") return new Promise<void>(() => {});
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

function fakeContext() {
  const gain = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((value: number) => {
      gain.value = value;
    }),
    linearRampToValueAtTime: vi.fn(),
  };
  const context = {
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {}),
    createGain: vi.fn(() => ({ gain, connect: vi.fn((node: unknown) => node) })),
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn((node: unknown) => node) })),
  };
  return { context, gain, make: vi.fn(() => context as unknown as AudioContext) };
}

function setup() {
  const element = new FakeAudio();
  const ctx = fakeContext();
  const port = createAudioPort(element as unknown as HTMLAudioElement, ctx.make);
  return { element, ctx, port };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("audio port", () => {
  test("the first unlock builds the graph inside the press and starts the element silently", () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    expect(ctx.make).toHaveBeenCalledTimes(1);
    expect(ctx.context.resume).toHaveBeenCalled();
    expect(ctx.gain.value).toBe(0);
    expect(element.src).toBe("/media/audio/a.mp3");
    expect(element.play).toHaveBeenCalledTimes(1);
    port.unlock("/media/audio/b.mp3");
    expect(ctx.make).toHaveBeenCalledTimes(1);
    expect(ctx.context.resume).toHaveBeenCalledTimes(2);
    expect(element.src).toBe("/media/audio/a.mp3"); // later presses never cut off what is playing
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  test("start rewinds, plays and fades the gain up", async () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    expect(await port.start("/media/audio/a.mp3", () => true)).toBe(true);
    expect(element.currentTime).toBe(0);
    expect(element.paused).toBe(false);
    expect(ctx.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 10 + FADE_IN_MS / 1000);
  });

  test("start switches to a different track", async () => {
    const { element, port } = setup();
    port.unlock("/media/audio/a.mp3");
    await port.start("/media/audio/b.mp3", () => true);
    expect(element.src).toBe("/media/audio/b.mp3");
  });

  test("start resolves false when the track can't play", async () => {
    const { element, port } = setup();
    element.outcome = "fail";
    port.unlock("/media/audio/a.mp3");
    expect(await port.start("/media/audio/a.mp3", () => true)).toBe(false);
  });

  test("start gives up on a track that never starts", async () => {
    const { element, port } = setup();
    element.outcome = "hang";
    const started = port.start("/media/audio/a.mp3", () => true);
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(await started).toBe(false);
    expect(element.pause).toHaveBeenCalled();
  });

  test("start stays silent when the record is no longer wanted", async () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    expect(await port.start("/media/audio/a.mp3", () => false)).toBe(true);
    expect(element.paused).toBe(true);
    expect(ctx.gain.linearRampToValueAtTime).not.toHaveBeenCalledWith(1, expect.any(Number));
  });

  test("stop fades out, then pauses", async () => {
    const { element, ctx, port } = setup();
    port.unlock("/media/audio/a.mp3");
    await port.start("/media/audio/a.mp3", () => true);
    port.stop();
    expect(ctx.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10 + FADE_OUT_MS / 1000);
    expect(element.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(FADE_OUT_MS);
    expect(element.paused).toBe(true);
  });

  test("a start during the fade-out keeps the new track playing", async () => {
    const { element, port } = setup();
    port.unlock("/media/audio/a.mp3");
    await port.start("/media/audio/a.mp3", () => true);
    port.stop();
    await port.start("/media/audio/b.mp3", () => true);
    await vi.advanceTimersByTimeAsync(FADE_OUT_MS);
    expect(element.paused).toBe(false);
  });

  test("setRate changes the rate and lets the pitch follow", () => {
    const { element, port } = setup();
    port.setRate(1.8);
    expect(element.playbackRate).toBe(1.8);
    expect(element.preservesPitch).toBe(false);
  });

  test("forwards ended and error", () => {
    const { element, port } = setup();
    const ended = vi.fn();
    const errored = vi.fn();
    port.onEnded(ended);
    port.onError(errored);
    element.dispatchEvent(new Event("ended"));
    element.dispatchEvent(new Event("error"));
    expect([ended.mock.calls.length, errored.mock.calls.length]).toEqual([1, 1]);
  });

  test("without Web Audio, fades fall back to the element's volume", async () => {
    const element = new FakeAudio();
    const port = createAudioPort(element as unknown as HTMLAudioElement, () => {
      throw new Error("no Web Audio");
    });
    port.unlock("/media/audio/a.mp3");
    expect(element.volume).toBe(0);
    await port.start("/media/audio/a.mp3", () => true);
    expect(element.volume).toBe(1);
  });
});
```

Run: `bun run test:unit tests/unit/audio.test.ts`
Expected: FAIL, cannot resolve `../../src/deck/audio`.

- [ ] **Step 3: Implement the audio port**

Create `src/deck/audio.ts`:

```ts
import type { AudioPort } from "./types";

export const FADE_IN_MS = 500;
export const FADE_OUT_MS = 260;
export const START_TIMEOUT_MS = 15_000;

type Graph = { context: AudioContext; gain: GainNode };

/** Resolves true once `playing` resolves, false if it rejects or takes longer than `ms` */
function settles(playing: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    playing.then(
      () => { clearTimeout(timer); resolve(true); },
      () => { clearTimeout(timer); resolve(false); },
    );
  });
}

// One shared <audio> element for every record, routed through a gain node (spec 5.3)
export function createAudioPort(element: HTMLAudioElement, makeContext: () => AudioContext = () => new AudioContext()): AudioPort {
  let graph: Graph | null = null;
  let tried = false;
  let unlocked = false;
  let loaded = "";
  let token = 0;
  let ended = () => {};
  let errored = () => {};
  element.addEventListener("ended", () => ended());
  element.addEventListener("error", () => errored());

  // Built inside the first press: browsers only let an AudioContext start from a user gesture
  function connect(): Graph | null {
    if (tried) return graph;
    tried = true;
    try {
      const context = makeContext();
      const gain = context.createGain();
      context.createMediaElementSource(element).connect(gain).connect(context.destination);
      graph = { context, gain };
    } catch {
      graph = null;
    }
    return graph;
  }

  // The gain, not element.volume, because iOS ignores volume
  function fade(to: number, ms: number) {
    if (!graph) {
      element.volume = to;
      return;
    }
    const param = graph.gain.gain;
    const now = graph.context.currentTime;
    param.cancelScheduledValues(now);
    if (ms <= 0) {
      param.setValueAtTime(to, now);
      return;
    }
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + ms / 1000);
  }

  function load(src: string) {
    if (loaded === src && !element.error) return;
    loaded = src;
    element.src = src;
  }

  return {
    unlock(src) {
      // iOS mutes Web Audio with the ringer switch unless the page asks for a playback session
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
      void connect()?.context.resume().catch(() => {});
      if (unlocked) return;
      unlocked = true;
      // Started inside the gesture at zero gain, so WebKit lets this element play when the record lands
      fade(0, 0);
      load(src);
      element.play().catch(() => {});
    },
    async start(src, wanted) {
      const mine = ++token;
      load(src);
      fade(0, 0);
      element.currentTime = 0;
      element.playbackRate = 1;
      if (!(await settles(element.play(), START_TIMEOUT_MS))) {
        element.pause();
        return false;
      }
      if (mine !== token) return true;
      if (!wanted()) {
        element.pause();
        return true;
      }
      fade(1, FADE_IN_MS);
      return true;
    },
    stop() {
      const mine = ++token;
      fade(0, FADE_OUT_MS);
      setTimeout(() => {
        if (mine === token) element.pause();
      }, FADE_OUT_MS);
    },
    setRate(rate) {
      element.preservesPitch = false;
      (element as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
      element.playbackRate = rate;
    },
    onEnded(listener) {
      ended = listener;
    },
    onError(listener) {
      errored = listener;
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun run test:unit tests/unit/audio.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; all unit tests pass.

```bash
git add src/deck/types.ts src/deck/audio.ts tests/unit/audio.test.ts
git commit -m "feat: deck types and a shared audio element behind a Web Audio gain"
```

---

### Task 5: the deck runner

The single runner that owns `want`, `current` and `browsed` (spec 5.1 and 5.3). Input only sets `want`; the runner loops `while (current !== want)`, unloading then loading one step at a time and re-checking after every step. Without a scene every step completes at once.

**Files:**
- Create: `src/deck/runner.ts`
- Test: `tests/unit/runner.test.ts`

**Interfaces:**
- Consumes: `Deck`, `DeckState`, `DeckTrack`, `DeckView`, `AudioPort` from `src/deck/types.ts` (Task 4).
- Produces: `createDeck(options: { tracks: DeckTrack[]; audio: AudioPort; announce: (message: string) => void; now?: () => number }): Deck` and the constants `DOUBLE_PRESS_MS = 450`, `FAILED_MS = 4000`, `VIEW_WAIT_MS = 5000`.

- [ ] **Step 1: Write the failing runner tests**

Create `tests/unit/runner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDeck, DOUBLE_PRESS_MS, FAILED_MS, VIEW_WAIT_MS } from "../../src/deck/runner";
import type { AudioPort, DeckState, DeckView } from "../../src/deck/types";

const tracks = ["a", "b", "c", "d"].map((t) => ({ title: t, artist: "x", src: `/media/audio/${t}.mp3`, cover: `/media/covers/${t}.webp` }));
let clock = 0;

function fakeAudio() {
  let ended = () => {};
  let errored = () => {};
  const calls: string[] = [];
  const audio = {
    calls,
    result: true,
    unlock: (src: string) => void calls.push(`unlock ${src}`),
    start: async (src: string) => {
      calls.push(`start ${src}`);
      return audio.result;
    },
    stop: () => void calls.push("stop"),
    setRate: vi.fn(),
    onEnded: (fn: () => void) => void (ended = fn),
    onError: (fn: () => void) => void (errored = fn),
    end: () => ended(),
    error: () => errored(),
  };
  return audio satisfies AudioPort;
}

// Every step takes `ms` of (fake) time; counts how many run at once
function fakeView(ms = 100) {
  const calls: string[] = [];
  let active = 0;
  let most = 0;
  const step = async (name: string) => {
    calls.push(name);
    active += 1;
    most = Math.max(most, active);
    await new Promise((resolve) => setTimeout(resolve, ms));
    active -= 1;
  };
  const view: DeckView = {
    flip: (i) => step(`flip ${i}`),
    load: (i) => step(`load ${i}`),
    unload: (i) => step(`unload ${i}`),
    update: () => {},
  };
  return { view, calls, most: () => most };
}

function setup() {
  const audio = fakeAudio();
  const said: string[] = [];
  const deck = createDeck({ tracks, audio, announce: (message) => said.push(message), now: () => clock });
  return { deck, audio, said };
}

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const starts = (calls: string[]) => calls.filter((call) => call.startsWith("start"));

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

describe("deck runner without a scene", () => {
  test("unlocks audio inside the press, then plays and announces", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(1);
    expect(audio.calls).toEqual(["unlock /media/audio/b.mp3"]);
    expect(deck.getState()).toMatchObject({ want: 1, busy: true });
    await settle();
    expect(deck.getState()).toEqual({ want: 1, current: 1, browsed: 1, busy: false, playing: 1, failed: null, scene: false });
    expect(starts(audio.calls)).toEqual(["start /media/audio/b.mp3"]);
    expect(said).toEqual(["now playing b"]);
  });

  test("a second press stops it", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(1);
    await settle();
    clock = 1000;
    deck.toggle(1);
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null, busy: false });
    expect(audio.calls.at(-1)).toBe("stop");
    expect(said).toEqual(["now playing b", "stopped"]);
  });

  test("a second press on the same record within 450ms is ignored", async () => {
    const { deck } = setup();
    deck.toggle(0);
    clock = DOUBLE_PRESS_MS - 1;
    deck.toggle(0);
    await settle();
    expect(deck.getState().playing).toBe(0);
    clock = DOUBLE_PRESS_MS + 10;
    deck.toggle(0);
    await settle();
    expect(deck.getState().playing).toBeNull();
  });

  test("a track that can't play goes back and says so for four seconds", async () => {
    const { deck, audio, said } = setup();
    audio.result = false;
    deck.toggle(2);
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null, failed: 2, busy: false });
    expect(said).toEqual(["couldn't play c"]);
    await settle(FAILED_MS);
    expect(deck.getState().failed).toBeNull();
  });

  test("a new press clears the failure", async () => {
    const { deck, audio } = setup();
    audio.result = false;
    deck.toggle(2);
    await settle();
    audio.result = true;
    clock = 1000;
    deck.toggle(1);
    expect(deck.getState().failed).toBeNull();
    await settle();
    expect(deck.getState().playing).toBe(1);
  });

  test("when a track ends the record goes back", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(0);
    await settle();
    audio.end();
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null });
    expect(said).toEqual(["now playing a", "stopped"]);
  });

  test("an audio error mid-track counts as couldn't play", async () => {
    const { deck, audio, said } = setup();
    deck.toggle(0);
    await settle();
    audio.error();
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null, failed: 0 });
    expect(said).toEqual(["now playing a", "couldn't play a"]);
  });

  test("browse clamps to the crate", () => {
    const { deck } = setup();
    deck.browse(-3);
    expect(deck.getState().browsed).toBe(0);
    deck.browse(99);
    expect(deck.getState().browsed).toBe(3);
  });

  test("subscribers hear every change until they unsubscribe", async () => {
    const { deck } = setup();
    const heard: DeckState[] = [];
    const stop = deck.subscribe((state) => heard.push(state));
    deck.browse(2);
    expect(heard.at(-1)?.browsed).toBe(2);
    stop();
    deck.browse(3);
    expect(heard.at(-1)?.browsed).toBe(2);
  });
});

describe("deck runner with a scene", () => {
  test("runs one journey at a time and only the last of several quick presses plays", async () => {
    const { deck, audio } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    deck.toggle(1);
    deck.toggle(2);
    deck.toggle(3);
    await settle(5000);
    expect(deck.getState()).toMatchObject({ want: 3, current: 3, playing: 3, browsed: 3, busy: false, scene: true });
    expect(scene.most()).toBe(1);
    expect(scene.calls).toEqual(["load 0", "unload 0", "flip 3", "load 3"]);
    expect(starts(audio.calls)).toEqual(["start /media/audio/d.mp3"]);
  });

  test("stopping before the record lands plays nothing and takes it back", async () => {
    const { deck, audio } = setup();
    const scene = fakeView(1000);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    await settle(500);
    clock = 500;
    deck.toggle(0);
    await settle(5000);
    expect(deck.getState()).toMatchObject({ want: null, current: null, playing: null });
    expect(scene.calls).toEqual(["load 0", "unload 0"]);
    expect(starts(audio.calls)).toEqual([]);
  });

  test("flips asked for during a journey happen when the runner is idle", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(1);
    deck.browse(3);
    expect(deck.getState().browsed).toBe(1);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ browsed: 3, playing: 1 });
    expect(scene.calls).toEqual(["flip 1", "load 1", "flip 3"]);
  });

  test("a press during that last flip is not lost", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    deck.browse(2);
    await settle(150); // load 0 done, the deferred flip to 2 is running
    clock = 1000;
    deck.toggle(1);
    await settle(2000);
    expect(deck.getState()).toMatchObject({ want: 1, current: 1, playing: 1, busy: false });
  });

  test("a browse during that last flip is not lost", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    deck.browse(2);
    await settle(150); // load 0 done, the deferred flip to 2 is running
    deck.browse(3);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ browsed: 3, busy: false, playing: 0 });
    expect(scene.calls).toEqual(["load 0", "flip 2", "flip 3"]);
  });

  test("waits for a scene that is still loading, then animates", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    let resolve!: (view: DeckView) => void;
    deck.connect(new Promise((r) => (resolve = r)));
    deck.toggle(0);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ want: 0, busy: true, playing: null, scene: false });
    resolve(scene.view);
    await settle(1000);
    expect(scene.calls).toEqual(["load 0"]);
    expect(deck.getState()).toMatchObject({ playing: 0, scene: true });
  });

  test("stops waiting for a scene that never arrives", async () => {
    const { deck } = setup();
    deck.connect(new Promise(() => {}));
    deck.toggle(0);
    await settle(VIEW_WAIT_MS);
    expect(deck.getState()).toMatchObject({ playing: 0, scene: false });
    clock = VIEW_WAIT_MS + 1000;
    deck.toggle(0);
    await settle();
    expect(deck.getState()).toMatchObject({ want: null, current: null }); // no second wait
  });

  test("a scene that fails to load leaves the list working", async () => {
    const { deck } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    deck.connect(Promise.reject(new Error("chunk 404")));
    deck.toggle(0);
    await settle();
    expect(deck.getState()).toMatchObject({ playing: 0, scene: false });
    error.mockRestore();
  });

  test("a scene that throws mid-journey is dropped and playback carries on", async () => {
    const { deck } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const scene = fakeView(100);
    scene.view.load = () => Promise.reject(new Error("WebGL went away"));
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(0);
    await settle(1000);
    expect(deck.getState()).toMatchObject({ playing: 0, scene: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("disconnect detaches the scene", async () => {
    const { deck } = setup();
    const scene = fakeView(100);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.disconnect(scene.view);
    expect(deck.getState().scene).toBe(false);
    deck.toggle(0);
    await settle();
    expect(scene.calls).toEqual([]);
    expect(deck.getState().playing).toBe(0);
  });

  test("the scene hears every state change", async () => {
    const { deck } = setup();
    const scene = fakeView(0);
    const seen: DeckState[] = [];
    scene.view.update = (state) => void seen.push(state);
    deck.connect(Promise.resolve(scene.view));
    await settle();
    deck.toggle(2);
    await settle(100);
    expect(seen.at(-1)).toMatchObject({ playing: 2, busy: false, scene: true });
  });
});
```

Run: `bun run test:unit tests/unit/runner.test.ts`
Expected: FAIL, cannot resolve `../../src/deck/runner`.

- [ ] **Step 2: Implement the runner**

Create `src/deck/runner.ts`:

```ts
import type { AudioPort, Deck, DeckState, DeckTrack, DeckView } from "./types";

/** A second press on the same record within this window is a double-click, not "play, then stop" */
export const DOUBLE_PRESS_MS = 450;
/** How long a row says "couldn't play" */
export const FAILED_MS = 4000;
/** How long a step waits for a scene that is still loading before going ahead without it */
export const VIEW_WAIT_MS = 5000;

export interface DeckOptions {
  tracks: DeckTrack[];
  audio: AudioPort;
  announce: (message: string) => void;
  now?: () => number;
}

// One runner owns every record movement (spec 5.3). Input only says what the visitor wants; the runner moves the
// deck there one step at a time and re-checks after every step, so two journeys can never overlap.
export function createDeck({ tracks, audio, announce, now = () => performance.now() }: DeckOptions): Deck {
  const clamp = (index: number) => Math.max(0, Math.min(tracks.length - 1, index));
  let want: number | null = null;
  let current: number | null = null;
  let browsed = 0;
  let running = false;
  let playing: number | null = null;
  let failed: number | null = null;
  let browseWant: number | null = null;
  let view: DeckView | null = null;
  let pending: Promise<DeckView | null> | null = null;
  let failTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPress = { index: -1, at: -Infinity };
  const listeners = new Set<(state: DeckState) => void>();

  const getState = (): DeckState => ({ want, current, browsed, busy: running, playing, failed, scene: view !== null });

  function emit() {
    const state = getState();
    view?.update(state);
    for (const listener of listeners) listener(state);
  }

  // A press during the scene download waits for it, so the first record still makes its journey
  async function viewForStep(): Promise<DeckView | null> {
    const waiting = pending;
    if (waiting) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        waiting.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), VIEW_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
      // Stop waiting on later steps; the scene still attaches if it turns up
      if (timedOut && pending === waiting) pending = null;
    }
    return view;
  }

  // A scene that throws is dropped and the runner carries on without it
  async function animate(step: (scene: DeckView) => Promise<void>) {
    const scene = await viewForStep();
    if (!scene) return;
    try {
      await step(scene);
    } catch (error) {
      console.error("deck: the scene failed, carrying on without it", error);
      disconnect(scene);
    }
  }

  function fail(index: number) {
    if (want === index) want = null;
    failed = index;
    emit();
    announce(`couldn't play ${tracks[index].title}`);
    clearTimeout(failTimer);
    failTimer = setTimeout(() => {
      failed = null;
      emit();
    }, FAILED_MS);
  }

  async function load(index: number) {
    current = index;
    const flip = browsed !== index;
    browsed = index;
    emit();
    if (flip) await animate((scene) => scene.flip(index));
    await animate((scene) => scene.load(index, () => want === index));
    if (want !== index) return; // changed their mind on the way: no audio, the loop takes it back
    const ok = await audio.start(tracks[index].src, () => want === index);
    if (!ok) return fail(index);
    if (want !== index) return;
    playing = index;
    emit();
    announce(`now playing ${tracks[index].title}`);
  }

  async function unload(index: number) {
    const wasPlaying = playing === index;
    audio.stop();
    playing = null;
    browsed = index; // the scene flips back to the record on its way home
    emit();
    if (wasPlaying) announce("stopped");
    await animate((scene) => scene.unload(index));
    current = null;
    emit();
  }

  async function run() {
    if (running) return;
    running = true;
    emit();
    try {
      for (;;) {
        while (current !== want) {
          if (current !== null) await unload(current);
          else if (want !== null) await load(want);
        }
        // A flip asked for during the journey; then round again for any press or flip that lands during it
        const target = browseWant;
        browseWant = null;
        if (target === null || target === browsed) break;
        browsed = target;
        emit();
        await animate((scene) => scene.flip(target));
      }
    } finally {
      running = false;
      emit();
    }
  }

  function toggle(index: number) {
    const i = clamp(index);
    const at = now();
    if (i === lastPress.index && at - lastPress.at < DOUBLE_PRESS_MS) return;
    lastPress = { index: i, at };
    if (want === i) {
      want = null;
    } else {
      want = i;
      audio.unlock(tracks[i].src); // inside the press, so WebKit lets the record play when it lands
      if (failed !== null) {
        failed = null;
        clearTimeout(failTimer);
      }
    }
    emit();
    void run();
  }

  function browse(index: number) {
    const i = clamp(index);
    if (running) {
      browseWant = i;
      return;
    }
    if (i === browsed) return;
    browsed = i;
    emit();
    view?.flip(i).catch(() => {});
  }

  function connect(loading: Promise<DeckView | null>) {
    const settled: Promise<DeckView | null> = loading
      .catch((error: unknown) => {
        console.error("deck: the scene failed to load", error);
        return null;
      })
      .then((scene) => {
        if (pending === settled) pending = null;
        if (scene) view = scene;
        emit();
        return scene;
      });
    pending = settled;
  }

  function disconnect(scene: DeckView) {
    if (view !== scene) return;
    view = null;
    emit();
  }

  audio.onEnded(() => {
    if (playing === null || want !== playing) return;
    want = null;
    emit();
    void run();
  });
  audio.onError(() => {
    if (playing === null) return; // a failure before the record lands is start()'s to report
    const index = playing;
    playing = null;
    fail(index);
    void run();
  });

  return {
    tracks,
    getState,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggle,
    browse,
    setRate: (rate) => audio.setRate(rate),
    connect,
    disconnect,
  };
}
```

- [ ] **Step 3: Run the tests to see them pass**

Run: `bun run test:unit tests/unit/runner.test.ts`
Expected: PASS (20 tests). If a test that uses a scene sees an extra `flip` call, check that `load` only flips when `browsed` differs from the record.

- [ ] **Step 4: Typecheck and commit**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; all unit tests pass.

```bash
git add src/deck/runner.ts tests/unit/runner.test.ts
git commit -m "feat: the deck runner, one journey at a time"
```

---

### Task 6: the deck page script and the track list

Wires the runner to the page: the track list, the live region and the shared audio element. The script has no dynamic import and shares nothing with other scripts, and the inline limit is raised, so Astro inlines it into the HTML. Adds the build-time test hooks and the `build:test` build the e2e suite runs against.

**Files:**
- Create: `src/deck/list.ts`, `src/scripts/deck.ts`, `tests/unit/list.test.ts`, `tests/e2e/deck.ts`, `tests/e2e/deck-list.spec.ts`
- Modify: `astro.config.mjs`, `src/env.d.ts`, `src/components/Turntable.astro`, `package.json`, `.github/workflows/ci.yml`, `playwright.config.ts`, `tests/e2e/privacy.spec.ts`

**Interfaces:**
- Consumes: `createDeck` (Task 5), `createAudioPort` (Task 4), the markup contract (Task 3).
- Produces:
  - `bindList(list: HTMLElement, deck: Deck): void`
  - the deck host carries the runner: `(document.querySelector("[data-deck]") as HTMLElement & { deck?: Deck }).deck` (the scene loader in Task 8 reads it)
  - under `__TEST_HOOKS__`: `window.__deck = { state(): DeckState; audio(): { paused: boolean; src: string; rate: number } }`
  - e2e helpers in `tests/e2e/deck.ts`: `deckState(page)`, `audioState(page)`, `playing(page, index | null, timeout?)`, `withoutWebGL(page)`
  - scripts `bun run build:test`; `check` and CI build with test hooks

- [ ] **Step 1: Write the failing list tests**

Create `tests/unit/list.test.ts`:

```ts
import { parseHTML } from "linkedom";
import { describe, expect, test, vi } from "vitest";
import { bindList } from "../../src/deck/list";
import type { Deck, DeckState } from "../../src/deck/types";

const idle: DeckState = { want: null, current: null, browsed: 0, busy: false, playing: null, failed: null, scene: false };

function setup() {
  const window = parseHTML(
    `<ol class="tracks">${[0, 1, 2]
      .map((i) => `<li><button data-index="${i}" aria-pressed="false"><span class="side">a${i + 1}</span><span class="st">play</span></button></li>`)
      .join("")}</ol>`,
  );
  let listener: (state: DeckState) => void = () => {};
  const deck = {
    tracks: [],
    getState: () => idle,
    subscribe: (fn: (state: DeckState) => void) => {
      listener = fn;
      return () => {};
    },
    toggle: vi.fn(),
    browse: vi.fn(),
    setRate: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const list = window.document.querySelector(".tracks") as unknown as HTMLElement;
  bindList(list, deck as unknown as Deck);
  const rows = [...list.querySelectorAll("li")];
  // Events from linkedom's own window, so its elements dispatch them
  const event = (type: string, props: Record<string, unknown> = {}) => Object.assign(new window.Event(type), props);
  return { deck, rows, event, push: (state: Partial<DeckState>) => listener({ ...idle, ...state }) };
}

const st = (row: Element) => row.querySelector(".st")?.textContent;

describe("track list", () => {
  test("shows each record's state", () => {
    const { rows, push } = setup();
    push({ want: 0, busy: true });
    expect(rows.map(st)).toEqual(["cueing", "play", "play"]);
    push({ want: 0, current: 0, playing: 0 });
    expect(rows.map(st)).toEqual(["playing · stop", "play", "play"]);
    push({ failed: 2 });
    expect(rows.map(st)).toEqual(["play", "play", "couldn't play"]);
  });

  test("marks the wanted record as pressed and on", () => {
    const { rows, push } = setup();
    push({ want: 1 });
    expect(rows.map((row) => row.querySelector("button")?.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(rows.map((row) => row.classList.contains("on"))).toEqual([false, true, false]);
  });

  test("marks the record in view only while a scene is attached", () => {
    const { rows, push } = setup();
    push({ browsed: 2 });
    expect(rows[2].classList.contains("browsed")).toBe(false);
    push({ browsed: 2, scene: true });
    expect(rows.map((row) => row.classList.contains("browsed"))).toEqual([false, false, true]);
  });

  test("a click toggles; a mouse hover or focus browses; a touch does not browse", () => {
    const { deck, rows, event } = setup();
    const button = rows[1].querySelector("button")!;
    button.dispatchEvent(event("click"));
    expect(deck.toggle).toHaveBeenCalledWith(1);
    button.dispatchEvent(event("pointerenter", { pointerType: "touch" }));
    expect(deck.browse).not.toHaveBeenCalled();
    button.dispatchEvent(event("pointerenter", { pointerType: "mouse" }));
    button.dispatchEvent(event("focus"));
    expect(deck.browse.mock.calls).toEqual([[1], [1]]);
  });
});
```

Run: `bun run test:unit tests/unit/list.test.ts`
Expected: FAIL, cannot resolve `../../src/deck/list`.

- [ ] **Step 2: Implement the list binding**

Create `src/deck/list.ts`:

```ts
import type { Deck, DeckState } from "./types";

const label = (state: DeckState, index: number) =>
  state.failed === index ? "couldn't play" : state.playing === index ? "playing · stop" : state.want === index ? "cueing" : "play";

// The track list works without the scene and mirrors it when there is one (spec 5.4)
export function bindList(list: HTMLElement, deck: Deck): void {
  const buttons = [...list.querySelectorAll<HTMLButtonElement>("button[data-index]")];

  function render(state: DeckState) {
    buttons.forEach((button, index) => {
      const row = button.parentElement;
      row?.classList.toggle("on", state.want === index);
      row?.classList.toggle("browsed", state.scene && state.browsed === index);
      row?.classList.toggle("failed", state.failed === index);
      button.setAttribute("aria-pressed", String(state.want === index));
      const st = button.querySelector(".st");
      const text = label(state, index);
      if (st && st.textContent !== text) st.textContent = text;
    });
  }

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => deck.toggle(index));
    // Hovering or focusing a row shows that record in the crate
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") deck.browse(index);
    });
    button.addEventListener("focus", () => deck.browse(index));
  });
  deck.subscribe(render);
  render(deck.getState());
}
```

Run: `bun run test:unit tests/unit/list.test.ts`
Expected: PASS (4 tests). If linkedom ignores an event, check that it was built with the `Event` class from the window `parseHTML` returned (as `setup` does).

- [ ] **Step 3: Add the build-time test hooks and the inline limit**

In `astro.config.mjs`, add a `vite` key after `markdown`:

```js
  vite: {
    // Test hooks (window.__deck, window.__deckScene) exist only in builds made with TEST_HOOKS=1 (bun run build:test)
    define: { __TEST_HOOKS__: JSON.stringify(process.env.TEST_HOOKS === "1") },
    // Astro inlines a page script below this limit when it has no imports and no dynamic imports. 24KB keeps the
    // deck runner inside the HTML, so a cached page never needs a hashed file to play a record. Other assets keep
    // Vite's default, so nothing else becomes a data: URL the CSP would block.
    build: { assetsInlineLimit: (file, content) => (file.endsWith(".js") ? content.length < 24 * 1024 : undefined) },
  },
```

Replace `src/env.d.ts` with:

```ts
/// <reference types="astro/client" />

/** True only in builds made with TEST_HOOKS=1 (bun run build:test); production builds compile the hooks out */
declare const __TEST_HOOKS__: boolean;

interface Window {
  __deck?: {
    state(): import("./deck/types").DeckState;
    audio(): { paused: boolean; src: string; rate: number };
  };
}
```

In `package.json` `scripts`, add after `"build"`:

```json
    "build:test": "TEST_HOOKS=1 astro build",
```

and change `check` to build with the hooks:

```json
    "check": "bun run typecheck && bun run test:unit && bun run db:migrate:local && bun run seed:media --local && bun run build:test && bun run test:e2e"
```

In `.github/workflows/ci.yml`, in the `check` job, change `- run: bun run build` to:

```yaml
      - run: bun run build:test
```

(The `deploy` job keeps `bun run build`.)

- [ ] **Step 4: Write the page script**

Create `src/scripts/deck.ts`:

```ts
import { createAudioPort } from "../deck/audio";
import { bindList } from "../deck/list";
import { createDeck } from "../deck/runner";
import type { Deck, DeckTrack } from "../deck/types";

// The deck runner: no Three.js, no dynamic import, inlined into the page, so playback never depends on a hashed
// file or on WebGL (spec 5.1). The scene loader finds the runner on the deck host.
const host = document.querySelector<HTMLElement & { deck?: Deck }>("[data-deck]");
const list = document.querySelector<HTMLElement>(".tracks");
const element = document.querySelector<HTMLAudioElement>("[data-deck-audio]");
const status = document.querySelector<HTMLElement>("[data-deck-status]");

if (host && list && element && status) {
  const tracks: DeckTrack[] = [...list.querySelectorAll<HTMLButtonElement>("button[data-index]")].map((button) => ({
    title: button.dataset.title ?? "",
    artist: button.dataset.artist ?? "",
    src: button.dataset.src ?? "",
    cover: button.dataset.cover ?? "",
  }));
  const deck = createDeck({
    tracks,
    audio: createAudioPort(element),
    announce: (message) => {
      status.textContent = message;
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

In `src/components/Turntable.astro`, add at the very end of the file (after the closing `)}`):

```astro
<script>
  import "../scripts/deck";
</script>
```

- [ ] **Step 5: Write the e2e helpers and the list spec**

Create `tests/e2e/deck.ts`:

```ts
import { expect, type Page } from "@playwright/test";

// Helpers for the listening corner specs. They read the test hooks, which exist only in `bun run build:test` builds.

export const deckState = (page: Page) => page.evaluate(() => window.__deck!.state());
export const audioState = (page: Page) => page.evaluate(() => window.__deck!.audio());

/** Waits until the runner is idle with `index` playing (null: nothing playing) */
export async function playing(page: Page, index: number | null, timeout = 20_000) {
  await expect
    .poll(async () => {
      const state = await deckState(page);
      return state.busy ? "busy" : state.playing;
    }, { timeout })
    .toBe(index);
}

/** Makes this page believe it has no WebGL, so the scene never loads */
export async function withoutWebGL(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        return type.startsWith("webgl") ? null : original.call(this, type, options);
      },
    });
  });
}
```

Create `tests/e2e/deck-list.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { audioState, deckState, playing, withoutWebGL } from "./deck";

test("the list plays a record and stops it", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(".tracks li").nth(1);
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("playing · stop", { timeout: 20_000 });
  await expect(row.locator("button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-deck-status]")).toHaveText("now playing nyc in 1940");
  expect(await audioState(page)).toMatchObject({ paused: false, src: "/media/audio/nyc-in-1940.mp3" });
  await page.waitForTimeout(500); // past the double-press guard
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("play", { timeout: 20_000 });
  await expect(row.locator("button")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-deck-status]")).toHaveText("stopped");
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
});

test("a double click plays once", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tracks button").first().dblclick();
  await playing(page, 0);
  expect((await deckState(page)).want).toBe(0);
});

test("a track that can't play goes back and says so", async ({ page }) => {
  await page.route("**/media/audio/simple-things.mp3", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
  await page.goto("/");
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("couldn't play", { timeout: 20_000 });
  await expect(page.locator("[data-deck-status]")).toHaveText("couldn't play simple things");
  // Read straight away: the failure shows for four seconds and the record's way home can take three
  expect(await deckState(page)).toMatchObject({ want: null, failed: 0 });
  await playing(page, null);
  expect((await deckState(page)).current).toBeNull();
  await expect(row.locator(".st")).toHaveText("play", { timeout: 6000 });
});

test("with every hashed script blocked, as after a deploy, the list still plays", async ({ page }) => {
  await page.route(/\/_astro\/.+\.js$/, (route) => route.abort());
  await page.goto("/");
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("playing · stop", { timeout: 20_000 });
});

test("without a scene nothing is marked in view", async ({ page }) => {
  await withoutWebGL(page);
  await page.goto("/");
  await page.locator(".tracks button").nth(2).hover();
  await expect(page.locator(".tracks li.browsed")).toHaveCount(0);
});
```

- [ ] **Step 6: Run the list spec on the phone too, and add `log` there**

In `playwright.config.ts`, change the phone project's `testMatch` to:

```ts
testMatch: /(smoke|logbook|labels|layout|log|deck-list)\.spec\.ts/
```

- [ ] **Step 7: Exercise the deck in the privacy spec**

In `tests/e2e/privacy.spec.ts`, directly after `await page.waitForLoadState("networkidle");`, add:

```ts
  // Play and stop a record when there is one: audio streams first party from /media and sets nothing
  const track = page.locator(".tracks button").first();
  if (await track.count()) {
    await track.click();
    await page.waitForTimeout(1500);
    await track.click();
  }
```

- [ ] **Step 8: Prove the hooks compile out, then run everything against the test build**

Run: `bun run build && (grep -rq "__deck" dist && echo "LEAK: test hooks in the production build" || echo "no test hooks in the production build")`
Expected: `no test hooks in the production build`.

Run: `ls dist/client/_astro/*.js 2>/dev/null | wc -l`
Expected: `0`. Every page script, the deck runner included, is inlined; if a file shows up, find which script it is (`head -c 300` it) and remove the import or dynamic import that stopped it inlining.

Run: `bun run typecheck && bun run test:unit && bun run build:test && bun run test:e2e`
Expected: 0 errors; every unit and e2e test passes (the budgets spec still passes: the inlined runner is counted in its inline-script total).

- [ ] **Step 9: Commit**

```bash
git add astro.config.mjs src/env.d.ts src/deck/list.ts src/scripts/deck.ts src/components/Turntable.astro package.json .github/workflows/ci.yml playwright.config.ts tests/unit/list.test.ts tests/e2e/deck.ts tests/e2e/deck-list.spec.ts tests/e2e/privacy.spec.ts
git commit -m "feat: play records from the track list with an inlined deck runner"
```

---

### Task 7: scene foundations

The pure parts of the scene, each unit-tested in Node with Three.js maths: world layout, keyed tweens with an instant mode, light from the time in Sydney and camera framing. Also the plan 1 follow-up time tests.

**Files:**
- Modify: `package.json` (three), `tests/unit/time.test.ts`
- Create: `src/deck/scene/layout.ts`, `src/deck/scene/tween.ts`, `src/deck/scene/lighting.ts`, `src/deck/scene/framing.ts`
- Test: `tests/unit/layout.test.ts`, `tests/unit/tween.test.ts`, `tests/unit/lighting.test.ts`, `tests/unit/framing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `layout.ts`: `FLOOR`, `SHELF_TOP`, `PLATTER: Vector3`, `RECORD_Y`, `PIVOT: Vector3`, `ARM_LEN`, `ARM_UP`, `ARM_DOWN`, `CRATE: Vector3`, `CRATE_SIZE: { width, depth, wall, floor }`, `SLEEVE`, `OMEGA`, `FLY_PEAK`, `HUD_ANCHOR: Vector3`, `slotZ(index, count): number`, `tiltFor(index, browsed): number`, `playAngle(): number`
  - `tween.ts`: `type Ease`, `easeOut`, `easeInOut`, `linear`, `interface Tweens { tween(ms, apply, ease?, key?): Promise<void>; wait(ms): Promise<void>; step(now): boolean; setInstant(instant): void; readonly count: number }`, `createTweens(onStart: () => void, clock?: () => number): Tweens`
  - `lighting.ts`: `interface Light { mood: "day" | "golden" | "night"; key: { color: number; intensity: number; position: [number, number, number] }; bounce: number; environment: number; candle: number; glow: { opacity: number; scale: number } }`, `sydneyHour(date): number`, `lightFor(date): Light`
  - `framing.ts`: `interface Framing { points: Vector3[]; view: Vector3 }`, `DESKTOP`, `PHONE`, `frame(camera, framing, width, height): void`, `toCanvas(point, camera, width, height): { x: number; y: number }`

- [ ] **Step 1: Add Three.js, pinned**

Run: `bun add three@0.169.0 && bun add -d @types/three@0.169.0`
Expected: `"three": "0.169.0"` in `dependencies` and `"@types/three": "0.169.0"` in `devDependencies`, both exact.

- [ ] **Step 2: Write the failing layout and tween tests**

Create `tests/unit/layout.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { CRATE_SIZE, playAngle, slotZ, tiltFor } from "../../src/deck/scene/layout";

describe("crate layout", () => {
  test("records sit 0.33 apart and closer when there are more; up to six always fit inside the crate", () => {
    expect([0, 1, 2, 3].map((i) => +slotZ(i, 4).toFixed(2))).toEqual([0.8, 0.47, 0.14, -0.19]);
    expect(+slotZ(5, 6).toFixed(2)).toBe(-0.5);
    const inside = CRATE_SIZE.depth / 2 - CRATE_SIZE.wall;
    for (const count of [1, 2, 3, 4, 5, 6]) {
      for (let i = 0; i < count; i++) expect(Math.abs(slotZ(i, count))).toBeLessThan(inside);
    }
  });

  test("records in front of the browsed one tip forward; it and those behind lean back (spec 5.4)", () => {
    expect([0, 1, 2, 3].map((j) => +tiltFor(j, 2).toFixed(3))).toEqual([0.72, 0.65, -0.1, -0.112]);
    expect([0, 1, 2, 3].map((j) => +tiltFor(j, 0).toFixed(3))).toEqual([-0.1, -0.112, -0.124, -0.136]);
  });

  test("the stylus meets the lead-in groove part-way round", () => {
    expect(playAngle()).toBeGreaterThan(0.3);
    expect(playAngle()).toBeLessThan(1.2);
  });
});
```

Create `tests/unit/tween.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { createTweens, easeOut, linear } from "../../src/deck/scene/tween";

describe("tweens", () => {
  test("advance with the clock and resolve at the end", async () => {
    const tweens = createTweens(() => {}, () => 0);
    let value = 0;
    const done = vi.fn();
    void tweens.tween(100, (k) => (value = k), linear).then(done);
    expect(tweens.step(50)).toBe(true);
    expect(value).toBe(0.5);
    expect(tweens.step(100)).toBe(false);
    expect(value).toBe(1);
    await Promise.resolve();
    expect(done).toHaveBeenCalled();
    expect(tweens.count).toBe(0);
  });

  test("a keyed tween ends the running one where it stands, so input retargets", async () => {
    let now = 0;
    const tweens = createTweens(() => {}, () => now);
    let tilt = 0;
    const first = vi.fn();
    void tweens.tween(100, (k) => (tilt = k), linear, "tilt").then(first);
    tweens.step(50);
    now = 50;
    const from = tilt;
    void tweens.tween(100, (k) => (tilt = from + (2 - from) * k), linear, "tilt");
    await Promise.resolve();
    expect(first).toHaveBeenCalled();
    expect(tilt).toBe(0.5); // not jumped to the first tween's end
    expect(tweens.count).toBe(1);
    tweens.step(150);
    expect(tilt).toBe(2);
  });

  test("instant mode finishes new tweens at once and flushes running ones", async () => {
    const tweens = createTweens(() => {}, () => 0);
    let a = 0;
    let b = 0;
    const running = tweens.tween(1000, (k) => (a = k));
    tweens.setInstant(true);
    await running;
    expect(a).toBe(1);
    await tweens.tween(1000, (k) => (b = k));
    await tweens.wait(5000);
    expect(b).toBe(1);
    expect(tweens.count).toBe(0);
  });

  test("asks for a frame whenever a tween starts", () => {
    const frame = vi.fn();
    const tweens = createTweens(frame, () => 0);
    void tweens.tween(100, () => {});
    expect(frame).toHaveBeenCalledTimes(1);
  });

  test("ease-out ends exactly at 1", () => {
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
```

Run: `bun run test:unit tests/unit/layout.test.ts tests/unit/tween.test.ts`
Expected: FAIL, cannot resolve the modules.

- [ ] **Step 3: Implement layout and tweens**

Create `src/deck/scene/layout.ts`:

```ts
import { Vector3 } from "three";

// The room, in units of roughly 10cm. y = 0 is the top of the console. Values from the agreed prototype.
export const FLOOR = -4.6;
export const SHELF_TOP = -3.63;
export const PLATTER = new Vector3(-1.55, 0.32, 0.05);
export const RECORD_Y = PLATTER.y + 0.14 + 0.011;
export const PIVOT = new Vector3(0.62, 0.32, -1.2);
export const ARM_LEN = 2.4;
export const ARM_UP = 0.64;
export const ARM_DOWN = 0.585;
export const CRATE = new Vector3(4.45, 0, -0.75);
export const CRATE_SIZE = { width: 3.5, depth: 2.3, wall: 0.09, floor: 0.1 };
export const SLEEVE = 3.05;
/** 33⅓ rpm in radians a second */
export const OMEGA = (2 * Math.PI * 100) / 3 / 60;
export const FLY_PEAK = 3.2;
/** The crate control sits on the console's front edge, under the crate */
export const HUD_ANCHOR = new Vector3(CRATE.x, 0, 2.6);

const FIRST_SLOT = CRATE_SIZE.depth / 2 - CRATE_SIZE.wall - 0.26;
const SLOT_SPAN = 1.3;

/** Records stand 0.33 apart, closer when there are more, so up to six always fit the crate */
export function slotZ(index: number, count: number): number {
  const spacing = count > 1 ? Math.min(0.33, SLOT_SPAN / (count - 1)) : 0;
  return FIRST_SLOT - index * spacing;
}

/** Records in front of the browsed one tip forward; the browsed one and those behind lean back (spec 5.4) */
export function tiltFor(index: number, browsed: number): number {
  return index < browsed ? 0.72 - 0.07 * index : -(0.1 + 0.012 * (index - browsed));
}

/** The arm angle at which the stylus first meets the record's lead-in groove */
export function playAngle(): number {
  for (let a = 0; a < 1.2; a += 0.002) {
    const x = PIVOT.x - ARM_LEN * Math.sin(a);
    const z = PIVOT.z + ARM_LEN * Math.cos(a);
    if (Math.hypot(x - PLATTER.x, z - PLATTER.z) < 1.34) return a;
  }
  return 0;
}
```

Create `src/deck/scene/tween.ts`:

```ts
export type Ease = (k: number) => number;

export const easeOut: Ease = (k) => 1 - Math.pow(1 - k, 3);
export const easeInOut: Ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const linear: Ease = (k) => k;

interface Running {
  start: number;
  ms: number;
  apply: (k: number) => void;
  ease: Ease;
  done: () => void;
  key?: string;
}

export interface Tweens {
  /**
   * Runs `apply` from 0 to 1 over `ms`. A keyed tween first ends any running tween with the same key where it stands,
   * so fast repeated input (flips, hovers) retargets instead of two animations fighting.
   */
  tween(ms: number, apply: (k: number) => void, ease?: Ease, key?: string): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Advances every tween to `now`; true while any are still running */
  step(now: number): boolean;
  /** While instant (off screen, hidden tab, reduced motion, lost context) tweens jump to their end, so journeys never stall */
  setInstant(instant: boolean): void;
  readonly count: number;
}

export function createTweens(onStart: () => void, clock: () => number = () => performance.now()): Tweens {
  const running: Running[] = [];
  let instant = false;

  const tween: Tweens["tween"] = (ms, apply, ease = easeOut, key) =>
    new Promise<void>((done) => {
      if (key) {
        const j = running.findIndex((r) => r.key === key);
        if (j >= 0) running.splice(j, 1)[0].done();
      }
      if (instant || ms <= 0) {
        apply(1);
        done();
      } else {
        running.push({ start: clock(), ms, apply, ease, done, key });
      }
      onStart();
    });

  return {
    tween,
    wait: (ms) => tween(ms, () => {}, linear),
    step(now) {
      for (let i = running.length - 1; i >= 0; i--) {
        const r = running[i];
        const k = Math.min(1, Math.max(0, (now - r.start) / r.ms));
        r.apply(r.ease(k));
        if (k === 1) {
          running.splice(i, 1);
          r.done();
        }
      }
      return running.length > 0;
    },
    setInstant(next) {
      instant = next;
      if (!next) return;
      for (const r of running.splice(0)) {
        r.apply(1);
        r.done();
      }
    },
    get count() {
      return running.length;
    },
  };
}
```

Run: `bun run test:unit tests/unit/layout.test.ts tests/unit/tween.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 4: Write the failing lighting tests and the time follow-ups**

Create `tests/unit/lighting.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { lightFor, sydneyHour } from "../../src/deck/scene/lighting";

describe("light follows the time in Sydney (spec 5.2)", () => {
  test.each([
    ["2026-10-03T02:00:00Z", "day"], // 12:00 AEST
    ["2026-10-03T06:30:00Z", "golden"], // 16:30 AEST
    ["2026-10-03T09:00:00Z", "night"], // 19:00 AEST
    ["2026-10-02T19:59:00Z", "night"], // 05:59 AEST
    ["2026-10-02T20:00:00Z", "day"], // 06:00 AEST
    ["2026-10-04T08:00:00Z", "night"], // 19:00 AEDT; 18:00 if daylight saving were ignored
  ])("%s is %s", (iso, mood) => {
    expect(lightFor(new Date(iso)).mood).toBe(mood);
  });

  test("night has a brighter candle and dimmer room", () => {
    const day = lightFor(new Date("2026-10-03T02:00:00Z"));
    const night = lightFor(new Date("2026-10-03T10:00:00Z"));
    expect(night.candle).toBeGreaterThan(day.candle);
    expect(night.environment).toBeLessThan(day.environment);
  });

  test("reads hours in Sydney across daylight saving", () => {
    expect(sydneyHour(new Date("2026-10-03T05:15:00Z"))).toBe(15.25);
    expect(sydneyHour(new Date("2026-10-04T05:15:00Z"))).toBe(16.25);
  });
});
```

In `tests/unit/time.test.ts`, add after the existing test:

```ts
// Built from its code point so the expected strings can't silently turn into ordinary spaces
const NBSP = String.fromCharCode(160);

test("twelve o'clock reads 12 at noon and just after midnight", () => {
  expect(sydneyTime(new Date("2026-10-03T02:05:00Z"))).toBe(`12:05${NBSP}pm`);
  expect(sydneyTime(new Date("2026-10-02T14:30:00Z"))).toBe(`12:30${NBSP}am`);
});

test("follows daylight saving (AEDT from 4 Oct 2026)", () => {
  expect(sydneyTime(new Date("2026-10-04T05:17:00Z"))).toBe(`4:17${NBSP}pm`);
});
```

Run: `bun run test:unit tests/unit/lighting.test.ts tests/unit/time.test.ts`
Expected: the lighting tests FAIL (module missing); the time tests PASS (`sydneyTime` already handles both; these pin it).

- [ ] **Step 5: Implement the lighting**

Create `src/deck/scene/lighting.ts`:

```ts
export interface Light {
  mood: "day" | "golden" | "night";
  key: { color: number; intensity: number; position: [number, number, number] };
  bounce: number;
  environment: number;
  candle: number;
  glow: { opacity: number; scale: number };
}

const SYDNEY = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" });

export function sydneyHour(date: Date): number {
  const parts = SYDNEY.formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") + part("minute") / 60;
}

// Daylight, golden hour from 16:00 to 19:00, night light from 19:00 to 06:00 with a brighter candle (spec 5.2)
export function lightFor(date: Date): Light {
  const hour = sydneyHour(date);
  if (hour >= 19 || hour < 6) {
    return {
      mood: "night",
      key: { color: 0xffc58a, intensity: 1.4, position: [-5, 8, 6] },
      bounce: 0.34,
      environment: 0.28,
      candle: 9,
      glow: { opacity: 0.8, scale: 1.6 },
    };
  }
  // The sun swings from left to right across the day
  const t = Math.max(-1, Math.min(1, (hour - 12.5) / 6.5));
  const golden = hour >= 16;
  return {
    mood: golden ? "golden" : "day",
    key: { color: golden ? 0xffcf9e : 0xffe2c2, intensity: golden ? 2.2 : 2.3, position: [-6 - t * 4, 12, 8] },
    bounce: 0.6,
    environment: 0.45,
    candle: 4,
    glow: { opacity: 0.5, scale: 1.1 },
  };
}
```

Run: `bun run test:unit tests/unit/lighting.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing framing tests**

Create `tests/unit/framing.test.ts`:

```ts
import { Object3D, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, test } from "vitest";
import { DESKTOP, PHONE, frame, toCanvas } from "../../src/deck/scene/framing";
import { CRATE, CRATE_SIZE, HUD_ANCHOR, SLEEVE, slotZ, tiltFor } from "../../src/deck/scene/layout";

const camera = () => new PerspectiveCamera(24, 1, 0.1, 200);

// The front record's sleeve on screen, placed as the scene places it
function coverHeight(cam: PerspectiveCamera, width: number, height: number) {
  const holder = new Object3D();
  holder.position.set(CRATE.x, CRATE_SIZE.floor, CRATE.z + slotZ(0, 4));
  holder.rotation.x = tiltFor(0, 0);
  holder.updateMatrixWorld();
  const ys = [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, sy]) => toCanvas(holder.localToWorld(new Vector3((sx * SLEEVE) / 2, sy * SLEEVE, 0)), cam, width, height).y);
  return Math.max(...ys) - Math.min(...ys);
}

describe("framing", () => {
  test.each([[700, 472.5], [580, 391.5], [1000, 675]])("the desktop framing fits the whole room at %ipx wide", (width, height) => {
    const cam = camera();
    frame(cam, DESKTOP, width, height);
    for (const point of DESKTOP.points) {
      const p = toCanvas(point, cam, width, height);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
    }
  });

  test("on a 375px phone the cover is at least 90px tall and the control's anchor is inside the canvas (spec 5.2)", () => {
    const cam = camera();
    frame(cam, PHONE, 375, 320);
    expect(coverHeight(cam, 375, 320)).toBeGreaterThanOrEqual(90);
    const anchor = toCanvas(HUD_ANCHOR, cam, 375, 320);
    expect(anchor.x).toBeGreaterThan(0);
    expect(anchor.x).toBeLessThan(375);
    expect(anchor.y).toBeGreaterThan(0);
    expect(anchor.y).toBeLessThan(320);
  });

  test("the camera looks along the framing's direction", () => {
    const cam = camera();
    frame(cam, PHONE, 375, 320);
    expect(cam.getWorldDirection(new Vector3()).dot(PHONE.view)).toBeCloseTo(-1, 5);
  });
});
```

Run: `bun run test:unit tests/unit/framing.test.ts`
Expected: FAIL, cannot resolve `../../src/deck/scene/framing`.

- [ ] **Step 7: Implement the framing**

Create `src/deck/scene/framing.ts`:

```ts
import { Box3, Vector3, type PerspectiveCamera } from "three";
import { FLOOR } from "./layout";

export interface Framing {
  points: Vector3[];
  view: Vector3;
}

const corners = (min: Vector3, max: Vector3) =>
  [...Array(8)].map((_, i) => new Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z));

/** Desktop: the whole console, its shelf and the rug */
export const DESKTOP: Framing = {
  points: corners(new Vector3(-3.9, FLOOR, -2.7), new Vector3(7.0, 4.1, 2.9)).concat([new Vector3(-2.6, FLOOR, 4.7), new Vector3(5.4, FLOOR, 4.7)]),
  view: new Vector3(0, 0.62, 1).normalize(),
};

/** Phones: cropped to the console top (turntable, candle and crate), with the shelf and rug only peeking in */
export const PHONE: Framing = {
  points: corners(new Vector3(-3.35, -0.9, -2.0), new Vector3(6.25, 3.4, 2.7)),
  view: new Vector3(0, 0.45, 1).normalize(),
};

/** Backs the camera away along the framing's direction until every point fits, by binary search, so any aspect works */
export function frame(camera: PerspectiveCamera, framing: Framing, width: number, height: number): void {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const focus = new Box3().setFromPoints(framing.points).getCenter(new Vector3());
  const place = (distance: number) => {
    camera.position.copy(focus).addScaledVector(framing.view, distance);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
  };
  const p = new Vector3();
  let near = 5;
  let far = 200;
  for (let k = 0; k < 30; k++) {
    const distance = (near + far) / 2;
    place(distance);
    const fits = framing.points.every((point) => {
      p.copy(point).project(camera);
      return Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.95;
    });
    if (fits) far = distance;
    else near = distance;
  }
  place(far);
}

/** CSS pixel position of a world point in a canvas of this size */
export function toCanvas(point: Vector3, camera: PerspectiveCamera, width: number, height: number): { x: number; y: number } {
  const p = point.clone().project(camera);
  return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height };
}
```

Run: `bun run test:unit tests/unit/framing.test.ts`
Expected: PASS (5 tests). The probe measured the phone cover at about 95px.

- [ ] **Step 8: Typecheck and commit**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; all unit tests pass.

```bash
git add package.json bun.lock src/deck/scene/layout.ts src/deck/scene/tween.ts src/deck/scene/lighting.ts src/deck/scene/framing.ts tests/unit/layout.test.ts tests/unit/tween.test.ts tests/unit/lighting.test.ts tests/unit/framing.test.ts tests/unit/time.test.ts
git commit -m "feat: scene foundations: layout, keyed tweens, Sydney light and camera framing"
```

---

### Task 8: the scene: room, loader, render loop and journeys

Ports the prototype's room and journeys into the scene chunk, loads it on approach and attaches it to the runner. The crate control and pointer input come in Task 9; until then the list drives the scene. Three behaviours fixed from the prototype (spec 5.6): steps never stall off screen (instant tweens), the scene mounts once (memoised boot) and nothing loads with the page (200px, after `load` and idle).

**Files:**
- Create: `src/deck/scene/textures.ts`, `src/deck/scene/build.ts`, `src/deck/scene/loop.ts`, `src/deck/scene/journeys.ts`, `src/deck/scene/hooks.ts`, `src/deck/scene.ts`, `src/scripts/deck-scene.ts`, `tests/e2e/deck-scene.spec.ts`, `tests/e2e/deck-journeys.spec.ts`
- Modify: `src/env.d.ts`, `src/components/Turntable.astro`, `src/styles/deck.css`, `tests/e2e/deck.ts`

**Interfaces:**
- Consumes: Task 7's modules exactly as listed there; `Deck`, `DeckState`, `DeckView` (Task 4, `import type` only); the deck host's `deck` property (Task 6).
- Produces:
  - `textures.ts`: `interface Textures { walnut: CanvasTexture[]; grooves; fur; glow }`, `idle(): Promise<void>`, `makeTextures(renderer): Promise<Textures>`, `loadCovers(urls): Promise<Texture[]>`
  - `build.ts`: `interface CrateRecord { holder: Group; sleeve: Mesh; disc: Group; baseY: number }`, `interface Stage { scene; camera; platter; arm; button; lamp; candle: { light; flame; intensity }; crateWalls: Mesh[]; records: CrateRecord[] }`, `createRenderer()`, `buildStage(renderer, textures, covers, light): Promise<Stage>`; each sleeve has `userData.index`
  - `loop.ts`: `interface Loop { invalidate(); spinTo(target); setScratching(on); setVisible(visible); stop(); readonly frames }`, `createLoop({ renderer, stage, tweens, reduce, onFrame }): Loop`
  - `journeys.ts`: `type Preview = "play" | "prev" | "next" | null`, `interface Journeys { flip(browsed); load(index, wanted); unload(index); sync(state); preview(action) }`, `createJourneys(stage, tweens, loop, reduce): Journeys`
  - `hooks.ts`: `interface SceneHooks` (frames, tweens, tilts, spin, offsets, toScreen, platterAt, coverAt, coverRect, loseContext), `installHooks(...)`
  - `scene.ts`: `mount(host: HTMLElement, deck: Deck): Promise<DeckView>`; the dynamic chunk is emitted as `/_astro/scene.<hash>.js`
  - `.deck.live` once the canvas has drawn its first frame
  - e2e helpers: `openScene(page)`, `hasWebGL(page)`, `settled(page)`, `expectSeated(page)`, `scrollDeckAway(page)`

- [ ] **Step 1: Write the textures**

Create `src/deck/scene/textures.ts` (drawing ported from the prototype; the groove texture is now seeded so every visit and both posters match):

```ts
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture, type WebGLRenderer } from "three";

export interface Textures {
  walnut: CanvasTexture[];
  grooves: CanvasTexture;
  fur: CanvasTexture;
  glow: CanvasTexture;
}

/** Resolves in the browser's next idle period (soon after, where requestIdleCallback is missing) */
export const idle = () =>
  new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 16);
  });

// Runs a drawing generator in idle slices of about 8ms, so drawing never blocks the main thread for long (spec 5.2)
async function sliced<T>(work: Generator<void, T>): Promise<T> {
  for (;;) {
    await idle();
    const until = performance.now() + 8;
    for (;;) {
      const next = work.next();
      if (next.done) return next.value;
      if (performance.now() > until) break;
    }
  }
}

// Seeded, so every visit (and both posters) draws the same wood and grooves
const seeded = (seed: number) => {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return { c, g: c.getContext("2d")! };
}

// Walnut, drawn rather than downloaded: warm brown bands, wavy grain and open pores
function* walnut(seed: number): Generator<void, HTMLCanvasElement> {
  const rnd = seeded(seed);
  const w = 1024;
  const h = 512;
  const { c, g } = canvas(w, h);
  g.fillStyle = "#5e3d28";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "38,22,13" : "128,88,58"},${0.06 + rnd() * 0.12})`;
    g.fillRect(0, rnd() * h, w, 18 + rnd() * 90);
  }
  yield;
  for (let i = 0; i < 280; i++) {
    const y0 = rnd() * h;
    const amp = 1.5 + rnd() * 9;
    const f = ((0.6 + rnd() * 2.2) * Math.PI * 2) / w;
    const ph = rnd() * 6.28;
    g.strokeStyle = `rgba(${rnd() < 0.72 ? "28,16,9" : "156,110,74"},${0.05 + rnd() * 0.17})`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.25;
      if (x) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    if (i % 40 === 39) yield;
  }
  for (let i = 0; i < 4200; i++) {
    g.fillStyle = `rgba(20,10,5,${0.1 + rnd() * 0.14})`;
    g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 0.8);
    if (i % 700 === 699) yield;
  }
  return c;
}

// Fine concentric grooves, with darker gaps between the tracks
function* grooves(): Generator<void, HTMLCanvasElement> {
  const rnd = seeded(5);
  const { c, g } = canvas(1024, 1024);
  g.fillStyle = "#0d0d0d";
  g.fillRect(0, 0, 1024, 1024);
  g.lineWidth = 0.8;
  let drawn = 0;
  for (let r = 175; r < 506; r += 1.5) {
    g.strokeStyle = `rgba(255,255,255,${0.012 + rnd() * 0.028})`;
    g.beginPath();
    g.arc(512, 512, r, 0, Math.PI * 2);
    g.stroke();
    if (++drawn % 60 === 0) yield;
  }
  g.strokeStyle = "rgba(0,0,0,.85)";
  g.lineWidth = 4;
  for (const r of [250, 322, 401, 470]) {
    g.beginPath();
    g.arc(512, 512, r, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

// The sheepskin's alpha: soft tufts, so each fur shell keeps only the denser middle of each and they form little domes
function* fur(): Generator<void, HTMLCanvasElement> {
  const S = 512;
  const rnd = seeded(11);
  const { c, g } = canvas(S, S);
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 5 + rnd() * 9;
    const v = 0.55 + rnd() * 0.45;
    // Drawn again across each edge, so the texture tiles without seams
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < -r || cx > S + r || cy < -r || cy > S + r) continue;
        const tuft = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        tuft.addColorStop(0, `rgba(255,255,255,${v})`);
        tuft.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = tuft;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    if (i % 200 === 199) yield;
  }
  return c;
}

function glow(): HTMLCanvasElement {
  const { c, g } = canvas(128, 128);
  const halo = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  halo.addColorStop(0, "rgba(255,200,130,1)");
  halo.addColorStop(0.35, "rgba(255,170,90,.35)");
  halo.addColorStop(1, "rgba(255,150,70,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function plain(colour: string): HTMLCanvasElement {
  const { c, g } = canvas(4, 4);
  g.fillStyle = colour;
  g.fillRect(0, 0, 4, 4);
  return c;
}

export async function makeTextures(renderer: WebGLRenderer): Promise<Textures> {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const wood = async (seed: number, turned = false) => {
    const texture = new CanvasTexture(await sliced(walnut(seed)));
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = anisotropy;
    if (turned) {
      texture.center.set(0.5, 0.5);
      texture.rotation = Math.PI / 2;
    }
    return texture;
  };
  const walnuts = [await wood(7), await wood(19), await wood(31, true), await wood(43)];
  const vinyl = new CanvasTexture(await sliced(grooves()));
  vinyl.colorSpace = SRGBColorSpace;
  vinyl.anisotropy = anisotropy;
  const pelt = new CanvasTexture(await sliced(fur()));
  pelt.wrapS = pelt.wrapT = RepeatWrapping;
  pelt.repeat.set(0.38, 0.38);
  return { walnut: walnuts, grooves: vinyl, fur: pelt, glow: new CanvasTexture(glow()) };
}

/** The covers as textures; a cover that fails to load leaves a plain sleeve */
export function loadCovers(urls: string[]): Promise<Texture[]> {
  const loader = new TextureLoader();
  return Promise.all(
    urls.map(async (url) => {
      const texture: Texture = await loader.loadAsync(url).catch(() => new CanvasTexture(plain("#e9e4d8")));
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    }),
  );
}
```

- [ ] **Step 2: Write the room**

Create `src/deck/scene/build.ts` (ported from prototype lines 11 to 252; records get their covers before the build so shaders compile with them):

```ts
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Quaternion,
  Scene,
  ShadowMaterial,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ARM_LEN, ARM_UP, CRATE, CRATE_SIZE, FLOOR, PIVOT, PLATTER, SHELF_TOP, SLEEVE, slotZ, tiltFor } from "./layout";
import type { Light } from "./lighting";
import { idle, type Textures } from "./textures";

export interface CrateRecord {
  /** Pivots on the record's bottom edge, like a real one in a crate */
  holder: Group;
  sleeve: Mesh;
  disc: Group;
  baseY: number;
}

export interface Stage {
  scene: Scene;
  camera: PerspectiveCamera;
  platter: Group;
  arm: Group;
  button: Mesh;
  lamp: MeshStandardMaterial;
  candle: { light: PointLight; flame: Mesh; intensity: number };
  crateWalls: Mesh[];
  records: CrateRecord[];
}

export function createRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  // Device pixel ratio capped at 2, and 1.5 on coarse pointers (spec 5.2)
  renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia("(pointer: coarse)").matches ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  return renderer;
}

const solid = <T extends Mesh>(mesh: T): T => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};
const curve = (points: [number, number][]) => points.map(([r, y]) => new Vector2(r, y));
const lathe = (points: [number, number][], material: Material, segments = 48) => solid(new Mesh(new LatheGeometry(curve(points), segments), material));
const LEGS: [number, number][] = [[-3.2, -2.05], [6.4, -2.05], [-3.2, 2.05], [6.4, 2.05]];
const SPINE_TONES = [0xe7e1d4, 0x2b2a28, 0xa8432c, 0x6f6a4b, 0xb38b3c, 0x4b5560, 0xd8cdb8, 0x7c4a33, 0x1f2a2e, 0xc9b79b];
const SLEEVE_BACKS = [0xe8e2d5, 0xdfd6c4, 0xe6dccb, 0xd9d1c1];

// The room: a low walnut record console on a sheepskin, a Beogram-ish turntable, a crate to flip through and a
// candle (spec 5.2). Built in idle slices between sections.
export async function buildStage(renderer: WebGLRenderer, textures: Textures, covers: Texture[], light: Light): Promise<Stage> {
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environmentIntensity = light.environment;
  const camera = new PerspectiveCamera(24, 1, 0.1, 200);

  // Warm, low light that follows the time in Sydney
  const key = new DirectionalLight(light.key.color, light.key.intensity);
  key.position.set(...light.key.position);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  // Wide enough for the console, its shelf and the rug (three also applies these when it first allocates the map)
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  key.shadow.camera.updateProjectionMatrix();
  key.target.position.set(1.6, -2, 0.5);
  scene.add(key, key.target, new HemisphereLight(0xfff3e4, 0x7a5a42, light.bounce));
  const ground = new Mesh(new PlaneGeometry(80, 80), new ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR;
  ground.receiveShadow = true;
  scene.add(ground);

  const oiled = (map: Texture) => new MeshPhysicalMaterial({ map, roughness: 0.48, clearcoat: 0.3, clearcoatRoughness: 0.5 });
  const M = {
    walnut: oiled(textures.walnut[0]),
    walnutDeck: oiled(textures.walnut[1]),
    walnutLeg: oiled(textures.walnut[2]),
    walnutCrate: oiled(textures.walnut[3]),
    deckPlate: new MeshStandardMaterial({ color: 0xd9d8d3, metalness: 0.7, roughness: 0.42 }),
    alu: new MeshStandardMaterial({ color: 0xd2d1cc, metalness: 0.9, roughness: 0.3 }),
    felt: new MeshStandardMaterial({ color: 0x3b3835, roughness: 1 }),
    ink: new MeshStandardMaterial({ color: 0x262422, roughness: 0.45, metalness: 0.2 }),
    lamp: new MeshStandardMaterial({ color: 0x4a1c14, emissive: 0xd8553a, emissiveIntensity: 0 }),
    sleeveEdge: new MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.9 }),
    vinylEdge: new MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.5 }),
    stoneware: new MeshStandardMaterial({ color: 0xd9cfbf, roughness: 0.92 }),
    wax: new MeshStandardMaterial({ color: 0xf3ece0, roughness: 0.6, emissive: 0xffb070, emissiveIntensity: 0.06 }),
  };

  // The console: walnut top, splayed tapered legs, an open shelf for the collection
  const top = solid(new Mesh(new RoundedBoxGeometry(10.8, 0.3, 5.2, 4, 0.1), M.walnut));
  top.position.set(1.6, -0.15, 0);
  const shelf = solid(new Mesh(new RoundedBoxGeometry(9.7, 0.14, 4.4, 3, 0.05), M.walnut));
  shelf.position.set(1.6, -3.7, 0);
  scene.add(top, shelf);
  for (const [x, z] of LEGS) {
    const leg = solid(new Mesh(new CylinderGeometry(0.14, 0.08, 4.35, 28), M.walnutLeg));
    const sx = Math.sign(x - 1.6);
    const sz = Math.sign(z);
    leg.position.set(x + sx * 0.18, -0.3 - 2.15, z + sz * 0.12);
    leg.rotation.z = -sx * MathUtils.degToRad(4.5);
    leg.rotation.x = sz * MathUtils.degToRad(3);
    scene.add(leg);
  }

  // The rest of the collection, on edge on the shelf, as one draw call
  const count = 44;
  const spines = solid(new InstancedMesh(new BoxGeometry(0.048, 3.05, 3.05), new MeshStandardMaterial({ roughness: 0.85 }), count));
  const m4 = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const one = new Vector3(1, 1, 1);
  const tone = new Color();
  let x = -2.75;
  for (let i = 0; i < count; i++) {
    const leaning = i > count - 4;
    const lean = leaning ? MathUtils.degToRad(9 + (i - (count - 4)) * 2.5) : MathUtils.degToRad(Math.sin(i * 12.9) * 0.8);
    x += leaning ? 0.2 : 0.054;
    q.setFromEuler(e.set(0, 0, -lean));
    m4.compose(new Vector3(x + Math.sin(lean) * 1.5, SHELF_TOP + 1.525 * Math.cos(lean), 0.05 + Math.sin(i * 7.3) * 0.08), q, one);
    spines.setMatrixAt(i, m4);
    spines.setColorAt(i, tone.setHex(SPINE_TONES[(i * 7) % SPINE_TONES.length]));
  }
  const jug = lathe([[0, 0], [0.42, 0], [0.5, 0.12], [0.56, 0.45], [0.52, 0.85], [0.36, 1.15], [0.27, 1.42], [0.31, 1.56], [0.29, 1.6], [0.24, 1.6], [0.25, 1.45]], M.stoneware);
  jug.position.set(5.2, SHELF_TOP, 0.4);
  scene.add(spines, jug);
  await idle();

  // Sheepskin: twenty alpha-tested fur shells over an irregular pelt outline
  const outline: Vector2[] = [];
  const lobe = (a: number, c: number, w: number, h: number) => {
    const d = Math.atan2(Math.sin(a - c), Math.cos(a - c));
    return h * Math.exp(-((d / w) ** 2));
  };
  for (let k = 0; k < 180; k++) {
    const a = (k / 180) * Math.PI * 2;
    let r = 1 + 0.05 * Math.sin(3 * a + 0.7) + 0.022 * Math.sin(11 * a + 1.3) + 0.012 * Math.sin(23 * a + 0.4);
    r += lobe(a, 0.62, 0.1, 0.17) + lobe(a, -0.62, 0.1, 0.17) + lobe(a, Math.PI - 0.58, 0.11, 0.19) + lobe(a, Math.PI + 0.58, 0.11, 0.19) + lobe(a, Math.PI, 0.16, 0.08);
    outline.push(new Vector2(Math.cos(a) * r * 4.3, Math.sin(a) * r * 2.75));
  }
  const pelt = new ShapeGeometry(new Shape(outline), 1);
  pelt.rotateX(-Math.PI / 2);
  const rug = new Group();
  rug.position.set(1.3, FLOOR, 1.7);
  rug.rotation.y = 0.08;
  const roots = new Color(0xa3947b);
  const tips = new Color(0xf7f2ea);
  const shells = 20;
  for (let k = 0; k < shells; k++) {
    const f = k / (shells - 1);
    const material = new MeshStandardMaterial({ color: roots.clone().lerp(tips, Math.pow(f, 0.6)), roughness: 1, alphaMap: k ? textures.fur : null, alphaTest: k ? 0.08 + 0.75 * f : 0 });
    const shell = new Mesh(pelt, material);
    shell.position.y = 0.006 + k * 0.028;
    shell.scale.setScalar(1 - k * 0.006);
    shell.receiveShadow = true;
    rug.add(shell);
  }
  scene.add(rug);
  await idle();

  // Turntable: walnut frame, brushed deck plate, aluminium platter with a felt mat, tonearm, start button and lamp
  const deckFrame = solid(new Mesh(new RoundedBoxGeometry(4.6, 0.3, 3.6, 5, 0.08), M.walnutDeck));
  deckFrame.position.set(-1.0, 0.15, 0);
  const plate = solid(new Mesh(new BoxGeometry(4.34, 0.024, 3.34), M.deckPlate));
  plate.position.set(-1.0, 0.31, 0);
  const platter = new Group();
  platter.position.copy(PLATTER);
  const body = solid(new Mesh(new CylinderGeometry(1.53, 1.53, 0.14, 128), [M.alu, M.felt, M.alu]));
  body.position.y = 0.07;
  const spindle = solid(new Mesh(new CylinderGeometry(0.035, 0.035, 0.16, 16), M.alu));
  spindle.position.y = 0.21;
  platter.add(body, spindle);
  const armBase = solid(new Mesh(new CylinderGeometry(0.21, 0.23, 0.12, 48), M.alu));
  armBase.position.set(PIVOT.x, PIVOT.y + 0.06, PIVOT.z);
  const post = solid(new Mesh(new CylinderGeometry(0.05, 0.05, 0.3, 16), M.alu));
  post.position.set(PIVOT.x, PIVOT.y + 0.2, PIVOT.z);
  const arm = new Group();
  arm.position.set(PIVOT.x, ARM_UP, PIVOT.z);
  const tube = solid(new Mesh(new CylinderGeometry(0.028, 0.028, 2.5, 16), M.alu));
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 1.1;
  const head = solid(new Mesh(new BoxGeometry(0.17, 0.05, 0.34), M.ink));
  head.position.set(0, -0.03, ARM_LEN);
  const weight = solid(new Mesh(new CylinderGeometry(0.13, 0.13, 0.26, 32), M.ink));
  weight.rotation.x = Math.PI / 2;
  weight.position.z = -0.32;
  arm.add(tube, head, weight);
  const rest = solid(new Mesh(new CylinderGeometry(0.04, 0.04, 0.28, 12), M.alu));
  rest.position.set(PIVOT.x + 0.22, PIVOT.y + 0.14, PIVOT.z + 2.05);
  const button = solid(new Mesh(new CylinderGeometry(0.15, 0.15, 0.05, 40), M.alu));
  button.position.set(0.82, 0.345, 1.32);
  const lampDot = new Mesh(new CylinderGeometry(0.045, 0.045, 0.03, 20), M.lamp);
  lampDot.position.set(0.42, 0.335, 1.42);
  scene.add(deckFrame, plate, platter, armBase, post, arm, rest, button, lampDot);

  // Candle in a stoneware dish; it flickers only while something moves, so an idle page costs nothing
  const candle = new Group();
  candle.position.set(1.95, 0, 1.75);
  const wax = solid(new Mesh(new CylinderGeometry(0.3, 0.31, 0.8, 40), M.wax));
  wax.position.y = 0.46;
  const pool = new Mesh(new CircleGeometry(0.25, 32), new MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.3 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.861;
  const wick = new Mesh(new CylinderGeometry(0.012, 0.012, 0.1, 8), M.ink);
  wick.position.y = 0.91;
  const flame = new Mesh(new LatheGeometry(curve([[0, 0], [0.05, 0.03], [0.075, 0.1], [0.062, 0.2], [0.032, 0.29], [0, 0.36]]), 24), new MeshBasicMaterial({ color: 0xffd896 }));
  flame.position.y = 0.93;
  const glow = new Sprite(new SpriteMaterial({ map: textures.glow, blending: AdditiveBlending, depthWrite: false, opacity: light.glow.opacity }));
  glow.position.y = 1.08;
  glow.scale.setScalar(light.glow.scale);
  const candleLight = new PointLight(0xffa552, light.candle, 9, 2);
  candleLight.position.y = 1.2;
  const dish = lathe([[0, 0], [0.5, 0], [0.57, 0.04], [0.56, 0.11], [0.51, 0.11], [0.44, 0.06], [0, 0.06]], M.stoneware);
  candle.add(dish, wax, pool, wick, flame, glow, candleLight);
  scene.add(candle);
  await idle();

  // The crate: walnut, open at the top, the records standing in it with their covers facing out
  const crate = new Group();
  crate.position.copy(CRATE);
  const { width: CW, depth: CD, wall: CT, floor: CF } = CRATE_SIZE;
  const crateWalls: Mesh[] = [];
  const wall = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const mesh = solid(new Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.03), M.walnutCrate));
    mesh.position.set(px, py, pz);
    crate.add(mesh);
    crateWalls.push(mesh);
  };
  wall(CW, CF, CD, 0, CF / 2, 0);
  wall(CW, 0.75, CT, 0, 0.375, CD / 2 - CT / 2);
  wall(CW, 1.2, CT, 0, 0.6, -CD / 2 + CT / 2);
  wall(CT, 0.95, CD, -CW / 2 + CT / 2, 0.475, 0);
  wall(CT, 0.95, CD, CW / 2 - CT / 2, 0.475, 0);
  scene.add(crate);

  const vinyl = new MeshPhysicalMaterial({ map: textures.grooves, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.22 });
  const sleeveShape = new BoxGeometry(SLEEVE, SLEEVE, 0.04);
  const discShape = new CylinderGeometry(1.45, 1.45, 0.02, 128);
  const labelShape = new CircleGeometry(0.48, 64);
  const holeShape = new CircleGeometry(0.04, 24);
  const holeMaterial = new MeshBasicMaterial({ color: 0x111111 });
  const records = covers.map((cover, i): CrateRecord => {
    const holder = new Group();
    holder.position.set(0, CF, slotZ(i, covers.length));
    holder.rotation.x = tiltFor(i, 0);
    crate.add(holder);
    const front = new MeshStandardMaterial({ map: cover, roughness: 0.75 });
    const back = new MeshStandardMaterial({ color: SLEEVE_BACKS[i % SLEEVE_BACKS.length], roughness: 0.9 });
    const sleeve = solid(new Mesh(sleeveShape, [M.sleeveEdge, M.sleeveEdge, M.sleeveEdge, M.sleeveEdge, front, back]));
    sleeve.position.y = SLEEVE / 2;
    sleeve.userData.index = i;
    holder.add(sleeve);
    const disc = new Group();
    const label = new Mesh(labelShape, new MeshStandardMaterial({ map: cover, roughness: 0.8 }));
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.0106;
    const hole = new Mesh(holeShape, holeMaterial);
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.011;
    disc.add(solid(new Mesh(discShape, [M.vinylEdge, vinyl, M.vinylEdge])), label, hole);
    disc.visible = false;
    scene.add(disc);
    return { holder, sleeve, disc, baseY: holder.position.y };
  });

  return { scene, camera, platter, arm, button, lamp: M.lamp, candle: { light: candleLight, flame, intensity: light.candle }, crateWalls, records };
}
```

- [ ] **Step 3: Write the render loop**

Create `src/deck/scene/loop.ts`:

```ts
import type { WebGLRenderer } from "three";
import type { Stage } from "./build";
import type { Tweens } from "./tween";

export interface Loop {
  /** Draws a frame soon, if the canvas can be seen */
  invalidate(): void;
  /** Platter speed to ease towards, in radians a second */
  spinTo(target: number): void;
  setScratching(on: boolean): void;
  setVisible(visible: boolean): void;
  stop(): void;
  readonly frames: number;
}

const SPIN_FPS = 30;

// Renders on demand (spec 5.2): a frame only while something moves or the platter spins, never off screen, and at
// most 30 frames a second while the spinning platter is the only thing moving. The candle flickers only then too.
export function createLoop({ renderer, stage, tweens, reduce, onFrame }: { renderer: WebGLRenderer; stage: Stage; tweens: Tweens; reduce: boolean; onFrame: () => void }): Loop {
  const { scene, camera, platter, candle } = stage;
  let raf = 0;
  let last = 0;
  let lastDraw = -Infinity;
  let omega = 0;
  let omegaTarget = 0;
  let scratching = false;
  let visible = false;
  let stopped = false;
  let dirty = true;
  let frames = 0;

  function flicker(now: number) {
    const t = now / 1000;
    const f = 1 + 0.07 * Math.sin(t * 12.7) + 0.045 * Math.sin(t * 23.3 + 1.1) + 0.03 * Math.sin(t * 41.9 + 2.3);
    candle.light.intensity = candle.intensity * f;
    candle.flame.scale.set(1 - (f - 1) * 0.6, f, 1 - (f - 1) * 0.6);
    candle.flame.rotation.z = Math.sin(t * 3.1) * 0.05;
  }

  function tick(now: number) {
    raf = 0;
    if (stopped || !visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const tweening = tweens.step(now);
    omega += (omegaTarget - omega) * (1 - Math.exp(-dt * 3.2));
    if (omegaTarget === 0 && Math.abs(omega) < 0.0005) omega = 0;
    platter.rotation.y -= omega * dt;
    const moving = tweening || omega > 0 || scratching;
    const spinningOnly = moving && !tweening && !scratching;
    if (dirty || !spinningOnly || now - lastDraw >= 1000 / SPIN_FPS - 1) {
      if (moving && !reduce) flicker(now);
      renderer.render(scene, camera);
      frames += 1;
      lastDraw = now;
      dirty = false;
      onFrame();
    }
    if (moving || dirty) raf = requestAnimationFrame(tick);
  }

  function invalidate() {
    dirty = true;
    if (raf || stopped || !visible) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  return {
    invalidate,
    spinTo(target) {
      omegaTarget = target;
      invalidate();
    },
    setScratching(on) {
      scratching = on;
      if (on) {
        omega = 0;
        omegaTarget = 0;
      }
      invalidate();
    },
    setVisible(next) {
      visible = next;
      if (next) invalidate();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    get frames() {
      return frames;
    },
  };
}
```

- [ ] **Step 4: Write the journeys**

Create `src/deck/scene/journeys.ts` (ported from prototype lines 254 to 369; the runner, not the scene, now owns `want` and `current`):

```ts
import { Quaternion, Vector3, type Object3D } from "three";
import type { DeckState } from "../types";
import type { CrateRecord, Stage } from "./build";
import { ARM_DOWN, ARM_UP, FLY_PEAK, OMEGA, PLATTER, RECORD_Y, SLEEVE, playAngle, tiltFor } from "./layout";
import type { Loop } from "./loop";
import { easeInOut, easeOut, type Ease, type Tweens } from "./tween";

export type Preview = "play" | "prev" | "next" | null;

export interface Journeys {
  flip(browsed: number): Promise<void>;
  load(index: number, wanted: () => boolean): Promise<void>;
  unload(index: number): Promise<void>;
  /** Poses the deck to match the runner without animating (the scene arriving mid-session) */
  sync(state: DeckState): void;
  /** Hover preview: the cover lifts (play), the browsed record starts to tip (next) or the nearest tipped one starts to rise (prev) */
  preview(action: Preview): void;
}

// A flat record turned upright, label facing out, as it stands in its sleeve
const STAND = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
const FLAT = new Quaternion();

// Every move is physical: a record rises out of its sleeve, travels to the platter and goes back the same way.
// Only the deck runner calls load and unload, one at a time, so two journeys never overlap.
export function createJourneys(stage: Stage, tweens: Tweens, loop: Loop, reduce: boolean): Journeys {
  const { scene, platter, arm, records } = stage;
  const PLAY_ANGLE = playAngle();
  let shown = 0;
  let previewing: Preview = null;

  const moveTo = (o: Object3D, to: Vector3, ms: number, ease?: Ease) => {
    const from = o.position.clone();
    return tweens.tween(ms, (k) => void o.position.lerpVectors(from, to, k), ease);
  };
  const turnTo = (o: Object3D, y: number, ms: number, ease?: Ease) => {
    const from = o.rotation.y;
    return tweens.tween(ms, (k) => void (o.rotation.y = from + (y - from) * k), ease);
  };
  // Keyed, so fast flips and hovers retarget instead of fighting
  const tiltTo = (r: CrateRecord, x: number, ms: number) => {
    const from = r.holder.rotation.x;
    return tweens.tween(ms, (k) => void (r.holder.rotation.x = from + (x - from) * k), easeOut, `${r.holder.uuid}:tilt`);
  };
  const liftTo = (r: CrateRecord, by: number, ms: number) => {
    const from = r.holder.position.y;
    const to = r.baseY + by;
    return tweens.tween(ms, (k) => void (r.holder.position.y = from + (to - from) * k), easeOut, `${r.holder.uuid}:lift`);
  };
  // An arc through a raised midpoint while the record turns between standing and flat
  const fly = (o: Object3D, to: Vector3, toQ: Quaternion, ms: number) => {
    const p0 = o.position.clone();
    const p2 = to.clone();
    const p1 = p0.clone().lerp(p2, 0.5);
    p1.y = Math.max(FLY_PEAK, p0.y, p2.y);
    const q0 = o.quaternion.clone();
    return tweens.tween(
      ms,
      (k) => {
        const a = (1 - k) * (1 - k);
        const b = 2 * (1 - k) * k;
        const c = k * k;
        o.position.set(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y, a * p0.z + b * p1.z + c * p2.z);
        o.quaternion.slerpQuaternions(q0, toQ, k);
      },
      easeInOut,
    );
  };

  const sleeveCentre = (r: CrateRecord) => {
    r.holder.updateWorldMatrix(true, false);
    return r.holder.localToWorld(new Vector3(0, SLEEVE / 2, 0));
  };
  const pulled = (r: CrateRecord) => sleeveCentre(r).add(new Vector3(-3.2, 0, 0));
  const standing = (r: CrateRecord) => r.holder.getWorldQuaternion(new Quaternion()).multiply(STAND);
  const onPlatter = () => new Vector3(PLATTER.x, RECORD_Y, PLATTER.z);
  const nudge = (j: number) => (previewing === "next" && j === shown ? 0.11 : previewing === "prev" && j === shown - 1 ? -0.1 : 0);
  const settle = (ms: number) => Promise.all(records.map((r, j) => tiltTo(r, tiltFor(j, shown) + nudge(j), ms))).then(() => {});
  const lampOn = (on: boolean) => {
    stage.lamp.emissiveIntensity = on ? 2.2 : 0;
    loop.invalidate();
  };

  function flip(browsed: number) {
    shown = Math.max(0, Math.min(records.length - 1, browsed));
    return settle(280);
  }

  async function load(index: number, wanted: () => boolean) {
    const r = records[index];
    previewing = null;
    await liftTo(r, 0.95, 300);
    scene.attach(r.disc); // every journey travels in world space, whatever the record was attached to
    r.disc.position.copy(sleeveCentre(r));
    r.disc.quaternion.copy(standing(r));
    r.disc.visible = true;
    await moveTo(r.disc, pulled(r), 440);
    void liftTo(r, 0, 280);
    await fly(r.disc, onPlatter().setY(RECORD_Y + 0.5), FLAT, 720);
    await moveTo(r.disc, onPlatter(), 200);
    platter.attach(r.disc);
    if (!wanted()) return; // changed their mind on the way: no needle, the runner takes it back
    loop.spinTo(reduce ? 0 : OMEGA);
    await turnTo(arm, -PLAY_ANGLE, 560, easeInOut);
    await moveTo(arm, arm.position.clone().setY(ARM_DOWN), 160);
    lampOn(true);
  }

  async function unload(index: number) {
    const r = records[index];
    previewing = null;
    lampOn(false);
    loop.spinTo(0);
    if (arm.rotation.y !== 0) {
      await moveTo(arm, arm.position.clone().setY(ARM_UP), 150);
      await turnTo(arm, 0, 520, easeInOut);
    }
    scene.attach(r.disc);
    await moveTo(r.disc, r.disc.position.clone().setY(RECORD_Y + 0.5), 200);
    if (shown !== index) void flip(index);
    void liftTo(r, 0.95, 300);
    await tweens.wait(300);
    await fly(r.disc, pulled(r), standing(r), 720);
    await moveTo(r.disc, sleeveCentre(r), 400);
    r.disc.visible = false;
    await liftTo(r, 0, 280);
  }

  function sync(state: DeckState) {
    shown = state.browsed;
    previewing = null;
    records.forEach((r, j) => {
      r.holder.rotation.x = tiltFor(j, shown);
      r.holder.position.y = r.baseY;
      scene.attach(r.disc);
      r.disc.visible = false;
    });
    arm.rotation.y = 0;
    arm.position.y = ARM_UP;
    lampOn(false);
    loop.spinTo(0);
    // A record at rest on the platter; one mid-journey starts from its sleeve, because the runner is about to move it
    if (state.current !== null && !state.busy) {
      const disc = records[state.current].disc;
      disc.position.copy(onPlatter());
      disc.quaternion.identity();
      disc.visible = true;
      platter.attach(disc);
      if (state.want === state.current) {
        arm.rotation.y = -PLAY_ANGLE;
        arm.position.y = ARM_DOWN;
        lampOn(true);
        loop.spinTo(reduce ? 0 : OMEGA);
      }
    }
    loop.invalidate();
  }

  function preview(action: Preview) {
    if (action === previewing) return;
    const wasPlay = previewing === "play";
    previewing = action;
    const r = records[shown];
    if (wasPlay || action === "play") void liftTo(r, action === "play" ? 0.12 : 0, 160);
    void settle(170);
  }

  return { flip, load, unload, sync, preview };
}
```

- [ ] **Step 5: Write the test hooks and the mount**

Create `src/deck/scene/hooks.ts`:

```ts
import { Vector3, type WebGLRenderer } from "three";
import type { Deck } from "../types";
import type { Stage } from "./build";
import { PLATTER, RECORD_Y, SLEEVE } from "./layout";
import type { Loop } from "./loop";
import type { Tweens } from "./tween";

type Point = { x: number; y: number; z: number };

export interface SceneHooks {
  frames(): number;
  tweens(): number;
  tilts(): number[];
  spin(): number;
  offsets(): { i: number; parent: "platter" | "scene"; visible: boolean; dx: number; dz: number; y: number; lifted: number }[];
  /** Client (page) coordinates of a world point */
  toScreen(x: number, y: number, z: number): { x: number; y: number };
  platterAt(): Point;
  coverAt(): Point;
  /** On-screen box of the browsed record's sleeve, in client pixels */
  coverRect(): { x: number; y: number; width: number; height: number };
  loseContext(): void;
}

// A test-only window into the scene (spec 5.5). Installed only when __TEST_HOOKS__ is true, so production drops it.
export function installHooks({ renderer, stage, tweens, loop, deck }: { renderer: WebGLRenderer; stage: Stage; tweens: Tweens; loop: Loop; deck: Deck }): void {
  const canvas = renderer.domElement;
  const screen = (point: Vector3) => {
    const box = canvas.getBoundingClientRect();
    const p = point.clone().project(stage.camera);
    return { x: box.left + (p.x * 0.5 + 0.5) * box.width, y: box.top + (-p.y * 0.5 + 0.5) * box.height };
  };
  const browsed = () => {
    const record = stage.records[deck.getState().browsed];
    record.holder.updateWorldMatrix(true, false);
    return record;
  };
  window.__deckScene = {
    frames: () => loop.frames,
    tweens: () => tweens.count,
    tilts: () => stage.records.map((r) => +r.holder.rotation.x.toFixed(3)),
    spin: () => +stage.platter.rotation.y.toFixed(3),
    offsets: () =>
      stage.records.map((r, i) => {
        const at = r.disc.getWorldPosition(new Vector3());
        return {
          i,
          parent: r.disc.parent === stage.platter ? ("platter" as const) : ("scene" as const),
          visible: r.disc.visible,
          dx: +(at.x - PLATTER.x).toFixed(3),
          dz: +(at.z - PLATTER.z).toFixed(3),
          y: +at.y.toFixed(3),
          lifted: +(r.holder.position.y - r.baseY).toFixed(3),
        };
      }),
    toScreen: (x, y, z) => screen(new Vector3(x, y, z)),
    platterAt: () => ({ x: PLATTER.x, y: RECORD_Y, z: PLATTER.z }),
    coverAt: () => {
      const centre = browsed().holder.localToWorld(new Vector3(0, SLEEVE / 2, 0));
      return { x: centre.x, y: centre.y + 0.6, z: centre.z };
    },
    coverRect: () => {
      const holder = browsed().holder;
      const points = [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, sy]) => screen(holder.localToWorld(new Vector3((sx * SLEEVE) / 2, sy * SLEEVE, 0))));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    },
    loseContext: () => renderer.getContext().getExtension("WEBGL_lose_context")?.loseContext(),
  };
}
```

In `src/env.d.ts`, add inside `interface Window`, after `__deck`:

```ts
  __deckScene?: import("./deck/scene/hooks").SceneHooks;
```

Create `src/deck/scene.ts`:

```ts
import type { Deck, DeckView } from "./types";
import { buildStage, createRenderer } from "./scene/build";
import { DESKTOP, PHONE, frame } from "./scene/framing";
import { installHooks } from "./scene/hooks";
import { createJourneys } from "./scene/journeys";
import { lightFor } from "./scene/lighting";
import { createLoop } from "./scene/loop";
import { loadCovers, makeTextures } from "./scene/textures";
import { createTweens } from "./scene/tween";

const PHONE_WIDTH = "(max-width: 680px)";

// The scene chunk (spec 5.2). Builds the room in idle slices and compiles its shaders before the first frame, then
// attaches to the deck runner as its view. The canvas replaces the poster on its first frame, with no fade.
export async function mount(host: HTMLElement, deck: Deck): Promise<DeckView> {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = createRenderer();
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  const [textures, covers] = await Promise.all([makeTextures(renderer), loadCovers(deck.tracks.map((track) => track.cover))]);
  const stage = await buildStage(renderer, textures, covers, lightFor(new Date()));
  await renderer.compileAsync(stage.scene, stage.camera);

  const tweens = createTweens(() => loop.invalidate());
  const loop = createLoop({ renderer, stage, tweens, reduce, onFrame: () => host.classList.add("live") });
  const journeys = createJourneys(stage, tweens, loop, reduce);
  host.appendChild(canvas);

  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    frame(stage.camera, matchMedia(PHONE_WIDTH).matches ? PHONE : DESKTOP, width, height);
    loop.invalidate();
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(host);
  resize();
  journeys.sync(deck.getState());

  // Off screen, in a hidden tab, under reduced motion or without a context, steps finish at once and nothing renders
  let onScreen = false;
  let lost = false;
  const visibility = () => {
    tweens.setInstant(reduce || lost || !onScreen || document.hidden);
    loop.setVisible(onScreen && !lost && !document.hidden);
  };
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    visibility();
  });
  watcher.observe(host);
  document.addEventListener("visibilitychange", visibility);
  visibility();

  const view: DeckView = {
    flip: (index) => journeys.flip(index),
    load: (index, wanted) => journeys.load(index, wanted),
    unload: (index) => journeys.unload(index),
    update: (state) => {
      if (state.busy) journeys.preview(null);
      // A record that landed while the scene was still arriving: pose it now the runner is idle
      else if (state.current !== null && stage.records[state.current].disc.parent !== stage.platter) journeys.sync(state);
    },
  };

  // Losing the context brings the poster back; the list keeps working
  canvas.addEventListener(
    "webglcontextlost",
    () => {
      lost = true;
      visibility(); // finishes a journey in flight at once, so the runner never waits on a dead scene
      loop.stop();
      watcher.disconnect();
      resizer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      host.classList.remove("live");
      canvas.remove();
      deck.disconnect(view);
    },
    { once: true },
  );

  if (__TEST_HOOKS__) installHooks({ renderer, stage, tweens, loop, deck });
  return view;
}
```

- [ ] **Step 6: Write the loader and wire it in**

Create `src/scripts/deck-scene.ts`:

```ts
import type { Deck, DeckView } from "../deck/types";

// Loads the 3D scene after the page has loaded, in an idle moment, once the row is within 200px of the viewport
// (spec 5.2). This loader is a hashed file like any chunk: if a newer deploy removed it, the poster and the list
// carry on. It imports only types from the deck, so the runner stays inlined.
type Host = HTMLElement & { deck?: Deck };

const host = document.querySelector<Host>("[data-deck]");
let booted = false;

function webgl(): boolean {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

function boot(target: Host) {
  const deck = target.deck;
  if (booted || !deck || !webgl()) return;
  booted = true; // one scene per page, however often this is asked
  const scene: Promise<DeckView | null> = import("../deck/scene").then((module) => module.mount(target, deck));
  deck.connect(scene);
}

function whenNear(target: Host) {
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      boot(target);
    },
    { rootMargin: "200px" },
  );
  near.observe(target);
}

if (host) {
  const start = () => {
    const later = () => whenNear(host);
    if ("requestIdleCallback" in window) requestIdleCallback(later, { timeout: 2000 });
    else setTimeout(later, 200);
  };
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}
```

In `src/components/Turntable.astro`, add after the existing deck script tag:

```astro
<script>
  import "../scripts/deck-scene";
</script>
```

In `src/styles/deck.css`, add after the `.deck` rule:

```css
/* The scene's canvas covers the deck box and takes over on its first frame, with no fade */
.deck canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; visibility: hidden; }
.deck.live canvas { visibility: visible; }
```

- [ ] **Step 7: Build and check the chunks**

Run: `bun run typecheck && bun run build`
Expected: 0 errors; build succeeds. Vite warns that a chunk is larger than 500 kB: that is the scene (about 545KB raw, 140KB gzipped) and is expected. Do not split it; the specs and budgets look for one `scene.<hash>.js`.

Run: `ls dist/client/_astro/ && gzip -c dist/client/_astro/scene.*.js | wc -c`
Expected: two files, the loader (`Turntable.astro_astro_type_script_index_1_lang.<hash>.js` or similar) and `scene.<hash>.js`; the scene chunk gzips to under 194560 bytes (the probe measured Three.js alone at about 131KB). The deck runner is still inline: `grep -c "couldn't play" dist/client/_astro/*.js` prints `0` for both files. If the scene chunk has a different name, use that name in the `SCENE` patterns in the specs below.

Run: `bun run build && (grep -rq "__deck" dist && echo "LEAK" || echo "no test hooks in the production build")`
Expected: `no test hooks in the production build`.

- [ ] **Step 8: Add the scene helpers to the e2e helpers**

Append to `tests/e2e/deck.ts`:

```ts
export const hasWebGL = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("canvas");
    return (probe.getContext("webgl2") ?? probe.getContext("webgl")) !== null;
  });

/** Scrolls the turntable into view and waits for the scene to take over from the poster */
export async function openScene(page: Page) {
  await page.goto("/");
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 45_000 });
}

/** Waits until no journey runs and nothing in the scene is moving (the spinning platter aside) */
export async function settled(page: Page, timeout = 30_000) {
  await expect.poll(() => page.evaluate(() => !window.__deck!.state().busy && window.__deckScene!.tweens() === 0), { timeout }).toBe(true);
}

/** Every sleeve seated in the crate; only the current record, if any, is out, centred on the platter */
export async function expectSeated(page: Page) {
  const { state, offsets } = await page.evaluate(() => ({ state: window.__deck!.state(), offsets: window.__deckScene!.offsets() }));
  for (const record of offsets) {
    expect(Math.abs(record.lifted), `sleeve ${record.i} seated`).toBeLessThan(0.001);
    if (record.i === state.current) {
      expect(record).toMatchObject({ parent: "platter", visible: true });
      expect(Math.abs(record.dx), `record ${record.i} centred`).toBeLessThan(0.01);
      expect(Math.abs(record.dz), `record ${record.i} centred`).toBeLessThan(0.01);
    } else {
      expect(record.visible, `record ${record.i} back in its sleeve`).toBe(false);
    }
  }
}

/** Puts the canvas just above the viewport, with the track list still in view */
export async function scrollDeckAway(page: Page) {
  await page.evaluate(() => window.scrollBy(0, document.querySelector("[data-deck]")!.getBoundingClientRect().bottom + 4));
}

/** The record's centre on screen and the on-screen size of 0.9 units: on the vinyl, clear of the 0.48 label, inside the 1.45 edge */
export const platterOnScreen = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__deckScene!;
    const p = scene.platterAt();
    const centre = scene.toScreen(p.x, p.y, p.z);
    return { ...centre, rx: scene.toScreen(p.x + 0.9, p.y, p.z).x - centre.x, ry: scene.toScreen(p.x, p.y, p.z + 0.9).y - centre.y };
  });
```

- [ ] **Step 9: Write the scene specs**

Create `tests/e2e/deck-scene.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { deckState, expectSeated, hasWebGL, openScene, playing, settled, withoutWebGL } from "./deck";

test.describe.configure({ timeout: 90_000 });

const SCENE = /\/_astro\/scene\.[\w-]+\.js$/;

test("the scene loads only after the page has loaded and the row comes near", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "request timing, checked once");
  await page.setViewportSize({ width: 1280, height: 400 });
  const requested: string[] = [];
  page.on("request", (request) => {
    if (SCENE.test(request.url())) requested.push(request.url());
  });
  await page.goto("/");
  expect((await page.locator("[data-deck]").boundingBox())!.y).toBeGreaterThan(400 + 200);
  await page.waitForTimeout(2500); // load, an idle callback and then some
  expect(requested).toEqual([]);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live canvas")).toHaveCount(1, { timeout: 60_000 });
  expect(requested).toHaveLength(1);
  await expect(page.locator("[data-deck] canvas")).toHaveAttribute("aria-hidden", "true");
});

test("a press during the scene download waits for it, then plays with one scene", async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
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
  const row = page.locator(".tracks li").first();
  await row.locator("button").click();
  await expect(row.locator(".st")).toHaveText("cueing");
  await page.waitForTimeout(500);
  expect((await deckState(page)).playing).toBeNull();
  release();
  await playing(page, 0, 60_000);
  await expect(page.locator("[data-deck] canvas")).toHaveCount(1);
  await settled(page);
  await expectSeated(page);
});

test("without WebGL the scene never loads and the list plays and stops every record", async ({ page }) => {
  await withoutWebGL(page);
  await page.goto("/");
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-deck] canvas")).toHaveCount(0);
  const rows = page.locator(".tracks li");
  for (let i = 0; i < (await rows.count()); i++) {
    await rows.nth(i).locator("button").click();
    await playing(page, i);
    await page.waitForTimeout(460);
    await rows.nth(i).locator("button").click();
    await playing(page, null);
  }
});

test("losing the WebGL context mid-journey drops the scene and the list keeps working", async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
  const rows = page.locator(".tracks li");
  await rows.first().locator("button").click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__deckScene!.loseContext());
  await expect(page.locator("[data-deck] canvas")).toHaveCount(0);
  await expect(page.locator("[data-deck].live")).toHaveCount(0);
  await playing(page, 0);
  expect((await deckState(page)).scene).toBe(false);
  await page.waitForTimeout(460);
  await rows.nth(1).locator("button").click();
  await playing(page, 1);
});
```

Create `tests/e2e/deck-journeys.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { audioState, deckState, expectSeated, hasWebGL, openScene, playing, scrollDeckAway, settled } from "./deck";

// The playback checks from spec 5.5, driven from the list
test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
});

const press = (page: Page, index: number) => page.locator(".tracks li").nth(index).locator("button").click();
const spin = (page: Page) => page.evaluate(() => window.__deckScene!.spin());

test("play lands the record centred on a spinning platter; stop puts everything back", async ({ page }) => {
  await press(page, 0);
  await playing(page, 0);
  await settled(page);
  await expectSeated(page);
  const before = await spin(page);
  await expect.poll(() => spin(page)).not.toBe(before);
  await page.waitForTimeout(460);
  await press(page, 0);
  await playing(page, null);
  await settled(page);
  await expectSeated(page);
});

test("two different records within 150ms: only the second ends on the platter", async ({ page }) => {
  await press(page, 0);
  await page.waitForTimeout(100);
  await press(page, 1);
  await playing(page, 1, 40_000);
  await settled(page);
  await expectSeated(page);
});

test("the same record twice within 450ms plays once", async ({ page }) => {
  await page.locator(".tracks li").first().locator("button").dblclick();
  await playing(page, 0);
  expect((await deckState(page)).want).toBe(0);
  await settled(page);
  await expectSeated(page);
});

test("mashing four records ends on the last", async ({ page }) => {
  for (const index of [0, 1, 2, 3]) {
    await press(page, index);
    await page.waitForTimeout(60);
  }
  await playing(page, 3, 60_000);
  await settled(page);
  await expectSeated(page);
});

test("changing mind mid-flight twice ends on the last choice", async ({ page }) => {
  await press(page, 0);
  await page.waitForTimeout(800);
  await press(page, 1);
  await page.waitForTimeout(800);
  await press(page, 2);
  await playing(page, 2, 60_000);
  await settled(page);
  await expectSeated(page);
});

test("scrolling away mid-flight finishes the journey at once", async ({ page }) => {
  await press(page, 1);
  await page.waitForTimeout(400);
  await scrollDeckAway(page);
  await playing(page, 1, 5000);
  expect((await audioState(page)).paused).toBe(false);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await settled(page);
  await expectSeated(page);
});

test("off screen the list starts and stops audio without drawing a frame", async ({ page }) => {
  await scrollDeckAway(page);
  await page.waitForTimeout(200);
  const frames = await page.evaluate(() => window.__deckScene!.frames());
  await press(page, 2);
  await playing(page, 2, 5000);
  expect((await audioState(page)).paused).toBe(false);
  await page.waitForTimeout(460);
  await press(page, 2);
  await playing(page, null, 5000);
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
  expect(await page.evaluate(() => window.__deckScene!.frames())).toBe(frames);
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await settled(page);
  await expectSeated(page);
});

test("a track that can't play flies home and the row says so", async ({ page }) => {
  await page.route("**/media/audio/no-bad-feelings-today.mp3", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
  await press(page, 2);
  await expect(page.locator(".tracks li").nth(2).locator(".st")).toHaveText("couldn't play", { timeout: 30_000 });
  await playing(page, null);
  await settled(page);
  await expectSeated(page);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a record lands at once and the platter does not spin", async ({ page }) => {
    const before = await spin(page);
    await press(page, 2);
    await playing(page, 2, 5000);
    await settled(page);
    await expectSeated(page);
    await page.waitForTimeout(500);
    expect(await spin(page)).toBe(before);
  });
});
```

- [ ] **Step 10: Run the deck specs and the whole suite**

Run: `bun run build:test && bun run test:e2e tests/e2e/deck-scene.spec.ts tests/e2e/deck-journeys.spec.ts --project=chromium`
Expected: all pass. Journeys are timed (about 2.5s each), so the file takes a minute or two. If `openScene` times out, open the page in a headed browser (`--headed`) and read the console: a failed `compileAsync` or texture step logs there.

Run: `bun run test:e2e tests/e2e/deck-scene.spec.ts tests/e2e/deck-journeys.spec.ts --project=webkit`
Expected: all pass, or the WebGL-dependent tests skip with "no WebGL in this browser here" (record which in the report). The no-WebGL test must pass either way.

Run: `bun run typecheck && bun run test:unit && bun run test:e2e`
Expected: 0 errors; everything passes (the earlier `deck-list` specs now run with the scene loading nearby, which only makes their journeys slower).

- [ ] **Step 11: Commit**

```bash
git add src/deck/scene.ts src/deck/scene src/scripts/deck-scene.ts src/env.d.ts src/components/Turntable.astro src/styles/deck.css tests/e2e/deck.ts tests/e2e/deck-scene.spec.ts tests/e2e/deck-journeys.spec.ts
git commit -m "feat: the 3D listening corner: walnut console, journeys and an on-demand render loop"
```

---

### Task 9: the crate control and pointer input

The HTML pill anchored under the crate (`‹ ▶ title ›`) with fixed geometry, and 3D input: clicking the visible cover or the crate plays or stops, clicking a record in front or behind flips one step, hovering previews the click and shades the matching control button (spec 5.4).

**Files:**
- Create: `src/deck/scene/hud.ts`, `src/deck/scene/pointer.ts`, `tests/unit/hud.test.ts`, `tests/e2e/deck-crate.spec.ts`
- Modify: `src/deck/scene.ts` (full replacement below), `src/styles/deck.css`

**Interfaces:**
- Consumes: `Deck`, `DeckState` (types); `Stage` (Task 8: `records[i].sleeve.userData.index`, `crateWalls`, `button`, `platter`, `camera`); `Journeys.preview` and `Preview` (Task 8); `toCanvas`, `HUD_ANCHOR` (Task 7).
- Produces:
  - `hud.ts`: `interface Hud { render(state): void; hint(action: Preview): void; place(x, y, width, height): void; remove(): void }`, `createHud(host: HTMLElement, deck: Deck): Hud`; markup `.crate-hud[role=group][aria-label="record crate"]` with buttons `[data-act=prev|play|next]`, the play button carrying `data-state="play"|"cueing"|"stop"`
  - `pointer.ts`: `interface Pointer { clearPreview(): void }`, `bindPointer(canvas, { deck, stage, journeys, hud }): Pointer`

- [ ] **Step 1: Write the failing crate control tests**

Create `tests/unit/hud.test.ts`:

```ts
import { parseHTML } from "linkedom";
import { describe, expect, test, vi } from "vitest";
import { createHud } from "../../src/deck/scene/hud";
import type { Deck, DeckState } from "../../src/deck/types";

const idle: DeckState = { want: null, current: null, browsed: 0, busy: false, playing: null, failed: null, scene: true };

function setup(titles = ["simple things", "nyc in 1940", "light it up"], state: Partial<DeckState> = {}) {
  const window = parseHTML('<div class="deck"></div>');
  const host = window.document.querySelector(".deck") as unknown as HTMLElement;
  const current = { ...idle, ...state };
  const deck = {
    tracks: titles.map((title) => ({ title, artist: "x", src: "", cover: "" })),
    getState: () => current,
    toggle: vi.fn(),
    browse: vi.fn(),
  };
  const hud = createHud(host, deck as unknown as Deck);
  const button = (act: string) => host.querySelector(`[data-act="${act}"]`)!;
  const event = (type: string, props: Record<string, unknown> = {}) => Object.assign(new window.Event(type), props);
  const click = (act: string) => button(act).dispatchEvent(event("click"));
  return { hud, deck, host, button, click, event };
}

const arrows = (button: (act: string) => Element) => [button("prev").getAttribute("aria-disabled"), button("next").getAttribute("aria-disabled")];

describe("crate control", () => {
  test("is a named group of three buttons", () => {
    const { host } = setup();
    const group = host.querySelector(".crate-hud")!;
    expect([group.getAttribute("role"), group.getAttribute("aria-label")]).toEqual(["group", "record crate"]);
    expect([...group.querySelectorAll("button")].map((b) => b.getAttribute("data-act"))).toEqual(["prev", "play", "next"]);
    expect([...group.querySelectorAll("button")].map((b) => b.getAttribute("type"))).toEqual(["button", "button", "button"]);
  });

  test("always shows the browsed title; the icon state and the name say what a press does", () => {
    const { hud, button } = setup();
    const play = button("play");
    hud.render({ ...idle, browsed: 1 });
    expect([play.textContent, play.getAttribute("data-state"), play.getAttribute("aria-label")]).toEqual(["nyc in 1940", "play", "play nyc in 1940"]);
    hud.render({ ...idle, browsed: 1, want: 1, current: 1, busy: true });
    expect([play.textContent, play.getAttribute("data-state"), play.getAttribute("aria-label")]).toEqual(["nyc in 1940", "cueing", "cueing nyc in 1940"]);
    hud.render({ ...idle, browsed: 1, want: 1, current: 1, playing: 1 });
    expect([play.textContent, play.getAttribute("data-state"), play.getAttribute("aria-label")]).toEqual(["nyc in 1940", "stop", "stop nyc in 1940"]);
    expect(play.getAttribute("title")).toBe("nyc in 1940");
  });

  test("arrows are aria-disabled at either end and while a record travels, never disabled", () => {
    const { hud, button } = setup();
    hud.render(idle);
    expect(arrows(button)).toEqual(["true", "false"]);
    hud.render({ ...idle, browsed: 2 });
    expect(arrows(button)).toEqual(["false", "true"]);
    hud.render({ ...idle, browsed: 1, busy: true });
    expect(arrows(button)).toEqual(["true", "true"]);
    expect(button("prev").hasAttribute("disabled")).toBe(false);
  });

  test("with one record both arrows are disabled and play still works", () => {
    const { hud, button, click, deck } = setup(["only one"]);
    hud.render(idle);
    expect(arrows(button)).toEqual(["true", "true"]);
    click("next");
    click("play");
    expect(deck.browse).not.toHaveBeenCalled();
    expect(deck.toggle).toHaveBeenCalledWith(0);
  });

  test("arrows browse by one and the arrow keys flip", () => {
    const { hud, click, deck, host, event } = setup(undefined, { browsed: 1 });
    hud.render({ ...idle, browsed: 1 });
    click("next");
    click("prev");
    host.querySelector(".crate-hud")!.dispatchEvent(event("keydown", { key: "ArrowRight" }));
    expect(deck.browse.mock.calls).toEqual([[2], [0], [2]]);
  });

  test("hint shades the button a click on the scene would press", () => {
    const { hud, button } = setup();
    hud.hint("next");
    expect(["prev", "play", "next"].map((act) => button(act).classList.contains("hint"))).toEqual([false, false, true]);
    hud.hint(null);
    expect(["prev", "play", "next"].some((act) => button(act).classList.contains("hint"))).toBe(false);
  });
});
```

Run: `bun run test:unit tests/unit/hud.test.ts`
Expected: FAIL, cannot resolve `../../src/deck/scene/hud`.

- [ ] **Step 2: Implement the crate control**

Create `src/deck/scene/hud.ts`:

```ts
import type { Deck, DeckState } from "../types";
import type { Preview } from "./journeys";

export interface Hud {
  render(state: DeckState): void;
  /** Shades the button a click on the scene would press */
  hint(action: Preview): void;
  /** Centres the control on the anchor, kept 8px inside the canvas */
  place(x: number, y: number, width: number, height: number): void;
  remove(): void;
}

// The crate control (spec 5.4): previous, play or stop, next. Three fixed columns and the same words in every state,
// so nothing moves whatever it says or whatever is hovered; the icon morphs between play and stop.
export function createHud(host: HTMLElement, deck: Deck): Hud {
  const el = host.ownerDocument.createElement("div");
  el.className = "crate-hud";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "record crate");
  el.innerHTML =
    '<button type="button" class="flip" data-act="prev" aria-label="previous record">‹</button>' +
    '<button type="button" class="now" data-act="play"><span class="ico" aria-hidden="true"></span><span class="t"></span></button>' +
    '<button type="button" class="flip" data-act="next" aria-label="next record">›</button>';
  host.appendChild(el);
  const [prev, now, next] = [...el.querySelectorAll<HTMLButtonElement>("button")];
  const title = now.querySelector<HTMLElement>(".t")!;
  // aria-disabled, not disabled, so focus stays on the arrow
  const usable = (button: HTMLButtonElement) => button.getAttribute("aria-disabled") !== "true";
  const browseBy = (step: number) => deck.browse(deck.getState().browsed + step);

  prev.addEventListener("click", () => {
    if (usable(prev)) browseBy(-1);
  });
  next.addEventListener("click", () => {
    if (usable(next)) browseBy(1);
  });
  now.addEventListener("click", () => deck.toggle(deck.getState().browsed));
  el.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    browseBy(event.key === "ArrowLeft" ? -1 : 1);
  });

  return {
    render(state) {
      const track = deck.tracks[state.browsed];
      const travelling = state.busy && (state.want === state.browsed || state.current === state.browsed);
      const playingThis = !state.busy && state.current === state.browsed && state.want === state.browsed;
      const mode = travelling ? "cueing" : playingThis ? "stop" : "play";
      now.dataset.state = mode;
      title.textContent = track.title;
      now.title = track.title;
      now.setAttribute("aria-label", `${mode} ${track.title}`);
      prev.setAttribute("aria-disabled", String(state.busy || state.browsed === 0));
      next.setAttribute("aria-disabled", String(state.busy || state.browsed === deck.tracks.length - 1));
    },
    hint(action) {
      for (const button of [prev, now, next]) button.classList.toggle("hint", button.dataset.act === action);
    },
    place(x, y, width, height) {
      el.style.setProperty("--deck-w", `${width}px`);
      const left = Math.max(8, Math.min(width - 8 - el.offsetWidth, x - el.offsetWidth / 2));
      const top = Math.max(8, Math.min(height - 8 - el.offsetHeight, y - el.offsetHeight / 2));
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    },
    remove() {
      el.remove();
    },
  };
}
```

Run: `bun run test:unit tests/unit/hud.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Write the pointer input**

Create `src/deck/scene/pointer.ts`:

```ts
import { Raycaster, Vector2, type Mesh, type Object3D } from "three";
import type { Deck } from "../types";
import type { Stage } from "./build";
import type { Hud } from "./hud";
import type { Journeys, Preview } from "./journeys";

type Act = "play" | "prev" | "next" | "record" | "deck";

export interface Pointer {
  clearPreview(): void;
}

// The cover you can see (or anywhere on the crate) plays or stops; records in front or behind flip by one; the
// spinning record, the platter and the start button stop. Hidden records never count as hits (spec 5.4).
export function bindPointer(canvas: HTMLCanvasElement, { deck, stage, journeys, hud }: { deck: Deck; stage: Stage; journeys: Journeys; hud: Hud }): Pointer {
  const ray = new Raycaster();
  const ndc = new Vector2();
  let previewing: Preview = null;

  function pick(event: MouseEvent): Act | null {
    const box = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const discs = stage.records.filter((r) => r.disc.visible).map((r) => r.disc);
    const targets: Object3D[] = [...stage.records.map((r) => r.sleeve), ...stage.crateWalls, stage.button, stage.platter, ...discs];
    const hit = ray.intersectObjects(targets, true)[0];
    if (!hit) return null;
    const state = deck.getState();
    const index = hit.object.userData.index as number | undefined;
    if (index !== undefined) return index === state.browsed || index === state.want ? "play" : index < state.browsed ? "prev" : "next";
    if (stage.crateWalls.includes(hit.object as Mesh)) return "play";
    const onPlatter = state.current !== null ? stage.records[state.current].disc : null;
    if (onPlatter?.visible && hit.object.parent === onPlatter) return "record";
    return "deck";
  }

  // Hover previews the click: the cover lifts, the browsed record starts to tip or the nearest tipped one starts to rise
  function preview(action: Preview) {
    if (deck.getState().busy) action = null;
    if (action === previewing) return;
    previewing = action;
    journeys.preview(action);
    hud.hint(action);
  }

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const act = pick(event);
    canvas.style.cursor = act === null ? "" : "pointer";
    preview(act === "play" || act === "prev" || act === "next" ? act : null);
  });
  canvas.addEventListener("pointerleave", () => {
    canvas.style.cursor = "";
    preview(null);
  });
  canvas.addEventListener("click", (event) => {
    const act = pick(event);
    if (act === null) return;
    const { browsed, want } = deck.getState();
    if (act === "play") deck.toggle(browsed);
    else if (act === "prev") deck.browse(browsed - 1);
    else if (act === "next") deck.browse(browsed + 1);
    else if (want !== null) deck.toggle(want); // the record, the platter or the start button: stop
  });

  return { clearPreview: () => preview(null) };
}
```

- [ ] **Step 4: Attach the control and the pointer to the scene**

Replace `src/deck/scene.ts` with:

```ts
import type { Deck, DeckView } from "./types";
import { buildStage, createRenderer } from "./scene/build";
import { DESKTOP, PHONE, frame, toCanvas } from "./scene/framing";
import { installHooks } from "./scene/hooks";
import { createHud } from "./scene/hud";
import { createJourneys } from "./scene/journeys";
import { HUD_ANCHOR } from "./scene/layout";
import { lightFor } from "./scene/lighting";
import { createLoop } from "./scene/loop";
import { bindPointer } from "./scene/pointer";
import { loadCovers, makeTextures } from "./scene/textures";
import { createTweens } from "./scene/tween";

const PHONE_WIDTH = "(max-width: 680px)";

// The scene chunk (spec 5.2). Builds the room in idle slices and compiles its shaders before the first frame, then
// attaches to the deck runner as its view. The canvas replaces the poster on its first frame, with no fade.
export async function mount(host: HTMLElement, deck: Deck): Promise<DeckView> {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = createRenderer();
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  const [textures, covers] = await Promise.all([makeTextures(renderer), loadCovers(deck.tracks.map((track) => track.cover))]);
  const stage = await buildStage(renderer, textures, covers, lightFor(new Date()));
  await renderer.compileAsync(stage.scene, stage.camera);

  const tweens = createTweens(() => loop.invalidate());
  const loop = createLoop({ renderer, stage, tweens, reduce, onFrame: () => host.classList.add("live") });
  const journeys = createJourneys(stage, tweens, loop, reduce);
  host.appendChild(canvas);
  const hud = createHud(host, deck);
  const pointer = bindPointer(canvas, { deck, stage, journeys, hud });

  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    frame(stage.camera, matchMedia(PHONE_WIDTH).matches ? PHONE : DESKTOP, width, height);
    const anchor = toCanvas(HUD_ANCHOR, stage.camera, width, height);
    hud.place(anchor.x, anchor.y, width, height);
    loop.invalidate();
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(host);
  resize();
  journeys.sync(deck.getState());
  hud.render(deck.getState());

  // Off screen, in a hidden tab, under reduced motion or without a context, steps finish at once and nothing renders
  let onScreen = false;
  let lost = false;
  const visibility = () => {
    tweens.setInstant(reduce || lost || !onScreen || document.hidden);
    loop.setVisible(onScreen && !lost && !document.hidden);
  };
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    visibility();
  });
  watcher.observe(host);
  document.addEventListener("visibilitychange", visibility);
  visibility();

  const view: DeckView = {
    flip: (index) => journeys.flip(index),
    load: (index, wanted) => journeys.load(index, wanted),
    unload: (index) => journeys.unload(index),
    update: (state) => {
      hud.render(state);
      if (state.busy) pointer.clearPreview();
      // A record that landed while the scene was still arriving: pose it now the runner is idle
      else if (state.current !== null && stage.records[state.current].disc.parent !== stage.platter) journeys.sync(state);
    },
  };

  // Losing the context brings the poster back; the list keeps working
  canvas.addEventListener(
    "webglcontextlost",
    () => {
      lost = true;
      visibility(); // finishes a journey in flight at once, so the runner never waits on a dead scene
      loop.stop();
      watcher.disconnect();
      resizer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      host.classList.remove("live");
      canvas.remove();
      hud.remove();
      deck.disconnect(view);
    },
    { once: true },
  );

  if (__TEST_HOOKS__) installHooks({ renderer, stage, tweens, loop, deck });
  return view;
}
```

- [ ] **Step 5: Style the control**

In `src/styles/deck.css`, add after the `.deck.live canvas` rule (from the prototype's `.crate-hud` rules, with `aria-disabled` in place of `:disabled`):

```css
/* Crate control: fixed geometry. Three fixed columns, so nothing moves whatever it says or whatever is hovered. */
.crate-hud {
  position: absolute; left: 0; top: 0; z-index: 2; visibility: hidden;
  display: grid; grid-template-columns: 32px min(12.5rem, calc(var(--deck-w, 100vw) - 70px)) 32px; align-items: center; padding: 3px;
  border-radius: 999px; background: rgba(251, 251, 248, .94);
  box-shadow: 0 0 0 1px rgba(31, 32, 28, .1), 0 1px 2px rgba(31, 32, 28, .06), 0 10px 22px -12px rgba(31, 32, 28, .35);
  font: 12px var(--mono); color: var(--ink);
}
.deck.live .crate-hud { visibility: visible; }
.crate-hud button { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; height: 32px; border-radius: 999px; margin: 0; padding: 0; }
.crate-hud .flip { width: 32px; font-size: 17px; line-height: 1; display: grid; place-items: center; padding-bottom: 2px; }
.crate-hud .now { width: 100%; padding: 0 12px; display: grid; grid-template-columns: 10px minmax(0, 1fr); column-gap: 9px; align-items: center; text-align: left; }
.crate-hud .now .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crate-hud .ico {
  width: 10px; height: 10px; background: var(--red);
  clip-path: polygon(8% 0, 100% 50%, 100% 50%, 8% 100%); transition: clip-path 200ms var(--ease-out), opacity 200ms ease;
}
.crate-hud .now[data-state="stop"] .ico { clip-path: polygon(8% 8%, 92% 8%, 92% 92%, 8% 92%); }
.crate-hud .now[data-state="cueing"] .ico { opacity: .35; }
.crate-hud button[aria-disabled="true"] { opacity: .28; cursor: default; }
.crate-hud button.hint, .crate-hud button:active:not([aria-disabled="true"]) { background: #ebe8df; }
@media (hover: hover) and (pointer: fine) {
  .crate-hud button { transition: background-color 200ms ease, opacity 200ms ease; }
  .crate-hud button:not([aria-disabled="true"]):hover { background: #ebe8df; }
}
.crate-hud button:focus-visible { outline: 1.5px solid var(--ink); outline-offset: -2px; border-radius: 999px; }
@media (prefers-reduced-motion: reduce) { .crate-hud .ico { transition: none; } }
```

- [ ] **Step 6: Write the crate spec**

Create `tests/e2e/deck-crate.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { deckState, expectSeated, hasWebGL, openScene, platterOnScreen, playing, settled } from "./deck";

// The crate checks from spec 5.5
test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
});

const control = (page: Page, act: string) => page.locator(`.crate-hud [data-act="${act}"]`);
const tilts = (page: Page) => page.evaluate(() => window.__deckScene!.tilts());
const coverOnScreen = (page: Page) =>
  page.evaluate(() => {
    const p = window.__deckScene!.coverAt();
    return window.__deckScene!.toScreen(p.x, p.y, p.z);
  });

test("five quick next presses stop at the last record with exact tilts", async ({ page }) => {
  // force: Playwright treats aria-disabled as disabled, and the last presses land on a disabled arrow on purpose
  for (let i = 0; i < 5; i++) await control(page, "next").click({ force: true });
  await settled(page);
  expect((await deckState(page)).browsed).toBe(3);
  expect(await tilts(page)).toEqual([0.72, 0.65, 0.58, -0.1]);
  await expect(control(page, "next")).toHaveAttribute("aria-disabled", "true");
  await expect(control(page, "prev")).toHaveAttribute("aria-disabled", "false");
  await expectSeated(page);
});

test("the arrows are disabled while a record travels", async ({ page }) => {
  await control(page, "play").click();
  await expect(control(page, "prev")).toHaveAttribute("aria-disabled", "true");
  await expect(control(page, "next")).toHaveAttribute("aria-disabled", "true");
  await expect(control(page, "play")).toHaveAttribute("data-state", "cueing");
  await playing(page, 0);
  await expect(control(page, "next")).toHaveAttribute("aria-disabled", "false");
  await expect(control(page, "play")).toHaveAttribute("data-state", "stop");
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});

test("the crate control keeps one geometry in every state", async ({ page }) => {
  const boxes = () =>
    Promise.all(
      ["prev", "play", "next"].map(async (act) => {
        const box = (await control(page, act).boundingBox())!;
        return [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 2) / 2);
      }),
    );
  const atRest = await boxes();
  for (const act of ["prev", "play", "next"]) {
    await control(page, act).hover({ force: true });
    expect(await boxes()).toEqual(atRest);
  }
  await control(page, "play").click();
  expect(await boxes()).toEqual(atRest); // cueing
  await playing(page, 0);
  expect(await boxes()).toEqual(atRest); // playing
  await control(page, "next").click();
  await settled(page);
  expect(await boxes()).toEqual(atRest); // another title
});

test("hovering the cover lifts it and shades play; clicking it plays", async ({ page }) => {
  const cover = await coverOnScreen(page);
  await page.mouse.move(cover.x, cover.y);
  await expect(control(page, "play")).toHaveClass(/\bhint\b/);
  await expect.poll(() => page.evaluate(() => window.__deckScene!.offsets()[0].lifted)).toBeGreaterThan(0.1);
  await page.mouse.click(cover.x, cover.y);
  await playing(page, 0);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});

test("browsing while playing, then stopping from the flipped crate, flips back and seats everything", async ({ page }) => {
  await page.locator(".tracks li").first().locator("button").click();
  await playing(page, 0);
  await control(page, "next").click();
  await control(page, "next").click();
  await settled(page);
  expect(await deckState(page)).toMatchObject({ browsed: 2, playing: 0 });
  await expect(control(page, "play")).toHaveAttribute("data-state", "play");
  await expect(page.locator(".tracks li").nth(2)).toHaveClass(/\bbrowsed\b/);
  // Stop by clicking the spinning record, so nothing hovers the list back to record 0 first
  const record = await platterOnScreen(page);
  await page.mouse.click(record.x + record.rx, record.y);
  await playing(page, null);
  await page.mouse.move(0, 0);
  await settled(page);
  expect((await deckState(page)).browsed).toBe(0);
  expect(await tilts(page)).toEqual([-0.1, -0.112, -0.124, -0.136]);
  await expectSeated(page);
});

test("the arrow keys flip while the crate control has focus", async ({ page }) => {
  await control(page, "play").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await deckState(page)).browsed).toBe(1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await deckState(page)).browsed).toBe(0);
  await settled(page);
  await expectSeated(page);
});

test("a control press then a list press within 150ms: only the list's record plays, and everything agrees", async ({ page }) => {
  await control(page, "play").click();
  await page.waitForTimeout(100);
  await page.locator(".tracks li").nth(2).locator("button").click();
  await playing(page, 2, 60_000);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
  await expect(control(page, "play")).toHaveAttribute("data-state", "stop");
  await expect(control(page, "play")).toHaveAttribute("aria-label", "stop no bad feelings today");
  await expect(page.locator(".tracks li").nth(2).locator(".st")).toHaveText("playing · stop");
});

test("a cover click then a list press within 150ms: only the list's record plays", async ({ page }) => {
  const cover = await coverOnScreen(page);
  await page.mouse.click(cover.x, cover.y);
  await page.waitForTimeout(100);
  await page.locator(".tracks li").nth(3).locator("button").click();
  await playing(page, 3, 60_000);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
  await expect(control(page, "play")).toHaveAttribute("aria-label", "stop light it up");
});
```

- [ ] **Step 7: Run the checks**

Run: `bun run typecheck && bun run test:unit && bun run build:test && bun run test:e2e tests/e2e/deck-crate.spec.ts tests/e2e/deck-journeys.spec.ts tests/e2e/deck-scene.spec.ts`
Expected: 0 errors; all pass in Chromium; in WebKit they pass or skip for want of WebGL (note which in the report).

Run: `bun run test:e2e`
Expected: everything passes.

- [ ] **Step 8: Commit**

```bash
git add src/deck/scene.ts src/deck/scene/hud.ts src/deck/scene/pointer.ts src/styles/deck.css tests/unit/hud.test.ts tests/e2e/deck-crate.spec.ts
git commit -m "feat: crate control and pointer input for the listening corner"
```

---

### Task 10: the scratch easter egg

Mouse and pen only (touch keeps scrolling the page): dragging the spinning record more than 6px scratches it. The platter follows the pointer around its centre and the playback rate follows the angular speed, clamped 0.25 to 2.5 with pitch following; releasing spins back up and eases the rate to 1 over 420ms, and the click after a scratch is suppressed. A plain click still stops the record (spec 5.4).

**Files:**
- Modify: `src/deck/scene/pointer.ts` (full replacement), `src/deck/scene.ts` (one line)
- Test: `tests/e2e/deck-scratch.spec.ts`

**Interfaces:**
- Consumes: `Loop.setScratching`, `Loop.spinTo`, `Loop.invalidate` (Task 8); `Tweens.tween` and `easeOut` (Task 7); `OMEGA`, `PLATTER` (Task 7); `Deck.setRate` (Task 5).
- Produces: `bindPointer(canvas, { deck, stage, journeys, hud, loop, tweens, reduce }): Pointer`.

- [ ] **Step 1: Write the failing scratch spec**

Create `tests/e2e/deck-scratch.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { audioState, deckState, expectSeated, hasWebGL, openScene, platterOnScreen, playing, settled } from "./deck";

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  test.skip(!(await hasWebGL(page)), "no WebGL in this browser here");
  await openScene(page);
  await page.locator(".tracks li").first().locator("button").click();
  await playing(page, 0);
  await settled(page);
});

test("dragging the spinning record scratches it; letting go plays on at normal speed", async ({ page }) => {
  const record = await platterOnScreen(page);
  const spin = await page.evaluate(() => window.__deckScene!.spin());
  // 0.9 units right of centre is on the vinyl, clear of the label
  await page.mouse.move(record.x + record.rx, record.y);
  await page.mouse.down();
  const rates: number[] = [];
  for (let step = 1; step <= 12; step++) {
    const angle = (step / 12) * Math.PI;
    await page.mouse.move(record.x + record.rx * Math.cos(angle), record.y + record.ry * Math.sin(angle));
    rates.push((await audioState(page)).rate);
  }
  expect(rates.some((rate) => Math.abs(rate - 1) > 0.05)).toBe(true);
  expect(Math.max(...rates)).toBeLessThanOrEqual(2.5);
  expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.25);
  expect(await page.evaluate(() => window.__deckScene!.spin())).not.toBe(spin);
  await page.mouse.up();
  await expect.poll(async () => (await audioState(page)).rate, { timeout: 3000 }).toBe(1);
  // The click that ends a scratch is not a stop
  expect(await deckState(page)).toMatchObject({ want: 0, playing: 0 });
  expect((await audioState(page)).paused).toBe(false);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});

test("a plain click on the spinning record stops it", async ({ page }) => {
  const record = await platterOnScreen(page);
  await page.mouse.click(record.x + record.rx, record.y);
  await playing(page, null);
  await page.mouse.move(0, 0);
  await settled(page);
  await expectSeated(page);
});
```

Run: `bun run build:test && bun run test:e2e tests/e2e/deck-scratch.spec.ts --project=chromium`
Expected: the first test FAILS (the drag is a plain click, so the record stops and the rate never moves); the second passes.

- [ ] **Step 2: Add the scratch to the pointer**

Replace `src/deck/scene/pointer.ts` with:

```ts
import { Raycaster, Vector2, type Mesh, type Object3D } from "three";
import type { Deck } from "../types";
import type { Stage } from "./build";
import type { Hud } from "./hud";
import type { Journeys, Preview } from "./journeys";
import { OMEGA, PLATTER } from "./layout";
import type { Loop } from "./loop";
import { easeOut, type Tweens } from "./tween";

type Act = "play" | "prev" | "next" | "record" | "deck";

export interface Pointer {
  clearPreview(): void;
}

interface Options {
  deck: Deck;
  stage: Stage;
  journeys: Journeys;
  hud: Hud;
  loop: Loop;
  tweens: Tweens;
  reduce: boolean;
}

const SCRATCH_PX = 6;
const RATE_MIN = 0.25; // Firefox mutes below this
const RATE_MAX = 2.5;

// The cover you can see (or anywhere on the crate) plays or stops; records in front or behind flip by one; the
// spinning record, the platter and the start button stop. Hidden records never count as hits (spec 5.4).
export function bindPointer(canvas: HTMLCanvasElement, { deck, stage, journeys, hud, loop, tweens, reduce }: Options): Pointer {
  const ray = new Raycaster();
  const ndc = new Vector2();
  let previewing: Preview = null;
  let suppressClick = false;
  let drag: { x0: number; y0: number; angle: number; at: number; live: boolean; rate: number } | null = null;

  function pick(event: MouseEvent): Act | null {
    const box = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const discs = stage.records.filter((r) => r.disc.visible).map((r) => r.disc);
    const targets: Object3D[] = [...stage.records.map((r) => r.sleeve), ...stage.crateWalls, stage.button, stage.platter, ...discs];
    const hit = ray.intersectObjects(targets, true)[0];
    if (!hit) return null;
    const state = deck.getState();
    const index = hit.object.userData.index as number | undefined;
    if (index !== undefined) return index === state.browsed || index === state.want ? "play" : index < state.browsed ? "prev" : "next";
    if (stage.crateWalls.includes(hit.object as Mesh)) return "play";
    const onPlatter = state.current !== null ? stage.records[state.current].disc : null;
    if (onPlatter?.visible && hit.object.parent === onPlatter) return "record";
    return "deck";
  }

  // Hover previews the click: the cover lifts, the browsed record starts to tip or the nearest tipped one starts to rise
  function preview(action: Preview) {
    if (deck.getState().busy) action = null;
    if (action === previewing) return;
    previewing = action;
    journeys.preview(action);
    hud.hint(action);
  }

  // The pointer's angle around the platter's centre on screen
  function screenAngle(event: PointerEvent) {
    const box = canvas.getBoundingClientRect();
    const p = PLATTER.clone().project(stage.camera);
    const cx = box.left + (p.x * 0.5 + 0.5) * box.width;
    const cy = box.top + (-p.y * 0.5 + 0.5) * box.height;
    return Math.atan2(event.clientY - cy, event.clientX - cx);
  }

  // Easter egg: grab the spinning record and scratch it. The platter follows the hand and the music bends with it.
  function scratch(event: PointerEvent) {
    if (!drag) return;
    if (!drag.live) {
      if (Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < SCRATCH_PX) return;
      drag.live = true;
      loop.setScratching(true);
      canvas.style.cursor = "grabbing";
    }
    const angle = screenAngle(event);
    const at = performance.now();
    const turned = Math.atan2(Math.sin(angle - drag.angle), Math.cos(angle - drag.angle));
    const seconds = Math.max(0.008, (at - drag.at) / 1000);
    stage.platter.rotation.y -= turned;
    drag.rate += (Math.max(RATE_MIN, Math.min(RATE_MAX, turned / seconds / OMEGA)) - drag.rate) * 0.45;
    deck.setRate(drag.rate);
    drag.angle = angle;
    drag.at = at;
    loop.invalidate();
  }

  function endDrag(event: PointerEvent) {
    if (!drag) return;
    if (drag.live) {
      suppressClick = event.type === "pointerup"; // no click follows a cancelled pointer
      loop.setScratching(false);
      canvas.style.cursor = "grab";
      loop.spinTo(reduce ? 0 : OMEGA);
      const from = drag.rate;
      void tweens.tween(420, (k) => deck.setRate(k === 1 ? 1 : from + (1 - from) * k), easeOut, "scratch");
    }
    drag = null;
  }

  canvas.addEventListener("pointerdown", (event) => {
    suppressClick = false; // a new gesture: a scratch that ended without a click must not swallow this one
    if (event.pointerType === "touch") return; // touch keeps scrolling the page
    const state = deck.getState();
    if (state.busy || state.current === null || state.want !== state.current) return;
    if (pick(event) !== "record") return;
    drag = { x0: event.clientX, y0: event.clientY, angle: screenAngle(event), at: performance.now(), live: false, rate: 1 };
    try {
      canvas.setPointerCapture(event.pointerId); // keeps the drag even if the pointer leaves the canvas
    } catch {
      // the pointer may already be gone
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag) return scratch(event);
    if (event.pointerType !== "mouse") return;
    const act = pick(event);
    canvas.style.cursor = act === null ? "" : act === "record" && !deck.getState().busy ? "grab" : "pointer";
    preview(act === "play" || act === "prev" || act === "next" ? act : null);
  });
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (drag) return;
    canvas.style.cursor = "";
    preview(null);
  });
  canvas.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const act = pick(event);
    if (act === null) return;
    const { browsed, want } = deck.getState();
    if (act === "play") deck.toggle(browsed);
    else if (act === "prev") deck.browse(browsed - 1);
    else if (act === "next") deck.browse(browsed + 1);
    else if (want !== null) deck.toggle(want); // the record, the platter or the start button: stop
  });

  return { clearPreview: () => preview(null) };
}
```

In `src/deck/scene.ts`, change

```ts
  const pointer = bindPointer(canvas, { deck, stage, journeys, hud });
```

to

```ts
  const pointer = bindPointer(canvas, { deck, stage, journeys, hud, loop, tweens, reduce });
```

- [ ] **Step 3: Run the checks**

Run: `bun run typecheck && bun run build:test && bun run test:e2e tests/e2e/deck-scratch.spec.ts tests/e2e/deck-crate.spec.ts`
Expected: 0 errors; all pass in Chromium (WebKit passes or skips for want of WebGL).

Run: `bun run test:unit && bun run test:e2e`
Expected: everything passes.

- [ ] **Step 4: Commit**

```bash
git add src/deck/scene/pointer.ts src/deck/scene.ts tests/e2e/deck-scratch.spec.ts
git commit -m "feat: scratch the spinning record"
```

---

### Task 11: posters, phone framing and budgets

Two pre-rendered posters stand in for the scene until its first frame, and for good without WebGL (spec 5.2). They show the room in daylight with no record on the platter and an empty crate, so they stay true whatever records `/admin` adds later. This task also checks the phone framing in a browser, measures the scene chunk and adds the opt-in long-task check.

**Files:**
- Create: `scripts/poster.mjs`, `public/posters/deck-desktop.webp`, `public/posters/deck-phone.webp`, `tests/e2e/deck-phone.spec.ts`, `tests/e2e/scene-perf.spec.ts`
- Modify: `src/deck/scene/hooks.ts`, `src/components/Turntable.astro`, `src/styles/deck.css`, `package.json`, `tests/unit/media-files.test.ts`, `tests/unit/turntable.test.ts`, `tests/e2e/deck-scene.spec.ts`, `tests/e2e/budgets.spec.ts`

**Interfaces:**
- Consumes: the scene and its hooks (Tasks 8 to 10); `withoutWebGL`, `hasWebGL`, `openScene` (e2e helpers).
- Produces: `SceneHooks.poster(): void`; `bun run poster`; `/posters/deck-desktop.webp` and `/posters/deck-phone.webp`; `.deck .poster` markup.

- [ ] **Step 1: Write the failing poster tests**

In `tests/unit/media-files.test.ts`, add after the existing `describe` block:

```ts
describe("the posters", () => {
  test.each([
    ["deck-desktop", 16 / 10.8],
    ["deck-phone", 375 / 320],
  ])("%s is a WebP under 60KB in the deck's shape", async (name, aspect) => {
    const file = `public/posters/${name}.webp`;
    expect(statSync(file).size).toBeLessThan(60 * 1024);
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.abs(meta.width! / meta.height! - aspect)).toBeLessThan(0.02);
  });
});
```

In `tests/unit/turntable.test.ts`, add to the end of the second test (`has the deck, the hint, …`):

```ts
    const poster = doc.querySelector("[data-deck] .poster img")!;
    expect([poster.getAttribute("src"), poster.getAttribute("alt"), poster.getAttribute("loading")]).toEqual(["/posters/deck-desktop.webp", "", "lazy"]);
    expect(doc.querySelector('[data-deck] .poster source[media="(max-width: 680px)"]')?.getAttribute("srcset")).toBe("/posters/deck-phone.webp");
```

Run: `bun run test:unit tests/unit/media-files.test.ts tests/unit/turntable.test.ts`
Expected: the two poster tests FAIL with `ENOENT`; the turntable test FAILS (no `.poster`).

- [ ] **Step 2: Add the poster markup and styles**

In `src/components/Turntable.astro`, replace

```astro
    <div class="deck" data-deck></div>
```

with

```astro
    <div class="deck" data-deck>
      <picture class="poster">
        <source media="(max-width: 680px)" srcset="/posters/deck-phone.webp" />
        <img src="/posters/deck-desktop.webp" alt="" decoding="async" loading="lazy" />
      </picture>
    </div>
```

In `src/styles/deck.css`, add before the `.deck canvas` rule:

```css
/* The poster stands in for the scene until its first frame, and for good without WebGL */
.deck .poster, .deck .poster img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; }
.deck.live .poster { visibility: hidden; }
```

Run: `bun run test:unit tests/unit/turntable.test.ts`
Expected: PASS.

- [ ] **Step 3: Add a poster hook**

In `src/deck/scene/hooks.ts`, add to `interface SceneHooks` after `loseContext(): void;`:

```ts
  /** Empties the crate and hides the crate control, for `bun run poster` */
  poster(): void;
```

and to the `window.__deckScene` object after `loseContext`:

```ts
    poster: () => {
      for (const record of stage.records) {
        record.holder.visible = false;
        record.disc.visible = false;
      }
      canvas.parentElement?.querySelector<HTMLElement>(".crate-hud")?.style.setProperty("visibility", "hidden");
      loop.invalidate();
    },
```

- [ ] **Step 4: Write the poster script**

Create `scripts/poster.mjs`:

```js
// Renders the two posters the deck shows until (or instead of) the 3D scene (spec 5.2): daylight, no record on the
// platter and an empty crate, so they stay true whatever records /admin adds. Rerun whenever the scene changes.
//   bun run build:test && bun run serve    (leave it running)
//   bun run poster
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const BASE = process.env.POSTER_URL ?? "http://localhost:4331";
const LIMIT = 60 * 1024;
const MIDDAY = new Date("2026-10-05T02:00:00Z"); // 13:00 in Sydney: daylight

async function render(name, viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await page.clock.setFixedTime(MIDDAY);
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
  const png = await page.locator("[data-deck] canvas").screenshot({ omitBackground: true });
  await browser.close();
  let quality = 80;
  let out = await sharp(png).webp({ quality, alphaQuality: 80, effort: 6 }).toBuffer();
  while (out.length >= LIMIT && quality > 30) out = await sharp(png).webp({ quality: (quality -= 5), alphaQuality: 70, effort: 6 }).toBuffer();
  if (out.length >= LIMIT) throw new Error(`${name}: still ${out.length} bytes at quality ${quality}`);
  writeFileSync(`public/posters/${name}.webp`, out);
  console.log(`public/posters/${name}.webp: ${out.length} bytes at quality ${quality}`);
}

mkdirSync("public/posters", { recursive: true });
await render("deck-desktop", { width: 1280, height: 900 });
await render("deck-phone", { width: 375, height: 812 });
```

In `package.json` `scripts`, add after `"seed:media"`:

```json
    "poster": "node scripts/poster.mjs",
```

- [ ] **Step 5: Render the posters**

```bash
bun run build:test
(bun run serve > /tmp/deck-serve.log 2>&1 &)
until curl -sf http://localhost:4331/ > /dev/null; do sleep 1; done
bun run poster
pkill -f "port 4331"
```

(`pkill` stops wrangler and its workerd child, so a later e2e run starts a fresh server on the new build.)

Expected: two lines, each under 61440 bytes. Open both files and look at them: the walnut console, turntable (no record on it), candle, empty crate and the rug in daylight, with a transparent background. If the phone poster's crate is cut off, the phone framing in Task 7 is wrong; stop and report.

Run: `bun run test:unit tests/unit/media-files.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Check the posters in the scene spec**

In `tests/e2e/deck-scene.spec.ts`, in `the scene loads only after the page has loaded and the row comes near`, add after the `aria-hidden` assertion:

```ts
  await expect(page.locator("[data-deck] .poster")).toBeHidden();
```

and in `without WebGL the scene never loads and the list plays and stops every record`, add after `await expect(page.locator("[data-deck] canvas")).toHaveCount(0);`:

```ts
  const poster = page.locator("[data-deck] .poster img");
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
```

- [ ] **Step 7: Write the phone spec**

Create `tests/e2e/deck-phone.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { hasWebGL, openScene, withoutWebGL } from "./deck";

// Phone framing (spec 5.2), checked at 375px in Chromium: the geometry is the same in every engine
test.use({ viewport: { width: 375, height: 812 } });
test.describe.configure({ timeout: 90_000 });

test("on a 375px phone the canvas is full bleed, the cover is at least 90px tall and the control fits inside", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "framing, checked once in Chromium");
  test.skip(!(await hasWebGL(page)), "no WebGL here");
  await openScene(page);
  const canvas = (await page.locator("[data-deck] canvas").boundingBox())!;
  expect(Math.round(canvas.x)).toBe(0);
  expect(Math.round(canvas.width)).toBe(375);
  const cover = await page.evaluate(() => window.__deckScene!.coverRect());
  expect(cover.height).toBeGreaterThanOrEqual(90);
  const control = (await page.locator(".crate-hud").boundingBox())!;
  expect(control.x).toBeGreaterThanOrEqual(canvas.x);
  expect(control.x + control.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(control.y).toBeGreaterThanOrEqual(canvas.y);
  expect(control.y + control.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("without WebGL a phone gets the phone poster", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "checked once in Chromium");
  await withoutWebGL(page);
  await page.goto("/");
  const poster = page.locator("[data-deck] .poster img");
  await poster.scrollIntoViewIfNeeded();
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain("/posters/deck-phone.webp");
});
```

- [ ] **Step 8: Measure the scene on its own in the budgets**

In `tests/e2e/budgets.spec.ts`, in `page weight stays inside the budgets`, add as the first line of the test body after the `test.skip`:

```ts
  // A short window keeps the turntable out of reach, so this measures only what loads before any interaction;
  // the scene is measured on its own below
  await page.setViewportSize({ width: 1280, height: 400 });
```

and add this test after it:

```ts
test("the scene chunk stays under 190KB gzipped", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  test.setTimeout(90_000);
  const scripts = new Map<string, Promise<number>>();
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.set(response.url(), response.body().then((body) => gzipSync(body).length));
  });
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/", { waitUntil: "networkidle" });
  const early = new Set(scripts.keys());
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 60_000 });
  const late = [...scripts].filter(([url]) => !early.has(url));
  const sizes = await Promise.all(late.map(([, size]) => size));
  console.log("scene (gzipped bytes)", Object.fromEntries(late.map(([url], i) => [new URL(url).pathname, sizes[i]])));
  expect(late.some(([url]) => /\/_astro\/scene\./.test(url))).toBe(true);
  expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(190 * 1024);
});
```

- [ ] **Step 9: Add the opt-in long-task check**

Create `tests/e2e/scene-perf.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Spec 11: no scene task over 50ms at 4× CPU throttle. Opt-in, because CI's software WebGL is no guide:
//   SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium
test("no scene task blocks the main thread for more than 50ms at 4× CPU throttle", async ({ page, browserName }) => {
  test.skip(process.env.SCENE_PERF !== "1", "opt-in: set SCENE_PERF=1");
  test.skip(browserName !== "chromium", "CPU throttling is Chromium-only");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/", { waitUntil: "networkidle" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const tasks: number[] = [];
    (window as unknown as { longTasks: number[] }).longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask" });
  });
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 150_000 });
  await page.locator(".tracks button").first().click();
  await expect.poll(() => page.evaluate(() => window.__deck!.state().playing), { timeout: 60_000 }).toBe(0);
  const tasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  console.log("long tasks (ms)", tasks);
  expect(tasks).toEqual([]);
});
```

Run: `bun run build:test && SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium`
Expected: PASS with `long tasks (ms) []`. Record the printed list in the report either way. If tasks over 50ms appear, find the slice with a headed Chromium and the Performance panel: texture drawing (`sliced` keeps each slice near 8ms), `buildStage` sections (add another `await idle()` between the two biggest), `pmrem.fromScene` or the first `render`. Split what is JavaScript on the main thread; if what remains is shader compilation or software rendering that `compileAsync` cannot move, report the numbers instead of contorting the code.

- [ ] **Step 10: Run everything and commit**

Run: `bun run typecheck && bun run test:unit && bun run build:test && bun run test:e2e`
Expected: 0 errors; everything passes; the budgets spec prints the scene size (under 194560).

```bash
git add scripts/poster.mjs public/posters src/deck/scene/hooks.ts src/components/Turntable.astro src/styles/deck.css package.json tests/unit/media-files.test.ts tests/unit/turntable.test.ts tests/e2e/deck-scene.spec.ts tests/e2e/deck-phone.spec.ts tests/e2e/budgets.spec.ts tests/e2e/scene-perf.spec.ts
git commit -m "feat: deck posters, phone framing checks and scene budgets"
```

---

### Task 12: deploy purge, launch steps and docs

Purges the cached home page after every deploy (ADR-0009), keeps test hooks out of production, records the decisions this plan made and closes the plan 1 follow-ups it took on.

**Files:**
- Create: `docs/adr/0009-purge-cached-home-page-after-deploys.md`
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`, `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`, `docs/superpowers/plans/2026-10-03-plan-1-followups.md`

**Interfaces:**
- Consumes: everything above; the `logbook` cache tag from plan 1.
- Produces: GitHub secret `CLOUDFLARE_ZONE_ID` (George adds it before launch); a deploy job that refuses a build with test hooks and purges `logbook` after deploying.

- [ ] **Step 1: Guard and purge in the deploy job**

In `.github/workflows/ci.yml`, in the `deploy` job, add directly after `- run: bun run build`:

```yaml
      # Test hooks must never reach production
      - run: if grep -rq "__deck" dist; then echo "test hooks leaked into the production build"; exit 1; fi
```

and add directly after the `- run: bunx wrangler deploy` step (and its `env`):

```yaml
      # Edge-cached HTML must never outlive the hashed scene loader it points at (ADR-0009)
      - name: Purge the cached home page
        run: >-
          curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache"
          -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json"
          --data '{"tags":["logbook"]}'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}
```

Run: `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml', 'utf8')); console.log('valid yaml')"`
Expected: `valid yaml`. Then read the whole file once: the check job runs `seed:media --local` after `db:migrate:local` and builds with `build:test`; the deploy job builds with `build`, guards, migrates, deploys, purges, then runs the privacy spec.

- [ ] **Step 2: Write ADR-0009**

Create `docs/adr/0009-purge-cached-home-page-after-deploys.md`:

```markdown
# ADR-0009: Purge the edge-cached home page after every deploy

- Status: Proposed
- Date: 2026-10-04
- Authors: George Vlachos

## Context

`/` is cached at Cloudflare's edge for five minutes and served stale for up to a day while it refreshes (ADR-0007). The listening corner adds the first hashed file the page depends on: a small scene loader under `/_astro/` that imports the Three.js scene chunk. Workers static assets serve only the current deploy's files, so a page cached before a deploy can point at a loader the new deploy removed. The deck runner is inlined into the HTML for exactly this reason, so playback never depends on a hashed file, but the 3D scene would quietly stay a poster for anyone served that stale page. The options were to version the cache by deploy with the `version_metadata` binding, to keep old assets around, or to purge the cached page when a deploy lands.

## Decision

The GitHub Actions deploy job purges the `logbook` cache tag through the Cloudflare API straight after `wrangler deploy`, using a `CLOUDFLARE_ZONE_ID` secret and the existing API token with the zone's Cache Purge permission. The deck runner stays inline, and if the scene loader is ever missing the poster and the track list carry on.

## Consequences

The first request after a deploy gets fresh HTML, so the page and its scripts always match. The deploy needs one more secret and one more token permission, both on the launch checklist. If the purge call fails, the job fails after the deploy, visibly in Actions, and the five-minute freshness window still bounds the effect. Local and pull-request runs are unaffected.

## Alternatives considered

- **Versioning the cache with `version_metadata`:** Astro's route cache keys on the URL, so the version could only label responses, not separate them.
- **Keeping earlier deploys' assets:** Workers static assets don't keep earlier versions, and hosting them elsewhere adds a moving part for one small script.
```

- [ ] **Step 3: Bring the spec in line with what was built**

In `docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`, make these replacements. Each text to replace appears exactly once; copy it from here rather than retyping it.

1. In the header, replace

```text
- Decisions: [ADR-0001](../../adr/0001-logbook-direction-with-wall-labels.md) to [ADR-0008](../../adr/0008-deploy-through-github-actions.md)
```

with

```text
- Decisions: [ADR-0001](../../adr/0001-logbook-direction-with-wall-labels.md) to [ADR-0008](../../adr/0008-deploy-through-github-actions.md) and [ADR-0009](../../adr/0009-purge-cached-home-page-after-deploys.md)
```

2. In 5.2, replace

```text
If the side-by-side layout cannot reach 90px, the phone layout moves the crate in front of the turntable.
```

with

```text
Measured at about 95px (crop x -3.35 to 6.25, y -0.9 to 3.4, view direction (0, 0.45, 1), canvas 375 × 320), so the crate stays beside the turntable.
```

3. In 5.2, replace

```text
rendered in daylight with no record on the platter by a Playwright script
```

with

```text
rendered in daylight with no record on the platter and an empty crate (so they stay true whatever records /admin adds) by a Playwright script
```

4. In 5.4, replace

```text
a red `›` marks the record in view;
```

with

```text
a red `›` marks the record in view while the scene is attached;
```

5. In 6.1, replace

```text
The short freshness window means a deploy shows on `/` within minutes without a purge step.
```

with

```text
Every deploy also purges the `logbook` tag from CI (ADR-0009), so edge-cached HTML never points at a hashed file the new deploy removed; the short freshness window is the fallback.
```

6. In 8, replace the whole bullet

```text
- A one-off script (`bun run seed:media`) extracts cover art from the existing MP3s' ID3 tags (`music-metadata`), converts it to 512px WebP, uploads tracks and covers with `wrangler r2 object put --remote` and inserts the four prototype records (simple things, nyc in 1940, no bad feelings today, light it up). The MP3s then leave `public/`.
```

with

```text
- The four prototype records (simple things, nyc in 1940, no bad feelings today, light it up) are seeded by the migration `0003_records.sql`, so local, CI and production D1 get them through `migrations apply`. Their MP3s and 512px WebP covers (made once from the MP3s' ID3 art with `music-metadata` and sharp by `bun run covers`) live in `media/`; `bun run seed:media --local` uploads them to the local R2 store and `--remote` to production. The MP3s left `public/`.
```

7. In 13's launch checklist, directly after the line

```text
- [ ] Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub Actions secrets and disconnect Workers Builds.
```

add

```text
- [ ] Create the R2 bucket (`bunx wrangler r2 bucket create curiousgeorge-media --location oc`) and upload the starting crate (`bun run seed:media --remote`).
- [ ] Add `CLOUDFLARE_ZONE_ID` to GitHub Actions secrets and give the API token the zone's Cache Purge permission (each deploy purges the cached home page, ADR-0009); after the first deploy, confirm a request to `/` straight after the purge is a cache miss (`cf-cache-status: MISS`).
- [ ] Sign off ADR-0009 (status Proposed until then).
```

8. In 11, replace

```text
No scene task over 50ms at 4× CPU throttle.
```

with

```text
No scene task over 50ms at 4× CPU throttle, measured locally with `SCENE_PERF=1` (CI renders WebGL in software, so it is reported there, not gated).
```

9. In 13's launch checklist, replace

```text
- [ ] Try the turntable on a real iPhone and on Safari for macOS (Playwright's WebKit does not enforce the user-gesture rule for audio).
```

with

```text
- [ ] Try the turntable on a real iPhone (once with the ringer switch on silent) and on Safari for macOS (Playwright's WebKit does not enforce the user-gesture rule for audio).
```

Run: `grep -c "ADR-0009" docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md`
Expected: `4`.

- [ ] **Step 4: Update the roadmap and the plan 1 follow-ups**

In `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`, replace

```text
add the `version_metadata` binding and decide a post-deploy cache purge so edge-cached HTML never references removed `/_astro/*` chunks | 1 | To write after plan 1 |
```

with

```text
purge the cached home page after each deploy (ADR-0009) so edge-cached HTML never references removed `/_astro/*` chunks | 1 | [Done](2026-10-04-plan-2-listening-corner.md) |
```

and replace

```text
GitHub secrets, disconnecting Workers Builds,
```

with

```text
GitHub secrets (including `CLOUDFLARE_ZONE_ID` and the token's Cache Purge permission), disconnecting Workers Builds, creating the R2 bucket and uploading the starting crate (`bun run seed:media --remote`),
```

In `docs/superpowers/plans/2026-10-03-plan-1-followups.md`, replace the four bullets under `## Plan 2 (listening corner)` with

```text
Done in [plan 2](2026-10-04-plan-2-listening-corner.md): the deck runner is inlined and every deploy purges the cached page (ADR-0009, in place of a `version_metadata` binding); 12:xx and daylight-saving cases are in `tests/unit/time.test.ts` beside the lighting tests; `log` runs in the phone project; the three MP3s outside the starting crate are gone and the four in it left `public/` for R2.
```

- [ ] **Step 5: Update the README**

In `README.md`, replace the Develop block's commands with:

```bash
bun install
bun run db:migrate:local
bun run seed:media --local
bun run dev
```

and add these bullets at the end of `## Notes`, replacing the last bullet (`/` is cached…):

```markdown
- `/` is cached at the edge for five minutes with background refresh, and every deploy purges it (ADR-0009).
- Media: the starting crate lives in `media/` (MP3s and 512px covers from `bun run covers`); `bun run seed:media --local` uploads it to the local R2 store, `--remote` to production (a launch step).
- Tests run against `bun run build:test`, which compiles in the listening corner's test hooks; `bun run build` never contains them.
- Posters: `bun run build:test`, then `bun run serve`, then `bun run poster`. Rerun whenever the scene changes.
- Scene long tasks (opt-in): `SCENE_PERF=1 bun run test:e2e tests/e2e/scene-perf.spec.ts --project=chromium`.
```

- [ ] **Step 6: Run the whole check and commit**

Run: `bun run check`
Expected: typecheck 0 errors, all unit tests pass, migrations and media seed apply locally, the test build succeeds and every e2e spec passes (WebGL-dependent WebKit tests may skip; note which).

```bash
git add .github/workflows/ci.yml docs/adr/0009-purge-cached-home-page-after-deploys.md docs/superpowers/specs/2026-10-03-personal-site-redesign-design.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md docs/superpowers/plans/2026-10-03-plan-1-followups.md README.md
git commit -m "docs: purge the cached page after deploys; record plan 2's decisions"
```
