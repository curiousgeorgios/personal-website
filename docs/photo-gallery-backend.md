# Photo gallery

George's photographs on the site: `/photos`, a page for each photograph, a private downloads page for approved email addresses, the owner's photographs and downloads sections in `/admin` and a line on the home page while anything is published. Designed in [the photo gallery spec](superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md) (part 1), built in [plan 6](superpowers/plans/2026-10-08-plan-6-photo-gallery.md) on Codex's backend of `a65ecc6`; what it left for later is in [the plan 6 follow-ups](superpowers/plans/2026-10-08-plan-6-followups.md). Human download access was amended on 14 October 2026 by ADR-0033.

Decisions:

- [ADR-0020](adr/0020-photo-downloads-use-revocable-signed-links.md) (amended): full-resolution files stay private and print orders retain internal, revocable supplier grants.
- [ADR-0033](adr/0033-photo-downloads-require-approved-email-codes.md): people sign in with a single-use email code after George approves their address, with a fourteen-day session.
- [ADR-0022](adr/0022-photo-places-are-area-and-city-only.md) (amended): a place is an area and a city, and coordinates never reach the site.
- [ADR-0023](adr/0023-the-gallery-stays-light-on-phones.md): the gallery stays light on phones.
- [ADR-0024](adr/0024-test-servers-never-hold-the-real-signing-key.md): test servers never hold the real signing key.
- [ADR-0030](adr/0030-deleted-photos-stay-out-of-the-catalogue.md): deleting a photograph removes it from the catalogue and preserves existing print orders.

## Pages and routes

