# curiousgeorge.dev photo gallery and print ordering

- Date: 2026-10-08
- Owner: George Vlachos
- Status: Design agreed with George; ready for an implementation plan
- Extends: [the logbook redesign spec](2026-10-03-personal-site-redesign-design.md). "R6.1" below means its section 6.1. Everything that spec says about the visual system (R3), motion (R4.3), architecture (R6), admin (R7), analytics (R10), budgets (R11), security headers and accessibility (R12) and deployment (R13) applies here unless this spec says otherwise.
- Decisions: [ADR-0020](../../adr/0020-photo-downloads-use-revocable-signed-links.md) (as amended on 2026-10-08), [ADR-0021](../../adr/0021-prints-sold-on-site-through-artelo.md), [ADR-0022](../../adr/0022-photo-places-are-area-and-city-only.md).
- Builds on: the photo backend of `a65ecc6` ([docs/photo-gallery-backend.md](../../photo-gallery-backend.md)): `src/lib/photos/`, `src/pages/api/photos/`, `src/pages/photos/downloads/[id].ts`, `src/pages/admin/photos/`, `migrations/0005_photos.sql`, `scripts/prepare-photos.mjs`, `scripts/import-photos.mjs` and `tests/e2e/photos.spec.ts`. Section 2.2 lists every change this spec makes to it.
- Artelo facts come from its public API documentation, read on 2026-10-08 (Create Order, Price Check, Get Catalog Product Costs, Get Orders, Get Order by Id, Webhooks, Webhook Topics, Save Webhook, Getting Started) and from the enum lists in that documentation's own page bundle. Section 16 lists every assumption about Artelo and Stripe and how the build checks it.

## 1. Intent and scope

George's photographs get a home on the site, kept the way the logbook keeps everything else: dated entries, plain words, nothing moving unless the visitor moves it. Anyone can order a print of a photograph that prints well. People George chooses get every published photograph at full resolution through one private link.

The selection is 462 photographs from 32 Instagram posts (2 February 2025 to 27 September 2026), 370 portrait and 92 landscape; 363 are 2:3 and 96 are 3:4. 96 are RAW renders awaiting George's review (docs/photo-gallery-backend.md).

### Success criteria

- `/photos` reads like the log: someone flicking through it sees dates, places and photographs, and nothing else asks for attention.
- The first batch of `/photos` and every `/photos/<id>` page work completely without JavaScript, and meet the budgets in section 13.
- A buyer anywhere sees one delivered total before paying, pays on Stripe's page and gets a print without George touching anything; when something goes wrong, George finds out from `/admin` and an email, never from the buyer.
- No buyer is ever charged without an order row in D1 (section 9).
- `cookies: none. nothing to accept.` stays literally true of curiousgeorge.dev (section 10).

### Non-goals

- A cart, more than one print per order, quantities, discount codes or gift cards.
- Buyer accounts, saved addresses or order history beyond the private order page.
- Print sizes other than the three in section 7.1, frames other than Artelo's standard oak, mats, canvas or metal prints.
- Artistic titles or captions invented for photographs. Titles start empty (backend doc) and only George writes them.
- Maps, coordinates or anything finer than "area, city" (ADR-0022).
- New analytics events. The beacon keeps its four events (R10).

## 2. Routes and changes to existing code

### 2.1 Routes

| Route | Behaviour | Caching |
|---|---|---|
| `/photos` | The gallery, newest entry first, four entries per page (section 3) | Edge, tag `photos`, as R6.1 (`maxAge: 300, swr: 86400`) |
| `/photos?before=<seconds>` | The next four entries older than that post time | Same, per URL |
| `/photos/<id>` GET | One photograph and its print section (section 4) | Edge, tag `photos` |
| `/photos/<id>` POST | `intent=quote` renders the page with a quote; `intent=checkout` starts checkout (section 7) | `no-store` |
| `/photos/downloads?token=<token>` | The private full-resolution list (section 5) | Private headers, never cached |
| `/photos/downloads/<id>?token=<token>` | Existing full-resolution JPEG download, unchanged | Private headers |
| `/prints/<order id>?key=<view key>` | A buyer's private order page (section 8.5) | Private headers, never cached |
| `/api/photos` | Existing catalogue, plus the entry mode in section 3.6 | 60s fresh, 300s stale, tag `photos` (unchanged) |
| `/api/photos/<id>` | Existing, plus `date` and `place` | Unchanged |
| `/api/prints/quote` | The live quote for the print section's script (section 7.3) | `no-store` |
| `/api/prints/stripe` POST | Stripe's webhook (section 8.1) | `no-store` |
| `/api/prints/artelo` POST | Artelo's webhook (section 8.3) | `no-store` |
| `/admin` | Three new sections (section 6) | As R7 |

`robots.txt` adds `Disallow: /photos/downloads` and `Disallow: /prints/`. `/photos` and `/photos/<id>` are indexable with canonical URLs.

### 2.2 Changes to the photo backend and the site

