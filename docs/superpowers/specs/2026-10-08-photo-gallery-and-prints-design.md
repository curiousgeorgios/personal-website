# curiousgeorge.dev photo gallery and print ordering

- Date: 2026-10-08
- Owner: George Vlachos
- Status: Design agreed with George, revised after critical review and George's answers to its product questions; ready for two implementation plans (section 1.2)
- Extends: [the logbook redesign spec](2026-10-03-personal-site-redesign-design.md). "R6.1" below means its section 6.1. Everything that spec says about the visual system (R3), motion (R4.3), architecture (R6), admin (R7), analytics (R10), budgets (R11), security headers and accessibility (R12) and deployment (R13) applies here unless this spec says otherwise.
- Decisions: [ADR-0020](../../adr/0020-photo-downloads-use-revocable-signed-links.md) (amended 2026-10-08), [ADR-0021](../../adr/0021-prints-sold-on-site-through-artelo.md) (amended 2026-10-08), [ADR-0022](../../adr/0022-photo-places-are-area-and-city-only.md) (amended 2026-10-08).
- Builds on: the photo backend of `a65ecc6` ([docs/photo-gallery-backend.md](../../photo-gallery-backend.md)): `src/lib/photos/`, `src/pages/api/photos/`, `src/pages/photos/downloads/[id].ts`, `src/pages/admin/photos/`, `migrations/0005_photos.sql`, `scripts/prepare-photos.mjs`, `scripts/import-photos.mjs` and `tests/e2e/photos.spec.ts`. Sections 2.2 and 13.2 list every change this spec makes to it.
- Artelo facts come from its public API documentation, read on 2026-10-08 (Create Order, Price Check, Get Catalog Product Costs, Get Orders, Get Order by Id, Webhooks, Webhook Topics, Save Webhook, Getting Started) and from the enum lists in that documentation's own page bundle. Section 25 lists every assumption about Artelo and Stripe and how the build checks it.

## 1. Intent, scope and the two parts

George's photographs get a home on the site, kept the way the logbook keeps everything else: dated entries, plain words, nothing moving unless the visitor moves it. Anyone can order prints of the photographs that print well, several in one order. People George chooses get every published photograph at full resolution through one private link.

The selection is 462 photographs from 32 Instagram posts (2 February 2025 to 27 September 2026), 370 portrait and 92 landscape; 363 are 2:3 and 96 are 3:4. 96 are RAW renders awaiting George's review (docs/photo-gallery-backend.md).

### 1.1 Success criteria and non-goals

- `/photos` reads like the log: someone flicking through it sees dates, places and photographs, and nothing else asks for attention.
- The first batch of `/photos`, every `/photos/<id>` page and the basket work completely without JavaScript and meet the budgets in sections 10 and 23.
- A buyer anywhere sees one delivered total for everything in their basket before paying, pays on Stripe's page and gets the prints without George touching anything; when something goes wrong, George finds out from `/admin` and an email, never from the buyer.
- No buyer is ever charged without the order being tracked to a resolution: the cron, not only the webhook, guarantees a paid order is noticed (section 18.6).
- `cookies: none. nothing to accept.` stays literally true of curiousgeorge.dev, and the privacy test's empty-storage assertion keeps passing (sections 9 and 21).

Non-goals: buyer accounts, saved addresses or order history beyond the private order page; discount codes or gift cards; print sizes other than the three in section 14.1; frames other than Artelo's standard oak, mats, canvas or metal prints; artistic titles or captions invented for photographs (titles start empty and only George writes them); maps, coordinates or anything finer than "area, city" (ADR-0022); new analytics events (the beacon keeps its four, R10).

### 1.2 Delivery in two plans

Delivery is in two plans. Plan A (gallery) ships first and adds no payment code: migration `0006_photo_gallery.sql` (`photo_posts`, `raw_review`, the grant columns), places and dates in prepare and import, `/photos`, `/photos/<id>` without the print row, the downloads page, the admin photographs and links sections and the home line. Plan B (prints) follows: migration `0007_prints.sql` (`print_prices`, `print_settings`, `print_costs`, `print_orders`, `print_order_items`, `stripe_events`, the order grant column), everything in sections 13 to 24, the basket, the order page and the admin orders section. Part 1 of this spec (sections 2 to 12) is plan A; part 2 (sections 13 to 25) is plan B. Part 1 never refers forward to part 2 for anything it needs; section 13.1 lists what part 2 needs from part 1.

Recommended task order.

Plan A: (1) migration 0006, the additive `date` and `place` fields and the entry mode of `/api/photos`; (2) the 240 previews in prepare, import and the publish check (3.3); (3) `photo-place.swift`, `photo-cities.json`, prepare's `posts` array and the import's `photo_posts` upsert, with titles that survive re-import; (4) `src/lib/photos/publish.ts` and the admin photographs section; (5) `/photos` and its script, plus the home line; (6) `/photos/<id>`; (7) the downloads page, the catalogue link change, `photo links are internal` and the admin links section with its nonce; (8) middleware, `Notebook.astro` props, ingest and robots changes; (9) end-to-end, privacy and budget specs.

Plan B: (1) the Worker entry probe (cron, `ratelimits` and `send_email` all surviving into `dist/server/wrangler.json`); (2) migration 0007; (3) `catalogue.ts` eligibility and `basket.ts` parsing as pure functions with their unit tests; (4) the exchange-rate job and the Artelo cost client with its D1 cache; (5) the print section on `/photos/<id>` and the basket carried through the gallery; (6) the basket page and its quote; (7) checkout and the CSP change; (8) the Stripe webhook and the checkout reconciliation; (9) `placeOrder`, retries and the cron; (10) the Artelo webhook and poll; (11) emails; (12) the admin orders section; (13) the order page; (14) `prints:check` and `prints:webhook`; (15) the Artelo stand-in and the full order, partial refusal and failure specs.

# Part 1: the gallery

## 2. Routes and changes to existing code

### 2.1 Routes

| Route | Behaviour | Caching |
|---|---|---|
| `/photos` | The gallery, newest entry first, four entries per page (section 3) | Edge, tag `photos`, as R6.1 (`maxAge: 300, swr: 86400`) |
| `/photos?before=<seconds>` | The next four entries posted before that time; `noindex` | Same, per URL |
| `/photos/<id>` | One photograph (section 4) | Edge, tag `photos` |
| `/photos/downloads?token=<token>` | The private full-resolution list (section 5) | Private headers, never cached |
| `/photos/downloads/<id>?token=<token>` | Existing full-resolution JPEG download, unchanged in part 1 | Private headers |
| `/api/photos` | Existing catalogue, plus the entry mode in section 3.6 | 60s fresh, 300s stale, tag `photos` (unchanged) |
| `/api/photos/<id>` | Existing, plus `date` and `place` | Unchanged |
| `/admin` | Two new sections (section 6) | As R7 |

`robots.txt` adds `Disallow: /photos/downloads`. `/photos` and `/photos/<id>` are indexable with canonical URLs. `Notebook.astro` builds the canonical from the pathname only, so a `?before=` page would canonicalise to `/photos`; those pages render with `noindex` instead, and older entries are found through `/photos/<id>`.

### 2.2 Changes to the photo backend and the site

- **Public photo fields** gain `date` (the post's `YYYY-MM-DD`) and `place` (`"area, city"` or `null`) from `photo_posts` (section 7), in `/api/photos` and `/api/photos/<id>`. Purely additive.
- **240 previews.** Every photograph gains a 240 preview in AVIF and WebP, so each has eight previews instead of six (3.3). `photos:prepare` encodes sizes 240, 480, 960 and 1600; a checkpoint that lacks the 240s gets them derived from its existing master JPEG without re-rendering, so masters, their SHA-256 and their publication state don't change. `photos:import` requires eight previews and accepts `/(240|480|960|1600)\.(avif|webp)$/`; the publish check verifies eight.
- **Catalogue links** point at the page, `/photos/downloads?token=…`, instead of `/api/photos/downloads?token=…`. The JSON route stays for scripts.
- **Photo-scoped links are no longer issued to people** (ADR-0020 as amended). `POST /admin/photos/links` refuses a `photoId` with 400 `photo links are internal`; `bun run photos:link` drops `--photo`.
- **Publication** moves from `src/pages/admin/photos/[id].ts` into `src/lib/photos/publish.ts` (`setPublished(deps, ids, published)`), shared by the JSON route and the admin forms. Verification is unchanged apart from eight previews; its R2 `head` calls (up to 180 for a 20-photo post: one master and eight previews each) run with a concurrency of 10, well within Workers Paid's subrequest limit, which the plan task confirms. A publication change purges both `photos` and `logbook` (the home page's photo line depends on whether anything is published).
- **Titles survive re-import.** The import's photo upsert no longer touches `title` on conflict: titles come from the manifest only when a row is first inserted, and afterwards only from `/admin`.
- **`Notebook.astro`** gains two optional props: `ogImage` (an absolute URL with its width and height; every other page keeps `/og.png`) and `referrer` (renders `<meta name="referrer" content="…">`).
- **Ingest** (`src/lib/ingest.ts`): an event whose `$pathname` starts with `/photos/downloads` is refused with 400, so that page is never counted even if a script were ever added to it.
- **Seed**: `scripts/seed-photo-test.mjs` grows to the fixture in section 11.3; the existing `photos.spec.ts` assertions that name the catalogue's exact contents, or expect six previews, are updated to match.

## 3. The gallery, /photos

### 3.1 Page structure

The page uses `Notebook.astro` and the logbook's book layout (R2, R3): margin column, red rule, lowercase DM Mono labels.

| Margin label | Content |
|---|---|
| `photos of` (head row) | `<h1>george vlachos</h1>`, then `photos i've taken, one entry per instagram post, newest first.`, then `back to the logbook` linking to `/`. On a `?before=` page, the line also carries `· newest entries` linking to `/photos`. |
| `entries` | An `<ol class="entries">` of entries (3.2), then the pager (3.4) |

With no published photographs the `entries` row holds one line, `no photos up yet.`, and the home page shows no photo line (3.7). If the D1 read fails, the head row renders with `photos aren't loading right now. try again in a bit.`, status 503 and `Cache-Control: no-store`, so a degraded page is never cached.

`<title>` is `photos · george vlachos`; the description is `photos george vlachos has taken, one entry per instagram post.`

### 3.2 Entries

One entry per post (`photos.collection`) that has at least one published photograph, ordered by `photo_posts.published_at` descending.

- `<li class="entry" id="post-<collection>">`, headed `<h2 class="entry-head"><time datetime="2025-02-02">02.02.25</time> · bondi, sydney</h2>` in DM Mono 12px, the date in `--muted`, the place in `--ink`. The ` · place` part is left out when the place is `null`. The date is the day the post went up, in the post's own time zone (section 7), formatted like log dates (R4.2, `formatLogDate`).
- Below it, the contact sheet: `<ol class="sheet">` of frames in post order (`photos.position`). Frames sit in rows like a contact sheet, wrapping onto as many rows as the post needs (a post holds 1 to 20 photographs): each frame image is 120px tall on screens 680px and wider and 88px below, its width following its aspect ratio, with a 6px gap. Under each frame its number in DM Mono 11.5px `--muted`: the slide number from the id (`-02` shows `02`), like the edge numbers on a contact sheet, which stays the slide number even when other slides are hidden.
- Each frame is a link to `/photos/<id>`. Hover (fine pointers only, 200ms `ease`): the frame number turns `--ink` and a 1px `--red` outline appears around the image; no transforms. Focus-visible outlines as R12.2.
- Alt text: the title when George has written one, otherwise `photo 2 of 14 from 2 february 2025, bondi, sydney` (place left out when unknown). `<n> of <m>` counts published photographs in post order.
- Entries are 24px apart; the sheet starts 10px under the heading.

