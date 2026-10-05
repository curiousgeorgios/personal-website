# curiousgeorge.dev redesign: the logbook

- Date: 2026-10-03
- Owner: George Vlachos
- Status: Design agreed in brainstorming, revised after critical review; ready for an implementation plan
- Decisions: [ADR-0001](../../adr/0001-logbook-direction-with-wall-labels.md) to [ADR-0016](../../adr/0016-admin-worker-checks-the-signed-in-email.md)
- Agreed prototype: [docs/prototypes/2026-10-03-logbook/](../../prototypes/2026-10-03-logbook/) (`logbook.html`, `turntable.js` and two screenshots). It is the visual and behavioural reference. Its asset paths (`/files/...`) pointed at the brainstorming server and will not resolve standalone. Section 5.6 lists prototype bugs that must not be ported.

## 1. Intent

George's brief: the site "should feel like you've briefly left the rest of the internet", "really feel like me" and carry his values. The values it has to show, drawn from his own words and work:

- Plain English ("grade 5 level simplicity").
- Craft shown before it's stated.
- Never invent a number or a claim; every claim on the page is true.
- Humans first: software does the hard part so people can get back to the human part.
- Generosity to community (canberra.events, R4R, WITH-ME, linear.gratis).
- Owning mistakes in public.

"Left the internet" is achieved mostly by absence: no cookie banner, no pop-ups, no autoplay, no tracking pixel, no feed, no scroll-triggered animation. Nothing moves unless the visitor causes it.

### Success criteria

- Someone who has met George over a coffee lands on the page and recognises him.
- The page passes George's own bar: nothing that looks vibe coded, copy that passes the `george-voice` rules, motion that follows the rules in `~/.claude/CLAUDE.md` and the family-values skill.
- Every statement in the visitor info block is literally true, verified by the privacy smoke test in section 14.
- The performance budgets in section 11 are met on the deployed site.

### Non-goals for v1

- Dark mode. The page declares `color-scheme: light`.
- Writing, blog or multi-page content.
- Telegram or other update channels besides `/admin`.
- Comments, newsletter, contact forms.

## 2. Page structure

One page, `/`, laid out as a field notebook (see `logbook-top.png`). A left margin column holds lowercase DM Mono labels; a red margin rule separates it from the content column. On screens under 680px the labels move above their content and the rule stays on the left edge.

Sections, in order. A section whose data is empty is not rendered at all.

| Margin label | Content | Source |
|---|---|---|
| `logbook of` | `george vlachos`, one-line intro, `sydney · <live Sydney time> · last entry <date of latest log entry>` (the `· last entry` part is omitted when there are no entries) | Static intro; time is client-side; date from D1 |
| `now` (red dot) | Current things, one per line, with links. Lines George made carry a label pill (section 4.1) | D1 `items` where `section = 'now'` |
| `lately` | Two facts side by side: `on the shelf`, `in the kettle` | D1 `facts` |
| `log` | Dated one-line entries, newest first. Three visible, the rest behind `older entries` (no toggle when there are three or fewer). At most 50 rendered | D1 `log_entries` |
| `on the turntable` | The listening corner: 3D console scene, crate control, track list, hint line (section 5). With no active records: no scene, just the line `nothing on the turntable right now.` | D1 `records`, R2 media |
| `before` | Earlier work, one per line; onestack.cloud carries a label | D1 `items` where `section = 'before'` |
| `say hi` | Email, LinkedIn, Telegram, Instagram | Static |
| `visitor info` | `open: whenever you are`, `entry: free`, `cookies: none. nothing to accept.`, `analytics: anonymous counts of visits and clicks, no cookies`, `based: sydney and canberra`, then the sign-off `fewer tabs, more arvos.` | Static |

Copy is lowercase throughout and follows the `george-voice` rules (spaced hyphen " - " as the dash, no em dashes, no Oxford comma, Australian spelling, no invented claims).

The Sydney clock reserves its width (`display: inline-block; min-width: 8ch; font-variant-numeric: tabular-nums`, since "12:59 pm" is 8 characters in DM Mono) and shows `–` until the script fills it in, so nothing shifts.

## 3. Visual system

Tokens (from the agreed prototype, with `--muted` darkened to pass contrast):

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f3f2ec` | Page background, `theme-color` |
| `--dot` | `rgba(31,32,28,.075)` | 1px dot grid every 24px |
| `--ink` | `#1f201c` | Text |
| `--muted` | `#6b6b63` | Secondary text, margin labels (4.79:1 on paper) |
| `--faint` | `#b4b3aa` | Link underlines at rest (decorative only, never text) |
| `--rule` | `#dddcd3` | Hairlines |
| `--red` | `#c94a31` | Margin rule (62% mix), now dot, live dot, link hover, play icon |
| `--mat` | `#fbfbf8` | Picture mats, pills, hover cards |

Type: Schibsted Grotesk for text (17px base, 1.55 line height; h1 clamp 30 to 40px, weight 500), DM Mono 400 for labels, dates and controls (11.5 to 12.5px). Only weights 400 and 500; no italics as accents, no gradients, no emoji, no glassmorphism.