| Route | Behaviour |
| --- | --- |
| `/photos` | The gallery: one entry per Instagram post with a published photograph, newest first, two to a page. Works without JavaScript; `src/scripts/photo-sheet.ts` appends older entries (four at a time) once the visitor scrolls. Edge-cached, tag `photos`. |
| `/photos?before=<seconds>` | The next two entries posted before that time; `noindex`. Anything but 1 to 10 digits is the notebook 404. |
| `/photos/<id>` | One published photograph, its date and place, its neighbours in the post and its own share image (the 1600 WebP). Unpublished or unknown: the notebook 404. |
| `/photos/downloads` | Email-code sign-in, or every published, undeleted photograph at full resolution for a valid approved session. Private headers, no referrer, never cached or counted. Service failures return 503. |
| `GET` or `HEAD /photos/downloads/<id>` | One full-resolution JPEG attachment for an approved session, with byte ranges and conditional requests. Internal Artelo requests may instead supply a photo-scoped order token. Human catalogue tokens are refused. |
| `GET /api/photos?after=-1&limit=24&collection=<optional>` | The published catalogue in position order, with a numeric `next` cursor. Limit 1 to 48. |
| `GET /api/photos?by=entry&before=<seconds>&limit=4` | The entry mode: `{ entries: [{ collection, date, place, photos }], next }`, photos with only their 240 and 480 previews. Limit 1 to 12. |
| `GET /api/photos/<id>` | One published photograph. |
| `GET /api/photos/downloads` | The private catalogue as JSON for an approved session, with token-free attachment URLs. |
| `POST /api/photos/access/code` | JSON `{ email }`; generic 202 response and a ten-minute browser challenge cookie. Only an approved address receives a code. |
| `GET /api/photos/access/session` | Private session status and expiry. |
| `POST /api/photos/access/session` | JSON `{ code }`; consumes the browser-bound code once and creates a fourteen-day session. |
| `DELETE /api/photos/access/session` | Revokes the current session server-side and clears both sign-in cookies. |
| `GET`, `POST` or `DELETE /admin/photos/access` | Owner-only approval list, approve JSON `{ email }` or revoke `?id=<uuid>`. Writes also require the exact same-origin Origin header. |
| `POST /admin/photos/links` | Retired; returns 410 and never issues a grant. |
| `DELETE /admin/photos/links?grantId=<uuid>` | Revoke a catalogue link through the owner gate. A photo-scoped grant (plan B's print orders) answers as an unknown link and keeps working. |
| `PATCH /admin/photos/<id>` | Publish or hide one photograph through `setPublished` (JSON); a hide also purges its previews' tag. |
| `DELETE /admin/photos/<id>` | Delete from the catalogue through the owner and same-origin gates; requires JSON `{ "confirm": true }`. Returns `{ id, deleted: true, cacheInvalidated }`. Repeats succeed; unknown IDs return 404. |
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

- **photographs:** one post per row, newest first, with its counts and a `raw` pill for hidden photographs awaiting RAW review (publishing one is its review, so the pill goes). Inside: the post's place (the place rule: lowercase, at most 60 characters, printable Latin-1; saving marks it edited, so an import keeps it), `publish all` and `hide all`, each photograph's title and its own publish or hide. Publishing checks every photograph's private JPEG and eight previews first (`src/lib/photos/publish.ts`, ten R2 checks at a time) and publishes all or none, naming the master or preview that failed for each photograph. Saves purge `photos` and `logbook`.

  **What hide does:** a hidden photograph leaves every page, list and downloads page, and its previews stop being served to anyone new. `/media` checks in D1 that a preview's photograph is published and answers 404 otherwise; a hide also purges the photograph's `photo-<id>` tag, so the edge drops its cached previews (if that purge fails, the saved line says the gallery may show the old version for a little while). Publishing again brings them back. What hide can't recall: a copy already in a visitor's browser (previews are cached for a year), a saved or shared image, or a search engine's copy of one. It is the way to take a photograph down from the site, not a promise that no copy exists anywhere.
- **downloads:** approve an email address, list approved addresses and revoke access after confirmation. Revocation removes pending codes and sessions immediately. No invitation is sent when approving an address; George shares the ordinary `/photos/downloads` URL himself.

`bun run photos:link` only revokes legacy catalogue grants. New human grants cannot be issued, and photo-scoped print-order grants cannot be revoked by this command.

### Deleting a photograph

Each photo's admin row has a delete form, using the existing confirmation checkbox and working without JavaScript. It posts `intent=photo.delete`, `id=<photo-id>` and `confirm=yes` to `/admin/`. Confirmation is also checked on the server. Success redirects to the photographs section with a deleted notice; an unsuccessful cache purge says the gallery may show the old version for a little while.

Delete removes the photo from this list and every public gallery, preview and catalogue-download view. The remaining photos in the post keep their order. Deleting its last photo removes the post from the list too. Imports, stale edits and publish all cannot bring deleted photos back. The row and stored files remain for existing print orders; their internal master links and order history continue to work. Local originals are untouched. This is removal from the catalogue, not storage erasure. A visitor's existing downloaded or browser-cached copies cannot be recalled.

This feature needs migration `0009_photo_deletion.sql` before deployment. See ADR-0030 for the retention and concurrency rules.

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

`photos:prepare` renders each selected photograph (RAW and HEIC through a lossless 16-bit sRGB TIFF from Core Image, then a single JPEG encode at quality 96 with 4:4:4 chroma; it prefers an exported Photos edit where there is one), writes a full-resolution sRGB JPEG with its ICC profile and its eight previews, strips EXIF, XMP and IPTC from the delivery copy and checkpoints each photo, so a rerun reuses finished work. The lossless native recipe invalidates old RAW/HEIC checkpoints while existing JPEG checkpoints remain reusable; temporary TIFFs are private and removed after encoding; a checkpoint from before the 240s gets them from its master without rendering again. A rendered RAW is a candidate edit, not proof of a colour or crop match to Instagram. It then writes the manifest's `posts`: each post's time with its offset from the index, and its place. The manifest is version 2, so a prepared folder from before this plan needs `photos:prepare` run again (checkpoints and the places cache are reused). The place comes from the originals' GPS through `scripts/photo-place.swift` (ImageIO and Apple's geocoder through MapKit; one deprecation warning when it compiles is expected): at most three photos per post, 1.5 seconds apart, every answer cached as names only in `<output>/metadata/places.json`, so each photo's coordinates go to Apple once and nowhere else. Australian cities come from `scripts/photo-cities.json`; when a place has no entry, prepare stops before the manifest and lists the missing keys with their posts, so the map is filled once. It prints every post's place for review, and names it lists as `no place for …` need setting in `/admin`.