### 3.3 Previews

`/photos` uses only the 240 and 480 previews (each fitted inside a square of that size, with its actual width):

```html
<picture>
  <source type="image/avif" srcset="…/240.avif 160w, …/480.avif 320w" sizes="(max-width: 679px) 59px, 80px">
  <img src="…/240.webp" srcset="…/240.webp 160w, …/480.webp 320w" sizes="(max-width: 679px) 59px, 80px"
       width="160" height="240" alt="…" loading="lazy" decoding="async">
</picture>
```

- `srcset` descriptors are each preview's real width; `width` and `height` are the 240 preview's real dimensions, so the browser knows the aspect ratio before any byte arrives. CSS sets `height: 120px` (88px on phones) and `width: auto`, which the attribute ratio resolves before load: no layout shift.
- `sizes` is computed per frame as the rendered width, `round(120 × width ÷ height)` px and `round(88 × width ÷ height)` px below 680px. A portrait frame at 2× takes the 240; a landscape one takes the 480.
- Only the first row of the first entry on the page (at most 8 frames) loads eagerly, the first with `fetchpriority="high"`; every other frame is lazy.
- Measured on the real manifest (2026-10-08): the four newest posts hold 68 photographs. Their 480 AVIF previews total 1,277,837 bytes; the same frames at 240 AVIF total 391,541 bytes (first entry 20 frames, 120,526 bytes; its first four frames 25,081 bytes). Without JavaScript Chrome ignores `loading="lazy"` and fetches the whole batch, which is then about 392KB instead of 1.3MB. The gate is in section 10.
- The 960 and 1600 previews are never used on `/photos`.

### 3.4 Pager and loading more

- After the list, while older entries exist, a plain link: `<a class="more" href="/photos?before=<published_at of the last entry shown>" data-next="<same>">older entries</a>`, with the CSS chevron of R4.2. At the end the line reads `that's every entry.` instead.
- `?before=` must match `^\d{1,10}$`; anything else gets the notebook 404. It selects posts with `published_at` strictly less than it. Four entries per page.
- With JavaScript (`src/scripts/photo-sheet.ts`, an inline page script with no runtime imports, R6 and R11): an `IntersectionObserver` watches the link with `rootMargin: "0px 0px 800px 0px"`. When it intersects, the script fetches `/api/photos?by=entry&before=<data-next>&limit=4`, clones `<template id="entry-template">` and `<template id="frame-template">` (rendered by the server from the same component, so markup lives in one place) for each entry and frame, appends them to the list and moves `href` and `data-next` to the new cursor, or replaces the link with `that's every entry.` when `next` is `null`. Appended frames are all lazy.
- While a batch loads the link reads `loading older entries…` and is `aria-disabled="true"`; one fetch at a time. On failure it goes back to `older entries` and the observer stops, so a click follows the plain link. Focus never moves; the URL never changes.

### 3.5 Caching

`/photos` and `/photos?before=` call `Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["photos"] })` and send `Cache-Control: no-cache`, exactly like `/` (R6.1). D1 is read once per render with one `DB.batch()`: the page of posts, then their published photographs. Publication, title and place changes purge `photos` (and `logbook`).

### 3.6 The entry mode of /api/photos

`GET /api/photos?by=entry&before=<seconds>&limit=<1 to 12>` (default `limit` 4; `before` optional, meaning newest; any other parameter is a 400, as today) answers:

```json
{ "entries": [{ "collection": "DFkL1xrsnOH", "date": "2025-02-02", "place": "bondi, sydney",
                "photos": [ /* public photo objects, in post order, with only the 240 and 480 previews */ ] }],
  "next": 1738488468 }
```

The query asks for `limit + 1` posts; `next` is the `published_at` of the last entry returned when a further post exists, otherwise `null`. Without `by`, the endpoint behaves exactly as it does now (all eight previews). Caching is unchanged (60s fresh, 300s stale, tag `photos`).

### 3.7 The line on the logbook home page

A row after `log` and before `on the turntable`, margin label `photos`, with one line: `<a href="/photos">photos</a> i've taken, kept like this log.` No image, no script; the home page's HTML grows by under 200 bytes. The row renders only when at least one photograph is published: `loadLogbook`'s batch gains `SELECT EXISTS (SELECT 1 FROM photos WHERE published = 1) AS any`. Publishing the first photograph or hiding the last one changes the home page at once, because publication purges `logbook` (2.2).

## 4. One photograph, /photos/<id>

A shareable page for one published photograph. An unpublished or unknown id gets the notebook 404 (`no-store`).

| Margin label | Content |
|---|---|
| `photo` (head row) | The photograph, then the `<h1>`: the title if George wrote one, otherwise `02.02.25 · bondi, sydney`. Then a DM Mono line: `photo 2 of 14 · ‹ previous · next ›` (links to the neighbouring published photographs of the same post, each left out at the ends, chevrons drawn in CSS; `2 of 14` counts published photographs as in 3.2), and `the whole entry` linking to `/photos?before=<published_at + 1>#post-<collection>`. When there's a title, the date and place line sits under it. |
| `say hi` | As on `/` |

Part 2 adds a `prints` row between these two (section 15.1).

The photograph is a `<picture>` with the 960 and 1600 previews in AVIF and WebP, `width` and `height` from the 1600 preview, `fetchpriority="high"` and `loading="eager"`. CSS: `width: 100%; height: auto; max-height: 82svh; object-fit: contain`, so the box is known before the image loads (no shift) and a tall portrait fits the viewport, letterboxed on paper. Because the height cap narrows portraits, `sizes` is computed per photograph from its ratio `r = width ÷ height`: `(max-width: 679px) min(calc(100vw - 48px), calc(82svh * r)), min(710px, calc(82svh * r))`, so a 2:3 portrait on a 900px-tall laptop (about 492px wide) fetches the 960, not the 1600. Its alt text follows 3.2. No closer look, zoom or lightbox: the 1600 preview is the largest image the public site serves.

A photograph's **name**, used wherever one photograph has to be named in a line of text (and, in part 2, at checkout, on the order page and in emails), is its title in quotes, or `photo 2 of 14 from 02.02.25` when it has none. `<title>` is `<h1 text> · photos · george vlachos`. The description is `a photo by george vlachos from 2 february 2025, bondi, sydney.` (place left out when unknown; "from" because the date is the post's, not the shutter's). `og:image` is the 1600 WebP with its real `og:image:width` and `og:image:height` (`ogImage` prop, 2.2). Known gap: a few link-preview services still don't read WebP and will show no image. Cached as 3.5. The beacon sends its `$pageview` as on `/`.

## 5. Full-resolution links (ADR-0020 as amended)

### 5.1 Who gets full resolution

People get full-resolution photographs only through a catalogue link: one link opens every published photograph, for as long as it lasts (7 days by default, 30 at most) or until George revokes it. George issues and revokes them in `/admin` (section 6.3) or with `bun run photos:link` (catalogue only). Part 2 adds photo-scoped grants used only inside print orders (section 18.2); no person ever receives one.

### 5.2 The downloads page, /photos/downloads?token=…

Server-rendered from D1 (`src/pages/photos/downloads/index.astro`); it verifies the token exactly as `/api/photos/downloads` does (`verifyPhotoToken`, a catalogue scope, `grantIsActive`).