Fonts are self-hosted woff2: Schibsted Grotesk as one variable file limited to the 400 to 500 weight range and DM Mono 400. Both are subset to printable ASCII, all of Latin-1 (so names typed in `/admin`, like "Lépi", never fall back to Arial) and the symbols the page uses (`‹ › · – — ‘ ’ “ ” … ×`), preloaded, `font-display: swap` with metric-matched fallbacks. DM Mono has no arrow glyphs, so chevrons are drawn in CSS.

Layout: book width 940px max, 24px side gutter, margin column 150px, 40px gap either side of the rule.

## 4. Logbook interactions

### 4.1 Wall labels (ADR-0001)

- A line that has a label shows an outlined pill (`+ label`, DM Mono 11.5px) after its text, with an accessible name that names the line (`label for canberra.events`). The whole line is the click target; links inside it still navigate.
- Hover (fine pointers only, 90ms intent delay): the pill darkens and a 232px preview card grows out of the pill (origin bottom centre, 200ms ease-out, opacity 140ms). The card shows the snapshot and `click for the label`. It stays up while the pointer moves onto it (WCAG 1.4.13), and a click on it opens the label. No hover card is rendered on touch devices or when the item has no snapshot yet.
- Click: the label opens in place below the line (grid rows 0fr to 1fr, 300ms ease-out-quint); the pill's plus rotates 45 degrees to a cross. Contents: framed snapshot (left, 240px; omitted when there is no snapshot or the image fails to load) and the tag: a status line (`live and in use · <era>` with a red dot, or `retired · <era>`), `made of …`, the label text, then a hairline and `the decision` or `the lesson` with George's sentence. Several labels may be open at once.
- Snapshot click: "closer look", a modal dialog. The image grows from its frame to fit the viewport (FLIP, 420ms ease-out-quint) over a paper veil; focus moves into the dialog; click, the close button or Esc returns it into its frame (300ms ease-out) and focus returns to the frame. Esc closes the closer look first, then the label that has focus. The frame is a link to the 1920px WebP, so without JavaScript it opens the big picture.
- Images load on first hover or first open, never up front. Without JavaScript browsers ignore lazy loading, so the framed snapshots come with the page.
- Without JavaScript, label contents and older log entries use `hidden="until-found"` so they remain reachable by find-in-page, and the page is otherwise complete.

### 4.2 Log

Three entries visible; `↓ older entries` expands the rest in place (280ms ease-out) and becomes `↑ fewer entries`. Dates show `03.10.26` for day precision and `oct 26` for month precision.

### 4.3 Motion rules (all interactions)

From `~/.claude/CLAUDE.md` and the family-values skill: ease-out by default, most transitions 200 to 300ms, nothing over 1s except the illustrative record journey, hover transitions 200ms `ease` and only under `(hover: hover) and (pointer: fine)`, transforms removed under `prefers-reduced-motion`, nothing animates on scroll or on load, icons morph rather than swap.

## 5. Listening corner (ADR-0005, ADR-0006)

### 5.1 Structure

Two modules, so playback never depends on WebGL:

- **Deck runner** (small, no Three.js dependency, loaded with the page scripts): owns `want`, `current` and `browsed`, the 450ms double-press guard, the shared audio element and Web Audio graph, the live region and the track list. It runs journeys as a sequence of steps; when no scene is attached, every step completes instantly.
- **Scene** (Three.js, a separate chunk): subscribes to the runner, renders the console and turns each step into motion. If it fails to load, WebGL is unavailable or the WebGL context is lost, the poster stays (or returns) and the runner keeps working from the list and the crate control.

### 5.2 Scene

- Plain Three.js (no React Three Fiber, no Spline), bundled from npm, pinned to the 0.169 line the prototype was signed off on (later releases rework shadows; upgrading needs a visual sign-off).
- Loading: after the window `load` event and an idle callback, when the row is within 200px of the viewport. Until then, and whenever the scene is unavailable, the row shows a pre-rendered poster at the same size so nothing shifts. The canvas replaces the poster with no fade.
- Texture generation (walnut and grooves on seeded canvases) runs in idle chunks, and shaders compile with `renderer.compileAsync` before the first frame, so no scene task blocks the main thread for more than 50ms (section 11).
- Objects: low walnut record console with tapered, splayed legs and an open shelf; the rest of the collection on edge on the shelf as one `InstancedMesh`; stoneware jug on the shelf; sheepskin under the console (20 alpha-tested fur shells over an irregular pelt outline); walnut-framed turntable with brushed deck plate, aluminium platter, charcoal felt mat, tonearm, start button and red play lamp; walnut crate on the console holding the records upright; pillar candle in a stoneware dish with a warm point light and glow sprite.
- Covers are 512px WebP textures.
- Light follows the time in Sydney: daylight, golden hour (16:00 to 19:00), night light from 19:00 to 06:00 with a brighter candle.
- Rendering is on demand: a frame is drawn only while something is moving or the platter spins, and never while the row is off screen. While only spinning, frames are capped at 30fps. Device pixel ratio is capped at 2 (1.5 on coarse pointers). The candle flickers only during those frames.
- Framing: the camera fits a set of points to the canvas by binary search, so any aspect works.
  - Desktop: the whole console, shelf and rug, canvas aspect 16:10.8 within the content column.
  - Phones (under 680px): the canvas is full-bleed (viewport width) and the frame is cropped to the console top (turntable, candle and crate), with the shelf and rug only peeking in at the bottom. Acceptance at 375px wide: the cover is at least 90px tall on screen and the crate control sits fully inside the canvas. Measured at about 95px (crop x -3.35 to 6.25, y -0.9 to 3.4, view direction (0, 0.45, 1), canvas 375 × 320), so the crate stays beside the turntable.
