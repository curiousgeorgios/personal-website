# Plan 6 follow-ups

What plan 6 (the photo gallery) found or left for later: the launch steps, what was never run for real, what the reviews deferred and what plan B can rely on.

## Launch (George's)

In this order. The first matters most: `wrangler.jsonc` binds the photo bucket, so a deploy without it fails.

1. Create the `curiousgeorge-photo-prints` R2 bucket before this branch deploys (`bunx wrangler r2 bucket create curiousgeorge-photo-prints --location oc`). Confirm it has no `r2.dev` URL and no custom domain.
2. Apply migration 0006 with `wrangler d1 migrations apply` (`bun run db:migrate:remote`), never `d1 execute --file`. The deploy job runs it before it deploys the Worker.
3. Set `PHOTO_LINK_SECRET` (64 lowercase hex characters, fresh, not the local one): `bunx wrangler secret put PHOTO_LINK_SECRET`. Without it the downloads page answers 503.
4. From the Mac, under Node 24, run `bun run photos:prepare` and then `bun run photos:import --remote`. The manifest is now version 2, so a folder prepared before this plan needs `photos:prepare` again (checkpoints and the places cache are reused). Fill `scripts/photo-cities.json` wherever prepare stops and lists a missing key.
5. In `/admin`, review every post (places included) and publish what should be public, looking hardest at the 96 RAW candidates, which carry `raw` pills.
6. Issue the first catalogue link from `/admin` and open it on a phone.
7. Post-publish check (agent or George), once step 5 has published something: `PLAYWRIGHT_BASE_URL=https://curiousgeorge.dev bunx playwright test tests/e2e/budgets.spec.ts tests/e2e/privacy.spec.ts -g "images before any scroll|photo pages" --project=chromium`, then `bun run lighthouse https://curiousgeorge.dev/`. The deploy job's privacy test and Lighthouse run happened before anything was public, and Lighthouse doesn't weigh images, so this is the first measurement of the real photographs against the 250KB gate and the first privacy check that follows a real frame.

After launch: confirm the first catalogue link's download works and that production Workers Logs hold no `token=` (the config redacts query strings, and only a deploy can show it).