- **Public photo fields** gain `date` (the post's `YYYY-MM-DD`) and `place` (`"area, city"` or `null`) from `photo_posts` (section 11), in `/api/photos` and `/api/photos/<id>`. Purely additive.
- **Catalogue links** point at the page, `/photos/downloads?token=…`, instead of `/api/photos/downloads?token=…`. The JSON route stays for scripts.
- **Photo-scoped links are internal only** (ADR-0020 as amended). `POST /admin/photos/links` refuses a `photoId` with 400 `photo links are internal`; `bun run photos:link` drops `--photo`. A new library function, `issueOrderGrant(db, secret, photoId, seconds)` in `src/lib/photos/store.ts`, is the only way to make one, and only the print fulfilment calls it.
- **Publication** moves from `src/pages/admin/photos/[id].ts` into `src/lib/photos/publish.ts` (`setPublished(deps, ids, published)`), shared by the JSON route and the admin forms. Verification is unchanged; a publication change purges both `photos` and `logbook` (the home page's photo line depends on whether anything is published).
- **Middleware** (`src/middleware.ts`): the private-response treatment (`PRIVATE_HEADERS`, no `Cache-Tag`) extends from `/photos/downloads` to `/prints/`. The Origin check (R7, ADR-0011) exempts exactly two paths, `POST /api/prints/stripe` and `POST /api/prints/artelo`, because providers send no `Origin`; both verify a signature before reading anything else (sections 8.1 and 8.3).
- **CSP** (`astro.config.mjs`): `form-action 'self' https://checkout.stripe.com`, because Chrome applies `form-action` to the redirect that follows a form post, and checkout is a post answered with a 303 to Stripe (section 7.5). Nothing else changes.
- **Worker entry**: `wrangler.jsonc` `main` becomes `src/worker.ts`, which exports `fetch` (Astro's `handle` from `@astrojs/cloudflare/handler`) and `scheduled` (section 8.6). The cron, the `EMAIL` send binding, the two rate-limit bindings of section 10.3 and the vars in section 10.4 are added to `wrangler.jsonc`. The first plan task proves with a probe build that `dist/server/wrangler.json` keeps the cron and that `wrangler dev --test-scheduled` reaches the handler; if the adapter can't keep a custom entry, the scheduled work moves to a separate Worker, `workers/prints/`, built like the snapshots Worker (R9) with the same bindings and secrets, and nothing else in this spec changes.
- **Ingest** (`src/lib/ingest.ts`): an event whose `$pathname` starts with `/photos/downloads` or `/prints/` is refused with 400, so those pages are never counted even if a script were ever added to them.
- **Seed**: `scripts/seed-photo-test.mjs` grows to the fixture in section 14.3; the existing `photos.spec.ts` assertions that name the catalogue's exact contents are updated to match.

## 3. The gallery, /photos

### 3.1 Page structure

The page uses `Notebook.astro` and the logbook's book layout (R2, R3): margin column, red rule, lowercase DM Mono labels.

| Margin label | Content |
|---|---|
| `photos of` (head row) | `<h1>george vlachos</h1>`, then `photos i've taken, one entry per instagram post, newest first. some come as prints.` (the last sentence only while prints are open, section 7.4), then `back to the logbook` linking to `/`. On a `?before=` page, the line also carries `· newest entries` linking to `/photos`. |
| `entries` | An `<ol class="entries">` of entries (3.2), then the pager (3.4) |

With no published photographs the `entries` row holds one line, `no photos up yet.`, and the home page shows no photo line (3.7). If the D1 read fails, the head row renders with `photos aren't loading right now. try again in a bit.`, status 503 and `Cache-Control: no-store`, so a degraded page is never cached.

`<title>` is `photos · george vlachos`; the description is `photos george vlachos has taken, one entry per instagram post.`

### 3.2 Entries

One entry per post (`photos.collection`) that has at least one published photograph, ordered by `photo_posts.published_at` descending.

- `<li class="entry" id="post-<collection>">`, headed `<h2 class="entry-head"><time datetime="2025-02-02">02.02.25</time> · bondi, sydney</h2>` in DM Mono 12px, the date in `--muted`, the place in `--ink`. The ` · place` part is left out when the place is `null`. The date is the day the post went up, in the post's own time zone (section 11), formatted like log dates (R4.2, `formatLogDate`).
- Below it, the contact sheet: `<ol class="sheet">` of frames in post order (`photos.position`). Frames sit in rows like a contact sheet, wrapping onto as many rows as the post needs (a post holds 1 to 20 photographs): each frame image is 120px tall on screens 680px and wider and 88px below, its width following its aspect ratio, with a 6px gap. Under each frame its number in DM Mono 11.5px `--muted`, the slide number from the id (`-02` shows `02`), like the edge numbers on a contact sheet.
- Each frame is a link to `/photos/<id>`. Hover (fine pointers only, 200ms `ease`): the frame number turns `--ink` and a 1px `--red` outline appears around the image; no transforms. Focus-visible outlines as R12.2.
- Alt text: the title when George has written one, otherwise `photo 2 of 14 from 2 february 2025, bondi, sydney` (place left out when unknown).
- Entries are 24px apart; the sheet starts 10px under the heading.

### 3.3 Previews

Every frame is a `<picture>` built from the photo's `previews` (backend: 480, 960 and 1600, each AVIF and WebP, fitted inside a square of that size, with their actual widths):

```html
<picture>
  <source type="image/avif" srcset="…/480.avif 320w, …/960.avif 640w" sizes="(max-width: 679px) 59px, 80px">
  <img src="…/480.webp" srcset="…/480.webp 320w, …/960.webp 640w" sizes="(max-width: 679px) 59px, 80px"
       width="320" height="480" alt="…" loading="lazy" decoding="async">
</picture>
```

- `srcset` descriptors are each preview's real width; `width` and `height` are the 480 preview's real dimensions, so the browser knows the aspect ratio before any byte arrives. CSS sets `height: 120px` (88px on phones) and `width: auto`, which the attribute ratio resolves before load: no layout shift.
- `sizes` is computed per frame as the rendered width, `round(120 × width ÷ height)` px and `round(88 × width ÷ height)` px below 680px.
- The frames of the first entry on the page load eagerly (`loading="eager"`), the first frame with `fetchpriority="high"`; every other frame is lazy. Without JavaScript browsers ignore lazy loading, which is accepted (as R4.1).
- The 1600 previews are never used on `/photos`.

### 3.4 Pager and loading more

- After the list, while older entries exist, a plain link: `<a class="more" href="/photos?before=<published_at of the last entry shown>" data-next="<same>">older entries</a>`, with the CSS chevron of R4.2. At the end the line reads `that's every entry.` instead.
- `?before=` must match `^\d{1,10}$`; anything else gets the notebook 404. Four entries per page.
- With JavaScript (`src/scripts/photo-sheet.ts`, an inline page script with no runtime imports, R6 and R11): an `IntersectionObserver` watches the link with `rootMargin: "0px 0px 800px 0px"`. When it intersects, the script fetches `/api/photos?by=entry&before=<data-next>&limit=4`, clones `<template id="entry-template">` and `<template id="frame-template">` (rendered by the server from the same component, so markup lives in one place) for each entry and frame, appends them to the list and moves `href` and `data-next` to the new cursor, or replaces the link with `that's every entry.` when `next` is `null`. Appended frames are all lazy.
- While a batch loads the link reads `loading older entries…` and is `aria-disabled="true"`; one fetch at a time. On failure it goes back to `older entries` and the observer stops, so a click follows the plain link. Focus never moves; the URL never changes.

### 3.5 Caching

`/photos` and `/photos?before=` call `Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["photos"] })` and send `Cache-Control: no-cache`, exactly like `/` (R6.1). D1 is read once per render with one `DB.batch()`: the page of posts, then their published photographs. Publication, title and place changes purge `photos` (and `logbook`).

### 3.6 The entry mode of /api/photos

`GET /api/photos?by=entry&before=<seconds>&limit=<1 to 12>` (default `limit` 4; `before` optional, meaning newest; any other parameter is a 400, as today) answers:

```json
{ "entries": [{ "collection": "DFkL1xrsnOH", "date": "2025-02-02", "place": "bondi, sydney",
                "photos": [ /* public photo objects, in post order */ ] }],
  "next": 1738488468 }
```

`next` is the last entry's `published_at`, or `null` when no older entry has a published photograph. Without `by`, the endpoint behaves exactly as it does now. Caching is unchanged (60s fresh, 300s stale, tag `photos`).

### 3.7 The line on the logbook home page

A row after `log` and before `on the turntable`, margin label `photos`, with one line: `<a href="/photos">photos</a> i've taken, kept like this log.`, followed by ` some come as prints.` while prints are open. No image, no script; the home page's HTML grows by under 200 bytes. The row renders only when at least one photograph is published: `loadLogbook`'s batch gains `SELECT EXISTS (SELECT 1 FROM photos WHERE published = 1) AS any`. Publishing the first photograph or hiding the last one changes the home page at once, because publication purges `logbook` (2.2).

## 4. One photograph, /photos/<id>

A shareable page for one published photograph. An unpublished or unknown id gets the notebook 404 (`no-store`).

| Margin label | Content |
|---|---|
| `photo` (head row) | The photograph, then the `<h1>`: the title if George wrote one, otherwise `02.02.25 · bondi, sydney`. Then a DM Mono line: `photo 2 of 14 · ‹ previous · next ›` (links to the neighbouring photographs of the same post, each left out at the ends, chevrons drawn in CSS), and `the whole entry` linking to `/photos?before=<published_at + 1>#post-<collection>`. When there's a title, the date and place line sits under it. |
| `prints` | The print section (section 7.4), only when prints are open and the photograph has at least one size (section 7.1) |
| `say hi` | As on `/` |

The photograph is a `<picture>` with the 960 and 1600 previews in AVIF and WebP, `width` and `height` from the 1600 preview, `sizes="(max-width: 679px) calc(100vw - 48px), 710px"`, `fetchpriority="high"` and `loading="eager"`. CSS: `width: 100%; height: auto; max-height: 82svh; object-fit: contain`, so the box is known before the image loads (no shift) and a tall portrait fits the viewport, letterboxed on paper. Its alt text follows 3.2. No closer look, zoom or lightbox: the 1600 preview is the largest image the public site serves.

A photograph's **name**, used at checkout, on the order page and in emails, is its title in quotes, or `photo 2 of 14 from 02.02.25` when it has none. `<title>` is `<h1 text> · photos · george vlachos`. The description is `a photo by george vlachos from 2 february 2025, bondi, sydney.` (place left out when unknown; "from" because the date is the post's, not the shutter's). `og:image` is the 1600 WebP with its real `og:image:width` and `og:image:height` (a new optional `ogImage` prop on `Notebook.astro`; every other page keeps `/og.png`). Cached as 3.5. The beacon sends its `$pageview` as on `/`.

## 5. Full-resolution links (ADR-0020 as amended)

### 5.1 Who gets full resolution

People get full-resolution photographs only through a catalogue link: one link opens every published photograph, for as long as it lasts (7 days by default, 30 at most) or until George revokes it. George issues and revokes them in `/admin` (section 6.3) or with `bun run photos:link` (catalogue only). Photo-scoped grants exist only for print orders (section 8.2), last 72 hours and never reach a person.

### 5.2 The downloads page, /photos/downloads?token=…

Server-rendered from D1 (`src/pages/photos/downloads/index.astro`); it verifies the token exactly as `/api/photos/downloads` does (`verifyPhotoToken`, a catalogue scope, `grantIsActive`).

| Margin label | Content |
|---|---|
| `downloads` (head row) | `<h1>photos, full size</h1>`, then `every photo in the gallery as a full-resolution jpeg. this link works until 15.10.26, 2:30 pm sydney time. please keep it to yourself.` (the expiry from the token's `exp`, in `Australia/Sydney`) |
| `entries` | Every published photograph, grouped into entries headed as 3.2, newest first, on one page. Each photograph: its 480 preview (lazy, alt as 3.2) and a link `download · 12.4 mb` (decimal megabytes, one decimal) to `/photos/downloads/<id>?token=<token>` with `download="<id>.jpg"` |

The page:

- sends `PRIVATE_HEADERS` (middleware, 2.2): `Cache-Control: private, no-store`, `Cloudflare-CDN-Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, and also carries `<meta name="referrer" content="no-referrer">` and `<meta name="robots" content="noindex">`;
- never calls `Astro.cache.set`, includes no beacon or other script and loads nothing from any other origin;
- never logs the request, its URL or the token (as `download.ts` already does); the Worker's `redact_query_string` keeps the token out of Workers Logs;
- holds the token only in its own download links.

### 5.3 When a link doesn't work

Invalid, expired and revoked links all show the same page, with status 403 and the same private headers, so the page never says which: head row `downloads`, `<h1>this link has run out</h1>` and `it may have expired or been switched off. if you were expecting photos, ask george for a fresh one: <a href="mailto:hello@curiousgeorge.dev">hello@curiousgeorge.dev</a>.` A missing `PHOTO_LINK_SECRET` or a D1 failure shows `downloads aren't working right now. try again in a bit.` with status 503.

## 6. The owner screen in /admin

### 6.1 Shared rules

Three new sections follow R7 and the existing code in `src/lib/admin/` exactly: plain server-rendered forms posting to `/admin/` with an `intent`, the Origin check (ADR-0011), the Access check against `ADMIN_EMAIL` (ADR-0016), validation server side, 422 with the failed form reopened and its values, a page banner for failures that belong to no form, 500 for a throw and 303 to `/admin/?saved=<section>#<section>` on success (post, redirect, get). An identical repeat counts as saved (ADR-0012): publishing something already published, hiding something hidden, revoking something revoked. `AdminSection` gains `photographs`, `links` and `orders`. Section order on the page: now, lately, log, records, before, snapshots, photographs, links, print orders.

Saves in `photographs` purge `photos` and `logbook` through the existing `purgeLogbook` path (generalised to take tags); `links` and `orders` purge nothing.

### 6.2 Photographs

One `<details>` per post, newest first, closed unless it holds the failed form. Summary line: `02.02.25 · bondi, sydney · 14 photos, 12 published`, plus a `raw` pill with a count when any photograph in it awaits RAW review (`photos.raw_review`, section 11).

Inside:

- **Place:** a text field `place` with the hint `area, city. leave it empty to show no place.` Saving sets `photo_posts.place` (lowercased with `en-AU` rules, trimmed, at most 60 characters, printable Latin-1 only, so it renders in the subset fonts of R3; empty stores `null`) and `place_edited = 1`, so a later import never overwrites George's edit (section 11). Intent `post.place`.
- **Publish or hide the post:** `publish all 14` (intent `post.publish`) and `hide all` (intent `post.hide`). Publishing verifies every photograph in the post first (`setPublished`, the backend's checks of the private JPEG and six previews); if any fails, nothing is published and the form says `2 photos couldn't be checked: DFkL1xrsnOH-03, DFkL1xrsnOH-07. publish the others one at a time.` with status 422.
- **Each photograph:** its 480 preview (lazy), id, `raw` pill, a `title` field (at most 80 characters, plain text, empty allowed; intent `photo.title`) and a `publish` or `hide` button for that photograph alone (intent `photo.publish` or `photo.hide`), with the same verification.
- Saved line: `saved - the gallery may show the old version for a little while.` when the purge failed, otherwise `saved - it's on the gallery now.`

### 6.3 Links

- **Issue a link:** fields `days` (a number from 1 to 30, default 7) and `note` (optional, at most 60 characters, hint `who it's for, so you know which to revoke`), plus a hidden `nonce` (16 random bytes, base64url, new on every render). Intent `link.issue`. This is the one write that answers 200 instead of 303, because the link exists only in that response: the page renders with `here's the link. copy it now - it can't be shown again.`, the URL in a read-only input and a `copy` button (`src/scripts/copy-link.ts`, `navigator.clipboard.writeText`; without JavaScript the text is selectable). The grant row stores the nonce (`photo_download_grants.request_nonce`, unique), so a repeated post with the same nonce (a double tap or a reload) creates nothing and shows `that link was already made. it's in the list below, but it can't be shown again.` The token itself is never stored.
- **Active links:** catalogue grants (`purpose = 'person'`) not revoked and not expired, newest first: `made 08.10.26 · works until 15.10.26 · <note>` and a revoke form with the `tick the box to remove it` confirmation used elsewhere in the admin (intent `link.revoke`). Order grants are never listed.

### 6.4 Print orders

- A status line first: `prints are open` or `prints are closed: <reason>` (section 7.4), then `us$1 = a$1.52 · ecb rate of 07.10.26` (with `- older than a week, check the rate job` when stale), then `artelo webhook: connected` or `artelo webhook: missing - run bun run prints:webhook --remote` (section 8.6).
- The latest 100 orders whose status isn't `checkout` or `expired`, `needs_attention` first (each with a `--red` dot and its reason), then newest paid first. Each line: paid date and time (Sydney), the order id, the photo id (linked to `/photos/<id>`), `medium · oak frame · to au`, `$179 + $33 = $212`, a status word (`waiting to place`, `needs attention`, `with artelo`, `printing`, `shipped`, `delivered`, `cancelled`, `refunded`), `test` for test-mode orders, Artelo's id and cost (`artelo us$61.40`) once placed, and tracking (`ups 1Z… ›` linking to the tracking URL) once shipped.
- **retry now** on `needs_attention` orders (intent `order.retry`): sets the order back to `paid` with `attempts` at 0 and a fresh 24-hour retry window (section 9), runs the first attempt in `waitUntil` and redirects with the saved line `retrying - refresh in a minute to see how it went.` A retry is safe against duplicates because every attempt looks the order up at Artelo before creating it (section 8.2).
- **refund in stripe ›** on every paid order: a link to `https://dashboard.stripe.com/payments/<payment intent>` (`/test/payments/…` for test-mode orders), opening in a new tab. The hint under the list: `refunds happen in stripe. a refund doesn't cancel the artelo order; cancel it in artelo if it hasn't been printed yet.` The `charge.refunded` webhook then marks the order (section 8.1).

## 7. Prints (ADR-0021)

### 7.1 Sizes and which photographs get them

Every print is Artelo's `IndividualArtPrint` on `ArchivalMatteFineArt` paper, unframed or in Artelo's standard oak frame (`frameColor: "NaturalOak"`, frame style `Oak`), with no mat, framing service or hanging pins. Sizes come from Artelo's `ProductSize` enum (inches, short side first) and only from the sizes its documentation lists as taking frames (`NON_GALLERY_PRODUCT_SIZES_SUPPORTING_FRAMES`), so every size can be both unframed and framed.

George's price list names A4, A3 and A2. The page calls them small, medium and large, because the real sizes differ by aspect ratio. For each ratio family, each tier uses the frameable Artelo size of that ratio whose area is nearest the A size's (A4 96.7, A3 193.4, A2 386.9 square inches):

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
- A photograph with no qualifying tier offers no prints; the print section is not rendered (R2's rule for empty sections).

On George's selection this gives: 407 photographs in all three sizes (362 at 3648 × 5472 in 2:3; 45 in 3:4 at 4284 × 5712 or larger), 51 in small and medium (3:4 at 3024 × 4032 and one at 2858 × 3811, whose large would be under 200 ppi), 1 in small only (2194 × 3291), and 3 with no prints (two near 7:6, one near 16:9).

The size labels on the page give both units, rounded to whole centimetres: `small · 8 × 12 in (20 × 30 cm)`.

### 7.2 Prices

Fixed AUD prices, one per tier and frame, the starting list George agreed, stored in D1 (`print_prices`, section 12) and changed only by a new migration:

| Tier | Unframed | Oak frame |
|---|---|---|
| small (A4) | $59 | $139 |
| medium (A3) | $79 | $179 |
| large (A2) | $119 | $259 |

George sells as himself and isn't registered for GST, so the prices carry no GST (section 7.5 covers the receipt). A size's price is its tier's price whatever the exact Artelo size, so a 3:4 large (18 × 24 in) costs the same as a 2:3 large (16 × 24 in); the check script (7.6) proves the margin holds for every real size.

### 7.3 Delivery and the quote

Delivery is Artelo's cost of sending that print to the buyer's country, converted to AUD, plus an **8% buffer** for exchange-rate movement between the quote and Artelo's charge (it also absorbs the card fee on the delivery part), rounded **up** to a whole dollar:

`delivery = ceil(shippingCost × usd_aud × 1.08)` dollars, so every amount on the page is a whole number of dollars.

- **Artelo's cost** comes from Get Catalog Product Costs (`POST https://www.artelo.com/api/open/catalog/get-costs`, `Authorization: Bearer <ARTELO_API_KEY>`), with `catalogProductId: "IndividualArtPrint"`, the size, `frameStyle: "Oak"` or `"Unframed"`, `paperType: "ArchivalMatteFineArt"`, `includeMats`, `includeFramingService` and `includeHangingPins` all `false`, `shippingDestination: <country>` and `quantity: 1`. Its answer is `{ productionCost, shippingCost }`. ADR-0021 names Artelo's Price Check; Price Check needs a full street address, which the site doesn't have (and doesn't want) before Stripe collects it, while this endpoint quotes the same shipping cost from the country alone. The check script compares the two (7.6).
- Answers are cached for 6 hours in the Workers Cache API under `https://artelo-costs.internal/<size>/<frame>/<country>`. Errors aren't cached.
- **The exchange rate** is the European Central Bank reference rate from Frankfurter (`https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD`, no key, no visitor data sent), fetched by the daily job (8.6) into `print_settings` (`usd_aud`, `usd_aud_date`). A rate outside 0.8 to 3 is ignored and logged. A rate older than 7 days still quotes, with a warning in `/admin`; no rate at all closes prints (7.4).
- **Countries:** the select lists every ISO 3166 code Stripe accepts in `shipping_address_collection.allowed_countries` (fixed in `src/lib/prints/countries.ts`), named with `Intl.DisplayNames("en-AU", { type: "region" })` and lowercased, sorted by name. A country Artelo won't ship to shows `artelo can't post to <country> yet.` in place of the quote.
- `GET /api/prints/quote?photo=<id>&size=<small|medium|large>&frame=<unframed|oak>&country=<CC>` answers `{ "print": 17900, "delivery": 3300, "total": 21200, "currency": "aud" }` (cents), 400 for a size the photograph doesn't offer or an unknown country, 404 for an unknown photo, 503 `{ "error": "delivery prices aren't loading right now." }` when Artelo or the rate is unavailable and 429 past the rate limit (10.3). Always `no-store`.

### 7.4 The print section

Prints are **open** when three things hold: the var `PRINTS_OPEN` is `"true"`, the secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ARTELO_API_KEY`, `ARTELO_WEBHOOK_SECRET` and `PHOTO_LINK_SECRET` are all set and an exchange rate is stored. Otherwise the print section, the home page's ` some come as prints.` and the gallery's ` some come as prints.` are not rendered, and `/admin` says which condition is missing.

The `prints` row on `/photos/<id>` (`src/components/photos/PrintForm.astro`), one `<form method="post" action="/photos/<id>#prints" id="prints">`:

- Intro: `a print of this photo, made by artelo on archival matte paper and posted from the us. pick a size, a frame and where it's going.`
- `size` radios, one per qualifying tier, the first checked: `small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed`.
- `frame` radios: `unframed` (checked) and `oak frame`.
- `country` select, required, first option `choose a country` (empty). The page is edge-cached, so it never guesses the visitor's country.
- The quote line, an `<output aria-live="polite">`: `choose a country to see delivery.` until one is chosen, then `print $179 + delivery $33 = $212`, and under it `in australian dollars. no gst - i'm not registered for it. delivery is what artelo charges me to post it to australia, plus 8% in case the exchange rate moves.`
- Buttons: `see the total` (`name="intent" value="quote"`) and `continue to payment` (`value="checkout"`). A hidden `shown_total` holds the total the visitor last saw, in cents.
- Under the button: `payment happens on stripe's own checkout page, which sets its own cookies. this site sets none.`

Without JavaScript, `see the total` posts; the page renders again (200, `no-store`) with the choices kept and the quote filled in. With JavaScript (`src/scripts/print-quote.ts`, inline, no runtime imports), `see the total` is hidden, and any change with a country chosen fetches `/api/prints/quote` (aborting the previous request), updates the output and `shown_total`. `continue to payment` is a plain form post either way.

Errors render in the section, with status 422: `that size isn't offered for this photo.`, `choose a country first.`; 503: `delivery prices aren't loading right now. try again in a minute.`; 429: `too many tries - wait a minute and try again.`

### 7.5 Checkout

`POST /photos/<id>` with `intent=checkout`:

1. Checks the checkout rate limit (10.3) and that prints are open, the photograph is published and offers the size and the country is in the list.
2. Recomputes the quote on the server; the posted numbers are never trusted. If `shown_total` is present and differs, the page renders again with the new quote and `delivery to australia just changed - this is the new total.` (422), and nothing is charged.
3. Creates the order row first, so a payment can never arrive for an order the site doesn't know (section 9): `id` a new lowercase ULID (`src/lib/admin/ulid.ts`), status `checkout`, the photo, tier, Artelo size, frame, country, both amounts, `livemode` (from the key's `sk_live_` or `sk_test_` prefix) and `view_key_hash`, the SHA-256 of a new 32-byte base64url view key that lives only in the success URL and the shipping email.
4. Creates a Stripe Checkout Session with `fetch` (no SDK; form-encoded; `Stripe-Version: 2025-09-30.clover`; `Idempotency-Key: checkout-<order id>`):
   - `mode=payment`, `payment_method_types[]=card` (cards and the wallets that use them), `submit_type=pay`, `locale=auto`, `expires_at` one hour ahead;
   - line item 1, the print: `price_data[currency]=aud`, `unit_amount` the print price, `product_data[name]` `print of <name> · medium, 12 × 18 in · oak frame` (the photograph's name, section 4), `product_data[description]` `archival matte paper, made and posted by artelo`, `product_data[images][]` the photo's 480 WebP preview URL, `quantity=1`;
   - line item 2, delivery: `delivery to australia`, `unit_amount` the delivery amount, `quantity=1`;
   - `shipping_address_collection[allowed_countries][]=<the chosen country>` only, and `phone_number_collection[enabled]=true` (Artelo needs a phone number for international delivery);
   - `custom_text[shipping_address][message]` `your address goes to stripe and artelo only, to deliver your print.` and `custom_text[submit][message]` `prints are made and posted by artelo in the us. no gst: george isn't registered for it.`;
   - `invoice_creation[enabled]=true` with `invoice_data[footer]` `sold by george vlachos, who isn't registered for gst. no gst is included in these prices.` (from `PRINT_SELLER_NAME` and `PRINT_GST`) and `invoice_data[metadata][order_id]`;
   - `client_reference_id=<order id>`, `metadata[order_id|photo_id|tier|size|frame|country]`, `payment_intent_data[metadata][order_id]` and `payment_intent_data[description]` `print order <order id>`;
   - `success_url=<SITE_ORIGIN>/prints/<order id>?key=<view key>`, `cancel_url=<SITE_ORIGIN>/photos/<id>#prints`.
5. Stores `stripe_session_id` and answers **303** to the session's `url`. If Stripe refuses or is unreachable, the row becomes `expired` and the section shows `couldn't reach the payment page. nothing was charged - try again in a minute.` (503).

When `PRINT_GST` is `"inclusive"` (George registered for GST later), Australian orders add `tax_rates[]=<STRIPE_GST_TAX_RATE>` (an inclusive 10% rate George creates in Stripe) to both line items, other countries add none (exports carry no GST), and the footer and notes say `prices include gst for orders posted within australia.` No code changes.

Stripe's Checkout shows the seller as the Stripe account's public business name, which George sets to `george vlachos` (section 15).

### 7.6 The margin check, bun run prints:check

`scripts/print-check.mjs` (`--local` or `--remote` chooses which D1 the prices are read from; the Artelo key comes from `ARTELO_API_KEY` in the process environment and is never printed):

- For every size in the table in 7.1 and both frames: Get Catalog Product Costs to `AU` and `US`, and Artelo's Price Check (`POST /orders/price-check`) with exactly the `productInfo` the site sends at order time (7.1, 8.2), to a public landmark address in each of `AU` (Sydney Opera House, Bennelong Point, Sydney NSW 2000), `US` (the White House, 1600 Pennsylvania Avenue NW, Washington DC 20500) and `GB` (10 Downing Street, London SW1A 2AA).
- **Fails** (exit 1) when Artelo refuses any combination: the size table, frame or paper is then wrong and must be fixed before prints open.
- Prints a table per size and frame: production in USD and AUD at the current rate, the price, the worst-case card fee (3.5% + $0.30, Stripe's international card rate in Australia), the margin in dollars and as a share of the price and delivery to AU, US and GB.
- **Warns** (exit 0, a GitHub annotation in CI) when a margin is under the **30% floor** (`(price - card fee - production in AUD) ÷ price < 0.30`), or when Price Check's shipping differs from Get Catalog Product Costs' by more than 5% for the same country.
- George runs it before opening prints and whenever Artelo's prices or the rate move a lot (ADR-0021); it is not part of CI (it needs the live key).

## 8. After payment

### 8.1 Stripe's webhook, processed exactly once

`POST /api/prints/stripe` (subscribed events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`):

- Reads the raw body (refused with 413 past 256KB) and verifies `Stripe-Signature`: `t=<seconds>,v1=<hex>[,v1=…]`, HMAC-SHA256 of `<t>.<raw body>` with `STRIPE_WEBHOOK_SECRET`, compared in constant time against each `v1`, with `t` within 300 seconds of now. Anything else is a 400 before the body is parsed.
- **The guard:** every event is applied as one D1 `batch()` (a transaction) whose first statement is `INSERT INTO stripe_events (id, type, received_at)`. A primary-key conflict means the event was already applied: answer 200 and do nothing. Because the event row and the order change commit together, an event is either fully applied once or not at all (a failure answers 500 and Stripe redelivers).
- **`checkout.session.completed`:** finds the order by `client_reference_id`, checks `livemode` matches and that `payment_status` is `paid`, `currency` is `aud` and `amount_total` equals print plus delivery. The batch then moves the order `checkout` (or `expired`) to `paid`, storing `paid_at`, `stripe_session_id`, `stripe_payment_intent`, `retry_until = paid_at + 24 hours` and `next_attempt_at = now`. The status condition in the `UPDATE` is the session guard: a second event for the same session changes nothing. If the amount or currency differs, the order still becomes `paid` but goes straight to `needs_attention` with `the amount paid differs from the quote`. If no order row exists (it never should), the batch inserts one from the session's `metadata`, so the payment is still tracked. After the batch commits, the first placement attempt runs in `waitUntil` (8.2) and the handler answers 200 at once.
- **`checkout.session.expired`:** `checkout` becomes `expired`.
- **`charge.refunded`:** finds the order by `payment_intent`, stores `refunded_at` and the refunded amount; a full refund of an order not yet placed (`paid` or `needs_attention`) moves it to `refunded`, which stops retries. A placed order keeps its status and shows `refunded $212` in `/admin`.
- Logs carry only event ids, types and order ids.

### 8.2 Placing the Artelo order

`placeOrder(orderId)` in `src/lib/prints/place.ts`, called from the webhook's `waitUntil`, the cron (8.6) and `retry now`:

1. **Claim** the order: `UPDATE print_orders SET lease_until = now + 120, attempts = attempts + 1 WHERE id = ? AND status = 'paid' AND refunded_at IS NULL AND next_attempt_at <= now AND (lease_until IS NULL OR lease_until < now)`. No change means another run holds it or it isn't due; stop.
2. **Look before creating:** every attempt first asks `GET /orders/get?limit=5&name=<order id>`; an Artelo order whose `orderId` equals ours means an earlier attempt succeeded after its answer was lost (or the order is already at Artelo awaiting action), so the site adopts it (step 6) instead of creating a duplicate.
3. **Fetch the address from Stripe**, in memory only: `GET /v1/checkout/sessions/<session id>` with the pinned version; the name and address from `collected_information.shipping_details` and the phone from `customer_details.phone`. Nothing from it is stored or logged.
4. **Issue the master link:** `issueOrderGrant(db, PHOTO_LINK_SECRET, photoId, 72 hours)` inserts a photo-scoped grant with `purpose = 'order'` and returns `<SITE_ORIGIN>/photos/downloads/<photo id>?token=<token>`. This is the existing full-resolution route serving the private master JPEG from `PHOTO_PRINTS`, never a preview. The link lives for 72 hours, long enough for Artelo's image processing, and is never shown anywhere.
5. **Create the order** (`POST https://www.artelo.com/api/open/orders/create`, 15-second timeout):

   ```json
   {
     "orderId": "<order id>", "createdAt": "<paid_at, ISO 8601>", "currency": "AUD",
     "total": 212, "shippingCost": 33, "channelName": "curiousgeorge.dev",
     "companyName": "george vlachos", "isTestOrder": false,
     "customerAddress": { "name": "…", "street1": "…", "street2": "…", "city": "…", "state": "…",
                          "zipcode": "…", "country": "AU", "phone": "…" },
     "items": [{ "orderItemId": "<order id>-1", "quantity": 1, "unitPrice": 179,
       "productInfo": { "catalogProductId": "IndividualArtPrint", "size": "x12x18",
         "frameColor": "NaturalOak", "paperType": "ArchivalMatteFineArt", "orientation": "Vertical",
         "canvasDesignedFor": null, "canvasBorderStyle": null,
         "includeFramingService": false, "includeHangingPins": false, "includeMats": false,
         "designs": [{ "sourceImage": { "url": "<master link>" },
                       "fitOptions": { "canvas": "Paper", "style": "Outside" } }] } }]
   }
   ```

   - `frameColor` is `null` for unframed prints. `isTestOrder` is `true` for every test-mode order (`livemode = 0`), so Stripe test payments never produce a real print. `companyName` is `PRINT_SELLER_NAME` (Artelo prints it on the shipping label). `dangerouslySkipDPICheck` is never sent.
   - Address mapping: `street2` only when present; `city` is the address's city, or its state when the city is empty; `state` is the address's state, or its city when the state is empty; `zipcode` is the postal code or `""`; `phone` is sent only when the country isn't `US`. The buyer's email is not sent to Artelo.
6. **On success** (a 2xx with an order `id`): status `placed` (or the mapping in 8.3 for the status Artelo returns), `artelo_order_id`, `artelo_status`, `placed_at`, `artelo_cost` (from `details.productionCost + details.arteloShipping`, in US cents), lease cleared.
7. **On failure:** section 9.

### 8.3 Artelo's webhook and the status poll

`POST /api/prints/artelo` (topic `OrderStatusChange`, registered by `bun run prints:webhook`, 8.6):

- Reads the raw body (413 past 64KB) and verifies `x-artelo-signature`: the hex HMAC-SHA256 of the body with `ARTELO_WEBHOOK_SECRET`. Artelo's example signs `JSON.stringify(req.body)`, so the handler accepts a match over the raw body or over `JSON.stringify(JSON.parse(raw body))`, both compared in constant time. A mismatch answers 400 `{ "code": "invalid_signature" }`, as Artelo's documentation shows.
- Reads `orderId`, `status` and `shipments` from the top level of the body, or from a top-level `data` object. The order is found by `artelo_order_id = orderId`, or failing that `id = orderId`. A signed body it can't read, or an unknown order, answers 200 (so Artelo doesn't retry 20 times and delete the webhook) and logs the body's top-level keys only.
- Must answer within 10 seconds: it only updates D1 and sends any email in `waitUntil`.
- Every accepted webhook stores `print_settings.artelo_webhook_at`, shown in `/admin`.

Artelo status to order status, never moving an order backwards (`placed` < `in_production` < `shipped` < `delivered`; a lower status arriving late is ignored):

| Artelo status | Order status | Also |
|---|---|---|
| `ImagesProcessing`, `Received`, `Ignored` (test orders) | `placed` | |
| `PendingFulfillmentAction` | `needs_attention` | reason `artelo needs something before it can print: open the order in artelo.`, George is emailed |
| `InProduction` | `in_production` | |
| `Shipped` | `shipped` | the first shipment's `carrierCode`, `trackingNumber` and `trackingUrl` stored; the buyer is emailed (8.4) |
| `Delivered` | `delivered` | |
| `Canceled` | `cancelled` | George is emailed `artelo cancelled order <id>. refund it in stripe.` |
| anything else | unchanged | `artelo_status` stored, logged |

**The poll:** Artelo deletes a webhook after 20 failed deliveries, so the cron (8.6) also asks `GET /orders/get-by-id?orderId=<artelo id>` for orders in `placed`, `in_production` or `shipped` not checked for 12 hours (`status_checked_at`), at most 20 per run, 300ms apart (Artelo allows 50 requests per 10 seconds), and applies the same mapping.

### 8.4 Emails

Cloudflare Email Service through a `send_email` binding named `EMAIL`, from `PRINT_FROM_EMAIL` (`prints@curiousgeorge.dev`, name `george vlachos`), with `replyTo: hello@curiousgeorge.dev`, always with both `text` and a plain `html` version.

- **Shipped**, to the buyer, once (`shipped_email_at` set in the same statement that claims the send): the address is fetched from the Stripe session at send time (`customer_details.email`) and never stored. Subject `your print is on its way`. Body: `hi, your print of <name> (medium, oak frame) has left the printer. tracking: <carrier> <number> <tracking url>. you can check on it here: <order page url>. thanks for buying one. - george`
- **Needs attention**, to `ADMIN_EMAIL`, once each time an order enters `needs_attention` (`attention_notified_at`, cleared when it leaves): subject `print order <id> needs attention`, body the reason and `<SITE_ORIGIN>/admin/#orders`.
- **Cancelled by Artelo** and **Artelo webhook missing** (at most once a day), to `ADMIN_EMAIL`.
- Receipts are Stripe's: Stripe emails the receipt and the paid invoice carrying the GST footer (7.5).
- A failed send is logged with the order id and retried by the next cron run while the guard column is still empty (the claim is released on failure).

### 8.5 The order page, /prints/<order id>?key=…

Shown when `SHA-256(key)` equals the order's `view_key_hash` (constant-time); otherwise the notebook 404, so the page never says whether an order exists. Private headers (2.2), no beacon, no script, `noindex`, the key never logged.

| Margin label | Content |
|---|---|
| `your print` (head row) | The photo's 480 preview, `<h1>` its name, `medium · 12 × 18 in · oak frame · to australia`, `print $179 + delivery $33 = $212`, paid date |
| `status` | One line by status, below |
| `say hi` | `questions about your order? hello@curiousgeorge.dev` |

Status lines: `checkout` `your payment's on its way through. this page updates when it lands.` (with `<meta http-equiv="refresh" content="10">`, only in this state); `paid` `paid. your print is being sent to the printer.`; `needs_attention` `paid. something needs sorting before it prints. george knows and will email you.`; `placed` `it's with the printer.`; `in_production` `it's being printed and packed.`; `shipped` `it's on its way: <carrier> <tracking number ›>`; `delivered` `delivered. enjoy it.`; `cancelled` `this order was cancelled. george will be in touch about a refund.`; `refunded` `refunded.`; `expired` `this checkout wasn't finished, so nothing was charged.`

### 8.6 Scheduled work

`scheduled` in `src/worker.ts`, cron `*/5 * * * *`. Each run, in order, each step in its own `try` so one failure doesn't stop the rest:

1. Place due orders: `status = 'paid' AND next_attempt_at <= now`, oldest first, at most 10, one at a time.
2. Retry unsent emails (8.4).
3. Poll Artelo statuses (8.3).
4. Daily jobs, each when its `print_settings` timestamp is more than 20 hours old: refresh the exchange rate; check the Artelo webhook (`GET /webhooks/get` lists one with our URL and topic, else `/admin` and an email say it's missing); mark `checkout` orders older than 2 days `expired`; delete `expired` orders older than 30 days and `stripe_events` older than 90 days.

`bun run prints:webhook --local | --remote` (`scripts/artelo-webhook.mjs`) saves the webhook (`POST /webhooks/save`: topic `OrderStatusChange`, URL `<SITE_ORIGIN>/api/prints/artelo`, `filters.statuses` every status in 8.3's table) and pipes the returned `secret` straight into `wrangler secret put ARTELO_WEBHOOK_SECRET` on standard input. It prints only `webhook saved; its secret is stored on the worker.`

## 9. Failure handling

- **Never charged without being tracked:** the order row is written before the Checkout Session exists (7.5) and the webhook can recreate a missing row from the session metadata (8.1). A webhook that can't write answers 500, so Stripe redelivers.
- **Retries with backoff:** after failed attempt `n`, the next waits `min(5 minutes × 3^(n-1), 6 hours)`: 5 minutes, 15, 45, 2 hours 15, then every 6 hours, picked up by the first cron run after it falls due. The window is 24 hours from payment (`retry_until`): when the next attempt would fall after it, the order becomes `needs_attention` with `artelo didn't take the order within a day: <last error>` and George is emailed. That is at most 8 attempts.
- **What counts as retryable:** a network error, a timeout, 408, 429 and any 5xx. Any other 4xx (Artelo refusing the order, a bad key) is permanent: `needs_attention` at once with Artelo's error message (at most 200 characters, with anything that looks like an address stripped). A photograph hidden since the order was paid, a Stripe session that can't be read and a missing secret are permanent too, each with a plain reason.
- **No duplicates:** the lease (8.2 step 1) stops two runs placing one order, and the lookup (8.2 step 2) stops a retry recreating an order Artelo already has.
- **retry now** resets the window (6.4); **refunds** happen in Stripe from the admin link (6.4) and arrive as `charge.refunded` (8.1).
- Test builds only (`__TEST_HOOKS__`) read a var `PRINT_RETRY_WINDOW` (seconds) in place of 24 hours, so the end-to-end test can reach `needs_attention` without waiting a day; production builds can't contain it.

## 10. Privacy, analytics and security

### 10.1 Cookies and analytics

- The site still sets no cookies and uses no storage; Stripe's Checkout is on Stripe's own domain, and the print section says so before the button (7.4). `visitor info` (R2) is unchanged and stays true of curiousgeorge.dev.
- The beacon (R10) runs on `/photos` and `/photos/<id>` and sends its `$pageview` with the path only (ADR-0013), so a `?before=` cursor is never sent. No new events.
- `/photos/downloads` and `/prints/` carry no beacon and are refused by the ingest proxy (2.2). Tokens and view keys never reach analytics, logs (`redact_query_string`, and no handler logs a URL or request) or referrers (`Referrer-Policy: no-referrer`).
- The privacy smoke test (R14) adds `/photos`, `/photos/<id>`, the print section (choosing a size, frame and country) and a downloads page: no `Set-Cookie`, empty storage, every request to the site's own origin.

### 10.2 What is kept where

- **Stripe** holds the buyer's name, email, phone, billing and shipping address and payment details. **Artelo** gets the name, shipping address and (outside the US) phone. The site fetches the address and email from Stripe in memory when it needs them (8.2, 8.4) and never writes them anywhere.
- **D1** keeps, per order: the order id, photo, tier, Artelo size, frame, country, the two amounts, status and reason, the Stripe session and payment intent ids, Artelo's order id, status and cost, the tracking carrier, number and URL (a parcel's, not a person's), timestamps, retry bookkeeping and the view key's hash. Nothing else.
- Logs carry order ids, statuses and error summaries, never addresses, emails, tokens, keys or request bodies.

### 10.3 Abuse

Two Workers Rate Limiting bindings, keyed by `CF-Connecting-IP`: `QUOTE_LIMIT` (`simple: { limit: 30, period: 60 }`) for quotes, from the script or the no-JavaScript quote post, and `CHECKOUT_LIMIT` (`simple: { limit: 6, period: 60 }`) for checkouts. It sets no cookie (R10's zone rules forbid rate-limiting rules that do). The Artelo cost cache bounds Artelo calls to one per size, frame and country every 6 hours.

### 10.4 Secrets and configuration

- Worker secrets George sets with `wrangler secret put`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ARTELO_API_KEY`, `ARTELO_WEBHOOK_SECRET` (set by `prints:webhook`) and `PHOTO_LINK_SECRET` (already required).
- Vars in `wrangler.jsonc`: `PRINTS_OPEN` (`"false"` until launch), `PRINT_SELLER_NAME` (`"george vlachos"`), `PRINT_GST` (`"none"` or `"inclusive"`), `STRIPE_GST_TAX_RATE` (empty until needed), `PRINT_FROM_EMAIL` (`"prints@curiousgeorge.dev"`), `SITE_ORIGIN` (`"https://curiousgeorge.dev"`, needed by the cron, which has no request), `ARTELO_API_BASE` (`"https://www.artelo.com/api/open"`) and `FX_URL` (the Frankfurter URL in 7.3). Tests point the last two at the fixture (14.3).
- Test builds refuse a `STRIPE_SECRET_KEY` that starts with `sk_live_`.

### 10.5 Places (ADR-0022)

Coordinates never leave George's Mac as data the site holds: the import reads them and turns them into "area, city" (section 11), and only that string reaches the manifest, D1 or the site. The lookup itself is macOS's `CLGeocoder`, which asks Apple's geocoding service, the same one Photos uses to name these places; no coordinates go anywhere else. George can edit or hide any place (6.2).

## 11. Places, dates and the import

### 11.1 Post dates

`photos:prepare` reads each post's `published_at` from `photo-index.json` (one value per post, with its offset, for example `2025-02-02T20:27:48+11:00`) and writes the manifest's new `posts` array: `{ "collection", "publishedAt", "place" }`. The import stores `published_at` as seconds since 1970 (unique, the sort key and cursor) and `published_on` as the date part in the post's own offset (`2025-02-02`), which is what the gallery shows.

### 11.2 Places

A new Swift tool, `scripts/photo-place.swift`, compiled with `xcrun swiftc` exactly as `photo-render.swift` is, takes an image path, reads its GPS with ImageIO (`kCGImagePropertyGPSDictionary`) and reverse-geocodes it with `CLGeocoder` (`preferredLocale` `en_AU`). It prints JSON with names only (`subLocality`, `locality`, `subAdministrativeArea`, `administrativeArea`, `isoCountryCode`), or `null` with no GPS; the coordinates stay inside the tool's process.

- Per post, the prepare step geocodes the **original** file (`kind: "original"`, which keeps its GPS) of up to three selected photographs (the first, middle and last that have GPS), 1.5 seconds apart to stay inside `CLGeocoder`'s rate limit, and the post's place is the most common result (the first slide's on a tie). Results are cached in `<output>/metadata/places.json` (mode 0600, names only), so a rerun doesn't geocode again.
- **Area** is `subLocality`, else `locality` (`bondi beach`, `manhattan`). **City** comes from `scripts/photo-cities.json`, a committed map from `<country>/<administrativeArea>/<subAdministrativeArea or locality>` to a city name (`"AU/NSW/Waverley Council": "sydney"`, `"AU/ACT/City": "canberra"`). Without an entry it is `locality` when `subLocality` was used (`manhattan, new york`), otherwise `administrativeArea`. When area and city are the same, only one is kept. Everything is lowercased. A sample run on 2026-10-08 showed why the map is needed: in Australia `CLGeocoder` gives the suburb as `locality` (`Bondi Beach`, `Waverley Council`, `NSW`) and never a metropolitan city.
- For Australian results with no map entry, prepare stops and lists each missing key with its post, so the map is filled once (the 32 posts need a handful of entries) before import. Prepare also prints every post's derived place for review.

### 11.3 The import

`photos:import` (unchanged otherwise) first upserts `photo_posts` for every post in the manifest: `published_at` and `published_on` always, `place` only where `place_edited = 0`. It then imports photographs as now and sets `photos.raw_review` from the manifest's `needsRawReview`. Remote import still runs from George's Mac with `--remote` (section 15).

## 12. Data

One new migration, `migrations/0006_photos_and_prints.sql`, applied with `wrangler d1 migrations apply` (`bun run db:migrate:local`, and the deploy job's `bun run db:migrate:remote`), never `execute --file`:

```sql
CREATE TABLE photo_posts (
  collection TEXT PRIMARY KEY,
  published_at INTEGER NOT NULL UNIQUE,      -- seconds since 1970, from Instagram
  published_on TEXT NOT NULL,                -- YYYY-MM-DD in the post's own offset
  place TEXT,                                -- "area, city" or null
  place_edited INTEGER NOT NULL DEFAULT 0 CHECK (place_edited IN (0, 1))
);
ALTER TABLE photos ADD COLUMN raw_review INTEGER NOT NULL DEFAULT 0 CHECK (raw_review IN (0, 1));

ALTER TABLE photo_download_grants ADD COLUMN purpose TEXT NOT NULL DEFAULT 'person' CHECK (purpose IN ('person', 'order'));
ALTER TABLE photo_download_grants ADD COLUMN note TEXT;
ALTER TABLE photo_download_grants ADD COLUMN request_nonce TEXT;
CREATE UNIQUE INDEX photo_grants_nonce ON photo_download_grants(request_nonce);

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

CREATE TABLE print_orders (
  id TEXT PRIMARY KEY,                       -- lowercase ULID; Artelo's orderId and Stripe's client_reference_id
  photo_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('small', 'medium', 'large')),
  size TEXT NOT NULL,                        -- Artelo ProductSize, e.g. x12x18
  frame TEXT NOT NULL CHECK (frame IN ('unframed', 'oak')),
  country TEXT NOT NULL CHECK (length(country) = 2),
  print_amount INTEGER NOT NULL,             -- AUD cents
  delivery_amount INTEGER NOT NULL,          -- AUD cents
  status TEXT NOT NULL CHECK (status IN ('checkout', 'expired', 'paid', 'needs_attention', 'placed',
    'in_production', 'shipped', 'delivered', 'cancelled', 'refunded')),
  attention_reason TEXT,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  view_key_hash TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT UNIQUE,
  artelo_order_id TEXT UNIQUE,
  artelo_status TEXT,
  artelo_cost INTEGER,                       -- US cents, production plus shipping
  carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
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

CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);
```

`photos.collection` has no foreign key to `photo_posts` (SQLite can't add one to an existing table); every public query joins the two, so a photograph whose post row is missing simply isn't shown, and the import writes posts before photographs. No exchange rate is seeded: the daily job fetches it (7.3).

## 13. Performance budgets

R11's method applies to `/photos` (first batch) and `/photos/<id>` (a photograph with prints):

- JavaScript before any interaction: under 10KB gzipped per page (the beacon plus `photo-sheet.ts` or `print-quote.ts`), all inline, no framework.
- HTML under 30KB gzipped, CSS under 15KB gzipped, the same two fonts.
- Cumulative layout shift under 0.01 at 1280px and 375px, on `/photos` including after one batch loads, and on `/photos/<id>` including after a quote fills in (the quote line reserves two lines).
- Largest contentful paint under 1.5s, a Lighthouse warning after each deploy: `scripts/lighthouse.mjs` takes several URLs and runs `/`, `/photos` and one photograph page.
- Interaction to next paint under 200ms for changing the country in the print section (the paint that follows the change, not the network answer).
- Preview weights are fixed by `photos:prepare` (AVIF quality 55, WebP 82); the budget spec reports the bytes loaded by `/photos`' first screen without gating them.

## 14. Testing

### 14.1 Unit (Vitest)

- **Eligibility:** the crop tolerance at 2.9% and 3.1%; the family choice; the 200 ppi line; orientation; the real dimension classes of 7.1 (3648 × 5472 all three; 3024 × 4032 small and medium; 6048 × 8064 all three; 2194 × 3291 small; 3575 × 4172 and 1756 × 3097 none; 2048 × 2048 small only).
- **Pricing:** delivery rounding up to whole dollars, the 8% buffer, totals in cents, a missing or stale rate, Artelo's cost cache.
- **The guard:** a duplicate event id applies nothing; two events for one session pay once; a missing order row is recreated from metadata; an amount mismatch reaches `needs_attention`; a refund before placement stops retries.
- **Retries:** the backoff schedule, the 24-hour window, retryable versus permanent statuses, the lease, adopting an order found by the lookup and an email retried until its guard column is set.
- **Signatures:** Stripe's tolerance, several `v1` values and a tampered body; Artelo's raw and re-serialised forms.
- **Artelo statuses:** the mapping table, out-of-order statuses ignored, both `orderId` lookups, the `data` wrapper.
- **Admin:** the new actions on the real migrations over `node:sqlite` (R14), the link nonce, all-or-nothing post publishing, place validation.
- **Places:** `photo-cities.json` lookups, the fallbacks and the stop on a missing Australian entry, with recorded placemark fixtures (no geocoding in tests).

### 14.2 End to end (Playwright)

- **Gallery** (Chromium, WebKit, phone): entries, headings and frames from the fixture; no place shown for a post without one; the plain `older entries` link without JavaScript; the next batch loading as the page nears the bottom; `that's every entry.`; a photograph page with previous and next; the 404 for an unpublished photograph; no layout shift.
- **Downloads page:** a valid link lists every published photograph and downloads a JPEG whose bytes match the master; private headers and no `Set-Cookie`; no request carries a `Referer`; an expired link (a token the test signs with the fixture key and an already-expired grant row inserted with `wrangler d1 execute --command`), a revoked link and a garbled one each show the same 403 page; no beacon request.
- **A full test order** (Chromium, runs when `STRIPE_TEST_SECRET_KEY` is set, skipped with an annotation otherwise): on `/photos/fixture-b-01` choose medium, oak frame and australia; the quote reads `print $179 + delivery $33 = $212` (fixture cost US$20.00 at 1.50, plus 8%, rounded up); `continue to payment` reaches `checkout.stripe.com` in test mode, which offers only Australia; Playwright pays with Stripe's published test card `4242 4242 4242 4242` and test address; the browser lands on the order page. The test then fetches the real `checkout.session.completed` event from Stripe's events API and delivers it to `/api/prints/stripe` signed with the local test webhook secret, twice. The stand-in Artelo received exactly one order with `x12x18`, `NaturalOak`, `ArchivalMatteFineArt`, `Vertical` and `isTestOrder: true`, whose design URL it fetched: a 4000 × 6000 JPEG matching the master's SHA-256, not a preview. The fixture then sends a signed `Shipped` webhook; the order page shows the tracking and the email sink holds one shipped email.
- **Artelo failure** (same server and key; `/admin` through the test build's local bypass, R7): the stand-in answers 503 to every create; with `PRINT_RETRY_WINDOW=0` the first failure leaves the order `needs_attention`; `/admin` lists it first with its reason and the sink holds George's email. With the stand-in set to accept, `retry now` places it once. A 400 refusal reaches `needs_attention` without retrying.
- **Admin** (on the admin server, 4333): publish and hide a post and a photograph; a verification failure publishes nothing; edit a place and a title; issue a link, see it once, reload without a second link, revoke it; the order list's highlighting and refund link.
- **Privacy and budgets:** as 10.1 and 13.

### 14.3 Fixtures and servers

- `scripts/seed-photo-test.mjs` seeds six posts with `photo_posts` rows and fixed dates: `fixture` (the existing three 2048 × 2048 photographs, `fixture-03` unpublished, place `bondi, sydney`), `fixture-b` (`fixture-b-01` 4000 × 6000 portrait and `fixture-b-02` 6000 × 4000 landscape, both 2:3 with all three sizes, no place), `fixture-c` (`fixture-c-01`, 1200 × 1800, no prints) and `fixture-d`, `fixture-e` and `fixture-f` (one 2048 × 2048 photograph each), so the gallery has a second page.
- A stand-in Artelo, `tests/fixtures/artelo-site.mjs` on port 4401 (like the snapshot fixture site on 4400): `catalog/get-costs` (production US$40.00, shipping US$20.00 for every size and country), `orders/price-check`, `orders/create` (which fetches the design URL and records its bytes' SHA-256 and dimensions), `orders/get`, `orders/get-by-id`, `webhooks/get` and `webhooks/save`, plus `/fx` answering Frankfurter's shape with 1.50, `/__mode` to switch creation between `ok`, `down` (503) and `refuse` (400), `/__ship` to send a signed `OrderStatusChange` to the site, `/__requests` to read what it received and `/__mail` as the email sink.
- A prints server on port 4335, recreated every run like the admin server: `rm -rf .wrangler/prints`, `wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/prints`, the seed, then `wrangler dev -c dist/server/wrangler.json --port 4335 --persist-to .wrangler/prints --test-scheduled` with vars for the fixture key, `PRINTS_OPEN=true`, `SITE_ORIGIN=http://localhost:4335`, `ARTELO_API_BASE` and `FX_URL` on 4401, test `ARTELO_API_KEY` and webhook secrets, `STRIPE_SECRET_KEY` from `STRIPE_TEST_SECRET_KEY`, and the test-only `EMAIL_SINK=http://127.0.0.1:4401/__mail` (test builds send mail there instead of the binding). Specs trigger the cron with `GET /__scheduled?cron=*/5+*+*+*+*`.

## 15. Launch

Only George can do these:

- [ ] Create the R2 bucket **before this branch deploys**, because `wrangler.jsonc` already binds it: `bunx wrangler r2 bucket create curiousgeorge-photo-prints --location oc`; confirm it has no `r2.dev` URL and no custom domain.
- [ ] Set `PHOTO_LINK_SECRET` (64 lowercase hex characters, fresh, not the local one): `bunx wrangler secret put PHOTO_LINK_SECRET`.
- [ ] After the deploy has applied migration 0006, run the photo import from the Mac: `photos:prepare` (now with places and dates, filling `scripts/photo-cities.json` where it stops) then `photos:import --remote`, as in docs/photo-gallery-backend.md.
- [ ] Review every post in `/admin` (places included, ADR-0022) and publish what should be public, looking hardest at the 96 RAW candidates (`raw` pills).
- [ ] Open a Stripe account as an individual, set the public business name to `george vlachos`, turn on customer emails for successful payments and set `STRIPE_SECRET_KEY` (live) on the Worker. Add `STRIPE_TEST_SECRET_KEY` (test mode) to GitHub Actions secrets for the end-to-end order test.
- [ ] Create the Stripe webhook endpoint `https://curiousgeorge.dev/api/prints/stripe` with API version `2025-09-30.clover` and the events `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`. Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
- [ ] Open an Artelo account, connect the API integration, set up Artelo billing (Artelo charges George's account for each order) and set `ARTELO_API_KEY` on the Worker.
- [ ] Run `ARTELO_API_KEY=… bun run prints:webhook --remote` (it stores `ARTELO_WEBHOOK_SECRET` itself) and `bun run prints:check --remote`; fix anything it fails on and look at any margin warning.
- [ ] Turn on Cloudflare Email Sending for curiousgeorge.dev (`bunx wrangler email sending enable curiousgeorge.dev`) and add the DNS records it asks for alongside the domain's existing mail records.
- [ ] Set `PRINTS_OPEN` to `"true"` in `wrangler.jsonc` and deploy.
- [ ] Buy one small unframed print with a real card, shipped to yourself, and watch it reach `shipped` in `/admin`, with the tracking email; then decide whether to keep or refund it. This is the only check of Artelo's real image fetch, address handling and webhooks (section 16).

After launch (agent or George): issue the first catalogue link from `/admin` and open it on a phone; check `/photos` against section 13 with the post-deploy Lighthouse run; check the privacy test passes on the live photo pages.

## 16. Assumptions about Artelo and Stripe

Artelo's documentation hides some answers behind an account or truncates its enums; Stripe's behaviour in some details is account-dependent. Each assumption, and how the build checks it:

1. **Artelo sizes:** the frameable sizes are those in Artelo's documentation bundle (`NON_GALLERY_PRODUCT_SIZES_SUPPORTING_FRAMES`, read 2026-10-08) and all exist for `IndividualArtPrint`. Checked by `prints:check`, which fails on any refused combination.
2. **Artelo's standard oak frame** is `frameColor: "NaturalOak"` at order time and `frameStyle: "Oak"` in cost queries, and an unframed print is `frameColor: null`. Checked by `prints:check` (Price Check with the exact `productInfo`).
3. **Paper:** `ArchivalMatteFineArt` is offered at every size in 7.1, framed and unframed. Checked by `prints:check`.
4. **Currency:** Get Catalog Product Costs, Price Check and an order's `details` are in US dollars, the account currency. Checked by `prints:check` comparing Price Check (`currency: "USD"`) with Get Catalog Product Costs, and by the first real order's cost against Artelo's invoice.
5. **Delivery by country:** Get Catalog Product Costs' `shippingCost` for a country matches Price Check's `arteloShipping` for a real address there. Checked by `prints:check` (warning past 5%) for AU, US and GB.
6. **The master link:** Artelo fetches a design from any HTTPS URL, including one with a query string that answers with `Content-Disposition: attachment` and a JPEG of 10 to 30MB, within 72 hours of the order. Mimicked by the stand-in in the end-to-end test; truly checked by the launch's real order.
7. **Duplicate order ids:** Artelo doesn't refuse or merge a second order with the same `orderId`, so the site never relies on it and looks the order up with Get Orders' `name` filter before every create. Covered by unit tests and the stand-in.
8. **The webhook payload** carries `orderId` (Artelo's id or ours; both are looked up), `status` and, when shipped, `shipments`, at the top level or in a `data` object, signed as an HMAC-SHA256 hex of the body. Handled both ways, logged by key name when unreadable, backed by the 12-hour poll; the first real status change is shown in `/admin` (`artelo webhook` timestamp).
9. **Addresses:** Artelo accepts the city and state fallbacks and an empty `zipcode` for places without one, and requires a phone only outside the US. Checked by the launch order and, after that, by `needs_attention` reasons if Artelo refuses one.
10. **Test orders:** `isTestOrder: true` orders cost nothing, are never produced and get status `Ignored`. From Artelo's Create Order documentation; the end-to-end test only uses the stand-in.
11. **Stripe API version** `2025-09-30.clover` returns the shipping name and address in `collected_information.shipping_details` and the phone and email in `customer_details`. Pinned on every request; checked by the end-to-end test against Stripe's test mode.
12. **Stripe receipts and the invoice:** with `invoice_creation` on, Stripe emails the receipt and the paid invoice with its footer in live mode when customer emails are on (test mode sends none), and charges its Invoicing fee for each such invoice (0.4% at the Starter rate). Checked by the launch order's emails.
13. **Stripe fees in Australia** are 1.7% + $0.30 for domestic cards and 3.5% + $0.30 for international ones; `prints:check` uses the worse.
14. **Checkout images:** Stripe shows the 480 WebP preview as the line item's image; if it doesn't, Checkout simply shows none. Seen in the end-to-end test.
15. **`payment_method_types[]=card`** includes Apple Pay and Google Pay and only completes sessions with `payment_status: paid`, so no delayed payment events are needed; the webhook still checks `payment_status` (8.1).
16. **Test-mode redirects:** Stripe accepts `http://localhost` success and cancel URLs in test mode. Checked by the end-to-end test.