- Posters: two WebP stills (desktop and phone framing), each under 60KB, rendered in daylight with no record on the platter and an empty crate (so they stay true whatever records /admin adds) by a Playwright script (`bun run poster`) that runs locally with WebGL and commits the output. Rerun it whenever the scene changes.

### 5.3 Playback

- One runner owns every record movement. Input only sets `want`; the runner loops `while (current !== want)`, unloading then loading one step at a time, and re-checks `want` after every step. Every journey starts by re-parenting the record into world space.
- Load: flip the crate to the record if needed, lift the sleeve 0.95 units, slide the record out sideways, drop the sleeve, fly the record in an arc while it turns from standing to flat, lower it onto the platter and attach it, spin up to 33⅓ rpm (2π × 100/3 ÷ 60 rad/s, eased), swing the arm in, drop the stylus, light the play lamp, start audio with a 500ms gain fade-in. If `want` changes at any point before audio starts, no audio plays and the runner takes the record back.
- Unload is the exact reverse.
- Audio: one shared `<audio>` element routed through a Web Audio `GainNode` (fades use the gain, which also works on iOS where `volume` is ignored). The press handler unlocks it synchronously (resume the `AudioContext` and prime the element inside the gesture), because WebKit only allows playback that starts within a user gesture and the journey takes about 2.5s. The element's `src` is swapped when a record lands. Media is same-origin under `/media/`.
- Failure: if audio fails to load, decode or play, the runner sets `want = null`, the record returns to the crate and the list row shows `couldn't play` for a few seconds.
- When a track ends, the record goes back to the crate.
- A polite live region announces `now playing <title>` and `stopped`.
- Reduced motion: every journey is instant (no travel, no spin); audio still plays.

### 5.4 Choosing records

- Crate: holds up to 6 active records (admin validation enforces the cap; records are spaced to fit the crate whatever the count). One cover is visible at a time; record `j` tilts to `0.72 - 0.07·j` rad when in front of the browsed record and `-(0.1 + 0.012·(j - browsed))` rad when it is the browsed record or behind it, pivoting on its bottom edge.
- Crate control: an HTML pill anchored under the crate on the console's front edge: `‹ ▶ title ›`.
  - Fixed geometry: three columns (32px, `min(12.5rem, canvas width - 70px)`, 32px), clamped to stay inside the canvas. The label is always the title (ellipsis if needed, full title in `title` and the accessible name). State is shown by the icon morphing play to stop (clip-path, 200ms) and dimming while a record travels.
  - Arrows are `aria-disabled` (not `disabled`, so focus stays put) at either end and while a record travels. With one record both arrows are disabled. Left and right arrow keys flip when the control has focus. Pressing a button shades it; nothing scales.
  - Without the scene (poster showing), the control is not shown; the list is the interface.
- 3D input: clicking the visible cover or anywhere on the crate plays (or stops if it is playing); clicking a record in front of or behind it flips one step. Hover previews the click (the cover lifts, the current record starts to tip or the nearest tipped record starts to rise) and highlights the matching control button.
- Track list under the scene: one row per active record (`<side> <title> - <artist>` and a state: `play`, `cueing` or `playing · stop`). Sides are derived from position (a1, a2, b1, b2, c1, c2). Hover or focus flips the crate to that record; a red `›` marks the record in view while the scene is attached; click plays or stops. The row shows `cueing` from the moment it is pressed, including while the scene chunk is still loading.
- Hint line: `flip through the crate with ‹ ›, or pick a track. nothing plays until you do.`
- Rapid input: a second press on the same record within 450ms is ignored (a double-click plays once); flips use keyed tweens so fast repeated flips retarget instead of stacking; flips requested during a journey apply when the runner is idle.
- Easter egg (mouse and pen; touch keeps scrolling the page): dragging the spinning record more than 6px scratches it. The platter follows the pointer around its centre and the playback rate follows the angular speed (clamped 0.25 to 2.5 so Firefox never mutes, `preservesPitch` off). Release spins back up and eases the rate back to 1 over 420ms; the click that follows a scratch is suppressed. A plain click on the record stops it.

### 5.5 Regression suite

The behaviour checks run during brainstorming become Playwright tests against the built page, run in Chromium and WebKit. A test-only hook exposes state and screen positions; it is compiled out of production builds.

- Play; two different records within 150ms ends with only the second on the platter, centred; the same record twice within 450ms plays once; mashing four records ends on the last; changing mind mid-flight twice; browsing while playing; stopping from a flipped crate.
- Five quick next presses clamp at the last record with exact final tilts; arrows are disabled while travelling; hover highlights the control; the crate control has one geometry across every state.
- Scratch bends the rate and moves the platter; releasing a scratch keeps playing and restores the rate; a plain click on the spinning record stops it.
- New: stopping from the list while the canvas is scrolled off screen pauses audio; playing from the list while off screen starts audio; a press during the scene chunk download mounts exactly one scene; with WebGL disabled the list plays and stops every record; a failing audio file returns the record and shows `couldn't play`.
- Every check also asserts all sleeves end seated in the crate.

