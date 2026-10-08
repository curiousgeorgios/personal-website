# Plan 6: the photo gallery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give George's photographs a home on the site, kept like the logbook: `/photos` as dated entries of contact-sheet frames, a shareable page for each photograph, a private full-resolution downloads page behind a catalogue link, the owner's photographs and links sections in `/admin` and a line on the home page, with places and dates from the import. No payment code (that is plan B).

**Architecture:** Migration 0006 adds `photo_posts` (one row per Instagram post: its time, its date in its own offset, its place) and every public query joins a photograph to its post. `src/lib/photos/store.ts` gains an entry mode (a page of posts and their published photographs in one `DB.batch()`), which serves the gallery page, its JSON twin and the downloads page alike. The pages are server-rendered Astro on Workers and work without JavaScript; one small inline script appends older entries from `<template>`s rendered by the same components. Publication moves into `src/lib/photos/publish.ts`, shared by the JSON route and the admin's forms. On George's Mac, `photos:prepare` now encodes 240 previews, reads each post's date from the index and turns GPS into "area, city" through a small Swift tool and a committed city map; `photos:import` writes posts before photographs and never overwrites a title or an edited place.

**Tech Stack:** Astro 7.3.5 on Cloudflare Workers, D1, R2, `jose` 6.2.12, sharp 0.35.5, Swift with ImageIO and MapKit (macOS only, through `xcrun swiftc`), Vitest 5 with `node:sqlite` and `linkedom`, Playwright 1.63, wrangler 4.147, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md](../specs/2026-10-08-photo-gallery-and-prints-design.md), part 1 only (sections 1 to 12), in the task order of its section 1.2 for plan A. It extends [the logbook redesign spec](../specs/2026-10-03-personal-site-redesign-design.md) ("R6.1" is its section 6.1). Decisions: [ADR-0020](../../adr/0020-photo-downloads-use-revocable-signed-links.md) (as amended 2026-10-08: photo-scoped links are never issued to people), [ADR-0022](../../adr/0022-photo-places-are-area-and-city-only.md) (as amended: area and city only, through Apple's geocoder on George's Mac). It builds on Codex's photo backend of `a65ecc6` ([docs/photo-gallery-backend.md](../../photo-gallery-backend.md)).

## Global constraints

- Copy is lowercase George-voice: Australian spelling, spaced hyphen ` - `, no em dashes, no Oxford comma, sentence case. This applies to every message, label, comment and doc line. UI strings the spec quotes are used exactly as quoted.
- Motion: ease-out by default, most transitions 200 to 300ms; hover transitions 200ms `ease`, only under `(hover: hover) and (pointer: fine)`; no transforms under `prefers-reduced-motion`; animate `transform` and `opacity` only (colour and outline colour for hovers). This plan adds no animation beyond hover colours.
- Budgets (spec 10): JavaScript before any interaction under 10KB gzipped per page (the beacon plus `photo-sheet.ts`, all inline, no framework); HTML under 30KB gzipped, CSS under 15KB gzipped, the same two fonts; image bytes loaded before any scroll on `/photos` at 375 × 812 under 250KB; cumulative layout shift under 0.01 at 1280px and 375px on `/photos` (including after one batch loads) and on `/photos/<id>`; largest contentful paint under 1.5s as a Lighthouse warning after each deploy.
- Privacy (spec 9): `cookies: none. nothing to accept.` stays true and `tests/e2e/privacy.spec.ts`'s empty-storage assertion keeps passing; every request stays first party; the beacon sends the path only and no new events; tokens never reach analytics, logs or referrers; coordinates never reach D1, R2, the manifest or the site.
- Caching: `/photos`, `/photos?before=` and `/photos/<id>` call `Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["photos"] })` and send `Cache-Control: no-cache`, exactly like `/`; a degraded render sends `no-store` and is never cached; `/api/photos` keeps 60s fresh, 300s stale, tag `photos`. Publication, title and place changes purge `photos` and `logbook`.
- The place rule (spec 6.2, shared by prepare and the admin): lowercased with `en-AU` rules, trimmed, at most 60 characters, printable Latin-1 only; empty stores `null`.
- Use bun, never npm. D1 migrations only through `wrangler d1 migrations apply` (`bun run db:migrate:local`); `wrangler d1 execute --command` is used only to read or set test data in local stores.
- Never run `wrangler deploy` (except `--dry-run`), any `--remote` command, `bun run photos:import --remote` or `bun run photos:link --remote`; never put a secret in a task. The only signing key in tasks is the admin server's fixture key, `1111…` (64 ones), already in `playwright.config.ts`.
- `photos:prepare`, the geocoding and `photos:import` run on George's Mac at launch (spec 12). Tasks build and test that tooling with synthetic fixtures in temporary folders; they never open George's Photos library, his prepared assets or the production stores.
- George never reviews artefacts. Any visual check is done by the implementer and by the task's reviewer, never handed to George.
- Visual checks run on a throwaway fixture server built from the test build, never on `.wrangler/state` or `.dev.vars`:

  ```bash
  pkill -f "port 433[0-9]"; bun run build:test
  rm -rf .wrangler/visual && bunx wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/visual \
    && node scripts/seed-photo-test.mjs --persist-to .wrangler/visual
  bunx wrangler dev -c dist/server/wrangler.json --port 4336 --persist-to .wrangler/visual \
    --var PHOTO_LINK_SECRET:1111111111111111111111111111111111111111111111111111111111111111 &
  curl --retry 30 --retry-connrefused --retry-delay 1 -sf http://localhost:4336/ -o /dev/null
  ```

  The test build's admin bypass answers `/admin/` on localhost. Shoot the page at both widths with every `<details>` opened and open both images before committing:

  ```bash
  node -e '
  const { chromium } = require("@playwright/test");
  (async () => {
    const browser = await chromium.launch();
    for (const [width, height] of [[375, 812], [1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(process.argv[1], { waitUntil: "networkidle" });
      await page.locator("details").evaluateAll((all) => all.forEach((details) => (details.open = true)));
      await page.screenshot({ path: `${process.argv[2]}-${width}.png`, fullPage: true });
    }
    await browser.close();
  })();
  ' "http://localhost:4336/photos" "$TMPDIR/photos"
  ```

  Each task names the URL and what to look for. Afterwards: `pkill -f "port 4336"; rm -rf .wrangler/visual`.
- No new dependency anywhere in this plan.
- Run scripts and tests under Node 24 or later (`mise exec node@24 --` outside the home directory); the scripts import `.ts` files through Node's type stripping.
- The e2e servers: 4331 is the main local server (`.wrangler/state`, seeded with fixtures; George's own photo import lives there too, so no task seeds, reads or changes photographs in it); 4332 has an empty store; 4333 is the admin server with its own store and the fixture signing key, recreated every run; 4334 runs both Workers against a fixture site on 4400; 4335 (new, Task 1) has only the photo fixture, recreated every run, for the read-only photo specs. Specs that write use only 4333 and 4334. Visual checks use a sixth, throwaway server on 4336 (above). On 4333 each spec keeps to its own photographs (see "Decisions").
- Every task ends with `bun run typecheck` at 0 errors and the unit tests passing; tasks that touch pages rebuild with `bun run build:test` and run the e2e specs they name (stop stale servers first with `pkill -f "port 433[0-9]"`). Match the existing code style: 2-space indent, double quotes, semicolons, short comments that say why.

## Review focus

1. **Post dates near midnight and in other offsets** (`2025-02-03T00:30:00+11:00`, a Maltese post at `+01:00`): the gallery must show the day the post went up where it went up, never the UTC day. Task 4 pins `published_on` for both in the import's unit test; Task 3 pins that prepare keeps the offset.
2. **A `?before=` cursor older than every post, or a bookmark left stale by a hidden post**: a 200 page that says `that's every entry.` and links to the newest entries, not `no photos up yet.` and not a 404. Task 7 pins `?before=1` and an empty `?before=` page.
3. **Titles and places with markup, quotes, ampersands, accents or other alphabets** (`<b>dawn</b> & "co"`, `St Kilda, Melbourne`, `o'connor, canberra`, `Ħamrun`, `東京`): titles render as text everywhere (alt, `<h1>`, `<title>`, share tags); places are lowercased, accents within Latin-1 kept and anything else refused in the admin or transliterated (and otherwise listed for review) in prepare. Task 3 pins prepare's names, Task 6 the admin's place rule and title input, Task 9 the escaping.
4. **A link's expiry shown either side of a daylight saving change**: `this link works until 15.10.26, 2:30 pm sydney time.` in AEDT and the same wall time in AEST, from the token's `exp`. Task 10 pins both.
5. **A post with more than eight frames, and three-digit slide numbers** (`DFkL1xrsnOH-100`): only the first eight frames of the page's first entry load eagerly (the first with high priority) and each frame shows its own slide number. Task 7 pins both in the gallery's unit tests.

## Decisions made while planning

Recorded so reviewers know they are deliberate:

- **The read-only photo specs run on a fifth server (4335) whose store holds only spec 11.3's fixture and is recreated every run**, so they never race the admin specs and never touch George's local import in `.wrangler/state` (462 real photographs). The seed is idempotent and still refuses a store that holds non-fixture photos, as a guard against a mistyped `--persist-to`.
- **On 4333 each spec keeps to its own photographs.** `photos.spec.ts` downloads `fixture-01` and `fixture-02` and publishes and hides `fixture-d-01`; `admin-photos.spec.ts` uses `fixture-b` (publishing and hiding), `fixture-c` (place and title) and `fixture-e` (a failed check); the downloads, links and privacy specs change only grants. Assertions about the catalogue's contents pin those ids, never the whole list.
- **The fixture's facts** (spec 11.3 left them open): dates `2026-09-27T18:30:00+10:00` (`fixture`), `2026-06-14T09:15:00+10:00` (`fixture-b`), `2026-03-01T12:00:00+11:00` (`fixture-c`), `2025-12-25T08:00:00+11:00` (`fixture-d`), `2025-08-09T16:45:00+10:00` (`fixture-e`) and `2025-02-02T20:27:48+11:00` (`fixture-f`); places `bondi, sydney`, none, `fremantle, perth`, `manly, sydney`, `braddon, canberra` and `valletta, malta`. Only `fixture-01` has a title (`a test photograph`) and only `fixture-c-01` awaits RAW review. The first page's cursor is therefore `1766610000`.
- **`photo-place.swift` uses MapKit's `MKReverseGeocodingRequest` and reads the five names from the returned map item's `placemark`.** `CLGeocoder` is deprecated in the macOS 26 SDK (and warns), so the spec sends the tool to MapKit; MapKit's new `address` and `addressRepresentations` carry a city and a region but not the suburb, council and state code the city map needs. The map item's `placemark` is the one MapKit object that does, and it carries a deprecation note of its own, so `swiftc` prints exactly one warning, which Task 3 expects. The output fields and the privacy position are the spec's. Compiled and run against synthetic JPEGs while planning (no network for the GPS check).
- **Prepare reads two test-only environment variables:** `PHOTO_PLACE_TOOL` (a stand-in geocoder that answers from recorded placemarks) and `PHOTO_PLACE_DELAY_MS` (the 1.5s spacing, 0 in tests). Neither is set on George's Mac. They are how the tooling is tested with fixtures and no network.
- **A place name still outside Latin-1 after transliteration makes the post's place `null`** and is printed for review, so George types it in `/admin` (where `place_edited` protects it). Before `normalize("NFKD")`, a small map turns the stroke letters NFKD can't split (`ħ`, `ł`, `đ`, `ı`) into plain ones, so `Ħamrun` becomes `hamrun` rather than a review item.
- **The import's database writes move to `scripts/photo-import-db.mjs` and its structural checks to `scripts/photo-manifest.mjs`**, so Vitest runs them over the real migrations on `node:sqlite` (spec 11.1). The prepared manifest's `schemaVersion` becomes 2 when it carries `posts` (Task 4), so an old manifest fails with "run photos:prepare again" instead of importing photographs without posts.
- **The entry query repeats the page-of-posts subquery** inside the photographs query, so both run in one `DB.batch()` (spec 3.5). Many ids go to D1 as one JSON parameter through `json_each`, because D1 caps a statement at 100 bound parameters.
- **The beacon moves into `src/components/Beacon.astro`**, used by the logbook and the photo pages. Each `<script>` is its own entry in the client build, and a module two entries import is split into a shared chunk: two scripts importing `beacon.ts` would turn the home page's inline beacon into an external file, which an edge-cached page must never depend on (ADR-0010). One component's script is one entry, so it stays inline everywhere; `photo-sheet.ts` shares no module with any other script.
- **The home page's photo line asks whether a published photograph has a post row** (`EXISTS` over the same join the gallery uses), so the line never points at an empty gallery.
- **`setPublished` doesn't purge.** Its callers do: the JSON route purges `photos` and `logbook` itself, and the admin purges through `submitForm`'s per-section tags (`photographs` purges both, `links` nothing).
- **Copy the spec leaves open:** the raw pill reads `3 raw`; a single photograph that fails its checks says `that photo couldn't be checked, so it stays hidden. run the import for it again.`; revoking a link saves with `saved - that link no longer works.`; a missing signing key says `links can't be made until PHOTO_LINK_SECRET is set.`; an empty admin section says `no photos imported yet. run photos:import from the mac.` and `no links are working right now.`; a degraded photo page uses the gallery's `photos aren't loading right now. try again in a bit.` with a 503.
- **The entry API leaves out `publishedAt`.** It's internal (the pager's cursor is `next`), so the JSON matches spec 3.6 exactly.
- **The middleware's private paths move into `isPrivatePath()` in `src/lib/photos/http.ts`** (Task 10), the mechanism plan B extends to `/prints/`. Nothing else in the middleware changes in plan A: it already sends `PRIVATE_HEADERS` on `/photos/downloads`.
- **`frameView` returns `null` for a photograph without its 240 preview** and the frame is skipped. The publish check makes it unreachable for published photographs; it only keeps a bad row from breaking a page.
- **The layout-shift check after a batch relies on the fixture's batch loading with the page** (the link starts inside the 800px margin) and asserts the appended entries land below the fold.
- **The first eight frames stand in for the first row** (spec 3.3: the first row of the first entry loads eagerly, at most eight). A row holds eight frames at 1280px and about five at 375px, so a phone loads about three more eagerly than its first row; the server can't know the row's length, and the budget allows it.
- **`scripts/lighthouse.mjs` given one root URL also measures `/photos` and the newest photograph's page** (found through the entry API), so the deploy job's existing step covers spec 10 unchanged.
- **Notebook props and the robots and ingest changes move earlier than spec 1.2's step 8**, into the tasks that first need them (Tasks 9 and 10), so no task depends on a later one. Each page's e2e spec lives in its own task; Task 12 holds the privacy, budget and layout-shift checks and the docs.

## File structure

```
migrations/0006_photo_gallery.sql               create: photo_posts, raw_review, the grant's note and nonce
src/lib/photos/store.ts                         modify: the post join, date and place, entryPage, allEntries, photoPageData, PREVIEW_COUNT, insertGrant's note and nonce
src/lib/photos/http.ts                          modify: entryOptions, isPrivatePath
src/lib/photos/place.ts                         create: the place rule
src/lib/photos/publish.ts                       create: setPublished, verification at a concurrency of 10
src/lib/photos/gallery.ts                       create: dates, names, alt text, srcsets, sizes, frame views (shared by server and script)
src/pages/api/photos/index.ts                   modify: the entry mode
src/pages/admin/photos/[id].ts                  modify: setPublished, purge photos and logbook
src/pages/admin/photos/links.ts                 modify: photo links are internal, links to the page
src/pages/photos/index.astro                    create: the gallery
src/pages/photos/[id].astro                     create: one photograph
src/pages/photos/downloads/index.astro          create: the downloads page
src/pages/admin/index.astro                     modify: photographs and links sections, saved lines, the issued link
src/components/photos/EntryHead.astro, Frame.astro, Entry.astro, Gallery.astro, PhotoView.astro, Downloads.astro   create
src/components/admin/PhotographsAdmin.astro, LinksAdmin.astro                                                     create
src/components/admin/RemoveForm.astro           modify: link.revoke, a string id, its button's word
src/components/Logbook.astro                    modify: the photos line, the beacon through Beacon.astro
src/components/Beacon.astro                     create: the one script that imports the beacon
src/layouts/Notebook.astro                      modify: ogImage and referrer props
src/lib/logbook.ts                              modify: photos (any published)
src/lib/ingest.ts                               modify: refuse events from /photos/downloads
src/lib/admin/actions.ts, store.ts, validate.ts, submit.ts, purge.ts   modify
src/middleware.ts                               modify: isPrivatePath
src/scripts/photo-sheet.ts, copy-link.ts        create
src/styles/photos.css                           create
src/styles/admin.css                            modify
public/robots.txt                               modify: Disallow /photos/downloads
scripts/photo-manifest.mjs, photo-places.mjs, photo-import-db.mjs, photo-place.swift, photo-cities.json   create
scripts/prepare-photos.mjs, import-photos.mjs, photo-links.mjs, seed-photo-test.mjs, lighthouse.mjs      modify
.github/workflows/ci.yml                        modify: purge the photos tag after a deploy too
playwright.config.ts                            modify: the gallery server (4335); the phone project runs the gallery and photo-page specs
tests/unit/photo-entries, photo-manifest, prepare-photos, photo-workspace, photo-places, photo-import-db, photo-import-run, photo-publish, photo-actions, photographs-admin, gallery, gallery-page, photo-view, notebook, downloads-page, photo-links-route, link-actions, links-admin   create
tests/unit/photo-downloads, purge, submit, store, logbook, logbook-page, ingest, middleware   modify
tests/e2e/gallery, photo-page, downloads, admin-photos, admin-links, photo-store, gallery-site   create
tests/e2e/photos, admin, admin-layout, logbook, head, privacy, budgets, perf   modify
docs/photo-gallery-backend.md, README.md, docs/superpowers/plans/2026-10-03-redesign-roadmap.md   modify
docs/superpowers/plans/2026-10-08-plan-6-followups.md   create
```

Tasks touch shared files in this order, so each builds on the last: `store.ts` (1, 2, 9, 10, 11), `http.ts` (1, 10), `seed-photo-test.mjs` (1, 2), `photos.spec.ts` (1, 2, 10), `prepare-photos.mjs` (2, 3, 4), `import-photos.mjs` (2, 4), `photo-manifest.mjs` (2, 3, 4), `photo-workspace.ts` and `prepare-photos.test.ts` (2, 3, 4), `purge.ts` and `submit.ts` (5, 6, 11), `actions.ts`, `validate.ts`, admin `store.ts`, `admin/index.astro`, `admin.css` and `admin-layout.spec.ts` (6, 11), `store.test.ts` and `submit.test.ts` (6, 11), `photo-store.ts` (6, 10), `admin-photos.spec.ts` (6, 9), `photo-entries.test.ts` (1, 9), `gallery.ts` (7, 9, 10), `gallery.test.ts` (7, 9), `photos.css` (7, 9, 10), `Gallery.astro` and `gallery.spec.ts` (7, 8), `photos/index.astro` (7, 8), `Notebook.astro` (9), `playwright.config.ts` (1, 7, 9), `logbook.spec.ts` (7), `privacy.spec.ts`, `budgets.spec.ts`, `perf.spec.ts` and `ci.yml` (12).

---

### Task 1: migration 0006, the entry mode, date and place

The data layer the rest stands on: `photo_posts`, the RAW review flag and the grant's note and nonce (spec 8); every public query joins a photograph to its post and gains `date` and `place` (spec 2.2); `GET /api/photos?by=entry` answers a page of posts (spec 3.6). The photo fixture grows to spec 11.3's six posts and gets its own e2e server (4335), recreated every run.

**Files:**
- Create: `migrations/0006_photo_gallery.sql`, `tests/unit/photo-entries.test.ts`, `tests/e2e/gallery-site.ts`
- Modify: `src/lib/photos/store.ts`, `src/lib/photos/http.ts`, `src/pages/api/photos/index.ts`, `scripts/seed-photo-test.mjs`, `playwright.config.ts`
- Test: `tests/unit/photo-entries.test.ts`, `tests/unit/photo-downloads.test.ts`, `tests/e2e/photos.spec.ts`

**Interfaces:**
- Consumes: `PHOTO_ID`, `GRANT_ID`, `PhotoToken` from `src/lib/photos/tokens.ts` (existing); `sqliteD1()` from `tests/unit/sqlite-d1.ts` (existing).
- Produces (`src/lib/photos/store.ts`):
  - `interface PhotoRow` gains `raw_review: number`; `interface PublicPhotoRow extends PhotoRow { published_at: number; published_on: string; place: string | null }`
  - `interface PublicPreview { url: string; width: number; height: number; format: "avif" | "webp" }`
  - `interface PublicPhoto { id: string; collection: string; title: string; width: number; height: number; downloadBytes: number; date: string; place: string | null; previews: PublicPreview[] }`
  - `interface Entry { collection: string; date: string; place: string | null; publishedAt: number; photos: PublicPhoto[] }`; `interface EntryPage { entries: Entry[]; next: number | null }`
  - `ENTRY_LIMIT = 4`, `MAX_ENTRY_LIMIT = 12`, `GALLERY_SIZES = [240, 480]`
  - `previewSize(key: string): number`; `publicPhoto(row: PublicPhotoRow, sizes?: readonly number[] | null): PublicPhoto`
  - `entryPage(db: D1Database, before: number | null, limit: number, sizes?: readonly number[]): Promise<EntryPage>`
  - `photoById` and `photoPage` keep their signatures and now join `photo_posts`
- Produces (`src/lib/photos/http.ts`): `entryOptions(url: URL): { before: number | null; limit: number } | null`
- Produces: the gallery e2e server on 4335 with the fixture alone, and `GALLERY = "http://localhost:4335"` in `tests/e2e/gallery-site.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/photo-entries.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { entryOptions } from "../../src/lib/photos/http";
import { entryPage, photoById, photoPage } from "../../src/lib/photos/store";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "d4".repeat(32);
let db: D1Database;
let position = 0;

const previews = (id: string) =>
  [240, 480, 960, 1600].flatMap((size) => ["webp", "avif"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format })));

/** A post and its photographs, in post order; [id, published] */
async function post(collection: string, publishedAt: string, place: string | null, photos: [string, boolean][]) {
  await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)")
    .bind(collection, Date.parse(publishedAt) / 1000, publishedAt.slice(0, 10), place).run();
  for (const [id, published] of photos) await photo(id, collection, published);
}

async function photo(id: string, collection: string, published: boolean) {
  await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, collection, position++, "", published ? 1 : 0, JSON.stringify(previews(id)), `prints/${id}/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
}

beforeEach(async () => {
  db = sqliteD1();
  position = 0;
  // Oldest first here; the gallery shows them newest first
  await post("oldest", "2025-02-02T20:27:48+11:00", "valletta, malta", [["oldest-01", true]]);
  await post("hidden", "2025-06-01T10:00:00+10:00", null, [["hidden-01", false]]);
  await post("middle", "2025-08-09T16:45:00+10:00", null, [["middle-01", true], ["middle-02", false], ["middle-03", true]]);
  await post("newest", "2026-09-27T18:30:00+10:00", "bondi, sydney", [["newest-01", true]]);
});

describe("entryPage", () => {
  test("pages posts newest first, asking for one more than the limit to know if there's a next page", async () => {
    const first = await entryPage(db, null, 2);
    expect(first.entries.map((entry) => entry.collection)).toEqual(["newest", "middle"]);
    expect(first.next).toBe(Date.parse("2025-08-09T16:45:00+10:00") / 1000);
    const second = await entryPage(db, first.next, 2);
    expect(second.entries.map((entry) => entry.collection)).toEqual(["oldest"]);
    expect(second.next).toBeNull();
  });

  test("a post with no published photograph is left out, and hidden photographs are left out of their post", async () => {
    const { entries } = await entryPage(db, null, 12);
    expect(entries.map((entry) => entry.collection)).toEqual(["newest", "middle", "oldest"]);
    expect(entries[1].photos.map((p) => p.id)).toEqual(["middle-01", "middle-03"]);
  });

  test("each entry and photograph carries the post's date and place, with only the 240 and 480 previews", async () => {
    const { entries } = await entryPage(db, null, 4);
    expect(entries[0]).toMatchObject({ collection: "newest", date: "2026-09-27", place: "bondi, sydney", publishedAt: 1790497800 });
    expect(entries[0].photos[0]).toMatchObject({ id: "newest-01", date: "2026-09-27", place: "bondi, sydney", width: 2048, height: 2048, downloadBytes: 1000 });
    expect(entries[0].photos[0].previews.map((p) => p.url.split("/").at(-1))).toEqual(["240.webp", "240.avif", "480.webp", "480.avif"]);
    expect(entries[1].place).toBeNull();
    expect(JSON.stringify(entries)).not.toMatch(/prints\/|print_key|sha256/);
  });

  test("the cursor is strict: a post at exactly that second is on the previous page", async () => {
    const { entries } = await entryPage(db, 1790497800, 4);
    expect(entries[0].collection).toBe("middle");
    expect((await entryPage(db, 1, 4)).entries).toEqual([]);
  });

  test("a photograph whose post row is missing isn't shown anywhere public", async () => {
    await photo("orphan-01", "orphan", true);
    expect(await photoById(db, "orphan-01")).toBeNull();
    expect((await photoPage(db, -1, 48)).photos.map((p) => p.id)).not.toContain("orphan-01");
    expect((await entryPage(db, null, 12)).entries.map((entry) => entry.collection)).not.toContain("orphan");
  });

  test("the catalogue without the entry mode keeps all eight previews and gains date and place", async () => {
    const page = await photoPage(db, -1, 48);
    expect(page.photos[0]).toMatchObject({ id: "oldest-01", date: "2025-02-02", place: "valletta, malta" });
    expect(page.photos[0].previews).toHaveLength(8);
  });
});

describe("entryOptions", () => {
  const options = (query: string) => entryOptions(new URL(`https://curiousgeorge.dev/api/photos?${query}`));

  test("defaults to the newest four", () => {
    expect(options("by=entry")).toEqual({ before: null, limit: 4 });
    expect(options("by=entry&before=1738488468&limit=12")).toEqual({ before: 1738488468, limit: 12 });
  });

  test("refuses anything else, as the catalogue does", () => {
    for (const query of ["by=post", "by=entry&limit=0", "by=entry&limit=13", "by=entry&before=abc", "by=entry&before=12345678901", "by=entry&before=-1", "by=entry&after=1", "by=entry&token=x", "by=entry&by=entry"]) {
      expect(options(query)).toBeNull();
    }
  });
});
```

In `tests/unit/photo-downloads.test.ts`, every photograph now needs its post row. In `database()`, add before the `for` loop:

```ts
  await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)").bind("fixture", 1790497800, "2026-09-27", "bondi, sydney").run();
```

Run: `bun run test:unit tests/unit/photo-entries.test.ts tests/unit/photo-downloads.test.ts`
Expected: FAIL: `entryOptions` and `entryPage` aren't exported, and `photo_posts` doesn't exist ("no such table: photo_posts").

- [ ] **Step 2: The migration**

Create `migrations/0006_photo_gallery.sql` (spec 8, verbatim):

```sql
CREATE TABLE photo_posts (
  collection TEXT PRIMARY KEY,
  published_at INTEGER NOT NULL UNIQUE,      -- seconds since 1970, from Instagram
  published_on TEXT NOT NULL,                -- YYYY-MM-DD in the post's own offset
  place TEXT,                                -- "area, city" or null
  place_edited INTEGER NOT NULL DEFAULT 0 CHECK (place_edited IN (0, 1))
);
ALTER TABLE photos ADD COLUMN raw_review INTEGER NOT NULL DEFAULT 0 CHECK (raw_review IN (0, 1));

ALTER TABLE photo_download_grants ADD COLUMN note TEXT;
ALTER TABLE photo_download_grants ADD COLUMN request_nonce TEXT;
CREATE UNIQUE INDEX photo_grants_nonce ON photo_download_grants(request_nonce);
```

Run: `bun run db:migrate:local`
Expected: `0006_photo_gallery.sql` applied, recorded in `d1_migrations`.

- [ ] **Step 3: The post join and the entry mode in the store**

In `src/lib/photos/store.ts`, replace everything from `export interface PhotoRow {` down to the end of `photoPage` (the `grantIsActive`, `insertGrant` and `revokeGrant` functions below it stay as they are) with:

```ts
export interface PhotoRow {
  id: string;
  collection: string;
  position: number;
  title: string;
  published: number;
  raw_review: number;
  previews: string;
  print_key: string;
  print_width: number;
  print_height: number;
  print_bytes: number;
  print_sha256: string;
}
/** A photograph joined to its post: every public query joins the two, so a photograph without a post isn't shown (spec 8) */
export interface PublicPhotoRow extends PhotoRow {
  published_at: number;
  published_on: string;
  place: string | null;
}
export interface PublicPreview {
  url: string;
  width: number;
  height: number;
  format: "avif" | "webp";
}
export interface PublicPhoto {
  id: string;
  collection: string;
  title: string;
  width: number;
  height: number;
  downloadBytes: number;
  /** The day the post went up, in the post's own offset (YYYY-MM-DD) */
  date: string;
  /** "area, city", or null (ADR-0022) */
  place: string | null;
  previews: PublicPreview[];
}
/** One Instagram post with its published photographs in post order: an entry in the gallery (spec 3.2) */
export interface Entry {
  collection: string;
  date: string;
  place: string | null;
  /** Seconds since 1970: the sort key and the pager's cursor */
  publishedAt: number;
  photos: PublicPhoto[];
}
export interface EntryPage {
  entries: Entry[];
  /** The cursor for the next page (the last entry's publishedAt), or null at the end */
  next: number | null;
}
export const CATALOGUE_LIMIT = 24;
export const MAX_CATALOGUE_LIMIT = 48;
export const ENTRY_LIMIT = 4;
export const MAX_ENTRY_LIMIT = 12;
/** The previews the gallery uses (spec 3.3) */
export const GALLERY_SIZES = [240, 480] as const;

const PUBLIC = "SELECT photos.*, photo_posts.published_at, photo_posts.published_on, photo_posts.place FROM photos JOIN photo_posts ON photo_posts.collection = photos.collection";
/** A page of posts that have a published photograph, newest first; bound with (cursor, limit + 1) */
const POSTS =
  "SELECT collection, published_at, published_on, place FROM photo_posts WHERE published_at < ? AND EXISTS (SELECT 1 FROM photos WHERE photos.collection = photo_posts.collection AND photos.published = 1) ORDER BY published_at DESC LIMIT ?";
/** Later than any post: ?before= allows ten digits */
const NEWEST = 9_999_999_999;

interface PostRow {
  collection: string;
  published_at: number;
  published_on: string;
  place: string | null;
}

/** A preview's size from its key: photos/previews/<id>/<sha>/240.avif is 240 */
export const previewSize = (key: string) => Number(/\/(\d+)\.(?:avif|webp)$/.exec(key)?.[1] ?? 0);

/** The public face of a photograph: no private key, no hash. `sizes` keeps only those previews (the gallery's 240 and 480) */
export function publicPhoto(row: PublicPhotoRow, sizes: readonly number[] | null = null): PublicPhoto {
  const previews = (JSON.parse(row.previews) as Preview[]).filter((preview) => sizes === null || sizes.includes(previewSize(preview.key)));
  return {
    id: row.id, collection: row.collection, title: row.title,
    width: row.print_width, height: row.print_height, downloadBytes: row.print_bytes,
    date: row.published_on, place: row.place,
    previews: previews.map(({ key, width, height, format }) => ({ url: `/media/${key}`, width, height, format })),
  };
}

export async function photoById(db: D1Database, id: string): Promise<PublicPhotoRow | null> {
  if (!PHOTO_ID.test(id)) return null;
  return db.prepare(`${PUBLIC} WHERE photos.id = ? AND photos.published = 1`).bind(id).first<PublicPhotoRow>();
}

export async function photoPage(db: D1Database, after = -1, limit = CATALOGUE_LIMIT, collection: string | null = null) {
  const result = collection === null
    ? await db.prepare(`${PUBLIC} WHERE photos.published = 1 AND photos.position > ? ORDER BY photos.position LIMIT ?`).bind(after, limit + 1).all<PublicPhotoRow>()
    : await db.prepare(`${PUBLIC} WHERE photos.published = 1 AND photos.position > ? AND photos.collection = ? ORDER BY photos.position LIMIT ?`).bind(after, collection, limit + 1).all<PublicPhotoRow>();
  const rows = result.results.slice(0, limit);
  return { photos: rows.map((row) => publicPhoto(row)), next: result.results.length > limit ? rows.at(-1)!.position : null };
}

/**
 * A page of entries posted before `before` (seconds; null for the newest), each with its published photographs in post
 * order (spec 3.2 and 3.6). One batch: the page of posts, then their photographs, which repeats the page's subquery so
 * both run in the same round trip (spec 3.5). It asks for limit + 1 posts to know whether a next page exists.
 */
export async function entryPage(db: D1Database, before: number | null, limit: number, sizes: readonly number[] = GALLERY_SIZES): Promise<EntryPage> {
  const cursor = before ?? NEWEST;
  const [posts, photos] = await db.batch([
    db.prepare(POSTS).bind(cursor, limit + 1),
    db.prepare(
      `SELECT photos.*, page.published_at, page.published_on, page.place FROM photos JOIN (${POSTS}) AS page ON page.collection = photos.collection WHERE photos.published = 1 ORDER BY page.published_at DESC, photos.position`,
    ).bind(cursor, limit + 1),
  ]);
  const postRows = posts.results as unknown as PostRow[];
  const shown = postRows.slice(0, limit);
  const byPost = new Map(shown.map((post) => [post.collection, [] as PublicPhoto[]]));
  for (const row of photos.results as unknown as PublicPhotoRow[]) byPost.get(row.collection)?.push(publicPhoto(row, sizes));
  return {
    entries: shown.map((post) => ({ collection: post.collection, date: post.published_on, place: post.place, publishedAt: post.published_at, photos: byPost.get(post.collection) ?? [] })),
    next: postRows.length > limit ? shown.at(-1)!.published_at : null,
  };
}
```

In `src/lib/photos/http.ts`, change the import line to:

```ts
import { CATALOGUE_LIMIT, ENTRY_LIMIT, MAX_CATALOGUE_LIMIT, MAX_ENTRY_LIMIT } from "./store";
```

and add after `pageOptions`:

```ts
/** The entry mode's query (spec 3.6): by=entry, an optional before (seconds) and a limit from 1 to 12; anything else is null */
export function entryOptions(url: URL): { before: number | null; limit: number } | null {
  if ([...url.searchParams.keys()].some((key) => !["by", "before", "limit"].includes(key))) return null;
  if (url.searchParams.getAll("by").join(",") !== "entry") return null;
  const before = url.searchParams.get("before");
  const limit = url.searchParams.get("limit") ?? String(ENTRY_LIMIT);
  if ((before !== null && !/^\d{1,10}$/.test(before)) || !/^\d{1,2}$/.test(limit)) return null;
  if (Number(limit) < 1 || Number(limit) > MAX_ENTRY_LIMIT) return null;
  return { before: before === null ? null : Number(before), limit: Number(limit) };
}
```

Replace `src/pages/api/photos/index.ts` with:

```ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { entryOptions, pageOptions, photoJson } from "../../../lib/photos/http";
import { entryPage, photoPage } from "../../../lib/photos/store";

export const GET: APIRoute = async ({ url, cache }) => {
  // The entry mode (spec 3.6): a page of posts, each with its published photographs and only the gallery's previews
  if (url.searchParams.has("by")) {
    const options = entryOptions(url);
    if (!options) return photoJson({ error: "Invalid catalogue query." }, 400);
    try {
      const page = await entryPage(env.DB, options.before, options.limit);
      cache.set({ maxAge: 60, swr: 300, tags: ["photos"] });
      return photoJson({ entries: page.entries.map(({ collection, date, place, photos }) => ({ collection, date, place, photos })), next: page.next });
    } catch { console.error("photos: catalogue unavailable"); return photoJson({ error: "Catalogue temporarily unavailable." }, 503); }
  }
  const options = pageOptions(url);
  if (!options || [...url.searchParams.keys()].some((key) => !["after", "limit", "collection"].includes(key))) return photoJson({ error: "Invalid catalogue query." }, 400);
  try {
    const page = await photoPage(env.DB, options.after, options.limit, options.collection);
    cache.set({ maxAge: 60, swr: 300, tags: ["photos"] });
    return photoJson(page);
  }
  catch { console.error("photos: catalogue unavailable"); return photoJson({ error: "Catalogue temporarily unavailable." }, 503); }
};
```

Run: `bun run test:unit tests/unit/photo-entries.test.ts tests/unit/photo-downloads.test.ts && bun run typecheck`
Expected: PASS; 0 errors.

- [ ] **Step 4: The six-post fixture and its own server**

Replace `scripts/seed-photo-test.mjs` with:

```js
import { createHash } from "node:crypto";
import sharp from "sharp";
import { photoPlatform } from "./photo-platform.mjs";

const i = process.argv.indexOf("--persist-to");
if (i < 0 || !process.argv[i + 1] || process.argv.includes("--remote")) throw new Error("usage: node scripts/seed-photo-test.mjs --persist-to local-fixture-directory");

// The gallery fixture (spec 11.3), newest first: six posts, so the gallery has a second page. fixture-03 is unpublished,
// fixture-b has no place, fixture-c-01 awaits RAW review and only fixture-01 has a title.
const POSTS = [
  { collection: "fixture", publishedAt: "2026-09-27T18:30:00+10:00", place: "bondi, sydney", photos: [["fixture-01", 2048, 2048, "a test photograph"], ["fixture-02", 2048, 2048], ["fixture-03", 2048, 2048]] },
  { collection: "fixture-b", publishedAt: "2026-06-14T09:15:00+10:00", place: null, photos: [["fixture-b-01", 4000, 6000], ["fixture-b-02", 6000, 4000]] },
  { collection: "fixture-c", publishedAt: "2026-03-01T12:00:00+11:00", place: "fremantle, perth", photos: [["fixture-c-01", 1200, 1800]] },
  { collection: "fixture-d", publishedAt: "2025-12-25T08:00:00+11:00", place: "manly, sydney", photos: [["fixture-d-01", 2048, 2048]] },
  { collection: "fixture-e", publishedAt: "2025-08-09T16:45:00+10:00", place: "braddon, canberra", photos: [["fixture-e-01", 2048, 2048]] },
  { collection: "fixture-f", publishedAt: "2025-02-02T20:27:48+11:00", place: "valletta, malta", photos: [["fixture-f-01", 2048, 2048]] },
];
const UNPUBLISHED = new Set(["fixture-03"]);
const RAW = new Set(["fixture-c-01"]);
const SIZES = [480, 960, 1600];
const COLOURS = ["#25475e", "#5e4a25", "#3d5e25", "#5e2541", "#2f2f5e", "#5e3b25"];

const platform = await photoPlatform({ persistTo: process.argv[i + 1], remote: false });
try {
  // Fixtures only: a store that already holds real photographs (a local import) is refused, so they can never mix
  const real = await platform.env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE collection NOT LIKE 'fixture%'").first("n");
  if (real > 0) throw new Error("This store holds real photos; seed a separate store (--persist-to)");
  let position = 0;
  for (const [index, post] of POSTS.entries()) {
    // Upserts, so seeding the main store again (bun run check) refreshes it rather than failing
    await platform.env.DB.prepare(`INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)
      ON CONFLICT(collection) DO UPDATE SET published_at = excluded.published_at, published_on = excluded.published_on, place = excluded.place, place_edited = 0`)
      .bind(post.collection, Date.parse(post.publishedAt) / 1000, post.publishedAt.slice(0, 10), post.place).run();
    for (const [id, width, height, title = ""] of post.photos) {
      const jpeg = await sharp({ create: { width, height, channels: 3, background: COLOURS[index] } }).withIccProfile("srgb").jpeg().toBuffer();
      const sha = createHash("sha256").update(jpeg).digest("hex");
      const printKey = `prints/${id}/${sha}.jpg`;
      await platform.env.PHOTO_PRINTS.put(printKey, jpeg, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: sha } });
      const previews = [];
      for (const size of SIZES) for (const format of ["webp", "avif"]) {
        // Fitted inside the square, as photos:prepare does, so each preview has its real width and height
        const resized = sharp(jpeg).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
        const { data, info } = await (format === "webp" ? resized.webp() : resized.avif({ effort: 0 })).toBuffer({ resolveWithObject: true });
        const key = `photos/previews/${id}/${sha}/${size}.${format}`;
        await platform.env.MEDIA.put(key, data, { httpMetadata: { contentType: `image/${format}` } });
        previews.push({ key, width: info.width, height: info.height, format });
      }
      await platform.env.DB.prepare(`INSERT INTO photos (id, collection, position, title, published, raw_review, previews, print_key, print_width, print_height, print_bytes, print_sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET collection = excluded.collection, position = excluded.position, title = excluded.title, published = excluded.published,
        raw_review = excluded.raw_review, previews = excluded.previews, print_key = excluded.print_key, print_width = excluded.print_width,
        print_height = excluded.print_height, print_bytes = excluded.print_bytes, print_sha256 = excluded.print_sha256`)
        .bind(id, post.collection, position++, title, UNPUBLISHED.has(id) ? 0 : 1, RAW.has(id) ? 1 : 0, JSON.stringify(previews), printKey, width, height, jpeg.length, sha).run();
    }
  }
  console.log(`Seeded ${POSTS.length} synthetic photo posts into local storage.`);
} finally { await platform.dispose(); }
```

In `playwright.config.ts`, add after the 4333 entry of `webServer`:

```ts
        // A fifth server with the photo fixture alone (spec 11.3), for the read-only gallery, photo-page, budget,
        // layout-shift and privacy specs: deleted, migrated (with the logbook seed) and seeded afresh on every run, so
        // George's own import in .wrangler/state is never read or changed
        {
          command:
            "rm -rf .wrangler/gallery && wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/gallery && node scripts/seed-photo-test.mjs --persist-to .wrangler/gallery && wrangler dev -c dist/server/wrangler.json --port 4335 --persist-to .wrangler/gallery",
          url: "http://localhost:4335",
          reuseExistingServer: false,
          timeout: 120_000,
        },
```

Create `tests/e2e/gallery-site.ts`:

```ts
/** The e2e server holding only the photo fixture (spec 11.3), recreated on every run; no spec writes to it */
export const GALLERY = "http://localhost:4335";
```

Run: `rm -rf .wrangler/seed-check && bunx wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/seed-check && node scripts/seed-photo-test.mjs --persist-to .wrangler/seed-check && node scripts/seed-photo-test.mjs --persist-to .wrangler/seed-check; rm -rf .wrangler/seed-check`
Expected: `Seeded 6 synthetic photo posts into local storage.` twice (the second run upserts).

- [ ] **Step 5: The e2e catalogue tests**

In `tests/e2e/photos.spec.ts`, add `import { GALLERY } from "./gallery-site";` after its `./admin` import. In `"public API returns responsive previews without drafts or private object keys"`, add after the `fixture-03` 404 line:

```ts
  expect(await (await request.get(`${ADMIN}/api/photos/fixture-01`)).json()).toMatchObject({ id: "fixture-01", date: "2026-09-27", place: "bondi, sydney" });
```

Replace the test `"catalogue grants expose protected links and stop working after revocation"` with:

```ts
test("catalogue grants expose protected links and stop working after revocation", async ({ request }) => {
  const issued = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: {} });
  expect(issued.status()).toBe(201);
  const link = await issued.json();
  const page = await request.get(link.url);
  expect(page.headers()).toMatchObject(PRIVATE);
  const catalogue = await page.json();
  const ids = catalogue.photos.map((p: { id: string }) => p.id);
  // The admin specs publish and hide their own posts meanwhile, so only photographs no spec changes are pinned
  expect(ids).toEqual(expect.arrayContaining(["fixture-01", "fixture-02"]));
  expect(ids).not.toContain("fixture-03");
  expect(catalogue.photos[0]).toMatchObject({ id: "fixture-01", date: "2026-09-27", place: "bondi, sydney" });
  expect((await request.get(`${ADMIN}${catalogue.photos[1].downloadUrl}`)).status()).toBe(200);
  await request.delete(`${ADMIN}/admin/photos/links?grantId=${link.grantId}`, { headers: { Origin: ADMIN } });
  expect((await request.get(link.url)).status()).toBe(403);
});
```

Replace the test `"publishing requires verified assets and refreshes the catalogue"` with:

```ts
test("publishing requires verified assets and refreshes the catalogue", async ({ request }) => {
  // fixture-d-01, which no other spec changes (the admin server's store is shared by every spec on 4333)
  const path = `${ADMIN}/admin/photos/fixture-d-01`;
  const hidden = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: false } });
  expect(hidden.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-d-01`)).status()).toBe(404);
  const published = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: true } });
  expect(published.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-d-01?`)).status()).toBe(200);
});
```

and add at the end of the file:

```ts
// On the gallery server (4335), whose photo fixture no spec changes
test("the entry mode pages posts newest first, with only the gallery's previews", async ({ request }) => {
  const response = await request.get(`${GALLERY}/api/photos?by=entry&limit=4`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300");
  const page = await response.json();
  expect(page.entries.map((entry: { collection: string }) => entry.collection)).toEqual(["fixture", "fixture-b", "fixture-c", "fixture-d"]);
  expect(page.next).toBe(1766610000);
  expect(page.entries[0]).toMatchObject({ collection: "fixture", date: "2026-09-27", place: "bondi, sydney" });
  expect(page.entries[0]).not.toHaveProperty("publishedAt");
  expect(page.entries[1].place).toBeNull();
  expect(page.entries[0].photos.map((photo: { id: string }) => photo.id)).toEqual(["fixture-01", "fixture-02"]);
  expect(page.entries[0].photos[0].previews.map((preview: { url: string }) => preview.url.split("/").at(-1))).toEqual(["480.webp", "480.avif"]);
  const rest = await (await request.get(`${GALLERY}/api/photos?by=entry&before=${page.next}`)).json();
  expect(rest.entries.map((entry: { collection: string }) => entry.collection)).toEqual(["fixture-e", "fixture-f"]);
  expect(rest.next).toBeNull();
  for (const query of ["by=entry&limit=13", "by=entry&before=abc", "by=entry&after=1", "by=post"]) {
    expect((await request.get(`${GALLERY}/api/photos?${query}`)).status()).toBe(400);
  }
});
```

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/photos.spec.ts --project=chromium`
Expected: every test passes, the entry mode's among them.

- [ ] **Step 6: Commit**

```bash
git add migrations/0006_photo_gallery.sql src/lib/photos/store.ts src/lib/photos/http.ts src/pages/api/photos/index.ts scripts/seed-photo-test.mjs playwright.config.ts tests/unit/photo-entries.test.ts tests/unit/photo-downloads.test.ts tests/e2e/photos.spec.ts tests/e2e/gallery-site.ts
git commit -m "feat: photo posts with dates and places; the catalogue's entry mode"
```

---

### Task 2: 240 previews in prepare, import and the publish check

Every photograph gains a 240 preview in AVIF and WebP, so it has eight (spec 2.2 and 3.3). `photos:prepare` encodes 240, 480, 960 and 1600; a checkpoint from before the gallery gets its 240s from the master already on disk, so the master, its SHA-256 and its publication state don't change. `photos:import` and the publish check require eight. The import's structural checks move into `scripts/photo-manifest.mjs`, where tests reach them.

**Files:**
- Create: `scripts/photo-manifest.mjs`, `tests/unit/photo-manifest.test.ts`, `tests/unit/photo-workspace.ts`, `tests/unit/prepare-photos.test.ts`
- Modify: `scripts/prepare-photos.mjs`, `scripts/import-photos.mjs`, `src/lib/photos/store.ts`, `src/pages/admin/photos/[id].ts`, `scripts/seed-photo-test.mjs`
- Test: `tests/unit/photo-manifest.test.ts`, `tests/unit/prepare-photos.test.ts`, `tests/e2e/photos.spec.ts`

**Interfaces:**
- Consumes: the prepare script's existing selection, index and checkpoint formats.
- Produces:
  - `scripts/photo-manifest.mjs`: `PREVIEW_SIZES = [240, 480, 960, 1600]`, `PREVIEW_FORMATS = ["webp", "avif"]`, `PHOTO_ID`, `COLLECTION` (regexes), `checkPhotoRecord(photo): void` (throws `Invalid catalogue record`, `Invalid print key`, `Missing responsive variants` or `Invalid preview key`, each with the id)
  - `src/lib/photos/store.ts`: `PREVIEW_COUNT = 8`
  - `tests/unit/photo-workspace.ts`: `photoWorkspace(posts: FixturePost[]): Promise<{ dir: string; output: string; prepare(env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> }>`, with `FixturePost { post: string; publishedAt: string; slides: { slide: number; width: number; height: number }[] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/photo-manifest.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { checkPhotoRecord, PREVIEW_FORMATS, PREVIEW_SIZES } from "../../scripts/photo-manifest.mjs";

const SHA = "e5".repeat(32);
const preview = (size: number, format: string) => ({ key: `photos/previews/post-01/${SHA}/${size}.${format}`, format });
const record = (over: Record<string, unknown> = {}) => ({
  id: "post-01",
  collection: "post",
  position: 0,
  print: { key: `prints/post-01/${SHA}.jpg`, sha256: SHA },
  previews: PREVIEW_SIZES.flatMap((size: number) => PREVIEW_FORMATS.map((format: string) => preview(size, format))),
  ...over,
});

describe("checkPhotoRecord", () => {
  test("accepts eight previews, 240 to 1600, in WebP and AVIF", () => {
    expect(PREVIEW_SIZES).toEqual([240, 480, 960, 1600]);
    expect(() => checkPhotoRecord(record())).not.toThrow();
  });

  test("refuses a record from before the 240s, with its six previews", () => {
    const six = record().previews.filter((p: { key: string }) => !p.key.includes("/240."));
    expect(() => checkPhotoRecord(record({ previews: six }))).toThrow("Missing responsive variants: post-01");
  });

  test("refuses a repeated preview, a size the site doesn't use and a format that doesn't match its key", () => {
    const previews = record().previews;
    expect(() => checkPhotoRecord(record({ previews: [...previews.slice(1), previews[2]] }))).toThrow("Missing responsive variants");
    expect(() => checkPhotoRecord(record({ previews: [...previews.slice(1), preview(320, "webp")] }))).toThrow("Invalid preview key");
    expect(() => checkPhotoRecord(record({ previews: [{ ...previews[0], format: "avif" }, ...previews.slice(1)] }))).toThrow("Invalid preview key");
  });

  test("refuses a bad id, collection, position or print key", () => {
    expect(() => checkPhotoRecord(record({ id: "../secret" }))).toThrow("Invalid catalogue record");
    expect(() => checkPhotoRecord(record({ collection: "a/b" }))).toThrow("Invalid catalogue record");
    expect(() => checkPhotoRecord(record({ position: -1 }))).toThrow("Invalid catalogue record");
    expect(() => checkPhotoRecord(record({ print: { key: `prints/other-01/${SHA}.jpg`, sha256: SHA } }))).toThrow("Invalid print key");
  });
});
```

Create `tests/unit/photo-workspace.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const PREPARE = fileURLToPath(new URL("../../scripts/prepare-photos.mjs", import.meta.url));

export interface FixtureSlide {
  slide: number;
  width: number;
  height: number;
}
export interface FixturePost {
  post: string;
  publishedAt: string;
  slides: FixtureSlide[];
}

/**
 * A private folder outside the checkout, laid out as photos:prepare reads George's: small edited JPEGs and their
 * originals, an index and a selection. Synthetic only: no test ever reads the real library or prepared assets.
 */
export async function photoWorkspace(posts: FixturePost[]) {
  const dir = await mkdtemp(join(tmpdir(), "photo-prepare-"));
  const sources = join(dir, "sources");
  await mkdir(sources);
  const index = [];
  const included = [];
  for (const { post, publishedAt, slides } of posts) {
    for (const { slide, width, height } of slides) {
      const id = `${post}-${String(slide).padStart(2, "0")}`;
      const edited = join(sources, `${id}-edited.jpg`);
      const original = join(sources, `${id}-original.jpg`);
      for (const path of [edited, original]) await sharp({ create: { width, height, channels: 3, background: "#4a6b5e" } }).jpeg().toFile(path);
      index.push({
        post, slide, published_at: publishedAt, status: "matched", media_type: "photo", largest_original_pixels: 24_000_000,
        files: [
          { path: edited, kind: "edited", resource_role: "primary", display_width: width, display_height: height },
          { path: original, kind: "original", resource_role: "primary", display_width: width, display_height: height },
        ],
      });
      included.push({ id, post, slide });
    }
  }
  await writeFile(join(dir, "index.json"), JSON.stringify(index));
  await writeFile(join(dir, "selection.json"), JSON.stringify({ schema_version: 1, included, excluded: [], counts: {} }));
  const output = join(dir, "assets");
  return {
    dir,
    output,
    prepare: (env: Record<string, string> = {}) =>
      run(process.execPath, [PREPARE, "--selection", join(dir, "selection.json"), "--index", join(dir, "index.json"), "--output", output], { env: { ...process.env, ...env } }),
  };
}
```

Create `tests/unit/prepare-photos.test.ts`:

```ts
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, test } from "vitest";
import { photoWorkspace, type FixturePost } from "./photo-workspace";

const POSTS: FixturePost[] = [
  { post: "postA", publishedAt: "2025-02-02T20:27:48+11:00", slides: [{ slide: 1, width: 300, height: 450 }, { slide: 2, width: 450, height: 300 }] },
];
interface PreviewRecord { key: string; file: string; width: number; height: number }
const name = (preview: PreviewRecord) => preview.key.split("/").at(-1);
let folders: string[] = [];
afterEach(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
  folders = [];
});

async function prepared(posts = POSTS) {
  const workspace = await photoWorkspace(posts);
  folders.push(workspace.dir);
  await workspace.prepare();
  return workspace;
}

describe("photos:prepare", () => {
  test("encodes eight previews per photo, 240 to 1600 in WebP and AVIF, each fitted inside its square", { timeout: 60_000 }, async () => {
    const { output } = await prepared();
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    const [portrait, landscape] = manifest.photos as { previews: PreviewRecord[] }[];
    expect(portrait.previews.map(name)).toEqual(["240.webp", "240.avif", "480.webp", "480.avif", "960.webp", "960.avif", "1600.webp", "1600.avif"]);
    expect(portrait.previews.slice(0, 2).map((p) => [p.width, p.height])).toEqual([[160, 240], [160, 240]]);
    expect(landscape.previews[0]).toMatchObject({ width: 240, height: 160 });
    for (const preview of portrait.previews) expect((await sharp(join(output, preview.file)).metadata()).width).toBe(preview.width);
  });

  test("a checkpoint from before the 240s gains them from its master, without rendering it again", { timeout: 60_000 }, async () => {
    const workspace = await prepared();
    const checkpoint = join(workspace.output, "metadata", "postA-01.json");
    const before = JSON.parse(await readFile(checkpoint, "utf8"));
    // Make it look like a checkpoint written before the gallery: no 240s, on disk or in the record
    const old = (before.previews as PreviewRecord[]).filter((p) => !p.key.includes("/240."));
    for (const preview of (before.previews as PreviewRecord[]).filter((p) => p.key.includes("/240."))) await rm(join(workspace.output, preview.file));
    await writeFile(checkpoint, JSON.stringify({ ...before, previews: old }));
    const master = await stat(join(workspace.output, before.print.file));
    await workspace.prepare();
    const after = JSON.parse(await readFile(checkpoint, "utf8"));
    expect(after.print).toEqual(before.print);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect((await stat(join(workspace.output, before.print.file))).mtimeMs).toBe(master.mtimeMs);
    expect((after.previews as PreviewRecord[]).map((p) => p.key)).toEqual((before.previews as PreviewRecord[]).map((p) => p.key));
    for (const preview of after.previews as PreviewRecord[]) await stat(join(workspace.output, preview.file));
  });
});
```

Run: `bun run test:unit tests/unit/photo-manifest.test.ts tests/unit/prepare-photos.test.ts`
Expected: FAIL: `scripts/photo-manifest.mjs` doesn't exist, and prepare writes six previews.

- [ ] **Step 2: The manifest checks**

Create `scripts/photo-manifest.mjs`:

```js
// The prepared manifest's shape, checked before the import touches any storage (spec 2.2 and 7.3)

/** Every photograph has these four sizes in both formats: eight previews (spec 2.2) */
export const PREVIEW_SIZES = [240, 480, 960, 1600];
export const PREVIEW_FORMATS = ["webp", "avif"];
export const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}-\d{2,3}$/;
export const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;

/** Throws unless one photograph's record is well formed: its id, its post, its master's key and its eight previews */
export function checkPhotoRecord(photo) {
  if (typeof photo.id !== "string" || !PHOTO_ID.test(photo.id) || !Number.isSafeInteger(photo.position) || photo.position < 0 || typeof photo.collection !== "string" || !COLLECTION.test(photo.collection)) {
    throw new Error(`Invalid catalogue record: ${photo.id}`);
  }
  if (typeof photo.print?.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(photo.print.sha256) || photo.print.key !== `prints/${photo.id}/${photo.print.sha256}.jpg`) {
    throw new Error(`Invalid print key: ${photo.id}`);
  }
  const expected = PREVIEW_SIZES.flatMap((size) => PREVIEW_FORMATS.map((format) => `photos/previews/${photo.id}/${photo.print.sha256}/${size}.${format}`));
  const keys = Array.isArray(photo.previews) ? photo.previews.map((preview) => preview.key) : [];
  if (keys.length !== expected.length || new Set(keys).size !== keys.length) throw new Error(`Missing responsive variants: ${photo.id}`);
  for (const preview of photo.previews) {
    if (!expected.includes(preview.key) || !preview.key.endsWith(`.${preview.format}`)) throw new Error(`Invalid preview key: ${photo.id}`);
  }
}
```

Run: `bun run test:unit tests/unit/photo-manifest.test.ts`
Expected: PASS.

- [ ] **Step 3: Prepare encodes the 240s, and derives them for old checkpoints**

In `scripts/prepare-photos.mjs`:

Add after the `import sharp from "sharp";` line:

```js
import { PREVIEW_FORMATS, PREVIEW_SIZES } from "./photo-manifest.mjs";
```

Replace the line `const hash = (data) => createHash("sha256").update(data).digest("hex");` with:

```js
const hash = (data) => createHash("sha256").update(data).digest("hex");

/** Encodes previews of a master at these sizes (each fitted inside its square) and writes them beside it */
async function encodePreviews(data, id, sha256, sizes) {
  const previews = [];
  for (const size of sizes) {
    for (const format of PREVIEW_FORMATS) {
      const resized = sharp(data).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
      const encoded = format === "webp" ? resized.webp({ quality: 82, effort: 4 }) : resized.avif({ quality: 55, effort: 3 });
      const result = await encoded.toBuffer({ resolveWithObject: true });
      const key = `photos/previews/${id}/${sha256}/${size}.${format}`;
      const path = join(output, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, result.data, { mode: 0o600 });
      previews.push({ key, file: key, width: result.info.width, height: result.info.height, format, bytes: result.data.length, sha256: hash(result.data) });
    }
  }
  return previews;
}

async function writeCheckpoint(checkpoint, record) {
  await writeFile(`${checkpoint}.partial`, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  await rename(`${checkpoint}.partial`, checkpoint);
}
```

In `prepare(task)`, replace the cached branch:

```js
    if (cached.fingerprint === fingerprint && (await stat(join(output, cached.print.file))).size === cached.print.bytes) {
      for (const preview of cached.previews) await stat(join(output, preview.file));
      return { ...cached, position };
    }
```

with:

```js
    if (cached.fingerprint === fingerprint && (await stat(join(output, cached.print.file))).size === cached.print.bytes) {
      for (const preview of cached.previews) await stat(join(output, preview.file));
      if (!cached.previews.some((preview) => preview.key.endsWith("/240.webp"))) {
        // A checkpoint from before the gallery has no 240s: derive them from the master already on disk, so the master,
        // its SHA-256 and its publication state stay as they are (spec 2.2)
        const master = await readFile(join(output, cached.print.file));
        if (hash(master) !== cached.print.sha256) throw new Error(`Prepared master changed on disk: ${selected.id}`);
        cached.previews = [...(await encodePreviews(master, selected.id, cached.print.sha256, [240])), ...cached.previews];
        await writeCheckpoint(checkpoint, cached);
      }
      return { ...cached, position };
    }
```

Replace the whole preview loop, from `const previews = [];` down to the loop's closing `}` (the one before `const original = ...`), with:

```js
  const previews = await encodePreviews(data, selected.id, sha256, PREVIEW_SIZES);
```

and replace the two lines that write the checkpoint at the end of `prepare`:

```js
  await writeFile(`${checkpoint}.partial`, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  await rename(`${checkpoint}.partial`, checkpoint);
```

with:

```js
  await writeCheckpoint(checkpoint, record);
```

Run: `bun run test:unit tests/unit/prepare-photos.test.ts`
Expected: PASS (both tests, about 10 seconds).

- [ ] **Step 4: Import and publish require eight**

In `scripts/import-photos.mjs`, add after the `import sharp from "sharp";` line:

```js
import { checkPhotoRecord } from "./photo-manifest.mjs";
```

Replace the first five lines of the `for (const photo of manifest.photos)` validation loop (from `if (!allowed.has(photo.id) ...` down to and including `if (photo.previews.length !== 6 ...`) with:

```js
  checkPhotoRecord(photo);
  if (!allowed.has(photo.id) || ids.has(photo.id) || positions.has(photo.position)) throw new Error("Excluded, invalid or duplicate photo");
  ids.add(photo.id); positions.add(photo.position);
```

and delete the line inside the asset loop that checks preview keys (it starts `if (asset !== photo.print && (!asset.key.startsWith(`): `checkPhotoRecord` now checks every key against the eight it expects.

In `src/lib/photos/store.ts`, add after `GALLERY_SIZES`:

```ts
/** Every photograph has four sizes (240, 480, 960, 1600) in two formats (spec 2.2) */
export const PREVIEW_COUNT = 8;
```

In `src/pages/admin/photos/[id].ts`, change the store import to:

```ts
import { PREVIEW_COUNT, type Preview, type PhotoRow } from "../../../lib/photos/store";
```

and `if (previews.length !== 6)` to `if (previews.length !== PREVIEW_COUNT)`.

In `scripts/seed-photo-test.mjs`, change `const SIZES = [480, 960, 1600];` to `const SIZES = [240, 480, 960, 1600];`.

In `tests/e2e/photos.spec.ts`, in `"public API returns responsive previews without drafts or private object keys"`, change `toHaveLength(6)` to `toHaveLength(8)`; in `"the entry mode pages posts newest first, with only the gallery's previews"`, change `.toEqual(["480.webp", "480.avif"])` to `.toEqual(["240.webp", "240.avif", "480.webp", "480.avif"])`.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/photos.spec.ts --project=chromium`
Expected: every test passes; the publish test's verification now checks eight previews.

- [ ] **Step 5: Commit**

```bash
git add scripts/photo-manifest.mjs scripts/prepare-photos.mjs scripts/import-photos.mjs scripts/seed-photo-test.mjs src/lib/photos/store.ts src/pages/admin/photos/[id].ts tests/unit/photo-manifest.test.ts tests/unit/photo-workspace.ts tests/unit/prepare-photos.test.ts tests/e2e/photos.spec.ts
git commit -m "feat: 240 previews in prepare, import and the publish check"
```

---
### Task 3: places and dates in prepare

`photos:prepare` writes the manifest's `posts` array, `{ collection, publishedAt, place }` (spec 7.1): each post's time with its offset from the index, and its place from GPS (spec 7.2). A Swift tool reads an original's GPS with ImageIO and asks Apple's geocoder (MapKit) for names only; prepare asks about at most three photos per post, 1.5 seconds apart, caches every answer in `<output>/metadata/places.json` (0600, names only) and keeps the most common place. Area and city come from `scripts/photo-cities.json` and the fallbacks; the place rule applies; an Australian place with no map entry stops prepare before the manifest. The import ignores `posts` until Task 4.

**Files:**
- Create: `src/lib/photos/place.ts`, `scripts/photo-places.mjs`, `scripts/photo-place.swift`, `scripts/photo-cities.json`, `tests/unit/photo-places.test.ts`
- Modify: `scripts/prepare-photos.mjs` (whole file below), `scripts/photo-manifest.mjs`, `tests/unit/photo-workspace.ts` (whole file below)
- Test: `tests/unit/photo-places.test.ts`, `tests/unit/prepare-photos.test.ts`

**Interfaces:**
- Consumes: `PREVIEW_SIZES`, `PREVIEW_FORMATS` from `scripts/photo-manifest.mjs` (Task 2); `photoWorkspace` from `tests/unit/photo-workspace.ts` (Task 2).
- Produces:
  - `src/lib/photos/place.ts`: `PLACE_MAX = 60`; `type PlaceCheck = { ok: true; place: string | null } | { ok: false; error: string }`; `checkPlace(text: string): PlaceCheck` (no imports, so Node scripts can import it)
  - `scripts/photo-places.mjs`: `transliterate(name)`, `cityKey(placemark)`, `placeFromPlacemark(placemark, cities): { place: string | null; missingKey?: string; review?: string }`, `postPlace(places: (string | null)[]): string | null`, `pickGeocoded(photos)` (first, middle and last)
  - `scripts/photo-manifest.mjs`: `PUBLISHED_AT` (the ISO time with offset)
  - `scripts/photo-place.swift`: `photo-place --has-gps <image>` prints `true` or `false`; `photo-place <image>` prints the names as JSON, `{"administrativeArea","isoCountryCode","locality","subAdministrativeArea","subLocality"}` (each a string or null), or `null`
  - The manifest's `posts: { collection: string; publishedAt: string; place: string | null }[]`
  - `photoWorkspace(...).prepare(places?: Record<string, object | null>)` (a recorded geocoder: a file name present has GPS and answers its placemark; absent has none) and `.geocoded(): Promise<string[]>`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/photo-places.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { cityKey, pickGeocoded, placeFromPlacemark, postPlace, transliterate } from "../../scripts/photo-places.mjs";
import { checkPlace } from "../../src/lib/photos/place";

// Shaped like the geocoder's answers (spec 7.2's sample of 2026-10-08: in Australia the suburb comes as the locality)
const BONDI = { subLocality: null, locality: "Bondi Beach", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
const SURRY = { subLocality: null, locality: "Surry Hills", subAdministrativeArea: "Sydney", administrativeArea: "NSW", isoCountryCode: "AU" };
const PERTH = { subLocality: null, locality: "Perth", subAdministrativeArea: "Perth", administrativeArea: "WA", isoCountryCode: "AU" };
const MANHATTAN = { subLocality: "Manhattan", locality: "New York", subAdministrativeArea: "New York County", administrativeArea: "NY", isoCountryCode: "US" };
const SLIEMA = { subLocality: null, locality: "Sliema", subAdministrativeArea: null, administrativeArea: "Northern Harbour", isoCountryCode: "MT" };
const HAMRUN = { subLocality: null, locality: "Ħamrun", subAdministrativeArea: null, administrativeArea: "Ħamrun", isoCountryCode: "MT" };
const GZIRA = { subLocality: null, locality: "Gżira", subAdministrativeArea: null, administrativeArea: "Northern Harbour", isoCountryCode: "MT" };
const SAO_PAULO = { subLocality: "Bela Vista", locality: "São Paulo", subAdministrativeArea: null, administrativeArea: "SP", isoCountryCode: "BR" };
const TOKYO = { subLocality: "渋谷", locality: "東京", subAdministrativeArea: null, administrativeArea: "東京都", isoCountryCode: "JP" };
const CITIES = { "AU/NSW/Waverley Council": "sydney", "AU/WA/Perth": "perth" };

describe("checkPlace, the place rule", () => {
  test("lowercases with en-AU rules and trims; empty is no place", () => {
    expect(checkPlace("  Bondi Beach, Sydney ")).toEqual({ ok: true, place: "bondi beach, sydney" });
    expect(checkPlace("ÉPINAL, VOSGES")).toEqual({ ok: true, place: "épinal, vosges" });
    expect(checkPlace("o'connor, canberra")).toEqual({ ok: true, place: "o'connor, canberra" });
    expect(checkPlace("")).toEqual({ ok: true, place: null });
    expect(checkPlace("   ")).toEqual({ ok: true, place: null });
  });

  test("refuses more than 60 characters and anything outside printable Latin-1", () => {
    expect(checkPlace("a".repeat(60))).toEqual({ ok: true, place: "a".repeat(60) });
    expect(checkPlace("a".repeat(61))).toEqual({ ok: false, error: "60 characters at most" });
    for (const place of ["東京", "gżira, malta", "bondi\tbeach", "bondi\nbeach"]) {
      expect(checkPlace(place)).toEqual({ ok: false, error: "plain latin letters only (accents like é are fine)" });
    }
  });
});

describe("placeFromPlacemark", () => {
  test("an Australian suburb is the area, and its city comes from the map", () => {
    expect(cityKey(BONDI)).toBe("AU/NSW/Waverley Council");
    expect(placeFromPlacemark(BONDI, CITIES)).toEqual({ place: "bondi beach, sydney" });
  });

  test("without a map entry, a sub-locality takes its locality as the city, and anything else its administrative area", () => {
    expect(placeFromPlacemark(MANHATTAN, CITIES)).toEqual({ place: "manhattan, new york" });
    expect(placeFromPlacemark(SLIEMA, CITIES)).toEqual({ place: "sliema, northern harbour" });
  });

  test("an area that is its own city is said once", () => {
    expect(placeFromPlacemark(PERTH, CITIES)).toEqual({ place: "perth" });
  });

  test("an Australian place missing from the map names the key prepare stops for", () => {
    expect(placeFromPlacemark(SURRY, CITIES)).toEqual({ place: null, missingKey: "AU/NSW/Sydney" });
  });

  test("no GPS, or no names, is no place", () => {
    expect(placeFromPlacemark(null, CITIES)).toEqual({ place: null });
    expect(placeFromPlacemark({ subLocality: null, locality: null, subAdministrativeArea: null, administrativeArea: null, isoCountryCode: "AU" }, CITIES)).toEqual({ place: null });
  });

  test("names outside Latin-1 are transliterated; accents inside it are kept", () => {
    expect(transliterate("Ħamrun")).toBe("Hamrun");
    expect(transliterate("Gżira")).toBe("Gzira");
    expect(transliterate("Łódź")).toBe("Lodz");
    expect(transliterate("São Paulo")).toBe("São Paulo");
    expect(placeFromPlacemark(HAMRUN, CITIES)).toEqual({ place: "hamrun" });
    expect(placeFromPlacemark(GZIRA, CITIES)).toEqual({ place: "gzira, northern harbour" });
    expect(placeFromPlacemark(SAO_PAULO, CITIES)).toEqual({ place: "bela vista, são paulo" });
  });

  test("a name still outside Latin-1 is no place, and is listed for review", () => {
    expect(placeFromPlacemark(TOKYO, CITIES)).toEqual({ place: null, review: "渋谷, 東京 (plain latin letters only (accents like é are fine))" });
  });
});

describe("a post's place", () => {
  test("is the most common of its lookups, the first slide's on a tie", () => {
    expect(postPlace(["bronte, sydney", "bondi beach, sydney", "bondi beach, sydney"])).toBe("bondi beach, sydney");
    expect(postPlace(["bronte, sydney", "bondi beach, sydney"])).toBe("bronte, sydney");
    expect(postPlace([null, "bondi beach, sydney"])).toBe("bondi beach, sydney");
    expect(postPlace([null])).toBeNull();
    expect(postPlace([])).toBeNull();
  });

  test("comes from the first, middle and last photos that have GPS", () => {
    expect(pickGeocoded([1, 2, 3, 4, 5])).toEqual([1, 3, 5]);
    expect(pickGeocoded([1, 2, 3, 4])).toEqual([1, 2, 4]);
    expect(pickGeocoded([1, 2])).toEqual([1, 2]);
    expect(pickGeocoded([])).toEqual([]);
  });
});

test("the committed city map starts with the spec's two entries, and every city in it follows the place rule", () => {
  const cities = JSON.parse(readFileSync(new URL("../../scripts/photo-cities.json", import.meta.url), "utf8")) as Record<string, string>;
  expect(cities).toMatchObject({ "AU/NSW/Waverley Council": "sydney", "AU/ACT/City": "canberra" });
  for (const city of Object.values(cities)) expect(checkPlace(city)).toEqual({ ok: true, place: city });
});
```

Add to `tests/unit/prepare-photos.test.ts` (its imports already cover these tests):

```ts
const BONDI = { subLocality: null, locality: "Bondi Beach", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
const BRONTE = { subLocality: null, locality: "Bronte", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
const SURRY = { subLocality: null, locality: "Surry Hills", subAdministrativeArea: "Sydney", administrativeArea: "NSW", isoCountryCode: "AU" };
const portraits = (count: number) => Array.from({ length: count }, (_, i) => ({ slide: i + 1, width: 300, height: 450 }));

describe("photos:prepare's posts and places", () => {
  test("writes each post's time and most common place, asking about each photo once", { timeout: 90_000 }, async () => {
    const workspace = await photoWorkspace([
      { post: "postA", publishedAt: "2025-02-02T20:27:48+11:00", slides: portraits(5) },
      // Half past midnight in Sydney is still the 2nd in UTC: the offset has to survive into the manifest
      { post: "postB", publishedAt: "2025-02-03T00:30:00+11:00", slides: [{ slide: 1, width: 450, height: 300 }] },
    ]);
    folders.push(workspace.dir);
    // Every slide of postA has GPS, so the first, middle and last are asked (1, 3 and 5), and two say bondi. postB has none.
    const places = { "postA-01-original.jpg": BRONTE, "postA-02-original.jpg": BRONTE, "postA-03-original.jpg": BONDI, "postA-04-original.jpg": BRONTE, "postA-05-original.jpg": BONDI };
    const { stdout } = await workspace.prepare(places);
    const manifest = JSON.parse(await readFile(join(workspace.output, "manifest.json"), "utf8"));
    expect(manifest.posts).toEqual([
      { collection: "postA", publishedAt: "2025-02-02T20:27:48+11:00", place: "bondi beach, sydney" },
      { collection: "postB", publishedAt: "2025-02-03T00:30:00+11:00", place: null },
    ]);
    expect(await workspace.geocoded()).toEqual(["postA-01-original.jpg", "postA-03-original.jpg", "postA-05-original.jpg"]);
    expect(stdout).toContain("2025-02-02 postA bondi beach, sydney");
    expect(stdout).toContain("2025-02-03 postB (no place)");
    const cache = join(workspace.output, "metadata", "places.json");
    expect((await stat(cache)).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(await readFile(cache, "utf8")))).toEqual(["postA-01", "postA-03", "postA-05"]);
    // A second run asks nobody: every lookup is cached
    await workspace.prepare(places);
    expect(await workspace.geocoded()).toHaveLength(3);
  });

  test("an Australian place missing from the city map stops prepare before the manifest, naming the key and its post", { timeout: 60_000 }, async () => {
    const workspace = await photoWorkspace([{ post: "postC", publishedAt: "2026-03-01T12:00:00+11:00", slides: portraits(1) }]);
    folders.push(workspace.dir);
    await expect(workspace.prepare({ "postC-01-original.jpg": SURRY })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('"AU/NSW/Sydney"  (post postC)') });
    await expect(stat(join(workspace.output, "manifest.json"))).rejects.toThrow();
  });
});
```

Run: `bun run test:unit tests/unit/photo-places.test.ts tests/unit/prepare-photos.test.ts`
Expected: FAIL: `scripts/photo-places.mjs`, `src/lib/photos/place.ts` and `scripts/photo-cities.json` don't exist, `prepare()` takes no places and `geocoded` isn't a function.

- [ ] **Step 2: The place rule and the naming**

Create `src/lib/photos/place.ts`:

```ts
// The place rule (spec 6.2), shared by the admin and photos:prepare. No imports, so Node scripts can load this file directly.

export const PLACE_MAX = 60;
// Printable Latin-1: what the subset fonts can draw (R3)
const LATIN1 = /^[\x20-\x7e\xa0-\xff]*$/;

export type PlaceCheck = { ok: true; place: string | null } | { ok: false; error: string };

/** A place as the site stores it: lowercased with en-AU rules and trimmed; empty is no place (null) */
export function checkPlace(text: string): PlaceCheck {
  const place = text.trim().toLocaleLowerCase("en-AU");
  if (place === "") return { ok: true, place: null };
  if (place.length > PLACE_MAX) return { ok: false, error: `${PLACE_MAX} characters at most` };
  if (!LATIN1.test(place)) return { ok: false, error: "plain latin letters only (accents like é are fine)" };
  return { ok: true, place };
}
```

Create `scripts/photo-cities.json`:

```json
{
  "AU/ACT/City": "canberra",
  "AU/NSW/Waverley Council": "sydney"
}
```

Create `scripts/photo-places.mjs`:

```js
// Turning the geocoder's names into "area, city" (spec 7.2, ADR-0022). Pure functions: prepare does the lookups.
import { checkPlace } from "../src/lib/photos/place.ts";

const LATIN1 = /^[\x20-\x7e\xa0-\xff]*$/;
// Stroke letters NFKD can't split into a letter and a mark
const STROKES = { ħ: "h", Ħ: "H", ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i" };

/** A name outside Latin-1 loses its marks (Gżira becomes Gzira); a name inside it keeps its accents */
export function transliterate(name) {
  if (LATIN1.test(name)) return name;
  return name.replace(/[ħĦłŁđĐı]/g, (letter) => STROKES[letter]).normalize("NFKD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** The city map's key: country, administrative area and the sub-administrative area (or the locality) */
export const cityKey = (placemark) => `${placemark.isoCountryCode}/${placemark.administrativeArea}/${placemark.subAdministrativeArea ?? placemark.locality}`;

const named = (name) => typeof name === "string" && name.trim() !== "";

/**
 * One photo's place from the geocoder's names. The area is the sub-locality, else the locality; the city comes from the
 * map, else the locality when the sub-locality was used, else the administrative area. An Australian place with no map
 * entry gives its missing key, because there the geocoder never names a metropolitan city.
 */
export function placeFromPlacemark(placemark, cities) {
  if (!placemark) return { place: null };
  const area = named(placemark.subLocality) ? placemark.subLocality : placemark.locality;
  if (!named(area)) return { place: null };
  const key = cityKey(placemark);
  let city = Object.hasOwn(cities, key) ? cities[key] : undefined;
  if (city === undefined) {
    if (placemark.isoCountryCode === "AU") return { place: null, missingKey: key };
    city = named(placemark.subLocality) ? placemark.locality : placemark.administrativeArea;
  }
  const names = [area, city].filter(named).map((name) => transliterate(name).trim().toLocaleLowerCase("en-AU"));
  const checked = checkPlace(names.filter((name, i) => names.indexOf(name) === i).join(", "));
  if (!checked.ok) return { place: null, review: `${[area, city].filter(named).join(", ")} (${checked.error})` };
  return { place: checked.place };
}

/** The post's place: the most common of its photos' places, the first slide's on a tie */
export function postPlace(places) {
  const counts = new Map();
  for (const place of places) if (place !== null) counts.set(place, (counts.get(place) ?? 0) + 1);
  let best = null;
  for (const [place, count] of counts) if (best === null || count > counts.get(best)) best = place;
  return best;
}

/** At most three lookups per post: the first, middle and last photos that have GPS */
export function pickGeocoded(photos) {
  if (photos.length <= 3) return photos;
  return [photos[0], photos[Math.floor((photos.length - 1) / 2)], photos.at(-1)];
}
```

In `scripts/photo-manifest.mjs`, add after `COLLECTION`:

```js
/** A post's time as the index gives it, with its own offset: 2025-02-02T20:27:48+11:00 */
export const PUBLISHED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
```

Run: `bun run test:unit tests/unit/photo-places.test.ts`
Expected: PASS.

- [ ] **Step 3: The Swift tool**

Create `scripts/photo-place.swift`:

```swift
// One photo's place names for photos:prepare (spec 7.2, ADR-0022). Reads the image's GPS with ImageIO and asks Apple's
// geocoder through MapKit; prints names only. The coordinates go to Apple's geocoding service and nowhere else: this
// process never prints, logs or writes them. --has-gps only says whether there are any, and asks nobody.
import CoreLocation
import Foundation
import ImageIO
import MapKit

func gpsLocation(_ url: URL) -> CLLocation? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let gps = properties[kCGImagePropertyGPSDictionary] as? [CFString: Any],
          let latitude = gps[kCGImagePropertyGPSLatitude] as? Double,
          let longitude = gps[kCGImagePropertyGPSLongitude] as? Double else { return nil }
    let south = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S"
    let west = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W"
    return CLLocation(latitude: south ? -latitude : latitude, longitude: west ? -longitude : longitude)
}

let arguments = CommandLine.arguments
let checkOnly = arguments.count == 3 && arguments[1] == "--has-gps"
guard arguments.count == 2 || checkOnly else {
    fputs("usage: photo-place [--has-gps] image\n", stderr)
    exit(2)
}
guard let location = gpsLocation(URL(fileURLWithPath: arguments[arguments.count - 1])) else {
    print(checkOnly ? "false" : "null")
    exit(0)
}
if checkOnly {
    print("true")
    exit(0)
}
guard let request = MKReverseGeocodingRequest(location: location) else {
    fputs("Cannot make a geocoding request\n", stderr)
    exit(1)
}
request.preferredLocale = Locale(identifier: "en_AU")
do {
    let items = try await request.mapItems
    // The map item's placemark is the one MapKit object with all five names the city map needs; it carries a
    // deprecation note in the macOS 26 SDK, so swiftc prints one warning for this line
    guard let placemark = items.first?.placemark else {
        print("null")
        exit(0)
    }
    let names: [String: Any] = [
        "subLocality": placemark.subLocality ?? NSNull(),
        "locality": placemark.locality ?? NSNull(),
        "subAdministrativeArea": placemark.subAdministrativeArea ?? NSNull(),
        "administrativeArea": placemark.administrativeArea ?? NSNull(),
        "isoCountryCode": placemark.isoCountryCode ?? NSNull(),
    ]
    let data = try JSONSerialization.data(withJSONObject: names, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} catch {
    fputs("Geocoding failed\n", stderr)
    exit(1)
}
```

Compile it and check it on synthetic images, which needs no network (macOS only; skip this step elsewhere):

```bash
DIR=$(mktemp -d)
xcrun swiftc scripts/photo-place.swift -o "$DIR/photo-place"
node -e '
const sharp = require("sharp");
const dir = process.argv[1];
const make = () => sharp({ create: { width: 64, height: 96, channels: 3, background: "#556677" } });
(async () => {
  await make().jpeg().toFile(`${dir}/plain.jpg`);
  await make().withExif({ IFD3: { GPSLatitudeRef: "S", GPSLatitude: "33/1 53/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "151/1 16/1 0/1" } }).jpeg().toFile(`${dir}/gps.jpg`);
})();
' "$DIR"
"$DIR/photo-place" --has-gps "$DIR/plain.jpg"; "$DIR/photo-place" "$DIR/plain.jpg"; "$DIR/photo-place" --has-gps "$DIR/gps.jpg"; "$DIR/photo-place"; echo "exit $?"
rm -rf "$DIR"
```

Expected: the compile prints exactly one warning, `'placemark' was deprecated in macOS 26.0`, and no error; then `false`, `null`, `true`, the usage line and `exit 2`. Never run the tool without `--has-gps` on an image that has GPS here: that asks Apple, and tasks never geocode.

- [ ] **Step 4: Prepare writes posts and places**

Replace `scripts/prepare-photos.mjs` with:

```js
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { PREVIEW_FORMATS, PREVIEW_SIZES, PUBLISHED_AT } from "./photo-manifest.mjs";
import { pickGeocoded, placeFromPlacemark, postPlace } from "./photo-places.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (!arg("--selection") || !arg("--index") || !arg("--output")) {
  console.error("usage: bun run photos:prepare --selection selection.json --index photo-index.json --output private-folder [--limit N]");
  process.exit(1);
}
const selection = JSON.parse(await readFile(resolve(arg("--selection")), "utf8"));
const index = JSON.parse(await readFile(resolve(arg("--index")), "utf8"));
const output = resolve(arg("--output"));
const repo = resolve(fileURLToPath(new URL("../", import.meta.url)));
if (output === repo || output.startsWith(`${repo}/`)) throw new Error("Prepare private photo files outside the website checkout");
const limit = arg("--limit") === null ? selection.included.length : Number(arg("--limit"));
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid preparation limit");
if (selection.schema_version !== 1 || !Array.isArray(selection.included)) throw new Error("Unsupported selection manifest");
const identities = new Set(selection.included.map((r) => `${r.post}:${r.slide}`));
if (identities.size !== selection.included.length) throw new Error("Duplicate selected photos");
const rows = new Map(index.map((r) => [`${r.post}:${r.slide}`, r]));
const positions = new Map(index.map((r, position) => [`${r.post}:${r.slide}`, position]));
const excluded = new Set(selection.excluded.map((r) => `${r.post}:${r.slide}`));
const tasks = selection.included.slice(0, limit).map((selected) => {
  const identity = `${selected.post}:${selected.slide}`;
  const row = rows.get(identity);
  if (excluded.has(identity) || !row || row.status !== "matched" || row.media_type !== "photo" || row.largest_original_pixels < 4_000_000) throw new Error(`Ineligible selection: ${selected.id}`);
  if (selected.id !== `${selected.post}-${String(selected.slide).padStart(2, "0")}`) throw new Error("Inconsistent selected identifier");
  const files = row.files.filter((f) => f.resource_role === "primary");
  const source = files.find((f) => f.kind === "edited") ?? files.find((f) => f.kind === "original");
  if (!source) throw new Error(`Missing source: ${selected.id}`);
  return { selected, row, source, position: positions.get(identity) };
});
// Each post's time, with its own offset, from the index: one published_at per post (spec 7.1)
const posts = [];
for (const { selected } of tasks) {
  if (posts.some((post) => post.collection === selected.post)) continue;
  const times = new Set(index.filter((r) => r.post === selected.post).map((r) => r.published_at));
  const [publishedAt] = times;
  if (times.size !== 1 || typeof publishedAt !== "string" || !PUBLISHED_AT.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error(`Missing or inconsistent published_at for post ${selected.post}`);
  }
  posts.push({ collection: selected.post, publishedAt, place: null });
}
await mkdir(join(output, "metadata"), { recursive: true });
await mkdir(join(output, ".work"), { recursive: true });
let renderer;
if (tasks.some(({ source }) => [".arw", ".dng", ".heic"].includes(extname(source.path).toLowerCase()))) {
  if (process.platform !== "darwin") throw new Error("RAW/HEIC preparation requires macOS's native renderer");
  renderer = join(output, ".work/photo-render");
  execFileSync("xcrun", ["swiftc", fileURLToPath(new URL("./photo-render.swift", import.meta.url)), "-o", renderer], { stdio: "inherit" });
}
sharp.concurrency(1);
const hash = (data) => createHash("sha256").update(data).digest("hex");

/** Encodes previews of a master at these sizes (each fitted inside its square) and writes them beside it */
async function encodePreviews(data, id, sha256, sizes) {
  const previews = [];
  for (const size of sizes) {
    for (const format of PREVIEW_FORMATS) {
      const resized = sharp(data).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
      const encoded = format === "webp" ? resized.webp({ quality: 82, effort: 4 }) : resized.avif({ quality: 55, effort: 3 });
      const result = await encoded.toBuffer({ resolveWithObject: true });
      const key = `photos/previews/${id}/${sha256}/${size}.${format}`;
      const path = join(output, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, result.data, { mode: 0o600 });
      previews.push({ key, file: key, width: result.info.width, height: result.info.height, format, bytes: result.data.length, sha256: hash(result.data) });
    }
  }
  return previews;
}

/** Writes JSON beside its final name, then renames, so an interrupted run never leaves half a file; private (0600) */
async function writePrivateJson(path, value) {
  await writeFile(`${path}.partial`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(`${path}.partial`, path);
}

const results = new Array(tasks.length);
let cursor = 0;
async function prepare(task) {
  const { selected, source, position } = task;
  const sourceBytes = await readFile(source.path);
  const fingerprint = hash(Buffer.concat([sourceBytes, Buffer.from(`gallery-v1:${source.kind}:${source.display_width}:${source.display_height}`)]));
  const checkpoint = join(output, "metadata", `${selected.id}.json`);
  try {
    const cached = JSON.parse(await readFile(checkpoint, "utf8"));
    if (cached.fingerprint === fingerprint && (await stat(join(output, cached.print.file))).size === cached.print.bytes) {
      for (const preview of cached.previews) await stat(join(output, preview.file));
      if (!cached.previews.some((preview) => preview.key.endsWith("/240.webp"))) {
        // A checkpoint from before the gallery has no 240s: derive them from the master already on disk, so the master,
        // its SHA-256 and its publication state stay as they are (spec 2.2)
        const master = await readFile(join(output, cached.print.file));
        if (hash(master) !== cached.print.sha256) throw new Error(`Prepared master changed on disk: ${selected.id}`);
        cached.previews = [...(await encodePreviews(master, selected.id, cached.print.sha256, [240])), ...cached.previews];
        await writePrivateJson(checkpoint, cached);
      }
      return { ...cached, position };
    }
  } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  let input = source.path;
  if ([".arw", ".dng", ".heic"].includes(extname(input).toLowerCase())) {
    input = join(output, ".work", `${selected.id}.jpg`);
    execFileSync(renderer, [source.path, input], { stdio: "pipe" });
  }
  const { data, info } = await sharp(input).rotate().withIccProfile("srgb").jpeg({ quality: 96, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
  if (info.width !== source.display_width || info.height !== source.display_height) throw new Error(`Rendered dimensions differ from the source: ${selected.id} (${info.width}x${info.height})`);
  const sha256 = hash(data);
  const printKey = `prints/${selected.id}/${sha256}.jpg`;
  const printPath = join(output, printKey);
  await mkdir(dirname(printPath), { recursive: true });
  await writeFile(printPath, data, { mode: 0o600 });
  const previews = await encodePreviews(data, selected.id, sha256, PREVIEW_SIZES);
  const original = originalOf(task.row);
  const record = {
    id: selected.id, collection: selected.post, position, title: "", published: false,
    fingerprint, sourceKind: source.kind, sourceFormat: extname(source.path).toLowerCase(),
    needsRawReview: source.kind !== "edited" && [".arw", ".dng"].includes(extname(original.path).toLowerCase()),
    print: { key: printKey, file: printKey, width: info.width, height: info.height, bytes: data.length, sha256 }, previews,
  };
  await writePrivateJson(checkpoint, record);
  return record;
}
async function worker() {
  while (cursor < tasks.length) {
    const i = cursor++;
    results[i] = await prepare(tasks[i]);
    console.log(`${i + 1}/${tasks.length} ${results[i].id}`);
  }
}
await Promise.all([worker(), worker()]);

// Places (spec 7.2, ADR-0022). Each post's place comes from the originals (which keep their GPS) of at most three of its
// photos, asked 1.5 seconds apart to stay inside Apple's rate limit. Every answer is cached as names only, so a
// photo's coordinates are sent to Apple once; they never reach the manifest, D1 or R2.
function originalOf(row) {
  return row.files.find((f) => f.kind === "original" && f.resource_role === "primary");
}
async function placeTool() {
  // Tests stand a recorded geocoder in here; George's Mac never sets it
  if (process.env.PHOTO_PLACE_TOOL) return resolve(process.env.PHOTO_PLACE_TOOL);
  if (process.platform !== "darwin") throw new Error("Places need macOS's geocoder (scripts/photo-place.swift)");
  const tool = join(output, ".work/photo-place");
  execFileSync("xcrun", ["swiftc", fileURLToPath(new URL("./photo-place.swift", import.meta.url)), "-o", tool], { stdio: "inherit" });
  return tool;
}
const tool = await placeTool();
const delay = Number(process.env.PHOTO_PLACE_DELAY_MS ?? 1500);
const cities = JSON.parse(await readFile(fileURLToPath(new URL("./photo-cities.json", import.meta.url)), "utf8"));
const placesPath = join(output, "metadata", "places.json");
let places = {};
try { places = JSON.parse(await readFile(placesPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const missing = new Map();
const review = [];
let asked = false;
for (const post of posts) {
  const slides = tasks.filter((task) => task.selected.post === post.collection).sort((a, b) => a.selected.slide - b.selected.slide);
  const withGps = [];
  for (const task of slides) {
    const original = originalOf(task.row);
    if (original && (await run(tool, ["--has-gps", original.path])).stdout.trim() === "true") withGps.push({ id: task.selected.id, path: original.path });
  }
  const found = [];
  for (const photo of pickGeocoded(withGps)) {
    if (!Object.hasOwn(places, photo.id)) {
      if (asked) await new Promise((done) => setTimeout(done, delay));
      asked = true;
      try {
        places[photo.id] = JSON.parse((await run(tool, [photo.path])).stdout);
      } catch {
        // Apple's rate limit or the network: every finished lookup is already saved, so a rerun carries on from here
        console.error(`Geocoding failed for ${photo.id}; run photos:prepare again (finished lookups are kept)`);
        process.exit(1);
      }
      // Saved after every lookup, so an interrupted run never asks again
      await writePrivateJson(placesPath, places);
    }
    const result = placeFromPlacemark(places[photo.id], cities);
    if (result.missingKey) missing.set(result.missingKey, post.collection);
    if (result.review) review.push(`${post.collection}: ${result.review}`);
    found.push(result.place);
  }
  post.place = postPlace(found);
}
if (missing.size > 0) {
  console.error("Add a city for each of these to scripts/photo-cities.json, then run photos:prepare again (nothing is asked twice):");
  for (const [key, collection] of missing) console.error(`  "${key}"  (post ${collection})`);
  process.exit(1);
}
for (const line of review) console.log(`no place for ${line}: set it in /admin`);
for (const post of posts) console.log(`${post.publishedAt.slice(0, 10)} ${post.collection} ${post.place ?? "(no place)"}`);

const manifest = { schemaVersion: 1, preparedAt: new Date().toISOString(), posts, photos: results, exclusions: selection.counts };
await writePrivateJson(join(output, "manifest.json"), manifest);
console.log(`Prepared ${results.length} photos in ${posts.length} posts as unpublished candidates. ${results.filter((r) => r.needsRawReview).length} need RAW colour/crop review.`);
```

Replace `tests/unit/photo-workspace.ts` with:

```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const PREPARE = fileURLToPath(new URL("../../scripts/prepare-photos.mjs", import.meta.url));

// A recorded geocoder: a file named in FAKE_PLACES has GPS and answers its placemark (or null); any other has none.
// Each lookup (never a GPS check) is logged to FAKE_LOG, so a test can count what would have gone to Apple.
const FAKE_TOOL = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
const places = JSON.parse(readFileSync(process.env.FAKE_PLACES, "utf8"));
const args = process.argv.slice(2);
const name = basename(args.at(-1));
const known = Object.hasOwn(places, name);
if (args[0] === "--has-gps") console.log(known ? "true" : "false");
else {
  appendFileSync(process.env.FAKE_LOG, name + "\\n");
  console.log(JSON.stringify(known ? places[name] : null));
}
`;

export interface FixtureSlide {
  slide: number;
  width: number;
  height: number;
}
export interface FixturePost {
  post: string;
  publishedAt: string;
  slides: FixtureSlide[];
}

/**
 * A private folder outside the checkout, laid out as photos:prepare reads George's: small edited JPEGs and their
 * originals, an index, a selection and a recorded geocoder. Synthetic only: no test reads the real library, asks Apple
 * or touches prepared assets.
 */
export async function photoWorkspace(posts: FixturePost[]) {
  const dir = await mkdtemp(join(tmpdir(), "photo-prepare-"));
  const sources = join(dir, "sources");
  await mkdir(sources);
  const index = [];
  const included = [];
  for (const { post, publishedAt, slides } of posts) {
    for (const { slide, width, height } of slides) {
      const id = `${post}-${String(slide).padStart(2, "0")}`;
      const edited = join(sources, `${id}-edited.jpg`);
      const original = join(sources, `${id}-original.jpg`);
      for (const path of [edited, original]) await sharp({ create: { width, height, channels: 3, background: "#4a6b5e" } }).jpeg().toFile(path);
      index.push({
        post, slide, published_at: publishedAt, status: "matched", media_type: "photo", largest_original_pixels: 24_000_000,
        files: [
          { path: edited, kind: "edited", resource_role: "primary", display_width: width, display_height: height },
          { path: original, kind: "original", resource_role: "primary", display_width: width, display_height: height },
        ],
      });
      included.push({ id, post, slide });
    }
  }
  await writeFile(join(dir, "index.json"), JSON.stringify(index));
  await writeFile(join(dir, "selection.json"), JSON.stringify({ schema_version: 1, included, excluded: [], counts: {} }));
  const tool = join(dir, "fake-place.mjs");
  await writeFile(tool, FAKE_TOOL, { mode: 0o755 });
  const log = join(dir, "geocoded.log");
  await writeFile(log, "");
  const output = join(dir, "assets");
  return {
    dir,
    output,
    /** Runs photos:prepare with the recorded geocoder answering `places` (file name to placemark) */
    async prepare(places: Record<string, object | null> = {}) {
      const answers = join(dir, "places.json");
      await writeFile(answers, JSON.stringify(places));
      return run(process.execPath, [PREPARE, "--selection", join(dir, "selection.json"), "--index", join(dir, "index.json"), "--output", output], {
        env: { ...process.env, PHOTO_PLACE_TOOL: tool, PHOTO_PLACE_DELAY_MS: "0", FAKE_PLACES: answers, FAKE_LOG: log },
      });
    },
    /** The file names the geocoder was asked about, in order */
    async geocoded() {
      return (await readFile(log, "utf8")).split("\n").filter(Boolean);
    },
  };
}
```

Run: `bun run test:unit tests/unit/photo-places.test.ts tests/unit/prepare-photos.test.ts tests/unit/photo-manifest.test.ts`
Expected: PASS, the 240 tests of Task 2 among them.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/photos/place.ts scripts/photo-places.mjs scripts/photo-place.swift scripts/photo-cities.json scripts/photo-manifest.mjs scripts/prepare-photos.mjs tests/unit/photo-places.test.ts tests/unit/photo-workspace.ts tests/unit/prepare-photos.test.ts
git commit -m "feat: photos:prepare writes each post's date and area-and-city place"
```

---

### Task 4: the import writes posts, keeps titles and flags RAW review

`photos:import` first upserts `photo_posts` for every post in the manifest (its time and date always, its place only where George hasn't edited it), then imports photographs as now, with two more changes: a re-import never overwrites a title, and `raw_review` comes from `needsRawReview` (spec 7.3 and 2.2). Its database writes move to `scripts/photo-import-db.mjs`, which the unit tests run over the real migrations on `node:sqlite`; one integration test runs prepare and the real import into a temporary local store. The prepared manifest becomes `schemaVersion: 2`.

**Files:**
- Create: `scripts/photo-import-db.mjs`, `tests/unit/photo-import-db.test.ts`, `tests/unit/photo-import-run.test.ts`
- Modify: `scripts/import-photos.mjs` (whole file below), `scripts/photo-manifest.mjs`, `scripts/prepare-photos.mjs`
- Test: `tests/unit/photo-import-db.test.ts`, `tests/unit/photo-import-run.test.ts`, `tests/unit/photo-manifest.test.ts`

**Interfaces:**
- Consumes: `checkPhotoRecord`, `COLLECTION`, `PUBLISHED_AT` from `scripts/photo-manifest.mjs` (Tasks 2 and 3); `checkPlace` from `src/lib/photos/place.ts` (Task 3); `photoWorkspace` (Task 3).
- Produces:
  - `scripts/photo-import-db.mjs`: `postRow(post): [collection, publishedAtSeconds, publishedOn, place]`; `upsertPosts(db, posts): Promise<void>`; `upsertPhoto(db, photo): Promise<void>`
  - `scripts/photo-manifest.mjs`: `checkPosts(manifest): void`; `checkPhotoRecord` also requires a boolean `needsRawReview`
  - The manifest's `schemaVersion: 2`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/photo-import-db.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { postRow, upsertPhoto, upsertPosts } from "../../scripts/photo-import-db.mjs";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "f6".repeat(32);
const OTHER_SHA = "a7".repeat(32);
let db: D1Database;

const photo = (over: Record<string, unknown> = {}) => ({
  id: "postA-01", collection: "postA", position: 0, title: "", needsRawReview: false,
  print: { key: `prints/postA-01/${SHA}.jpg`, width: 4000, height: 6000, bytes: 1234, sha256: SHA },
  previews: [{ key: `photos/previews/postA-01/${SHA}/240.webp`, file: "x", width: 160, height: 240, format: "webp", bytes: 9, sha256: SHA }],
  ...over,
});
const post = (over: Record<string, unknown> = {}) => ({ collection: "postA", publishedAt: "2025-02-02T20:27:48+11:00", place: "bondi beach, sydney", ...over });
const postRowOf = (collection: string) => db.prepare("SELECT * FROM photo_posts WHERE collection = ?").bind(collection).first();
const photoRowOf = (id: string) => db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();

beforeEach(() => {
  db = sqliteD1();
});

describe("posts", () => {
  test("store the time in seconds and the date in the post's own offset, never UTC's", () => {
    expect(postRow(post())).toEqual(["postA", 1738488468, "2025-02-02", "bondi beach, sydney"]);
    // Half past midnight in Sydney (still the 2nd in UTC) and an evening in Malta (+01:00)
    expect(postRow(post({ publishedAt: "2025-02-03T00:30:00+11:00" }))[2]).toBe("2025-02-03");
    expect(postRow(post({ publishedAt: "2025-02-02T23:30:00+01:00" }))[2]).toBe("2025-02-02");
  });

  test("are inserted, then updated by a re-import", async () => {
    await upsertPosts(db, [post()]);
    expect(await postRowOf("postA")).toMatchObject({ published_at: 1738488468, published_on: "2025-02-02", place: "bondi beach, sydney", place_edited: 0 });
    await upsertPosts(db, [post({ publishedAt: "2025-02-03T00:30:00+11:00", place: "bronte, sydney" })]);
    expect(await postRowOf("postA")).toMatchObject({ published_on: "2025-02-03", place: "bronte, sydney" });
  });

  test("keep a place George edited in /admin, while the time still updates", async () => {
    await upsertPosts(db, [post()]);
    await db.prepare("UPDATE photo_posts SET place = 'tamarama, sydney', place_edited = 1 WHERE collection = 'postA'").run();
    await upsertPosts(db, [post({ place: "bondi beach, sydney", publishedAt: "2025-02-02T20:30:00+11:00" })]);
    expect(await postRowOf("postA")).toMatchObject({ place: "tamarama, sydney", place_edited: 1, published_at: 1738488600 });
  });
});

describe("photographs", () => {
  beforeEach(async () => {
    await upsertPosts(db, [post()]);
  });

  test("take their title from the manifest only when first inserted", async () => {
    await upsertPhoto(db, photo({ title: "from the manifest" }));
    expect(await photoRowOf("postA-01")).toMatchObject({ title: "from the manifest", published: 0 });
    await db.prepare("UPDATE photos SET title = 'george wrote this' WHERE id = 'postA-01'").run();
    await upsertPhoto(db, photo({ title: "" }));
    expect(await photoRowOf("postA-01")).toMatchObject({ title: "george wrote this" });
  });

  test("set and update raw_review from needsRawReview", async () => {
    await upsertPhoto(db, photo({ needsRawReview: true }));
    expect(await photoRowOf("postA-01")).toMatchObject({ raw_review: 1 });
    await upsertPhoto(db, photo({ needsRawReview: false }));
    expect(await photoRowOf("postA-01")).toMatchObject({ raw_review: 0 });
  });

  test("keep their publication for the same master, and lose it for a changed one", async () => {
    await upsertPhoto(db, photo());
    await db.prepare("UPDATE photos SET published = 1 WHERE id = 'postA-01'").run();
    await upsertPhoto(db, photo());
    expect(await photoRowOf("postA-01")).toMatchObject({ published: 1 });
    await upsertPhoto(db, photo({ print: { key: `prints/postA-01/${OTHER_SHA}.jpg`, width: 4000, height: 6000, bytes: 1300, sha256: OTHER_SHA } }));
    expect(await photoRowOf("postA-01")).toMatchObject({ published: 0, print_sha256: OTHER_SHA });
  });

  test("store only each preview's key, size and format", async () => {
    await upsertPhoto(db, photo());
    expect(JSON.parse((await photoRowOf("postA-01"))!.previews as string)).toEqual([{ key: `photos/previews/postA-01/${SHA}/240.webp`, width: 160, height: 240, format: "webp" }]);
  });
});
```

Add to `tests/unit/photo-manifest.test.ts` (change its import to `import { checkPhotoRecord, checkPosts, PREVIEW_FORMATS, PREVIEW_SIZES } from "../../scripts/photo-manifest.mjs";` and add `needsRawReview: false,` to `record()`'s object after `position: 0,`):

```ts
describe("checkPosts", () => {
  const manifest = (posts: unknown[], photos = [record()]) => ({ posts, photos });
  const post = (over: Record<string, unknown> = {}) => ({ collection: "post", publishedAt: "2025-02-02T20:27:48+11:00", place: "bondi beach, sydney", ...over });

  test("accepts one post per collection, with its time, offset and place", () => {
    expect(() => checkPosts(manifest([post()]))).not.toThrow();
    expect(() => checkPosts(manifest([post({ place: null })]))).not.toThrow();
  });

  test("refuses a manifest from before posts, so it's prepared again", () => {
    expect(() => checkPosts({ photos: [record()] })).toThrow("Prepared manifest has no posts: run photos:prepare again");
  });

  test("refuses a photograph without its post, and a post without photographs", () => {
    expect(() => checkPosts(manifest([post({ collection: "other" })]))).toThrow("Photo without a post: post-01");
    expect(() => checkPosts(manifest([post(), post({ collection: "empty", publishedAt: "2025-02-03T20:27:48+11:00" })]))).toThrow("Post without photos: empty");
  });

  test("refuses a time without an offset, two posts in the same second and a place that breaks the rule", () => {
    expect(() => checkPosts(manifest([post({ publishedAt: "2025-02-02 20:27" })]))).toThrow("Invalid post time: post");
    const second = { ...record(), id: "other-01", collection: "other", print: { key: `prints/other-01/${SHA}.jpg`, sha256: SHA } };
    expect(() => checkPosts(manifest([post(), post({ collection: "other", publishedAt: "2025-02-02T09:27:48Z" })], [record(), second]))).toThrow("Two posts share a time: other");
    expect(() => checkPosts(manifest([post({ place: "Bondi Beach, Sydney" })]))).toThrow("Invalid place: post");
    expect(() => checkPosts(manifest([post({ place: "東京" })]))).toThrow("Invalid place: post");
  });

  test("checkPhotoRecord wants needsRawReview as a boolean", () => {
    expect(() => checkPhotoRecord(record({ needsRawReview: "no" }))).toThrow("Invalid catalogue record: post-01");
  });
});
```

Create `tests/unit/photo-import-run.test.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { photoWorkspace } from "./photo-workspace";

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const WRANGLER = join(REPO, "node_modules/.bin/wrangler");
const IMPORT = join(REPO, "scripts/import-photos.mjs");
const BONDI = { subLocality: null, locality: "Bondi Beach", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
let folders: string[] = [];
afterEach(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
  folders = [];
});

/** SQL against the temporary local store, through wrangler as the e2e fixtures do */
async function query(store: string, sql: string) {
  const { stdout } = await run(WRANGLER, ["d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", store, "--json", "--command", sql], { cwd: REPO });
  return (JSON.parse(stdout) as { results: Record<string, unknown>[] }[])[0].results;
}

// The real import, end to end, into a temporary local store (never .wrangler/state, never --remote)
test("photos:import writes posts before photographs, and a re-import keeps an edited title and place", { timeout: 180_000 }, async () => {
  const workspace = await photoWorkspace([{ post: "postA", publishedAt: "2025-02-03T00:30:00+11:00", slides: [{ slide: 1, width: 300, height: 450 }] }]);
  const store = await mkdtemp(join(tmpdir(), "photo-import-store-"));
  folders.push(workspace.dir, store);
  await workspace.prepare({ "postA-01-original.jpg": BONDI });
  await run(WRANGLER, ["d1", "migrations", "apply", "curiousgeorge-logbook", "--local", "--persist-to", store], { cwd: REPO });
  const importArgs = [IMPORT, "--manifest", join(workspace.output, "manifest.json"), "--selection", join(workspace.dir, "selection.json"), "--local", "--persist-to", store];
  await run(process.execPath, importArgs, { cwd: REPO });
  expect(await query(store, "SELECT collection, published_at, published_on, place FROM photo_posts")).toEqual([
    { collection: "postA", published_at: 1738503000, published_on: "2025-02-03", place: "bondi beach, sydney" },
  ]);
  expect(await query(store, "SELECT id, title, published, raw_review FROM photos")).toEqual([{ id: "postA-01", title: "", published: 0, raw_review: 0 }]);
  await query(store, "UPDATE photos SET title = 'the first swim' WHERE id = 'postA-01'; UPDATE photo_posts SET place = 'tamarama, sydney', place_edited = 1");
  await run(process.execPath, importArgs, { cwd: REPO });
  expect(await query(store, "SELECT title FROM photos")).toEqual([{ title: "the first swim" }]);
  expect(await query(store, "SELECT place FROM photo_posts")).toEqual([{ place: "tamarama, sydney" }]);
});
```

In `tests/unit/prepare-photos.test.ts`, in `"writes each post's time and most common place, asking about each photo once"`, add after the `manifest` line:

```ts
    expect(manifest.schemaVersion).toBe(2);
```

Run: `bun run test:unit tests/unit/photo-import-db.test.ts tests/unit/photo-manifest.test.ts tests/unit/photo-import-run.test.ts tests/unit/prepare-photos.test.ts`
Expected: FAIL: `scripts/photo-import-db.mjs` and `checkPosts` don't exist, the manifest is version 1 and the import writes no posts.

- [ ] **Step 2: The import's database writes**

Create `scripts/photo-import-db.mjs`:

```js
// The import's writes to D1 (spec 7.3): posts first, because every public query joins a photograph to its post (spec 8).

// The time and date always; the place only until George edits it in /admin (place_edited)
const POST_UPSERT = `INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)
  ON CONFLICT(collection) DO UPDATE SET published_at = excluded.published_at, published_on = excluded.published_on,
  place = CASE WHEN photo_posts.place_edited = 1 THEN photo_posts.place ELSE excluded.place END`;

// A title comes from the manifest only when the row is first inserted, then only from /admin (spec 2.2). A changed master
// is unpublished; an unchanged one keeps its publication.
const PHOTO_UPSERT = `INSERT INTO photos (id, collection, position, title, raw_review, previews, print_key, print_width, print_height, print_bytes, print_sha256)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET collection = excluded.collection, position = excluded.position, raw_review = excluded.raw_review,
  previews = excluded.previews, print_key = excluded.print_key, print_width = excluded.print_width, print_height = excluded.print_height,
  print_bytes = excluded.print_bytes, print_sha256 = excluded.print_sha256,
  published = CASE WHEN photos.print_sha256 = excluded.print_sha256 THEN photos.published ELSE 0 END`;

/** A post's row: seconds since 1970, and the date part of its own time, which is the day in the post's offset (spec 7.1) */
export const postRow = (post) => [post.collection, Math.floor(Date.parse(post.publishedAt) / 1000), post.publishedAt.slice(0, 10), post.place];

export async function upsertPosts(db, posts) {
  if (posts.length === 0) return;
  await db.batch(posts.map((post) => db.prepare(POST_UPSERT).bind(...postRow(post))));
}

export async function upsertPhoto(db, photo) {
  const previews = photo.previews.map(({ key, width, height, format }) => ({ key, width, height, format }));
  await db.prepare(PHOTO_UPSERT)
    .bind(photo.id, photo.collection, photo.position, photo.title, photo.needsRawReview ? 1 : 0, JSON.stringify(previews), photo.print.key, photo.print.width, photo.print.height, photo.print.bytes, photo.print.sha256)
    .run();
}
```

In `scripts/photo-manifest.mjs`, add at the top:

```js
import { checkPlace } from "../src/lib/photos/place.ts";
```

in `checkPhotoRecord`, change the first condition's start from `if (typeof photo.id !== "string"` to `if (typeof photo.needsRawReview !== "boolean" || typeof photo.id !== "string"`, and add at the end of the file:

```js
/** Throws unless the manifest's posts are well formed and match its photographs one for one (spec 7.1) */
export function checkPosts(manifest) {
  if (!Array.isArray(manifest.posts)) throw new Error("Prepared manifest has no posts: run photos:prepare again");
  const collections = new Set();
  const seconds = new Set();
  for (const post of manifest.posts) {
    if (typeof post.collection !== "string" || !COLLECTION.test(post.collection) || collections.has(post.collection)) throw new Error(`Invalid or duplicate post: ${post.collection}`);
    collections.add(post.collection);
    if (typeof post.publishedAt !== "string" || !PUBLISHED_AT.test(post.publishedAt) || !Number.isFinite(Date.parse(post.publishedAt))) throw new Error(`Invalid post time: ${post.collection}`);
    // published_at is unique in D1: two posts in one second would fail the import half way
    const second = Math.floor(Date.parse(post.publishedAt) / 1000);
    if (seconds.has(second)) throw new Error(`Two posts share a time: ${post.collection}`);
    seconds.add(second);
    if (post.place !== null) {
      const checked = typeof post.place === "string" ? checkPlace(post.place) : null;
      if (!checked?.ok || checked.place !== post.place) throw new Error(`Invalid place: ${post.collection}`);
    }
  }
  for (const photo of manifest.photos) if (!collections.has(photo.collection)) throw new Error(`Photo without a post: ${photo.id}`);
  for (const collection of collections) if (!manifest.photos.some((photo) => photo.collection === collection)) throw new Error(`Post without photos: ${collection}`);
}
```

In `scripts/prepare-photos.mjs`, change `schemaVersion: 1` to `schemaVersion: 2` in the manifest line.

Replace `scripts/import-photos.mjs` with:

```js
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import sharp from "sharp";
import { checkPhotoRecord, checkPosts } from "./photo-manifest.mjs";
import { upsertPhoto, upsertPosts } from "./photo-import-db.mjs";
import { photoPlatform } from "./photo-platform.mjs";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (!arg("--manifest") || !arg("--selection") || (args.includes("--local") === args.includes("--remote"))) {
  console.error("usage: bun run photos:import --manifest private-folder/manifest.json --selection gallery-selection.json --local | --remote [--persist-to .wrangler/state]");
  process.exit(1);
}
const manifestPath = resolve(arg("--manifest"));
const root = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const selection = JSON.parse(await readFile(resolve(arg("--selection")), "utf8"));
if (selection.schema_version !== 1 || !Array.isArray(selection.included)) throw new Error("Unsupported selection");
const allowed = new Set(selection.included.map((p) => p.id));
if (allowed.size !== selection.included.length) throw new Error("Duplicate photo in selection");
if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.photos)) throw new Error("Unsupported prepared manifest: run photos:prepare again");
if (manifest.photos.length !== allowed.size) throw new Error("Prepared manifest must contain the complete selected catalogue");
const ids = new Set();
const positions = new Set();
const hash = (data) => createHash("sha256").update(data).digest("hex");
for (const photo of manifest.photos) {
  checkPhotoRecord(photo);
  if (!allowed.has(photo.id) || ids.has(photo.id) || positions.has(photo.position)) throw new Error("Excluded, invalid or duplicate photo");
  ids.add(photo.id); positions.add(photo.position);
  for (const asset of [photo.print, ...photo.previews]) {
    const path = resolve(root, asset.file);
    if (!path.startsWith(root + sep) || asset.file !== asset.key) throw new Error("Asset path escapes preparation directory");
    const data = await readFile(path);
    const metadata = await sharp(data).metadata();
    if (data.length !== asset.bytes || hash(data) !== asset.sha256 || metadata.width !== asset.width || metadata.height !== asset.height) throw new Error(`Asset validation failed: ${photo.id}`);
    const expected = asset === photo.print ? "jpeg" : asset.format;
    const validFormat = expected === "avif" ? metadata.format === "heif" && metadata.compression === "av1" : metadata.format === expected;
    if (!validFormat || metadata.exif || metadata.xmp || metadata.iptc) throw new Error("Unexpected image format or private metadata");
    if (asset === photo.print && (!metadata.icc || metadata.space !== "srgb")) throw new Error("Print file has no sRGB colour profile");
  }
}
checkPosts(manifest);
// Validate the whole import before changing storage. Posts go first (every public query joins a photograph to its post),
// then each photograph's row only after its objects are present.
const platform = await photoPlatform({ remote: args.includes("--remote"), persistTo: arg("--persist-to") ?? ".wrangler/state" });
try {
  await upsertPosts(platform.env.DB, manifest.posts);
  for (const photo of manifest.photos) {
    for (const asset of [photo.print, ...photo.previews]) {
      const bucket = asset === photo.print ? platform.env.PHOTO_PRINTS : platform.env.MEDIA;
      const type = asset === photo.print ? "image/jpeg" : `image/${asset.format}`;
      const existing = await bucket.head(asset.key);
      if (existing?.size === asset.bytes && existing.customMetadata?.sha256 === asset.sha256 && existing.httpMetadata?.contentType === type) continue;
      const data = await readFile(resolve(root, asset.file));
      await bucket.put(asset.key, data, { httpMetadata: { contentType: type }, customMetadata: { sha256: asset.sha256 }, sha256: Uint8Array.from(Buffer.from(asset.sha256, "hex")) });
      const stored = await bucket.head(asset.key);
      if (stored?.size !== asset.bytes || stored.httpMetadata?.contentType !== type) throw new Error("Upload validation failed");
    }
    await upsertPhoto(platform.env.DB, photo);
    console.log(`Imported ${photo.id} (${args.includes("--remote") ? "remote" : "local"})`);
  }
} finally { await platform.dispose(); }
console.log(`Imported ${manifest.posts.length} posts and ${manifest.photos.length} photos. New or changed masters remain unpublished; titles and edited places were kept.`);
```

Run: `bun run test:unit tests/unit/photo-import-db.test.ts tests/unit/photo-manifest.test.ts tests/unit/photo-import-run.test.ts tests/unit/prepare-photos.test.ts`
Expected: PASS (the import run takes about half a minute: it applies the migrations and imports twice).

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

- [ ] **Step 3: Commit**

```bash
git add scripts/photo-import-db.mjs scripts/photo-manifest.mjs scripts/prepare-photos.mjs scripts/import-photos.mjs tests/unit/photo-import-db.test.ts tests/unit/photo-import-run.test.ts tests/unit/photo-manifest.test.ts tests/unit/prepare-photos.test.ts
git commit -m "feat: photos:import writes posts first, flags RAW review and keeps titles and edited places"
```

---
### Task 5: shared publication and the generalised purge

Publication moves from `src/pages/admin/photos/[id].ts` into `src/lib/photos/publish.ts` (spec 2.2): `setPublished(deps, ids, published)` verifies every photograph first (its private JPEG and eight previews) and changes all of them or none. Its R2 `head` calls (up to 180 for a 20-photo post) run ten at a time. A publication change purges `photos` and `logbook`, through the admin's purge, which now takes tags.

**Files:**
- Create: `src/lib/photos/publish.ts`, `tests/unit/photo-publish.test.ts`
- Modify: `src/pages/admin/photos/[id].ts`, `src/lib/admin/purge.ts`, `src/lib/admin/submit.ts`
- Test: `tests/unit/photo-publish.test.ts`, `tests/unit/purge.test.ts`, `tests/e2e/photos.spec.ts` (unchanged, must still pass)

**Interfaces:**
- Consumes: `PhotoRow`, `Preview`, `PREVIEW_COUNT` from `src/lib/photos/store.ts` (Tasks 1 and 2).
- Produces:
  - `src/lib/photos/publish.ts`: `interface PublishDeps { db: D1Database; prints: R2Bucket; media: R2Bucket }`; `type PublishOutcome = { ok: true } | { ok: false; missing: string[] } | { ok: false; unverified: string[] }`; `VERIFY_CONCURRENCY = 10`; `setPublished(deps: PublishDeps, ids: string[], published: boolean): Promise<PublishOutcome>` (no purge; callers purge)
  - `src/lib/admin/purge.ts`: `purgeTags(cache: { invalidate(options: { tags: string[] }): Promise<unknown> }, tags: string[]): Promise<boolean>` (replaces `purgeLogbook`)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/photo-publish.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { setPublished, VERIFY_CONCURRENCY } from "../../src/lib/photos/publish";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "b8".repeat(32);
let db: D1Database;
let prints: Map<string, { size: number; contentType: string; sha256: string }>;
let media: Map<string, string>;
let inFlight = 0;
let most = 0;

const previews = (id: string) =>
  [240, 480, 960, 1600].flatMap((size) => ["webp", "avif"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format })));

/** R2 head requests that take a moment, so the most in flight at once can be counted */
async function headed<T>(answer: () => T): Promise<T> {
  inFlight++;
  most = Math.max(most, inFlight);
  await new Promise((done) => setTimeout(done, 1));
  inFlight--;
  return answer();
}
const printBucket = { head: vi.fn((key: string) => headed(() => { const o = prints.get(key); return o ? { size: o.size, httpMetadata: { contentType: o.contentType }, customMetadata: { sha256: o.sha256 } } : null; })) };
const mediaBucket = { head: vi.fn((key: string) => headed(() => (media.has(key) ? { httpMetadata: { contentType: media.get(key) } } : null))) };
const deps = () => ({ db, prints: printBucket as unknown as R2Bucket, media: mediaBucket as unknown as R2Bucket });

async function addPhoto(id: string, position: number, published = false, list = previews(id)) {
  await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, "post", position, "", published ? 1 : 0, JSON.stringify(list), `prints/${id}/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
  prints.set(`prints/${id}/${SHA}.jpg`, { size: 1000, contentType: "image/jpeg", sha256: SHA });
  for (const preview of list) media.set(preview.key, `image/${preview.format}`);
}
const publishedOf = async (id: string) => db.prepare("SELECT published FROM photos WHERE id = ?").bind(id).first("published");

beforeEach(async () => {
  db = sqliteD1();
  prints = new Map();
  media = new Map();
  inFlight = 0;
  most = 0;
  printBucket.head.mockClear();
  mediaBucket.head.mockClear();
  await addPhoto("post-01", 0);
  await addPhoto("post-02", 1);
});

describe("setPublished", () => {
  test("publishes once the master and all eight previews check out", async () => {
    expect(await setPublished(deps(), ["post-01", "post-02"], true)).toEqual({ ok: true });
    expect(await publishedOf("post-01")).toBe(1);
    expect(await publishedOf("post-02")).toBe(1);
    expect(printBucket.head).toHaveBeenCalledTimes(2);
    expect(mediaBucket.head).toHaveBeenCalledTimes(16);
  });

  test("a master that's missing, resized, retyped or changed fails its photo", async () => {
    const key = `prints/post-01/${SHA}.jpg`;
    for (const broken of [undefined, { size: 999, contentType: "image/jpeg", sha256: SHA }, { size: 1000, contentType: "text/html", sha256: SHA }, { size: 1000, contentType: "image/jpeg", sha256: "0".repeat(64) }]) {
      if (broken) prints.set(key, broken);
      else prints.delete(key);
      expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: false, unverified: ["post-01"] });
    }
    expect(await publishedOf("post-01")).toBe(0);
  });

  test("a preview that's missing or of another type fails its photo, and six previews fail without asking R2", async () => {
    media.delete(`photos/previews/post-01/${SHA}/240.avif`);
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: false, unverified: ["post-01"] });
    media.set(`photos/previews/post-01/${SHA}/240.avif`, "image/webp");
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: false, unverified: ["post-01"] });
    await addPhoto("post-03", 2, false, previews("post-03").filter((p) => !p.key.includes("/240.")));
    printBucket.head.mockClear();
    expect(await setPublished(deps(), ["post-03"], true)).toEqual({ ok: false, unverified: ["post-03"] });
    expect(printBucket.head).not.toHaveBeenCalled();
  });

  test("all or nothing: one failing photo keeps the whole set as it was, and the failures are named in order", async () => {
    await addPhoto("post-03", 2);
    prints.delete(`prints/post-03/${SHA}.jpg`);
    media.delete(`photos/previews/post-01/${SHA}/1600.webp`);
    expect(await setPublished(deps(), ["post-01", "post-02", "post-03"], true)).toEqual({ ok: false, unverified: ["post-01", "post-03"] });
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(0);
  });

  test("an id that doesn't exist changes nothing", async () => {
    expect(await setPublished(deps(), ["post-01", "post-99"], true)).toEqual({ ok: false, missing: ["post-99"] });
    expect(await setPublished(deps(), [], true)).toEqual({ ok: false, missing: [] });
    expect(await publishedOf("post-01")).toBe(0);
  });

  test("hiding asks R2 nothing, and a repeat of either is fine", async () => {
    await addPhoto("post-03", 2, true);
    expect(await setPublished(deps(), ["post-03"], false)).toEqual({ ok: true });
    expect(await setPublished(deps(), ["post-03"], false)).toEqual({ ok: true });
    expect(printBucket.head).not.toHaveBeenCalled();
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: true });
    expect(await setPublished(deps(), ["post-01"], true)).toEqual({ ok: true });
    expect(await publishedOf("post-03")).toBe(0);
  });

  test("a 20-photo post's 180 checks run at most ten at a time", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `big-${String(i + 1).padStart(2, "0")}`);
    for (const [i, id] of ids.entries()) await addPhoto(id, 10 + i);
    printBucket.head.mockClear();
    mediaBucket.head.mockClear();
    expect(await setPublished(deps(), ids, true)).toEqual({ ok: true });
    expect(printBucket.head.mock.calls.length + mediaBucket.head.mock.calls.length).toBe(180);
    expect(most).toBe(VERIFY_CONCURRENCY);
  });
});
```

Replace `tests/unit/purge.test.ts` with:

```ts
import { expect, test, vi } from "vitest";
import { purgeTags } from "../../src/lib/admin/purge";

test("purges the given tags and says it did", async () => {
  const invalidate = vi.fn(async () => {});
  expect(await purgeTags({ invalidate }, ["photos", "logbook"])).toBe(true);
  expect(invalidate).toHaveBeenCalledWith({ tags: ["photos", "logbook"] });
});

test("a purge that fails is reported, not thrown (local runs have no purge)", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await purgeTags({ invalidate: async () => Promise.reject(new TypeError("cache.purge is not a function")) }, ["logbook"])).toBe(false);
  expect(error).toHaveBeenCalledWith("admin: couldn't purge the cached pages tagged logbook", "cache.purge is not a function");
  error.mockRestore();
});
```

Run: `bun run test:unit tests/unit/photo-publish.test.ts tests/unit/purge.test.ts`
Expected: FAIL: `src/lib/photos/publish.ts` doesn't exist and `purgeTags` isn't exported.

- [ ] **Step 2: Confirm the subrequest limit**

Open Cloudflare's Workers limits page (`https://developers.cloudflare.com/workers/platform/limits/`, "Subrequests") and confirm two things: Workers Paid allows at least 1,000 subrequests per request, and calls to an R2 binding count towards that limit. A 20-photo post needs 180 R2 `head` calls (one master and eight previews each), plus a handful of D1 calls. If the page gives a different paid figure, use it in the comment on `VERIFY_CONCURRENCY` below; if it were ever under 200, stop and report it, because the all-or-nothing publish of a full post depends on it.

- [ ] **Step 3: setPublished**

Create `src/lib/photos/publish.ts`:

```ts
import { PREVIEW_COUNT, type PhotoRow, type Preview } from "./store";

export interface PublishDeps {
  db: D1Database;
  /** PHOTO_PRINTS: the private masters */
  prints: R2Bucket;
  /** MEDIA: the public previews */
  media: R2Bucket;
}

export type PublishOutcome = { ok: true } | { ok: false; missing: string[] } | { ok: false; unverified: string[] };

/**
 * R2 head requests in flight at once. A 20-photo post needs 180 (one master and eight previews each), well within
 * Workers Paid's limit of at least 1,000 subrequests per request (Cloudflare's limits page; R2 binding calls count).
 */
export const VERIFY_CONCURRENCY = 10;

const MASTER_KEY = /^prints\/[A-Za-z0-9_-]+\/[a-f0-9]{64}\.jpg$/;

async function masterChecks(prints: R2Bucket, row: PhotoRow): Promise<boolean> {
  if (!MASTER_KEY.test(row.print_key)) return false;
  const object = await prints.head(row.print_key);
  return !!object && object.size === row.print_bytes && object.httpMetadata?.contentType === "image/jpeg" && object.customMetadata?.sha256 === row.print_sha256;
}

async function previewChecks(media: R2Bucket, preview: Preview): Promise<boolean> {
  const stored = await media.head(preview.key);
  return !!stored && stored.httpMetadata?.contentType === `image/${preview.format}`;
}

/** Runs every check, at most `limit` at a time, and says which passed */
async function pooled(checks: (() => Promise<boolean>)[], limit: number): Promise<boolean[]> {
  const passed = new Array<boolean>(checks.length);
  let next = 0;
  const worker = async () => {
    while (next < checks.length) {
      const i = next++;
      passed[i] = await checks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, checks.length) }, worker));
  return passed;
}

/**
 * Publishes or hides photographs, all of them or none (spec 2.2 and 6.2). Publishing verifies each first: its private JPEG
 * (size, type and SHA-256) and its eight previews. Hiding asks R2 nothing. A repeat is fine (ADR-0012). It doesn't purge:
 * callers purge photos and logbook, since the home page's photo line depends on whether anything is published.
 */
export async function setPublished(deps: PublishDeps, ids: string[], published: boolean): Promise<PublishOutcome> {
  // One parameter however many ids: D1 caps a statement at 100 bound parameters
  const list = JSON.stringify(ids);
  const rows = (await deps.db.prepare("SELECT * FROM photos WHERE id IN (SELECT value FROM json_each(?))").bind(list).all<PhotoRow>()).results;
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (ids.length === 0 || missing.length > 0) return { ok: false, missing };
  if (published) {
    const failed = new Set<string>();
    const checks: { id: string; run: () => Promise<boolean> }[] = [];
    for (const row of rows) {
      const previews = JSON.parse(row.previews) as Preview[];
      if (previews.length !== PREVIEW_COUNT || previews.some((preview) => !preview.key.startsWith("photos/previews/") || !["avif", "webp"].includes(preview.format))) {
        failed.add(row.id);
        continue;
      }
      checks.push({ id: row.id, run: () => masterChecks(deps.prints, row) });
      for (const preview of previews) checks.push({ id: row.id, run: () => previewChecks(deps.media, preview) });
    }
    const passed = await pooled(checks.map((check) => check.run), VERIFY_CONCURRENCY);
    checks.forEach((check, i) => { if (!passed[i]) failed.add(check.id); });
    if (failed.size > 0) return { ok: false, unverified: ids.filter((id) => failed.has(id)) };
  }
  await deps.db.prepare("UPDATE photos SET published = ? WHERE id IN (SELECT value FROM json_each(?))").bind(published ? 1 : 0, list).run();
  return { ok: true };
}
```

Replace `src/lib/admin/purge.ts` with:

```ts
/**
 * Purges cached pages by tag, so a save shows on the next visit everywhere (spec 6.1): logbook for the home page, photos
 * for the gallery. False when it can't: local runs have no purge, and in production the old page can keep showing for a
 * while (the edge serves it stale as it refreshes).
 */
export async function purgeTags(cache: { invalidate(options: { tags: string[] }): Promise<unknown> }, tags: string[]): Promise<boolean> {
  try {
    await cache.invalidate({ tags });
    return true;
  } catch (error) {
    // One line: local runs fail this way on every save, and a stack would bury the rest of the log
    console.error(`admin: couldn't purge the cached pages tagged ${tags.join(" and ")}`, error instanceof Error ? error.message : String(error));
    return false;
  }
}
```

In `src/lib/admin/submit.ts`, change `import { purgeLogbook } from "./purge";` to `import { purgeTags } from "./purge";` and `const purged = await purgeLogbook(cache);` to `const purged = await purgeTags(cache, ["logbook"]);`.

Replace `src/pages/admin/photos/[id].ts` with:

```ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { purgeTags } from "../../../lib/admin/purge";
import { photoError, photoJson, readPhotoJson } from "../../../lib/photos/http";
import { setPublished } from "../../../lib/photos/publish";
import { PHOTO_ID } from "../../../lib/photos/tokens";

export const PATCH: APIRoute = async ({ params, request, cache }) => {
  const id = params.id ?? "";
  if (!PHOTO_ID.test(id)) return photoError("Photo unavailable.", 404);
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;
  if (!body || typeof body !== "object" || !("published" in body) || typeof body.published !== "boolean") return photoError("Supply a boolean published value.", 400);
  try {
    const outcome = await setPublished({ db: env.DB, prints: env.PHOTO_PRINTS, media: env.MEDIA }, [id], body.published);
    if ("missing" in outcome) return photoError("Photo unavailable.", 404);
    if ("unverified" in outcome) return photoError("Verified print master and previews unavailable.", 409);
    // The home page's photo line depends on whether anything is published, so the logbook goes too (spec 2.2)
    const cacheInvalidated = await purgeTags(cache, ["photos", "logbook"]);
    return photoJson({ id, published: body.published, cacheInvalidated }, 200, true);
  } catch { console.error("photos: publication update unavailable"); return photoError("Could not update the photo.", 503); }
};
```

Run: `bun run test:unit tests/unit/photo-publish.test.ts tests/unit/purge.test.ts tests/unit/submit.test.ts && bun run typecheck`
Expected: PASS; 0 errors.

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/photos.spec.ts --project=chromium`
Expected: every test passes; the publish test hides and publishes `fixture-d-01` through `setPublished`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/photos/publish.ts src/lib/admin/purge.ts src/lib/admin/submit.ts src/pages/admin/photos/[id].ts tests/unit/photo-publish.test.ts tests/unit/purge.test.ts
git commit -m "feat: setPublished verifies and publishes photos all or nothing, ten checks at a time"
```

---

### Task 6: the admin's photographs section

`/admin` gains a `photographs` section after `snapshots` (spec 6.2): one closed `<details>` per post, newest first, whose summary reads `02.02.25 · bondi, sydney · 14 photos, 12 published` with a `raw` pill; inside, the post's place, its `publish all 14` and `hide all` buttons and each photograph's 240 preview, id, `raw` pill, title and its own publish or hide. Every save follows R7: a 303 to `/admin/?saved=photographs#photographs`, a 422 with the failed form reopened and a purge of `photos` and `logbook`.

**Files:**
- Create: `src/components/admin/PhotographsAdmin.astro`, `tests/unit/photo-actions.test.ts`, `tests/unit/photographs-admin.test.ts`, `tests/e2e/admin-photos.spec.ts`, `tests/e2e/photo-store.ts`
- Modify: `src/lib/admin/actions.ts`, `src/lib/admin/validate.ts`, `src/lib/admin/store.ts`, `src/lib/admin/submit.ts`, `src/pages/admin/index.astro`, `src/styles/admin.css`, `tests/e2e/admin.ts`, `tests/e2e/admin-layout.spec.ts`
- Test: `tests/unit/photo-actions.test.ts`, `tests/unit/photographs-admin.test.ts`, `tests/unit/store.test.ts`, `tests/unit/submit.test.ts`, `tests/e2e/admin-photos.spec.ts`, `tests/e2e/admin-layout.spec.ts`

**Interfaces:**
- Consumes: `setPublished`, `PublishDeps` from `src/lib/photos/publish.ts` and `purgeTags` (Task 5); `checkPlace` from `src/lib/photos/place.ts` (Task 3); `PHOTO_ID` from `src/lib/photos/tokens.ts`; `formatLogDate` from `src/lib/text.ts`.
- Produces:
  - `actions.ts`: `AdminSection` gains `"photographs"`; `ActionDeps` gains `prints?: R2Bucket`; intents `post.place`, `post.publish`, `post.hide`, `photo.title`, `photo.publish`, `photo.hide`
  - `validate.ts`: `PLACE_FIELDS`, `TITLE_FIELDS`, `CONTROL` (a control-character regex), `checkTitle(fields): Checked<string>`
  - `store.ts` (admin): `interface AdminPhoto { id: string; title: string; published: boolean; rawReview: boolean; thumb: { url: string; width: number; height: number } | null }`; `interface AdminPost { collection: string; date: string; place: string | null; photos: AdminPhoto[] }`; `AdminData.photographs: AdminPost[]`; `postPhotoIds(db, collection): Promise<string[] | null>`; `savePostPlace(db, collection, place): Promise<boolean>`; `savePhotoTitle(db, id, title): Promise<boolean>`
  - `submit.ts`: `PURGES: Record<AdminSection, string[]>`
  - `tests/e2e/admin.ts`: `expectSaved(page, section, where?: "logbook" | "gallery")`
  - `tests/e2e/photo-store.ts`: `adminD1<T>(sql: string): T[]` (SQL on the admin server's local store)
  - Form ids: `post-<collection>` (the post's `<details>`) and `photo-<id>` (each photograph's row)

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/photo-actions.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { sqliteD1 } from "./sqlite-d1";

const SHA = "c9".repeat(32);
let db: D1Database;
let prints: Map<string, { size: number; sha256: string }>;
let media: Set<string>;

const previews = (id: string) =>
  [240, 480, 960, 1600].flatMap((size) => ["webp", "avif"].map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: size, height: size, format })));

const deps = (): ActionDeps => ({
  db,
  images: {} as ImagesBinding,
  prints: { head: vi.fn(async (key: string) => { const o = prints.get(key); return o ? { size: o.size, httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: o.sha256 } } : null; }) } as unknown as R2Bucket,
  media: { head: vi.fn(async (key: string) => (media.has(key) ? { httpMetadata: { contentType: `image/${key.split(".").at(-1)}` } } : null)) } as unknown as R2Bucket,
});

async function addPhoto(id: string, position: number, published = false) {
  await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, "post", position, "", published ? 1 : 0, JSON.stringify(previews(id)), `prints/${id}/${SHA}.jpg`, 2048, 2048, 1000, SHA).run();
  prints.set(`prints/${id}/${SHA}.jpg`, { size: 1000, sha256: SHA });
  for (const preview of previews(id)) media.add(preview.key);
}

const submit = (entries: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return runAction(form, deps());
};
const publishedOf = async (id: string) => db.prepare("SELECT published FROM photos WHERE id = ?").bind(id).first("published");
const placeOf = async () => db.prepare("SELECT place, place_edited FROM photo_posts WHERE collection = 'post'").first();
const titleOf = async (id: string) => db.prepare("SELECT title FROM photos WHERE id = ?").bind(id).first("title");
const SAVED = { ok: true, section: "photographs" };
const PAGE = (message: string) => ({ ok: false, section: null, form: "", errors: { form: message }, values: {} });

beforeEach(async () => {
  db = sqliteD1();
  prints = new Map();
  media = new Set();
  await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES ('post', 1738488468, '2025-02-02', 'bondi beach, sydney')").run();
  for (const [i, id] of ["post-01", "post-02", "post-03"].entries()) await addPhoto(id, i);
});

describe("a post's place", () => {
  test("is saved lowercased and marked edited, so a later import keeps it", async () => {
    expect(await submit({ intent: "post.place", collection: "post", place: "  St Kilda, Melbourne " })).toEqual(SAVED);
    expect(await placeOf()).toEqual({ place: "st kilda, melbourne", place_edited: 1 });
    expect(await submit({ intent: "post.place", collection: "post", place: "o'connor, canberra" })).toEqual(SAVED);
    expect(await placeOf()).toEqual({ place: "o'connor, canberra", place_edited: 1 });
  });

  test("left empty shows no place, and is still George's edit", async () => {
    expect(await submit({ intent: "post.place", collection: "post", place: "" })).toEqual(SAVED);
    expect(await placeOf()).toEqual({ place: null, place_edited: 1 });
  });

  test("outside the place rule comes back with its form, and nothing changes", async () => {
    for (const [place, error] of [["a".repeat(61), "60 characters at most"], ["Ħamrun, malta", "plain latin letters only (accents like é are fine)"]]) {
      expect(await submit({ intent: "post.place", collection: "post", place })).toEqual({ ok: false, section: "photographs", form: "post-post", errors: { place: error }, values: { collection: "post", place } });
    }
    expect(await placeOf()).toEqual({ place: "bondi beach, sydney", place_edited: 0 });
  });

  test("for a post that isn't there is a message for the page", async () => {
    expect(await submit({ intent: "post.place", collection: "gone", place: "bondi" })).toEqual(PAGE("that post no longer exists"));
    expect(await submit({ intent: "post.place", collection: "../x", place: "bondi" })).toEqual(PAGE("that post no longer exists"));
  });
});

describe("publishing or hiding a post", () => {
  test("checks every photo, then publishes them all", async () => {
    expect(await submit({ intent: "post.publish", collection: "post" })).toEqual(SAVED);
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(1);
  });

  test("publishes nothing when any photo fails its checks, and names the ones that did", async () => {
    prints.set(`prints/post-02/${SHA}.jpg`, { size: 1000, sha256: "0".repeat(64) });
    media.delete(`photos/previews/post-03/${SHA}/240.avif`);
    expect(await submit({ intent: "post.publish", collection: "post" })).toEqual({
      ok: false, section: "photographs", form: "post-post",
      errors: { form: "2 photos couldn't be checked: post-02, post-03. publish the others one at a time." }, values: {},
    });
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(0);
  });

  test("says one photo when one fails", async () => {
    prints.delete(`prints/post-01/${SHA}.jpg`);
    expect(await submit({ intent: "post.publish", collection: "post" })).toMatchObject({ errors: { form: "1 photo couldn't be checked: post-01. publish the others one at a time." } });
  });

  test("hiding all, and hiding all again, both count as saved", async () => {
    await submit({ intent: "post.publish", collection: "post" });
    expect(await submit({ intent: "post.hide", collection: "post" })).toEqual(SAVED);
    expect(await submit({ intent: "post.hide", collection: "post" })).toEqual(SAVED);
    for (const id of ["post-01", "post-02", "post-03"]) expect(await publishedOf(id)).toBe(0);
  });

  test("for a post that isn't there is a message for the page", async () => {
    expect(await submit({ intent: "post.publish", collection: "gone" })).toEqual(PAGE("that post no longer exists"));
  });
});

describe("a photograph", () => {
  test("takes a title exactly as typed and can lose it again", async () => {
    expect(await submit({ intent: "photo.title", id: "post-01", title: '<b>dawn</b> & "co"' })).toEqual(SAVED);
    expect(await titleOf("post-01")).toBe('<b>dawn</b> & "co"');
    expect(await submit({ intent: "photo.title", id: "post-01", title: "" })).toEqual(SAVED);
    expect(await titleOf("post-01")).toBe("");
  });

  test("refuses a title over 80 characters or on two lines, with its form", async () => {
    for (const [title, error] of [["x".repeat(81), "80 characters at most"], ["dawn\nat bondi", "one line of plain text"]]) {
      expect(await submit({ intent: "photo.title", id: "post-01", title })).toEqual({ ok: false, section: "photographs", form: "photo-post-01", errors: { title: error }, values: { id: "post-01", title } });
    }
  });

  test("is published alone once its files check out, and hidden alone", async () => {
    expect(await submit({ intent: "photo.publish", id: "post-02" })).toEqual(SAVED);
    expect([await publishedOf("post-01"), await publishedOf("post-02")]).toEqual([0, 1]);
    expect(await submit({ intent: "photo.hide", id: "post-02" })).toEqual(SAVED);
    expect(await publishedOf("post-02")).toBe(0);
  });

  test("that fails its checks stays hidden, with a message on its own row", async () => {
    media.delete(`photos/previews/post-01/${SHA}/960.webp`);
    expect(await submit({ intent: "photo.publish", id: "post-01" })).toEqual({
      ok: false, section: "photographs", form: "photo-post-01",
      errors: { form: "that photo couldn't be checked, so it stays hidden. run the import for it again." }, values: {},
    });
    expect(await publishedOf("post-01")).toBe(0);
  });

  test("that isn't there is a message for the page", async () => {
    expect(await submit({ intent: "photo.title", id: "post-99", title: "x" })).toEqual(PAGE("that photo no longer exists"));
    expect(await submit({ intent: "photo.publish", id: "post-99" })).toEqual(PAGE("that photo no longer exists"));
    expect(await submit({ intent: "photo.hide", id: "not an id" })).toEqual(PAGE("that photo no longer exists"));
  });
});
```

Create `tests/unit/photographs-admin.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import PhotographsAdmin from "../../src/components/admin/PhotographsAdmin.astro";
import type { ActionFailure } from "../../src/lib/admin/actions";
import type { AdminPhoto, AdminPost } from "../../src/lib/admin/store";
import { render, text } from "./render";

const photo = (id: string, over: Partial<AdminPhoto> = {}): AdminPhoto => ({
  id, title: "", published: true, rawReview: false, thumb: { url: `/media/photos/previews/${id}/x/240.webp`, width: 160, height: 240 }, ...over,
});
const posts: AdminPost[] = [
  { collection: "newer", date: "2026-09-27", place: "bondi, sydney", photos: [photo("newer-01"), photo("newer-02", { published: false, rawReview: true }), photo("newer-03", { rawReview: true })] },
  { collection: "older", date: "2025-02-02", place: null, photos: [photo("older-01", { title: "the long jetty" })] },
];
const failure = (form: string, errors: Record<string, string>, values: Record<string, string> = {}): ActionFailure => ({ ok: false, section: "photographs", form, errors, values });

describe("PhotographsAdmin", () => {
  test("each post's summary gives its date, place, counts and how many await RAW review", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: null });
    expect([...doc.querySelectorAll("details > summary .what")].map(text)).toEqual(["27.09.26 · bondi, sydney · 3 photos, 2 published", "02.02.25 · 1 photo, 1 published"]);
    expect(text(doc.querySelector("#post-newer > summary .tagged"))).toBe("2 raw");
    expect(doc.querySelector("#post-older > summary .tagged")).toBeNull();
  });

  test("posts start closed; inside, the place, the post's buttons and each photo with its own", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: null });
    expect(doc.querySelector("#post-newer")!.hasAttribute("open")).toBe(false);
    expect(doc.querySelector<HTMLInputElement>("#post-newer-place")!.getAttribute("value")).toBe("bondi, sydney");
    expect(text(doc.querySelector("#post-newer-place-hint"))).toBe("area, city. leave it empty to show no place.");
    expect([...doc.querySelectorAll("#post-newer > .controls button")].map(text)).toEqual(["publish all 3", "hide all"]);
    const img = doc.querySelector("#photo-newer-01 img")!;
    expect([img.getAttribute("loading"), img.getAttribute("alt"), img.getAttribute("width")]).toEqual(["lazy", "", "160"]);
    expect(doc.querySelector("#photo-newer-01 button[aria-label]")!.getAttribute("aria-label")).toBe("hide newer-01");
    expect(doc.querySelector("#photo-newer-02 button[aria-label]")!.getAttribute("aria-label")).toBe("publish newer-02");
    expect(text(doc.querySelector("#photo-newer-02 .tagged"))).toBe("raw");
    expect(doc.querySelector<HTMLInputElement>("#photo-older-01-title")!.getAttribute("value")).toBe("the long jetty");
  });

  test("a failed photo form opens its post, with the message and what was typed", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: failure("photo-newer-02", { title: "80 characters at most" }, { id: "newer-02", title: "x".repeat(81) }) });
    expect(doc.querySelector("#post-newer")!.hasAttribute("open")).toBe(true);
    expect(doc.querySelector("#post-older")!.hasAttribute("open")).toBe(false);
    expect(doc.querySelector("#photo-newer-02-title")!.getAttribute("value")).toBe("x".repeat(81));
    expect(text(doc.querySelector("#photo-newer-02-title-error"))).toBe("80 characters at most");
  });

  test("a failed publish opens its post, with the message at the top", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: failure("post-older", { form: "1 photo couldn't be checked: older-01. publish the others one at a time." }) });
    expect(doc.querySelector("#post-older")!.hasAttribute("open")).toBe(true);
    expect(text(doc.querySelector('#post-older > [role="alert"]'))).toBe("1 photo couldn't be checked: older-01. publish the others one at a time.");
  });

  test("with nothing imported, it says how to import", async () => {
    const doc = await render(PhotographsAdmin, { posts: [], failure: null });
    expect(text(doc.querySelector(".empty"))).toBe("no photos imported yet. run photos:import from the mac.");
  });
});
```

In `tests/unit/store.test.ts`, in `"reads the seeded logbook, every log entry and every record"`, add at the end:

```ts
    expect(data.photographs).toEqual([]);
```

and add at the end of the file:

```ts
describe("photographs", () => {
  test("loadAdmin groups every photograph, published or not, by post, newest post first", async () => {
    const add = (sql: string) => db.prepare(sql).run();
    await add("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES ('old', 100, '1970-01-01', NULL), ('new', 200, '1970-01-02', 'bondi, sydney')");
    const previews = JSON.stringify([{ key: "photos/previews/new-01/s/240.webp", width: 160, height: 240, format: "webp" }]);
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, raw_review, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES ('new-02', 'new', 2, '', 0, 1, '[]', 'k', 1, 1, 1, 's'), ('old-01', 'old', 0, 't', 1, 0, '[]', 'k', 1, 1, 1, 's'), ('new-01', 'new', 1, '', 1, 0, ?, 'k', 1, 1, 1, 's')").bind(previews).run();
    const { photographs } = await store.loadAdmin(db);
    expect(photographs.map((post) => [post.collection, post.date, post.place, post.photos.map((p) => p.id)])).toEqual([
      ["new", "1970-01-02", "bondi, sydney", ["new-01", "new-02"]],
      ["old", "1970-01-01", null, ["old-01"]],
    ]);
    expect(photographs[0].photos).toEqual([
      { id: "new-01", title: "", published: true, rawReview: false, thumb: { url: "/media/photos/previews/new-01/s/240.webp", width: 160, height: 240 } },
      { id: "new-02", title: "", published: false, rawReview: true, thumb: null },
    ]);
  });
});
```

In `tests/unit/submit.test.ts`, add inside `describe("submitForm", ...)`:

```ts
  test("a photographs save purges the gallery and the home page, and redirects to its section", async () => {
    await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES ('post', 1738488468, '2025-02-02', NULL)").run();
    const purge = cache();
    const outcome = await submitForm(formOf({ intent: "post.place", collection: "post", place: "bondi, sydney" }), deps(), purge, waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=photographs#photographs" });
    expect(purge.invalidate).toHaveBeenCalledWith({ tags: ["photos", "logbook"] });
  });
```

Run: `bun run test:unit tests/unit/photo-actions.test.ts tests/unit/photographs-admin.test.ts tests/unit/store.test.ts tests/unit/submit.test.ts`
Expected: FAIL: the intents aren't recognised ("that action isn't recognised"), `PhotographsAdmin.astro` doesn't exist and `loadAdmin` has no `photographs`.

- [ ] **Step 2: Validation and the store**

In `src/lib/admin/validate.ts`, add at the end:

```ts
// Photographs (spec 6.2)

export const PLACE_FIELDS = ["collection", "place"] as const;
export const TITLE_FIELDS = ["id", "title"] as const;
/** A tab, a newline or another control character: titles and notes are one line of plain text */
export const CONTROL = /[\u0000-\u001f\u007f]/;

/** A photograph's title: at most 80 characters of plain text, empty allowed. It is shown as text, never as markup */
export function checkTitle(fields: Fields): Checked<string> {
  const errors: Fields = {};
  if (CONTROL.test(fields.title)) errors.title = "one line of plain text";
  tooLong(errors, fields, "title", 80);
  return finish(errors, () => fields.title);
}
```

In `src/lib/admin/store.ts`, add after the `AdminRecord` interface:

```ts
/** One photograph in the photographs section (spec 6.2) */
export interface AdminPhoto {
  id: string;
  title: string;
  published: boolean;
  rawReview: boolean;
  /** Its 240 WebP preview, or null if it has none */
  thumb: { url: string; width: number; height: number } | null;
}

/** One Instagram post and every photograph in it, published or not */
export interface AdminPost {
  collection: string;
  date: string;
  place: string | null;
  photos: AdminPhoto[];
}
```

add `photographs: AdminPost[];` to `AdminData` after `records: AdminRecord[];`, and add after the `RecordRow` interface:

```ts
interface PhotographRow {
  collection: string;
  published_on: string;
  place: string | null;
  id: string;
  title: string;
  published: number;
  raw_review: number;
  previews: string;
}

const PHOTOGRAPHS =
  "SELECT photo_posts.collection, photo_posts.published_on, photo_posts.place, photos.id, photos.title, photos.published, photos.raw_review, photos.previews FROM photo_posts JOIN photos ON photos.collection = photo_posts.collection ORDER BY photo_posts.published_at DESC, photos.position";

/** Rows in post order, newest post first, grouped into posts */
function toPosts(rows: PhotographRow[]): AdminPost[] {
  const posts: AdminPost[] = [];
  for (const row of rows) {
    const last = posts.at(-1);
    const post = last && last.collection === row.collection ? last : { collection: row.collection, date: row.published_on, place: row.place, photos: [] as AdminPhoto[] };
    if (post !== last) posts.push(post);
    const thumb = (JSON.parse(row.previews) as { key: string; width: number; height: number }[]).find((preview) => preview.key.endsWith("/240.webp"));
    post.photos.push({ id: row.id, title: row.title, published: row.published === 1, rawReview: row.raw_review === 1, thumb: thumb ? { url: `/media/${thumb.key}`, width: thumb.width, height: thumb.height } : null });
  }
  return posts;
}
```

Replace `loadAdmin` with:

```ts
/** Everything the admin page shows, in one batch: unlike the logbook, every log entry, every record and every photograph */
export async function loadAdmin(db: D1Database): Promise<AdminData> {
  const [items, log, facts, records, photographs] = await db.batch([
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY section, position`),
    db.prepare("SELECT id, date, precision, text FROM log_entries ORDER BY date DESC, created_at DESC, id DESC"),
    db.prepare("SELECT key, title, subtitle FROM facts"),
    db.prepare(`SELECT ${RECORD_COLUMNS} FROM records ORDER BY active DESC, position`),
    db.prepare(PHOTOGRAPHS),
  ]);
  const all = (items.results as unknown as ItemRow[]).map(toItem);
  const factRows = facts.results as unknown as { key: string; title: string; subtitle: string | null }[];
  const fact = (key: string): AdminFact | null => {
    const found = factRows.find((entry) => entry.key === key);
    return found ? { title: found.title, subtitle: found.subtitle } : null;
  };
  return {
    now: all.filter((item) => item.section === "now"),
    before: all.filter((item) => item.section === "before"),
    log: (log.results as unknown as AdminLogEntry[]).map(({ id, date, precision, text }) => ({ id, date, precision, text })),
    facts: { shelf: fact("shelf"), kettle: fact("kettle") },
    records: (records.results as unknown as RecordRow[]).map(toRecord),
    photographs: toPosts(photographs.results as unknown as PhotographRow[]),
  };
}
```

and add at the end of the file:

```ts
// Photographs

/** A post's photographs in post order, or null when the post doesn't exist */
export async function postPhotoIds(db: D1Database, collection: string): Promise<string[] | null> {
  const [post, photos] = await db.batch([
    db.prepare("SELECT collection FROM photo_posts WHERE collection = ?").bind(collection),
    db.prepare("SELECT id FROM photos WHERE collection = ? ORDER BY position").bind(collection),
  ]);
  if (post.results.length === 0) return null;
  return (photos.results as unknown as { id: string }[]).map((row) => row.id);
}

/** Sets a post's place and marks it edited, so a later import keeps it (spec 6.2); false when the post doesn't exist */
export async function savePostPlace(db: D1Database, collection: string, place: string | null): Promise<boolean> {
  const result = await db.prepare("UPDATE photo_posts SET place = ?, place_edited = 1 WHERE collection = ?").bind(place, collection).run();
  return result.meta.changes > 0;
}

/** False when the photograph doesn't exist */
export async function savePhotoTitle(db: D1Database, id: string, title: string): Promise<boolean> {
  const result = await db.prepare("UPDATE photos SET title = ? WHERE id = ?").bind(title, id).run();
  return result.meta.changes > 0;
}
```

- [ ] **Step 3: The actions and their purge**

In `src/lib/admin/actions.ts`:

Add to the imports:

```ts
import { checkPlace } from "../photos/place";
import { setPublished, type PublishDeps } from "../photos/publish";
import { PHOTO_ID } from "../photos/tokens";
```

and add `checkTitle`, `PLACE_FIELDS` and `TITLE_FIELDS` to the import from `"./validate"`.

Change the `AdminSection` line to:

```ts
export type AdminSection = "now" | "before" | "log" | "lately" | "records" | "snapshots" | "photographs";
```

In `ActionDeps`, add after `snapshots?: SnapshotsService;`:

```ts
  /** PHOTO_PRINTS, the private masters a publish verifies (spec 6.2) */
  prints?: R2Bucket;
```

Change the `gone` line to:

```ts
const gone = (what: "line" | "entry" | "record" | "post" | "photo") => fail(null, "", { form: `that ${what} no longer exists` });
```

In `runAction`'s switch, add before `default:`:

```ts
    case "post.place":
      return savePlace(form, deps);
    case "post.publish":
      return publishPost(form, deps, true);
    case "post.hide":
      return publishPost(form, deps, false);
    case "photo.title":
      return saveTitle(form, deps);
    case "photo.publish":
      return publishPhoto(form, deps, true);
    case "photo.hide":
      return publishPhoto(form, deps, false);
```

and add at the end of the file:

```ts
// Photographs (spec 6.2)

const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;
const postForm = (collection: string) => `post-${collection}`;
const photoForm = (id: string) => `photo-${id}`;
const unchecked = (ids: string[]) => `${ids.length} ${ids.length === 1 ? "photo" : "photos"} couldn't be checked: ${ids.join(", ")}. publish the others one at a time.`;

function publishDeps({ db, media, prints }: ActionDeps): PublishDeps {
  if (!prints) throw new Error("no PHOTO_PRINTS binding");
  return { db, media, prints };
}

async function savePlace(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, PLACE_FIELDS);
  if (!COLLECTION.test(fields.collection)) return gone("post");
  const checked = checkPlace(fields.place);
  if (!checked.ok) return fail("photographs", postForm(fields.collection), { place: checked.error }, fields);
  return (await store.savePostPlace(db, fields.collection, checked.place)) ? { ok: true, section: "photographs" } : gone("post");
}

/** Publishes or hides every photograph in a post: all of them or none, after checking each (spec 6.2) */
async function publishPost(form: FormData, deps: ActionDeps, published: boolean): Promise<ActionResult> {
  const collection = String(form.get("collection") ?? "");
  const ids = COLLECTION.test(collection) ? await store.postPhotoIds(deps.db, collection) : null;
  if (!ids || ids.length === 0) return gone("post");
  const outcome = await setPublished(publishDeps(deps), ids, published);
  if ("missing" in outcome) return gone("post");
  if ("unverified" in outcome) return fail("photographs", postForm(collection), { form: unchecked(outcome.unverified) });
  return { ok: true, section: "photographs" };
}

async function saveTitle(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, TITLE_FIELDS);
  if (!PHOTO_ID.test(fields.id)) return gone("photo");
  const checked = checkTitle(fields);
  if (!checked.ok) return fail("photographs", photoForm(fields.id), checked.errors, fields);
  return (await store.savePhotoTitle(db, fields.id, checked.value)) ? { ok: true, section: "photographs" } : gone("photo");
}

async function publishPhoto(form: FormData, deps: ActionDeps, published: boolean): Promise<ActionResult> {
  const id = String(form.get("id") ?? "");
  if (!PHOTO_ID.test(id)) return gone("photo");
  const outcome = await setPublished(publishDeps(deps), [id], published);
  if ("missing" in outcome) return gone("photo");
  if ("unverified" in outcome) return fail("photographs", photoForm(id), { form: "that photo couldn't be checked, so it stays hidden. run the import for it again." });
  return { ok: true, section: "photographs" };
}
```

In `src/lib/admin/submit.ts`, change the import to `import { runAction, type ActionDeps, type ActionFailure, type AdminSection } from "./actions";`, add after the `UNEXPECTED` line:

```ts
/** The cache tags each section's saves purge (spec 6.1): photographs change the gallery and, through its line, the home page */
const PURGES: Record<AdminSection, string[]> = {
  now: ["logbook"],
  before: ["logbook"],
  log: ["logbook"],
  lately: ["logbook"],
  records: ["logbook"],
  snapshots: ["logbook"],
  photographs: ["photos", "logbook"],
};
```

and change `const purged = await purgeTags(cache, ["logbook"]);` to `const purged = await purgeTags(cache, PURGES[result.section]);`.

Run: `bun run test:unit tests/unit/photo-actions.test.ts tests/unit/store.test.ts tests/unit/submit.test.ts`
Expected: PASS.

- [ ] **Step 4: The section on the page**

Create `src/components/admin/PhotographsAdmin.astro`:

```astro
---
import Field from "./Field.astro";
import { formState } from "../../lib/admin/form-state";
import type { ActionFailure } from "../../lib/admin/actions";
import type { AdminPost } from "../../lib/admin/store";
import { formatLogDate } from "../../lib/text";

interface Props {
  posts: AdminPost[];
  failure: ActionFailure | null;
}

const { posts, failure } = Astro.props;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const heading = (post: AdminPost) => (post.place ? `${formatLogDate(post.date, "day")} · ${post.place}` : formatLogDate(post.date, "day"));
---
{posts.length === 0 ? (
  <p class="empty">no photos imported yet. run photos:import from the mac.</p>
) : (
  <ol class="posts-admin">
    {posts.map((post) => {
      const id = `post-${post.collection}`;
      const place = formState(failure, id, { collection: post.collection, place: post.place ?? "" });
      // A failed form anywhere in the post opens it: the post's own, or one of its photographs'
      const open = place.open || post.photos.some((photo) => failure?.form === `photo-${photo.id}`);
      const published = post.photos.filter((photo) => photo.published).length;
      const raw = post.photos.filter((photo) => photo.rawReview).length;
      return (
        <li class="post-admin">
          <details id={id} open={open}>
            <summary><span class="what">{heading(post)} · {count(post.photos.length, "photo", "photos")}, {published} published</span>{raw > 0 && <span class="tagged">{raw} raw</span>}</summary>
            {place.errors.form && <p class="error" role="alert">{place.errors.form}</p>}
            <form method="post" action={`/admin/#${id}`} class="admin-form">
              <input type="hidden" name="intent" value="post.place" />
              <input type="hidden" name="collection" value={post.collection} />
              <Field form={id} name="place" label="place" value={place.values.place} error={place.errors.place} maxlength={60} hint="area, city. leave it empty to show no place." />
              <button type="submit" class="button">save</button>
            </form>
            <div class="controls">
              <form method="post" action={`/admin/#${id}`} class="move">
                <input type="hidden" name="intent" value="post.publish" />
                <input type="hidden" name="collection" value={post.collection} />
                <button type="submit" class="button quiet">publish all {post.photos.length}</button>
              </form>
              <form method="post" action={`/admin/#${id}`} class="move">
                <input type="hidden" name="intent" value="post.hide" />
                <input type="hidden" name="collection" value={post.collection} />
                <button type="submit" class="button quiet">hide all</button>
              </form>
            </div>
            <ol class="photos-admin">
              {post.photos.map((photo) => {
                const formId = `photo-${photo.id}`;
                const state = formState(failure, formId, { id: photo.id, title: photo.title });
                const toggle = photo.published ? "hide" : "publish";
                return (
                  <li class="photo-admin" id={formId}>
                    {photo.thumb ? <img src={photo.thumb.url} width={photo.thumb.width} height={photo.thumb.height} alt="" loading="lazy" decoding="async" /> : <span class="no-thumb"></span>}
                    <div class="photo-admin-body">
                      <p class="photo-id"><span class="mono">{photo.id}</span> · {photo.published ? "published" : "hidden"}{photo.rawReview && <span class="tagged">raw</span>}</p>
                      {state.errors.form && <p class="error" role="alert">{state.errors.form}</p>}
                      <form method="post" action={`/admin/#${formId}`} class="admin-form">
                        <input type="hidden" name="intent" value="photo.title" />
                        <input type="hidden" name="id" value={photo.id} />
                        <Field form={formId} name="title" label="title" value={state.values.title} error={state.errors.title} maxlength={80} hint="plain text. leave it empty for no title." />
                        <button type="submit" class="button">save</button>
                      </form>
                      <form method="post" action={`/admin/#${formId}`} class="move">
                        <input type="hidden" name="intent" value={`photo.${toggle}`} />
                        <input type="hidden" name="id" value={photo.id} />
                        <button type="submit" class="button quiet" aria-label={`${toggle} ${photo.id}`}>{toggle}</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ol>
          </details>
        </li>
      );
    })}
  </ol>
)}
```

In `src/styles/admin.css`, change the selector `.entry .tagged {` to `.entry .tagged, .post-admin .tagged {`, and add at the end:

```css
/* Photographs: one post per row, opening to its place, its publish buttons and each photograph (spec 6.2) */
.posts-admin { border-top: 1px solid var(--rule); max-width: 40rem; }
.post-admin { border-bottom: 1px solid var(--rule); padding: 4px 0; }
.post-admin > details > summary { cursor: pointer; padding: 8px 0; min-height: 44px; }
.post-admin > details > .controls { padding-bottom: 12px; }
.photos-admin { display: grid; gap: 0; }
.photo-admin { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px; align-items: start; padding: 12px 0; border-top: 1px dashed var(--rule); scroll-margin-top: 1rem; }
.photo-admin img, .photo-admin .no-thumb { display: block; width: 88px; height: auto; max-height: 132px; object-fit: contain; background: var(--rule); }
.photo-admin .no-thumb { height: 88px; }
.photo-admin-body { min-width: 0; }
.photo-id { font-size: 14.5px; color: var(--muted); }
.photo-id .mono { color: var(--ink); }
.photo-admin-body .admin-form { padding-bottom: 8px; }
```

In `src/pages/admin/index.astro`:

Add to the imports:

```ts
import PhotographsAdmin from "../../components/admin/PhotographsAdmin.astro";
```

Change the `SECTIONS` line to:

```ts
const SECTIONS: readonly AdminSection[] = ["now", "before", "log", "lately", "records", "snapshots", "photographs"];
```

Change the `deps` line to:

```ts
  const deps = { db: env.DB, media: env.MEDIA, images: env.IMAGES, snapshots: env.SNAPSHOTS, prints: env.PHOTO_PRINTS };
```

Replace the `savedLine` and `notice` lines with:

```ts
// Photographs show on the gallery, everything else on the logbook (spec 6.2)
const later = Astro.url.searchParams.has("later");
const savedLine = (section: AdminSection) => {
  const where = section === "photographs" ? "gallery" : "logbook";
  return later ? `saved - the ${where} may show the old version for a little while.` : `saved - it's on the ${where} now.`;
};
const notice = (section: AdminSection) => (section === saved ? savedLine(section) : null);
```

and add after the snapshots `AdminRow`:

```astro
    <AdminRow label="photographs" id="photographs" notice={notice("photographs")}><PhotographsAdmin posts={data.photographs} failure={failure} /></AdminRow>
```

Run: `bun run test:unit tests/unit/photographs-admin.test.ts && bun run typecheck && bun run test:unit`
Expected: PASS; 0 errors; every unit test passes.

- [ ] **Step 5: The e2e specs**

Create `tests/e2e/photo-store.ts`:

```ts
import { execFileSync } from "node:child_process";

/**
 * SQL on the admin server's own local store (4333), as spec 11.2's fixtures allow: reading a row, or setting test data.
 * The server is running on the same store; SQLite's locking keeps the two safe.
 */
export function adminD1<T = Record<string, unknown>>(sql: string): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", ".wrangler/admin", "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
}
```

In `tests/e2e/admin.ts`, replace `expectSaved` with:

```ts
/** After a save: the redirect lands on the section and says so. Local runs have no cache purge, so they say the page may show the old version for a little while. Photographs show on the gallery, everything else on the logbook. */
export async function expectSaved(page: Page, section: string, where: "logbook" | "gallery" = "logbook") {
  await expect(page).toHaveURL(new RegExp(`/admin/\\?saved=${section}(&later=1)?#${section}$`));
  await expect(page.locator(`#${section} .notice`)).toHaveText(new RegExp(`^saved - (it's on the ${where} now|the ${where} may show the old version for a little while)\\.$`));
}
```

In `tests/e2e/admin-layout.spec.ts`, change the labels to `["admin", "now", "lately", "log", "records", "before", "snapshots", "photographs"]`.

Create `tests/e2e/admin-photos.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectSaved, openAdmin } from "./admin";
import { adminD1 } from "./photo-store";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");
// Each test keeps to its own posts (fixture-b, -c and -e), which no other spec on 4333 changes
test.describe.configure({ mode: "serial" });

const post = (page: Page, collection: string) => page.locator(`#post-${collection}`);
const intent = (scope: Locator, value: string) => scope.locator(`form:has(input[name="intent"][value="${value}"])`);
const POSTED = (response: { request(): { method(): string } }) => response.request().method() === "POST";

async function openPost(page: Page, collection: string) {
  await openAdmin(page);
  await post(page, collection).locator("summary").click();
}

test("posts are listed newest first, each with its date, place, counts and RAW pill", async ({ page }) => {
  await openAdmin(page);
  expect(await page.locator("#photographs details").evaluateAll((all) => all.map((details) => details.id))).toEqual([
    "post-fixture", "post-fixture-b", "post-fixture-c", "post-fixture-d", "post-fixture-e", "post-fixture-f",
  ]);
  await expect(post(page, "fixture").locator("summary .what")).toHaveText("27.09.26 · bondi, sydney · 3 photos, 2 published");
  await expect(post(page, "fixture-c").locator("summary .tagged")).toHaveText("1 raw");
});

test("hiding and publishing a whole post, then one photo", async ({ page }) => {
  await openPost(page, "fixture-b");
  await post(page, "fixture-b").getByRole("button", { name: "hide all", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 0 published");

  await openPost(page, "fixture-b");
  await post(page, "fixture-b").getByRole("button", { name: "publish all 2", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 2 published");

  await openPost(page, "fixture-b");
  await page.getByRole("button", { name: "hide fixture-b-02", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 1 published");
  expect(adminD1<{ id: string; published: number }>("SELECT id, published FROM photos WHERE collection = 'fixture-b' ORDER BY position")).toEqual([
    { id: "fixture-b-01", published: 1 },
    { id: "fixture-b-02", published: 0 },
  ]);

  await openPost(page, "fixture-b");
  await page.getByRole("button", { name: "publish fixture-b-02", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-b").locator("summary .what")).toHaveText("14.06.26 · 2 photos, 2 published");
});

test("a photo that fails its checks publishes nothing, and says which", async ({ page }) => {
  await openPost(page, "fixture-e");
  await post(page, "fixture-e").getByRole("button", { name: "hide all", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  const [{ print_sha256: sha }] = adminD1<{ print_sha256: string }>("SELECT print_sha256 FROM photos WHERE id = 'fixture-e-01'");
  // The row now names a master R2 doesn't have, so the check fails as it would after a broken upload
  adminD1(`UPDATE photos SET print_sha256 = '${"0".repeat(64)}' WHERE id = 'fixture-e-01'`);
  try {
    await openPost(page, "fixture-e");
    const [response] = await Promise.all([page.waitForResponse(POSTED), post(page, "fixture-e").getByRole("button", { name: "publish all 1", exact: true }).click()]);
    expect(response.status()).toBe(422);
    await expect(post(page, "fixture-e")).toHaveAttribute("open", "");
    await expect(post(page, "fixture-e").locator(':scope > [role="alert"]')).toHaveText("1 photo couldn't be checked: fixture-e-01. publish the others one at a time.");
    expect(adminD1<{ published: number }>("SELECT published FROM photos WHERE id = 'fixture-e-01'")[0].published).toBe(0);
  } finally {
    adminD1(`UPDATE photos SET print_sha256 = '${sha}' WHERE id = 'fixture-e-01'`);
  }
  await openPost(page, "fixture-e");
  await post(page, "fixture-e").getByRole("button", { name: "publish all 1", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-e").locator("summary .what")).toHaveText("09.08.25 · braddon, canberra · 1 photo, 1 published");
});

test("a place and a title are saved; a place the fonts can't draw comes back with its form", async ({ page }) => {
  await openPost(page, "fixture-c");
  const place = intent(post(page, "fixture-c"), "post.place");
  await place.getByLabel("place").fill("  Cottesloe, Perth ");
  await place.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(post(page, "fixture-c").locator("summary .what")).toHaveText("01.03.26 · cottesloe, perth · 1 photo, 1 published");
  expect(adminD1("SELECT place, place_edited FROM photo_posts WHERE collection = 'fixture-c'")).toEqual([{ place: "cottesloe, perth", place_edited: 1 }]);

  await openPost(page, "fixture-c");
  await place.getByLabel("place").fill("東京, japan");
  const [refused] = await Promise.all([page.waitForResponse(POSTED), place.getByRole("button", { name: "save", exact: true }).click()]);
  expect(refused.status()).toBe(422);
  await expect(page.locator("#post-fixture-c-place")).toHaveValue("東京, japan");
  await expect(page.locator("#post-fixture-c-place-error")).toHaveText("plain latin letters only (accents like é are fine)");

  await openPost(page, "fixture-c");
  const title = intent(page.locator("#photo-fixture-c-01"), "photo.title");
  await title.getByLabel("title").fill("the long jetty");
  await title.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await expect(page.locator("#photo-fixture-c-01-title")).toHaveValue("the long jetty");
});
```

Task 9 adds one more test here, once the photo page exists: the edited place and title on the gallery and the photo's page.

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/admin-photos.spec.ts tests/e2e/admin-layout.spec.ts tests/e2e/photos.spec.ts --project=chromium`
Expected: every test passes.

Run: `bun run test:e2e tests/e2e/admin-layout.spec.ts --project=phone`
Expected: passes: the photographs section, every `<details>` open, fits a phone with 16px fields and 44px buttons.

Look at it (Global constraints, visual checks) at `http://localhost:4336/admin/`, saved as `"$TMPDIR/admin"`: each post's summary on one line at 1280px and wrapping cleanly at 375px, previews 88px wide with their ratio, the raw pills beside the ids, the buttons in a row, nothing wider than the page.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/PhotographsAdmin.astro src/lib/admin/actions.ts src/lib/admin/validate.ts src/lib/admin/store.ts src/lib/admin/submit.ts src/pages/admin/index.astro src/styles/admin.css tests/unit/photo-actions.test.ts tests/unit/photographs-admin.test.ts tests/unit/store.test.ts tests/unit/submit.test.ts tests/e2e/admin-photos.spec.ts tests/e2e/photo-store.ts tests/e2e/admin.ts tests/e2e/admin-layout.spec.ts
git commit -m "feat: the admin's photographs section: places, titles and publishing"
```

---
### Task 7: /photos and the home page's line

The gallery (spec 3): a notebook page with a `photos of` head row and an `entries` row of dated entries, newest first, four to a page, each a contact sheet of numbered frames that link to their photographs. It works without JavaScript: `older entries` is a plain link to `/photos?before=<seconds>`, a `noindex` page. Only the first row of the first entry loads eagerly; every frame knows its size before its preview arrives. The home page gains a `photos` row between `log` and `on the turntable` while anything is published (spec 3.7).

**Files:**
- Create: `src/lib/photos/gallery.ts`, `src/components/Beacon.astro`, `src/components/photos/EntryHead.astro`, `src/components/photos/Frame.astro`, `src/components/photos/Entry.astro`, `src/components/photos/Gallery.astro`, `src/pages/photos/index.astro`, `src/styles/photos.css`, `tests/unit/gallery.test.ts`, `tests/unit/gallery-page.test.ts`, `tests/e2e/gallery.spec.ts`
- Modify: `src/lib/logbook.ts`, `src/components/Logbook.astro`, `playwright.config.ts`
- Test: `tests/unit/gallery.test.ts`, `tests/unit/gallery-page.test.ts`, `tests/unit/logbook.test.ts`, `tests/unit/logbook-page.test.ts`, `tests/e2e/gallery.spec.ts`, `tests/e2e/logbook.spec.ts` (both reading the gallery server, 4335, through `GALLERY` from Task 1)

**Interfaces:**
- Consumes: `entryPage`, `ENTRY_LIMIT`, `Entry`, `PublicPhoto`, `PublicPreview` from `src/lib/photos/store.ts` (Task 1); `formatLogDate` from `src/lib/text.ts`; `Row.astro`; `Notebook.astro` (`title`, `description`, `noindex`).
- Produces:
  - `src/lib/photos/gallery.ts` (pure, and imported by the browser script in Task 8, so type-only imports from the store): `longDate(iso): string` (`2 february 2025`); `dateAndPlace(date, place): string` (`02.02.25 · bondi, sydney`); `frameNumber(id): string`; `photoAlt(photo, index, total): string`; `previewOf(photo, size, format): PublicPreview | undefined`; `srcsetOf(photo, sizes, format): string`; `FRAME_HEIGHT = 120`, `PHONE_FRAME_HEIGHT = 88`; `frameSizes(width, height): string`; `interface FrameView { href; avif; webp; src; sizes; width; height; alt; number }`; `frameView(photo, index, total): FrameView | null`; `EAGER_FRAMES = 8`
  - `EntryHead.astro` props `{ date: string | null; place: string | null }`; `Frame.astro` props `{ view: FrameView | null; eager?: boolean; priority?: boolean }` (`null` renders the empty frame Task 8 clones); `Entry.astro` props `{ entry: Entry | null; first?: boolean }`; `Gallery.astro` props `{ entries: Entry[] | null; next: number | null; older: boolean }` (`entries: null` is the degraded render)
  - Markup: `ol.entries > li.entry#post-<collection>`, `h2.entry-head > time + span.entry-place`, `ol.sheet > li.sheet-frame > a.frame-link > picture + span.frame-no`, the pager `a.more[data-next] > span.chev + span.lbl` or `p.more-end`
  - `src/lib/logbook.ts`: `Logbook.photos: boolean`
  - `src/components/Beacon.astro` (no props): the beacon, for every page that counts visits

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/gallery.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { dateAndPlace, EAGER_FRAMES, frameNumber, frameSizes, frameView, longDate, photoAlt, previewOf, srcsetOf } from "../../src/lib/photos/gallery";
import type { PublicPhoto } from "../../src/lib/photos/store";

const ID = "DFkL1xrsnOH-02";
const preview = (size: number, format: "webp" | "avif", width: number, height: number) => ({ url: `/media/photos/previews/${ID}/s/${size}.${format}`, width, height, format });
const portrait = (over: Partial<PublicPhoto> = {}): PublicPhoto => ({
  id: ID, collection: "DFkL1xrsnOH", title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2025-02-02", place: "bondi, sydney",
  previews: [preview(240, "webp", 160, 240), preview(240, "avif", 160, 240), preview(480, "webp", 320, 480), preview(480, "avif", 320, 480)],
  ...over,
});

describe("dates and names", () => {
  test("a post's date in words and in the log's format, with its place when known", () => {
    expect(longDate("2025-02-02")).toBe("2 february 2025");
    expect(longDate("2026-12-31")).toBe("31 december 2026");
    expect(dateAndPlace("2025-02-02", "bondi, sydney")).toBe("02.02.25 · bondi, sydney");
    expect(dateAndPlace("2025-02-02", null)).toBe("02.02.25");
  });

  test("a frame's number is its slide number, three digits included", () => {
    expect(frameNumber("DFkL1xrsnOH-02")).toBe("02");
    expect(frameNumber("a-b_c-100")).toBe("100");
  });

  test("alt text is the title when there is one, otherwise which photo of the post it is", () => {
    expect(photoAlt(portrait(), 1, 14)).toBe("photo 2 of 14 from 2 february 2025, bondi, sydney");
    expect(photoAlt(portrait({ place: null }), 0, 1)).toBe("photo 1 of 1 from 2 february 2025");
    expect(photoAlt(portrait({ title: '<b>dawn</b> & "co"' }), 0, 1)).toBe('<b>dawn</b> & "co"');
  });
});

describe("frames", () => {
  test("sizes are the frame's rendered width: 120px tall from 680px wide, 88px below", () => {
    expect(frameSizes(160, 240)).toBe("(max-width: 679px) 59px, 80px");
    expect(frameSizes(240, 160)).toBe("(max-width: 679px) 132px, 180px");
  });

  test("srcsets describe each preview by its real width", () => {
    expect(srcsetOf(portrait(), [240, 480], "avif")).toBe(`/media/photos/previews/${ID}/s/240.avif 160w, /media/photos/previews/${ID}/s/480.avif 320w`);
    expect(previewOf(portrait(), 480, "webp")?.width).toBe(320);
    expect(previewOf(portrait(), 960, "webp")).toBeUndefined();
  });

  test("a frame's view holds everything its markup needs, sized by the 240 preview", () => {
    expect(frameView(portrait(), 1, 14)).toEqual({
      href: `/photos/${ID}`,
      avif: `/media/photos/previews/${ID}/s/240.avif 160w, /media/photos/previews/${ID}/s/480.avif 320w`,
      webp: `/media/photos/previews/${ID}/s/240.webp 160w, /media/photos/previews/${ID}/s/480.webp 320w`,
      src: `/media/photos/previews/${ID}/s/240.webp`,
      sizes: "(max-width: 679px) 59px, 80px",
      width: 160,
      height: 240,
      alt: "photo 2 of 14 from 2 february 2025, bondi, sydney",
      number: "02",
    });
    expect(frameView(portrait({ previews: portrait().previews.slice(2) }), 0, 1)).toBeNull();
    expect(EAGER_FRAMES).toBe(8);
  });
});
```

Create `tests/unit/gallery-page.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import Gallery from "../../src/components/photos/Gallery.astro";
import type { Entry, PublicPhoto } from "../../src/lib/photos/store";
import { render, text } from "./render";

const photo = (id: string, over: Partial<PublicPhoto> = {}): PublicPhoto => ({
  id, collection: id.slice(0, id.lastIndexOf("-")), title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2025-02-02", place: "bondi, sydney",
  previews: [240, 480].flatMap((size) => (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/${id}/s/${size}.${format}`, width: (size * 2) / 3, height: size, format }))),
  ...over,
});
const entry = (collection: string, date: string, place: string | null, ids: string[], over: Partial<PublicPhoto> = {}): Entry => ({
  collection, date, place, publishedAt: Date.parse(`${date}T12:00:00+10:00`) / 1000, photos: ids.map((id) => photo(id, { date, place, ...over })),
});
// DFkL1xrsnOH-02 is hidden: the frames are 01 and 03, and they count as 1 and 2 of 2
const PAGE = [entry("DFkL1xrsnOH", "2025-02-02", "bondi, sydney", ["DFkL1xrsnOH-01", "DFkL1xrsnOH-03"]), entry("older", "2024-12-25", null, ["older-01"])];
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);
const attrs = (el: Element | null, ...names: string[]) => names.map((name) => el?.getAttribute(name) ?? null);

describe("Gallery", () => {
  test("each entry is headed by its date and place, with numbered frames that link to their pages", async () => {
    const doc = await render(Gallery, { entries: PAGE, next: null, older: false });
    expect(labels(doc)).toEqual(["photos of", "entries"]);
    expect(text(doc.querySelector("h1"))).toBe("george vlachos");
    expect(text(doc.querySelector(".intro"))).toBe("photos i've taken, one entry per instagram post, newest first.");
    expect(text(doc.querySelector(".where"))).toBe("back to the logbook");
    expect([...doc.querySelectorAll("ol.entries > li.entry")].map((li) => li.id)).toEqual(["post-DFkL1xrsnOH", "post-older"]);
    expect(text(doc.querySelector("#post-DFkL1xrsnOH .entry-head"))).toBe("02.02.25 · bondi, sydney");
    expect(doc.querySelector("#post-DFkL1xrsnOH .entry-head time")!.getAttribute("datetime")).toBe("2025-02-02");
    expect(text(doc.querySelector("#post-older .entry-head"))).toBe("25.12.24");
    expect([...doc.querySelectorAll("#post-DFkL1xrsnOH .frame-no")].map(text)).toEqual(["01", "03"]);
    expect([...doc.querySelectorAll("#post-DFkL1xrsnOH a.frame-link")].map((a) => a.getAttribute("href"))).toEqual(["/photos/DFkL1xrsnOH-01", "/photos/DFkL1xrsnOH-03"]);
    const img = doc.querySelectorAll("#post-DFkL1xrsnOH img")[1];
    expect(attrs(img, "alt", "width", "height", "sizes", "src", "decoding")).toEqual([
      "photo 2 of 2 from 2 february 2025, bondi, sydney", "160", "240", "(max-width: 679px) 59px, 80px", "/media/photos/previews/DFkL1xrsnOH-03/s/240.webp", "async",
    ]);
    expect(img.getAttribute("srcset")).toBe("/media/photos/previews/DFkL1xrsnOH-03/s/240.webp 160w, /media/photos/previews/DFkL1xrsnOH-03/s/480.webp 320w");
    expect(attrs(doc.querySelectorAll("#post-DFkL1xrsnOH source")[1], "type", "srcset")).toEqual([
      "image/avif", "/media/photos/previews/DFkL1xrsnOH-03/s/240.avif 160w, /media/photos/previews/DFkL1xrsnOH-03/s/480.avif 320w",
    ]);
  });

  test("only the first eight frames of the page's first entry load eagerly, the first with high priority; numbers keep three digits", async () => {
    const ids = [...Array.from({ length: 19 }, (_, i) => `big-${String(i + 1).padStart(2, "0")}`), "big-100"];
    const doc = await render(Gallery, { entries: [entry("big", "2025-02-02", null, ids), PAGE[1]], next: null, older: false });
    const loading = [...doc.querySelectorAll("ol.entries img")].map((img) => [img.getAttribute("loading"), img.getAttribute("fetchpriority")]);
    expect(loading).toEqual([["eager", "high"], ...Array(7).fill(["eager", null]), ...Array(13).fill(["lazy", null])]);
    expect(text([...doc.querySelectorAll("#post-big .frame-no")].at(-1)!)).toBe("100");
  });

  test("older entries is a plain link to the next page's cursor; at the end the line says so", async () => {
    let doc = await render(Gallery, { entries: PAGE, next: 1735092000, older: false });
    const more = doc.querySelector("a.more")!;
    expect(attrs(more, "href", "data-next")).toEqual(["/photos?before=1735092000", "1735092000"]);
    expect(text(more)).toBe("older entries");
    expect(doc.querySelector(".more-end")).toBeNull();
    doc = await render(Gallery, { entries: PAGE, next: null, older: false });
    expect(doc.querySelector("a.more")).toBeNull();
    expect(text(doc.querySelector(".more-end"))).toBe("that's every entry.");
  });

  test("an older page links back to the newest entries, and one past the oldest post says that's every entry, not that nothing is up", async () => {
    let doc = await render(Gallery, { entries: PAGE, next: null, older: true });
    expect(text(doc.querySelector(".where"))).toBe("back to the logbook · newest entries");
    expect(doc.querySelector('.where a[href="/photos"]')).not.toBeNull();
    doc = await render(Gallery, { entries: [], next: null, older: true });
    expect(text(doc.querySelector(".more-end"))).toBe("that's every entry.");
    expect(doc.querySelector(".empty")).toBeNull();
  });

  test("with nothing published, the entries row says so, with no pager", async () => {
    const doc = await render(Gallery, { entries: [], next: null, older: false });
    expect(text(doc.querySelector("#entries .empty"))).toBe("no photos up yet.");
    expect(doc.querySelector("ol.entries")).toBeNull();
    expect(doc.querySelector(".more-end")).toBeNull();
  });

  test("when D1 fails, only the head row renders, saying so", async () => {
    const doc = await render(Gallery, { entries: null, next: null, older: false });
    expect(labels(doc)).toEqual(["photos of"]);
    expect(text(doc.querySelector(".down"))).toBe("photos aren't loading right now. try again in a bit.");
  });

  test("a title is text, never markup", async () => {
    const doc = await render(Gallery, { entries: [entry("t", "2025-02-02", null, ["t-01"], { title: '<b>dawn</b> & "co"' })], next: null, older: false });
    expect(doc.querySelector("ol.entries img")!.getAttribute("alt")).toBe('<b>dawn</b> & "co"');
    expect(doc.querySelector("ol.entries b")).toBeNull();
  });
});
```

In `tests/unit/logbook.test.ts`, in `"reads everything in one batch and maps rows"`, add a fifth result after the records array, `[{ any: 1 }],`, and add after the `records` expectation:

```ts
    expect(data.photos).toBe(true);
```

then add inside `describe("loadLogbook", ...)`:

```ts
  test("there are photos only when something is published", async () => {
    const data = await loadLogbook(fakeDb([[], [], [], [], [{ any: 0 }]]));
    expect(data.photos).toBe(false);
  });
```

In `tests/unit/logbook-page.test.ts`, add `photos: false,` to `full` after `records: [],`; change the object in `"omits rows with no data and the last-entry note"` to `{ now: [], before: [], facts: [], log: [], records: [], photos: false }`; and add inside `describe("Logbook", ...)`:

```ts
  test("a line points to the photos, between the log and the turntable, only while something is published", async () => {
    const doc = await render(Logbook, { data: { ...full, photos: true } });
    expect(labels(doc)).toEqual(["logbook of", "now", "lately", "log", "photos", "on the turntable", "before", "say hi", "visitor info"]);
    expect(text(doc.querySelector("#photos .body"))).toBe("photos i've taken, kept like this log.");
    expect(doc.querySelector("#photos a")!.getAttribute("href")).toBe("/photos");
    expect(labels(await render(Logbook, { data: full }))).not.toContain("photos");
  });
```

Run: `bun run test:unit tests/unit/gallery.test.ts tests/unit/gallery-page.test.ts tests/unit/logbook.test.ts tests/unit/logbook-page.test.ts`
Expected: FAIL: `src/lib/photos/gallery.ts` and `Gallery.astro` don't exist and `loadLogbook` has no `photos`.

- [ ] **Step 2: The gallery's pure functions**

Create `src/lib/photos/gallery.ts`:

```ts
// Names, dates and frames for the gallery's pages (spec 3 and 4). Pure, and shared by the server's components and the
// browser's photo-sheet script, so the store is imported for its types only.
import { formatLogDate } from "../text";
import type { PublicPhoto, PublicPreview } from "./store";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A date in words, for alt text and descriptions: 2 february 2025 */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** An entry's heading as text: 02.02.25 · bondi, sydney, or just the date when the place is unknown */
export const dateAndPlace = (date: string, place: string | null) => (place ? `${formatLogDate(date, "day")} · ${place}` : formatLogDate(date, "day"));

/** The slide number from the id, like a contact sheet's edge number: DFkL1xrsnOH-02 shows 02, even when other slides are hidden */
export const frameNumber = (id: string) => id.slice(id.lastIndexOf("-") + 1);

/** The title when George has written one, otherwise photo 2 of 14 from 2 february 2025, bondi, sydney (spec 3.2) */
export function photoAlt(photo: Pick<PublicPhoto, "title" | "date" | "place">, index: number, total: number): string {
  if (photo.title) return photo.title;
  return `photo ${index + 1} of ${total} from ${longDate(photo.date)}${photo.place ? `, ${photo.place}` : ""}`;
}

export const previewOf = (photo: Pick<PublicPhoto, "previews">, size: number, format: "avif" | "webp"): PublicPreview | undefined =>
  photo.previews.find((preview) => preview.format === format && preview.url.endsWith(`/${size}.${format}`));

/** A srcset of these sizes in one format, each preview described by its real width */
export function srcsetOf(photo: Pick<PublicPhoto, "previews">, sizes: readonly number[], format: "avif" | "webp"): string {
  return sizes
    .map((size) => previewOf(photo, size, format))
    .filter((preview): preview is PublicPreview => preview !== undefined)
    .map((preview) => `${preview.url} ${preview.width}w`)
    .join(", ");
}

/** Frames are 120px tall on screens 680px and wider and 88px below (spec 3.2), their width following the ratio */
export const FRAME_HEIGHT = 120;
export const PHONE_FRAME_HEIGHT = 88;

/** The frame's rendered width at each height, so a portrait at 2× takes the 240 and a landscape the 480 (spec 3.3) */
export function frameSizes(width: number, height: number): string {
  return `(max-width: 679px) ${Math.round((PHONE_FRAME_HEIGHT * width) / height)}px, ${Math.round((FRAME_HEIGHT * width) / height)}px`;
}

/** Everything one frame's markup needs; the server renders it and the photo-sheet script fills a cloned frame with it */
export interface FrameView {
  href: string;
  avif: string;
  webp: string;
  src: string;
  sizes: string;
  width: number;
  height: number;
  alt: string;
  number: string;
}

/** A frame for the photograph at `index` of the `total` published in its post; null without a 240 preview (never for a published one) */
export function frameView(photo: PublicPhoto, index: number, total: number): FrameView | null {
  const small = previewOf(photo, 240, "webp");
  if (!small) return null;
  return {
    href: `/photos/${photo.id}`,
    avif: srcsetOf(photo, [240, 480], "avif"),
    webp: srcsetOf(photo, [240, 480], "webp"),
    src: small.url,
    sizes: frameSizes(small.width, small.height),
    width: small.width,
    height: small.height,
    alt: photoAlt(photo, index, total),
    number: frameNumber(photo.id),
  };
}

/** Only the first row of the page's first entry loads eagerly: eight frames at most (spec 3.3) */
export const EAGER_FRAMES = 8;
```

Run: `bun run test:unit tests/unit/gallery.test.ts`
Expected: PASS.

- [ ] **Step 3: The components, the page and its styles**

Create `src/components/photos/EntryHead.astro`:

```astro
---
import { formatLogDate } from "../../lib/text";

interface Props {
  /** null renders the empty heading the photo-sheet script fills (Task 8) */
  date: string | null;
  place: string | null;
}

const { date, place } = Astro.props;
---
<h2 class="entry-head"><time datetime={date ?? undefined}>{date && formatLogDate(date, "day")}</time><span class="entry-place">{place && ` · ${place}`}</span></h2>
```

Create `src/components/photos/Frame.astro`:

```astro
---
import type { FrameView } from "../../lib/photos/gallery";

interface Props {
  /** null renders the empty frame the photo-sheet script clones (spec 3.4), so the markup lives in one place */
  view: FrameView | null;
  eager?: boolean;
  priority?: boolean;
}

const { view, eager = false, priority = false } = Astro.props;
---
<li class="sheet-frame">
  <a class="frame-link" href={view?.href}>
    <picture>
      <source type="image/avif" srcset={view?.avif} sizes={view?.sizes} />
      <img src={view?.src} srcset={view?.webp} sizes={view?.sizes} width={view?.width} height={view?.height} alt={view?.alt ?? ""}
        loading={eager ? "eager" : "lazy"} decoding="async" fetchpriority={priority ? "high" : undefined} />
    </picture>
    <span class="frame-no" aria-hidden="true">{view?.number}</span>
  </a>
</li>
```

Create `src/components/photos/Entry.astro`:

```astro
---
import EntryHead from "./EntryHead.astro";
import Frame from "./Frame.astro";
import { EAGER_FRAMES, frameView, type FrameView } from "../../lib/photos/gallery";
import type { Entry } from "../../lib/photos/store";

interface Props {
  /** null renders the empty entry the photo-sheet script clones */
  entry: Entry | null;
  /** The page's first entry: its first row loads eagerly */
  first?: boolean;
}

const { entry, first = false } = Astro.props;
// Alt text counts published photographs in post order: the entry holds only those (spec 3.2)
const views = entry ? entry.photos.map((photo, index) => frameView(photo, index, entry.photos.length)).filter((view): view is FrameView => view !== null) : [];
---
<li class="entry" id={entry ? `post-${entry.collection}` : undefined}>
  <EntryHead date={entry?.date ?? null} place={entry?.place ?? null} />
  <ol class="sheet">
    {views.map((view, index) => <Frame view={view} eager={first && index < EAGER_FRAMES} priority={first && index === 0} />)}
  </ol>
</li>
```

Create `src/components/photos/Gallery.astro`:

```astro
---
import Row from "../Row.astro";
import Entry from "./Entry.astro";
import type { Entry as EntryData } from "../../lib/photos/store";

interface Props {
  /** null when D1 couldn't be read: the head row says so, and nothing else renders */
  entries: EntryData[] | null;
  /** The next page's cursor, or null at the end */
  next: number | null;
  /** A ?before= page */
  older: boolean;
}

const { entries, next, older } = Astro.props;
---
<main class="book photos">
  <Row label="photos of" head>
    <h1>george vlachos</h1>
    <p class="intro">photos i've taken, one entry per instagram post, newest first.</p>
    <p class="where"><a href="/">back to the logbook</a>{older && <> · <a href="/photos">newest entries</a></>}</p>
    {entries === null && <p class="down">photos aren't loading right now. try again in a bit.</p>}
  </Row>
  {entries !== null && (
    <Row label="entries" id="entries">
      {entries.length === 0 && !older ? (
        <p class="empty">no photos up yet.</p>
      ) : (
        <>
          <ol class="entries">
            {entries.map((entry, index) => <Entry entry={entry} first={index === 0} />)}
          </ol>
          {next !== null ? (
            <a class="more" href={`/photos?before=${next}`} data-next={next}><span class="chev" aria-hidden="true"></span><span class="lbl" aria-live="polite">older entries</span></a>
          ) : (
            <p class="more-end">that's every entry.</p>
          )}
        </>
      )}
    </Row>
  )}
</main>
```

Create `src/styles/photos.css`:

```css
/* The gallery (spec 3): entries like the log's, each a contact sheet of numbered frames */
.entries > .entry + .entry { margin-top: 24px; }
.entry-head { font: 400 12px/1.55 var(--mono); color: var(--ink); letter-spacing: .01em; }
.entry-head time { color: var(--muted); font-variant-numeric: tabular-nums; }
.sheet { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.frame-link { display: block; color: var(--muted); text-decoration: none; }
/* The width and height attributes give the ratio before any byte arrives, so the frame never shifts (spec 3.3) */
.frame-link img { display: block; height: 120px; width: auto; background: #ecebe5; outline: 1px solid transparent; outline-offset: 0; }
.frame-no { display: block; margin-top: 3px; font: 11.5px/1.4 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
@media (hover: hover) and (pointer: fine) {
  .frame-link img { transition: outline-color 200ms ease; }
  .frame-no { transition: color 200ms ease; }
  .frame-link:hover img { outline-color: var(--red); }
  .frame-link:hover .frame-no { color: var(--ink); }
}
.photos a.more { text-decoration: none; }
.more-end { margin-top: 12px; font: 12.5px/1.55 var(--mono); color: var(--muted); }
.down { margin-top: 18px; color: var(--muted); }
@media (max-width: 679px) {
  .frame-link img { height: 88px; }
}
```

Create `src/pages/photos/index.astro`:

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../../layouts/Notebook.astro";
import Beacon from "../../components/Beacon.astro";
import Gallery from "../../components/photos/Gallery.astro";
import { ENTRY_LIMIT, entryPage, type EntryPage } from "../../lib/photos/store";
import "../../styles/photos.css";

const before = Astro.url.searchParams.get("before");
// Anything but a plain count of seconds is the notebook 404 (spec 3.4); a null body makes Astro render 404.astro
if (before !== null && !/^\d{1,10}$/.test(before)) return new Response(null, { status: 404 });

let page: EntryPage | null = null;
try {
  page = await entryPage(env.DB, before === null ? null : Number(before), ENTRY_LIMIT);
} catch (error) {
  console.error("photos: the gallery couldn't read D1", error instanceof Error ? error.message : String(error));
}
if (page) {
  // As the home page (R6.1): fresh for five minutes at the edge, then stale while it refreshes; saves purge the tag
  Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["photos"] });
  Astro.response.headers.set("Cache-Control", "no-cache");
} else {
  // A degraded page is never cached
  Astro.response.status = 503;
  Astro.response.headers.set("Cache-Control", "no-store");
}
---
<Notebook title="photos · george vlachos" description="photos george vlachos has taken, one entry per instagram post." noindex={before !== null}>
  <Gallery entries={page?.entries ?? null} next={page?.next ?? null} older={before !== null} />
  <Beacon />
</Notebook>
```

Create `src/components/Beacon.astro`:

```astro
---
// The first-party analytics beacon (R10), for every page that counts visits. One component, so one script entry: two
// scripts importing beacon.ts would split it into a shared chunk, and a page's inline script would become a file
---
<script>
  import "../scripts/beacon";
</script>
```

In `src/components/Logbook.astro`, add `import Beacon from "./Beacon.astro";` to the imports and replace the script block at the end,

```astro
<script>
  import "../scripts/beacon";
</script>
```

with `<Beacon />`.

Run: `bun run test:unit tests/unit/gallery-page.test.ts`
Expected: PASS.

- [ ] **Step 4: The home page's line**

In `src/lib/logbook.ts`, add to the `Logbook` interface after `records: Track[];`:

```ts
  /** Whether anything is published, for the photos line (spec 3.7) */
  photos: boolean;
```

and in `loadLogbook`, change the batch to:

```ts
  const [items, facts, log, records, photos] = await db.batch([
    db.prepare(
      "SELECT slug, section, text, aside, label_era, label_status, label_made_of, label_text, label_kind, label_note, snapshot_key FROM items ORDER BY section, position",
    ),
    db.prepare("SELECT key, title, subtitle FROM facts ORDER BY CASE key WHEN 'shelf' THEN 0 ELSE 1 END"),
    db.prepare("SELECT id, date, precision, text FROM log_entries ORDER BY date DESC, created_at DESC, id DESC LIMIT ?").bind(LOG_LIMIT),
    db.prepare("SELECT id, title, artist, audio_key, cover_key FROM records WHERE active = 1 ORDER BY position LIMIT ?").bind(RECORD_LIMIT),
    // The same join the gallery uses, so the line never points at an empty gallery
    db.prepare("SELECT EXISTS (SELECT 1 FROM photos JOIN photo_posts ON photo_posts.collection = photos.collection WHERE photos.published = 1) AS any"),
  ]);
```

and add to the returned object after `records: ...`:

```ts
    photos: (photos.results[0] as { any: number } | undefined)?.any === 1,
```

In `src/components/Logbook.astro`, add after the `log` row:

```astro
  {data && data.photos && <Row label="photos" id="photos"><p><a href="/photos">photos</a> i've taken, kept like this log.</p></Row>}
```

Run: `bun run test:unit tests/unit/logbook.test.ts tests/unit/logbook-page.test.ts && bun run typecheck && bun run test:unit`
Expected: PASS; 0 errors; every unit test passes.

- [ ] **Step 5: The e2e specs**

In `playwright.config.ts`, in the `phone` project's `testMatch`, change `admin-layout)\.spec\.ts$/` to `admin-layout|gallery)\.spec\.ts$/`, so the phone runs the gallery spec too.

In `tests/e2e/logbook.spec.ts`, leave `"renders the seeded logbook"` as it is (4331 publishes no fixture photo), add `import { GALLERY } from "./gallery-site";` to its imports and add at the end of the file:

```ts
// The gallery server (4335) has the logbook's seed and published photographs, so its home page has the line
test("the home page points to the photos while one is published", async ({ page }) => {
  await page.goto(`${GALLERY}/`);
  await expect(page.locator(".row > .label")).toHaveText(["logbook of", "now", "lately", "log", "photos", "on the turntable", "before", "say hi", "visitor info"]);
  await expect(page.locator("#photos .body")).toHaveText("photos i've taken, kept like this log.");
  await expect(page.locator("#photos a")).toHaveAttribute("href", "/photos");
});
```

Create `tests/e2e/gallery.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";

// The gallery on the gallery server's photo fixture (spec 11.3), which no spec changes: six posts, newest first, four to a page
test.use({ baseURL: GALLERY });

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the first page lists four entries, newest first, with dated headings and numbered frames", async ({ page }) => {
    const response = await page.goto("/photos");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("no-cache");
    expect(response?.headers()["cache-tag"]).toContain("photos");
    await expect(page).toHaveTitle("photos · george vlachos");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "photos george vlachos has taken, one entry per instagram post.");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://curiousgeorge.dev/photos");
    await expect(page.locator(".row > .label")).toHaveText(["photos of", "entries"]);
    expect(await page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id))).toEqual(["post-fixture", "post-fixture-b", "post-fixture-c", "post-fixture-d"]);
    await expect(page.locator("#post-fixture .entry-head")).toHaveText("27.09.26 · bondi, sydney");
    await expect(page.locator("#post-fixture .entry-head time")).toHaveAttribute("datetime", "2026-09-27");
    await expect(page.locator("#post-fixture-b .entry-head")).toHaveText("14.06.26");
    // fixture-03 is hidden: two frames, each showing its slide number
    await expect(page.locator("#post-fixture .frame-no")).toHaveText(["01", "02"]);
    await expect(page.locator("#post-fixture a.frame-link").first()).toHaveAttribute("href", "/photos/fixture-01");
    await expect(page.locator("#post-fixture img").first()).toHaveAttribute("alt", "a test photograph");
    await expect(page.locator("#post-fixture img").nth(1)).toHaveAttribute("alt", "photo 2 of 2 from 27 september 2026, bondi, sydney");
    await expect(page.locator("#post-fixture-b img").first()).toHaveAttribute("alt", "photo 1 of 2 from 14 june 2026");
  });

  test("frames know their size before any preview arrives: 120px tall, 88px on a phone", async ({ page }) => {
    // Hold every preview, so only the width and height attributes can size the frames
    await page.route((url) => url.pathname.startsWith("/media/photos/"), () => {});
    await page.goto("/photos", { waitUntil: "domcontentloaded" });
    const height = page.viewportSize()!.width < 680 ? 88 : 120;
    const portrait = page.locator("#post-fixture-b img").first(); // 4000 × 6000
    const landscape = page.locator("#post-fixture-b img").nth(1); // 6000 × 4000
    const box = (await portrait.boundingBox())!;
    expect(Math.round(box.height)).toBe(height);
    expect(Math.round(box.width)).toBe(Math.round((height * 2) / 3));
    expect(Math.round((await landscape.boundingBox())!.width)).toBe(Math.round((height * 3) / 2));
    await expect(portrait).toHaveAttribute("sizes", "(max-width: 679px) 59px, 80px");
    await expect(landscape).toHaveAttribute("sizes", "(max-width: 679px) 132px, 180px");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("only the first entry's first row loads eagerly, its first frame with high priority", async ({ page }) => {
    await page.goto("/photos");
    const loading = await page.locator("ol.entries img").evaluateAll((all) => all.map((img) => [img.getAttribute("loading"), img.getAttribute("fetchpriority")]));
    expect(loading).toEqual([["eager", "high"], ["eager", null], ["lazy", null], ["lazy", null], ["lazy", null], ["lazy", null]]);
  });

  test("older entries is a plain link to a noindex page that ends the list", async ({ page }) => {
    await page.goto("/photos");
    const more = page.locator("a.more");
    await expect(more).toHaveText("older entries");
    await expect(more).toHaveAttribute("href", "/photos?before=1766610000");
    await more.click();
    await expect(page).toHaveURL(/\/photos\?before=1766610000$/);
    expect(await page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id))).toEqual(["post-fixture-e", "post-fixture-f"]);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "newest entries" })).toHaveAttribute("href", "/photos");
  });

  test("a cursor older than every post says that's every entry; a malformed one is the notebook 404", async ({ page }) => {
    const response = await page.goto("/photos?before=1");
    expect(response?.status()).toBe(200);
    await expect(page.locator("ol.entries > li")).toHaveCount(0);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator(".empty")).toHaveCount(0);
    for (const cursor of ["abc", "-1", "12345678901", "1.5"]) {
      const refused = await page.goto(`/photos?before=${cursor}`);
      expect(refused?.status()).toBe(404);
      expect(refused?.headers()["cache-control"]).toBe("no-store");
      await expect(page.locator("main")).toContainText("nothing written on this page.");
    }
  });
});

test("when D1 fails the gallery says so with a 503 that is never cached", async ({ page }) => {
  const response = await page.goto("http://localhost:4332/photos");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["cache-tag"]).toBeUndefined();
  await expect(page.locator(".down")).toHaveText("photos aren't loading right now. try again in a bit.");
});

test("the gallery works under the CSP, with every script inline", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto("/photos", { waitUntil: "networkidle" });
  await expect(page.locator("script[src]")).toHaveCount(0);
  expect(violations).toEqual([]);
});
```

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/gallery.spec.ts tests/e2e/logbook.spec.ts`
Expected: every test passes in chromium, webkit and phone.

Run: `bun run test:e2e tests/e2e/degraded.spec.ts tests/e2e/routes.spec.ts tests/e2e/budgets.spec.ts tests/e2e/analytics.spec.ts --project=chromium`
Expected: every test passes: the home page with its new line stays inside its budgets, and its beacon still counts.

Run: `grep -rl "ingest/i/v0/e" dist/client/_astro/ || echo "the beacon is inline"`
Expected: `the beacon is inline`: no client file holds the beacon, so `Beacon.astro`'s script is inlined into every page that uses it.

Look at it (Global constraints, visual checks) at `http://localhost:4336/photos`, saved as `"$TMPDIR/photos"`: the red rule and margin labels as on the home page, frames in rows with 6px gaps and their numbers under them, portrait and landscape frames the same height, entries 24px apart, the chevron before `older entries`, nothing wider than the page at 375px. Hover a frame at 1280px (open the page in a browser): a 1px red outline and the number turning ink, no movement.

- [ ] **Step 6: Commit**

```bash
git add src/lib/photos/gallery.ts src/components/Beacon.astro src/components/photos/EntryHead.astro src/components/photos/Frame.astro src/components/photos/Entry.astro src/components/photos/Gallery.astro src/pages/photos/index.astro src/styles/photos.css src/lib/logbook.ts src/components/Logbook.astro playwright.config.ts tests/unit/gallery.test.ts tests/unit/gallery-page.test.ts tests/unit/logbook.test.ts tests/unit/logbook-page.test.ts tests/e2e/gallery.spec.ts tests/e2e/logbook.spec.ts
git commit -m "feat: /photos, dated entries of contact-sheet frames, and the home page's line to it"
```

---
### Task 8: older entries load as the visitor nears the end

With JavaScript, `src/scripts/photo-sheet.ts` (inline, no runtime imports) watches `older entries` with an `IntersectionObserver` 800px below the viewport, fetches the next four entries from the entry mode and appends them by cloning `<template>`s the server renders from the same `Entry` and `Frame` components (spec 3.4). One fetch at a time; while it loads the link reads `loading older entries…` and is `aria-disabled`; on failure it goes back to `older entries` and the observer stops, so a click follows the plain link. Focus never moves; the URL never changes.

**Files:**
- Create: `src/scripts/photo-sheet.ts`
- Modify: `src/components/photos/Gallery.astro` (whole file below), `src/pages/photos/index.astro`
- Test: `tests/e2e/gallery.spec.ts`

**Interfaces:**
- Consumes: `frameView`, `FrameView` from `src/lib/photos/gallery.ts` and `Entry.astro`, `Frame.astro` with `null` props (Task 7); `formatLogDate` from `src/lib/text.ts`; `GET /api/photos?by=entry&before=<n>&limit=4` answering `{ entries: { collection, date, place, photos }[], next }` (Task 1).
- Produces: `<template id="entry-template">` and `<template id="frame-template">` on any gallery page that has a next page.

- [ ] **Step 1: Write the failing e2e tests**

Add to the end of `tests/e2e/gallery.spec.ts`:

```ts
test.describe("with JavaScript", () => {
  const entryIds = (page: import("@playwright/test").Page) => page.locator("ol.entries > li.entry").evaluateAll((all) => all.map((li) => li.id));
  const toBottom = (page: import("@playwright/test").Page) => page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  test("nearing the end loads the next entries in place once and ends the list", async ({ page }) => {
    const queries: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/photos") queries.push(url.search);
    });
    await page.goto("/photos");
    await toBottom(page);
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    expect(await entryIds(page)).toEqual(["post-fixture", "post-fixture-b", "post-fixture-c", "post-fixture-d", "post-fixture-e", "post-fixture-f"]);
    await expect(page.locator(".more-end")).toHaveText("that's every entry.");
    await expect(page.locator("a.more")).toHaveCount(0);
    expect(queries).toEqual(["?by=entry&before=1766610000&limit=4"]);
    await expect(page).toHaveURL(/\/photos$/);
    await expect(page.locator("#post-fixture-f .entry-head")).toHaveText("02.02.25 · valletta, malta");
    await expect(page.locator("#post-fixture-f img")).toHaveAttribute("loading", "lazy");
    await expect(page.locator("#post-fixture-f img")).toHaveAttribute("alt", "photo 1 of 1 from 2 february 2025, valletta, malta");
    await expect(page.locator("#post-fixture-f a.frame-link")).toHaveAttribute("href", "/photos/fixture-f-01");
    await expect(page.locator("#post-fixture-f .frame-no")).toHaveText("01");
  });

  test("while a batch loads the link says so and can't be followed, and focus stays where it was", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    await page.route((url) => url.pathname === "/api/photos", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/photos");
    await page.locator("a.frame-link").first().focus();
    await toBottom(page);
    const more = page.locator("a.more");
    await expect(more).toHaveText("loading older entries…");
    await expect(more).toHaveAttribute("aria-disabled", "true");
    // force: Playwright waits for an aria-disabled link to be enabled; a visitor's click arrives regardless
    await more.click({ force: true });
    await expect(page).toHaveURL(/\/photos$/);
    release();
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("href"))).toBe("/photos/fixture-01");
  });

  test("an appended entry has exactly the server's markup for the same post", async ({ page, browser, baseURL }) => {
    // Tag names, sorted attributes and leaf text: attribute order differs between a clone and a parse, nothing else may
    const shape = (root: Element) => {
      const walk = (el: Element): unknown => [el.tagName.toLowerCase(), [...el.attributes].map((a) => `${a.name}=${a.value}`).sort(), el.children.length > 0 ? [...el.children].map(walk) : el.textContent];
      return JSON.stringify(walk(root));
    };
    const plain = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const server = await plain.newPage();
    // fixture-f is the second entry there, so lazy like an appended one
    await server.goto("/photos?before=1766610000");
    const rendered = await server.locator("#post-fixture-f").evaluate(shape);
    await plain.close();
    await page.goto("/photos");
    await toBottom(page);
    await expect(page.locator("#post-fixture-f")).toHaveCount(1);
    expect(await page.locator("#post-fixture-f").evaluate(shape)).toBe(rendered);
  });

  test("when a batch fails the link is a plain link again, and nothing more is fetched", async ({ page }) => {
    let calls = 0;
    await page.route((url) => url.pathname === "/api/photos", (route) => {
      calls++;
      return route.abort();
    });
    await page.goto("/photos");
    await toBottom(page);
    await expect.poll(() => calls).toBe(1);
    const more = page.locator("a.more");
    await expect(more).toHaveText("older entries");
    await expect(more).not.toHaveAttribute("aria-disabled");
    await page.evaluate(() => window.scrollTo(0, 0));
    await toBottom(page);
    await page.waitForTimeout(300);
    expect(calls).toBe(1);
    await more.click();
    await expect(page).toHaveURL(/\/photos\?before=1766610000$/);
    expect(await entryIds(page)).toEqual(["post-fixture-e", "post-fixture-f"]);
  });
});
```

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/gallery.spec.ts --project=chromium --grep "with JavaScript"`
Expected: FAIL: nothing loads (four entries remain) and no request goes to `/api/photos`.

- [ ] **Step 2: The templates and the script**

Replace `src/components/photos/Gallery.astro` with:

```astro
---
import Row from "../Row.astro";
import Entry from "./Entry.astro";
import Frame from "./Frame.astro";
import type { Entry as EntryData } from "../../lib/photos/store";

interface Props {
  /** null when D1 couldn't be read: the head row says so, and nothing else renders */
  entries: EntryData[] | null;
  /** The next page's cursor, or null at the end */
  next: number | null;
  /** A ?before= page */
  older: boolean;
}

const { entries, next, older } = Astro.props;
---
<main class="book photos">
  <Row label="photos of" head>
    <h1>george vlachos</h1>
    <p class="intro">photos i've taken, one entry per instagram post, newest first.</p>
    <p class="where"><a href="/">back to the logbook</a>{older && <> · <a href="/photos">newest entries</a></>}</p>
    {entries === null && <p class="down">photos aren't loading right now. try again in a bit.</p>}
  </Row>
  {entries !== null && (
    <Row label="entries" id="entries">
      {entries.length === 0 && !older ? (
        <p class="empty">no photos up yet.</p>
      ) : (
        <>
          <ol class="entries">
            {entries.map((entry, index) => <Entry entry={entry} first={index === 0} />)}
          </ol>
          {next !== null ? (
            <>
              <a class="more" href={`/photos?before=${next}`} data-next={next}><span class="chev" aria-hidden="true"></span><span class="lbl" aria-live="polite">older entries</span></a>
              {/* The same components, empty: photo-sheet.ts clones these, so an entry's markup lives in one place (spec 3.4) */}
              <template id="entry-template"><Entry entry={null} /></template>
              <template id="frame-template"><Frame view={null} /></template>
            </>
          ) : (
            <p class="more-end">that's every entry.</p>
          )}
        </>
      )}
    </Row>
  )}
</main>
```

Create `src/scripts/photo-sheet.ts`:

```ts
import { frameView, type FrameView } from "../lib/photos/gallery";
import type { Entry } from "../lib/photos/store";
import { formatLogDate } from "../lib/text";

// Older entries, appended as the visitor nears the end of the list (spec 3.4). Without this script, or once a batch
// fails, "older entries" is a plain link. One fetch at a time; focus never moves; the URL never changes.

type ApiEntry = Omit<Entry, "publishedAt">;

function start(more: HTMLAnchorElement, list: HTMLOListElement, entryTemplate: HTMLTemplateElement, frameTemplate: HTMLTemplateElement) {
  const label = more.querySelector(".lbl")!;
  let busy = false;

  const frame = (view: FrameView) => {
    const node = frameTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    node.querySelector("a")!.href = view.href;
    // sizes before srcset and src, so the browser never picks a candidate for the wrong width
    const source = node.querySelector("source")!;
    source.sizes = view.sizes;
    source.srcset = view.avif;
    const img = node.querySelector("img")!;
    img.width = view.width;
    img.height = view.height;
    img.alt = view.alt;
    img.sizes = view.sizes;
    img.srcset = view.webp;
    img.src = view.src;
    node.querySelector(".frame-no")!.textContent = view.number;
    return node;
  };

  const entry = (data: ApiEntry) => {
    const node = entryTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    node.id = `post-${data.collection}`;
    const time = node.querySelector("time")!;
    time.dateTime = data.date;
    time.textContent = formatLogDate(data.date, "day");
    node.querySelector(".entry-place")!.textContent = data.place ? ` · ${data.place}` : "";
    const sheet = node.querySelector(".sheet")!;
    data.photos.forEach((photo, index) => {
      const view = frameView(photo, index, data.photos.length);
      if (view) sheet.append(frame(view));
    });
    return node;
  };

  const settle = () => {
    label.textContent = "older entries";
    more.removeAttribute("aria-disabled");
    busy = false;
  };

  const load = async () => {
    if (busy) return;
    busy = true;
    label.textContent = "loading older entries…";
    more.setAttribute("aria-disabled", "true");
    try {
      const response = await fetch(`/api/photos?by=entry&before=${more.dataset.next}&limit=4`);
      if (!response.ok) throw new Error(`the gallery answered ${response.status}`);
      const page = (await response.json()) as { entries: ApiEntry[]; next: number | null };
      for (const data of page.entries) list.append(entry(data));
      if (page.next === null) {
        observer.disconnect();
        const end = document.createElement("p");
        end.className = "more-end";
        end.textContent = "that's every entry.";
        // Focus never moves (spec 3.4): if the link had it, the line that takes its place keeps it
        const focused = document.activeElement === more;
        if (focused) end.tabIndex = -1;
        more.replaceWith(end);
        if (focused) end.focus({ preventScroll: true });
        return;
      }
      more.href = `/photos?before=${page.next}`;
      more.dataset.next = String(page.next);
      settle();
      // A short batch can leave the link still near the end; the observer only calls back on a change, so ask again
      observer.unobserve(more);
      observer.observe(more);
    } catch {
      // Back to a plain link a click follows, and no more fetching
      observer.disconnect();
      settle();
    }
  };

  const observer = new IntersectionObserver((records) => {
    if (records.some((record) => record.isIntersecting)) void load();
  }, { rootMargin: "0px 0px 800px 0px" });
  // A click while a batch loads would fetch the same entries a second way
  more.addEventListener("click", (event) => {
    if (busy) event.preventDefault();
  });
  observer.observe(more);
}

const more = document.querySelector<HTMLAnchorElement>("a.more[data-next]");
const list = document.querySelector<HTMLOListElement>("ol.entries");
const entryTemplate = document.querySelector<HTMLTemplateElement>("#entry-template");
const frameTemplate = document.querySelector<HTMLTemplateElement>("#frame-template");
if (more && list && entryTemplate && frameTemplate && "IntersectionObserver" in window) start(more, list, entryTemplate, frameTemplate);
```

In `src/pages/photos/index.astro`, add after `<Beacon />`:

```astro
  <script>
    // Its own entry: it shares no module with any other script, so the build inlines it
    import "../../scripts/photo-sheet";
  </script>
```

Run: `bun run typecheck && pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/gallery.spec.ts`
Expected: 0 errors; every gallery test passes in chromium, webkit and phone, the four new ones among them, and `the gallery works under the CSP, with every script inline` still finds no `script[src]`.

Run: `bun run test:e2e tests/e2e/admin-photos.spec.ts tests/e2e/photos.spec.ts --project=chromium`
Expected: every test passes.

Run: `grep -rlE "ingest/i/v0/e|loading older entries" dist/client/_astro/ || echo "every script is inline"`
Expected: `every script is inline`: neither the beacon nor `photo-sheet.ts` became a separate file.

Look at it (Global constraints, visual checks) at `http://localhost:4336/photos`, then scroll a real browser to the end at 1280px and 375px: the label changes for a moment, the two older entries appear below the first four with the same spacing and frame sizes and `that's every entry.` replaces the link. Nothing above the link moves.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/photo-sheet.ts src/components/photos/Gallery.astro src/pages/photos/index.astro tests/e2e/gallery.spec.ts
git commit -m "feat: older gallery entries load in place as the visitor nears the end"
```

---

### Task 9: one photograph, /photos/<id>

A shareable page for one published photograph (spec 4): the picture (960 and 1600 previews, sized per photograph so a tall portrait fits the viewport), its title or date and place as the `<h1>`, `photo 2 of 14 · ‹ previous · next ›` across the post's published photographs, `the whole entry` back to the gallery at its post and `say hi`. An unpublished or unknown id is the notebook 404. `Notebook.astro` gains the `ogImage` and `referrer` props (spec 2.2) the page and the downloads page need. A photograph's name, which plan B uses in line items, lands here too.

**Files:**
- Create: `src/components/photos/PhotoView.astro`, `src/pages/photos/[id].astro`, `tests/unit/photo-view.test.ts`, `tests/unit/notebook.test.ts`, `tests/e2e/photo-page.spec.ts`
- Modify: `src/lib/photos/gallery.ts`, `src/lib/photos/store.ts`, `src/layouts/Notebook.astro` (whole file below), `src/styles/photos.css`, `playwright.config.ts`, `tests/e2e/admin-photos.spec.ts`
- Test: `tests/unit/photo-view.test.ts`, `tests/unit/notebook.test.ts`, `tests/unit/gallery.test.ts`, `tests/unit/photo-entries.test.ts`, `tests/e2e/photo-page.spec.ts`, `tests/e2e/admin-photos.spec.ts`

**Interfaces:**
- Consumes: `PUBLIC` query, `publicPhoto`, `PublicPhotoRow`, `PublicPhoto` in `src/lib/photos/store.ts` (Task 1); `dateAndPlace`, `longDate`, `photoAlt`, `previewOf`, `srcsetOf` (Task 7); `SayHi.astro`, `Row.astro`.
- Produces:
  - `src/lib/photos/store.ts`: `interface PhotoPage { photo: PublicPhoto; publishedAt: number; index: number; total: number; previous: string | null; next: string | null }`; `photoPageData(db, id): Promise<PhotoPage | null>` (the photo with only its 960 and 1600 previews; neighbours among the post's published photographs)
  - `src/lib/photos/gallery.ts`: `photoSizes(width, height): string`; `photoName(photo, index, total): string` (`"title"` or `photo 2 of 14 from 02.02.25`)
  - `Notebook.astro` props: `ogImage?: { url: string; width: number; height: number }` (absolute), `referrer?: "no-referrer"`
  - `PhotoView.astro` props `{ page: PhotoPage }`

- [ ] **Step 1: Write the failing unit tests**

Add to `tests/unit/photo-entries.test.ts` (and add `photoPageData` to its store import):

```ts
describe("photoPageData", () => {
  test("gives a published photo with only its 960 and 1600 previews, and its place among the post's published photos", async () => {
    const page = (await photoPageData(db, "middle-03"))!;
    expect(page).toMatchObject({ index: 1, total: 2, previous: "middle-01", next: null, publishedAt: Date.parse("2025-08-09T16:45:00+10:00") / 1000 });
    expect(page.photo).toMatchObject({ id: "middle-03", date: "2025-08-09", place: null });
    expect(page.photo.previews.map((p) => p.url.split("/").at(-1))).toEqual(["960.webp", "960.avif", "1600.webp", "1600.avif"]);
    expect(await photoPageData(db, "middle-01")).toMatchObject({ index: 0, total: 2, previous: null, next: "middle-03" });
  });

  test("a hidden, unknown, malformed or orphaned photo has no page", async () => {
    await photo("orphan-01", "orphan", true);
    for (const id of ["middle-02", "nobody-01", "../x", "orphan-01"]) expect(await photoPageData(db, id)).toBeNull();
  });
});
```

Add to `tests/unit/gallery.test.ts` (and add `photoName` and `photoSizes` to its import):

```ts
describe("the photo page", () => {
  test("sizes follow the photograph's ratio under the 82svh cap", () => {
    expect(photoSizes(4000, 6000)).toBe("(max-width: 679px) min(calc(100vw - 48px), calc(82svh * 0.6667)), min(710px, calc(82svh * 0.6667))");
    expect(photoSizes(6000, 4000)).toBe("(max-width: 679px) min(calc(100vw - 48px), calc(82svh * 1.5)), min(710px, calc(82svh * 1.5))");
  });

  test("a photograph's name is its title in quotes, or which photo of the post it is", () => {
    expect(photoName(portrait({ title: "the long jetty" }), 0, 1)).toBe('"the long jetty"');
    expect(photoName(portrait(), 1, 14)).toBe("photo 2 of 14 from 02.02.25");
  });
});
```

Create `tests/unit/photo-view.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import PhotoView from "../../src/components/photos/PhotoView.astro";
import type { PhotoPage, PublicPhoto } from "../../src/lib/photos/store";
import { render, text } from "./render";

const photo = (over: Partial<PublicPhoto> = {}): PublicPhoto => ({
  id: "DFkL1xrsnOH-02", collection: "DFkL1xrsnOH", title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2025-02-02", place: "bondi, sydney",
  previews: [960, 1600].flatMap((size) => (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/DFkL1xrsnOH-02/s/${size}.${format}`, width: Math.round((size * 2) / 3), height: size, format }))),
  ...over,
});
const page = (over: Partial<PhotoPage> = {}): PhotoPage => ({ photo: photo(), publishedAt: 1738488468, index: 1, total: 14, previous: "DFkL1xrsnOH-01", next: "DFkL1xrsnOH-03", ...over });

describe("PhotoView", () => {
  test("an untitled photo is headed by its date and place, and walks its post", async () => {
    const doc = await render(PhotoView, { page: page() });
    expect([...doc.querySelectorAll(".row > .label")].map(text)).toEqual(["photo", "say hi"]);
    expect(text(doc.querySelector("h1"))).toBe("02.02.25 · bondi, sydney");
    expect(doc.querySelector(".where")).toBeNull();
    expect(text(doc.querySelector(".photo-nav"))).toBe("photo 2 of 14 · previous · next · the whole entry");
    expect(doc.querySelector('a[rel="prev"]')!.getAttribute("href")).toBe("/photos/DFkL1xrsnOH-01");
    expect(doc.querySelector('a[rel="next"]')!.getAttribute("href")).toBe("/photos/DFkL1xrsnOH-03");
    expect([...doc.querySelectorAll(".photo-nav a")].at(-1)!.getAttribute("href")).toBe("/photos?before=1738488469#post-DFkL1xrsnOH");
  });

  test("the picture is eager and high priority, sized by the 1600 preview and its ratio", async () => {
    const doc = await render(PhotoView, { page: page() });
    const img = doc.querySelector(".photo img")!;
    expect(["alt", "width", "height", "loading", "fetchpriority", "src"].map((name) => img.getAttribute(name))).toEqual([
      "photo 2 of 14 from 2 february 2025, bondi, sydney", "1067", "1600", "eager", "high", "/media/photos/previews/DFkL1xrsnOH-02/s/960.webp",
    ]);
    expect(img.getAttribute("sizes")).toBe("(max-width: 679px) min(calc(100vw - 48px), calc(82svh * 0.6667)), min(710px, calc(82svh * 0.6667))");
    expect(img.getAttribute("srcset")).toBe("/media/photos/previews/DFkL1xrsnOH-02/s/960.webp 640w, /media/photos/previews/DFkL1xrsnOH-02/s/1600.webp 1067w");
    expect(doc.querySelector(".photo source")!.getAttribute("type")).toBe("image/avif");
  });

  test("a titled photo leads with its title, with the date and place under it; the ends of a post have one neighbour", async () => {
    const doc = await render(PhotoView, { page: page({ photo: photo({ title: "the long jetty" }), index: 0, total: 2, previous: null, next: "DFkL1xrsnOH-03" }) });
    expect(text(doc.querySelector("h1"))).toBe("the long jetty");
    expect(text(doc.querySelector(".where"))).toBe("02.02.25 · bondi, sydney");
    expect(text(doc.querySelector(".photo-nav"))).toBe("photo 1 of 2 · next · the whole entry");
    expect(doc.querySelector('a[rel="prev"]')).toBeNull();
  });

  test("a title is text, never markup", async () => {
    const doc = await render(PhotoView, { page: page({ photo: photo({ title: '<b>dawn</b> & "co"' }) }) });
    expect(text(doc.querySelector("h1"))).toBe('<b>dawn</b> & "co"');
    expect(doc.querySelector("h1 b")).toBeNull();
    expect(doc.querySelector(".photo img")!.getAttribute("alt")).toBe('<b>dawn</b> & "co"');
  });
});
```

Create `tests/unit/notebook.test.ts`:

```ts
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import { expect, test } from "vitest";
import Notebook from "../../src/layouts/Notebook.astro";

// The layout renders a whole document, so it is parsed as one rather than inside render()'s body
async function page(props: Record<string, unknown>) {
  const container = await AstroContainer.create();
  return parseHTML(await container.renderToString(Notebook, { props, slots: { default: "<main>hi</main>" } })).document;
}
const meta = (doc: Document, selector: string) => doc.querySelector(selector)?.getAttribute("content") ?? null;

test("pages share /og.png unless they bring their own image, absolute and with its size", async () => {
  let doc = await page({});
  expect([meta(doc, 'meta[property="og:image"]'), meta(doc, 'meta[property="og:image:width"]'), meta(doc, 'meta[property="og:image:height"]')]).toEqual(["https://curiousgeorge.dev/og.png", "1200", "630"]);
  doc = await page({ ogImage: { url: "https://curiousgeorge.dev/media/photos/previews/x-01/s/1600.webp", width: 1067, height: 1600 } });
  expect([meta(doc, 'meta[property="og:image"]'), meta(doc, 'meta[property="og:image:width"]'), meta(doc, 'meta[property="og:image:height"]')]).toEqual([
    "https://curiousgeorge.dev/media/photos/previews/x-01/s/1600.webp", "1067", "1600",
  ]);
});

test("a referrer policy is the head's second tag (before anything is fetched) and absent otherwise", async () => {
  let doc = await page({ referrer: "no-referrer", noindex: true });
  expect(meta(doc, 'meta[name="referrer"]')).toBe("no-referrer");
  expect(doc.head.children[1].getAttribute("name")).toBe("referrer");
  expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
  doc = await page({});
  expect(doc.querySelector('meta[name="referrer"]')).toBeNull();
});

test("a title with markup stays text", async () => {
  const doc = await page({ title: '<b>dawn</b> & "co" · photos · george vlachos' });
  expect(doc.querySelector("title")!.textContent).toBe('<b>dawn</b> & "co" · photos · george vlachos');
  expect(doc.querySelector("head b")).toBeNull();
  expect(meta(doc, 'meta[property="og:title"]')).toBe('<b>dawn</b> & "co" · photos · george vlachos');
});
```

Run: `bun run test:unit tests/unit/photo-entries.test.ts tests/unit/gallery.test.ts tests/unit/photo-view.test.ts tests/unit/notebook.test.ts`
Expected: FAIL: `photoPageData`, `photoSizes`, `photoName` and `PhotoView.astro` don't exist, and Notebook has no `ogImage` or `referrer`. `"a title with markup stays text"` already passes (Astro escapes `<title>`); it stays as a guard.

- [ ] **Step 2: The data, the names and the layout's props**

In `src/lib/photos/store.ts`, add after `entryPage`:

```ts
/** One photograph's page (spec 4): the photograph, and where it sits among its post's published photographs */
export interface PhotoPage {
  photo: PublicPhoto;
  /** The post's time, for the link back to its entry */
  publishedAt: number;
  index: number;
  total: number;
  previous: string | null;
  next: string | null;
}

/** A published photograph with only its 960 and 1600 previews, and its neighbours; null for anything else */
export async function photoPageData(db: D1Database, id: string): Promise<PhotoPage | null> {
  if (!PHOTO_ID.test(id)) return null;
  const [found, siblings] = await db.batch([
    db.prepare(`${PUBLIC} WHERE photos.id = ? AND photos.published = 1`).bind(id),
    db.prepare("SELECT id FROM photos WHERE published = 1 AND collection = (SELECT collection FROM photos WHERE id = ?) ORDER BY position").bind(id),
  ]);
  const row = (found.results as unknown as PublicPhotoRow[])[0];
  if (!row) return null;
  const ids = (siblings.results as unknown as { id: string }[]).map((sibling) => sibling.id);
  const index = ids.indexOf(id);
  return { photo: publicPhoto(row, [960, 1600]), publishedAt: row.published_at, index, total: ids.length, previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
}
```

In `src/lib/photos/gallery.ts`, add at the end:

```ts
/**
 * The photo page's sizes (spec 4). The picture is capped at 82svh, which narrows a portrait, so its width follows its
 * ratio: a 2:3 portrait on a 900px-tall laptop is about 492px wide and fetches the 960, not the 1600.
 */
export function photoSizes(width: number, height: number): string {
  const ratio = Number((width / height).toFixed(4));
  return `(max-width: 679px) min(calc(100vw - 48px), calc(82svh * ${ratio})), min(710px, calc(82svh * ${ratio}))`;
}

/** How one photograph is named in a line of text (spec 4; plan B's checkout, order page and emails): its title in quotes, or photo 2 of 14 from 02.02.25 */
export function photoName(photo: Pick<PublicPhoto, "title" | "date">, index: number, total: number): string {
  return photo.title ? `"${photo.title}"` : `photo ${index + 1} of ${total} from ${formatLogDate(photo.date, "day")}`;
}
```

Replace `src/layouts/Notebook.astro` with:

```astro
---
import "../styles/notebook.css";

interface Props {
  title?: string;
  description?: string;
  /** For pages that should not be indexed (the 404, a gallery page past the first, the downloads page): no canonical, robots noindex */
  noindex?: boolean;
  /** The page's own share image, absolute, with its real size (a photograph's page); every other page shares /og.png */
  ogImage?: { url: string; width: number; height: number };
  /** A referrer policy for everything the page fetches and links to (the downloads page sends none, spec 5.2) */
  referrer?: "no-referrer";
}

const {
  title = "george vlachos",
  description = "i build software that does the hard part, so people can get back to the human part.",
  noindex = false,
  ogImage = { url: "https://curiousgeorge.dev/og.png", width: 1200, height: 630 },
  referrer,
} = Astro.props;
const canonical = new URL(Astro.url.pathname, "https://curiousgeorge.dev").href;
---
<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    {referrer && <meta name="referrer" content={referrer} />}
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
    <meta property="og:image" content={ogImage.url} />
    <meta property="og:image:width" content={String(ogImage.width)} />
    <meta property="og:image:height" content={String(ogImage.height)} />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <slot />
  </body>
</html>
```

Run: `bun run test:unit tests/unit/photo-entries.test.ts tests/unit/gallery.test.ts tests/unit/notebook.test.ts`
Expected: PASS.

- [ ] **Step 3: The page**

Create `src/components/photos/PhotoView.astro`:

```astro
---
import Row from "../Row.astro";
import SayHi from "../SayHi.astro";
import { dateAndPlace, photoAlt, photoSizes, previewOf, srcsetOf } from "../../lib/photos/gallery";
import type { PhotoPage } from "../../lib/photos/store";

interface Props {
  page: PhotoPage;
}

const { photo, index, total, previous, next, publishedAt } = Astro.props.page;
const large = previewOf(photo, 1600, "webp");
const medium = previewOf(photo, 960, "webp");
const line = dateAndPlace(photo.date, photo.place);
const sizes = photoSizes(photo.width, photo.height);
---
<main class="book photo-page">
  <Row label="photo" head>
    {/* width and height from the 1600, so the box is known before the image loads; no zoom, the 1600 is the largest the site serves (spec 4) */}
    <picture class="photo">
      <source type="image/avif" srcset={srcsetOf(photo, [960, 1600], "avif")} sizes={sizes} />
      <img src={medium?.url} srcset={srcsetOf(photo, [960, 1600], "webp")} sizes={sizes} width={large?.width} height={large?.height}
        alt={photoAlt(photo, index, total)} loading="eager" fetchpriority="high" decoding="async" />
    </picture>
    <h1>{photo.title || line}</h1>
    {photo.title && <p class="where">{line}</p>}
    <p class="photo-nav">photo {index + 1} of {total}{previous && <> · <a href={`/photos/${previous}`} rel="prev"><span class="chev back" aria-hidden="true"></span>previous</a></>}{next && <> · <a href={`/photos/${next}`} rel="next">next<span class="chev ahead" aria-hidden="true"></span></a></>} · <a href={`/photos?before=${publishedAt + 1}#post-${photo.collection}`}>the whole entry</a></p>
  </Row>
  <Row label="say hi" id="say-hi"><SayHi /></Row>
</main>
```

Create `src/pages/photos/[id].astro`:

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../../layouts/Notebook.astro";
import Beacon from "../../components/Beacon.astro";
import Row from "../../components/Row.astro";
import PhotoView from "../../components/photos/PhotoView.astro";
import { dateAndPlace, longDate, previewOf } from "../../lib/photos/gallery";
import { photoPageData, type PhotoPage } from "../../lib/photos/store";
import "../../styles/photos.css";

let page: PhotoPage | null = null;
let down = false;
try {
  page = await photoPageData(env.DB, Astro.params.id ?? "");
} catch (error) {
  down = true;
  console.error("photos: a photo page couldn't read D1", error instanceof Error ? error.message : String(error));
}
// Unpublished or unknown: the notebook 404, uncached (spec 4)
if (!down && !page) return new Response(null, { status: 404 });
if (page) {
  Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["photos"] });
  Astro.response.headers.set("Cache-Control", "no-cache");
} else {
  Astro.response.status = 503;
  Astro.response.headers.set("Cache-Control", "no-store");
}
const heading = page ? page.photo.title || dateAndPlace(page.photo.date, page.photo.place) : null;
const share = page ? previewOf(page.photo, 1600, "webp") : undefined;
// "from", because the date is the post's, not the shutter's (spec 4). Known gap: a few link previews don't read WebP
const description = page ? `a photo by george vlachos from ${longDate(page.photo.date)}${page.photo.place ? `, ${page.photo.place}` : ""}.` : undefined;
---
<Notebook
  title={heading ? `${heading} · photos · george vlachos` : "photos · george vlachos"}
  description={description}
  noindex={!page}
  ogImage={share ? { url: new URL(share.url, "https://curiousgeorge.dev").href, width: share.width, height: share.height } : undefined}
>
  {page ? (
    <PhotoView page={page} />
  ) : (
    <main class="book photo-page">
      <Row label="photo" head>
        <p class="down">photos aren't loading right now. try again in a bit.</p>
        <p class="home"><a href="/photos">the photos</a></p>
      </Row>
    </main>
  )}
  <Beacon />
</Notebook>
```

In `src/styles/photos.css`, add before the `@media (max-width: 679px)` block:

```css
/* One photograph (spec 4): the box is known before the image loads, and a tall portrait fits the viewport, letterboxed on paper */
.photo-page .photo img { display: block; width: 100%; height: auto; max-height: 82svh; object-fit: contain; }
.photo-page h1 { margin-top: 20px; }
.photo-page .where { margin-top: 8px; }
.photo-nav { margin-top: 14px; font: 12.5px/1.55 var(--mono); color: var(--muted); }
/* Drawn chevrons, as the log's: DM Mono has no arrow glyphs */
.photo-nav .chev { display: inline-block; width: 6px; height: 6px; border: solid currentColor; border-width: 0 0 1px 1px; transform: translateY(-1px) rotate(45deg); margin: 0 6px 0 2px; }
.photo-nav .chev.ahead { transform: translateY(-1px) rotate(-135deg); margin: 0 2px 0 6px; }
```

Run: `bun run test:unit tests/unit/photo-view.test.ts && bun run typecheck && bun run test:unit`
Expected: PASS; 0 errors; every unit test passes.

- [ ] **Step 4: The e2e specs**

In `playwright.config.ts`, in the `phone` project's `testMatch`, change `admin-layout|gallery)\.spec\.ts$/` to `admin-layout|gallery|photo-page)\.spec\.ts$/`.

Create `tests/e2e/photo-page.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";

// The gallery server's photo fixture: fixture-01 (titled) and fixture-02 are published, fixture-03 is hidden
test.use({ baseURL: GALLERY });

test("an untitled photo's page is headed by its date and place, and walks its post's published photos", async ({ page }) => {
  const response = await page.goto("/photos/fixture-02");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-cache");
  expect(response?.headers()["cache-tag"]).toContain("photos");
  await expect(page).toHaveTitle("27.09.26 · bondi, sydney · photos · george vlachos");
  await expect(page.locator("h1")).toHaveText("27.09.26 · bondi, sydney");
  await expect(page.locator(".photo-nav")).toHaveText("photo 2 of 2 · previous · the whole entry");
  await expect(page.getByRole("link", { name: "previous" })).toHaveAttribute("href", "/photos/fixture-01");
  await expect(page.getByRole("link", { name: "next", exact: true })).toHaveCount(0);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "a photo by george vlachos from 27 september 2026, bondi, sydney.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://curiousgeorge.dev/photos/fixture-02");
  const img = page.locator(".photo img");
  await expect(img).toHaveAttribute("alt", "photo 2 of 2 from 27 september 2026, bondi, sydney");
  await expect(img).toHaveAttribute("fetchpriority", "high");
  await expect(img).toHaveAttribute("width", "1600");
  await expect(img).toHaveAttribute("height", "1600");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\/curiousgeorge\.dev\/media\/photos\/previews\/fixture-02\/[a-f0-9]{64}\/1600\.webp$/);
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1600");
  await expect(page.locator("#say-hi")).toBeVisible();
});

test("a titled photo leads with its title, with its date and place under it", async ({ page }) => {
  await page.goto("/photos/fixture-01");
  await expect(page).toHaveTitle("a test photograph · photos · george vlachos");
  await expect(page.locator("h1")).toHaveText("a test photograph");
  await expect(page.locator(".photo-page .where")).toHaveText("27.09.26 · bondi, sydney");
  await expect(page.locator(".photo-nav")).toHaveText("photo 1 of 2 · next · the whole entry");
  await expect(page.getByRole("link", { name: "next", exact: true })).toHaveAttribute("href", "/photos/fixture-02");
  await expect(page.locator(".photo img")).toHaveAttribute("alt", "a test photograph");
});

test("a portrait fits the viewport, its box known before it loads", async ({ page }) => {
  await page.route((url) => url.pathname.startsWith("/media/photos/"), () => {});
  await page.goto("/photos/fixture-b-01", { waitUntil: "domcontentloaded" });
  const viewport = page.viewportSize()!;
  const box = (await page.locator(".photo img").boundingBox())!;
  expect(box.height).toBeGreaterThan(0);
  expect(box.height).toBeLessThanOrEqual(Math.ceil(viewport.height * 0.82) + 1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the whole entry opens the gallery at this photo's post", async ({ page }) => {
  await page.goto("/photos/fixture-01");
  await page.getByRole("link", { name: "the whole entry" }).click();
  await expect(page).toHaveURL(/\/photos\?before=1790497801#post-fixture$/);
  await expect(page.locator("ol.entries > li.entry").first()).toHaveAttribute("id", "post-fixture");
});

test("a hidden, unknown or malformed photo is the notebook 404, uncached", async ({ page }) => {
  for (const id of ["fixture-03", "nobody-01", "not%20an%20id"]) {
    const response = await page.goto(`/photos/${id}`);
    expect(response?.status()).toBe(404);
    expect(response?.headers()["cache-control"]).toBe("no-store");
    await expect(page.locator("main")).toContainText("nothing written on this page.");
  }
});

test("when D1 fails the photo page says so with a 503 that is never cached", async ({ page }) => {
  const response = await page.goto("http://localhost:4332/photos/fixture-01");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.locator(".down")).toHaveText("photos aren't loading right now. try again in a bit.");
});
```

In `tests/e2e/admin-photos.spec.ts`, change the admin import to `import { ADMIN, expectSaved, openAdmin, unique } from "./admin";` and add at the end:

```ts
test("an edited place and title show on the gallery and the photo's page", async ({ page }) => {
  await openPost(page, "fixture-c");
  const place = intent(post(page, "fixture-c"), "post.place");
  await place.getByLabel("place").fill("cottesloe, perth");
  await place.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  await openPost(page, "fixture-c");
  const title = intent(page.locator("#photo-fixture-c-01"), "photo.title");
  await title.getByLabel("title").fill("the long jetty");
  await title.getByRole("button", { name: "save", exact: true }).click();
  await expectSaved(page, "photographs", "gallery");
  // A fresh query misses any cached copy: local runs have no purge
  await page.goto(`${ADMIN}/photos?fresh=${unique()}`);
  await expect(page.locator("#post-fixture-c .entry-head")).toHaveText("01.03.26 · cottesloe, perth");
  await expect(page.locator("#post-fixture-c img")).toHaveAttribute("alt", "the long jetty");
  await page.goto(`${ADMIN}/photos/fixture-c-01?fresh=${unique()}`);
  await expect(page.locator("h1")).toHaveText("the long jetty");
  await expect(page.locator(".photo-page .where")).toHaveText("01.03.26 · cottesloe, perth");
});
```

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/photo-page.spec.ts tests/e2e/gallery.spec.ts`
Expected: every test passes in chromium, webkit and phone.

Run: `bun run test:e2e tests/e2e/admin-photos.spec.ts tests/e2e/head.spec.ts tests/e2e/routes.spec.ts --project=chromium`
Expected: every test passes; the home page still shares `/og.png` (`head.spec.ts`).

Look at it (Global constraints, visual checks) at `http://localhost:4336/photos/fixture-b-01` (a portrait) and `http://localhost:4336/photos/fixture-b-02` (a landscape), saved as `"$TMPDIR/photo-portrait"` and `"$TMPDIR/photo-landscape"`: the portrait no taller than the window, letterboxed on paper with nothing cropped; the landscape the column's full width; the chevrons pointing back and ahead; `the whole entry` on the same mono line.

- [ ] **Step 5: Commit**

```bash
git add src/components/photos/PhotoView.astro src/pages/photos/[id].astro src/lib/photos/gallery.ts src/lib/photos/store.ts src/layouts/Notebook.astro src/styles/photos.css playwright.config.ts tests/unit/photo-view.test.ts tests/unit/notebook.test.ts tests/unit/gallery.test.ts tests/unit/photo-entries.test.ts tests/e2e/photo-page.spec.ts tests/e2e/admin-photos.spec.ts
git commit -m "feat: a page for each photograph, with its own share image"
```

---
### Task 10: the downloads page, catalogue links and the private paths

A catalogue link now opens a page, `/photos/downloads?token=…` (spec 5.2): every published photograph, grouped into entries as the gallery, each with its 240 preview and `download · 12.4 mb`. The page verifies the token as the JSON route does and sends the private headers; it has no script, no canonical and no referrer, and it is never cached or counted. Invalid, expired and revoked links all get the same 403 page; a missing key or a D1 failure a 503 (spec 5.3). Photo-scoped links are no longer issued to people (ADR-0020 as amended): the owner route refuses a `photoId` and `photos:link` drops `--photo`. `robots.txt` disallows `/photos/downloads`, the ingest proxy refuses events from it and the middleware's private paths become `isPrivatePath()`.

**Files:**
- Create: `src/pages/photos/downloads/index.astro`, `src/components/photos/Downloads.astro`, `tests/unit/downloads-page.test.ts`, `tests/unit/photo-links-route.test.ts`, `tests/e2e/downloads.spec.ts`
- Modify: `src/lib/photos/store.ts`, `src/lib/photos/http.ts`, `src/lib/photos/gallery.ts`, `src/middleware.ts`, `src/lib/ingest.ts`, `src/pages/admin/photos/links.ts`, `scripts/photo-links.mjs`, `public/robots.txt`, `src/styles/photos.css`, `tests/e2e/photos.spec.ts` (whole file below), `tests/e2e/photo-store.ts`
- Test: `tests/unit/downloads-page.test.ts`, `tests/unit/photo-links-route.test.ts`, `tests/unit/ingest.test.ts`, `tests/unit/middleware.test.ts`, `tests/e2e/downloads.spec.ts`, `tests/e2e/photos.spec.ts`, `tests/e2e/head.spec.ts`

**Interfaces:**
- Consumes: `entryPage`, `grantIsActive`, `insertGrant`, `Entry` (store); `verifyPhotoToken`, `signPhotoToken` (tokens); `PRIVATE_HEADERS`, `requestToken` (http); `EntryHead.astro`, `photoAlt`, `previewOf` (Task 7); `Notebook.astro`'s `noindex` and `referrer` (Task 9); `formatLogDate`, `sydneyDate`, `sydneyTime`; `adminD1` (Task 6).
- Produces:
  - `src/lib/photos/store.ts`: `allEntries(db, sizes): Promise<Entry[]>` (every published photograph, one page)
  - `src/lib/photos/http.ts`: `isPrivatePath(pathname): boolean`
  - `src/lib/photos/gallery.ts`: `type DownloadsView = { state: "ok"; entries: Entry[]; token: string; expiresAt: number } | { state: "gone" } | { state: "down" }`
  - `Downloads.astro` props `{ view: DownloadsView }`
  - `POST /admin/photos/links` answers 400 `{ "error": "photo links are internal" }` for any `photoId`, and its catalogue `url` is `<origin>/photos/downloads?token=…`
  - `tests/e2e/photo-store.ts`: `catalogueLink(request): Promise<{ grantId: string; expiresAt: number; url: string }>`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/downloads-page.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import Downloads from "../../src/components/photos/Downloads.astro";
import type { Entry, PublicPhoto } from "../../src/lib/photos/store";
import { render, text } from "./render";

const photo = (id: string, bytes: number): PublicPhoto => ({
  id, collection: "post", title: "", width: 4000, height: 6000, downloadBytes: bytes, date: "2025-02-02", place: "bondi, sydney",
  previews: (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/${id}/s/240.${format}`, width: 160, height: 240, format })),
});
const ENTRIES: Entry[] = [{ collection: "post", date: "2025-02-02", place: "bondi, sydney", publishedAt: 1738488468, photos: [photo("post-01", 12_400_000), photo("post-02", 960_000)] }];
const ok = (over: Record<string, unknown> = {}) => ({ view: { state: "ok", entries: ENTRIES, token: "a.b+c/d", expiresAt: 1792035000, ...over } });

describe("Downloads", () => {
  test("lists every photo under its entry's heading, each a download that carries the token", async () => {
    const doc = await render(Downloads, ok());
    expect([...doc.querySelectorAll(".row > .label")].map(text)).toEqual(["downloads", "entries"]);
    expect(text(doc.querySelector("h1"))).toBe("photos, full size");
    expect(text(doc.querySelector("#post-post .entry-head"))).toBe("02.02.25 · bondi, sydney");
    const links = [...doc.querySelectorAll(".download-list a")];
    expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("download"), text(a)])).toEqual([
      ["/photos/downloads/post-01?token=a.b%2Bc%2Fd", "post-01.jpg", "download · 12.4 mb"],
      ["/photos/downloads/post-02?token=a.b%2Bc%2Fd", "post-02.jpg", "download · 1.0 mb"],
    ]);
    // Each link is described by its preview's alt text, so a screen reader can tell them apart
    expect(links[0].getAttribute("aria-describedby")).toBe("download-post-01");
    expect(doc.querySelector("#download-post-01")!.getAttribute("alt")).toBe("photo 1 of 2 from 2 february 2025, bondi, sydney");
    const img = doc.querySelector(".download-list img")!;
    expect([img.getAttribute("loading"), img.getAttribute("alt"), img.getAttribute("src")]).toEqual(["lazy", "photo 1 of 2 from 2 february 2025, bondi, sydney", "/media/photos/previews/post-01/s/240.webp"]);
    expect(doc.querySelector("script")).toBeNull();
  });

  test("says until when the link works in sydney time, on either side of daylight saving", async () => {
    expect(text((await render(Downloads, ok())).querySelector(".intro"))).toBe(
      "every photo in the gallery as a full-resolution jpeg. this link works until 15.10.26, 2:30 pm sydney time. please keep it to yourself.",
    );
    // 04:30 UTC in June is 2:30 pm in Sydney's winter (AEST); 03:30 UTC in October is 2:30 pm in its summer (AEDT)
    expect(text((await render(Downloads, ok({ expiresAt: 1781497800 }))).querySelector(".intro"))).toContain("this link works until 15.06.26, 2:30 pm sydney time.");
  });

  test("a valid link with nothing published says so", async () => {
    const doc = await render(Downloads, ok({ entries: [] }));
    expect(text(doc.querySelector("#entries .empty"))).toBe("no photos up yet.");
  });

  test("a link that has run out says so the same way whatever the reason, with George's address", async () => {
    const doc = await render(Downloads, { view: { state: "gone" } });
    expect([...doc.querySelectorAll(".row > .label")].map(text)).toEqual(["downloads"]);
    expect(text(doc.querySelector("h1"))).toBe("this link has run out");
    expect(text(doc.querySelector(".intro"))).toBe("it may have expired or been switched off. if you were expecting photos, ask george for a fresh one: hello@curiousgeorge.dev.");
    expect(doc.querySelector('.intro a[href="mailto:hello@curiousgeorge.dev"]')).not.toBeNull();
  });

  test("when downloads aren't working it says so", async () => {
    const doc = await render(Downloads, { view: { state: "down" } });
    expect(text(doc.querySelector("h1"))).toBe("photos, full size");
    expect(text(doc.querySelector(".intro"))).toBe("downloads aren't working right now. try again in a bit.");
    expect(doc.querySelector(".download-list")).toBeNull();
  });
});
```

Create `tests/unit/photo-links-route.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";
import { verifyPhotoToken } from "../../src/lib/photos/tokens";
import { sqliteD1 } from "./sqlite-d1";

// The route reads the Worker's env; stand in the fixture key and a D1 over the real migrations
const env = vi.hoisted(() => ({ PHOTO_LINK_SECRET: "1".repeat(64), DB: undefined as unknown as D1Database }));
vi.mock("cloudflare:workers", () => ({ env }));
const { POST } = await import("../../src/pages/admin/photos/links");

const ROUTE = "https://curiousgeorge.dev/admin/photos/links";
const call = async (body: unknown) =>
  POST({ request: new Request(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), url: new URL(ROUTE) } as unknown as Parameters<typeof POST>[0]) as Promise<Response>;

beforeEach(() => {
  env.DB = sqliteD1();
});

test("a photo id is refused: photo links are internal, and nothing is granted", async () => {
  const response = await call({ photoId: "fixture-01" });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "photo links are internal" });
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM photo_download_grants").first("n"))).toBe(0);
});

test("a catalogue link points at the downloads page, signed for its grant", async () => {
  const response = await call({ expiresInSeconds: 3600 });
  expect(response.status).toBe(201);
  const link = (await response.json()) as { grantId: string; expiresAt: number; url: string };
  const url = new URL(link.url);
  expect(`${url.origin}${url.pathname}`).toBe("https://curiousgeorge.dev/photos/downloads");
  expect(await verifyPhotoToken(env.PHOTO_LINK_SECRET, url.searchParams.get("token")!)).toEqual({ grantId: link.grantId, photoId: null, expiresAt: link.expiresAt });
  expect(await env.DB.prepare("SELECT photo_id FROM photo_download_grants WHERE id = ?").bind(link.grantId).first("photo_id")).toBeNull();
});
```

In `tests/unit/ingest.test.ts`, add at the end:

```ts
test("an event from the downloads page is refused and never forwarded", async () => {
  const upstream = ok();
  for (const pathname of ["/photos/downloads", "/photos/downloads/fixture-01"]) {
    const body = JSON.stringify({ ...pageview, properties: { ...pageview.properties, $pathname: pathname } });
    expect((await forwardEvent(post(body), config, upstream, serverNow)).status).toBe(400);
  }
  expect(upstream).not.toHaveBeenCalled();
  const gallery = JSON.stringify({ ...pageview, properties: { ...pageview.properties, $pathname: "/photos" } });
  expect((await forwardEvent(post(gallery), config, upstream, serverNow)).status).toBe(204);
});
```

In `tests/unit/middleware.test.ts`, add `import { isPrivatePath } from "../../src/lib/photos/http";` after its `vitest` import (Vitest hoists the `vi.mock` calls above it), change the first test's path list to `["/photos/downloads/fixture-01?token=private", "/photos/downloads?token=private", "/api/photos/downloads?token=private"]`, and add:

```ts
test("the private paths are the downloads page, its files and the JSON catalogue, and nothing else", () => {
  for (const path of ["/photos/downloads", "/photos/downloads/", "/photos/downloads/fixture-01", "/api/photos/downloads", "/api/photos/downloads/"]) expect(isPrivatePath(path)).toBe(true);
  for (const path of ["/photos", "/photos/fixture-01", "/photos/downloadsx", "/api/photos", "/api/photos/downloadsx"]) expect(isPrivatePath(path)).toBe(false);
});
```

Run: `bun run test:unit tests/unit/downloads-page.test.ts tests/unit/photo-links-route.test.ts tests/unit/ingest.test.ts tests/unit/middleware.test.ts`
Expected: FAIL: `Downloads.astro` and `isPrivatePath` don't exist, the route still grants a photo link and links to `/api/photos/downloads`, and the proxy forwards the downloads page's event.

- [ ] **Step 2: The page and its pieces**

In `src/lib/photos/store.ts`, add after `entryPage`:

```ts
/** Every published photograph, grouped into entries newest first, on one page (the downloads page, spec 5.2) */
export async function allEntries(db: D1Database, sizes: readonly number[]): Promise<Entry[]> {
  return (await entryPage(db, null, 10_000, sizes)).entries;
}
```

In `src/lib/photos/http.ts`, add after `PRIVATE_HEADERS`:

```ts
/**
 * Paths whose responses carry a bearer token or what it unlocks: the middleware gives them PRIVATE_HEADERS whatever the
 * route sent, so they are never cached, indexed or passed on as a referrer (spec 5.2). Plan B adds /prints/.
 */
export const isPrivatePath = (pathname: string) =>
  pathname === "/api/photos/downloads" || pathname === "/api/photos/downloads/" || pathname === "/photos/downloads" || pathname.startsWith("/photos/downloads/");
```

In `src/middleware.ts`, change `import { PRIVATE_HEADERS } from "./lib/photos/http";` to `import { PRIVATE_HEADERS, isPrivatePath } from "./lib/photos/http";` and replace the `const privatePhotos = ...` line with:

```ts
  const privatePhotos = isPrivatePath(url.pathname);
```

In `src/lib/photos/gallery.ts`, change the store import to `import type { Entry, PublicPhoto, PublicPreview } from "./store";` and add at the end:

```ts
/** What the downloads page shows (spec 5.2 and 5.3): the list, a link that has run out (whatever the reason) or downloads that aren't working */
export type DownloadsView = { state: "ok"; entries: Entry[]; token: string; expiresAt: number } | { state: "gone" } | { state: "down" };
```

In `src/lib/ingest.ts`, in `forwardEvent`, add after `if (!parsed) return ingestAnswer(400);`:

```ts
  // The downloads page carries no beacon; should one ever be added, its events are still never counted (spec 2.2)
  const pathname = parsed.properties.$pathname;
  if (typeof pathname === "string" && pathname.startsWith("/photos/downloads")) return ingestAnswer(400);
```

Change `public/robots.txt` to:

```
User-agent: *
Disallow: /admin
Disallow: /photos/downloads
```

Create `src/components/photos/Downloads.astro`:

```astro
---
import Row from "../Row.astro";
import EntryHead from "./EntryHead.astro";
import { photoAlt, previewOf, type DownloadsView } from "../../lib/photos/gallery";
import { formatLogDate } from "../../lib/text";
import { sydneyDate, sydneyTime } from "../../lib/time";

interface Props {
  view: DownloadsView;
}

const { view } = Astro.props;
const list = view.state === "ok" ? view : null;
// The token's expiry in Sydney's wall time: 15.10.26, 2:30 pm
const until = (seconds: number) => {
  const when = new Date(seconds * 1000);
  return `${formatLogDate(sydneyDate(when), "day")}, ${sydneyTime(when)}`;
};
// Decimal megabytes, one decimal (spec 5.2)
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} mb`;
---
<main class="book downloads">
  <Row label="downloads" head>
    {view.state === "gone" ? (
      <>
        <h1>this link has run out</h1>
        <p class="intro">it may have expired or been switched off. if you were expecting photos, ask george for a fresh one: <a href="mailto:hello@curiousgeorge.dev">hello@curiousgeorge.dev</a>.</p>
      </>
    ) : (
      <>
        <h1>photos, full size</h1>
        {list ? (
          <p class="intro">every photo in the gallery as a full-resolution jpeg. this link works until {until(list.expiresAt)} sydney time. please keep it to yourself.</p>
        ) : (
          <p class="intro">downloads aren't working right now. try again in a bit.</p>
        )}
      </>
    )}
  </Row>
  {list && (
    <Row label="entries" id="entries">
      {list.entries.length === 0 ? (
        <p class="empty">no photos up yet.</p>
      ) : (
        <ol class="entries">
          {list.entries.map((entry) => (
            <li class="entry" id={`post-${entry.collection}`}>
              <EntryHead date={entry.date} place={entry.place} />
              <ol class="download-list">
                {entry.photos.map((photo, index) => {
                  const webp = previewOf(photo, 240, "webp");
                  const avif = previewOf(photo, 240, "avif");
                  return (
                    <li>
                      {webp && (
                        <picture>
                          {avif && <source type="image/avif" srcset={avif.url} />}
                          <img id={`download-${photo.id}`} src={webp.url} width={webp.width} height={webp.height} alt={photoAlt(photo, index, entry.photos.length)} loading="lazy" decoding="async" />
                        </picture>
                      )}
                      {/* The token lives only in these links (spec 5.2) */}
                      <a href={`/photos/downloads/${photo.id}?token=${encodeURIComponent(list.token)}`} download={`${photo.id}.jpg`} aria-describedby={webp ? `download-${photo.id}` : undefined}>download · {megabytes(photo.downloadBytes)}</a>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </Row>
  )}
</main>
```

Create `src/pages/photos/downloads/index.astro`:

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../../../layouts/Notebook.astro";
import Downloads from "../../../components/photos/Downloads.astro";
import type { DownloadsView } from "../../../lib/photos/gallery";
import { PRIVATE_HEADERS, requestToken } from "../../../lib/photos/http";
import { allEntries, grantIsActive } from "../../../lib/photos/store";
import { verifyPhotoToken } from "../../../lib/photos/tokens";
import "../../../styles/photos.css";

// Never cached, indexed, counted or logged (spec 5.2): the middleware sets these too, and this page never calls
// Astro.cache.set, carries no script and logs no URL
for (const [name, value] of Object.entries(PRIVATE_HEADERS)) Astro.response.headers.set(name, value);
const token = requestToken(Astro.request);
let view: DownloadsView;
try {
  const now = Math.floor(Date.now() / 1000);
  // Exactly as /api/photos/downloads: a valid signature, a catalogue scope and an active grant
  const verified = await verifyPhotoToken(env.PHOTO_LINK_SECRET, token, now);
  if (!verified || verified.photoId !== null || !(await grantIsActive(env.DB, verified, now))) view = { state: "gone" };
  else view = { state: "ok", entries: await allEntries(env.DB, [240]), token, expiresAt: verified.expiresAt };
} catch {
  // A missing PHOTO_LINK_SECRET throws in verifyPhotoToken; D1 can throw too. Never log the request or the error, which could hold the token
  console.error("photos: the downloads page is unavailable");
  view = { state: "down" };
}
// Invalid, expired and revoked look the same (spec 5.3)
Astro.response.status = view.state === "ok" ? 200 : view.state === "gone" ? 403 : 503;
---
<Notebook title="downloads · george vlachos" description="full-resolution photos from george vlachos, for the people he shares them with." noindex referrer="no-referrer">
  <Downloads view={view} />
</Notebook>
```

In `src/styles/photos.css`, add before the `@media (max-width: 679px)` block:

```css
/* The downloads page (spec 5.2): each photo's 240 preview above its download link */
.download-list { display: flex; flex-wrap: wrap; gap: 14px 18px; margin-top: 10px; }
.download-list li { display: grid; gap: 4px; justify-items: start; }
.download-list img { display: block; height: 88px; width: auto; background: #ecebe5; }
.download-list a { font: 12px/1.5 var(--mono); }
```

Run: `bun run test:unit tests/unit/downloads-page.test.ts tests/unit/ingest.test.ts tests/unit/middleware.test.ts && bun run typecheck`
Expected: PASS; 0 errors.

- [ ] **Step 3: Catalogue links only, pointing at the page**

Replace `src/pages/admin/photos/links.ts` with:

```ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoError, photoJson, readPhotoJson } from "../../../lib/photos/http";
import { insertGrant, revokeGrant } from "../../../lib/photos/store";
import { DEFAULT_LINK_SECONDS, MAX_LINK_SECONDS, signPhotoToken } from "../../../lib/photos/tokens";

export const POST: APIRoute = async ({ request, url }) => {
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const data = parsed.data as { photoId?: unknown; expiresInSeconds?: unknown };
  if (!data || typeof data !== "object" || Array.isArray(data)) return photoError("Invalid request.", 400);
  // People only ever get catalogue links (ADR-0020 as amended); photo-scoped grants are made inside print orders
  if (data.photoId !== undefined && data.photoId !== null) return photoError("photo links are internal", 400);
  const duration = data.expiresInSeconds ?? DEFAULT_LINK_SECONDS;
  if (!Number.isSafeInteger(duration) || Number(duration) < 60 || Number(duration) > MAX_LINK_SECONDS) return photoError("Invalid expiry (60 seconds to 30 days).", 400);
  try {
    const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: Math.floor(Date.now() / 1000) + Number(duration) };
    const token = await signPhotoToken(env.PHOTO_LINK_SECRET ?? "", grant);
    await insertGrant(env.DB, grant);
    // The page, not the JSON route, which stays for scripts (spec 2.2)
    return photoJson({ grantId: grant.grantId, expiresAt: grant.expiresAt, url: `${url.origin}/photos/downloads?token=${encodeURIComponent(token)}` }, 201, true);
  } catch { console.error("photos: could not issue link"); return photoError("Could not issue a download link.", 503); }
};

export const DELETE: APIRoute = async ({ url }) => {
  const id = url.searchParams.get("grantId") ?? "";
  try { return await revokeGrant(env.DB, id) ? photoJson({ revoked: true }, 200, true) : photoError("Link unavailable or already revoked.", 404); }
  catch { console.error("photos: could not revoke link"); return photoError("Could not revoke the link.", 503); }
};
```

In `scripts/photo-links.mjs`:

Replace the usage block's first line (`console.error("usage: bun run photos:link --local | --remote --output private-link.json [--photo ID] [--days 7] ...`) with:

```js
  console.error("usage: bun run photos:link --local | --remote --output private-link.json [--days 7] [--origin URL] [--persist-to DIR]\n       bun run photos:link --local | --remote --revoke GRANT_ID");
```

Add after the usage `if` block (before `const platform = ...`):

```js
// People only ever get catalogue links (ADR-0020 as amended): photo-scoped grants are made inside print orders
if (args.includes("--photo")) {
  console.error("photo links are internal: issue a catalogue link (leave out --photo)");
  process.exit(1);
}
```

Replace the three lines from `const photoId = arg("--photo");` down to and including `const grant = { grantId: randomUUID(), photoId, expiresAt: ... };` with:

```js
    const grant = { grantId: randomUUID(), photoId: null, expiresAt: Math.floor(Date.now()/1000) + duration };
```

and replace `const url = new URL(photoId === null ? "/api/photos/downloads" : \`/photos/downloads/${photoId}\`, origin);` with:

```js
    const url = new URL("/photos/downloads", origin);
```

Run: `bun run test:unit tests/unit/photo-links-route.test.ts && grep -n -- "--photo\|photoId" scripts/photo-links.mjs`
Expected: the route's tests pass; the only `--photo` left is the refusal, which runs before the script opens a store or reads `.dev.vars`, and `photoId` appears only as `photoId: null`. Don't run the script itself: it reads George's local key.

- [ ] **Step 4: The e2e specs**

In `tests/e2e/photo-store.ts`, add at the top `import type { APIRequestContext } from "@playwright/test";` and `import { ADMIN } from "./admin";`, and at the end:

```ts
/** Issues a catalogue link through the owner's JSON route on the admin server */
export async function catalogueLink(request: APIRequestContext): Promise<{ grantId: string; expiresAt: number; url: string }> {
  const issued = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: {} });
  if (issued.status() !== 201) throw new Error(`issuing a link answered ${issued.status()}`);
  return issued.json();
}
```

Replace `tests/e2e/photos.spec.ts` with:

```ts
import { expect, test } from "@playwright/test";
import { signPhotoToken } from "../../src/lib/photos/tokens";
import { ADMIN } from "./admin";
import { GALLERY } from "./gallery-site";
import { adminD1, catalogueLink } from "./photo-store";

test.skip(({ browserName }) => browserName !== "chromium", "HTTP backend behaviour, checked once");
test.describe.configure({ mode: "serial" });
const PRIVATE = { "cache-control": "private, no-store", "cloudflare-cdn-cache-control": "no-store", "referrer-policy": "no-referrer" };
/** The admin server's fixture signing key (playwright.config.ts) */
const SECRET = "1".repeat(64);
const tokenOf = (url: string) => encodeURIComponent(new URL(url).searchParams.get("token")!);

test("public API returns responsive previews without drafts or private object keys", async ({ request }) => {
  const response = await request.get(`${ADMIN}/api/photos?limit=1`);
  expect(response.status()).toBe(200);
  const page = await response.json();
  expect(page.photos.map((p: { id: string }) => p.id)).toEqual(["fixture-01"]);
  expect(page.next).toBe(0);
  expect(page.photos[0].previews).toHaveLength(8);
  expect(page.photos[0]).toMatchObject({ date: "2026-09-27", place: "bondi, sydney" });
  expect(JSON.stringify(page)).not.toMatch(/prints\/|print_key|token=/);
  const preview = await request.get(`${ADMIN}${page.photos[0].previews[0].url}`);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toBe("image/webp");
  expect(preview.headers()["cache-control"]).toContain("immutable");
  expect((await request.get(`${ADMIN}/api/photos/fixture-03`)).status()).toBe(404);
  expect(await (await request.get(`${ADMIN}/api/photos/fixture-01`)).json()).toMatchObject({ id: "fixture-01", date: "2026-09-27", place: "bondi, sydney" });
  expect((await request.get(`${ADMIN}/api/photos?token=secret`)).status()).toBe(400);
});

test("a catalogue link opens the page, and its photos download as JPEG with GET, range and HEAD", async ({ request }) => {
  const link = await catalogueLink(request);
  expect(new URL(link.url).pathname).toBe("/photos/downloads");
  const download = `${ADMIN}/photos/downloads/fixture-01?token=${tokenOf(link.url)}`;
  const full = await request.get(download);
  expect(full.status()).toBe(200);
  expect(full.headers()).toMatchObject(PRIVATE);
  expect(full.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await full.body();
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  expect(bytes.length).toBe(Number(full.headers()["content-length"]));
  const part = await request.get(download, { headers: { Range: "bytes=100-199" } });
  expect(part.status()).toBe(206);
  expect(await part.body()).toEqual(bytes.subarray(100, 200));
  const head = await request.head(download);
  expect(head.status()).toBe(200);
  expect((await head.body()).length).toBe(0);
  expect(head.headers()).toMatchObject(PRIVATE);
  const revoked = await request.delete(`${ADMIN}/admin/photos/links?grantId=${link.grantId}`, { headers: { Origin: ADMIN } });
  expect(revoked.status()).toBe(200);
  expect((await request.get(download, { headers: { "If-None-Match": full.headers().etag } })).status()).toBe(403);
});

test("a photo-scoped grant, made only inside the site, reaches its own photo and nothing else", async ({ request }) => {
  const now = Math.floor(Date.now() / 1000);
  const grant = { grantId: crypto.randomUUID(), photoId: "fixture-01", expiresAt: now + 600 };
  adminD1(`INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES ('${grant.grantId}', 'fixture-01', ${grant.expiresAt})`);
  const token = encodeURIComponent(await signPhotoToken(SECRET, grant, now));
  expect((await request.get(`${ADMIN}/photos/downloads/fixture-01?token=${token}`)).status()).toBe(200);
  expect((await request.get(`${ADMIN}/photos/downloads/fixture-02?token=${token}`)).status()).toBe(403);
  expect((await request.get(`${ADMIN}/api/photos/downloads?token=${token}`)).status()).toBe(403);
  expect((await request.get(`${ADMIN}/photos/downloads?token=${token}`)).status()).toBe(403);
});

test("catalogue grants expose protected links through the JSON route and stop working after revocation", async ({ request }) => {
  const link = await catalogueLink(request);
  const page = await request.get(`${ADMIN}/api/photos/downloads?token=${tokenOf(link.url)}`);
  expect(page.headers()).toMatchObject(PRIVATE);
  const catalogue = await page.json();
  const ids = catalogue.photos.map((p: { id: string }) => p.id);
  // The admin specs publish and hide their own posts meanwhile, so only photographs no spec changes are pinned
  expect(ids).toEqual(expect.arrayContaining(["fixture-01", "fixture-02"]));
  expect(ids).not.toContain("fixture-03");
  expect(catalogue.photos[0]).toMatchObject({ id: "fixture-01", date: "2026-09-27", place: "bondi, sydney" });
  expect((await request.get(`${ADMIN}${catalogue.photos[1].downloadUrl}`)).status()).toBe(200);
  await request.delete(`${ADMIN}/admin/photos/links?grantId=${link.grantId}`, { headers: { Origin: ADMIN } });
  expect((await request.get(`${ADMIN}/api/photos/downloads?token=${tokenOf(link.url)}`)).status()).toBe(403);
});

test("missing tokens, public bucket bypasses, photo links and cross-origin issuance are refused", async ({ request }) => {
  for (const path of ["/photos/downloads/fixture-01", "/api/photos/downloads"]) {
    const response = await request.get(`${ADMIN}${path}`);
    expect(response.status()).toBe(403);
    expect(response.headers()).toMatchObject(PRIVATE);
  }
  expect((await request.get(`${ADMIN}/media/prints/fixture-01/any.jpg`)).status()).toBe(404);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: "https://other.example" }, data: {} })).status()).toBe(403);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { expiresInSeconds: 31 * 86400 } })).status()).toBe(400);
  expect((await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { unused: "x".repeat(5000) } })).status()).toBe(413);
  const scoped = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: { photoId: "fixture-01" } });
  expect(scoped.status()).toBe(400);
  expect(await scoped.json()).toEqual({ error: "photo links are internal" });
});

test("publishing requires verified assets and refreshes the catalogue", async ({ request }) => {
  // fixture-d-01, which no other spec changes (the admin server's store is shared by every spec on 4333)
  const path = `${ADMIN}/admin/photos/fixture-d-01`;
  const hidden = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: false } });
  expect(hidden.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-d-01`)).status()).toBe(404);
  const published = await request.patch(path, { headers: { Origin: ADMIN }, data: { published: true } });
  expect(published.status()).toBe(200);
  expect((await request.get(`${ADMIN}/api/photos/fixture-d-01?`)).status()).toBe(200);
});

// On the gallery server (4335), whose photo fixture no spec changes
test("the entry mode pages posts newest first, with only the gallery's previews", async ({ request }) => {
  const response = await request.get(`${GALLERY}/api/photos?by=entry&limit=4`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300");
  const page = await response.json();
  expect(page.entries.map((entry: { collection: string }) => entry.collection)).toEqual(["fixture", "fixture-b", "fixture-c", "fixture-d"]);
  expect(page.next).toBe(1766610000);
  expect(page.entries[0]).toMatchObject({ collection: "fixture", date: "2026-09-27", place: "bondi, sydney" });
  expect(page.entries[0]).not.toHaveProperty("publishedAt");
  expect(page.entries[1].place).toBeNull();
  expect(page.entries[0].photos.map((photo: { id: string }) => photo.id)).toEqual(["fixture-01", "fixture-02"]);
  expect(page.entries[0].photos[0].previews.map((preview: { url: string }) => preview.url.split("/").at(-1))).toEqual(["240.webp", "240.avif", "480.webp", "480.avif"]);
  const rest = await (await request.get(`${GALLERY}/api/photos?by=entry&before=${page.next}`)).json();
  expect(rest.entries.map((entry: { collection: string }) => entry.collection)).toEqual(["fixture-e", "fixture-f"]);
  expect(rest.next).toBeNull();
  for (const query of ["by=entry&limit=13", "by=entry&before=abc", "by=entry&after=1", "by=post"]) {
    expect((await request.get(`${GALLERY}/api/photos?${query}`)).status()).toBe(400);
  }
});
```

Create `tests/e2e/downloads.spec.ts`:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signPhotoToken } from "../../src/lib/photos/tokens";
import { ADMIN } from "./admin";
import { adminD1, catalogueLink } from "./photo-store";

test.skip(({ browserName }) => browserName !== "chromium", "issues links on the admin server: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local admin server's fixture key");
const SECRET = "1".repeat(64);

test("a catalogue link lists every published photo and downloads the master, privately", async ({ page, request }) => {
  const link = await catalogueLink(request);
  const referers: string[] = [];
  const counted: string[] = [];
  const cookies: string[] = [];
  page.on("request", (sent) => {
    const referer = sent.headers().referer;
    if (referer) referers.push(`${sent.url()} from ${referer}`);
    if (new URL(sent.url()).pathname.startsWith("/ingest")) counted.push(sent.url());
  });
  page.on("response", async (answer) => { if ((await answer.allHeaders())["set-cookie"]) cookies.push(answer.url()); });
  const response = await page.goto(link.url);
  expect(response?.status()).toBe(200);
  expect(response?.headers()).toMatchObject({ "cache-control": "private, no-store", "cloudflare-cdn-cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
  await expect(page.locator("h1")).toHaveText("photos, full size");
  await expect(page.locator(".intro")).toHaveText(/^every photo in the gallery as a full-resolution jpeg\. this link works until \d{2}\.\d{2}\.\d{2}, \d{1,2}:\d{2} (am|pm) sydney time\. please keep it to yourself\.$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator("script")).toHaveCount(0);
  const files = await page.locator(".download-list a[download]").evaluateAll((all) => all.map((a) => a.getAttribute("download")));
  // Every published photograph no spec changes is listed; the hidden one never is
  expect(files).toEqual(expect.arrayContaining(["fixture-01.jpg", "fixture-02.jpg", "fixture-f-01.jpg"]));
  expect(files).not.toContain("fixture-03.jpg");
  const first = page.locator('a[download="fixture-01.jpg"]');
  await expect(first).toHaveText(/^download · \d+\.\d mb$/);
  const [download] = await Promise.all([page.waitForEvent("download"), first.click()]);
  const bytes = await readFile((await download.path())!);
  const [{ print_sha256: sha }] = adminD1<{ print_sha256: string }>("SELECT print_sha256 FROM photos WHERE id = 'fixture-01'");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  expect(referers).toEqual([]);
  expect(counted).toEqual([]);
  expect(cookies).toEqual([]);
});

test("expired, revoked, garbled and missing links all get the same 403 page", async ({ page, request }) => {
  const now = Math.floor(Date.now() / 1000);
  // Expired: signed with the fixture key an hour ago for a minute, with its grant row inserted to match
  const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: now - 3540 };
  const expired = encodeURIComponent(await signPhotoToken(SECRET, grant, now - 3600));
  adminD1(`INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES ('${grant.grantId}', NULL, ${grant.expiresAt})`);
  const revoked = await catalogueLink(request);
  await request.delete(`${ADMIN}/admin/photos/links?grantId=${revoked.grantId}`, { headers: { Origin: ADMIN } });
  const pages = [`/photos/downloads?token=${expired}`, `/photos/downloads${new URL(revoked.url).search}`, "/photos/downloads?token=garbled", "/photos/downloads"];
  const bodies = new Set<string>();
  for (const path of pages) {
    const response = await page.goto(`${ADMIN}${path}`);
    expect(response?.status()).toBe(403);
    expect(response?.headers()).toMatchObject({ "cache-control": "private, no-store", "referrer-policy": "no-referrer" });
    await expect(page.locator("h1")).toHaveText("this link has run out");
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    bodies.add(await page.locator("main").innerText());
  }
  expect(bodies.size).toBe(1);
});
```

In `tests/e2e/head.spec.ts`, in `"static files are served"`, add after the `Disallow: /admin` assertion:

```ts
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /photos/downloads");
```

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/downloads.spec.ts tests/e2e/photos.spec.ts tests/e2e/head.spec.ts tests/e2e/ingest.spec.ts --project=chromium`
Expected: every test passes.

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors; every unit test passes.

Look at it (Global constraints, visual checks): issue a link with `curl -s -X POST -H "Origin: http://localhost:4336" -H "Content-Type: application/json" -d '{}' http://localhost:4336/admin/photos/links` and shoot the `url` in the answer, saved as `"$TMPDIR/downloads"`: entries headed as on the gallery, previews 88px tall, the download links in mono under them, nothing wider than the page at 375px.

- [ ] **Step 5: Commit**

```bash
git add src/pages/photos/downloads/index.astro src/components/photos/Downloads.astro src/lib/photos/store.ts src/lib/photos/http.ts src/lib/photos/gallery.ts src/middleware.ts src/lib/ingest.ts src/pages/admin/photos/links.ts scripts/photo-links.mjs public/robots.txt src/styles/photos.css tests/unit/downloads-page.test.ts tests/unit/photo-links-route.test.ts tests/unit/ingest.test.ts tests/unit/middleware.test.ts tests/e2e/downloads.spec.ts tests/e2e/photos.spec.ts tests/e2e/photo-store.ts tests/e2e/head.spec.ts
git commit -m "feat: the private downloads page behind catalogue links; photo links stay internal"
```

---

### Task 11: the admin's links section

`/admin` gains a `links` section after `photographs` (spec 6.3). Issuing a link takes `days` (1 to 30, default 7) and an optional `note`, with a hidden 16-byte nonce new on every render. It is the one write that answers 200, because the link exists only in that response: `here's the link. copy it now - it can't be shown again.`, the URL in a read-only field and a `copy` button. The grant stores the nonce, so the same form sent again creates nothing and says `that link was already made…`; the token is never stored. Active catalogue links are listed newest first, each with a revoke form behind the usual confirmation box. Links purge nothing.

**Files:**
- Create: `src/components/admin/LinksAdmin.astro`, `src/scripts/copy-link.ts`, `tests/unit/link-actions.test.ts`, `tests/unit/links-admin.test.ts`, `tests/e2e/admin-links.spec.ts`
- Modify: `src/lib/photos/store.ts`, `src/lib/admin/actions.ts`, `src/lib/admin/validate.ts`, `src/lib/admin/store.ts`, `src/lib/admin/submit.ts`, `src/components/admin/RemoveForm.astro`, `src/pages/admin/index.astro`, `src/styles/admin.css`, `tests/e2e/admin-layout.spec.ts`
- Test: `tests/unit/link-actions.test.ts`, `tests/unit/links-admin.test.ts`, `tests/unit/store.test.ts`, `tests/unit/submit.test.ts`, `tests/e2e/admin-links.spec.ts`, `tests/e2e/admin-layout.spec.ts`

**Interfaces:**
- Consumes: `signPhotoToken`, `photoSigningKey`, `GRANT_ID` (tokens); `revokeGrant` (store); `CONTROL` from `validate.ts` and the `PURGES` map (Task 6); `formatLogDate`, `sydneyDate`.
- Produces:
  - `src/lib/photos/store.ts`: `insertGrant(db, token, extra?: { note?: string | null; nonce?: string | null }): Promise<boolean>` (false when the nonce was already used)
  - `actions.ts`: `AdminSection` gains `"links"`; `type IssuedLink = { url: string } | { repeat: true }`; `ActionResult`'s success gains `issued?: IssuedLink`; `ActionDeps` gains `photoLinkSecret?: string` and `origin?: string`; intents `link.issue` and `link.revoke`
  - `validate.ts`: `LINK_FIELDS`, `interface LinkInput { days: number; note: string | null }`, `checkLink(fields): Checked<LinkInput>`
  - admin `store.ts`: `interface AdminLink { id: string; createdAt: string; expiresAt: number; note: string | null }`; `AdminData.links`; `loadAdmin(db, now?)`
  - `submit.ts`: `SubmitOutcome` gains `{ issued: IssuedLink }`
  - `RemoveForm.astro`: `intent` may be `"link.revoke"`, `id: number | string`, `button?: string`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/link-actions.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { verifyPhotoToken } from "../../src/lib/photos/tokens";
import { sqliteD1 } from "./sqlite-d1";

const SECRET = "1".repeat(64);
const NONCE = "AbCdEfGhIjKlMnOpQrStUv";
let db: D1Database;

const deps = (over: Partial<ActionDeps> = {}): ActionDeps => ({ db, media: {} as R2Bucket, images: {} as ImagesBinding, photoLinkSecret: SECRET, origin: "https://curiousgeorge.dev", ...over });
const submit = (entries: Record<string, string>, over: Partial<ActionDeps> = {}) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return runAction(form, deps(over));
};
const grants = async () => (await db.prepare("SELECT id, photo_id, expires_at, note, request_nonce, revoked_at FROM photo_download_grants").all()).results as Record<string, unknown>[];
const issue = (over: Record<string, string> = {}) => submit({ intent: "link.issue", days: "7", note: "for mum", nonce: NONCE, ...over });

beforeEach(() => {
  db = sqliteD1();
});

describe("issuing a link", () => {
  test("answers with it once, signed for the days asked; the grant keeps its note and nonce but never the token", async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await issue();
    expect(result).toMatchObject({ ok: true, section: "links", issued: { url: expect.stringMatching(/^https:\/\/curiousgeorge\.dev\/photos\/downloads\?token=/) } });
    const token = new URL((result as { issued: { url: string } }).issued.url).searchParams.get("token")!;
    const [grant] = await grants();
    expect(await verifyPhotoToken(SECRET, token)).toEqual({ grantId: grant.id, photoId: null, expiresAt: grant.expires_at });
    expect(Number(grant.expires_at) - before).toBeGreaterThanOrEqual(7 * 86400);
    expect(Number(grant.expires_at) - before).toBeLessThanOrEqual(7 * 86400 + 5);
    expect(grant).toMatchObject({ photo_id: null, note: "for mum", request_nonce: NONCE, revoked_at: null });
    expect(JSON.stringify(await grants())).not.toContain(token);
  });

  test("the same form sent again (a double tap, a reload) makes no second link, and says so", async () => {
    await issue();
    expect(await issue()).toEqual({ ok: true, section: "links", issued: { repeat: true } });
    expect(await grants()).toHaveLength(1);
    expect(await issue({ nonce: "ZyXwVuTsRqPoNmLkJiHgFe" })).toMatchObject({ issued: { url: expect.any(String) } });
    expect(await grants()).toHaveLength(2);
  });

  test("takes 1 to 30 days and a one-line note of 60 characters at most", async () => {
    for (const days of ["0", "31", "abc", "", "7.5"]) {
      expect(await issue({ days })).toEqual({ ok: false, section: "links", form: "link-new", errors: { days: "a number of days from 1 to 30" }, values: { days, note: "for mum" } });
    }
    expect(await issue({ note: "x".repeat(61) })).toMatchObject({ errors: { note: "60 characters at most" } });
    expect(await issue({ note: "for\tmum" })).toMatchObject({ errors: { note: "one line of plain text" } });
    expect(await issue({ days: "30", note: "" })).toMatchObject({ ok: true });
    expect((await grants())[0]).toMatchObject({ note: null });
  });

  test("a form without a proper nonce is out of date: a message for the page, and nothing made", async () => {
    expect(await issue({ nonce: "short" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that form is out of date. reload the page and try again." }, values: {} });
    expect(await grants()).toHaveLength(0);
  });

  test("without the signing key nothing is made, and the form says why", async () => {
    expect(await submit({ intent: "link.issue", days: "7", note: "", nonce: NONCE }, { photoLinkSecret: undefined })).toEqual({
      ok: false, section: "links", form: "link-new", errors: { form: "links can't be made until PHOTO_LINK_SECRET is set." }, values: { days: "7", note: "" },
    });
    expect(await grants()).toHaveLength(0);
  });
});

describe("revoking a link", () => {
  test("needs the box ticked; ticked, it's saved, and a second revoke is still saved", async () => {
    await issue();
    const [{ id }] = await grants();
    expect(await submit({ intent: "link.revoke", id: String(id) })).toEqual({ ok: false, section: "links", form: `link-${id}`, errors: { confirm: "tick the box to remove it" }, values: {} });
    expect(await submit({ intent: "link.revoke", id: String(id), confirm: "yes" })).toEqual({ ok: true, section: "links" });
    expect((await grants())[0].revoked_at).not.toBeNull();
    expect(await submit({ intent: "link.revoke", id: String(id), confirm: "yes" })).toEqual({ ok: true, section: "links" });
  });

  test("a malformed id is a message for the page", async () => {
    expect(await submit({ intent: "link.revoke", id: "nope", confirm: "yes" })).toEqual({ ok: false, section: null, form: "", errors: { form: "that link no longer exists" }, values: {} });
  });
});
```

Create `tests/unit/links-admin.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import LinksAdmin from "../../src/components/admin/LinksAdmin.astro";
import type { ActionFailure } from "../../src/lib/admin/actions";
import type { AdminLink } from "../../src/lib/admin/store";
import { render, text } from "./render";

// Made at 14:30 UTC on 7 October, which is the 8th in Sydney; works until 15.10.26
const LINK: AdminLink = { id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", createdAt: "2026-10-07 14:30:00", expiresAt: 1792035000, note: "for mum" };
const props = (over: Record<string, unknown> = {}) => ({ links: [LINK], failure: null, issued: null, ...over });

describe("LinksAdmin", () => {
  test("the issue form carries a fresh 16-byte nonce on every render", async () => {
    const nonce = async () => (await render(LinksAdmin, props())).querySelector('#link-new input[name="nonce"]')!.getAttribute("value")!;
    const [one, two] = [await nonce(), await nonce()];
    expect(one).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(two).not.toBe(one);
  });

  test("the issue form asks for days (7 to start) and a note", async () => {
    const doc = await render(LinksAdmin, props());
    expect(doc.querySelector("#link-new-days")!.getAttribute("value")).toBe("7");
    expect(text(doc.querySelector("#link-new-note-hint"))).toBe("who it's for, so you know which to revoke");
  });

  test("an issued link is shown once, read-only, with a copy button the script reveals", async () => {
    const doc = await render(LinksAdmin, props({ issued: { url: "https://curiousgeorge.dev/photos/downloads?token=abc" } }));
    expect(text(doc.querySelector(".notice"))).toBe("here's the link. copy it now - it can't be shown again.");
    const field = doc.querySelector("#issued-link")!;
    expect([field.getAttribute("value"), field.hasAttribute("readonly")]).toEqual(["https://curiousgeorge.dev/photos/downloads?token=abc", true]);
    const copy = doc.querySelector('button[data-copy="issued-link"]')!;
    expect([text(copy), copy.hasAttribute("hidden")]).toEqual(["copy", true]);
  });

  test("a repeated form says the link was already made, and shows none", async () => {
    const doc = await render(LinksAdmin, props({ issued: { repeat: true } }));
    expect(text(doc.querySelector(".notice"))).toBe("that link was already made. it's in the list below, but it can't be shown again.");
    expect(doc.querySelector("#issued-link")).toBeNull();
  });

  test("each active link says when it was made, until when it works and its note, with a revoke form", async () => {
    const doc = await render(LinksAdmin, props());
    const row = doc.querySelector(`#link-${LINK.id}`)!;
    expect(text(row.querySelector("p"))).toBe("made 08.10.26 · works until 15.10.26 · for mum");
    expect(row.querySelector('input[name="intent"]')!.getAttribute("value")).toBe("link.revoke");
    expect(text(row.querySelector(".confirm"))).toBe("yes, switch this link off");
    expect(text(row.querySelector("button"))).toBe("revoke");
  });

  test("with no links working it says so", async () => {
    expect(text((await render(LinksAdmin, props({ links: [] }))).querySelector(".empty"))).toBe("no links are working right now.");
  });

  test("a failed issue reopens with what was typed and what's wrong", async () => {
    const failure: ActionFailure = { ok: false, section: "links", form: "link-new", errors: { days: "a number of days from 1 to 30" }, values: { days: "40", note: "for mum" } };
    const doc = await render(LinksAdmin, props({ failure }));
    expect(doc.querySelector("#link-new-days")!.getAttribute("value")).toBe("40");
    expect(text(doc.querySelector("#link-new-days-error"))).toBe("a number of days from 1 to 30");
  });
});
```

In `tests/unit/store.test.ts`, add at the end of `"reads the seeded logbook, every log entry and every record"`:

```ts
    expect(data.links).toEqual([]);
```

and add at the end of the file:

```ts
describe("links", () => {
  test("loadAdmin lists only the catalogue links still working, newest first", async () => {
    const add = (id: string, photo: string | null, expires: number, revoked: number | null, created: string, note: string | null) =>
      db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at, revoked_at, created_at, note) VALUES (?, ?, ?, ?, ?, ?)").bind(id, photo, expires, revoked, created, note).run();
    await add("a0000000-0000-4000-8000-000000000001", null, 2000, null, "2026-10-01 00:00:00", "older");
    await add("a0000000-0000-4000-8000-000000000002", null, 2000, null, "2026-10-02 00:00:00", null);
    await add("a0000000-0000-4000-8000-000000000003", null, 2000, 1500, "2026-10-03 00:00:00", "revoked");
    await add("a0000000-0000-4000-8000-000000000004", null, 900, null, "2026-10-04 00:00:00", "expired");
    const { links } = await store.loadAdmin(db, 1000);
    expect(links).toEqual([
      { id: "a0000000-0000-4000-8000-000000000002", createdAt: "2026-10-02 00:00:00", expiresAt: 2000, note: null },
      { id: "a0000000-0000-4000-8000-000000000001", createdAt: "2026-10-01 00:00:00", expiresAt: 2000, note: "older" },
    ]);
  });
});
```

In `tests/unit/submit.test.ts`, add inside `describe("submitForm", ...)`:

```ts
  test("issuing a link answers with it, without a redirect or a purge", async () => {
    const purge = cache();
    const form = formOf({ intent: "link.issue", days: "7", note: "", nonce: "AbCdEfGhIjKlMnOpQrStUv" });
    const outcome = await submitForm(form, { ...deps(), photoLinkSecret: "1".repeat(64), origin: "https://curiousgeorge.dev" }, purge, waiter().waitUntil);
    expect(outcome).toEqual({ issued: { url: expect.stringMatching(/^https:\/\/curiousgeorge\.dev\/photos\/downloads\?token=/) } });
    expect(purge.invalidate).not.toHaveBeenCalled();
  });

  test("revoking a link redirects to its section and purges nothing", async () => {
    await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES ('a0000000-0000-4000-8000-000000000009', NULL, 9999999999)").run();
    const purge = cache();
    const outcome = await submitForm(formOf({ intent: "link.revoke", id: "a0000000-0000-4000-8000-000000000009", confirm: "yes" }), deps(), purge, waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=links#links" });
    expect(purge.invalidate).not.toHaveBeenCalled();
  });
```

Run: `bun run test:unit tests/unit/link-actions.test.ts tests/unit/links-admin.test.ts tests/unit/store.test.ts tests/unit/submit.test.ts`
Expected: FAIL: the intents aren't recognised, `LinksAdmin.astro` doesn't exist and `loadAdmin` has no `links`.

- [ ] **Step 2: The grant, the validation and the store**

In `src/lib/photos/store.ts`, replace `insertGrant` with:

```ts
/**
 * Records a grant. A note says who a catalogue link is for; a nonce is the admin form's, unique, so the same form sent
 * twice makes one grant (spec 6.3). False when that nonce was already used. The token itself is never stored.
 */
export async function insertGrant(db: D1Database, token: PhotoToken, extra: { note?: string | null; nonce?: string | null } = {}): Promise<boolean> {
  const result = await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at, note, request_nonce) VALUES (?, ?, ?, ?, ?) ON CONFLICT(request_nonce) DO NOTHING")
    .bind(token.grantId, token.photoId, token.expiresAt, extra.note ?? null, extra.nonce ?? null).run();
  return result.meta.changes > 0;
}
```

In `src/lib/admin/validate.ts`, add at the end:

```ts
// Links (spec 6.3)

export const LINK_FIELDS = ["days", "note", "nonce"] as const;

export interface LinkInput {
  days: number;
  note: string | null;
}

export function checkLink(fields: Fields): Checked<LinkInput> {
  const errors: Fields = {};
  if (!/^\d{1,2}$/.test(fields.days) || Number(fields.days) < 1 || Number(fields.days) > 30) errors.days = "a number of days from 1 to 30";
  if (CONTROL.test(fields.note)) errors.note = "one line of plain text";
  tooLong(errors, fields, "note", 60);
  return finish(errors, () => ({ days: Number(fields.days), note: orNull(fields.note) }));
}
```

In `src/lib/admin/store.ts`, add after the `AdminPost` interface:

```ts
/** A catalogue link still working (spec 6.3) */
export interface AdminLink {
  id: string;
  /** D1's CURRENT_TIMESTAMP: UTC, written 2026-10-08 05:30:00 */
  createdAt: string;
  expiresAt: number;
  note: string | null;
}
```

add `links: AdminLink[];` to `AdminData` after `photographs: AdminPost[];`, and in `loadAdmin` change the signature and batch to:

```ts
export async function loadAdmin(db: D1Database, now = Math.floor(Date.now() / 1000)): Promise<AdminData> {
  const [items, log, facts, records, photographs, links] = await db.batch([
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY section, position`),
    db.prepare("SELECT id, date, precision, text FROM log_entries ORDER BY date DESC, created_at DESC, id DESC"),
    db.prepare("SELECT key, title, subtitle FROM facts"),
    db.prepare(`SELECT ${RECORD_COLUMNS} FROM records ORDER BY active DESC, position`),
    db.prepare(PHOTOGRAPHS),
    // Catalogue links only: plan B's order grants carry a photo
    db.prepare("SELECT id, created_at, expires_at, note FROM photo_download_grants WHERE photo_id IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC, rowid DESC").bind(now),
  ]);
```

and add to the returned object after `photographs: ...`:

```ts
    links: (links.results as unknown as { id: string; created_at: string; expires_at: number; note: string | null }[]).map((row) => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, note: row.note })),
```

(the doc comment above `loadAdmin` becomes `/** Everything the admin page shows, in one batch: unlike the logbook, every log entry, every record, every photograph and every working link */`).

- [ ] **Step 3: The actions, the outcome and the purge**

In `src/lib/admin/actions.ts`:

Add `import { insertGrant, revokeGrant } from "../photos/store";` to the imports, change the tokens import (Task 6's) to:

```ts
import { GRANT_ID, PHOTO_ID, photoSigningKey, signPhotoToken } from "../photos/tokens";
```

and add `checkLink` and `LINK_FIELDS` to the import from `"./validate"`.

Change the `AdminSection` line to:

```ts
export type AdminSection = "now" | "before" | "log" | "lately" | "records" | "snapshots" | "photographs" | "links";
```

In `ActionDeps`, add after `prints?: R2Bucket;`:

```ts
  /** PHOTO_LINK_SECRET, which signs a new link (spec 6.3) */
  photoLinkSecret?: string;
  /** The site's origin, for a new link's address */
  origin?: string;
```

Replace the `ActionResult` line with:

```ts
/** A new link exists only in the response that made it (spec 6.3): its address, or word that the same form already made one */
export type IssuedLink = { url: string } | { repeat: true };

export type ActionResult = { ok: true; section: AdminSection; issued?: IssuedLink } | ActionFailure;
```

Change the `gone` line to:

```ts
const gone = (what: "line" | "entry" | "record" | "post" | "photo" | "link") => fail(null, "", { form: `that ${what} no longer exists` });
```

In `runAction`'s switch, add before `default:`:

```ts
    case "link.issue":
      return issueLink(form, deps);
    case "link.revoke":
      return revokeLink(form, deps);
```

and add at the end of the file:

```ts
// Links (spec 6.3)

/** 16 random bytes in base64url, from the form: the same form sent twice makes one link */
const NONCE = /^[A-Za-z0-9_-]{22}$/;

async function issueLink(form: FormData, deps: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, LINK_FIELDS);
  const values = { days: fields.days, note: fields.note };
  if (!NONCE.test(fields.nonce)) return fail(null, "", { form: "that form is out of date. reload the page and try again." });
  const checked = checkLink(fields);
  if (!checked.ok) return fail("links", "link-new", checked.errors, values);
  try {
    photoSigningKey(deps.photoLinkSecret);
  } catch {
    return fail("links", "link-new", { form: "links can't be made until PHOTO_LINK_SECRET is set." }, values);
  }
  const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: Math.floor(Date.now() / 1000) + checked.value.days * 86400 };
  const token = await signPhotoToken(deps.photoLinkSecret!, grant);
  if (!(await insertGrant(deps.db, grant, { note: checked.value.note, nonce: fields.nonce }))) return { ok: true, section: "links", issued: { repeat: true } };
  const url = new URL("/photos/downloads", deps.origin ?? "https://curiousgeorge.dev");
  url.searchParams.set("token", token);
  return { ok: true, section: "links", issued: { url: url.href } };
}

async function revokeLink(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const id = String(form.get("id") ?? "");
  if (!GRANT_ID.test(id)) return gone("link");
  if (!confirmed(form)) return fail("links", `link-${id}`, CONFIRM);
  // Already revoked counts as saved (ADR-0012)
  await revokeGrant(db, id);
  return { ok: true, section: "links" };
}
```

In `src/lib/admin/submit.ts`:

Change the import to `import { runAction, type ActionDeps, type ActionFailure, type AdminSection, type IssuedLink } from "./actions";`, change the `SubmitOutcome` line to:

```ts
/** What the page does next: redirect to the saved section (303), show a link just issued (200) or show the page again with this failure and status */
export type SubmitOutcome = { redirect: string } | { issued: IssuedLink } | { failure: ActionFailure; status: 422 | 500 };
```

add `links: [],` to `PURGES` after `photographs: ["photos", "logbook"],`, and replace the two lines from `const purged = await purgeTags(cache, PURGES[result.section]);` down to the `return { redirect: ... }` with:

```ts
      // The link exists only in this response, so it isn't a redirect (spec 6.3); links purge nothing
      if (result.issued) return { issued: result.issued };
      const tags = PURGES[result.section];
      const purged = tags.length === 0 || (await purgeTags(cache, tags));
      return { redirect: `/admin/?saved=${result.section}${purged ? "" : "&later=1"}#${result.section}` };
```

Run: `bun run test:unit tests/unit/link-actions.test.ts tests/unit/store.test.ts tests/unit/submit.test.ts`
Expected: PASS.

- [ ] **Step 4: The section on the page**

In `src/components/admin/RemoveForm.astro`, replace the frontmatter's `Props` and destructuring with:

```ts
interface Props {
  /** The failure form id this reports to, so an unticked remove reopens its entry */
  form: string;
  intent: "item.remove" | "log.remove" | "record.remove" | "link.revoke";
  id: number | string;
  /** The checkbox's wording */
  confirm: string;
  section?: string;
  error?: string;
  /** The button's word: remove, or revoke for a link */
  button?: string;
}

const { form, intent, id, confirm, section, error, button = "remove" } = Astro.props;
```

and change `<button type="submit" class="button quiet">remove</button>` to `<button type="submit" class="button quiet">{button}</button>`.

Create `src/components/admin/LinksAdmin.astro`:

```astro
---
import Field from "./Field.astro";
import RemoveForm from "./RemoveForm.astro";
import { formState } from "../../lib/admin/form-state";
import type { ActionFailure, IssuedLink } from "../../lib/admin/actions";
import type { AdminLink } from "../../lib/admin/store";
import { formatLogDate } from "../../lib/text";
import { sydneyDate } from "../../lib/time";

interface Props {
  links: AdminLink[];
  failure: ActionFailure | null;
  /** The link this response just made, or word that the same form had already made one */
  issued: IssuedLink | null;
}

const { links, failure, issued } = Astro.props;
// New on every render, so a repeated post of this form (a double tap, a reload) makes no second link (spec 6.3)
const bytes = crypto.getRandomValues(new Uint8Array(16));
const nonce = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fresh = formState(failure, "link-new", { days: "7", note: "" });
const day = (when: Date) => formatLogDate(sydneyDate(when), "day");
// D1's CURRENT_TIMESTAMP is UTC, written 2026-10-08 05:30:00
const made = (createdAt: string) => day(new Date(`${createdAt.replace(" ", "T")}Z`));
---
{issued && ("url" in issued ? (
  <div class="issued">
    <p class="notice" role="status">here's the link. copy it now - it can't be shown again.</p>
    <div class="field">
      <label for="issued-link">the link</label>
      <input id="issued-link" type="text" value={issued.url} readonly autocapitalize="none" autocorrect="off" spellcheck="false" />
    </div>
    <button type="button" class="button" data-copy="issued-link" hidden>copy</button>
  </div>
) : (
  <p class="notice" role="status">that link was already made. it's in the list below, but it can't be shown again.</p>
))}
<form method="post" action="/admin/#link-new" id="link-new" class="admin-form">
  <h3>issue a link</h3>
  {fresh.errors.form && <p class="error" role="alert">{fresh.errors.form}</p>}
  <input type="hidden" name="intent" value="link.issue" />
  <input type="hidden" name="nonce" value={nonce} />
  <Field form="link-new" name="days" label="days it works" value={fresh.values.days} error={fresh.errors.days} required plain maxlength={2} hint="1 to 30." />
  <Field form="link-new" name="note" label="note" value={fresh.values.note} error={fresh.errors.note} maxlength={60} hint="who it's for, so you know which to revoke" />
  <button type="submit" class="button">issue a link</button>
</form>
{links.length === 0 ? (
  <p class="empty">no links are working right now.</p>
) : (
  <ol class="entries links-admin">
    {links.map((link) => {
      const id = `link-${link.id}`;
      const { errors } = formState(failure, id, {});
      return (
        <li class="entry" id={id}>
          <div>
            <p>made {made(link.createdAt)} · works until {day(new Date(link.expiresAt * 1000))}{link.note && ` · ${link.note}`}</p>
            <RemoveForm form={id} intent="link.revoke" id={link.id} confirm="yes, switch this link off" button="revoke" error={errors.confirm} />
          </div>
        </li>
      );
    })}
  </ol>
)}
{issued && "url" in issued && (
  <script>
    import "../../scripts/copy-link";
  </script>
)}
```

Create `src/scripts/copy-link.ts`:

```ts
// The copy button beside a link just issued (spec 6.3). Without JavaScript it stays hidden and the link is selectable.
for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  const field = document.getElementById(button.dataset.copy ?? "");
  if (!(field instanceof HTMLInputElement)) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      button.textContent = "copied";
    } catch {
      // No clipboard (an older browser, a refused permission): select it so it can be copied by hand
      field.focus();
      field.select();
      button.textContent = "selected - copy it from there";
    }
  });
}
```

In `src/styles/admin.css`, add at the end:

```css
/* Links (spec 6.3): the link just issued, then the issue form and the working links */
.issued { display: grid; gap: 10px; justify-items: start; max-width: 34rem; margin-bottom: 16px; }
.issued .field { width: 100%; }
.links-admin .entry { grid-template-columns: minmax(0, 1fr); }
.links-admin .entry p { padding-top: 8px; font-size: 14.5px; }
```

In `src/pages/admin/index.astro`:

Add to the imports:

```ts
import LinksAdmin from "../../components/admin/LinksAdmin.astro";
import type { IssuedLink } from "../../lib/admin/actions";
```

Change the `SECTIONS` line to:

```ts
const SECTIONS: readonly AdminSection[] = ["now", "before", "log", "lately", "records", "snapshots", "photographs", "links"];
```

Replace the POST block (from `let failure: ActionFailure | null = null;` down to its closing `}`) with:

```ts
let failure: ActionFailure | null = null;
// A link just issued: shown in this response only, at status 200 (spec 6.3)
let issued: IssuedLink | null = null;
if (Astro.request.method === "POST") {
  const form = await Astro.request.formData().catch(() => null);
  const deps = {
    db: env.DB, media: env.MEDIA, images: env.IMAGES, snapshots: env.SNAPSHOTS, prints: env.PHOTO_PRINTS,
    photoLinkSecret: env.PHOTO_LINK_SECRET, origin: Astro.url.origin,
  };
  const outcome = await submitForm(form, deps, Astro.cache, (promise) => Astro.locals.cfContext.waitUntil(promise));
  if ("redirect" in outcome) return Astro.redirect(outcome.redirect, 303);
  if ("issued" in outcome) issued = outcome.issued;
  else {
    failure = outcome.failure;
    Astro.response.status = outcome.status;
  }
}
```

Replace the `savedLine` function with:

```ts
const savedLine = (section: AdminSection) => {
  if (section === "links") return "saved - that link no longer works.";
  const where = section === "photographs" ? "gallery" : "logbook";
  return later ? `saved - the ${where} may show the old version for a little while.` : `saved - it's on the ${where} now.`;
};
```

and add after the photographs `AdminRow`:

```astro
    <AdminRow label="links" id="links" notice={notice("links")}><LinksAdmin links={data.links} failure={failure} issued={issued} /></AdminRow>
```

Run: `bun run test:unit tests/unit/links-admin.test.ts && bun run typecheck && bun run test:unit`
Expected: PASS; 0 errors; every unit test passes.

- [ ] **Step 5: The e2e specs**

In `tests/e2e/admin-layout.spec.ts`, change the labels to `["admin", "now", "lately", "log", "records", "before", "snapshots", "photographs", "links"]`.

Create `tests/e2e/admin-links.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, openAdmin, unique } from "./admin";

test.skip(({ browserName }) => browserName !== "chromium", "writes to the admin store: checked once, in chromium");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");

const POSTED = (response: { request(): { method(): string } }) => response.request().method() === "POST";

/** Issues a link through the form; returns the address shown and the nonce the form carried */
async function issue(page: Page, note: string) {
  await openAdmin(page);
  const form = page.locator("#link-new");
  const nonce = await form.locator('input[name="nonce"]').inputValue();
  await form.getByLabel("days it works").fill("2");
  await form.getByLabel("note").fill(note);
  const [response] = await Promise.all([page.waitForResponse(POSTED), form.getByRole("button", { name: "issue a link", exact: true }).click()]);
  expect(response.status()).toBe(200);
  await expect(page.locator("#links .notice")).toHaveText("here's the link. copy it now - it can't be shown again.");
  return { url: await page.locator("#issued-link").inputValue(), nonce };
}

test("a link is shown once and the same form again makes no second one; revoking it switches it off", async ({ page }) => {
  const note = `e2e ${unique()}`;
  const { url, nonce } = await issue(page, note);
  expect(new URL(url).pathname).toBe("/photos/downloads");
  await expect(page.locator("#issued-link")).toHaveAttribute("readonly", "");
  expect((await page.request.get(url)).status()).toBe(200);

  // The same form sent again, as a double tap or a reload would
  const again = await page.request.post(`${ADMIN}/admin/`, { headers: { Origin: ADMIN }, form: { intent: "link.issue", days: "2", note, nonce } });
  expect(again.status()).toBe(200);
  const body = await again.text();
  expect(body).toContain("that link was already made. it's in the list below, but it can't be shown again.");
  expect(body).not.toContain('id="issued-link"');

  await openAdmin(page);
  const row = page.locator("#links li.entry", { hasText: note });
  await expect(row).toHaveCount(1);
  await expect(row.locator("p").first()).toHaveText(new RegExp(`^made \\d{2}\\.\\d{2}\\.\\d{2} · works until \\d{2}\\.\\d{2}\\.\\d{2} · ${note}$`));
  await row.getByLabel("yes, switch this link off").check();
  await row.getByRole("button", { name: "revoke", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=links#links$/);
  await expect(page.locator("#links .notice")).toHaveText("saved - that link no longer works.");
  await expect(page.locator("#links li.entry", { hasText: note })).toHaveCount(0);
  expect((await page.request.get(url)).status()).toBe(403);
});

test("copy puts the link on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ADMIN });
  const { url } = await issue(page, `e2e ${unique()}`);
  await page.getByRole("button", { name: "copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});
```

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/admin-links.spec.ts tests/e2e/admin-layout.spec.ts tests/e2e/admin-photos.spec.ts tests/e2e/downloads.spec.ts --project=chromium`
Expected: every test passes.

Run: `bun run test:e2e tests/e2e/admin-layout.spec.ts --project=phone`
Expected: passes: the links section fits a phone, its fields 16px and its buttons 44px.

Look at it (Global constraints, visual checks) at `http://localhost:4336/admin/`, then issue a link through the form on 4336 and look at the response at 375px: the notice, the link's field across the column, `copy` under it, the issue form below and the list of working links with their revoke boxes. The store is thrown away afterwards, so nothing needs revoking.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/LinksAdmin.astro src/scripts/copy-link.ts src/lib/photos/store.ts src/lib/admin/actions.ts src/lib/admin/validate.ts src/lib/admin/store.ts src/lib/admin/submit.ts src/components/admin/RemoveForm.astro src/pages/admin/index.astro src/styles/admin.css tests/unit/link-actions.test.ts tests/unit/links-admin.test.ts tests/unit/store.test.ts tests/unit/submit.test.ts tests/e2e/admin-links.spec.ts tests/e2e/admin-layout.spec.ts
git commit -m "feat: the admin's links section: issue a catalogue link once, list and revoke them"
```

---
### Task 12: privacy, budgets, layout shift, Lighthouse and the docs

The checks spec 9 and 10 set for the new pages, and the docs. The privacy test adds `/photos`, a photograph's page and a downloads page: no `Set-Cookie`, empty storage, every request first party. The budget spec weighs `/photos` and a photograph's page (JavaScript under 10KB, HTML under 30KB, CSS under 15KB, two fonts, every script inline) and gates the images `/photos` loads before any scroll at 375 × 812 under 250KB. The perf spec holds layout shift under 0.01 at 1280px and 375px on `/photos` (after a batch loads too) and on a photograph's page. Lighthouse measures `/photos` and the newest photograph's page after each deploy, and the deploy purges the gallery's cached pages as well as the home page. The docs say what plan 6 built.

**Files:**
- Modify: `tests/e2e/privacy.spec.ts` (whole file below), `tests/e2e/budgets.spec.ts` (whole file below), `tests/e2e/perf.spec.ts`, `scripts/lighthouse.mjs` (whole file below), `.github/workflows/ci.yml`, `docs/photo-gallery-backend.md` (whole file below), `README.md`, `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`
- Create: `docs/superpowers/plans/2026-10-08-plan-6-followups.md`
- Test: `tests/e2e/privacy.spec.ts`, `tests/e2e/budgets.spec.ts`, `tests/e2e/perf.spec.ts`

**Interfaces:**
- Consumes: every page from Tasks 7 to 10; `GALLERY` from `tests/e2e/gallery-site.ts` (Task 1); `ADMIN` from `tests/e2e/admin.ts`; `withGpc` from `tests/e2e/gpc.ts`; `SLOW` from `tests/e2e/deck.ts`; the entry mode (Task 1).
- Produces: `scripts/lighthouse.mjs` given one root URL measures it, `/photos` and the newest photograph's page.

- [ ] **Step 1: The privacy test**

Replace `tests/e2e/privacy.spec.ts` with:

```ts
import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "./admin";
import { SLOW } from "./deck";
import { GALLERY } from "./gallery-site";
import { withGpc } from "./gpc";

/** Records, from here on, every cookie a response sets and every request to another origin */
function watch(page: Page, origin: string) {
  const seen = { setCookies: [] as string[], foreign: [] as string[], checks: [] as Promise<void>[] };
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("data:") && new URL(url).origin !== origin) seen.foreign.push(url);
  });
  page.on("response", (response) => {
    seen.checks.push(
      response.allHeaders().then((headers) => {
        if (headers["set-cookie"]) seen.setCookies.push(`${response.url()}: ${headers["set-cookie"]}`);
      }),
    );
  });
  return seen;
}

/** The visitor info's promises: cookies none, storage empty, every request first party */
async function expectPrivate(page: Page, seen: ReturnType<typeof watch>) {
  await Promise.all(seen.checks);
  expect(seen.setCookies).toEqual([]);
  expect(seen.foreign).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.context().cookies()).toEqual([]);
}

test("cookies none, storage empty, every request first party", async ({ page, baseURL }) => {
  // Playing a record brings the 3D scene in (the list scrolls into view), so this gets the scene specs' budget
  test.setTimeout(90_000 * SLOW);
  // Against the live site the beacon would count this check as a visit; Global Privacy Control switches it off (the
  // proxy is checked separately below)
  if (process.env.PLAYWRIGHT_BASE_URL) await withGpc(page);
  const seen = watch(page, new URL(baseURL!).origin);
  // A unique query (set by CI after a deploy) bypasses the edge cache, so the new version is what gets checked
  await page.goto(process.env.PRIVACY_PATH ?? "/");
  // Content-agnostic: exercise the pill and the toggle when production has them, tolerate their absence
  const pill = page.locator(".peek").first();
  if (await pill.count()) await pill.click();
  const more = page.locator("#log .more");
  if (await more.count()) await more.click();
  await page.waitForLoadState("networkidle");
  // Play and stop a record when there is one: audio streams first party from /media and sets nothing
  const track = page.locator(".tracks button").first();
  if (await track.count()) {
    await track.click();
    await page.waitForTimeout(1500);
    await track.click();
  }
  await expectPrivate(page, seen);
});

test("the photo pages set no cookies, keep storage empty and stay first party", async ({ page, baseURL }) => {
  if (process.env.PLAYWRIGHT_BASE_URL) await withGpc(page);
  // Locally the gallery server's fixture; after a deploy, the live site
  const site = process.env.PLAYWRIGHT_BASE_URL ? baseURL! : GALLERY;
  const seen = watch(page, new URL(site).origin);
  // A fresh query misses the edge cache, so a deploy's new version is what gets checked
  await page.goto(new URL(`/photos?fresh=${Date.now()}`, site).href, { waitUntil: "networkidle" });
  // Content-agnostic, so it passes on the live site before anything is published: follow a frame when there is one
  const frame = page.locator("a.frame-link").first();
  if (await frame.count()) {
    await frame.click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".photo img")).toBeVisible();
  }
  await expectPrivate(page, seen);
});

test("a downloads page sets no cookies and loads nothing from elsewhere", async ({ page, request }) => {
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs a link from the local admin server");
  const issued = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: {} });
  const { url } = (await issued.json()) as { url: string };
  const seen = watch(page, ADMIN);
  await page.goto(url, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("photos, full size");
  await expectPrivate(page, seen);
});

// Only against a deployed site: the local test build's Access bypass answers /admin/ with the page, by design.
// Before the Access application exists the Worker itself refuses (403); afterwards Access answers with a redirect to its
// sign-in. Either way, an anonymous visitor must never get the page.
test("an anonymous request to /admin/ is never served the page", async ({ request }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "the local test build skips Access");
  const response = await request.get("/admin/", { maxRedirects: 0 });
  expect(response.status(), "/admin/ answered an anonymous visitor").not.toBe(200);
});

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

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/privacy.spec.ts`
Expected: every test passes in chromium and webkit; the photo pages follow a frame to `/photos/fixture-01`.

- [ ] **Step 2: The budgets**

Replace `tests/e2e/budgets.spec.ts` with:

```ts
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { SLOW } from "./deck";
import { GALLERY } from "./gallery-site";

/** What a page loads before any interaction: scripts, styles and HTML gzipped, fonts as they are, inline ones counted */
async function weigh(page: Page, path: string) {
  const sizes = { js: 0, css: 0, html: 0, font: 0, fonts: 0 };
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!["script", "stylesheet", "document", "font"].includes(type) || response.status() >= 300) return;
    reads.push(
      response.body().then((body) => {
        if (type === "font") { sizes.font += body.length; sizes.fonts += 1; return; }
        const bytes = gzipSync(body).length;
        if (type === "script") sizes.js += bytes;
        if (type === "stylesheet") sizes.css += bytes;
        if (type === "document") sizes.html += bytes;
      }),
    );
  });
  await page.goto(path, { waitUntil: "networkidle" });
  await Promise.all(reads);
  // Astro inlines small page scripts and every stylesheet into the HTML, so count those too
  const inline = await page.evaluate(() => ({
    js: [...document.querySelectorAll("script:not([src])")].map((s) => s.textContent ?? "").join("\n"),
    css: [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n"),
  }));
  sizes.js += gzipSync(inline.js).length;
  sizes.css += gzipSync(inline.css).length;
  return sizes;
}

test("page weight stays inside the budgets", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  // A short window keeps the turntable out of reach, so this measures only what loads before any interaction;
  // the scene is measured on its own below
  await page.setViewportSize({ width: 1280, height: 400 });
  const sizes = await weigh(page, "/");
  console.log("budgets (bytes)", sizes);
  expect(sizes.js).toBeGreaterThan(0);
  expect(sizes.js).toBeLessThan(10 * 1024);
  expect(sizes.css).toBeLessThan(15 * 1024);
  expect(sizes.html).toBeLessThan(30 * 1024);
  expect(sizes.fonts).toBe(2);
  expect(sizes.font).toBeLessThan(60 * 1024);
});

// Photo gallery spec 10, on the gallery server's photo fixture
for (const path of ["/photos", "/photos/fixture-01"]) {
  test(`${path} stays inside the page budgets, with every script inline`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "measured once, in Chromium");
    test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "measured on the local photo fixture");
    const sizes = await weigh(page, `${GALLERY}${path}`);
    console.log(`budgets for ${path} (bytes)`, sizes);
    expect(sizes.js).toBeGreaterThan(0);
    expect(sizes.js).toBeLessThan(10 * 1024);
    expect(sizes.css).toBeLessThan(15 * 1024);
    expect(sizes.html).toBeLessThan(30 * 1024);
    expect(sizes.fonts).toBe(2);
    await expect(page.locator("script[src]")).toHaveCount(0);
  });
}

test("/photos loads under 250KB of images before any scroll at 375 × 812", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "measured on the local photo fixture");
  await page.setViewportSize({ width: 375, height: 812 });
  let bytes = 0;
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "image" || response.status() >= 300) return;
    reads.push(response.body().then((body) => { bytes += body.length; }));
  });
  await page.goto(`${GALLERY}/photos`, { waitUntil: "networkidle" });
  await Promise.all(reads);
  console.log("images before any scroll on /photos at 375px (bytes)", bytes);
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThan(250 * 1024);
});

test("the scene chunk stays under 190KB gzipped", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  test.setTimeout(90_000 * SLOW);
  const scripts = new Map<string, Promise<number>>();
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.set(response.url(), response.body().then((body) => gzipSync(body).length));
  });
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/", { waitUntil: "networkidle" });
  const early = new Set(scripts.keys());
  await page.locator("[data-deck]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-deck].live")).toHaveCount(1, { timeout: 60_000 * SLOW });
  const late = [...scripts].filter(([url]) => !early.has(url));
  const sizes = await Promise.all(late.map(([, size]) => size));
  console.log("scene (gzipped bytes)", Object.fromEntries(late.map(([url], i) => [new URL(url).pathname, sizes[i]])));
  expect(late.some(([url]) => /\/_astro\/scene\./.test(url))).toBe(true);
  expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(190 * 1024);
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

In `tests/e2e/perf.spec.ts`, add `import { GALLERY } from "./gallery-site";` to its imports, and add at the end:

```ts
/** Layout shift from the very start of the page, summed in the page as it happens */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const store = window as unknown as { shifted: number };
    store.shifted = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) store.shifted += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}
const shifted = (page: Page) => page.evaluate(() => (window as unknown as { shifted: number }).shifted);

// Photo gallery spec 10, on the gallery server's photo fixture
for (const [width, height] of [[1280, 800], [375, 812]]) {
  test(`nothing shifts on /photos at ${width}px, before or after the next entries load`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await watchShifts(page);
    await page.goto(`${GALLERY}/photos`, { waitUntil: "networkidle" });
    // On the fixture the link starts inside the script's 800px margin, so the batch loads as the page does; what matters
    // is that the appended entries land below the fold, where they can't shift anything in view
    await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
    expect(await page.locator("ol.entries > li.entry").nth(4).evaluate((li) => li.getBoundingClientRect().top)).toBeGreaterThan(height);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const cls = await shifted(page);
    test.info().annotations.push({ type: "cls", description: `layout shift on /photos at ${width}px: ${cls}` });
    expect(cls).toBeLessThan(0.01);
  });

  test(`nothing shifts on a photo's page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await watchShifts(page);
    await page.goto(`${GALLERY}/photos/fixture-b-01`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const cls = await shifted(page);
    test.info().annotations.push({ type: "cls", description: `layout shift on a photo's page at ${width}px: ${cls}` });
    expect(cls).toBeLessThan(0.01);
  });
}
```

Run: `pkill -f "port 433[0-9]"; bun run build:test && bun run test:e2e tests/e2e/budgets.spec.ts tests/e2e/perf.spec.ts --project=chromium`
Expected: every test passes; the log shows the photo pages' JavaScript well under 10KB (the beacon and `photo-sheet.ts`), and annotations show layout shift near 0 for each page and width.

- [ ] **Step 3: Lighthouse on the photo pages**

Replace `scripts/lighthouse.mjs` with:

```js
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
```

Run: `pkill -f "port 433[0-9]"; bun run build:test`, then start the gallery server's command from `playwright.config.ts` (`rm -rf .wrangler/gallery && wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/gallery && node scripts/seed-photo-test.mjs --persist-to .wrangler/gallery && wrangler dev -c dist/server/wrangler.json --port 4335 --persist-to .wrangler/gallery`) in the background, wait for it with `curl --retry 30 --retry-connrefused --retry-delay 1 -sf http://localhost:4335/ -o /dev/null`, run `bun run lighthouse http://localhost:4335/` and stop the server (`pkill -f "port 4335"`).
Expected: three medians, for `http://localhost:4335/`, `http://localhost:4335/photos` and `http://localhost:4335/photos/fixture-01` (the newest post's first published photograph). A local over-budget line is a warning, not a failure; read each and note any in the task report.

In `.github/workflows/ci.yml`, in the `deploy` job, rename the step `Purge the cached home page` to `Purge the cached pages` and change its `--data '{"tags":["logbook"]}'` to `--data '{"tags":["logbook","photos"]}'`, so changed gallery markup isn't served from the edge for up to five minutes after a deploy.

Run: `grep -n "Purge the cached pages" -A 4 .github/workflows/ci.yml`
Expected: the renamed step, with `"tags":["logbook","photos"]`.

- [ ] **Step 4: The docs**

Replace `docs/photo-gallery-backend.md` with:

````markdown
# Photo gallery

George's photographs on the site: `/photos`, a page for each photograph, a private downloads page behind catalogue links, the owner's photographs and links sections in `/admin` and a line on the home page while anything is published. Designed in [the photo gallery spec](superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md) (part 1), built in [plan 6](superpowers/plans/2026-10-08-plan-6-photo-gallery.md) on Codex's backend of `a65ecc6`. Decisions: [ADR-0020](adr/0020-photo-downloads-use-revocable-signed-links.md) (links), [ADR-0022](adr/0022-photo-places-are-area-and-city-only.md) (places).

## Pages and routes

| Route | Behaviour |
| --- | --- |
| `/photos` | The gallery: one entry per Instagram post with a published photograph, newest first, two to a page (ADR-0023). Works without JavaScript; `src/scripts/photo-sheet.ts` appends older entries (four at a time) once the visitor scrolls. Edge-cached, tag `photos`. |
| `/photos?before=<seconds>` | The next two entries posted before that time; `noindex`. Anything but 1 to 10 digits is the notebook 404. |
| `/photos/<id>` | One published photograph, its date and place, its neighbours in the post and its own share image (the 1600 WebP). Unpublished or unknown: the notebook 404. |
| `/photos/downloads?token=<token>` | Every published photograph at full resolution, for a catalogue link. Private headers, no script, no referrer, never cached or counted. Invalid, expired and revoked links get the same 403 page. |
| `GET` or `HEAD /photos/downloads/<id>?token=<token>` | One full-resolution JPEG attachment, with byte ranges and conditional requests. |
| `GET /api/photos?after=-1&limit=24&collection=<optional>` | The published catalogue in position order, with a numeric `next` cursor. Limit 1 to 48. |
| `GET /api/photos?by=entry&before=<seconds>&limit=4` | The entry mode: `{ entries: [{ collection, date, place, photos }], next }`, photos with only their 240 and 480 previews. Limit 1 to 12. |
| `GET /api/photos/<id>` | One published photograph. |
| `GET /api/photos/downloads?token=<token>` | The private catalogue as JSON, for scripts. |
| `POST /admin/photos/links` | Issue a catalogue link through the owner gate (JSON; a `photoId` is refused with `photo links are internal`). |
| `DELETE /admin/photos/links?grantId=<uuid>` | Revoke a link through the owner gate. |
| `PATCH /admin/photos/<id>` | Publish or hide one photograph through `setPublished` (JSON). |

Public photo fields: `id`, `collection`, `title`, `width`, `height`, `downloadBytes`, `date` (the post's day in its own offset), `place` (`"area, city"` or `null`) and `previews` (`url`, real `width` and `height`, `format`). Every photograph has eight previews: 240, 480, 960 and 1600, each in AVIF and WebP, fitted inside its square. Every public query joins a photograph to its post (`photo_posts`), so a photograph without a post row isn't shown.

## The owner's screen

`/admin` has two sections for photographs (spec 6):

- **photographs:** one post per row, newest first, with its counts and a `raw` pill for photographs awaiting RAW review. Inside: the post's place (the place rule: lowercase, at most 60 characters, printable Latin-1; saving marks it edited, so an import keeps it), `publish all` and `hide all`, each photograph's title and its own publish or hide. Publishing checks every photograph's private JPEG and eight previews first (`src/lib/photos/publish.ts`, ten R2 checks at a time) and publishes all or none. Saves purge `photos` and `logbook`.
- **links:** issue a catalogue link for 1 to 30 days with a note; it is shown once with a copy button and never stored (a nonce stops a repeated form making a second). Working links are listed with a revoke form.

`bun run photos:link` issues and revokes catalogue links from the Mac without the admin; `--photo` is refused, because photo-scoped grants are made only inside print orders (plan B).

## Preparing and importing (George's Mac only)

Run from the website checkout under Node 24, with the prepared folder outside it:

```bash
bun run photos:key
bun run db:migrate:local
bun run photos:prepare \
  --selection /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/metadata/gallery-selection.json \
  --index /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/photo-index.json \
  --output /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/gallery-assets
bun run photos:import \
  --manifest /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/gallery-assets/manifest.json \
  --selection /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/metadata/gallery-selection.json \
  --local
```

`photos:prepare` renders each selected photograph (RAW and HEIC through Core Image), writes a full-resolution sRGB JPEG with its eight previews and checkpoints each photo, so a rerun reuses finished work; a checkpoint from before the 240s gets them from its master without rendering again. It then writes the manifest's `posts`: each post's time with its offset from the index, and its place. The place comes from the originals' GPS through `scripts/photo-place.swift` (ImageIO and Apple's geocoder through MapKit; one deprecation warning when it compiles is expected): at most three photos per post, 1.5 seconds apart, every answer cached as names only in `<output>/metadata/places.json`, so each photo's coordinates go to Apple once and nowhere else. Australian cities come from `scripts/photo-cities.json`; when a place has no entry, prepare stops before the manifest and lists the missing keys with their posts, so the map is filled once. It prints every post's place for review, and names it lists as `no place for …` need setting in `/admin`.

`photos:import` validates the whole manifest (eight previews per photograph, a post for every photograph, places by the rule, images by format, size, SHA-256 and profile, no private metadata) before touching storage. It writes posts first (a post's place only until George edits it), then uploads each photograph's objects before its row. A title comes from the manifest only when a row is first inserted; afterwards only `/admin` changes it. New or changed masters stay unpublished; an unchanged master keeps its publication. `raw_review` comes from the manifest's `needsRawReview`.

For production the same import runs with `--remote` from the Mac (spec section 12), after the deploy has applied migration 0006.

## Tests

- Unit (Vitest, `node:sqlite` over the real migrations): the entry mode and its cursor, the post join, publication all or nothing at a concurrency of ten, the admin's photo and link actions, the place rule and naming with recorded placemarks, prepare on synthetic photos with a recorded geocoder, the import's writes and one real import into a temporary local store.
- End to end (Playwright): the gallery with and without JavaScript, a photograph's page, the downloads page and its 403s, the admin's photographs and links sections, privacy, budgets and layout shift. A gallery server (4335) gets the six-post photo fixture afresh on every run (spec 11.3); the admin server (4333) gets its own copy every run, and each spec there keeps to its own photographs.
````

In `README.md`, replace the paragraph under `## Photographs` with:

```markdown
The photo gallery: `/photos`, a page for each photograph and a private downloads page behind catalogue links, with the owner's photographs and links sections in `/admin`. How the pages, the catalogue, the preparation and the import work: [photo gallery guide](docs/photo-gallery-backend.md). The e2e gallery server (4335) gets the six-post photo fixture afresh on every run (`scripts/seed-photo-test.mjs`).
```

In `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`, add a row after plan 5's:

```markdown
| 6. Photo gallery | Migration 0006 and photo posts with dates and places; 240 previews; places through Apple's geocoder on George's Mac; shared publication; the admin's photographs and links sections; `/photos`, a page for each photograph, the downloads page and the home page's line; privacy, budget and layout-shift checks ([spec](../specs/2026-10-08-photo-gallery-and-prints-design.md), part 1) | 1 to 5 | [Plan](2026-10-08-plan-6-photo-gallery.md); [follow-ups](2026-10-08-plan-6-followups.md) |
```

and add at the end of its "Launch gate" paragraph:

```markdown
 The gallery's own launch steps (the photo bucket, `PHOTO_LINK_SECRET`, the import from the Mac and George's review of every post) are in section 12 of the photo gallery spec.
```

Create `docs/superpowers/plans/2026-10-08-plan-6-followups.md`:

```markdown
# Plan 6 follow-ups

What plan 6 (the photo gallery) found or left for later.

## Launch

- Spec section 12's four steps are George's: create the `curiousgeorge-photo-prints` bucket before this branch deploys, set a fresh `PHOTO_LINK_SECRET`, run `photos:prepare` and `photos:import --remote` from the Mac after the deploy has applied migration 0006 (filling `scripts/photo-cities.json` where prepare stops) and review and publish every post in `/admin`, places included, looking hardest at the RAW candidates.
- After launch: issue the first catalogue link from `/admin` and open it on a phone; read the post-deploy Lighthouse medians for `/photos` and the newest photograph's page; confirm the deploy job's privacy test followed a frame on the live gallery.

## Known gaps

- The photo fixture's images are solid colour, so the 250KB image gate before scroll is trivially met locally; the real first batch (spec 3.3 measured about 121KB for the first entry) is checked by Lighthouse after the import. A cheap follow-up: fill the fixture's JPEGs with noise (sharp's `create.noise`), so their previews weigh what photographs do and the gate means something locally.
- `og:image` is the 1600 WebP; a few link-preview services don't read WebP and show no image (spec 4).
- `photo-place.swift` reads names from MapKit's deprecated `placemark`, the only MapKit object with the suburb, council and state code the city map needs. If Apple removes it, the tool needs MapKit's `address` fields and the city map a key built from them.
- The admin's photographs section renders two forms per photograph, about 1KB each: a few hundred KB for the whole selection, fine for one owner on a phone, but worth paging if the selection grows past a thousand.
- Local runs have no cache purge, so local e2e checks of the gallery after an admin save use a fresh query string.

## For plan B

Ready from plan 6 (spec 13.1): `photo_posts` with dates and places and the public `date` and `place`; the 240 and 480 previews; `photoName` in `src/lib/photos/gallery.ts`; `/photos/<id>`'s rows, into which the `prints` row goes between `photo` and `say hi`; Notebook's `noindex` and `referrer`; `isPrivatePath` in `src/lib/photos/http.ts` for `/prints/`; `setPublished`; `purgeTags` and the `PURGES` map for the orders section; `insertGrant`'s note and nonce beside the order grant.
```

Run: `grep -nE "—" docs/photo-gallery-backend.md README.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md docs/superpowers/plans/2026-10-08-plan-6-followups.md`
Expected: no matches (no em dashes).

Run: `grep -nE ", (and|or) [a-z]" docs/photo-gallery-backend.md docs/superpowers/plans/2026-10-08-plan-6-followups.md README.md`
Expected: read each match for an Oxford comma (a comma before the last "and" or "or" of a list) and fix it; a comma before "and" that joins two clauses is fine.

- [ ] **Step 5: The whole suite**

Run: `pkill -f "port 433[0-9]"; bun run check`
Expected: typecheck at 0 errors, every unit test passing, the migrations and seeds applied and every e2e spec passing in chromium, webkit and phone.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/privacy.spec.ts tests/e2e/budgets.spec.ts tests/e2e/perf.spec.ts scripts/lighthouse.mjs .github/workflows/ci.yml docs/photo-gallery-backend.md README.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md docs/superpowers/plans/2026-10-08-plan-6-followups.md
git commit -m "test: privacy, budgets and layout shift on the photo pages; docs for the gallery"
```