`photos:import` validates the whole manifest (eight previews per photograph, a post for every photograph, places by the rule, images by format, size, SHA-256 and profile, no private metadata) before touching storage. It writes posts first (a post's place only until George edits it), then uploads each photograph's objects before its row. A title comes from the manifest only when a row is first inserted; afterwards only `/admin` changes it. New or changed masters stay unpublished; an unchanged master keeps its publication. `raw_review` comes from the manifest's `needsRawReview`. No prepared photo file is committed to Git, and the prepared folder must live outside the checkout.

For production the same import runs with `--remote` from the Mac, after the deploy has applied migrations 0005 and 0006.

The import never purges cached pages, so after a re-import that hides a changed master, moves a post's time or changes an unedited place, `/photos` and `/photos/<id>` can show the old state until their cache goes stale (five minutes, then one revalidating request). A publish or hide in `/admin` purges at once.

## Approved download access

George approves the person's email address in `/admin` → downloads. The person opens `/photos/downloads`, requests a six-digit code and enters it in the same browser. The page exposes only published, undeleted full-resolution sRGB JPEGs; RAW source files remain outside this service. Existing human catalogue links no longer unlock downloads.

Codes last ten minutes, allow five attempts and work once. Requests have a 60-second cooldown, limits of three per hour and ten per day per address, and twenty per hour per client. Unapproved addresses receive the same public response but no code or session. A code becomes usable only after the email service accepts its delivery.

The opaque session lasts fourteen days from sign-in, without sliding renewal. Its host-only Secure, HttpOnly, SameSite=Lax cookie is checked against the current approval on every attachment request. Sign-out revokes the session. Revoking the address removes its pending codes and sessions, erases the stored address and stops later downloads. Reapproval never revives old sessions. Daily cleanup removes expired records and retains revoked approval metadata for thirty days. Internal Artelo order grants keep their existing fulfilment behaviour, including hidden or deleted photographs.

For legacy catalogue revocation only:

```bash
bun run photos:link --local --revoke <grant-id>
```

For production revocation, use `--remote`; never place secrets in command-line arguments or tracked files. `photos:key` remains a local development helper that creates an ignored key in `.dev.vars`, preserves an existing key and never prints it.

### Email-access release

Migration `0010_photo_email_access.sql` adds approvals, challenges, sessions and request limits. The main-only deploy job applies it before deploying the Workers. It approves no recipient and changes no photographs, masters or orders. Delivery uses the existing EMAIL binding, configured print sender and `PHOTO_LINK_SECRET`; no new provider credentials are required. Local acceptance uses synthetic addresses, a test-only mail sink and an actual HTTPS fixture, so the production cookie attributes are exercised.

## Historical original gallery launch

These steps document the original October 2026 launch and are not instructions to recreate existing production resources. Current releases use the main-only deployment job. Email access follows the section above.

1. Create the `curiousgeorge-photo-prints` R2 bucket **before this branch deploys**, because `wrangler.jsonc` binds it: `bunx wrangler r2 bucket create curiousgeorge-photo-prints --location oc`. Confirm it has no `r2.dev` URL and no custom domain; the application has no public route for its objects.
2. Apply migrations 0005 and 0006 with `wrangler d1 migrations apply` (`bun run db:migrate:remote`), never `d1 execute --file`. The original deploy job applied these before deploying the routes and bucket binding.
3. Configure the production `PHOTO_LINK_SECRET` through the approved secret-management process, using a fresh key rather than the local development key.
4. From the Mac, run `photos:prepare` (the manifest is now version 2; fill `scripts/photo-cities.json` wherever it stops), then `photos:import --remote` with the same manifest and selection.
5. In `/admin`, review every post (places included) and publish what should be public, looking hardest at the 96 RAW candidates, which carry `raw` pills.
6. The original launch checked a catalogue link on a phone. ADR-0033 replaces that human access check with approved email-code sign-in.

After the first photographs are published (step 5), run the post-publish check against the live site. The deploy job's privacy test and Lighthouse run happened before anything was public, and Lighthouse never weighs images, so this is the first time the real photographs are measured:

```bash
PLAYWRIGHT_BASE_URL=https://curiousgeorge.dev bunx playwright test tests/e2e/budgets.spec.ts tests/e2e/privacy.spec.ts -g "images before any scroll|photo pages" --project=chromium
bun run lighthouse https://curiousgeorge.dev/
```

The first command runs the 250KB image gate (at 1× and 3×) on the real `/photos` and the privacy check on the gallery and a photograph's page; both only read, and send Global Privacy Control so they aren't counted as visits. The second reads largest contentful paint and layout shift on `/`, `/photos` and the newest photograph's page. The full launch list is section 12 of the spec; what the build left open is in [the plan 6 follow-ups](superpowers/plans/2026-10-08-plan-6-followups.md).

## Tests

- Unit (Vitest, `node:sqlite` over the real migrations): the entry mode and its cursor, the post join, publication all or nothing at a concurrency of ten, owner actions, code and session expiry, request limits, delivery failure, revocation, reapproval, private downloads and supplier grants. Real local D1 tests exercise concurrent code consumption and cooldown acquisition. Preparation and import checks use synthetic photos and recorded geocoding.
- End to end (Playwright): the gallery with and without JavaScript, photograph pages, approved email-code sign-in, session expiry and sign-out, owner approval and revocation, privacy, budgets and layout shift. The HTTPS access server (4341) tests the actual Secure cookie flow with synthetic mail; the gallery (4335) and admin (4333) retain separate seeded stores. Every fixture pins its signing key (ADR-0024).
- Integrated local acceptance on 14 October 2026 passed 1190 unit tests and 40 targeted browser checks across Chromium, WebKit and phone projects. Fourteen backend HTTP checks intentionally run once rather than repeating across browser engines. Required release CI remains a separate gate.