### 5.6 Prototype bugs not to port

- Tweens only advanced inside the render loop, so playback stalled while the canvas was off screen (fixed by the runner design in 5.1: steps complete on a timer or instantly when there is no visible scene).
- `audio.play()` ran 2.5s after the gesture and fades used `audio.volume` (fixed in 5.3).
- `boot()` could mount the scene twice (memoise the boot promise).
- The list depended on the scene, so there was no no-WebGL path (fixed in 5.1).
- The 600px loading margin meant Three.js loaded with the page (fixed in 5.2).
- Do not port `.player`, `.pp`, `.bar`, the `.mk` mockup navigation or `window.__tt`.

## 6. Architecture (ADR-0007)

- Astro 7 with `@astrojs/cloudflare` 14, `output: "server"`, deployed as a Cloudflare Worker with static assets (`main: "@astrojs/cloudflare/entrypoints/server"`, assets from `./dist`). Package manager: bun. Verified in a probe build on 2026-10-03.
- Interactivity uses Astro page scripts (bundled vanilla TypeScript, no UI framework and no `client:*` components): labels, log toggle, Sydney clock, analytics beacon, deck runner and track list plus the dynamically imported scene.
- Bindings are read with `import { env } from "cloudflare:workers"`; background work uses `Astro.locals.cfContext.waitUntil`; request metadata comes from `Astro.request.cf`.
- Sessions are off (`session: false`), so Astro never sets a cookie or provisions a KV namespace.
- Styles: plain CSS with the tokens in section 3, scoped per component. No Tailwind.
- Admin writes are plain form POSTs under `/admin/`. No Astro Actions (they post outside the Access path).

### 6.1 Edge caching of `/`

Astro 7 route caching with the Cloudflare provider (`cache: { provider: cacheCloudflare() }` from `@astrojs/cloudflare/cache`), which turns on Cloudflare's Worker cache in front of the Worker:

- `/` calls `Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["logbook"] })`. Responses carry `Cloudflare-CDN-Cache-Control` and a `Cache-Tag`, so visitors are served from Cloudflare's cache and stale copies are refreshed in the background. Every deploy also purges the `logbook` tag from CI (ADR-0010), so edge-cached HTML never points at a hashed file the new deploy removed. A failed purge is the one case where a stale page can, until it's purged by hand or refreshed after a visit (ADR-0010).
- Stylesheets are always inlined (`build.inlineStylesheets: "always"`), so a cached page never references a hashed file that a later deploy removed.
- Admin writes call `context.cache.invalidate({ tags: ["logbook"] })`, which purges the tag globally, so changes show on the next visit everywhere. If the purge fails (a local Worker has none), the save still stands and the admin page says the logbook may show the old version for a little while (the edge serves the cached page stale while it refreshes).
- D1 is read once per render with a single `DB.batch()`. The D1 database is created with location hint `oc`.
- If the D1 read fails, the page renders the static sections only, sets no cache hint and sends `Cache-Control: no-store`, so the degraded render is never cached; any cached copy keeps being served until it is replaced.
- Cache keys include the query string, so `/ig` visits carrying UTM parameters or `fbclid` are cached per URL. That is acceptable at this site's traffic; each new variant costs one D1 read.
- Every response that must not be cached (`/admin*`, `/ingest/*`, `/media/*` errors, 404s, degraded renders) sends `Cache-Control: no-store` explicitly.

### 6.2 Routes

