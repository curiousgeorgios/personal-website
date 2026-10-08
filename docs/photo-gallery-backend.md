# Photo gallery

George's photographs on the site: `/photos`, a page for each photograph, a private downloads page behind catalogue links, the owner's photographs and links sections in `/admin` and a line on the home page while anything is published. Designed in [the photo gallery spec](superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md) (part 1), built in [plan 6](superpowers/plans/2026-10-08-plan-6-photo-gallery.md) on Codex's backend of `a65ecc6`; what it left for later is in [the plan 6 follow-ups](superpowers/plans/2026-10-08-plan-6-followups.md).

Decisions:

- [ADR-0020](adr/0020-photo-downloads-use-revocable-signed-links.md) (amended): downloads use revocable signed links, and people only ever get catalogue links.
- [ADR-0022](adr/0022-photo-places-are-area-and-city-only.md) (amended): a place is an area and a city, and coordinates never reach the site.
- [ADR-0023](adr/0023-the-gallery-stays-light-on-phones.md): the gallery stays light on phones.
- [ADR-0024](adr/0024-test-servers-never-hold-the-real-signing-key.md): test servers never hold the real signing key.

## Pages and routes

| Route | Behaviour |
| --- | --- |
| `/photos` | The gallery: one entry per Instagram post with a published photograph, newest first, two to a page. Works without JavaScript; `src/scripts/photo-sheet.ts` appends older entries (four at a time) once the visitor scrolls. Edge-cached, tag `photos`. |
| `/photos?before=<seconds>` | The next two entries posted before that time; `noindex`. Anything but 1 to 10 digits is the notebook 404. |
| `/photos/<id>` | One published photograph, its date and place, its neighbours in the post and its own share image (the 1600 WebP). Unpublished or unknown: the notebook 404. |
| `/photos/downloads?token=<token>` | Every published photograph at full resolution, for a catalogue link. Private headers, no script, no referrer, never cached or counted. Invalid, expired and revoked links get the same 403 page. |
| `GET` or `HEAD /photos/downloads/<id>?token=<token>` | One full-resolution JPEG attachment, with byte ranges and conditional requests. |
| `GET /api/photos?after=-1&limit=24&collection=<optional>` | The published catalogue in position order, with a numeric `next` cursor. Limit 1 to 48. |
| `GET /api/photos?by=entry&before=<seconds>&limit=4` | The entry mode: `{ entries: [{ collection, date, place, photos }], next }`, photos with only their 240 and 480 previews. Limit 1 to 12. |
| `GET /api/photos/<id>` | One published photograph. |
| `GET /api/photos/downloads?token=<token>` | The private catalogue as JSON, for scripts. |
| `POST /admin/photos/links` | Issue a catalogue link through the owner gate (JSON; a `photoId` is refused with `photo links are internal`). |
| `DELETE /admin/photos/links?grantId=<uuid>` | Revoke a catalogue link through the owner gate. A photo-scoped grant (plan B's print orders) answers as an unknown link and keeps working. |
| `PATCH /admin/photos/<id>` | Publish or hide one photograph through `setPublished` (JSON); a hide also purges its previews' tag. |
| `/media/photos/previews/<id>/<sha>/<size>.<format>` | A published photograph's preview, `public, max-age=31536000, immutable`, cache tag `photo-<id>`. A hidden or unknown photograph's previews answer 404, `no-store`. Audio, covers and snapshots under `/media` are unchanged. |
| `/admin/media/photos/previews/…` | The same previews for the admin's thumbnails, hidden photographs' included, behind the admin gate and never cached. |

Public photo fields: `id`, `collection`, `title`, `width`, `height`, `downloadBytes`, `date` (the post's day in its own offset), `place` (`"area, city"` or `null`) and `previews` (`url`, real `width` and `height`, `format`). Every photograph has eight previews: 240, 480, 960 and 1600, each in AVIF and WebP, fitted inside their square. Every public query joins a photograph to its post (`photo_posts`), so a photograph without a post row isn't shown.

### Why the gallery loads so little

The gallery's budget is 250KB of images before any scroll at 375 × 812 (spec 10). On George's real photographs the first design loaded 374KB at 1× and 1,235KB on a 3× phone, so (ADR-0023):

- a server-rendered page holds two entries, not four (the API's batches stay at four);
- on phones, which the notebook's 680px breakpoint decides, a frame is offered the 240 preview alone at every screen density, so thumbnails are a little soft on 3× screens and the sharp image is one tap away;
- the script that appends older entries starts watching only after a scroll, wheel or touch move, a scrolling key without a modifier or focus on the `older entries` link, because on a short page the link can already sit inside its 800px margin on load and a batch would be fetched unasked.

Measured on a store shaped like the real catalogue (two entries, 36 frames): 198KB at 1× and at 3×. The committed gate (`tests/e2e/budgets.spec.ts`) measures the fixture locally and the real catalogue when `PLAYWRIGHT_BASE_URL` points at the live site (the post-publish check below).

## The owner's screen

`/admin` has two sections for photographs (spec 6):

- **photographs:** one post per row, newest first, with its counts and a `raw` pill for photographs awaiting RAW review. Inside: the post's place (the place rule: lowercase, at most 60 characters, printable Latin-1; saving marks it edited, so an import keeps it), `publish all` and `hide all`, each photograph's title and its own publish or hide. Publishing checks every photograph's private JPEG and eight previews first (`src/lib/photos/publish.ts`, ten R2 checks at a time) and publishes all or none, naming the master or preview that failed for each photograph. Saves purge `photos` and `logbook`.

  **What hide does:** a hidden photograph leaves every page, list and downloads page, and its previews stop being served to anyone new. `/media` checks in D1 that a preview's photograph is published and answers 404 otherwise; a hide also purges the photograph's `photo-<id>` tag, so the edge drops its cached previews (if that purge fails, the saved line says the gallery may show the old version for a little while). Publishing again brings them back. What hide can't recall: a copy already in a visitor's browser (previews are cached for a year), a saved or shared image, or a search engine's copy of one. It is the way to take a photograph down from the site, not a promise that no copy exists anywhere.
- **links:** issue a catalogue link for 1 to 30 days with a note; it is shown once with a copy button and never stored (a nonce stops a repeated form making a second). Working links are listed with a revoke form, which switches off catalogue links only.

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

`photos:prepare` renders each selected photograph (RAW and HEIC through Core Image; it prefers an exported Photos edit where there is one), writes a full-resolution sRGB JPEG with its ICC profile and its eight previews, strips EXIF, XMP and IPTC from the delivery copy and checkpoints each photo, so a rerun reuses finished work; a checkpoint from before the 240s gets them from its master without rendering again. A rendered RAW is a candidate edit, not proof of a colour or crop match to Instagram. It then writes the manifest's `posts`: each post's time with its offset from the index, and its place. The manifest is version 2, so a prepared folder from before this plan needs `photos:prepare` run again (checkpoints and the places cache are reused). The place comes from the originals' GPS through `scripts/photo-place.swift` (ImageIO and Apple's geocoder through MapKit; one deprecation warning when it compiles is expected): at most three photos per post, 1.5 seconds apart, every answer cached as names only in `<output>/metadata/places.json`, so each photo's coordinates go to Apple once and nowhere else. Australian cities come from `scripts/photo-cities.json`; when a place has no entry, prepare stops before the manifest and lists the missing keys with their posts, so the map is filled once. It prints every post's place for review, and names it lists as `no place for …` need setting in `/admin`.

`photos:import` validates the whole manifest (eight previews per photograph, a post for every photograph, places by the rule, images by format, size, SHA-256 and profile, no private metadata) before touching storage. It writes posts first (a post's place only until George edits it), then uploads each photograph's objects before its row. A title comes from the manifest only when a row is first inserted; afterwards only `/admin` changes it. New or changed masters stay unpublished; an unchanged master keeps its publication. `raw_review` comes from the manifest's `needsRawReview`. No prepared photo file is committed to Git, and the prepared folder must live outside the checkout.

For production the same import runs with `--remote` from the Mac, after the deploy has applied migration 0006.

## Issuing links from the Mac

`photos:key` generates an ignored local key in `.dev.vars`, preserves an existing key and never prints it. People only ever get catalogue links (ADR-0020 as amended): a catalogue link lists only published photographs.

```bash
bun run photos:link --local \
  --days 7 \
  --output /Users/curiousgeorge/Documents/ChatGPT/photo-printing/recovery/private-link.json
```

The link opens the downloads page, `/photos/downloads?token=…`. The private JSON file contains the URL, grant identifier and expiry; its mode is 0600, and the command refuses to save links into tracked areas of the website. George shares the link himself. To revoke it:

```bash
bun run photos:link --local --revoke <grant-id>
```

For production, use `--remote` and set `PHOTO_LINK_SECRET` in the process environment to the same key as the Worker, never in a command-line argument or a tracked file. The admin's links section issues production links without the signing key leaving the Worker.

## Launch steps (George's)

In this order, because the branch binds a bucket and needs a migration the moment it deploys:

1. Create the `curiousgeorge-photo-prints` R2 bucket **before this branch deploys**, because `wrangler.jsonc` binds it: `bunx wrangler r2 bucket create curiousgeorge-photo-prints --location oc`. Confirm it has no `r2.dev` URL and no custom domain; the application has no public route for its objects.
2. Apply migration 0006 with `wrangler d1 migrations apply` (`bun run db:migrate:remote`), never `d1 execute --file`. The deploy job does this before it deploys, so merging is enough.
3. Set `PHOTO_LINK_SECRET` as a fresh Worker secret of 64 lowercase hex characters, not the local one: `bunx wrangler secret put PHOTO_LINK_SECRET`. Without it the downloads page answers 503.
4. From the Mac, run `photos:prepare` (the manifest is now version 2; fill `scripts/photo-cities.json` wherever it stops), then `photos:import --remote` with the same manifest and selection.
5. In `/admin`, review every post (places included) and publish what should be public, looking hardest at the 96 RAW candidates, which carry `raw` pills.
6. Issue the first catalogue link from `/admin` and open it on a phone.

After the first photographs are published (step 5), run the post-publish check against the live site. The deploy job's privacy test and Lighthouse run happened before anything was public, and Lighthouse never weighs images, so this is the first time the real photographs are measured:

```bash
PLAYWRIGHT_BASE_URL=https://curiousgeorge.dev bunx playwright test tests/e2e/budgets.spec.ts tests/e2e/privacy.spec.ts -g "images before any scroll|photo pages" --project=chromium
bun run lighthouse https://curiousgeorge.dev/
```

The first command runs the 250KB image gate (at 1× and 3×) on the real `/photos` and the privacy check on the gallery and a photograph's page; both only read, and send Global Privacy Control so they aren't counted as visits. The second reads largest contentful paint and layout shift on `/`, `/photos` and the newest photograph's page. The full launch list is section 12 of the spec; what the build left open is in [the plan 6 follow-ups](superpowers/plans/2026-10-08-plan-6-followups.md).

## Tests

- Unit (Vitest, `node:sqlite` over the real migrations): the entry mode and its cursor, the post join, publication all or nothing at a concurrency of ten, the admin's photo and link actions, the place rule and naming with recorded placemarks, prepare on synthetic photos with a recorded geocoder, the import's writes and one real import into a temporary local store.
- End to end (Playwright): the gallery with and without JavaScript, a photograph's page, the downloads page and its 403s, the admin's photographs and links sections, and privacy, budgets and layout shift on the photo pages. A gallery server (4335) gets the six-post photo fixture afresh on every run (spec 11.3), its 240 and 480 previews noise-filled so they weigh what real ones do; the admin server (4333) gets its own copy every run, and each spec there keeps to its own photographs. Every test server passes the fixture signing key explicitly (ADR-0024).