| Margin label | Content |
|---|---|
| `downloads` (head row) | `<h1>photos, full size</h1>`, then `every photo in the gallery as a full-resolution jpeg. this link works until 15.10.26, 2:30 pm sydney time. please keep it to yourself.` (the expiry from the token's `exp`, in `Australia/Sydney`) |
| `entries` | Every published photograph, grouped into entries headed as 3.2, newest first, on one page. Each photograph: its 240 preview (lazy, alt as 3.2) and a link `download · 12.4 mb` (decimal megabytes, one decimal) to `/photos/downloads/<id>?token=<token>` with `download="<id>.jpg"` |

The page:

- sends `PRIVATE_HEADERS` (the middleware already applies them to `/photos/downloads`): `Cache-Control: private, no-store`, `Cloudflare-CDN-Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`;
- renders with `Notebook.astro`'s `noindex` (so no canonical is emitted) and `referrer="no-referrer"`;
- never calls `Astro.cache.set`, includes no beacon or other script and loads nothing from any other origin;
- never logs the request, its URL or the token (as `download.ts` already does); the Worker's `redact_query_string` keeps the token out of Workers Logs;
- holds the token only in its own download links.

### 5.3 When a link doesn't work

Invalid, expired and revoked links all show the same page, with status 403, the same private headers, `noindex` and `referrer="no-referrer"`, so the page never says which: head row `downloads`, `<h1>this link has run out</h1>` and `it may have expired or been switched off. if you were expecting photos, ask george for a fresh one: <a href="mailto:hello@curiousgeorge.dev">hello@curiousgeorge.dev</a>.` A missing `PHOTO_LINK_SECRET` or a D1 failure shows `downloads aren't working right now. try again in a bit.` with status 503.

## 6. The owner screen in /admin: photographs and links

### 6.1 Shared rules

New sections follow R7 and the existing code in `src/lib/admin/` exactly: plain server-rendered forms posting to `/admin/` with an `intent`, the Origin check (ADR-0011), the Access check against `ADMIN_EMAIL` (ADR-0016), validation server side, 422 with the failed form reopened and its values, a page banner for failures that belong to no form, 500 for a throw and 303 to `/admin/?saved=<section>#<section>` on success (post, redirect, get). An identical repeat counts as saved (ADR-0012): publishing something already published, hiding something hidden, revoking something revoked. `AdminSection` gains `photographs` and `links`. Section order on the page: now, lately, log, records, before, snapshots, photographs, links.

Saves in `photographs` purge `photos` and `logbook` through the existing `purgeLogbook` path (generalised to take tags); `links` purges nothing.

### 6.2 Photographs

One `<details>` per post, newest first, closed unless it holds the failed form. Summary line: `02.02.25 · bondi, sydney · 14 photos, 12 published`, plus a `raw` pill with a count when any photograph in it awaits RAW review (`photos.raw_review`, section 7).

Inside:

- **Place:** a text field `place` with the hint `area, city. leave it empty to show no place.` Saving sets `photo_posts.place` and `place_edited = 1`, so a later import never overwrites George's edit (section 7). The **place rule**, shared with prepare (7.2): lowercased with `en-AU` rules, trimmed, at most 60 characters, printable Latin-1 only, so it renders in the subset fonts of R3; empty stores `null`. Intent `post.place`.
- **Publish or hide the post:** `publish all 14` (intent `post.publish`) and `hide all` (intent `post.hide`). Publishing verifies every photograph in the post first (`setPublished`, the backend's checks of the private JPEG and eight previews); if any fails, nothing is published and the form says `2 photos couldn't be checked: DFkL1xrsnOH-03, DFkL1xrsnOH-07. publish the others one at a time.` with status 422.
- **Each photograph:** its 240 preview (lazy), id, `raw` pill, a `title` field (at most 80 characters, plain text, empty allowed; intent `photo.title`) and a `publish` or `hide` button for that photograph alone (intent `photo.publish` or `photo.hide`), with the same verification.
- Saved line: `saved - the gallery may show the old version for a little while.` when the purge failed, otherwise `saved - it's on the gallery now.`

### 6.3 Links

- **Issue a link:** fields `days` (a number from 1 to 30, default 7) and `note` (optional, at most 60 characters, hint `who it's for, so you know which to revoke`), plus a hidden `nonce` (16 random bytes, base64url, new on every render). Intent `link.issue`. This is the one write that answers 200 instead of 303, because the link exists only in that response: the page renders with `here's the link. copy it now - it can't be shown again.`, the URL in a read-only input and a `copy` button (`src/scripts/copy-link.ts`, `navigator.clipboard.writeText`; without JavaScript the text is selectable). The grant row stores the nonce (`photo_download_grants.request_nonce`, unique), so a repeated post with the same nonce (a double tap or a reload) creates nothing and shows `that link was already made. it's in the list below, but it can't be shown again.` The token itself is never stored.
- **Active links:** catalogue grants (`photo_id IS NULL`) not revoked and not expired, newest first: `made 08.10.26 · works until 15.10.26 · <note>` and a revoke form with the `tick the box to remove it` confirmation used elsewhere in the admin (intent `link.revoke`).

## 7. Places, dates and the import

### 7.1 Post dates

`photos:prepare` reads each post's `published_at` from `photo-index.json` (one value per post, with its offset, for example `2025-02-02T20:27:48+11:00`) and writes the manifest's new `posts` array: `{ "collection", "publishedAt", "place" }`. The import stores `published_at` as seconds since 1970 (unique, the sort key and cursor) and `published_on` as the date part in the post's own offset (`2025-02-02`), which is what the gallery shows.

### 7.2 Places (ADR-0022 as amended)

A new Swift tool, `scripts/photo-place.swift`, compiled with `xcrun swiftc` exactly as `photo-render.swift` is, takes an image path, reads its GPS with ImageIO (`kCGImagePropertyGPSDictionary`) and reverse-geocodes it with Apple's geocoder, `CLGeocoder` (`preferredLocale` `en_AU`). It prints JSON with names only (`subLocality`, `locality`, `subAdministrativeArea`, `administrativeArea`, `isoCountryCode`), or `null` with no GPS. Each lookup sends that photo's coordinates to Apple's geocoding service over the network; the coordinates go nowhere else and never leave the tool's process in any other form. `CLGeocoder` is deprecated in the macOS 26 SDK in favour of MapKit's `MKReverseGeocodingRequest`: if `xcrun swiftc` warns, the tool uses the MapKit API with the same output fields. The privacy position is the same either way.

- Per post, the prepare step geocodes the **original** file (`kind: "original"`, which keeps its GPS) of up to three selected photographs (the first, middle and last that have GPS), 1.5 seconds apart to stay inside Apple's rate limit, and the post's place is the most common result (the first slide's on a tie). Results are cached in `<output>/metadata/places.json` (mode 0600, names only), so each photo's coordinates are sent to Apple once and a rerun doesn't look them up again.
- **Area** is `subLocality`, else `locality` (`bondi beach`, `manhattan`). **City** comes from `scripts/photo-cities.json`, a committed map from `<country>/<administrativeArea>/<subAdministrativeArea or locality>` to a city name (`"AU/NSW/Waverley Council": "sydney"`, `"AU/ACT/City": "canberra"`). Without an entry it is `locality` when `subLocality` was used (`manhattan, new york`), otherwise `administrativeArea`. When area and city are the same, only one is kept. A sample lookup on 2026-10-08 showed why the map is needed: in Australia the geocoder gives the suburb as `locality` (`Bondi Beach`, `Waverley Council`, `NSW`) and never a metropolitan city.
- Prepare applies the place rule of 6.2 (lowercase, trimmed, at most 60 characters, printable Latin-1). A name outside Latin-1 (the oldest posts are in Malta, where names like `Ħamrun` occur) is transliterated with `normalize("NFKD")` and its combining marks removed, and is still listed for review if anything is left outside Latin-1.
- For Australian results with no map entry, prepare stops and lists each missing key with its post, so the map is filled once (the 32 posts need a handful of entries) before import. Prepare also prints every post's derived place for review.

### 7.3 The import

`photos:import` first upserts `photo_posts` for every post in the manifest: `published_at` and `published_on` always, `place` only where `place_edited = 0`. It then imports photographs as now, with three changes: it requires eight previews (2.2), it never overwrites `title` on conflict (2.2), and it sets `photos.raw_review` from the manifest's `needsRawReview`. Remote import still runs from George's Mac with `--remote` (section 12).

## 8. Data: migration 0006

`migrations/0006_photo_gallery.sql`, applied with `wrangler d1 migrations apply` (`bun run db:migrate:local`, and the deploy job's `bun run db:migrate:remote`), never `execute --file`:

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

`photos.collection` has no foreign key to `photo_posts` (SQLite can't add one to an existing table); every public query joins the two, so a photograph whose post row is missing simply isn't shown, and the import writes posts before photographs.

## 9. Privacy and security (part 1)

- The site still sets no cookies and uses no storage. The beacon (R10) runs on `/photos` and `/photos/<id>` and sends its `$pageview` with the path only (ADR-0013), so a `?before=` cursor is never sent. No new events.
- `/photos/downloads` carries no beacon and is refused by the ingest proxy (2.2). Tokens never reach analytics, logs (`redact_query_string`, and no handler logs a URL or request) or referrers (`Referrer-Policy: no-referrer`).
- Places: the import turns each post's GPS into "area, city" on George's Mac (section 7). The lookup itself sends one photo's coordinates per request to Apple's geocoding service, the same one Photos uses to name these places, once per photo at import, as ADR-0022 (amended) records; nothing else receives them, and only the place string reaches the manifest, D1 or the site. Coordinates are never stored in D1 or R2. George can edit or hide any place (6.2).
- The privacy smoke test (R14) adds `/photos`, `/photos/<id>` and a downloads page: no `Set-Cookie`, empty storage, every request to the site's own origin.

## 10. Performance budgets (part 1)

R11's method applies to `/photos` (first batch) and `/photos/<id>`:

- JavaScript before any interaction: under 10KB gzipped per page (the beacon plus `photo-sheet.ts`), all inline, no framework.
- HTML under 30KB gzipped (the first batch of 68 frames is about 12KB), CSS under 15KB gzipped, the same two fonts.
- Image bytes loaded before any scroll on `/photos` at 375 × 812: under 250KB, gated in the budget spec. On the real first batch the head row and the first entry's visible rows load well under that (the whole first entry at 240 AVIF is 121KB).
- Cumulative layout shift under 0.01 at 1280px and 375px, on `/photos` including after one batch loads, and on `/photos/<id>`.
- Largest contentful paint under 1.5s, a Lighthouse warning after each deploy: `scripts/lighthouse.mjs` takes several URLs and runs `/`, `/photos` and one photograph page.

## 11. Testing (part 1)

### 11.1 Unit (Vitest)

- The entry mode: ordering, the `limit + 1` cursor, only 240 and 480 previews, posts with no published photograph left out.
- The import on the real migrations over `node:sqlite`: `photo_posts` upserts, `place_edited` respected, titles kept on re-import, `raw_review`, eight previews required.
- Places: `photo-cities.json` lookups, the fallbacks, transliteration, the stop on a missing Australian entry, with recorded placemark fixtures (no geocoding in tests).
- Admin: the new actions, the link nonce, all-or-nothing post publishing, the place rule, `photo links are internal`.

### 11.2 End to end (Playwright)

- **Gallery** (Chromium, WebKit, phone): entries, headings and frames from the fixture; no place shown for a post without one; the plain `older entries` link without JavaScript; the next batch loading as the page nears the bottom; `that's every entry.`; `noindex` on a `?before=` page; a photograph page with previous and next; the 404 for an unpublished photograph; no layout shift.
- **Downloads page:** a valid link lists every published photograph and downloads a JPEG whose bytes match the master; private headers and no `Set-Cookie`; no request carries a `Referer`; an expired link (a token the test signs with the fixture key and an already-expired grant row inserted with `wrangler d1 execute --command`), a revoked link and a garbled one each show the same 403 page; no beacon request.
- **Admin** (on the admin server, 4333): publish and hide a post and a photograph; a verification failure publishes nothing; edit a place and a title; issue a link, see it once, reload without a second link, revoke it.
- **Privacy and budgets:** as sections 9 and 10.

### 11.3 Fixture

`scripts/seed-photo-test.mjs` seeds six posts, each photograph with eight previews, with `photo_posts` rows and fixed dates: `fixture` (the existing three 2048 × 2048 photographs, `fixture-03` unpublished, place `bondi, sydney`), `fixture-b` (`fixture-b-01` 4000 × 6000 portrait and `fixture-b-02` 6000 × 4000 landscape, both 2:3, no place), `fixture-c` (`fixture-c-01`, 1200 × 1800) and `fixture-d`, `fixture-e` and `fixture-f` (one 2048 × 2048 photograph each), so the gallery has a second page. Part 2 uses the same fixture for prints.

## 12. Launch (part 1)

Only George can do these:

- [ ] Create the R2 bucket **before this branch deploys**, because `wrangler.jsonc` already binds it: `bunx wrangler r2 bucket create curiousgeorge-photo-prints --location oc`; confirm it has no `r2.dev` URL and no custom domain.
- [ ] Set `PHOTO_LINK_SECRET` (64 lowercase hex characters, fresh, not the local one): `bunx wrangler secret put PHOTO_LINK_SECRET`.
- [ ] After the deploy has applied migration 0006, run the photo import from the Mac: `photos:prepare` (now with places, dates and 240 previews, filling `scripts/photo-cities.json` where it stops) then `photos:import --remote`, as in docs/photo-gallery-backend.md.
- [ ] Review every post in `/admin` (places included, ADR-0022) and publish what should be public, looking hardest at the 96 RAW candidates (`raw` pills).

After launch (agent or George): issue the first catalogue link from `/admin` and open it on a phone; check `/photos` against section 10 with the post-deploy Lighthouse run; check the privacy test passes on the live photo pages.

# Part 2: prints

## 13. Routes, code changes and what part 2 needs from part 1

### 13.1 What part 2 needs from part 1

Part 2 starts only after plan A has shipped, and relies on: `photo_posts` with dates and places and the public `date` and `place` fields (names and line items); the 240 and 480 previews (basket and checkout images); a photograph's name (section 4); `/photos/<id>` and its row layout, into which part 2 adds the `prints` row; `Notebook.astro`'s `noindex` and `referrer` props; the middleware's private-response mechanism for `/photos/downloads`; `photo_download_grants` and `downloadPhoto`; `setPublished`; and the generalised admin purge and section framework.

### 13.2 Routes

| Route | Behaviour | Caching |
|---|---|---|
| `/photos/<id>` | Gains the `prints` row (section 15.1) | Unchanged without `items`; `no-store` and `noindex` with `items` (15.3) |
| `/photos`, `/photos?before=` | Carry the basket when the URL has `items` (15.3) | As above |
| `/basket?items=…&country=…` GET | The basket, its quote and the way to checkout (section 15.2) | `no-store`, `noindex` |
| `/basket` POST | `intent=checkout` starts checkout (section 17) | `no-store` |
| `/prints/<order id>?key=<view key>` | A buyer's private order page (section 18.5) | Private headers, never cached |
| `/api/prints/stripe` POST | Stripe's webhook (section 18.1) | `no-store` |
| `/api/prints/artelo` POST | Artelo's webhook (section 18.3) | `no-store` |
| `/admin` | The print orders section (section 20) | As R7 |

`robots.txt` adds `Disallow: /prints/` and `Disallow: /basket`.

### 13.3 Code changes

- **Worker entry:** `wrangler.jsonc` `main` becomes `src/worker.ts`, which exports `fetch` (Astro's `handle` from `@astrojs/cloudflare/handler`) and `scheduled` (section 18.6). `wrangler.jsonc` adds `"triggers": { "crons": ["*/5 * * * *"] }`, `"send_email": [{ "name": "EMAIL" }]`, `"ratelimits": [{ "name": "QUOTE_LIMIT", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } }, { "name": "CHECKOUT_LIMIT", "namespace_id": "1002", "simple": { "limit": 6, "period": 60 } }]` and the vars in 21.4. The first plan B task proves with a probe build that `dist/server/wrangler.json` keeps the cron, both rate-limit bindings and the email binding, and that `wrangler dev --test-scheduled` reaches the handler. If the adapter can't keep a custom entry, the scheduled work moves to a separate Worker, `workers/prints/`, built like the snapshots Worker (R9) with the same bindings and secrets, and nothing else in this spec changes.
- **Order grants:** `issueOrderGrant(db, secret, orderId, photoId, seconds)` in `src/lib/photos/store.ts` inserts a photo-scoped grant carrying `order_id` (migration 0007) and returns its download URL; only print fulfilment calls it. `downloadPhoto` serves a grant with an `order_id` from its photo's current master whether or not the photo is published; catalogue grants keep requiring publication.
- **Middleware** (`src/middleware.ts`): the private-response treatment extends to `/prints/`. The Origin check (R7, ADR-0011) exempts exactly two paths, `POST /api/prints/stripe` and `POST /api/prints/artelo`, because providers send no `Origin`; both verify a signature before reading anything else (sections 18.1 and 18.3).
- **CSP** (`astro.config.mjs`): `form-action 'self' https://checkout.stripe.com`, because Chrome applies `form-action` to the redirect that follows a form post, and checkout is a post answered with a 303 to Stripe (section 17). Nothing else changes.
- **Ingest:** events whose `$pathname` starts with `/prints/` are refused too.
- **Gallery pages** gain the basket carry of 15.3, and `photo-sheet.ts` appends the current `items` to the frame links it builds.

## 14. Sizes and prices (ADR-0021)

### 14.1 Sizes and which photographs get them

Every print is Artelo's `IndividualArtPrint` on `ArchivalMatteFineArt` paper, unframed or in Artelo's standard oak frame (`frameColor: "NaturalOak"`, frame style `Oak`), with no mat, framing service or hanging pins. Sizes come from Artelo's `ProductSize` enum (inches, short side first) and only from the sizes its documentation lists as taking frames (`NON_GALLERY_PRODUCT_SIZES_SUPPORTING_FRAMES`), so every size can be both unframed and framed.

George's price list names A4, A3 and A2. The page calls them small, medium and large, because the real sizes differ by aspect ratio; true A sizes would crop every 2:3 photograph by about 6%. For each ratio family, each tier uses the frameable Artelo size of that ratio whose area is nearest the A size's (A4 96.7, A3 193.4, A2 386.9 square inches):

| Family | Ratio (long ÷ short) | small (A4 tier) | medium (A3 tier) | large (A2 tier) |
|---|---|---|---|---|
| 2:3 | 1.5 | `x8x12` | `x12x18` | `x16x24` |
| 3:4 | 1.333 | `x9x12` | `x12x16` | `x18x24` |
| 4:5 | 1.25 | `x8x10` | `x11x14` | `x16x20` |
| ISO A | 1.414 | `x8dot3x11dot7` | `x11dot7x16dot5` | `x16dot5x23dot4` |
| 1:1 | 1 | `x10x10` | `x12x12` | `x20x20` |

This table lives in `src/lib/prints/catalogue.ts`. For a photograph of `w × h` pixels (the master's `print_width` and `print_height`), with `r = long ÷ short`:

- **Crop** for a print of ratio `p` is `1 - min(r, p) ÷ max(r, p)`: the share of the long side cut away when the print is filled edge to edge (Artelo `fitOptions: { canvas: "Paper", style: "Outside" }`, centred). The tolerance is **3%**.
- **Family:** the one whose nominal ratio crops least. If even that crops more than 3%, the photograph has no prints.
- **Each tier** qualifies when its own size crops at most 3% (`x11x14` is 1.273, so a 4:5 photograph's medium crops 1.8%) and the print reaches **200 pixels per inch**: `min(short ÷ short inches, long ÷ long inches) ≥ 200`.
- **Orientation:** a portrait or square photograph prints `Vertical`, a landscape one `Horizontal`.
- A photograph with no qualifying tier offers no prints; the print row is not rendered (R2's rule for empty sections).

On George's selection this gives: 407 photographs in all three sizes (362 at 3648 × 5472 in 2:3; 45 in 3:4 at 4284 × 5712 or larger), 51 in small and medium (3:4 at 3024 × 4032 and one at 2858 × 3811, whose large would be under 200 ppi), 1 in small only (2194 × 3291) and 3 with no prints (two near 7:6, one near 16:9).

Size labels give both units, rounded to whole centimetres: `small · 8 × 12 in (20 × 30 cm)`.

### 14.2 Prices

Fixed AUD prices, one per tier and frame, the starting list George agreed, stored in D1 (`print_prices`, section 22) and changed only by a new migration:

| Tier | Unframed | Oak frame |
|---|---|---|
| small (A4) | $59 | $139 |
| medium (A3) | $79 | $179 |
| large (A2) | $119 | $259 |

A size's price is its tier's price whatever the exact Artelo size, so a 3:4 large (18 × 24 in) costs the same as a 2:3 large (16 × 24 in); the check script (17.4) proves the margin holds for every real size. George sells as himself and isn't registered for GST, so the prices carry no GST. Wherever prices appear to a buyer (the print row, the basket, Stripe's checkout page, Stripe's receipt and the order page) the same plain sentence says so: `prices include no gst; the seller isn't registered for gst.` There is no invoice (ADR-0021 as amended).

## 15. The print row and the basket

### 15.1 The print row on /photos/<id>

Shown when prints are open (16.4) and the photograph has at least one size (14.1). Margin label `prints`, one `<form method="get" action="/basket" id="prints">`:

- Intro: `a print of this photo, made by artelo on archival matte paper and posted from the us.`
- `size` radios, one per qualifying tier, the first checked: `small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed`.
- `frame` radios: `unframed` (checked) and `oak frame`.
- Hidden `add` (the photo id) and, when the page was reached with a basket, hidden `items` (15.3).
- Button `add to basket`, and under it `delivery to your country is added in the basket. prices include no gst; the seller isn't registered for gst.`

The form works without JavaScript and has no script. Submitting it lands on `/basket?items=…&add=<id>&size=<tier>&frame=<frame>`, which answers 303 to the canonical basket URL with the print appended (15.2). The total with delivery is shown on the basket page, where the country is chosen.

### 15.2 The basket page, /basket

The basket lives only in the URL's query string, never in cookies, localStorage or sessionStorage, so "cookies none" and the privacy test's empty storage stay true (ADR-0021 as amended). The address bar shows it and anyone can edit it, so the server re-validates every item, tier and price on every request and trusts nothing from the query string. In return, a basket can be bookmarked or shared.

**The query string:**

- `items`: comma-separated entries `<photo id>:<tier>:<frame>`, `tier` one of `small`, `medium`, `large`, `frame` one of `unframed`, `oak`. Each entry is one print; identical entries make one line with a quantity. At most **10 prints**.
- `country`: optional ISO 3166 code, from the list in 16.3.
- `add`, `size`, `frame` (from the print row) and `remove=<n>` and `more=<n>` (a line number, from the basket's own links): each is applied and answered with 303 to the canonical URL (`items` in the original order with the change applied, then `country`), so the address bar always holds a clean basket.

**Validation:** an entry naming an unknown or unpublished photograph, a tier the photograph doesn't offer, an unknown tier or frame or anything past the tenth print is dropped, with a line saying so: `1 print was taken out: that photo isn't available as a print any more.` or `a basket holds up to 10 prints.` A malformed `items` is treated as empty. Parsing lives in `src/lib/prints/basket.ts`, as pure functions.

**The page** (`src/pages/basket.astro`, `noindex`, `Cache-Control: no-store`, the beacon's `$pageview` sends the path `/basket` only):

| Margin label | Content |
|---|---|
| `basket` (head row) | `<h1>your basket</h1>`, then `this basket lives in the address bar: bookmark or share this page to keep it.` and `keep looking` linking to `/photos?items=…` |
| `prints` | One line per print line: its 240 preview, its name (section 4), `medium · 12 × 18 in · oak frame`, `× 2` when more than one, the line price and links `one more` (left out at 10 prints) and `remove one` |
| `delivery` | A `<form method="get" action="/basket">` with hidden `items`, the `country` select (first option `choose a country`) and a `see delivery` button. Then the quote line (16.2) |
| `pay` | When a country is chosen and the quote succeeded, a `<form method="post" action="/basket">` with hidden `items`, `country`, `shown_total` and `intent=checkout`, a `continue to payment` button and under it `payment happens on stripe's own checkout page, which sets its own cookies. this site sets none.` |

An empty basket shows `your basket is empty. find a photo you like.` linking to `/photos`. When prints are closed the basket shows its lines and `prints are closed for now.` with no delivery or pay rows. With JavaScript (`src/scripts/basket.ts`, inline), changing the country submits the delivery form, and `see delivery` is hidden.

### 15.3 Carrying the basket through the gallery

When `/photos`, `/photos?before=` or `/photos/<id>` is requested with a valid `items` parameter, the page renders every link to a gallery page with that `items` appended, adds `basket · 3 prints` (linking to `/basket?items=…`) to its head row, puts `items` in the print row's hidden field, and is not edge-cached: no `Astro.cache.set`, `Cache-Control: no-store` and `noindex`. Without `items` the pages are cached exactly as in part 1, so ordinary browsing never costs a D1 read. The basket's `keep looking` link starts this carry.

## 16. Delivery quotes

### 16.1 Artelo's cost

Get Catalog Product Costs (`POST https://www.artelo.com/api/open/catalog/get-costs`, `Authorization: Bearer <ARTELO_API_KEY>`) takes one product (`catalogProductId`, `size`, `frameStyle`, `paperType`, the three booleans, `shippingDestination` and `quantity`) and answers `{ productionCost, shippingCost }`. It doesn't take several different products. Artelo's Price Check does take several items and returns one combined `arteloShipping`, but it needs a full street address, which the site doesn't have (and doesn't want) before Stripe collects it. So the site can't get Artelo's combined freight for a basket before payment, and uses this rule instead:

- **Group** the basket's prints by Artelo size and frame. For each group, ask Get Catalog Product Costs with `catalogProductId: "IndividualArtPrint"`, the size, `frameStyle: "Oak"` or `"Unframed"`, `paperType: "ArchivalMatteFineArt"`, `includeMats`, `includeFramingService` and `includeHangingPins` all `false`, `shippingDestination: <country>` and `quantity: <prints in the group>`, so identical prints are priced together by Artelo itself.
- **Delivery** is the sum of the groups' `shippingCost`, converted to AUD and with the buffer added, rounded **up** to a whole dollar: `delivery = ceil(Σ shippingCost × usd_aud × (1 + delivery_buffer))` dollars.
- The basket says so, honestly (16.2): Artelo may pack prints together for less than the sum, and the difference is not refunded.

**The cache:** answers are kept in D1, `print_costs(size, frame, country, quantity, production_cost, shipping_cost, refused, fetched_at)` with the first four as primary key, for 6 hours, including Artelo's refusal for a country it won't ship to (`refused = 1`); network errors and 5xx answers aren't kept. A **refusal** is a 400 or 422 answer to a well-formed request; 401, 403, 408, 429 and 5xx are errors, not refusals. The first `prints:check` run asks for Antarctica (`AQ`, which Stripe accepts) and prints Artelo's exact answer, so the rule can be tightened to Artelo's real status and error code if it differs. The cache is shared by every Cloudflare location, unlike the Workers Cache API, so a spread of quotes doesn't multiply Artelo calls; the per-address rate limits (21.3) are per location, which is accepted.

### 16.2 The quote line on the basket

Once a country is chosen: `prints $238 + delivery $65 = $303`, then:

- `in australian dollars. prices include no gst; the seller isn't registered for gst.`
- `delivery is what artelo charges me to post these to australia, worked out for each size and frame and added up, plus 8% in case the exchange rate moves. artelo may send them together for less.` (the country and the current buffer from `print_settings`)

A country Artelo refuses shows `artelo can't post to <country> yet.` and no pay row. When Artelo or the rate is unavailable: `delivery prices aren't loading right now. try again in a minute.` (status 503). Past the rate limit: `too many tries - wait a minute and try again.` (429).

### 16.3 The exchange rate, the buffer and countries

- **The exchange rate** is the European Central Bank reference rate from Frankfurter (`https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD`, no key, no visitor data sent), fetched by the daily job (18.6) into `print_settings` (`usd_aud`, `usd_aud_date`). A rate outside 0.8 to 3 is ignored and logged. A rate older than 7 days still quotes, with a warning in `/admin`; no rate at all closes prints.
- **The buffer** is `print_settings.delivery_buffer`, seeded at `0.08` by migration 0007 and editable in `/admin` (section 20) from 0 to 0.20, so changing it needs no deploy. 8% is enough because Artelo bills George's card, which has no foreign transaction fee, leaving the buffer for rate movement and the card fee on the delivery line.
- **Countries:** the select lists every ISO 3166 code Stripe accepts in `shipping_address_collection.allowed_countries` (fixed in `src/lib/prints/countries.ts`), named with `Intl.DisplayNames("en-AU", { type: "region" })` and lowercased, sorted by name. The page never guesses the visitor's country.

### 16.4 When prints are open

Prints are **open** when three things hold: the var `PRINTS_OPEN` is `"true"`, the secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ARTELO_API_KEY`, `ARTELO_WEBHOOK_SECRET`, `PRINT_VIEW_SECRET` and `PHOTO_LINK_SECRET` are all set and an exchange rate is stored. Otherwise the print row is not rendered, the basket says `prints are closed for now.`, and `/admin` says which condition is missing. While open, part 2 also adds ` some come as prints.` to the home page's photo line (3.7) and to the gallery's intro line (3.1).

## 17. Checkout

### 17.1 Starting checkout

`POST /basket` with `intent=checkout`:

1. Checks `CHECKOUT_LIMIT` (21.3) and that prints are open, the basket parses to at least one print with every entry valid (any dropped entry renders the basket again with its line, status 422) and the country is in the list.
2. Recomputes the quote on the server; the posted numbers are never trusted. If `shown_total` differs, the basket renders again with the new quote and `delivery to <country> is $<n> - this is the new total.` (422, the country's name and the recomputed delivery), and nothing is charged.
3. Creates the order first, so a payment can never arrive for an order the site doesn't know (section 19): one `print_orders` row (`id` a new lowercase ULID from `src/lib/admin/ulid.ts`, status `checkout`, the country, `print_total`, `delivery_amount`, `livemode` from the key's `sk_live_` or `sk_test_` prefix) and one `print_order_items` row per line (photo, tier, Artelo size, frame, quantity, unit price), in one batch.
4. **The view key** is `base64url(HMAC-SHA256(PRINT_VIEW_SECRET, "order-view:" + order id))`, recomputed whenever it's needed (the success URL, the shipped email) and never stored. The order page recomputes it and compares in constant time. Rotating `PRINT_VIEW_SECRET` invalidates every order link already sent, which is accepted.
5. Creates a Stripe Checkout Session with `fetch` (no SDK; form-encoded; `Stripe-Version: 2025-09-30.clover`; `Idempotency-Key: checkout-<order id>`) with these form fields:
   - `mode=payment`, `payment_method_types[0]=card` (cards and the wallets that use them), `submit_type=pay`, `locale=auto`, `expires_at` one hour ahead, `adaptive_pricing[enabled]=false`, so the buyer always pays the AUD total the site showed;
   - for each print line `i`: `line_items[i][price_data][currency]=aud`, `line_items[i][price_data][unit_amount]` the tier price in cents, `line_items[i][price_data][product_data][name]` `print of <name> · medium, 12 × 18 in · oak frame`, `line_items[i][price_data][product_data][description]` `archival matte paper, made and posted by artelo`, `line_items[i][price_data][product_data][images][0]` the photo's 480 WebP preview URL, `line_items[i][quantity]` the line's quantity;
   - the last line, delivery: `line_items[n][price_data][product_data][name]` `delivery to australia, 3 prints`, its `unit_amount` the delivery amount, `line_items[n][quantity]=1`;
   - `shipping_address_collection[allowed_countries][0]=<the chosen country>` only, and `phone_number_collection[enabled]=true` (Artelo needs a phone number for international delivery);
   - `custom_text[shipping_address][message]` `your address goes to stripe and artelo only, to deliver your prints.` and `custom_text[submit][message]` `prints are made and posted by artelo in the us. prices include no gst; the seller isn't registered for gst.`;
   - `payment_intent_data[description]` `print order <order id> · prices include no gst; the seller isn't registered for gst`, which Stripe's free receipt shows;
   - `client_reference_id=<order id>`, `metadata[order_id]`, `metadata[country]`, `metadata[print_total]`, `metadata[delivery_amount]` and `metadata[line_1]` to `metadata[line_10]` (`<photo id>:<tier>:<frame>:<quantity>`, one per line) and `payment_intent_data[metadata][order_id]`;
   - `success_url=<SITE_ORIGIN>/prints/<order id>?key=<view key>`, `cancel_url=<SITE_ORIGIN>/basket?items=…&country=…`.
6. Stores `stripe_session_id` and answers **303** to the session's `url`. If Stripe refuses or is unreachable, the order becomes `expired` and the basket shows `couldn't reach the payment page. nothing was charged - try again in a minute.` (503).

### 17.2 GST later

When `PRINT_GST` is `"inclusive"` (if George registers for GST later), Australian orders add `line_items[i][tax_rates][0]=<STRIPE_GST_TAX_RATE>` (an inclusive 10% rate George creates in Stripe) to every line, other countries add none (exports carry no GST), and the GST sentence becomes `prices include gst for orders posted within australia.` everywhere it appears. No code changes. While `PRINT_GST` is `"none"`, the sentence of 14.2 is used.

### 17.3 The seller on Stripe

Stripe's Checkout and receipt show the seller as the Stripe account's public business name, which George sets to `george vlachos` (section 24). `PRINT_SELLER_NAME` (`"george vlachos"`) is used for Artelo's shipping label (18.2).

### 17.4 The margin check, bun run prints:check

`scripts/print-check.mjs` (`--local` or `--remote` chooses which D1 the prices and buffer are read from; the Artelo key comes from `ARTELO_API_KEY` in the process environment and is never printed):

- For every size in the table in 14.1 and both frames: Get Catalog Product Costs to `AU` and `US`, and Artelo's Price Check (`POST /orders/price-check`) with exactly the `productInfo` the site sends at order time (14.1, 18.2), to public landmark addresses: `AU` Sydney Opera House (Bennelong Point, Sydney NSW 2000) and Parliament House Darwin (State Square, Darwin NT 0800); `US` the White House (1600 Pennsylvania Avenue NW, Washington DC 20500) and Iolani Palace (364 South King Street, Honolulu HI 96813); `GB` 10 Downing Street (London SW1A 2AA). Plus one Price Check of a two-item order (a small unframed and a large oak print) to each address, to show how far Artelo's combined freight sits below the sum rule of 16.1.
- **Fails** (exit 1) when Artelo refuses any combination (the size table, frame or paper is then wrong and must be fixed before prints open), or when any combination's margin is below **15%**.
- **The lookup check:** creates one Artelo order with `isTestOrder: true` and `orderId: check-<timestamp>`, then calls `GET /orders/get?limit=5&name=<that id>` and fails if the order isn't returned, because the duplicate guard of 18.2 depends on it.
- Prints a table per size and frame: production in USD and in AUD at `usd_aud × 1.03` (deliberately conservative, although George's card has no foreign transaction fee), the price, the worst-case card fee (3.5% + $0.30, Stripe's international card rate in Australia), the worst-case freight shortfall (the buffer minus the card fee on delivery minus 3% exchange), the margin in dollars and as a share of the price, and delivery to each address. It prints every field Price Check returns.
- **Warns** (exit 0, a GitHub annotation in CI) when a margin is under the **30% floor**, or when Price Check's total for a real address (every amount it returns, including any tax or duty fields) differs by more than 5% from Get Catalog Product Costs' production plus shipping for the same country. It also prints Artelo's answer for `AQ` (16.1).
- George runs it before opening prints and whenever Artelo's prices or the rate move a lot (ADR-0021); it is not part of CI (it needs the live key).

## 18. After payment

### 18.1 Stripe's webhook, processed exactly once

`POST /api/prints/stripe` (subscribed events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`):

- Reads the raw body (refused with 413 past 256KB) and verifies `Stripe-Signature`: `t=<seconds>,v1=<hex>[,v1=…]`, HMAC-SHA256 of `<t>.<raw body>` with `STRIPE_WEBHOOK_SECRET`, compared in constant time against each `v1`, with `t` within 300 seconds of now. Anything else is a 400 before the body is parsed.
- **The guard:** the handler first reads `SELECT 1 FROM stripe_events WHERE id = ?`; a row means the event was applied: answer 200. Otherwise it runs the event as one D1 `batch()` (a transaction) whose first statement is `INSERT INTO stripe_events (id, type, received_at)`, so the event row and the order change commit together. The `INSERT` still guards a concurrent duplicate: that one fails the batch and answers 500, and Stripe's redelivery then finds the row.
- **An event whose order can't be found is not recorded:** the handler answers 500 so Stripe redelivers it (Stripe retries for 3 days), except `checkout.session.completed`, which recreates the order (below).
- **`checkout.session.completed`** applies the **paid transition**, a function the reconciliation (18.6) shares. A session whose `payment_status` isn't `paid` records nothing, logs the event id and answers 200. Otherwise it finds the order by `client_reference_id`, checks `livemode` matches and that `currency` is `aud`, there is no `currency_conversion` and `amount_total` equals `print_total + delivery_amount`. The batch moves the order from `checkout` (or `expired`) to `paid`, storing `paid_at`, `stripe_session_id`, `stripe_payment_intent`, `attempts = 0`, `retry_until = paid_at + 24 hours` and `next_attempt_at = now`. The status condition in the `UPDATE ... WHERE status IN ('checkout', 'expired')` is the session guard: a second event for the same session changes nothing. If the currency or amount differs, or the session carries `currency_conversion`, the order still becomes `paid` but goes straight to `needs_attention` with `the amount paid differs from the quote`. If no order row exists (it never should), the batch inserts one, taking `livemode` from the event and its country, amounts and lines from the session's `metadata`, directly in `needs_attention` with `the order row was missing; check it before it's placed.` After the batch commits, the first placement attempt runs in `waitUntil` (18.2) and the handler answers 200 at once.
- **`checkout.session.expired`:** `checkout` becomes `expired`.
- **`charge.refunded`:** finds the order by `payment_intent` and stores `refunded_at` and `refunded_amount`. A full refund of an order not yet placed (`paid` or `needs_attention` with no `artelo_order_id`) moves it to `refunded`, which stops retries. A full refund of an order that is `placed` or `in_production` moves it to `needs_attention` with `refunded in stripe: cancel it in artelo if it hasn't printed.`. A partial refund changes nothing but `refunded_at` and `refunded_amount`.
- Logs carry only event ids, types and order ids.

### 18.2 Placing the Artelo order

`placeOrder(orderId)` in `src/lib/prints/place.ts`, called from the webhook's `waitUntil`, the cron (18.6) and `retry now`. Every attempt places the whole order; the site never places part of one.

1. **Claim** the order: `UPDATE print_orders SET lease_until = now + 120, attempts = attempts + 1 WHERE id = ? AND status = 'paid' AND next_attempt_at <= now AND (lease_until IS NULL OR lease_until < now)`. No change means another run holds it or it isn't due; stop.
2. **Look before creating:** every attempt first asks `GET /orders/get?limit=5&name=<order id>`; an Artelo order whose `orderId` equals ours means an earlier attempt succeeded after its answer was lost (or the order is already at Artelo awaiting action), so the site adopts it (step 6) instead of creating a duplicate. If the lookup itself fails, the attempt stops and counts as retryable; the site never creates an order it couldn't look up first.
3. **Fetch the address from Stripe**, in memory only: `GET /v1/checkout/sessions/<session id>` with the pinned version; the name and address from `collected_information.shipping_details` and the phone from `customer_details.phone`. Nothing from it is stored or logged.
4. **Issue the master links:** for each distinct photo in the order, `issueOrderGrant(db, PHOTO_LINK_SECRET, orderId, photoId, 72 hours)` returns `<SITE_ORIGIN>/photos/downloads/<photo id>?token=<token>`. This is the existing full-resolution route serving the private master JPEG from `PHOTO_PRINTS`, never a preview, and an order grant serves its photo's current master whether or not the photo is published (13.3): a paid print goes ahead if George hides the photo afterwards. A photo whose master object is missing from `PHOTO_PRINTS` (checked with `head`) is a permanent failure for the whole order (section 19). The links are never shown anywhere; they are revoked once the order reaches `in_production` (18.3), and 72 hours is the ceiling for orders stuck while Artelo processes images.
5. **Create the order** (`POST https://www.artelo.com/api/open/orders/create`, 15-second timeout), one Artelo order with every print:

   ```json
   {
     "orderId": "<order id>", "createdAt": "<paid_at, ISO 8601>", "currency": "AUD",
     "total": 303, "shippingCost": 65, "channelName": "curiousgeorge.dev",
     "companyName": "george vlachos", "isTestOrder": false,
     "customerAddress": { "name": "…", "street1": "…", "street2": "…", "city": "…", "state": "…",
                          "zipcode": "…", "country": "AU", "phone": "…" },
     "items": [{ "orderItemId": "<order id>-1", "quantity": 1, "unitPrice": 179,
       "productInfo": { "catalogProductId": "IndividualArtPrint", "size": "x12x18",
         "frameColor": "NaturalOak", "paperType": "ArchivalMatteFineArt", "orientation": "Vertical",
         "canvasDesignedFor": null, "canvasBorderStyle": null,
         "includeFramingService": false, "includeHangingPins": false, "includeMats": false,
         "designs": [{ "sourceImage": { "url": "<master link>" },
                       "fitOptions": { "canvas": "Paper", "style": "Outside" } }] } },
       { "orderItemId": "<order id>-2", "quantity": 1, "unitPrice": 59, "productInfo": { "…": "…" } }]
   }
   ```

   - One item per print line, `orderItemId` `<order id>-<line>`, its own size, frame, orientation and master link. `frameColor` is `null` for unframed prints. `isTestOrder` is `true` for every test-mode order (`livemode = 0`), so Stripe test payments never produce a real print. `companyName` is `PRINT_SELLER_NAME`. `dangerouslySkipDPICheck` is never sent.
   - Address mapping: `street2` only when present; `city` is the address's city, or its state when the city is empty; `state` is the address's state, or its city when the state is empty; `zipcode` is the postal code or `""`; `phone` is sent only when the country isn't `US`. The buyer's email is not sent to Artelo.
6. **On success** (a 2xx with an order `id`): the status mapping of 18.3 for the status Artelo returns (usually `placed`), `artelo_order_id`, `artelo_status`, `placed_at`, `artelo_cost` (from `details.productionCost + details.arteloShipping`, in US cents), lease cleared.
7. **On failure:** section 19.

### 18.3 Artelo's webhook and the status poll

`POST /api/prints/artelo` (topic `OrderStatusChange`, registered by `bun run prints:webhook`, 18.6):

- Reads the raw body (413 past 64KB) and verifies `x-artelo-signature`: the hex HMAC-SHA256 of the body with `ARTELO_WEBHOOK_SECRET`. Artelo's example signs `JSON.stringify(req.body)`, so the handler accepts a match over the raw body or over `JSON.stringify(JSON.parse(raw body))`, both compared in constant time. A mismatch answers 400 `{ "code": "invalid_signature" }`, as Artelo's documentation shows.
- Reads `orderId`, `status` and `shipments` from the top level of the body, or from a top-level `data` object. The order is found by `artelo_order_id = orderId`, or failing that `id = orderId`. A signed body it can't read, or an unknown order, answers 200 (so Artelo doesn't retry 20 times and delete the webhook) and logs the body's top-level keys only.
- Must answer within 10 seconds: it only updates D1 and sends any email in `waitUntil`.
- Every accepted webhook stores `print_settings.artelo_webhook_at`, shown in `/admin`.

Artelo status to order status:

| Artelo status | Order status | Also |
|---|---|---|
| `ImagesProcessing`, `Received`, `Ignored` (test orders) | `placed` | |
| `PendingFulfillmentAction` | `needs_attention` | reason `artelo needs something before it can print: open the order in artelo.`, George is emailed |
| `InProduction` | `in_production` | the order's grants are revoked (`revoked_at = now`) |
| `Shipped` | `shipped` | every shipment's `carrierCode`, `trackingNumber` and `trackingUrl` stored in `shipments`; grants revoked if still active; the buyer is emailed (18.4) |
| `Delivered` | `delivered` | grants revoked if still active |
| `Canceled` | `cancelled` | George is emailed `artelo cancelled order <id>. refund it in stripe.` (left out when it is already fully refunded) |
| anything else | unchanged | `artelo_status` stored, logged |

**Order of statuses.** `placed` < `in_production` < `shipped` < `delivered`; a lower status arriving late is ignored. `needs_attention` set by Artelo ranks with `placed`: a later `InProduction`, `Shipped` or `Delivered` moves the order on and clears `attention_notified_at`; a `PendingFulfillmentAction` arriving when the order is already `in_production` or later is ignored. `cancelled`, `delivered` and `refunded` are final. Artelo's webhook carries no timestamp, so these rules also make a replayed body harmless.

**The poll:** Artelo deletes a webhook after 20 failed deliveries, so the cron (18.6) also asks `GET /orders/get-by-id?orderId=<artelo id>` for orders in `placed`, `in_production` or `shipped` (and `needs_attention` with an `artelo_order_id`) not checked for 12 hours (`status_checked_at`), at most 20 per run, 300ms apart (Artelo allows 50 requests per 10 seconds), and applies the same mapping and rules.

### 18.4 Emails

Cloudflare Email Service through the `send_email` binding `EMAIL`, from `PRINT_FROM_EMAIL` (`prints@curiousgeorge.dev`, name `george vlachos`), with `replyTo: hello@curiousgeorge.dev`, always with both `text` and a plain `html` version.

- **Shipped**, to the buyer, once (`shipped_email_at` set in the same statement that claims the send): the address is fetched from the Stripe session at send time (`customer_details.email`) and never stored. Subject `your prints are on their way` (`your print is on its way` for one). Body: `hi, your prints have left the printer:` then one line per print (`<name> · medium · oak frame`), then one line per shipment (`tracking: <carrier> <number> <tracking url>`), then `you can check on them here: <order page url>. thanks for buying them. - george`. The order page URL is rebuilt with the view key of 17.1.
- **Needs attention**, to `ADMIN_EMAIL`, once each time an order enters `needs_attention` (`attention_notified_at`, cleared when it leaves): subject `print order <id> needs attention`, body the reason and `<SITE_ORIGIN>/admin/#orders`.
- **Paid without a webhook** (18.6), **cancelled by Artelo** and **Artelo webhook missing** (at most once a day), to `ADMIN_EMAIL`.
- Receipts are Stripe's free receipts, which show the payment description with the GST sentence (17.1).
- A failed send is logged with the order id and retried by the next cron run while the guard column is still empty (the claim is released on failure).

### 18.5 The order page, /prints/<order id>?key=…

Shown when the key equals the recomputed view key (17.1, constant-time); otherwise the notebook 404, so the page never says whether an order exists. Private headers (13.3), `noindex`, `referrer="no-referrer"`, no beacon, no script, the key never logged.

| Margin label | Content |
|---|---|
| `your order` (head row) | `<h1>your prints</h1>` (`your print` for one), then one line per print line: its 240 preview, its name, `medium · 12 × 18 in · oak frame`, `× 2` when more than one; then `to australia`, `prints $238 + delivery $65 = $303`, `prices include no gst; the seller isn't registered for gst.` and the paid date |
| `status` | One line by status, below |
| `say hi` | `questions about your order? hello@curiousgeorge.dev` |

Status lines: `checkout` `your payment's on its way through. this page updates when it lands.` (with `<meta http-equiv="refresh" content="10">`, only in this state); `paid` `paid. your prints are being sent to the printer.`; `needs_attention` `paid. something needs sorting before they print. george knows and will email you.`; `placed` `they're with the printer.`; `in_production` `they're being printed and packed.`; `shipped` `they're on their way:` and one `<carrier> <tracking number ›>` per shipment; `delivered` `delivered. enjoy them.`; `cancelled` `this order was cancelled. george will be in touch about a refund.`; `refunded` `refunded.`; `expired` `this checkout wasn't finished, so nothing was charged.` (Singular wording for a one-print order.)

### 18.6 Scheduled work

`scheduled` in `src/worker.ts`, cron `*/5 * * * *`. The webhook is an accelerator; the cron is the guarantee. Each run, in order, each step in its own `try` so one failure doesn't stop the rest:

1. **Place due orders:** `status = 'paid' AND next_attempt_at <= now`, oldest first, at most 10, one at a time.
2. **Reconcile checkouts:** for `checkout` orders created more than 65 minutes ago (sessions expire after 60), at most 20 per run, `GET /v1/checkout/sessions/<stripe_session_id>`. If `status = complete` and `payment_status = paid`, apply exactly the paid transition of 18.1 (same function, same status guard, no `stripe_events` row needed because the `UPDATE ... WHERE status IN ('checkout', 'expired')` is the guard) and email George `print order <id> was paid but stripe's webhook never arrived. check the webhook in stripe.`. If `status = expired`, mark the order `expired`. If `status = open`, call `POST /v1/checkout/sessions/<id>/expire` and leave it for the next run. An order with no `stripe_session_id` (Stripe never answered) becomes `expired`, because its buyer never saw a payment page.
3. Retry unsent emails (18.4).
4. Poll Artelo statuses (18.3).
5. **Daily jobs**, each when its `print_settings` timestamp is more than 20 hours old: refresh the exchange rate; check the Artelo webhook (`GET /webhooks/get` lists one with our URL and topic, else `/admin` and an email say it's missing); delete `expired` orders older than 30 days with their items, `stripe_events` older than 90 days and `print_costs` rows older than 6 hours.

`bun run prints:webhook --local | --remote` (`scripts/artelo-webhook.mjs`) saves the webhook (`POST /webhooks/save`: topic `OrderStatusChange`, URL `<SITE_ORIGIN>/api/prints/artelo`, `filters.statuses` every status in 18.3's table) and pipes the returned `secret` straight into `wrangler secret put ARTELO_WEBHOOK_SECRET` on standard input. It prints only `webhook saved; its secret is stored on the worker.`

## 19. Failure handling

- **Never charged without being tracked:** the order and its items are written before the Checkout Session exists (17.1), the webhook can recreate a missing order from the session metadata (18.1), and the cron's reconciliation (18.6) finds any paid session whose webhook never arrived. A webhook that can't write answers 500, so Stripe redelivers.
- **Whole-order retries with backoff:** after failed attempt `n`, the next waits `min(5 minutes × 3^(n-1), 6 hours)`: 5 minutes, 15, 45, 2 hours 15, then every 6 hours, picked up by the first cron run after it falls due. The window is 24 hours from payment (`retry_until`): when the next attempt would fall after it, the order becomes `needs_attention` with `artelo didn't take the order within a day: <last error>` and George is emailed. That is at most 8 attempts.
- **What counts as retryable:** a network error, a timeout, 408, 429, any 5xx and a failed lookup (18.2 step 2). Any other 4xx (Artelo refusing the order, a bad key) is permanent: `needs_attention` at once with Artelo's error message (at most 200 characters, with anything that looks like an address stripped).
- **Partial refusals go to `needs_attention`:** Artelo's create is one request for the whole order, so a refusal of any item refuses the order, and its message (which may name the item) becomes the reason. A photo whose master is missing, and an order Artelo accepts but then holds in `PendingFulfillmentAction` (for example one design it can't use), go to `needs_attention` too. The site never drops an item to place the rest.
- Other permanent failures, each with a plain reason: a Stripe session that can't be read, a missing secret.
- **No duplicates:** the lease (18.2 step 1) stops two runs placing one order, and the lookup (18.2 step 2) stops a retry recreating an order Artelo already has.
- **retry now** resets the window (section 20); **refunds** happen in Stripe from the admin link (section 20) and arrive as `charge.refunded` (18.1).
- Test builds only (`__TEST_HOOKS__`) read a var `PRINT_RETRY_WINDOW` (seconds) in place of 24 hours, so the end-to-end test can reach `needs_attention` without waiting a day; production builds can't contain it.

## 20. The owner screen in /admin: print orders

A third new section, `orders` (`AdminSection` gains it), after `links`, following 6.1's rules; it purges nothing.

- A status line first: `prints are open` or `prints are closed: <reason>` (16.4), then `us$1 = a$1.52 · ecb rate of 07.10.26` (with `- older than a week, check the rate job` when stale), then `artelo webhook: connected · last heard 08.10.26 14:02` or `artelo webhook: missing - run bun run prints:webhook --remote` (18.6).
- **Delivery buffer:** a number field `buffer` in percent (0 to 20, whole numbers, current value shown), intent `prints.buffer`, saving `print_settings.delivery_buffer`. Hint: `added to artelo's delivery cost for exchange-rate movement. it applies to the next quote.`
- The latest 100 orders whose status isn't `checkout` or `expired`, `needs_attention` first (each with a `--red` dot and its reason), then newest paid first. Each line: paid date and time (Sydney), the order id, the prints (`2 prints: DFkL1xrsnOH-02 medium oak, DFkL1xrsnOH-05 small unframed`, photo ids linked to `/photos/<id>`), `to au`, `$238 + $65 = $303`, a status word (`waiting to place`, `needs attention`, `with artelo`, `printing`, `shipped`, `delivered`, `cancelled`, `refunded`), `test` for test-mode orders, `refunded $65` when partly or fully refunded, Artelo's id and cost (`artelo us$61.40`) once placed, and tracking (`ups 1Z… ›` per shipment) once shipped.
- **retry now** shows only on `needs_attention` orders with no `artelo_order_id` (intent `order.retry`): it sets the order back to `paid` with `attempts` at 0 and a fresh 24-hour retry window (section 19), runs the first attempt in `waitUntil` and redirects with the saved line `retrying - refresh in a minute to see how it went.` A retry is safe against duplicates because every attempt looks the order up at Artelo before creating it (18.2). A `needs_attention` order that Artelo already has shows `open it in artelo` instead.
- **refund in stripe ›** on every paid order: a link to `https://dashboard.stripe.com/payments/<payment intent>` (`/test/payments/…` for test-mode orders), opening in a new tab. The hint under the list: `refunds happen in stripe. a refund doesn't cancel the artelo order, and an artelo cancellation doesn't refund the buyer; a full refund of a placed order shows here as needs attention until it's cancelled in artelo.`

## 21. Privacy and security (part 2)

### 21.1 Cookies and analytics

- The site still sets no cookies and uses no storage. The basket is in the URL (15.2). Stripe's Checkout is on Stripe's own domain, and the basket says so before the button. `visitor info` (R2) is unchanged and stays true of curiousgeorge.dev.
- The beacon sends `/basket` and `/photos…` page views with the path only (ADR-0013), so a basket's `items` never reaches analytics. `/prints/` carries no beacon and is refused by the ingest proxy (13.3). View keys and order tokens never reach analytics, logs or referrers.
- The privacy smoke test adds the print row, a basket with two prints and a chosen country: no `Set-Cookie`, empty storage, every request to the site's own origin (the checkout redirect itself is not followed).

### 21.2 What is kept where

- **Stripe** holds the buyer's name, email, phone, billing and shipping address and payment details. **Artelo** gets the name, shipping address and (outside the US) phone. The site fetches the address and email from Stripe in memory when it needs them (18.2, 18.4) and never writes them anywhere.
- **D1** keeps, per order: the order id, country, print total, delivery amount, status and reason, the Stripe session and payment intent ids, Artelo's order id, status and cost, the shipments' carriers, tracking numbers and URLs (a parcel's, not a person's), refund amounts, timestamps and retry bookkeeping; and per line, the photo, tier, Artelo size, frame, quantity and unit price. Nothing else. The view key is derived, never stored (17.1).
- Logs carry order ids, statuses and error summaries, never addresses, emails, tokens, keys or request bodies.

### 21.3 Abuse

Two Workers Rate Limiting bindings (13.3), keyed by `CF-Connecting-IP`: `QUOTE_LIMIT` (30 a minute) for basket renders with a country, and `CHECKOUT_LIMIT` (6 a minute) for checkouts. Workers rate limits count per Cloudflare location, which is accepted. They set no cookie (R10's zone rules forbid rate-limiting rules that do). Test builds key both on an `X-Test-Client` header when one is present, so end-to-end checkouts from one address don't trip them. The D1 cost cache (16.1) bounds Artelo calls to one per size, frame, country and quantity every 6 hours.

### 21.4 Secrets and configuration

- Worker secrets George sets with `wrangler secret put`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ARTELO_API_KEY`, `ARTELO_WEBHOOK_SECRET` (set by `prints:webhook`), `PRINT_VIEW_SECRET` (32 random bytes as lowercase hex) and `PHOTO_LINK_SECRET` (from part 1).
- Vars in `wrangler.jsonc`: `PRINTS_OPEN` (`"false"` until launch), `PRINT_SELLER_NAME` (`"george vlachos"`), `PRINT_GST` (`"none"` or `"inclusive"`), `STRIPE_GST_TAX_RATE` (empty until needed), `PRINT_FROM_EMAIL` (`"prints@curiousgeorge.dev"`), `SITE_ORIGIN` (`"https://curiousgeorge.dev"`, needed by the cron, which has no request), `ARTELO_API_BASE` (`"https://www.artelo.com/api/open"`) and `FX_URL` (the Frankfurter URL in 16.3). Tests point the last two at the fixture (23.3).
- The delivery buffer is a D1 setting, not a var (16.3). Test builds refuse a `STRIPE_SECRET_KEY` that starts with `sk_live_`.

## 22. Data: migration 0007

`migrations/0007_prints.sql`, applied with `wrangler d1 migrations apply`, never `execute --file`:

```sql
CREATE TABLE print_prices (
  tier TEXT NOT NULL CHECK (tier IN ('small', 'medium', 'large')),
  frame TEXT NOT NULL CHECK (frame IN ('unframed', 'oak')),
  amount INTEGER NOT NULL CHECK (amount > 0),   -- AUD cents, no GST
  PRIMARY KEY (tier, frame)
);
INSERT INTO print_prices (tier, frame, amount) VALUES
  ('small', 'unframed', 5900), ('small', 'oak', 13900),
  ('medium', 'unframed', 7900), ('medium', 'oak', 17900),
  ('large', 'unframed', 11900), ('large', 'oak', 25900);

CREATE TABLE print_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO print_settings (key, value, updated_at) VALUES ('delivery_buffer', '0.08', 0);

CREATE TABLE print_costs (
  size TEXT NOT NULL,
  frame TEXT NOT NULL CHECK (frame IN ('unframed', 'oak')),
  country TEXT NOT NULL CHECK (length(country) = 2),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  production_cost INTEGER,                   -- US cents
  shipping_cost INTEGER,                     -- US cents
  refused INTEGER NOT NULL DEFAULT 0 CHECK (refused IN (0, 1)),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (size, frame, country, quantity)
);

CREATE TABLE print_orders (
  id TEXT PRIMARY KEY,                       -- lowercase ULID; Artelo's orderId and Stripe's client_reference_id
  country TEXT NOT NULL CHECK (length(country) = 2),
  print_total INTEGER NOT NULL,              -- AUD cents
  delivery_amount INTEGER NOT NULL,          -- AUD cents
  status TEXT NOT NULL CHECK (status IN ('checkout', 'expired', 'paid', 'needs_attention', 'placed',
    'in_production', 'shipped', 'delivered', 'cancelled', 'refunded')),
  attention_reason TEXT,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT UNIQUE,
  artelo_order_id TEXT UNIQUE,
  artelo_status TEXT,
  artelo_cost INTEGER,                       -- US cents, production plus shipping
  shipments TEXT CHECK (shipments IS NULL OR json_valid(shipments)),  -- [{ carrier, number, url }]
  refunded_amount INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  retry_until INTEGER,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  placed_at INTEGER,
  shipped_at INTEGER,
  refunded_at INTEGER,
  status_checked_at INTEGER,
  shipped_email_at INTEGER,
  attention_notified_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX print_orders_due ON print_orders(status, next_attempt_at);
CREATE INDEX print_orders_recent ON print_orders(paid_at);

CREATE TABLE print_order_items (
  order_id TEXT NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
  line INTEGER NOT NULL CHECK (line BETWEEN 1 AND 10),
  photo_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('small', 'medium', 'large')),
  size TEXT NOT NULL,                        -- Artelo ProductSize, e.g. x12x18
  frame TEXT NOT NULL CHECK (frame IN ('unframed', 'oak')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_amount INTEGER NOT NULL,              -- AUD cents
  PRIMARY KEY (order_id, line)
);

CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);

ALTER TABLE photo_download_grants ADD COLUMN order_id TEXT;
CREATE INDEX photo_grants_order ON photo_download_grants(order_id);
```

`print_order_items.photo_id` has no foreign key, so an order keeps its history whatever happens to the photo. The total prints in an order (the sum of quantities) is at most 10, enforced by the basket parser. No exchange rate is seeded: the daily job fetches it (16.3).

## 23. Budgets and testing (part 2)

### 23.1 Budgets

R11's method applies to `/photos/<id>` with the print row and to `/basket` with two prints: JavaScript before any interaction under 10KB gzipped (the beacon plus `basket.ts` on the basket; the print row adds none), HTML under 30KB gzipped, CSS under 15KB gzipped, the same two fonts, cumulative layout shift under 0.01 at 1280px and 375px, and the basket's 240 previews eager (at most 10).

### 23.2 Tests

**Unit (Vitest):**

- **Eligibility:** the crop tolerance at 2.9% and 3.1%; the family choice; the 200 ppi line; orientation; the real dimension classes of 14.1 (3648 × 5472 all three; 3024 × 4032 small and medium; 6048 × 8064 all three; 2194 × 3291 small; 3575 × 4172 and 1756 × 3097 none; 2048 × 2048 small only).
- **The basket:** parsing, grouping identical entries, the 10-print cap, dropped entries and their messages, `add`, `remove` and `more`, canonical URLs.
- **Pricing:** grouping by size and frame, the sum rule, the buffer read from `print_settings`, rounding up to whole dollars, a missing or stale rate, the D1 cost cache with refusals kept and 5xx not.
- **The guard:** a duplicate event id applies nothing; a concurrent duplicate fails its batch with 500; two events for one session pay once; an event with no order answers 500 and records nothing; a missing order is recreated from metadata in `needs_attention`; an amount, currency or `currency_conversion` mismatch reaches `needs_attention`; a full refund before placement stops retries; a full refund after placement reaches `needs_attention`; a partial refund changes only the amounts.
- **Reconciliation:** a paid session with no webhook reaches `paid` and is placed by the cron; an open session is expired; an expired session marks the order; an order with no session becomes `expired`.
- **Retries:** the backoff schedule, the 24-hour window, retryable versus permanent statuses, a failed lookup never creating, the lease, adopting an order found by the lookup, a missing master failing the whole order and an email retried until its guard column is set.
- **Signatures:** Stripe's tolerance, several `v1` values and a tampered body; Artelo's raw and re-serialised forms.
- **Artelo statuses:** the mapping table, the order rules (out-of-order statuses ignored, `PendingFulfillmentAction` after production ignored, final states), grant revocation, both `orderId` lookups, the `data` wrapper.
- **The view key:** derivation, constant-time comparison, a wrong key's 404.

**End to end (Playwright, Chromium):**

- **A full test order** (runs when `STRIPE_TEST_SECRET_KEY` is set, skipped with an annotation otherwise): on `/photos/fixture-b-01` add medium with an oak frame; follow `keep looking` to `/photos/fixture-b-02` (the basket carried in the links) and add small unframed; on the basket choose australia; the quote reads `prints $238 + delivery $65 = $303` (two groups at the fixture's US$20.00 each, at 1.50, plus 8%, rounded up). `continue to payment` reaches `checkout.stripe.com` in test mode, which offers only Australia and shows two print lines and one delivery line; Playwright pays with Stripe's published test card `4242 4242 4242 4242` and test address; the browser lands on the order page. The test then fetches the real `checkout.session.completed` event from Stripe's events API, asserts the session has `currency: aud` and no `currency_conversion`, and delivers the event to `/api/prints/stripe` signed with the local test webhook secret, twice. The stand-in Artelo received exactly one order with two items (`x12x18`, `NaturalOak`, `Vertical`; `x8x12`, unframed, `Horizontal`; both `ArchivalMatteFineArt`; `isTestOrder: true`), whose two design URLs it fetched: JPEGs of 4000 × 6000 and 6000 × 4000 matching their masters' SHA-256, not previews. The fixture then sends a signed `Shipped` webhook; the order page shows the tracking, the order's grants are revoked and the email sink holds one shipped email.
- **Reconciliation:** a second paid test order whose webhook the test withholds is moved to `paid` by triggering the cron, and George's `webhook never arrived` email is in the sink.
- **Artelo failure** (same server and key; `/admin` through the test build's local bypass, R7): the stand-in answers 503 to every create; with `PRINT_RETRY_WINDOW=0` the first failure leaves the order `needs_attention`; `/admin` lists it first with its reason and the sink holds George's email. With the stand-in set to accept, `retry now` places it once.
- **Partial refusal:** the stand-in refuses (400, naming the item) any order containing `fixture-b-02`; a two-print order reaches `needs_attention` with that message; no Artelo order exists and nothing was placed for the other print.
- **Basket without JavaScript:** add, one more, remove one, the cap at 10, a tampered `items` entry dropped with its line, a changed total at checkout answered with the new total.
- **Privacy and budgets:** as 21.1 and 23.1.

### 23.3 Fixtures and servers

- A stand-in Artelo, `tests/fixtures/artelo-site.mjs` on port 4401 (like the snapshot fixture site on 4400): `catalog/get-costs` (production US$40.00 and shipping US$20.00 for every size, country and quantity, and a 400 for `AQ`), `orders/price-check`, `orders/create` (which fetches every design URL and records each file's SHA-256 and dimensions), `orders/get`, `orders/get-by-id`, `webhooks/get` and `webhooks/save`, plus `/fx` answering Frankfurter's shape with 1.50, `/__mode` to switch creation between `ok`, `down` (503) and `refuse=<photo id>` (400 naming it), `/__ship` to send a signed `OrderStatusChange` to the site, `/__requests` to read what it received and `/__mail` as the email sink.
- A prints server on port 4335, recreated every run like the admin server: `rm -rf .wrangler/prints`, `wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/prints`, the seed of 11.3, then `wrangler dev -c dist/server/wrangler.json --port 4335 --persist-to .wrangler/prints --test-scheduled` with vars for the fixture key, `PRINTS_OPEN=true`, `SITE_ORIGIN=http://localhost:4335`, `ARTELO_API_BASE` and `FX_URL` on 4401, test `ARTELO_API_KEY`, webhook and view secrets, `STRIPE_SECRET_KEY` from `STRIPE_TEST_SECRET_KEY` and the test-only `EMAIL_SINK=http://127.0.0.1:4401/__mail` (test builds send mail there instead of the binding). The migrations include 0006 and 0007. Specs trigger the cron with `GET /__scheduled?cron=*/5+*+*+*+*` and send `X-Test-Client` (21.3).

## 24. Launch (part 2)

Only George can do these:

- [ ] Open a Stripe account as an individual, set the public business name to `george vlachos`, turn on customer emails for successful payments, turn off Adaptive Pricing in the dashboard as well (the site also disables it per session) and set `STRIPE_SECRET_KEY` (live) on the Worker. Add `STRIPE_TEST_SECRET_KEY` (test mode) to GitHub Actions secrets for the end-to-end order test.
- [ ] Create the Stripe webhook endpoint `https://curiousgeorge.dev/api/prints/stripe` with API version `2025-09-30.clover` and the events `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`. Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
- [ ] Set `PRINT_VIEW_SECRET` (64 lowercase hex characters): `bunx wrangler secret put PRINT_VIEW_SECRET`.
- [ ] Open an Artelo account, connect the API integration, set up Artelo billing (Artelo charges George's card, which has no foreign transaction fee, for each order) and set `ARTELO_API_KEY` on the Worker.
- [ ] Run `ARTELO_API_KEY=… bun run prints:webhook --remote` (it stores `ARTELO_WEBHOOK_SECRET` itself) and `bun run prints:check --remote`; fix anything it fails on and look at any warning.
- [ ] Turn on Cloudflare Email Sending for curiousgeorge.dev (`bunx wrangler email sending enable curiousgeorge.dev`) and add the DNS records it asks for alongside the domain's existing mail records.
- [ ] Set `PRINTS_OPEN` to `"true"` in `wrangler.jsonc` and deploy.
- [ ] Buy two prints in one order (one small unframed, one framed) with a real card, shipped to yourself, and watch the order reach `shipped` in `/admin`, with the tracking email and Stripe's receipt showing the GST sentence; then decide whether to keep or refund them. This is the only check of Artelo's real image fetch, address handling, combined freight and webhooks (section 25).

## 25. Assumptions about Artelo and Stripe

Artelo's documentation hides some answers behind an account or truncates its enums; Stripe's behaviour in some details is account-dependent. Each assumption, and how the build checks it:

1. **Artelo sizes:** the frameable sizes are those in Artelo's documentation bundle (`NON_GALLERY_PRODUCT_SIZES_SUPPORTING_FRAMES`, read 2026-10-08) and all exist for `IndividualArtPrint`. Checked by `prints:check`, which fails on any refused combination.
2. **Artelo's standard oak frame** is `frameColor: "NaturalOak"` at order time and `frameStyle: "Oak"` in cost queries, and an unframed print is `frameColor: null`. Checked by `prints:check` (Price Check with the exact `productInfo`).
3. **Paper:** `ArchivalMatteFineArt` is offered at every size in 14.1, framed and unframed. Checked by `prints:check`.
4. **Currency:** Get Catalog Product Costs, Price Check and an order's `details` are in US dollars, the account currency. Checked by `prints:check` comparing Price Check (`currency: "USD"`) with Get Catalog Product Costs, and by the first real order's cost against Artelo's charge.
5. **No combined freight without an address:** Get Catalog Product Costs prices one product (with a quantity) per request and Price Check needs a full address, so a basket's delivery is the sum rule of 16.1. `prints:check` shows Artelo's real combined freight for two-item orders beside the sum, and the launch order shows what Artelo charged.
6. **Refusals:** a country Artelo won't ship to gets a 400 or 422 from Get Catalog Product Costs. `prints:check` prints Artelo's real answer for `AQ`.
7. **The master link:** Artelo fetches a design from any HTTPS URL, including one with a query string that answers with `Content-Disposition: attachment` and a JPEG of 10 to 30MB, within 72 hours of the order. Mimicked by the stand-in; truly checked by the launch order.
8. **Order lookup:** Get Orders' `name` filter returns an order by our `orderId`, and Artelo doesn't itself refuse a duplicate `orderId`, so the site looks the order up before every create. Checked by `prints:check`.
9. **The webhook payload** carries `orderId` (Artelo's id or ours; both are looked up), `status` and, when shipped, `shipments`, at the top level or in a `data` object, signed as an HMAC-SHA256 hex of the body. Handled both ways, logged by key name when unreadable, backed by the 12-hour poll; the first real status change is shown in `/admin` (`last heard`).
10. **Addresses:** Artelo accepts the city and state fallbacks and an empty `zipcode` for places without one, and requires a phone only outside the US. Checked by the launch order and, after that, by `needs_attention` reasons if Artelo refuses one.
11. **Order amounts:** Artelo uses `total`, `shippingCost` and `unitPrice` (sent in AUD) only for the packing slip and customs declaration, in the order's currency. Checked by the launch order's paperwork.
12. **Test orders:** `isTestOrder: true` orders cost nothing, are never produced and get status `Ignored`. From Artelo's Create Order documentation; the end-to-end test only uses the stand-in.
13. **Stripe API version** `2025-09-30.clover` returns the shipping name and address in `collected_information.shipping_details` and the phone and email in `customer_details`. Pinned on every request; checked by the end-to-end test against Stripe's test mode.
14. **Stripe's free receipt** shows the payment's description, so the GST sentence reaches the buyer's receipt; Stripe emails receipts only in live mode with customer emails on. Checked by the launch order's receipt.
15. **Stripe fees in Australia** are 1.7% + $0.30 for domestic cards and 3.5% + $0.30 for international ones; `prints:check` uses the worse.
16. **Checkout images:** Stripe shows the 480 WebP preview as a line item's image; if it doesn't, Checkout simply shows none. Seen in the end-to-end test.
17. **`payment_method_types[0]=card`** includes Apple Pay and Google Pay and only completes sessions with `payment_status: paid`, so no delayed payment events are needed; the webhook still checks `payment_status` (18.1).
18. **Test-mode redirects:** Stripe accepts `http://localhost` success and cancel URLs in test mode. Checked by the end-to-end test.
19. **Adaptive Pricing is off for every session** (`adaptive_pricing[enabled]=false`); the end-to-end test asserts the completed session has `currency: aud` and no `currency_conversion`.