| Route | Behaviour |
|---|---|
| `/` | The logbook, cached as in 6.1 |
| `/admin` and `/admin/*` | Admin page and its POST handlers (section 7). `Cache-Control: no-store`, `X-Robots-Tag: noindex` |
| `/media/<key>` | Streams R2 objects under allowlisted prefixes (`audio/`, `covers/`, `snapshots/`) with the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Accept-Ranges` and `Range` support, `Cache-Control: public, max-age=31536000, immutable` (keys are unique and never reused) |
| `/ig` | 302 to `/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link` |
| `/ingest/i/v0/e/` | Analytics proxy (section 10). POST only, body capped at 32KB, everything else under `/ingest` returns 404 |
| `/jobs/video-editor` | 301 to `/` (retired) |
| `/robots.txt` | Allows everything except `/admin` |
| anything else | Notebook-style 404 (`nothing written on this page.` and a link home) with status 404 and `no-store` |

Every HTML response carries the security headers in section 12.1.

## 7. Admin (ADR-0004)

- Cloudflare Access application on `/admin*` (George's identity only), with the Access cookie set to SameSite Lax or Strict.
- The Worker verifies `Cf-Access-Jwt-Assertion` on every admin request with `jose` (`createRemoteJWKSet` and `jwtVerify`), checking the signature, `aud` (the Access application's AUD tag) and `iss` (the team domain). It then requires the token's `email` to equal the `ADMIN_EMAIL` var (`hello@curiousgeorge.dev`), ignoring case, so `/admin` stays closed if the Access policy is ever loosened (ADR-0016). It returns 403 otherwise.
- Local and test runs bypass verification only through a build-time constant that production builds cannot contain; the production build fails if it is set.
- Both Workers set `workers_dev: false` and `preview_urls: false`. The snapshots Worker has no public route.
- One plain server-rendered page with forms (no client framework), in the logbook's type and tokens, usable on a phone:
  - **Now and before:** add, edit, reorder, remove lines. Fields: text (plain text plus links written as `[link text](https://…)` or `[link text](mailto:…)`, rendered escaped), aside, slug (unique, used for analytics and element ids). Optional label fields: era, status (`live` or `retired`), made of, label text, kind (`decision` or `lesson`), note, snapshot URL (the page to capture).
  - **Log:** add, edit, delete entries (date, day or month precision, text).
  - **Lately:** shelf (title, author) and kettle (title, note). Saving both fields empty hides that half of the row.
  - **Records:** add (title, artist, mp3 up to 15MB, cover as JPEG, PNG or WebP up to 10MB), edit title and artist, reorder, deactivate, activate and delete (with their files). At most 6 active. Uploads go to R2 under random unique keys (`audio/<ulid>.mp3`, `covers/<ulid>.webp`); covers are converted to a 512px square WebP under 40KB with the Images binding. SVG and anything that fails type sniffing is rejected. A save that fails part way keeps nothing.
  - **Snapshots:** last capture time and status per line with a page to snapshot (the statuses are defined in `src/lib/snapshots.ts`), plus a "re-shoot now" button, which calls the snapshots Worker and waits for the capture (section 9). Changing a line's page to snapshot clears its old snapshot.
- Every write is a form POST to `/admin/` with an `intent`. Every request other than GET, HEAD or OPTIONS, anywhere on the site, needs an `Origin` header equal to the site origin; the middleware checks it (Astro's `checkOrigin` is off, so the 403 carries the security headers). Writes are validated server side (lengths, `https:` URLs, links the logbook can show, the record cap, sniffed file types). A failure re-renders the page with status 422 and the failed form open with its values and messages. A failure that belongs to no form on the page (a line, entry or record removed in another tab; an unrecognised action; an unknown fact; an unreadable form) shows its message in a banner at the top of the page instead; something unexpected (a throw) does the same with status 500. A success purges the `/` cache and redirects with 303, so a reload never repeats it. An identical repeat of an add (a double tap) counts as already saved (ADR-0012); so does removing something already removed and activating a record that's already active. A double-tapped move moves twice.

## 8. Data

D1 schema in numbered migrations under `migrations/`, applied with `wrangler d1 migrations apply`, never `execute --file`:

- `items`: `id`, `slug` (unique), `section` (`now` or `before`), `position`, `text`, `aside`, `label_era`, `label_status` (`live`, `retired` or null for no label), `label_made_of`, `label_text`, `label_kind` (`decision` or `lesson`), `label_note`, `snapshot_url`, `snapshot_key`, `snapshot_at`, `snapshot_status`, `updated_at`.
- `log_entries`: `id`, `date` (ISO; month precision stores the first of the month), `precision` (`day` or `month`), `text`, `created_at`. Sorted by `date` descending, then `created_at` descending.
- `facts`: `key` (`shelf` or `kettle`), `title`, `subtitle`, `updated_at`.
- `records`: `id`, `title`, `artist`, `audio_key`, `cover_key`, `position`, `active`, `created_at`. Side labels are derived from position.

Seed:

- A numbered seed migration with the current site's content and the prototype's lines. Lines that were Claude's guesses are listed on the launch checklist (section 13).
- The four prototype records (simple things, nyc in 1940, no bad feelings today, light it up) are seeded by the migration `0003_records.sql`, so local, CI and production D1 get them through `migrations apply`. Their MP3s and 512px WebP covers (made once from the MP3s' ID3 art with `music-metadata` and sharp by `bun run covers`) live in `media/`; `bun run seed:media --local` uploads them to the local R2 store and `--remote` to production. The MP3s left `public/`.

## 9. Snapshots (ADR-0002)

- A separate Worker, `curiousgeorge-snapshots`, in `workers/snapshots/`, with bindings for D1 (`DB`), R2 (`MEDIA`), Browser Rendering (`BROWSER`) and Images (`IMAGES`). Cron `0 17 * * *` (UTC), which is 03:00 in Sydney during standard time and 04:00 during daylight saving.
- For each item with a `snapshot_url`, it captures 1440 × 900 CSS px at device scale factor 2: navigate, wait for `load` plus a 1.5s quiet period and take the shot at a 15s cap even if the page never goes idle. Requests to known analytics hosts (PostHog, Google Analytics including `analytics.google.com` and `stats.g.doubleclick.net`, Google Tag Manager and Meta's `facebook.com` and `facebook.net`) and to `/ingest/` paths on any host (a first-party PostHog proxy like this site's) are blocked so the visit isn't counted on George's other sites.
- A capture fails only on a navigation error, a non-2xx status, a Cloudflare challenge (`cf-mitigated` header or the challenge page markup, not the JavaScript detections script an ordinary page may carry), a blank page (nothing visible: no text, images, video, canvas or frames) or an image under 10KB. A blank 2x shot weighs about 19KB, so the size floor alone never catches one. A failed capture keeps the previous snapshot and records `snapshot_status`; it never replaces a good image with a bad one. Failures are logged to Workers Logs. A capture that breaks instead (an Images, R2 or session error) records `error` on the same terms, so the admin page shows it; the error itself is in Workers Logs.
- Variants are precomputed with the Images binding and stored in R2 as AVIF and WebP: 480px wide (hover card and label), 960px (label on phones and high-density screens) and 1920px (closer look). Superseded objects are deleted after 7 days.
- The admin "re-shoot now" button calls the Worker through a service binding.
- Captures use `@cloudflare/puppeteer`. A capture's six files go under a fresh key, `snapshots/<slug>-<ulid>-<width>.<avif|webp>`, and the line points at the new base only if it still has the address that was captured; a line edited or removed meanwhile keeps what George saved and the new files are deleted (unless the database may have saved the update after all, in which case they wait for the clean-up). Each capture's files carry their line's id, so a renamed line keeps its old files for the week. Variants step their quality down until they fit their budget; one that never fits keeps its smallest try, with a warning in the logs.
- The nightly run captures every line in one browser session. A capture's files are deleted a week after the next capture of that line replaced them, however old they are, so a cached page that names them keeps working.
- "Re-shoot now" waits for the capture (up to about half a minute): a good one is a save; a failed one says why on its line and the line keeps its previous snapshot. A Worker that doesn't answer within 60s, and one that fails, each say so on the line.
- The whole pipeline is tested on a developer's machine: wrangler runs Browser Rendering and the Images binding locally, so both Workers capture a small fixture site in the end-to-end suite.

## 10. Analytics and privacy (ADR-0003)

- The Meta Pixel, `posthog-js` and `posthog-node` are removed.
- A first-party beacon of about 1KB posts PostHog capture events to `/ingest/i/v0/e/` using PostHog's cookieless server hash mode ("Cookieless server hash mode" enabled in the PostHog project settings):
  - `distinct_id: "$posthog_cookieless"` and property `$cookieless_mode: true`, so PostHog derives a daily unique visitor from a hash of IP, user agent and a salt that rotates daily. No visitor can be followed across days.
  - Properties: `$current_url`, `$host`, `$pathname`, `$referrer`, `$referring_domain`, `$raw_user_agent`, `$timezone`, `$session_id` (a UUIDv7 held in memory for the tab), UTM parameters, `$process_person_profile: false`.
  - Nothing is written to cookies, localStorage or sessionStorage.
- The proxy Worker:
  - forwards the visitor's IP to PostHog (`X-Forwarded-For` from `CF-Connecting-IP`) so the cookieless hash works; PostHog strips the IP before storing the event
  - adds `$geoip_country_code` from `request.cf.country`, because cookieless mode skips PostHog's GeoIP enrichment (country is the only location data sent)
  - strips `Cookie` from requests (so George's Access cookie never reaches PostHog) and `Set-Cookie` from responses.
- Events: `$pageview`, `label_opened` (item slug), `record_played` (record id), `scratch_found`. Nothing else.
- When the browser signals Global Privacy Control (`navigator.globalPrivacyControl`), the beacon sends nothing.
- Accepted consequences: no cross-day unique visitors, no PostHog bot detection (bot filtering uses `$raw_user_agent`), no city-level location. The visitor info line `analytics: anonymous counts of visits and clicks, no cookies` describes exactly this.
- Cloudflare zone settings required for `cookies: none` (and the CSP) to stay true: Bot Fight Mode off, no JavaScript detections or challenges, no rate-limiting rules that set `_cfuvid`, Web Analytics auto-inject off, Zaraz off, Email Address Obfuscation off (it rewrites the `mailto:` link) and Rocket Loader off (it rewrites scripts, breaking their CSP hashes).
- The PostHog project key is added by the proxy, from a Worker secret (`POSTHOG_KEY`, set with `wrangler secret put POSTHOG_KEY`); the host is a var (`POSTHOG_HOST`, `https://us.i.posthog.com`). The page carries neither, and the old `NEXT_PUBLIC_POSTHOG_*` variables are no longer used. Without a key (local and test runs) the proxy drops what it accepts.
- The proxy forwards only the four events above; anything else is refused with a 400 before it reaches PostHog. It sets `distinct_id`, `$cookieless_mode` and `$process_person_profile` itself and drops any `$ip` property.
- The beacon sends a plain-text JSON body with `sendBeacon` (no preflight), falling back to `fetch` with `keepalive`. Scripts announce events as a DOM event (`logbook:track`), so the label script, the deck runner and the scene share no code with the beacon.
- The beacon sends the page's address as its origin, path and `utm_*` parameters only, and the referrer as its origin only, because any other part of a URL can carry an identifier (ADR-0013).
- Checks against the live site send no events: the post-deploy privacy and media checks run under Global Privacy Control, the privacy check tests the proxy with an event it refuses; Lighthouse's post-deploy runs block `/ingest`.

## 11. Performance budgets

Largest contentful paint is measured with Lighthouse (mobile preset: simulated 4G, 4× CPU; median of five runs) against the deployed site after every deploy, with a warning when it's over budget. Interaction to next paint is checked on every run in Playwright at 4× CPU, with the Event Timing API (Lighthouse's navigation mode doesn't report it), for opening a label, showing older log entries and opening the closer look (pressing play is reported, at about 200ms at 4× CPU, not gated, until the deck builds its audio context before the first press). Layout shift is checked on every run at desktop and phone widths.

- JavaScript before any interaction: under 10KB gzipped total (page scripts and the deck runner), no framework runtime.
- HTML for `/`: under 30KB gzipped. CSS: under 15KB gzipped.
- Fonts: two woff2 files under 60KB total, preloaded.
- Largest contentful paint under 1.5s; cumulative layout shift under 0.01; interaction to next paint under 200ms.
- Scene chunk (Three.js plus scene code, loaded after `load` and only near the row): measured and recorded at build; target under 190KB gzipped. No scene task over 50ms at 4× CPU throttle, measured locally with `SCENE_PERF=1` (CI renders WebGL in software, so it is reported there, not gated).
- Covers: 512px WebP under 40KB each. Posters: under 60KB each. Snapshots: 480px variant under 30KB, 960px under 70KB.
- Audio streams with range requests; nothing preloads.

## 12. Accessibility and security

### 12.1 Security headers

- `Content-Security-Policy`, sent by Astro as a response header (`security.csp`, which adds hashes for inline scripts and styles), with `default-src 'self'`, `img-src 'self' data: blob:`, `media-src 'self' blob:`, `connect-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, and `'self'` allowed for bundled scripts and styles.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera, microphone, geolocation and payment.
- Every request other than GET, HEAD or OPTIONS needs an `Origin` header equal to the site's own; anything else gets a 403 with these headers other than the CSP, which only rendered pages carry.

### 12.2 Accessibility

- `<html lang="en-AU">`. Semantic sections with headings (visually the margin labels), real buttons and links, `aria-expanded` and `aria-controls` (from the item slug) on label pills and the log toggle, `aria-pressed` on the track list, focus-visible outlines everywhere.
- The closer look is a modal dialog that takes and returns focus.
- Every listening-corner action is reachable by keyboard from the track list and the crate control. Only the `<canvas>` is `aria-hidden`; the crate control stays exposed. A polite live region announces playback changes.
- Colour contrast at least 4.5:1 for all text (`--muted` is set accordingly).
- `prefers-reduced-motion` removes transforms, journeys and spin as described above.

## 13. Migration and launch

Remove:

- The Next.js app (`app/`), OpenNext config (`open-next.config.ts`), `scripts/patch-worker.mjs`, `scripts/generate-audio-manifest.mjs`, `next.config.mjs`, `next-env.d.ts`, `components.json`, `tailwind.config.js`, `postcss.config.mjs`, `jsconfig.json`, `tsconfig.tsbuildinfo`.
- `styles/`, `app/globals.css`, `hooks/`, `lib/` (including `lib/posthog.ts`), all of `components/` (v0 and shadcn UI, `fancy`, `layout`, `sections`, `audio`, `MediaPlayer.tsx`, `theme-provider.tsx`, `MetaPixel.tsx`, `PostHogProvider.tsx`).
- framer-motion, `posthog-js`, `posthog-node` and every other unused dependency; `package-lock.json` (bun replaces npm).
- Committed junk: `app/.page.tsx.swp`, both `.DS_Store` files, the stale `public/audio/README.md`, unused placeholders.
- `linkedin-banner.html` moves to `docs/brand/` rather than being deleted.

Keep and fix:

- Favicons and `site.webmanifest` move into `public/` (they sit at the repo root today and are not served). The manifest gets the site name, `theme_color` and `background_color` of `#f3f2ec` and `display: browser`.
- SEO metadata: title `george vlachos`, a description in George's voice, canonical URL, Open Graph and Twitter tags with a 1200 × 630 image of the logbook, `theme-color` `#f3f2ec`.
- `.gitignore`: drop the Next.js, OpenNext and audio-manifest entries; keep `.superpowers/` and `.playwright-mcp/`; add Astro's `dist/` and `.astro/`.
- `wrangler.jsonc`: keep the Worker name `personal-website`; replace `main`, `assets` and `build`; bump `compatibility_date`; add the D1, R2, Images and service bindings and vars for the Access team domain, AUD and admin email. Enable Workers Logs on both Workers.

Deployment (ADR-0008): GitHub Actions on every push to `main` runs typecheck, unit tests, the build, Playwright (Chromium and WebKit), the budget check and the privacy smoke test; only if all pass does it run `wrangler d1 migrations apply DB --remote` and deploy both Workers. Workers Builds is disconnected so nothing deploys unchecked. Pull requests run the same checks without deploying. In CI, Playwright runs on one worker, because GitHub's runners draw WebGL in software and parallel workers break the timing checks (ADR-0009).

Launch checklist (only George can do these):

- [ ] The real "decision" or "lesson" sentence for each label (Digital Nachos, canberra.events, linear.gratis, onestack.cloud). The prototype's lines are placeholders.
- [ ] Confirm or rewrite the seeded log entries (dates and wording).
- [ ] Confirm the shelf and kettle entries.
- [ ] Confirm licences for the four lo-fi tracks.
- [ ] Confirm the intro line and `based: sydney and canberra`.
- [ ] Create the Cloudflare Access application for `/admin*` (George's identity only, as `hello@curiousgeorge.dev`, the address `ADMIN_EMAIL` names, cookie SameSite Lax or Strict and a session long enough for a phone: when it runs out, a save in progress is lost), then put its team domain (the host only, like `<team>.cloudflareaccess.com`, no `https://`) and AUD tag in `wrangler.jsonc` under `vars` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), not in the dashboard: each deploy replaces dashboard vars with the file's. Until both are set, `/admin` refuses everyone.
- [ ] Check the account can use the Images binding (the admin converts record covers with it).
- [ ] Check the account can use Browser Rendering (the nightly snapshots and "re-shoot now").
- [ ] Check the Workers plan suits a 15MB upload (`formData()` buffers the whole body; Workers Paid removes the doubt).
- [ ] Switch on "Cookieless server hash mode" in the PostHog project, then set the project key as a Worker secret: `bunx wrangler secret put POSTHOG_KEY`. Remove the old `NEXT_PUBLIC_POSTHOG_*` lines from your local `.env`.
- [ ] Apply the zone settings in section 10.
- [ ] Before the first deploy, create the D1 database (`bunx wrangler d1 create curiousgeorge-logbook --location oc`) and put its id in `wrangler.jsonc` and in `workers/snapshots/wrangler.jsonc`.
- [ ] Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub Actions secrets. Disconnect the Cloudflare dashboard's Git build of the old `personal-website` Worker ("Workers Builds"): it fails on every commit, and GitHub Actions deploys.
- [ ] Before the first deploy, create the R2 bucket (`bunx wrangler r2 bucket create curiousgeorge-media --location oc`) and upload the starting crate (`bun run seed:media --remote`); the deploy applies the records migration, whose rows point at those files.
- [ ] Add `CLOUDFLARE_ZONE_ID` to GitHub Actions secrets and give the API token the zone's Cache Purge permission (each deploy purges the cached home page, ADR-0010); after the first deploy, confirm a request to `/` straight after the purge is a cache miss (`cf-cache-status: MISS`).
- [ ] After the first deploy, open the site once and check PostHog shows the pageview with a country and that no cookie came back. Check that one event from iOS Safari arrives, and one from Firefox. Check that PostHog hashes the visitor's IP from `X-Forwarded-For`: two visits from different networks on the same day count as two visitors, and one visit reloaded counts as one.
- [ ] After the first real admin save, check `/` shows the change on the next visit (local runs only prove the purge's failure path).
- [ ] On the iPhone, save something after the Access session has expired, and check what happens (the page's `form-action 'self'` may block Access's sign-in redirect; if it does, add the team domain to `form-action` or note it in the follow-ups).
- [ ] After the first nightly run (17:00 UTC), check `/admin`'s snapshots section says "captured" for each line and the run's log has no session-closed errors after the first line, then re-shoot one. Time that "re-shoot now" against the deployed pair: browser launch, encoding and storing come on top of the 15s capture cap.
- [x] ADR-0001 to ADR-0016 are Accepted (signed off on 5 October 2026).
- [ ] Try the turntable on a real iPhone (once with the ringer switch on silent) and on Safari for macOS (Playwright's WebKit does not enforce the user-gesture rule for audio).

## 14. Testing

- Playwright (Chromium and WebKit, clock frozen with `page.clock` so the Sydney time and lighting are stable, fixed seed data, stubbed snapshot images): the listening corner suite (section 5.5); labels (open, close, Esc order, focus return, lazy image loading, no snapshot, broken snapshot); log toggle and empty states (no entries, three or fewer, no records); 404 status; redirects (`/ig`, `/jobs/video-editor`); visual checks at 375px and 1280px.
- Admin: Playwright against a local Worker on port 4333 with the build-time Access bypass and its own store (deleted and migrated afresh on every run), covering each form, the record cap, upload type rejection and the `Origin` check (in Chromium only, because the specs write; a read-only layout check also runs on the phone); unit tests for the Access token checks, validation and link parsing, the store (the real migrations on `node:sqlite`) and the actions (fake R2 and Images bindings).
- Snapshots Worker: unit tests with a fake browser page for success, a page that never goes quiet (shot at the cap), navigation errors, non-2xx statuses, challenge headers and pages and a blank image (each keeps the old snapshot), the variants' budgets, a line changed or removed mid-capture and the week-old clean-up; end to end, both Workers on a local server (port 4334) with local Browser Rendering and Images capture a fixture site (port 4400), nightly and through "re-shoot now".
- Analytics: unit tests for the proxy (the key, the country, the forwarded IP, no cookies either way, refusals, the size cap) and the beacon's event body; end to end, the pageview and the events the page sends, nothing under Global Privacy Control and the proxy's answers.
- Privacy smoke test against the built site and again after deploy: no `Set-Cookie` header on any response, `document.cookie === ""` and empty storage after interacting with everything, every request goes to the site's own origin and the `/ingest` proxy never forwards a `Cookie` header.
- Budgets: a script that builds, serves and measures the size budgets in section 11 and fails the run when one is exceeded; interaction to next paint and layout shift are checked in Playwright on every run, and largest contentful paint is a Lighthouse warning after each deploy.