Locally, before launch, the Lighthouse run on the fixture servers gave largest contentful paint medians over the 1.5s warning line (home 1436ms, `/photos` 1671ms, a photograph's page 1507ms; layout shift 0 on all three). That is `wrangler dev` with no edge cache under simulated slow 4G, so it is a reading to compare with, not a finding; the run against the live site is the one that counts.

## Never run for real

- `scripts/photo-place.swift` compiles and its not-found path (exit 0 with `null`) and its throttled or server-failure path (exit 75) are covered by tests that stand in for the tool, but neither has run against MapKit: that needs a coordinate with no result or a network fault. The first real prepare is their first live run. If one misbehaves, the symptom is a post with no place (`no place for …`, set in `/admin`) or a prepare that stops asking to be rerun; neither loses work.
- The clipboard fallback on the links screen (select the field's text when the clipboard is refused) was checked in Chromium only. `setSelectionRange` is there for iOS Safari, which ignores `select()` on an input, and has not been tried on a real iPhone.
- The ten neighbouring council keys in `scripts/photo-cities.json` (Woollahra, Randwick, Inner West, North Sydney, Mosman, Northern Beaches, Bayside, City of Canada Bay, City of Parramatta and Sutherland Shire) use official names but were not checked against the geocoder; only `Council of the City of Sydney` was. A wrong key shows up as prepare stopping with the key Apple actually returned, to add once.
- Every photo-page and gallery visual check was made on the fixture. Real photographs (portraits at the 82svh cap, posts of 20 frames) are first seen after the import.

## The RAW review queue

96 photographs have no Photos edit, so prepare rendered their RAW originals through Core Image. A rendered RAW is a candidate edit, not proof that its colour or crop matches the Instagram post. Each carries `raw_review` (from the manifest's `needsRawReview`) and a `raw` pill beside its post in `/admin`. Nothing publishes automatically. The queue is a read-through: compare each against the Instagram original and publish, or hide and re-edit in Photos and prepare again (a changed master stays unpublished). The admin has no filter for these; the pill is the only marker. If the queue is awkward to work through, a `raw only` view is the cheap follow-up.

## Deferred by reviews

Product and design:

- The infinite-load script gives no spoken or visible cue when a batch arrives (`n entries loaded`); that is a copy decision.
- The older-entries observer also starts on scroll events with no input behind them, such as scroll restoration; the visitor had scrolled before, so the cost is one early batch.
- ArrowLeft and ArrowRight do not start the observer, because they do not scroll the page.
- A photograph's page wraps its `previous · next` line on a phone, which can leave a leading `·` on the second line; hiding it needs extra markup. The line is a `<p>`, not a labelled `<nav>`, and a titled photograph's alt text repeats its `<h1>`.
- Thumbnails are a little soft on 3× phones, by design (ADR-0023). If George dislikes it, the trade is 480 previews on phones against the image budget, and four entries become two screens of images.
- The repeat notice on the links screen says the link is in the list below even if it has since been revoked or expired. A double tap without JavaScript shows that notice and never the link; the hint tells George to revoke and reissue.
- `og:image` is the 1600 WebP; a few link-preview services do not read WebP and show no image (spec 4).

Admin:

- The photographs section renders a few small forms per photograph, so the page grows to a few hundred KB of HTML for the whole selection (462 photographs). Fine for one owner on a phone with the images lazy inside closed `<details>`, but worth paging if the selection passes a thousand. Check its weight after the real import.
- The admin's length caps (titles and the other fields) count UTF-16 units, so an emoji counts double and a cap reads slightly stricter than it says.
- The form ids `post-<collection>-place` could collide if two Instagram collections differed only by a `-place` suffix; real identifiers do not.
- Publishing parses each photograph's `previews` column; a corrupt row in the publish path throws (a 503) rather than a 409. The admin list already treats a non-list column as no thumbnail.
- `/admin` is the only place a place is edited. The import never overwrites an edited place, and a lasting lookup failure keeps an existing unedited one.

Places:

- `photo-place.swift` reads names from MapKit's deprecated `placemark`, the only MapKit object that carries the suburb, council and state code the city map needs. If Apple removes it, the tool needs MapKit's `address` fields and the city map a key built from them.
- Prepare compiles the Swift tool on every run on macOS, and fails off macOS unless `PHOTO_PLACE_TOOL` points at a stand-in, even when no photograph has GPS.
- Points of interest are stripped from the area (a photograph at the Opera House reads `sydney`, not a landmark), so a famous place gets a plain suburb or none. That is the rule (ADR-0022), not a gap.

Privacy and security:

- Hiding a photograph makes its previews unavailable to anyone new (the media route checks publication in D1, and a hide purges the photograph's `photo-<id>` tag), but copies already in a visitor's browser cache, saved by someone or held by an image search index can't be recalled. A preview key with an older master's SHA (a re-imported, changed master) is still served while the photograph is published; nothing deletes old preview objects from R2 yet.
- `robots.txt` disallows `/photos/downloads`, which stops crawlers from reading the page's `noindex`. The spec mandates both; the page is also unlinked, private and 403 to anyone without a token.
- The 403 page answers a few milliseconds faster for tokens that fail before the grant lookup than for those that reach it. Only a holder of a token signed with the real key can see the difference, and it tells them nothing they do not know.
- The 503 path of the downloads page is covered by a unit test through the Astro container, not by an end-to-end run.

Test infrastructure:

- The gallery fixture is four frames in the first two entries, about 28KB before any scroll. The 198KB reading came from a throwaway store with the real catalogue's shape (two entries, 36 frames, noise tuned to real bytes per pixel). Run locally, the committed gate therefore proves the 240-only phone rule and the 250KB ceiling, not the real total. The same test measures the real total when `PLAYWRIGHT_BASE_URL` points at the live site, which is launch step 7 (Lighthouse doesn't weigh images, so it can't stand in).
- Local runs have no cache purge, so local checks of the gallery after an admin save use a fresh query string.
- A load-dependent flake: the 4× CPU interaction specs in `perf.spec.ts` (`pressing play` twice in partial runs, `showing older log entries` once in the full `bun run check`) failed when run in parallel with other specs and passed on their own every time, including a single-worker run of the whole file. They measure logbook interactions the photo work did not touch, so this is the plan 5 class of flake (CPU contention against a 4× throttle). Rerun the file alone.
- Any photograph already imported into George's main local store (`.wrangler/state`) before migration 0006 has no post row, so the public API hides it there until he imports again with the version 2 manifest.
- The CI deploy's zone purge now names `logbook` and `photos`. As ADR-0010 explains, the zone purge does not touch Workers Caching, whose entries are keyed by Worker version, so it is a belt for zone-level caches rather than the mechanism that keeps the gallery fresh across deploys.

## For plan B

Ready from plan 6 (spec 13.1): `photo_posts` with dates and places and the public `date` and `place`; the 240 and 480 previews; `photoName` in `src/lib/photos/gallery.ts`; `/photos/<id>`'s rows, into which the `prints` row goes between `photo` and `say hi`; Notebook's `noindex` and `referrer`; `isPrivatePath` in `src/lib/photos/http.ts` for `/prints/`; `setPublished`; `purgeTags` and the `PURGES` map for the orders section; `insertGrant`'s note and nonce beside the order grant.

Two guards plan B inherits: the admin and JSON revoke routes switch off catalogue links only (`revokeCatalogueLink`, `photo_id IS NULL`), so a print order's photo-scoped grant is revoked only by plan B's own code; and `downloadPhoto` still honours photo-scoped grants, which nothing issues until order grants exist.
