# Plan 7: print ordering implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone order prints of George's photographs that print well, several in one order: a `prints` row on a photograph's page, a basket kept in the URL, delivery quoted exactly for the buyer's address by Artelo's Price Check, payment on Stripe's hosted checkout with the quoted address fixed on the payment, one Artelo order per paid basket, a private order page, emails, an orders section in `/admin` and a cron that guarantees no paid order goes unnoticed.

**Architecture:** Migration 0007 adds the price list, the settings, the orders and their lines, the Stripe event ledger and the order grant column. Pure modules in `src/lib/prints/` hold the sizes and eligibility, the basket's query string, the address rules, the delivery arithmetic and the sealed quote; thin clients talk to Artelo and Stripe with `fetch` (no SDKs); stateful modules place orders, apply Stripe events, apply Artelo statuses and send mail, each driven by the database's state so the webhooks accelerate and the five-minute cron guarantees. `wrangler.jsonc`'s `main` becomes `src/worker.ts`, which exports Astro's `fetch` and the cron's `scheduled`. The pages stay server-rendered Astro with no script beyond the beacon; the basket and the order page are never cached.

**Tech Stack:** Astro 7.3.5 on Cloudflare Workers (`@astrojs/cloudflare` 14.3.3), D1, R2, Workers Rate Limiting, the `send_email` binding (Cloudflare Email Service), `jose` 6.2.12 for the photo links, Web Crypto HMAC-SHA256 for the quote seal, the view key and both webhook signatures, Stripe's REST API pinned to `2025-09-30.clover`, Artelo's open API, Vitest 5 with `node:sqlite` and `linkedom`, Playwright 1.63, wrangler 4.147, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md](../specs/2026-10-08-photo-gallery-and-prints-design.md), part 2 only (sections 13 to 25), with section 1.2's task order for plan B and section 13.1's dependencies on part 1, which plan 6 has built. It extends [the logbook redesign spec](../specs/2026-10-03-personal-site-redesign-design.md) ("R6.1" is its section 6.1). Decisions: [ADR-0021](../../adr/0021-prints-sold-on-site-through-artelo.md) as amended 2026-10-08 (the basket in the URL, address-first exact delivery through Price Check, destination taxes passed on in the delivery line, no paid invoice, the 8% buffer as a setting, sold by George without GST, worldwide), [ADR-0020](../../adr/0020-photo-downloads-use-revocable-signed-links.md) as amended (photo-scoped grants exist only inside print orders) and [ADR-0024](../../adr/0024-test-servers-never-hold-the-real-signing-key.md) (every test server passes the fixture signing key). Where plan 6 changed things the code wins over the spec: the gallery server took port 4335, so the prints servers are 4337 and 4338 (see "Decisions").

## Global constraints

- Copy is lowercase George-voice: Australian spelling, spaced hyphen ` - `, no em dashes, no Oxford comma, sentence case. This applies to every message, label, comment and doc line. UI strings the spec quotes are used exactly as quoted, including `prices include no gst; the seller isn't registered for gst.`
- Use bun, never npm. D1 migrations only through `wrangler d1 migrations apply` (`bun run db:migrate:local`, and the e2e servers' own `--persist-to` stores); `wrangler d1 execute --command` only reads or sets test data in local stores.
- Never run `wrangler deploy` (except `--dry-run`), any `--remote` command, `bun run prints:check --remote` or `bun run prints:webhook --remote`; never put a real secret in a task; never call live Stripe or live Artelo. Stripe runs in test mode only, with `STRIPE_TEST_SECRET_KEY` from the environment, and the one spec that uses it skips with an annotation without it. Artelo is the stand-in fixture server, `tests/fixtures/artelo-site.mjs` on port 4401, which also stands in for Stripe's API, the exchange rate and the mail binding.
- Every local server started from `dist/` passes `--var PHOTO_LINK_SECRET:` with the fixture key (64 ones, `PHOTO_KEY_VAR` in `playwright.config.ts`, ADR-0024) and, for the prints servers, the fixture print secrets and explicit print settings from `tests/e2e/prints-site.ts` (`printVars`), because `build:test` copies `.dev.vars` into `dist/server` and anything left unpinned would come from George's machine. Tasks never read `.dev.vars` and never run `photos:key` or `photos:link`.
- Money: amounts are AUD cents in D1 and in code; prices come only from `print_prices` (changed only by a migration); `delivery = ceil((arteloShipping + destination tax) × usd_aud × (1 + delivery_buffer))` whole dollars; the buffer is `print_settings.delivery_buffer`, seeded `0.08`, editable 0 to 0.20; Stripe is called with `fetch`, form-encoded, `Stripe-Version: 2025-09-30.clover` on every request, `adaptive_pricing[enabled]=false` on every session; Artelo is called with `Authorization: Bearer <ARTELO_API_KEY>` and a 15-second timeout.
- The money-path guarantees each have a test, named in the task that owns them: never charged without a tracked order (Tasks 7 and 10); each Stripe event applied once (Task 10); no duplicate Artelo orders (Task 9); the cron reconciling with Stripe before expiring (Task 10); Adaptive Pricing off (Tasks 7, 10 and 15); the sealed quote (Tasks 6 and 7); the address never stored or logged (Tasks 6, 7, 9 and 15).
- Privacy (spec 21): `cookies: none. nothing to accept.` stays literally true of the site and `tests/e2e/privacy.spec.ts`'s empty-storage assertion keeps passing; the basket lives only in the query string; the delivery address lives only in form bodies, the rendered POST response, Stripe and Artelo, and never in D1, a log, a URL or a `Referer`; logs carry order ids, event ids, statuses and status codes only; `/basket` GET renders carry the beacon (path only), POST renders and `/prints/` carry none and the ingest proxy refuses `/prints/`.
- Budgets (spec 23.1): JavaScript before any interaction under 10KB gzipped (the beacon only; neither the print row nor the basket has a script), HTML under 30KB gzipped, CSS under 15KB gzipped, the same two fonts, cumulative layout shift under 0.01 at 1280px and 375px on `/photos/<id>` with the print row and on `/basket` with two prints, the basket's 240 previews eager (at most 10).
- Motion: ease-out by default, most transitions 200 to 300ms; hover transitions 200ms `ease`, only under `(hover: hover) and (pointer: fine)`; no transforms under `prefers-reduced-motion`; animate `transform` and `opacity` only (colours for hovers). This plan adds no animation beyond hover colours.
- Caching: `/photos`, `/photos?before=` and `/photos/<id>` stay as plan 6 caches them when the URL has no `items`; with `items` they send `Cache-Control: no-store`, render `noindex` and never call `Astro.cache.set`. `/basket` is always `no-store` and `noindex`. `/prints/` gets `PRIVATE_HEADERS` from the middleware.
- George never reviews artefacts. Visual checks are done by the implementer and the task's reviewer, never handed to George, on a throwaway server built from the test build:

  ```bash
  pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test
  node tests/fixtures/artelo-site.mjs &
  rm -rf .wrangler/visual && bunx wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to .wrangler/visual \
    && node scripts/seed-photo-test.mjs --persist-to .wrangler/visual \
    && bunx wrangler d1 execute curiousgeorge-logbook --local --persist-to .wrangler/visual --command "INSERT INTO print_settings (key, value, updated_at) VALUES ('usd_aud', '1.5', 0), ('usd_aud_date', date('now'), 0)"
  bunx wrangler dev -c dist/server/wrangler.json --port 4336 --persist-to .wrangler/visual \
    --var PHOTO_LINK_SECRET:1111111111111111111111111111111111111111111111111111111111111111 \
    --var PRINTS_OPEN:true --var SITE_ORIGIN:http://localhost:4336 --var ARTELO_API_BASE:http://127.0.0.1:4401 \
    --var FX_URL:http://127.0.0.1:4401/fx --var EMAIL_SINK:http://127.0.0.1:4401/__mail \
    --var STRIPE_API_BASE:http://127.0.0.1:4401/stripe --var STRIPE_SECRET_KEY:sk_test_fixture_prints \
    --var STRIPE_WEBHOOK_SECRET:whsec_fixture_prints --var ARTELO_API_KEY:artelo-fixture-key \
    --var ARTELO_WEBHOOK_SECRET:artelo-fixture-webhook-secret \
    --var PRINT_VIEW_SECRET:2222222222222222222222222222222222222222222222222222222222222222 \
    --var PRINT_GST:none --var STRIPE_GST_TAX_RATE: --var 'PRINT_SELLER_NAME:george vlachos' \
    --var PRINT_FROM_EMAIL:prints@curiousgeorge.dev --var ADMIN_EMAIL:hello@curiousgeorge.dev &
  curl --retry 30 --retry-connrefused --retry-delay 1 -sf http://localhost:4336/ -o /dev/null
  ```

  Shoot each page the task names at both widths and open both images before committing:

  ```bash
  node -e '
  const { chromium } = require("@playwright/test");
  (async () => {
    const browser = await chromium.launch();
    for (const [width, height] of [[375, 812], [1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(process.argv[1], { waitUntil: "networkidle" });
      await page.screenshot({ path: `${process.argv[2]}-${width}.png`, fullPage: true });
    }
    await browser.close();
  })();
  ' "http://localhost:4336/photos/fixture-b-01" "$TMPDIR/print-row"
  ```

  Each task names the URLs and what to look for. Afterwards: `pkill -f "port 4336"; pkill -f "artelo-site.mjs"; rm -rf .wrangler/visual`.
- Servers: 4331 to 4335 are plan 6's (main, empty, admin, snapshots, gallery); 4336 is the throwaway visual server; 4337 (new, Task 5) is the prints server with every provider stood in, recreated every run; 4338 (new, Task 15) is the prints server that talks to Stripe's test mode, started only when `STRIPE_TEST_SECRET_KEY` is set; 4400 is the snapshot fixture site; 4401 (new, Task 5) is the Artelo, Stripe, exchange-rate and mail stand-in. Print specs run in Chromium only and write only to 4337 and 4338.
- No new dependency anywhere in this plan. Run scripts and tests under Node 24 or later (`mise exec node@24 --` outside the home directory); scripts import `.ts` files through Node's type stripping.
- Every task ends with `bun run typecheck` at 0 errors and the unit tests passing; tasks that touch pages rebuild with `bun run build:test` and run the e2e specs they name (stop stale servers first with `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"`). Match the existing code style: 2-space indent, double quotes, semicolons, short comments that say why.

## Review focus

1. **Addresses in other scripts or with markup and punctuation** (`Zoë O'Brien & Sons`, `東京都渋谷区`, `<b>unit</b> 3`, a 100-character street): they must round-trip exactly through the form, the sealed quote, Stripe's custom text and Artelo's address, render as text and never fail the seal's comparison. Task 6 pins the round trip and the escaping; Task 7 pins the custom text.
2. **A basket URL edited by hand** (`items=a-01:small:oak,,`, `A-01:SMALL:OAK`, an entry with a space, 25 entries, a tier the photo doesn't offer): treated as empty or dropped with a line, never a 500, and every change answered with the canonical URL. Task 2 pins the parser; Task 6 pins the page.
3. **A quote that runs out, or a pay form sent twice** (a buyer who waits 31 minutes, a double tap on `continue to payment`): the old quote is refused with `that quote has changed or run out. quote delivery again.`; two posts make two tracked orders (the unpaid one expired later by the cron), never one order charged twice. Task 7 pins both.
4. **The price list or the buffer changing between quote and checkout** (George saves a new buffer, a migration changes a price): checkout charges the sealed delivery, never a recomputed one; a changed print total is refused rather than charged. Task 7 pins both.
5. **A provider answering slowly or with a proxy's HTML error page** (a 502 `text/html` from Artelo, a 200 whose body isn't JSON): a quote shows `delivery prices aren't loading right now. try again in a minute.`, an order attempt counts as retryable and looks the order up before it creates again; no HTML reaches a buyer or a log. Task 4 pins the quote; Task 9 pins the order.

## Decisions made while planning

Recorded so reviewers know they are deliberate:

- **Ports.** Plan 6 gave 4335 to the gallery server, so the spec's prints server becomes two: 4337 with every provider stood in (the stand-in on 4401 answers Stripe's three endpoints too), which runs on every e2e run, and 4338 with Stripe's real test mode for the one full order through `checkout.stripe.com`, started only when `STRIPE_TEST_SECRET_KEY` is set. Spec 23.2's other money specs (reconciliation, Artelo failure, partial refusal) therefore run in every CI run instead of only where the key exists. A new var, `STRIPE_API_BASE` (`https://api.stripe.com`), is how 4337 points at the stand-in; `ARTELO_API_BASE` and `FX_URL` already exist in the spec for the same reason.
- **The checkout redirect on 4337 is read, not followed.** The CSP's `form-action 'self' https://checkout.stripe.com` (spec 13.3) rightly blocks a redirect to the stand-in, so the 4337 specs post the pay form with Playwright's request context and read the 303's `Location`. 4338 follows it to Stripe.
- **Task order differs from spec 1.2 where a later step's code is needed earlier.** The pure catalogue and basket come before the migration (the store types use them); the stand-in and the 4337 server arrive with the first page (Task 5) and grow task by task; mail (Task 8) comes before the Stripe webhook, because reconciliation, placement and Artelo statuses all send mail; `placeOrder` (Task 9) comes before the Stripe webhook (Task 10), which starts it.
- **Mail is driven by state.** `sendDueMail` sends every due `needs attention` and `shipped` email (claimed through `attention_notified_at` and `shipped_email_at`), from the cron and right after any transition. George's two other order emails (`paid without a webhook` and `cancelled by artelo`) share a guard column, `admin_notified_at`, which is 0 while one is due and the send time once it went, so a failed send is retried by the cron as spec 18.4 asks; a 0 sentinel, rather than NULL, is what tells `sendDueMail` an email is due at all.
- **Migration 0007 adds two columns the spec's schema lacks:** `print_orders.delivery_taxed` (0 or 1), because spec 16.1 says the line reads `delivery and destination taxes` on the order page and in `/admin` too and nothing else in D1 says whether a quote carried tax (the session's metadata carries it too, so a recreated order keeps it); and `print_orders.admin_notified_at`, the guard that lets George's cancellation and missed-webhook emails be retried (spec 18.4). Neither is personal data.
- **Money-path guards the review added:** a full refund that lands while placement holds the lease leaves the order `needs_attention` with Artelo's id and the refund reason, never silently placed; an Artelo status for an order not yet Artelo's (`checkout`, `expired`, `paid`) is only recorded, so placement's lookup adopts it; a `needs_attention` this site set is cleared only by a cancellation; each attempt revokes the last attempt's master links, and a full refund before placement revokes them too.
- **The basket's canonical form** lists one entry per print with a line's prints adjacent, lines in the order first seen (`items=fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed`). A change that can't apply (`one more` at 10 prints, an `add` the photo doesn't offer) or a URL with dropped entries renders the basket with its line instead of redirecting, so the line is seen; a clean change answers 303 to the canonical URL.
- **The exchange rate is shown to four decimals with trailing zeros trimmed, at least two** (`a$1.50`, `a$1.5237`), so the breakdown shows the rate the arithmetic used.
- **Artelo's answers whose shape its public documentation doesn't show are read defensively and fail closed.** Get Orders may answer a list or an object holding one under `orders` or `data`; anything else counts as a failed lookup, which is retryable and never followed by a create. Create Order, Get Order by Id and the webhook may wrap the order in `data`. Section "Assumptions" lists each.
- **Rate limits in test builds:** `QUOTE_LIMIT` and `CHECKOUT_LIMIT` key on `X-Test-Client` (spec 21.3), and so does `ARTELO_LIMIT` (`price-check:<client>`), so parallel specs on one server don't share the 30-per-10-seconds bucket. Production keys `ARTELO_LIMIT` on the constant `price-check`.
- **`open it in artelo` is text naming Artelo's order id, not a link,** because the spec gives no URL for Artelo's dashboard and guessing one would rot.
- **Checkout sends line item images only when `SITE_ORIGIN` is `https://`**, so local test sessions never hand Stripe an `http://localhost` image.
- **The webhook-missing email goes once per daily check**, which runs at most every 20 hours, so `print_settings` needs no extra mailed-at key.
- **A prints-open change shows on cached gallery pages within their edge lifetime** (five minutes fresh, then one stale render): the first exchange rate is written by the cron, which has no `Astro.cache` to purge with. `PRINTS_OPEN` changes ship with a deploy, whose purge covers `photos` and `logbook`.
- **Order lines name a photograph by its place among its post's published photographs plus itself**, so a print keeps a sensible name after George hides the photograph; its thumbnail is left out then, because plan 6's media route no longer serves a hidden photograph's previews.
- **An unexpected throw while placing (a D1 hiccup) is retryable;** Stripe's PaymentIntent read is retryable on a network error, 429 or 5xx and permanent on any other 4xx; a missing master or a missing `PHOTO_LINK_SECRET` is permanent.
- **Copy the spec leaves open:** two or more dropped prints read `2 prints were taken out: those photos aren't available as prints any more.`; an empty or unreadable post reads `that form couldn't be read. try again.`; too many checkouts read `too many tries - wait a minute and try again.`; an address too long for Stripe's page reads `that address is too long for the payment page. shorten it and quote again.`; the basket failing outright reads `the basket isn't loading right now. try again in a bit.`; a one-print shipped email reads `hi, your print has left the printer:` and `you can check on it here: <url>. thanks for buying it. - george`; one-print order pages use `your print`, `it's with the printer.` and the like; the missed-webhook email's subject is `print order <id>: stripe's webhook never arrived`; the webhook-missing email's subject is `the artelo webhook is missing`; the buffer field's saved line is `saved - it applies to the next quote.`; prints closed reasons are `PRINTS_OPEN isn't "true"`, `these secrets aren't set: …` and `no exchange rate has been fetched yet`; the address field labels are `full name`, `street address`, `apartment, unit or building`, `city or suburb`, `state or region`, `postcode`, `country` and `phone`, with messages `add your name.`, `add the street address.`, `add the city or suburb.`, `choose a country.`, `add a phone number.`, `that phone number looks too short.`, `use digits, spaces, +, -, ( and ) only.`, `one line of plain text.` and `<n> characters at most.`
- **The custom entry was proven in the plan's review, in a scratch copy:** the adapter's config customiser keeps a custom `main`; the built `wrangler.json` keeps the cron, the three rate limits and `send_email`; the handler runs when wrangler's local explorer triggers the cron (`POST /cdn-cgi/local/explorer/api/local/scheduled?worker=personal-website`, as `tests/e2e/snapshots-live.spec.ts` does). `GET /__scheduled` doesn't work on a server started from `dist/`: its config has `no_bundle`, so wrangler can't inject the `--test-scheduled` middleware, and no server here passes that flag. Task 1 still proves the entry with a build and the probe; if either fails, the task stops and reports, because spec 13.3's fallback (a separate `workers/prints/` Worker) is a controller decision.
- **The modules the two print scripts import under plain Node keep their value imports' `.ts` extensions** (`catalogue.ts`, `money.ts`, `quote.ts`, `artelo.ts`, `artelo-status.ts`, `margin.ts`), which Astro's tsconfig allows (`allowImportingTsExtensions`): Node resolves no extensionless relative path, which is also why plan 6's scripts import only `tokens.ts`. For the same reason Artelo's status table (`artelo-status.ts`) stays free of value imports and the code that applies statuses lives in `artelo-updates.ts`.
- **An order's grants are revoked when Artelo cancels it too**, beside the spec's `in_production`, `shipped` and `delivered`: nothing needs the masters after a cancellation.
- **Task 12's admin edits are written against the working tree of plan 6's final review** (`ActionResult` carrying `purge?: string[]`, `submitForm` merging `result.purge`). If that review lands differently, keep what landed and add only what Task 12 adds.

## File structure

```
wrangler.jsonc                                  modify: main, the cron, send_email, three rate limits, the print vars
worker-configuration.d.ts                       regenerate (bun run cf-typegen)
src/env.d.ts                                    modify: print secrets, the two test-only vars
src/worker.ts                                   create: fetch (Astro's handle) and scheduled
src/lib/prints/config.ts                        create: PrintConfig, printConfig, PrintDeps, printDeps
src/lib/prints/cron.ts                          create: runSteps, cronSteps, runScheduled, daily
src/lib/prints/catalogue.ts                     create: sizes, families, eligibility, labels
src/lib/prints/basket.ts                        create: the items parser, validation, lines, changes, canonical URLs
src/lib/prints/money.ts                         create: aud, usd, rateText, gstSentence, plural
src/lib/prints/store.ts                         create: prices, settings, orders, the basket's photos, order lines
src/lib/prints/address.ts, countries.ts         create: the address form's rules, Stripe's countries
src/lib/prints/quote.ts                         create: tax fields, delivery, labels, the breakdown
src/lib/prints/artelo.ts                        create: the client, address and product mapping, Price Check, order readers
src/lib/prints/fx.ts                            create: the exchange rate job
src/lib/prints/open.ts                          create: when prints are open
src/lib/prints/carry.ts                         create: the basket carried through the gallery
src/lib/prints/seal.ts                          create: the sealed quote, base64url, HMAC keys
src/lib/prints/limits.ts                        create: rate-limit keys
src/lib/prints/basket-page.ts                   create: the basket's GET and POST
src/lib/prints/stripe.ts                        create: the client, session reads, the webhook signature
src/lib/prints/view-key.ts                      create: the order page's key
src/lib/prints/checkout.ts                      create: the session form, starting checkout
src/lib/prints/mail.ts                          create: sending, the sink, due mail, the emails' text
src/lib/prints/artelo-status.ts                 create: Artelo's statuses (no value imports, for the webhook script)
src/lib/prints/artelo-updates.ts                create: applying Artelo's statuses, the webhook signature, the poll
src/lib/prints/place.ts                         create: placeOrder, backoff, placeDue
src/lib/prints/stripe-events.ts                 create: the event guard, the paid transition, refunds, reconciliation
src/lib/prints/http.ts                          create: a capped raw body read
src/lib/prints/daily.ts                         create: the webhook check and the clean-up
src/lib/prints/admin.ts                         create: the orders section's data and its time stamps
src/lib/prints/order-page.ts                    create: the order page's status lines
src/lib/prints/margin.ts                        create: the margin arithmetic and the landmark addresses
src/lib/photos/store.ts                         modify: photoMaster, activeGrant, issueOrderGrant, revokeOrderGrants
src/lib/photos/download.ts                      modify: an order grant serves its photo's master
src/lib/photos/gallery.ts                       modify: frameView carries the basket
src/lib/photos/http.ts                          modify: /prints/ is private
src/middleware.ts                               modify: an order page's own failure message
src/lib/admin/gate.ts                           modify: the two webhook paths need no Origin
src/lib/admin/actions.ts, submit.ts, validate.ts   modify: the orders section's two actions
src/lib/ingest.ts                               modify: refuse /prints/
src/pages/basket.astro                          create
src/pages/prints/[id].astro                     create
src/pages/api/prints/stripe.ts, artelo.ts       create
src/pages/photos/[id].astro, index.astro, src/pages/index.astro, src/pages/admin/index.astro   modify
src/components/prints/PrintRow.astro, Basket.astro, BasketLines.astro, AddressForm.astro, QuoteTotal.astro, Order.astro   create
src/components/admin/OrdersAdmin.astro          create
src/components/photos/PhotoView.astro, Gallery.astro, Entry.astro, src/components/Logbook.astro   modify
src/layouts/Notebook.astro                      modify: refresh
src/scripts/photo-sheet.ts                      modify: frame links carry the basket
src/styles/prints.css                           create
src/styles/admin.css                            modify
astro.config.mjs                                modify: form-action allows Stripe's checkout
public/robots.txt                               modify: /prints/ and /basket
migrations/0007_prints.sql                      create
scripts/check-built-worker.mjs, print-check.mjs, artelo-webhook.mjs   create
package.json                                    modify: the built-worker check, prints:check, prints:webhook
.github/workflows/ci.yml                        modify: the built-worker check, the test-only strings guard, the Stripe test key
playwright.config.ts                            modify: the stand-in (4401), 4337, 4338
tests/fixtures/artelo-site.mjs                  create
tests/e2e/prints-site.ts, prints.ts             create
tests/e2e/prints-basket, prints-checkout, prints-order, prints-admin, prints-scripts, prints-stripe   create (.spec.ts)
tests/e2e/privacy, budgets, perf                modify
tests/unit/print-config, cron, worker-entry, catalogue, basket, money, prints-store, order-grants, address, quote, artelo, fx, open, carry, print-row, seal, basket-page, basket-view, checkout, view-key, mail, place, stripe-events, stripe-route, artelo-status, artelo-route, orders-admin, order-page, margin, daily   create (.test.ts)
tests/unit/prints-fakes.ts                      create: the test helpers
tests/unit/gate, middleware, ingest, gallery, gallery-page, photo-view, logbook-page, actions, submit   modify
docs/prints.md, README.md, docs/superpowers/plans/2026-10-03-redesign-roadmap.md   create or modify
docs/superpowers/plans/2026-10-08-plan-7-followups.md   create
```

Tasks touch shared files in this order, so each builds on the last: `cron.ts` (1, 4, 8, 9, 10, 11, 14), `prints/store.ts` (3, 5, 7, 8, 9), `artelo.ts` (4, 9, 14), `stripe.ts` (7, 10), `artelo-status.ts` (9), `basket-page.ts` (6, 7), `prints.css` (5, 6, 13), `tests/fixtures/artelo-site.mjs` (5, 6, 7, 8, 9, 11, 14), `tests/e2e/prints.ts` (5, 6, 7, 10, 11), `prints-fakes.ts` (3), `playwright.config.ts` (5, 15), `package.json` (1, 14), `ci.yml` (1, 15), `photos/store.ts` (3), `PhotoView.astro`, `Gallery.astro`, `Entry.astro`, `gallery.ts` and `photo-sheet.ts` (5), `prints-basket.spec.ts` (5, 6), `prints-order.spec.ts` (10, 11, 13), `admin/actions.ts`, `submit.ts`, `validate.ts`, `admin/index.astro` (12), `photos/http.ts`, `middleware.ts`, `ingest.ts`, `Notebook.astro` (13), `privacy.spec.ts`, `budgets.spec.ts`, `perf.spec.ts` (15).

---

### Task 1: the Worker entry, its bindings and the probe

The first plan B step (spec 1.2, 13.3): `wrangler.jsonc`'s `main` becomes `src/worker.ts`, which exports Astro's `fetch` and a `scheduled` handler running the prints cron; the config gains the five-minute cron, the `send_email` binding, the three rate limits and the print vars (spec 21.4). A check script proves after every build that `dist/server/wrangler.json` keeps all of it, and a probe proves the handler runs when wrangler's local explorer triggers the cron, as `tests/e2e/snapshots-live.spec.ts` already does (`GET /__scheduled` can't reach it: the built config has `no_bundle`, so wrangler can't inject its `--test-scheduled` middleware). The print code's view of the env (`printConfig`) and the cron's step runner start here, empty of steps.

**Files:**
- Create: `src/worker.ts`, `src/lib/prints/config.ts`, `src/lib/prints/cron.ts`, `scripts/check-built-worker.mjs`, `tests/unit/print-config.test.ts`, `tests/unit/cron.test.ts`, `tests/unit/worker-entry.test.ts`
- Modify: `wrangler.jsonc`, `src/env.d.ts`, `worker-configuration.d.ts` (regenerated), `package.json`, `.github/workflows/ci.yml`
- Test: the three new unit tests, `scripts/check-built-worker.mjs`, the probe in Step 8

**Interfaces:**
- Consumes: `handle(request, env, context)` from `@astrojs/cloudflare/handler` (the adapter's own export).
- Produces (`src/lib/prints/config.ts`):
  - `PRINT_SECRETS` (the six names of spec 16.5) and `type PrintSecret`; `DAY = 86_400`
  - `interface PrintConfig { switchedOn: boolean; sellerName: string; gst: "none" | "inclusive"; gstTaxRate: string; fromEmail: string; siteOrigin: string; adminEmail: string; arteloBase: string; stripeBase: string; fxUrl: string; secrets: Record<PrintSecret, string>; missing: PrintSecret[]; retryWindow: number; emailSink: string | null; testClients: boolean }`
  - `printConfig(env: Cloudflare.Env): PrintConfig`
  - `interface PrintDeps { db: D1Database; config: PrintConfig; fetch: typeof fetch; now: () => number; photoPrints: R2Bucket; email: SendEmail | null; waitUntil: (promise: Promise<unknown>) => void }`
  - `printDeps(env: Cloudflare.Env, waitUntil: (promise: Promise<unknown>) => void): PrintDeps`
- Produces (`src/lib/prints/cron.ts`): `type CronStep = readonly [name: string, run: () => Promise<unknown>]`; `runSteps(steps: readonly CronStep[]): Promise<string[]>`; `cronSteps(deps: PrintDeps): CronStep[]` (later tasks fill it); `runScheduled(deps: PrintDeps): Promise<void>`
- Produces: `src/worker.ts`'s default export `{ fetch, scheduled }`; the env bindings `EMAIL: SendEmail`, `QUOTE_LIMIT`, `CHECKOUT_LIMIT`, `ARTELO_LIMIT: RateLimit` and the vars `PRINTS_OPEN`, `PRINT_SELLER_NAME`, `PRINT_GST`, `STRIPE_GST_TAX_RATE`, `PRINT_FROM_EMAIL`, `SITE_ORIGIN`, `ARTELO_API_BASE`, `STRIPE_API_BASE`, `FX_URL`; the optional secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ARTELO_API_KEY`, `ARTELO_WEBHOOK_SECRET`, `PRINT_VIEW_SECRET` and the test-only `PRINT_RETRY_WINDOW` and `EMAIL_SINK`.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/print-config.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { DAY, printConfig } from "../../src/lib/prints/config";

const env = (over: Record<string, unknown> = {}) =>
  ({
    PRINTS_OPEN: "true", PRINT_SELLER_NAME: "george vlachos", PRINT_GST: "none", STRIPE_GST_TAX_RATE: "", PRINT_FROM_EMAIL: "prints@curiousgeorge.dev",
    SITE_ORIGIN: "https://curiousgeorge.dev/", ADMIN_EMAIL: "hello@curiousgeorge.dev", ARTELO_API_BASE: "https://www.artelo.com/api/open/",
    STRIPE_API_BASE: "https://api.stripe.com", FX_URL: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD",
    STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc", ARTELO_API_KEY: "artelo", ARTELO_WEBHOOK_SECRET: "hook",
    PRINT_VIEW_SECRET: "2".repeat(64), PHOTO_LINK_SECRET: "1".repeat(64), PRINT_RETRY_WINDOW: "0", EMAIL_SINK: "http://127.0.0.1:4401/__mail",
    ...over,
  }) as unknown as Cloudflare.Env;

afterEach(() => vi.unstubAllGlobals());

test("reads the vars, trims trailing slashes and finds nothing missing", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const config = printConfig(env());
  expect(config).toMatchObject({
    switchedOn: true, sellerName: "george vlachos", gst: "none", fromEmail: "prints@curiousgeorge.dev", siteOrigin: "https://curiousgeorge.dev",
    adminEmail: "hello@curiousgeorge.dev", arteloBase: "https://www.artelo.com/api/open", stripeBase: "https://api.stripe.com", missing: [],
  });
  expect(config.secrets.STRIPE_SECRET_KEY).toBe("sk_test_abc");
});

test("prints are switched on only by the exact string true; gst is none unless it says inclusive", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  for (const value of ["false", "TRUE", "1", undefined]) expect(printConfig(env({ PRINTS_OPEN: value })).switchedOn).toBe(false);
  expect(printConfig(env({ PRINT_GST: "inclusive" })).gst).toBe("inclusive");
  expect(printConfig(env({ PRINT_GST: "yes" })).gst).toBe("none");
});

test("an unset or blank secret is missing, by name, in the spec's order", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const config = printConfig(env({ ARTELO_API_KEY: undefined, PRINT_VIEW_SECRET: "   " }));
  expect(config.missing).toEqual(["ARTELO_API_KEY", "PRINT_VIEW_SECRET"]);
  expect(config.secrets.ARTELO_API_KEY).toBe("");
});

test("a production build ignores the test-only vars and keeps a live key", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const config = printConfig(env({ STRIPE_SECRET_KEY: "sk_live_abc" }));
  expect(config.retryWindow).toBe(DAY);
  expect(config.emailSink).toBeNull();
  expect(config.testClients).toBe(false);
  expect(config.secrets.STRIPE_SECRET_KEY).toBe("sk_live_abc");
});

test("a test build reads the retry window and the mail sink, and refuses a live stripe key", () => {
  vi.stubGlobal("__TEST_HOOKS__", true);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(printConfig(env()).retryWindow).toBe(0);
  expect(printConfig(env({ PRINT_RETRY_WINDOW: "nonsense" })).retryWindow).toBe(DAY);
  expect(printConfig(env()).emailSink).toBe("http://127.0.0.1:4401/__mail");
  expect(printConfig(env()).testClients).toBe(true);
  const live = printConfig(env({ STRIPE_SECRET_KEY: "sk_live_abc" }));
  expect(live.secrets.STRIPE_SECRET_KEY).toBe("");
  expect(live.missing).toEqual(["STRIPE_SECRET_KEY"]);
  expect(error).toHaveBeenCalledWith("prints: a test build refuses a live stripe key");
  error.mockRestore();
});
```

Create `tests/unit/cron.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { runSteps } from "../../src/lib/prints/cron";

afterEach(() => vi.restoreAllMocks());

test("every step runs in order, and a failing step doesn't stop the rest", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const ran: string[] = [];
  const failed = await runSteps([
    ["first", async () => { ran.push("first"); }],
    ["second", async () => { ran.push("second"); throw new Error("artelo is down"); }],
    ["third", async () => { ran.push("third"); }],
  ]);
  expect(ran).toEqual(["first", "second", "third"]);
  expect(failed).toEqual(["second"]);
  expect(error).toHaveBeenCalledWith("prints: the cron's second step failed", "artelo is down");
});
```

Create `tests/unit/worker-entry.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";

// The adapter's handler imports virtual modules only Astro's build provides; it is stood in here
const handle = vi.hoisted(() => vi.fn());
vi.mock("@astrojs/cloudflare/handler", () => ({ handle }));
vi.stubGlobal("__TEST_HOOKS__", false);
const worker = (await import("../../src/worker")).default;

afterEach(() => vi.restoreAllMocks());

test("requests go to Astro's handler", () => {
  expect(worker.fetch).toBe(handle);
});

test("the scheduled event runs the prints cron and says so", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const waited: Promise<unknown>[] = [];
  const env = { DB: {}, PHOTO_PRINTS: {}, PRINTS_OPEN: "false" } as unknown as Env;
  await worker.scheduled({} as ScheduledController, env, { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as unknown as ExecutionContext);
  // Later tasks add steps, which fail here against a stand-in env; the run still finishes and says so
  expect(String(log.mock.calls.at(-1)?.[0])).toMatch(/^prints: cron ran/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/print-config.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts`
Expected: FAIL, the three modules don't exist.

- [ ] **Step 3: Write the config, the cron runner and the entry**

Create `src/lib/prints/config.ts`:

```ts
// Everything the print code reads from the Worker's env, in one place (spec 21.4). Secrets stay strings ("" when unset),
// so a missing one closes prints (spec 16.5) instead of throwing halfway through a request.

/** The secrets prints need before they can open (spec 16.5), in the spec's order */
export const PRINT_SECRETS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ARTELO_API_KEY", "ARTELO_WEBHOOK_SECRET", "PRINT_VIEW_SECRET", "PHOTO_LINK_SECRET"] as const;
export type PrintSecret = (typeof PRINT_SECRETS)[number];

export const DAY = 86_400;

export interface PrintConfig {
  /** PRINTS_OPEN is exactly "true" */
  switchedOn: boolean;
  sellerName: string;
  gst: "none" | "inclusive";
  gstTaxRate: string;
  fromEmail: string;
  /** The site's origin without a trailing slash; the cron has no request to read it from */
  siteOrigin: string;
  adminEmail: string;
  arteloBase: string;
  stripeBase: string;
  fxUrl: string;
  secrets: Record<PrintSecret, string>;
  /** The secrets that are unset or blank, by name */
  missing: PrintSecret[];
  /** Seconds from payment in which Artelo must take an order (spec 19): a day, or PRINT_RETRY_WINDOW in test builds */
  retryWindow: number;
  /** Test builds only: mail goes here instead of the EMAIL binding (spec 23.3) */
  emailSink: string | null;
  /** Test builds only: rate limits key on X-Test-Client when a request sends it (spec 21.3) */
  testClients: boolean;
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const trimSlash = (value: string) => value.replace(/\/+$/, "");

export function printConfig(env: Cloudflare.Env): PrintConfig {
  const vars = env as unknown as Record<string, unknown>;
  const secrets = Object.fromEntries(PRINT_SECRETS.map((name) => [name, text(vars[name]).trim()])) as Record<PrintSecret, string>;
  let retryWindow = DAY;
  let emailSink: string | null = null;
  // Statements, not expressions: a production build compiles this block out, test-only names and all
  if (__TEST_HOOKS__) {
    // A test build never talks to Stripe's live mode (spec 21.4)
    if (secrets.STRIPE_SECRET_KEY.startsWith("sk_live_")) {
      console.error("prints: a test build refuses a live stripe key");
      secrets.STRIPE_SECRET_KEY = "";
    }
    const window = text(vars.PRINT_RETRY_WINDOW);
    if (/^\d{1,6}$/.test(window)) retryWindow = Number(window);
    if (text(vars.EMAIL_SINK)) emailSink = text(vars.EMAIL_SINK);
  }
  return {
    switchedOn: vars.PRINTS_OPEN === "true",
    sellerName: text(vars.PRINT_SELLER_NAME, "george vlachos"),
    gst: vars.PRINT_GST === "inclusive" ? "inclusive" : "none",
    gstTaxRate: text(vars.STRIPE_GST_TAX_RATE),
    fromEmail: text(vars.PRINT_FROM_EMAIL, "prints@curiousgeorge.dev"),
    siteOrigin: trimSlash(text(vars.SITE_ORIGIN, "https://curiousgeorge.dev")),
    adminEmail: text(vars.ADMIN_EMAIL),
    arteloBase: trimSlash(text(vars.ARTELO_API_BASE, "https://www.artelo.com/api/open")),
    stripeBase: trimSlash(text(vars.STRIPE_API_BASE, "https://api.stripe.com")),
    fxUrl: text(vars.FX_URL, "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD"),
    secrets,
    missing: PRINT_SECRETS.filter((name) => secrets[name] === ""),
    retryWindow,
    emailSink,
    testClients: __TEST_HOOKS__,
  };
}

/** What the print code needs to act: the store, the config, the outside world and the clock (seconds), all replaceable in tests */
export interface PrintDeps {
  db: D1Database;
  config: PrintConfig;
  fetch: typeof fetch;
  now: () => number;
  /** PHOTO_PRINTS, the private masters an order's links serve */
  photoPrints: R2Bucket;
  /** The send_email binding; null where there is none (unit tests) */
  email: SendEmail | null;
  /** Work that must finish after the response: the request's or the cron's waitUntil */
  waitUntil: (promise: Promise<unknown>) => void;
}

export function printDeps(env: Cloudflare.Env, waitUntil: (promise: Promise<unknown>) => void): PrintDeps {
  return {
    db: env.DB,
    config: printConfig(env),
    // Bound, so the runtime's fetch is never called with another `this`
    fetch: (input, init) => fetch(input, init),
    now: () => Math.floor(Date.now() / 1000),
    photoPrints: env.PHOTO_PRINTS,
    email: env.EMAIL ?? null,
    waitUntil,
  };
}
```

Create `src/lib/prints/cron.ts`:

```ts
import type { PrintDeps } from "./config";

/** One job of the five-minute run: a name for the log, and the work */
export type CronStep = readonly [name: string, run: () => Promise<unknown>];

/** Runs every step in order, each in its own try, so one failure doesn't stop the rest (spec 18.6); returns the names that failed */
export async function runSteps(steps: readonly CronStep[]): Promise<string[]> {
  const failed: string[] = [];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      failed.push(name);
      console.error(`prints: the cron's ${name} step failed`, error instanceof Error ? error.message : String(error));
    }
  }
  return failed;
}

/** The five-minute run's steps, in spec 18.6's order. The webhooks are the accelerator; this is the guarantee */
export function cronSteps(deps: PrintDeps): CronStep[] {
  void deps;
  return [];
}

export async function runScheduled(deps: PrintDeps): Promise<void> {
  const failed = await runSteps(cronSteps(deps));
  console.log(failed.length > 0 ? `prints: cron ran; ${failed.join(", ")} failed` : "prints: cron ran");
}
```

Create `src/worker.ts`:

```ts
import { handle } from "@astrojs/cloudflare/handler";
import { printDeps } from "./lib/prints/config";
import { runScheduled } from "./lib/prints/cron";

// The Worker's entry (spec 13.3): Astro answers requests; the five-minute cron places, reconciles, mails and polls
export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    await runScheduled(printDeps(env, (promise) => ctx.waitUntil(promise)));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Add the bindings, the vars and the secrets' types**

In `wrangler.jsonc`, replace `"main": "@astrojs/cloudflare/entrypoints/server",` with:

```jsonc
  // Our own entry, so the Worker can export scheduled beside Astro's fetch (spec 13.3)
  "main": "src/worker.ts",
```

Replace the `"vars": { … }` line with:

```jsonc
  // Prints (spec 21.4): closed until launch; the seller and GST mode are configuration, so registering for GST later
  // changes no code. SITE_ORIGIN is for the cron, which has no request. Tests point the three provider URLs at the stand-in.
  "vars": {
    "ACCESS_TEAM_DOMAIN": "digitalnachos.cloudflareaccess.com",
    "ACCESS_AUD": "ce587b3b3fbc4cbda410abd08f68a66dbc10a6379a99a6a162832246146c90fa",
    "ADMIN_EMAIL": "hello@curiousgeorge.dev",
    "POSTHOG_HOST": "https://us.i.posthog.com",
    "PRINTS_OPEN": "false",
    "PRINT_SELLER_NAME": "george vlachos",
    "PRINT_GST": "none",
    "STRIPE_GST_TAX_RATE": "",
    "PRINT_FROM_EMAIL": "prints@curiousgeorge.dev",
    "SITE_ORIGIN": "https://curiousgeorge.dev",
    "ARTELO_API_BASE": "https://www.artelo.com/api/open",
    "STRIPE_API_BASE": "https://api.stripe.com",
    "FX_URL": "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD"
  },
  // The prints cron (spec 18.6): the webhooks accelerate, this guarantees
  "triggers": { "crons": ["*/5 * * * *"] },
  // Cloudflare Email Service, from prints@curiousgeorge.dev (spec 18.4)
  "send_email": [{ "name": "EMAIL" }],
  // Quotes call Artelo, so they are limited without cookies (spec 21.3)
  "ratelimits": [
    { "name": "QUOTE_LIMIT", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
    { "name": "CHECKOUT_LIMIT", "namespace_id": "1002", "simple": { "limit": 6, "period": 60 } },
    { "name": "ARTELO_LIMIT", "namespace_id": "1003", "simple": { "limit": 30, "period": 10 } }
  ],
```

In `src/env.d.ts`, replace the `Cloudflare.Env` block with:

```ts
declare namespace Cloudflare {
  interface Env {
    /** 32 random bytes as lowercase hex. Kept in a Worker secret, never in the public catalogue. */
    PHOTO_LINK_SECRET?: string;
    /** The PostHog project key, a Worker secret (wrangler secret put POSTHOG_KEY). Unset locally, so /ingest drops events */
    POSTHOG_KEY?: string;
    /** Print secrets George sets with wrangler secret put (spec 21.4); prints stay closed until all are set */
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    ARTELO_API_KEY?: string;
    /** Set by bun run prints:webhook */
    ARTELO_WEBHOOK_SECRET?: string;
    /** 32 random bytes as lowercase hex: order view keys and sealed quotes, each under its own label */
    PRINT_VIEW_SECRET?: string;
    /** Test builds only: seconds in place of the 24-hour retry window (spec 19) */
    PRINT_RETRY_WINDOW?: string;
    /** Test builds only: where mail goes instead of the EMAIL binding (spec 23.3) */
    EMAIL_SINK?: string;
  }
}
```

Run: `bun run cf-typegen`
Expected: `worker-configuration.d.ts` regenerated; `grep -nE "EMAIL: SendEmail|QUOTE_LIMIT: RateLimit|PRINTS_OPEN: string|STRIPE_API_BASE: string" worker-configuration.d.ts` shows all four.

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/print-config.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 6: Write the built-worker check and wire it in**

Create `scripts/check-built-worker.mjs`:

```js
// Spec 13.3: the built Worker must keep its cron, its three rate limits and its email binding, and its entry must
// export scheduled. Run after a build: bun run check does, and so do both CI jobs.
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
const problems = [];
if (JSON.stringify(config.triggers?.crons) !== JSON.stringify(["*/5 * * * *"])) problems.push(`the cron is ${JSON.stringify(config.triggers?.crons)}, not every five minutes`);
const limits = { QUOTE_LIMIT: [10, 60], CHECKOUT_LIMIT: [6, 60], ARTELO_LIMIT: [30, 10] };
for (const [name, [limit, period]] of Object.entries(limits)) {
  const binding = config.ratelimits?.find((entry) => entry.name === name);
  if (!binding || binding.simple?.limit !== limit || binding.simple?.period !== period) problems.push(`the ${name} rate limit is missing or changed`);
}
if (!config.send_email?.some((entry) => entry.name === "EMAIL")) problems.push("the EMAIL binding is missing");
const entry = readFileSync(`dist/server/${config.main}`, "utf8");
if (!/\bscheduled\b/.test(entry)) problems.push(`${config.main} doesn't export a scheduled handler`);
if (problems.length > 0) {
  console.error(`the built worker lost what prints need:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("the built worker keeps its cron, rate limits, email binding and scheduled handler");
```

In `package.json`, add the script `"check:worker": "node scripts/check-built-worker.mjs",` after `"typecheck"`, and in `"check"` replace `bun run build:test && bun run test:e2e` with `bun run build:test && bun run check:worker && bun run test:e2e`.

In `.github/workflows/ci.yml`, in the `check` job, add after `- run: bun run build:test`:

```yaml
      - run: bun run check:worker
```

In the `deploy` job, replace the test-hooks guard line with these two steps:

```yaml
      # Test hooks, the admin bypass and the test-only print vars must never reach production
      - run: if grep -rqE "__deck|admin-bypass|EMAIL_SINK|PRINT_RETRY_WINDOW" dist; then echo "test hooks, the admin bypass or a test-only var leaked into the production build"; exit 1; fi
      - run: bun run check:worker
```

- [ ] **Step 7: Build both ways and run the check**

Run: `bun run build && grep -rcE "EMAIL_SINK|PRINT_RETRY_WINDOW" dist | grep -v ":0" ; bun run check:worker`
Expected: the grep prints nothing (the production build compiled the test-only block out) and the check prints `the built worker keeps its cron, rate limits, email binding and scheduled handler`. If the grep finds either name, the `if (__TEST_HOOKS__)` block was not compiled out: stop and report it.

Run: `bun run build:test && bun run check:worker`
Expected: the same line.

- [ ] **Step 8: Probe the scheduled handler under wrangler dev**

Run:

```bash
pkill -f "port 4336"
bunx wrangler dev -c dist/server/wrangler.json --port 4336 --persist-to .wrangler/visual \
  --var PHOTO_LINK_SECRET:1111111111111111111111111111111111111111111111111111111111111111 > "$TMPDIR/probe.log" 2>&1 &
curl --retry 30 --retry-connrefused --retry-delay 1 -sf http://localhost:4336/ -o /dev/null
curl -sf -X POST "http://localhost:4336/cdn-cgi/local/explorer/api/local/scheduled?worker=personal-website" -H "content-type: application/json" -d '{"cron":"*/5 * * * *"}'; sleep 2
grep -c "prints: cron ran" "$TMPDIR/probe.log"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4336/
pkill -f "port 4336"; rm -rf .wrangler/visual
```

Expected: the scheduled call answers `{"success":true,…"outcome":"ok"…}`, the grep counts at least 1 (`prints: cron ran`) and the home page answers 200. If the adapter dropped the custom entry (no `prints: cron ran`, or `/` fails), stop and report BLOCKED with the log: spec 13.3's fallback, a separate `workers/prints/` Worker, is the controller's call.

- [ ] **Step 9: Commit**

```bash
git add src/worker.ts src/lib/prints/config.ts src/lib/prints/cron.ts scripts/check-built-worker.mjs tests/unit/print-config.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts wrangler.jsonc src/env.d.ts worker-configuration.d.ts package.json .github/workflows/ci.yml
git commit -m "feat: the worker entry with the prints cron, the email binding, three rate limits and the print vars"
```

---

### Task 2: sizes, eligibility and the basket's query string

Pure functions with no storage (spec 1.2 step 3, sections 14.1 and 15.2): which Artelo sizes a photograph gets, how they are labelled, how a basket's `items` parameter is parsed, validated, grouped, changed and written back, and how money reads. Everything later builds on these names.

**Files:**
- Create: `src/lib/prints/catalogue.ts`, `src/lib/prints/basket.ts`, `src/lib/prints/money.ts`, `tests/unit/catalogue.test.ts`, `tests/unit/basket.test.ts`, `tests/unit/money.test.ts`
- Test: the three new unit tests

**Interfaces:**
- Consumes: nothing.
- Produces (`src/lib/prints/catalogue.ts`):
  - `type Tier = "small" | "medium" | "large"`; `type Frame = "unframed" | "oak"`; `type Orientation = "Vertical" | "Horizontal"`; `TIERS`, `FRAMES`
  - `interface PrintSize { size: string; short: number; long: number }`; `parseSize(name: string): PrintSize`
  - `FAMILIES: readonly { name: string; ratio: number; tiers: Record<Tier, PrintSize> }[]`; `CROP_TOLERANCE = 0.03`; `MIN_PPI = 200`; `crop(r: number, p: number): number`
  - `interface Offer { tier: Tier; size: PrintSize }`; `interface PhotoPrints { family: string; orientation: Orientation; offers: Offer[] }`
  - `printsFor(width: number, height: number): PhotoPrints | null`; `offerFor(prints: PhotoPrints | null, tier: Tier): Offer | undefined`
  - `sizeInches(size: PrintSize): string` (`12 × 18 in`); `sizeLabel(offer: Offer): string` (`small · 8 × 12 in (20 × 30 cm)`); `frameLabel(frame: Frame): string`; `printLine(tier: Tier, size: PrintSize, frame: Frame): string` (`medium · 12 × 18 in · oak frame`); `isTier(value: string): value is Tier`; `isFrame(value: string): value is Frame`
- Produces (`src/lib/prints/basket.ts`):
  - `MAX_PRINTS = 10`; `CAP_NOTE`; `interface RawEntry { photoId: string; tier: string; frame: string }`; `interface BasketEntry { photoId: string; tier: Tier; frame: Frame }`; `interface BasketLine extends BasketEntry { line: number; quantity: number }`
  - `parseItems(value: string | null): RawEntry[]`; `validate(entries: RawEntry[], offered: (entry: BasketEntry) => boolean): { lines: BasketLine[]; unavailable: number; overCap: number }`; `groupLines(entries: BasketEntry[]): BasketLine[]`; `printCount(lines: readonly { quantity: number }[]): number`
  - `itemsValue(lines: readonly BasketLine[]): string`; `itemsQuery(items: string): string`; `basketHref(items: string): string`
  - `type BasketOp = { kind: "add"; entry: RawEntry } | { kind: "remove" | "more"; line: number }`; `readOp(params: URLSearchParams): BasketOp | null`; `changeLines(lines: readonly BasketLine[], op: { kind: "remove" | "more"; line: number }): { lines: BasketLine[]; refused: boolean }`; `droppedNotes(unavailable: number, overCap: number): string[]`
- Produces (`src/lib/prints/money.ts`): `aud(cents: number): string`; `usd(cents: number): string`; `rateText(rate: number): string`; `gstSentence(mode: "none" | "inclusive"): string`; `plural(n: number, one: string, many: string): string`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/catalogue.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { crop, offerFor, parseSize, printLine, printsFor, sizeLabel } from "../../src/lib/prints/catalogue";

const tiers = (width: number, height: number) => printsFor(width, height)?.offers.map((offer) => `${offer.tier} ${offer.size.size}`) ?? null;

describe("printsFor", () => {
  test("the real dimension classes of spec 14.1", () => {
    expect(tiers(3648, 5472)).toEqual(["small x8x12", "medium x12x18", "large x16x24"]);
    expect(tiers(3024, 4032)).toEqual(["small x9x12", "medium x12x16"]);
    expect(tiers(6048, 8064)).toEqual(["small x9x12", "medium x12x16", "large x18x24"]);
    expect(tiers(2194, 3291)).toEqual(["small x8x12"]);
    expect(tiers(2048, 2048)).toEqual(["small x10x10"]);
    expect(tiers(3575, 4172)).toBeNull();
    expect(tiers(1756, 3097)).toBeNull();
  });

  test("the crop tolerance is 3%: 2.9% gets prints, 3.1% doesn't", () => {
    expect(crop(6179 / 4000, 1.5)).toBeCloseTo(0.029, 3);
    expect(tiers(4000, 6179)).toEqual(["small x8x12", "medium x12x18", "large x16x24"]);
    expect(crop(6192 / 4000, 1.5)).toBeCloseTo(0.031, 3);
    expect(tiers(4000, 6192)).toBeNull();
  });

  test("the family is the one that crops least, and each size still checks its own crop", () => {
    expect(printsFor(4000, 5000)?.family).toBe("4:5");
    // x11x14 is 1.273, so a 4:5 photograph's medium crops 1.8% and qualifies
    expect(tiers(4000, 5000)).toEqual(["small x8x10", "medium x11x14", "large x16x20"]);
    expect(printsFor(4200, 5940)?.family).toBe("iso a");
  });

  test("a print needs 200 pixels per inch on both sides", () => {
    // 3200 / 16 is exactly 200: large qualifies; one pixel less and it doesn't
    expect(tiers(3200, 4800)).toContain("large x16x24");
    expect(tiers(3199, 4800)).not.toContain("large x16x24");
  });

  test("portraits and squares print vertical, landscapes horizontal", () => {
    expect(printsFor(4000, 6000)?.orientation).toBe("Vertical");
    expect(printsFor(2048, 2048)?.orientation).toBe("Vertical");
    expect(printsFor(6000, 4000)?.orientation).toBe("Horizontal");
    expect(tiers(6000, 4000)).toEqual(tiers(4000, 6000));
  });

  test("nothing for an empty or nonsense size", () => {
    expect(printsFor(0, 100)).toBeNull();
    expect(printsFor(Number.NaN, 100)).toBeNull();
  });
});

describe("labels", () => {
  test("both units, rounded to whole centimetres; the ISO sizes keep their decimal", () => {
    expect(sizeLabel(offerFor(printsFor(4000, 6000), "small")!)).toBe("small · 8 × 12 in (20 × 30 cm)");
    expect(sizeLabel(offerFor(printsFor(4000, 6000), "large")!)).toBe("large · 16 × 24 in (41 × 61 cm)");
    expect(sizeLabel({ tier: "small", size: parseSize("x8dot3x11dot7") })).toBe("small · 8.3 × 11.7 in (21 × 30 cm)");
    expect(printLine("medium", parseSize("x12x18"), "oak")).toBe("medium · 12 × 18 in · oak frame");
    expect(printLine("small", parseSize("x8x12"), "unframed")).toBe("small · 8 × 12 in · unframed");
  });
});
```

Create `tests/unit/basket.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { CAP_NOTE, changeLines, droppedNotes, groupLines, itemsValue, parseItems, readOp, validate, type BasketEntry } from "../../src/lib/prints/basket";

const offerAll = () => true;
const entries = (value: string) => parseItems(value);

describe("parseItems", () => {
  test("reads comma-separated photo:tier:frame entries", () => {
    expect(entries("fixture-b-01:medium:oak,fixture-b-02:small:unframed")).toEqual([
      { photoId: "fixture-b-01", tier: "medium", frame: "oak" },
      { photoId: "fixture-b-02", tier: "small", frame: "unframed" },
    ]);
  });

  test("anything malformed makes the whole basket empty", () => {
    for (const value of ["", "fixture-b-01:medium:oak,,", "fixture-b-01:MEDIUM:oak", "fixture-b-01: medium:oak", "fixture-b-01:medium", "../x-01:small:oak", "fixture-b-01:medium:oak:2", `${"a".repeat(2001)}`]) {
      expect(entries(value)).toEqual([]);
    }
    expect(parseItems(null)).toEqual([]);
  });

  test("unknown words parse, so validation can count and drop them", () => {
    expect(entries("fixture-b-01:huge:gold")).toEqual([{ photoId: "fixture-b-01", tier: "huge", frame: "gold" }]);
  });
});

describe("validate", () => {
  test("identical entries make one line with a quantity, in the order first seen", () => {
    const { lines } = validate(entries("b-01:medium:oak,b-02:small:unframed,b-01:medium:oak"), offerAll);
    expect(lines).toEqual([
      { photoId: "b-01", tier: "medium", frame: "oak", line: 1, quantity: 2 },
      { photoId: "b-02", tier: "small", frame: "unframed", line: 2, quantity: 1 },
    ]);
    expect(itemsValue(lines)).toBe("b-01:medium:oak,b-01:medium:oak,b-02:small:unframed");
  });

  test("unknown tiers or frames and anything not offered are dropped and counted", () => {
    const offered = (entry: BasketEntry) => entry.photoId !== "gone-01" && !(entry.photoId === "sq-01" && entry.tier !== "small");
    const result = validate(entries("gone-01:small:oak,sq-01:large:oak,sq-01:small:oak,b-01:huge:oak,b-01:small:gold"), offered);
    expect(result.lines.map((line) => `${line.photoId}:${line.tier}`)).toEqual(["sq-01:small"]);
    expect(result.unavailable).toBe(4);
    expect(result.overCap).toBe(0);
  });

  test("a basket holds ten prints; everything past the tenth is dropped and counted", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `p-${String(i + 1).padStart(2, "0")}:small:oak`).join(",");
    const result = validate(entries(eleven), offerAll);
    expect(result.lines).toHaveLength(10);
    expect(result.overCap).toBe(1);
  });

  test("the lines say why prints were taken out", () => {
    expect(droppedNotes(1, 0)).toEqual(["1 print was taken out: that photo isn't available as a print any more."]);
    expect(droppedNotes(2, 1)).toEqual(["2 prints were taken out: those photos aren't available as prints any more.", CAP_NOTE]);
    expect(CAP_NOTE).toBe("a basket holds up to 10 prints.");
    expect(droppedNotes(0, 0)).toEqual([]);
  });
});

describe("changes", () => {
  const lines = groupLines([{ photoId: "b-01", tier: "medium", frame: "oak" }, { photoId: "b-02", tier: "small", frame: "unframed" }]);

  test("add comes from the print row's fields; remove and more name a line", () => {
    expect(readOp(new URLSearchParams("items=x&add=b-01&size=large&frame=oak"))).toEqual({ kind: "add", entry: { photoId: "b-01", tier: "large", frame: "oak" } });
    expect(readOp(new URLSearchParams("remove=2"))).toEqual({ kind: "remove", line: 2 });
    expect(readOp(new URLSearchParams("more=1"))).toEqual({ kind: "more", line: 1 });
    expect(readOp(new URLSearchParams("more=abc"))).toEqual({ kind: "more", line: 0 });
    expect(readOp(new URLSearchParams("items=x"))).toBeNull();
  });

  test("one more adds a print to its line; remove one takes one off and drops an empty line", () => {
    expect(itemsValue(changeLines(lines, { kind: "more", line: 1 }).lines)).toBe("b-01:medium:oak,b-01:medium:oak,b-02:small:unframed");
    const removed = changeLines(lines, { kind: "remove", line: 1 }).lines;
    expect(removed).toEqual([{ photoId: "b-02", tier: "small", frame: "unframed", line: 1, quantity: 1 }]);
    expect(changeLines(lines, { kind: "remove", line: 9 }).lines).toEqual(lines);
  });

  test("one more past ten prints is refused", () => {
    const full = groupLines(Array.from({ length: 10 }, () => ({ photoId: "b-01", tier: "small" as const, frame: "oak" as const })));
    expect(changeLines(full, { kind: "more", line: 1 })).toEqual({ lines: full, refused: true });
  });
});
```

Create `tests/unit/money.test.ts`:

```ts
import { expect, test } from "vitest";
import { aud, gstSentence, plural, rateText, usd } from "../../src/lib/prints/money";

test("dollars read the way the spec writes them", () => {
  expect(aud(23800)).toBe("$238");
  expect(aud(23850)).toBe("$238.50");
  expect(usd(3000)).toBe("us$30.00");
  expect(usd(420)).toBe("us$4.20");
});

test("the rate keeps four decimals at most and two at least", () => {
  expect(rateText(1.5)).toBe("a$1.50");
  expect(rateText(1.5237)).toBe("a$1.5237");
  expect(rateText(1.523)).toBe("a$1.523");
  expect(rateText(1.52)).toBe("a$1.52");
});

test("the gst sentence follows the setting", () => {
  expect(gstSentence("none")).toBe("prices include no gst; the seller isn't registered for gst.");
  expect(gstSentence("inclusive")).toBe("prices include gst for orders posted within australia.");
  expect(plural(1, "print", "prints")).toBe("1 print");
  expect(plural(3, "print", "prints")).toBe("3 prints");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/catalogue.test.ts tests/unit/basket.test.ts tests/unit/money.test.ts`
Expected: FAIL, the modules don't exist.

- [ ] **Step 3: Write the three modules**

Create `src/lib/prints/catalogue.ts`:

```ts
// Print sizes and which photographs get them (spec 14.1). Every print is Artelo's IndividualArtPrint on
// ArchivalMatteFineArt paper, unframed or in its standard oak frame, and every size here is one Artelo frames.

export type Tier = "small" | "medium" | "large";
export type Frame = "unframed" | "oak";
export type Orientation = "Vertical" | "Horizontal";
export const TIERS: readonly Tier[] = ["small", "medium", "large"];
export const FRAMES: readonly Frame[] = ["unframed", "oak"];
export const isTier = (value: string): value is Tier => (TIERS as readonly string[]).includes(value);
export const isFrame = (value: string): value is Frame => (FRAMES as readonly string[]).includes(value);

/** An Artelo ProductSize: inches, short side first (x12x18; x8dot3x11dot7 is 8.3 × 11.7) */
export interface PrintSize {
  size: string;
  short: number;
  long: number;
}

export function parseSize(name: string): PrintSize {
  const [short, long] = name.slice(1).split("x").map((part) => Number(part.replace("dot", ".")));
  return { size: name, short, long };
}

/**
 * Each ratio family's three tiers: the frameable Artelo size of that ratio whose area is nearest the A size the price
 * list names (A4 96.7, A3 193.4, A2 386.9 square inches). The page calls them small, medium and large, because true A
 * sizes would crop every 2:3 photograph by about 6%.
 */
export const FAMILIES: readonly { name: string; ratio: number; tiers: Record<Tier, PrintSize> }[] = [
  { name: "2:3", ratio: 1.5, tiers: { small: parseSize("x8x12"), medium: parseSize("x12x18"), large: parseSize("x16x24") } },
  { name: "3:4", ratio: 4 / 3, tiers: { small: parseSize("x9x12"), medium: parseSize("x12x16"), large: parseSize("x18x24") } },
  { name: "4:5", ratio: 1.25, tiers: { small: parseSize("x8x10"), medium: parseSize("x11x14"), large: parseSize("x16x20") } },
  { name: "iso a", ratio: Math.SQRT2, tiers: { small: parseSize("x8dot3x11dot7"), medium: parseSize("x11dot7x16dot5"), large: parseSize("x16dot5x23dot4") } },
  { name: "1:1", ratio: 1, tiers: { small: parseSize("x10x10"), medium: parseSize("x12x12"), large: parseSize("x20x20") } },
];

export const CROP_TOLERANCE = 0.03;
export const MIN_PPI = 200;

/** The share of the long side cut away when a photograph of ratio r fills a print of ratio p edge to edge */
export const crop = (r: number, p: number) => 1 - Math.min(r, p) / Math.max(r, p);

export interface Offer {
  tier: Tier;
  size: PrintSize;
}
export interface PhotoPrints {
  family: string;
  orientation: Orientation;
  offers: Offer[];
}

/** The sizes a master of width × height pixels prints at, or null when it gets none (spec 14.1) */
export function printsFor(width: number, height: number): PhotoPrints | null {
  if (!(width > 0 && height > 0)) return null;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const r = long / short;
  const family = [...FAMILIES].sort((a, b) => crop(r, a.ratio) - crop(r, b.ratio))[0];
  if (crop(r, family.ratio) > CROP_TOLERANCE) return null;
  const offers = TIERS.flatMap((tier): Offer[] => {
    const print = family.tiers[tier];
    const fits = crop(r, print.long / print.short) <= CROP_TOLERANCE && Math.min(short / print.short, long / print.long) >= MIN_PPI;
    return fits ? [{ tier, size: print }] : [];
  });
  return offers.length > 0 ? { family: family.name, orientation: width > height ? "Horizontal" : "Vertical", offers } : null;
}

export const offerFor = (prints: PhotoPrints | null, tier: Tier): Offer | undefined => prints?.offers.find((offer) => offer.tier === tier);

const cm = (inches: number) => Math.round(inches * 2.54);
/** 12 × 18 in */
export const sizeInches = (size: PrintSize) => `${size.short} × ${size.long} in`;
/** small · 8 × 12 in (20 × 30 cm) */
export const sizeLabel = (offer: Offer) => `${offer.tier} · ${sizeInches(offer.size)} (${cm(offer.size.short)} × ${cm(offer.size.long)} cm)`;
export const frameLabel = (frame: Frame) => (frame === "oak" ? "oak frame" : "unframed");
/** medium · 12 × 18 in · oak frame */
export const printLine = (tier: Tier, size: PrintSize, frame: Frame) => `${tier} · ${sizeInches(size)} · ${frameLabel(frame)}`;
```

Create `src/lib/prints/basket.ts`:

```ts
import { isFrame, isTier, type Frame, type Tier } from "./catalogue";

// The basket lives only in the URL's query string (spec 15.2, ADR-0021 as amended), so anyone can edit it: these pure
// functions parse it, keep what is still on offer and write it back in one canonical form.

export const MAX_PRINTS = 10;
export const CAP_NOTE = "a basket holds up to 10 prints.";

/** An entry as written in the URL, its words not yet checked */
export interface RawEntry {
  photoId: string;
  tier: string;
  frame: string;
}
export interface BasketEntry {
  photoId: string;
  tier: Tier;
  frame: Frame;
}
/** Identical entries make one line; line numbers start at 1 */
export interface BasketLine extends BasketEntry {
  line: number;
  quantity: number;
}

const ENTRY = /^([A-Za-z0-9_-]{1,64}-\d{2,3}):([a-z]{1,12}):([a-z]{1,12})$/;

/** The entries of an items value; anything malformed makes the whole basket empty (spec 15.2) */
export function parseItems(value: string | null): RawEntry[] {
  if (!value || value.length > 2000) return [];
  const entries: RawEntry[] = [];
  for (const part of value.split(",")) {
    const match = ENTRY.exec(part);
    if (!match) return [];
    entries.push({ photoId: match[1], tier: match[2], frame: match[3] });
  }
  return entries;
}

export const printCount = (lines: readonly { quantity: number }[]) => lines.reduce((count, line) => count + line.quantity, 0);

export function groupLines(entries: readonly BasketEntry[]): BasketLine[] {
  const lines: BasketLine[] = [];
  for (const entry of entries) {
    const same = lines.find((line) => line.photoId === entry.photoId && line.tier === entry.tier && line.frame === entry.frame);
    if (same) same.quantity += 1;
    else lines.push({ ...entry, line: lines.length + 1, quantity: 1 });
  }
  return lines;
}

/** What is still on offer, grouped into lines; anything else, and anything past the tenth print, dropped and counted */
export function validate(entries: readonly RawEntry[], offered: (entry: BasketEntry) => boolean): { lines: BasketLine[]; unavailable: number; overCap: number } {
  const kept: BasketEntry[] = [];
  let unavailable = 0;
  let overCap = 0;
  for (const raw of entries) {
    const entry = isTier(raw.tier) && isFrame(raw.frame) ? { photoId: raw.photoId, tier: raw.tier, frame: raw.frame } : null;
    if (!entry || !offered(entry)) unavailable += 1;
    else if (kept.length >= MAX_PRINTS) overCap += 1;
    else kept.push(entry);
  }
  return { lines: groupLines(kept), unavailable, overCap };
}

/** The canonical items value: one entry per print, a line's prints together, lines in order */
export const itemsValue = (lines: readonly BasketLine[]) =>
  lines.flatMap((line) => Array.from({ length: line.quantity }, () => `${line.photoId}:${line.tier}:${line.frame}`)).join(",");
/** "?items=…", or "" for an empty basket. Every character of a canonical value is safe in a query string */
export const itemsQuery = (items: string) => (items ? `?items=${items}` : "");
export const basketHref = (items: string) => `/basket${itemsQuery(items)}`;

export type BasketOp = { kind: "add"; entry: RawEntry } | { kind: "remove" | "more"; line: number };

/** The one change a basket link or the print row asks for, or null */
export function readOp(params: URLSearchParams): BasketOp | null {
  const add = params.get("add");
  if (add !== null) return { kind: "add", entry: { photoId: add, tier: params.get("size") ?? "", frame: params.get("frame") ?? "" } };
  for (const kind of ["remove", "more"] as const) {
    const value = params.get(kind);
    if (value !== null) return { kind, line: /^\d{1,2}$/.test(value) ? Number(value) : 0 };
  }
  return null;
}

/** one more or remove one on a line; one more past ten prints is refused, and an unknown line changes nothing */
export function changeLines(lines: readonly BasketLine[], op: { kind: "remove" | "more"; line: number }): { lines: BasketLine[]; refused: boolean } {
  const next = lines.map((line) => ({ ...line }));
  const target = next.find((line) => line.line === op.line);
  if (!target) return { lines: next, refused: false };
  if (op.kind === "more") {
    if (printCount(next) >= MAX_PRINTS) return { lines: next, refused: true };
    target.quantity += 1;
    return { lines: next, refused: false };
  }
  target.quantity -= 1;
  return { lines: next.filter((line) => line.quantity > 0).map((line, index) => ({ ...line, line: index + 1 })), refused: false };
}

/** Why prints were taken out of a basket (spec 15.2) */
export function droppedNotes(unavailable: number, overCap: number): string[] {
  const notes: string[] = [];
  if (unavailable === 1) notes.push("1 print was taken out: that photo isn't available as a print any more.");
  if (unavailable > 1) notes.push(`${unavailable} prints were taken out: those photos aren't available as prints any more.`);
  if (overCap > 0) notes.push(CAP_NOTE);
  return notes;
}
```

Create `src/lib/prints/money.ts`:

```ts
// How money and the rate read wherever a buyer or George sees them (spec 14.2, 16.3)

/** Australian dollars from cents: $238, or $238.50 when there are cents */
export const aud = (cents: number) => `$${cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)}`;

/** US dollars from cents, always with cents: us$30.00 */
export const usd = (cents: number) => `us$${(cents / 100).toFixed(2)}`;

/** A$ per US$1, to four decimals with trailing zeros trimmed but at least two: a$1.50, a$1.5237 */
export const rateText = (rate: number) => `a$${rate.toFixed(4).replace(/0{1,2}$/, "")}`;

/** The one plain sentence about GST wherever a buyer sees a price (spec 14.2, 17.3) */
export const gstSentence = (mode: "none" | "inclusive") =>
  mode === "inclusive" ? "prices include gst for orders posted within australia." : "prices include no gst; the seller isn't registered for gst.";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
```

- [ ] **Step 4: Run them to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/catalogue.test.ts tests/unit/basket.test.ts tests/unit/money.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prints/catalogue.ts src/lib/prints/basket.ts src/lib/prints/money.ts tests/unit/catalogue.test.ts tests/unit/basket.test.ts tests/unit/money.test.ts
git commit -m "feat: print sizes and eligibility, the basket's query string and how money reads"
```

---

### Task 3: migration 0007, the prints store and order grants

The data layer (spec 22 and 13.3): the price list, the settings, the orders and their lines, the Stripe event ledger and the order grant column, plus one column the spec's schema lacks, `delivery_taxed` (see "Decisions"). `src/lib/prints/store.ts` starts with prices, settings and order rows. The photo store gains the internal order grant: `issueOrderGrant` signs a photo-scoped link carrying its order, and the download route serves an order grant's photo master whether or not the photograph is still published. The unit test helpers every later task uses are written here, once.

**Files:**
- Create: `migrations/0007_prints.sql`, `src/lib/prints/store.ts`, `tests/unit/prints-fakes.ts`, `tests/unit/prints-store.test.ts`, `tests/unit/order-grants.test.ts`
- Modify: `src/lib/photos/store.ts`, `src/lib/photos/download.ts`
- Test: the two new unit tests, `tests/unit/photo-downloads.test.ts` (unchanged, must still pass)

**Interfaces:**
- Consumes: `TIERS`, `FRAMES`, `Tier`, `Frame`, `printsFor`, `offerFor` (Task 2); `PrintConfig`, `PrintDeps`, `PRINT_SECRETS` (Task 1); `sqliteD1()` (existing); `signPhotoToken`, `PHOTO_ID`, `PhotoToken` (existing); `ulid` from `src/lib/admin/ulid.ts` (existing).
- Produces (`src/lib/prints/store.ts`):
  - `type PriceList = Record<Tier, Record<Frame, number>>`; `PRICES_SQL`; `toPrices(rows): PriceList` (throws on a missing price); `loadPrices(db): Promise<PriceList>`
  - `type DailyJob = "fx" | "webhook_check" | "cleanup"`; `DEFAULT_BUFFER = 0.08`; `interface PrintSettings { buffer: number; rate: number | null; rateDate: string | null; arteloWebhookAt: number | null; webhookMissing: boolean; daily: Record<DailyJob, number> }`; `SETTINGS_SQL`; `toSettings(rows): PrintSettings`; `readSettings(db): Promise<PrintSettings>`; `settingStatement(db, key, value, now): D1PreparedStatement`; `writeSetting(db, key, value, now): Promise<void>`
  - `type OrderStatus` (the ten statuses); `interface Shipment { carrier: string; number: string; url: string }`; `interface OrderRow` (every `print_orders` column, snake_case); `getOrder(db, id): Promise<OrderRow | null>`; `shipmentsOf(order: Pick<OrderRow, "shipments">): Shipment[]`
- Produces (`src/lib/photos/store.ts`): `photoMaster(db, id): Promise<PhotoRow | null>`; `interface ActiveGrant { orderId: string | null }`; `activeGrant(db, token, now): Promise<ActiveGrant | null>` (`grantIsActive` keeps its signature on top of it); `issueOrderGrant(db, secret, orderId, photoId, seconds, origin, now?): Promise<string>`; `revokeOrderGrants(db, orderId, now): Promise<number>`
- Produces (`tests/unit/prints-fakes.ts`): `NOW`, `PHOTO_KEY`, `VIEW_SECRET`, `ADDRESS`, `US_ADDRESS`, `testConfig(over?)`, `fakeFetch(handlers)` returning `{ fetch, calls }`, `json(value, status?)`, `masters(missing?)`, `testDeps(db, over?)` (a `PrintDeps` with `waited: Promise<unknown>[]`), `printDb()` (the fixture's print photographs and a stored rate), `insertOrder(db, columns?, lines?)`, `dumpDb(db)`, `captureLogs()`

- [ ] **Step 1: Write the migration**

Create `migrations/0007_prints.sql`:

```sql
-- Prints (spec 22, ADR-0021): applied with wrangler d1 migrations apply, never execute --file
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

CREATE TABLE print_orders (
  id TEXT PRIMARY KEY,                       -- lowercase ULID; Artelo's orderId and Stripe's client_reference_id
  country TEXT NOT NULL CHECK (length(country) = 2),
  print_total INTEGER NOT NULL,              -- AUD cents
  delivery_amount INTEGER NOT NULL,          -- AUD cents
  delivery_taxed INTEGER NOT NULL DEFAULT 0 CHECK (delivery_taxed IN (0, 1)),  -- the line reads "delivery and destination taxes"
  status TEXT NOT NULL CHECK (status IN ('checkout', 'expired', 'paid', 'needs_attention', 'placed',
    'in_production', 'shipped', 'delivered', 'cancelled', 'refunded')),
  attention_reason TEXT,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT UNIQUE,
  artelo_order_id TEXT UNIQUE,
  artelo_status TEXT,
  artelo_cost INTEGER,                       -- US cents, production plus shipping and any tax
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
  admin_notified_at INTEGER,                 -- 0 while an email to George is due (an artelo cancellation, a missed webhook), then when it went
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

Run: `bun run db:migrate:local`
Expected: `0007_prints.sql` applied to `.wrangler/state` (George's local store; the migration only adds tables and a column).

- [ ] **Step 2: Write the test helpers**

Create `tests/unit/prints-fakes.ts`:

```ts
import { vi } from "vitest";
import { ulid } from "../../src/lib/admin/ulid";
import { offerFor, printsFor, type Frame, type Tier } from "../../src/lib/prints/catalogue";
import type { PrintConfig, PrintDeps } from "../../src/lib/prints/config";
import type { OrderStatus } from "../../src/lib/prints/store";
import { sqliteD1 } from "./sqlite-d1";

// Shared by the print unit tests: a config, deps, a store holding the e2e fixture's print photographs, orders and a fetch
// that answers from a table, so no test reaches Stripe, Artelo or the exchange rate.

/** 2026-10-08T22:53:20Z */
export const NOW = 1_791_500_000;
export const PHOTO_KEY = "1".repeat(64);
export const VIEW_SECRET = "2".repeat(64);
export const SHA = "e5".repeat(32);

export const ADDRESS = { name: "Ada Lovelace", line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postcode: "2026", country: "AU", phone: "+61 400 000 000" };
export const US_ADDRESS = { name: "Grace Hopper", line1: "1600 Example Avenue", line2: "", city: "Arlington", state: "VA", postcode: "22201", country: "US", phone: "+1 202 555 0100" };

export function testConfig(over: Partial<PrintConfig> = {}): PrintConfig {
  return {
    switchedOn: true, sellerName: "george vlachos", gst: "none", gstTaxRate: "", fromEmail: "prints@curiousgeorge.dev",
    siteOrigin: "https://curiousgeorge.dev", adminEmail: "hello@curiousgeorge.dev", arteloBase: "https://artelo.test", stripeBase: "https://stripe.test",
    fxUrl: "https://fx.test/latest",
    secrets: {
      STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", ARTELO_API_KEY: "artelo-fixture-key",
      ARTELO_WEBHOOK_SECRET: "artelo-fixture-webhook-secret", PRINT_VIEW_SECRET: VIEW_SECRET, PHOTO_LINK_SECRET: PHOTO_KEY,
    },
    missing: [], retryWindow: 86_400, emailSink: null, testClients: false,
    ...over,
  };
}

export type Handler = (request: Request) => Response | Promise<Response>;
export interface Call {
  method: string;
  url: string;
  body: string;
  headers: Headers;
}

/** A fetch answering "METHOD origin+path" from the table and recording every call; anything unanswered is a network error */
export function fakeFetch(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, url: request.url, body: await request.clone().text(), headers: request.headers });
    const handler = handlers[`${request.method} ${url.origin}${url.pathname}`];
    if (!handler) throw new TypeError(`fetch failed: nothing answers ${request.method} ${url.origin}${url.pathname}`);
    return handler(request);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

/** PHOTO_PRINTS with every master present except those of the photographs named */
export const masters = (missing: string[] = []) =>
  ({ head: vi.fn(async (key: string) => (missing.some((id) => key.startsWith(`prints/${id}/`)) ? null : { size: 1000, httpMetadata: { contentType: "image/jpeg" } })) }) as unknown as R2Bucket;

export function testDeps(db: D1Database, over: Partial<PrintDeps> = {}): PrintDeps & { waited: Promise<unknown>[] } {
  const waited: Promise<unknown>[] = [];
  return { db, config: testConfig(), fetch: fakeFetch({}).fetch, now: () => NOW, photoPrints: masters(), email: null, waitUntil: (promise) => void waited.push(promise), waited, ...over };
}

const previews = (id: string, width: number, height: number) =>
  [240, 480].flatMap((size) => {
    const scale = size / Math.max(width, height);
    return (["webp", "avif"] as const).map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: Math.round(width * scale), height: Math.round(height * scale), format }));
  });

/**
 * The e2e fixture's print-relevant photographs (spec 11.3): fixture-b-01 (4000 × 6000) and fixture-b-02 (6000 × 4000)
 * get all three sizes, fixture-01 and fixture-02 (2048 square) small only, fixture-03 is hidden and fixture-c-01
 * (1200 × 1800) gets none. A rate of 1.50 is stored, as the e2e servers seed it.
 */
export async function printDb(): Promise<D1Database> {
  const db = sqliteD1();
  const posts: [string, string, string | null][] = [["fixture", "2026-09-27T18:30:00+10:00", "bondi, sydney"], ["fixture-b", "2026-06-14T09:15:00+10:00", null], ["fixture-c", "2026-03-01T12:00:00+11:00", "fremantle, perth"]];
  for (const [collection, at, place] of posts) {
    await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)").bind(collection, Date.parse(at) / 1000, at.slice(0, 10), place).run();
  }
  const photos: [string, string, number, number, number, string][] = [
    ["fixture-01", "fixture", 2048, 2048, 1, "a test photograph"], ["fixture-02", "fixture", 2048, 2048, 1, ""], ["fixture-03", "fixture", 2048, 2048, 0, ""],
    ["fixture-b-01", "fixture-b", 4000, 6000, 1, ""], ["fixture-b-02", "fixture-b", 6000, 4000, 1, ""], ["fixture-c-01", "fixture-c", 1200, 1800, 1, ""],
  ];
  for (const [position, [id, collection, width, height, published, title]] of photos.entries()) {
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, collection, position, title, published, JSON.stringify(previews(id, width, height)), `prints/${id}/${SHA}.jpg`, width, height, 1000, SHA).run();
  }
  await db.prepare("INSERT INTO print_settings (key, value, updated_at) VALUES ('usd_aud', '1.5', 0), ('usd_aud_date', '2026-10-07', 0)").run();
  return db;
}

const PRICES: Record<Tier, Record<Frame, number>> = { small: { unframed: 5900, oak: 13900 }, medium: { unframed: 7900, oak: 17900 }, large: { unframed: 11900, oak: 25900 } };
const DIMENSIONS: Record<string, [number, number]> = { "fixture-01": [2048, 2048], "fixture-02": [2048, 2048], "fixture-b-01": [4000, 6000], "fixture-b-02": [6000, 4000] };

/**
 * An order (paid by default: due now, a day to place it) with its lines, sizes and prices as checkout would write them.
 * `columns` overrides any print_orders column. Returns its id.
 */
export async function insertOrder(db: D1Database, columns: Record<string, string | number | null> = {}, lines: [string, Tier, Frame, number][] = [["fixture-b-01", "medium", "oak", 1], ["fixture-b-02", "small", "unframed", 1]]): Promise<string> {
  const id = typeof columns.id === "string" ? columns.id : ulid(NOW * 1000);
  const printTotal = lines.reduce((sum, [, tier, frame, quantity]) => sum + PRICES[tier][frame] * quantity, 0);
  const row: Record<string, string | number | null> = {
    id, country: "AU", print_total: printTotal, delivery_amount: 4900, delivery_taxed: 0, status: "paid" satisfies OrderStatus, livemode: 0,
    stripe_session_id: `cs_test_${id}`, stripe_payment_intent: `pi_test_${id}`, attempts: 0, next_attempt_at: NOW, retry_until: NOW + 86_400,
    created_at: NOW - 600, paid_at: NOW - 60, updated_at: NOW,
    ...columns,
  };
  const names = Object.keys(row);
  await db.batch([
    db.prepare(`INSERT INTO print_orders (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).bind(...names.map((name) => row[name])),
    ...lines.map(([photoId, tier, frame, quantity], index) => {
      const [width, height] = DIMENSIONS[photoId] ?? [4000, 6000];
      const size = offerFor(printsFor(width, height), tier)?.size.size ?? "";
      return db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, index + 1, photoId, tier, size, frame, quantity, PRICES[tier][frame]);
    }),
  ]);
  return id;
}

/** Every row of every table as one string, to prove what is never stored */
export async function dumpDb(db: D1Database): Promise<string> {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results as { name: string }[];
  const rows = await Promise.all(tables.map(async ({ name }) => JSON.stringify((await db.prepare(`SELECT * FROM "${name}"`).all()).results)));
  return rows.join("\n");
}

/** Silences the console and returns everything it was given, to prove what is never logged */
export function captureLogs(): () => string {
  const spies = (["log", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  return () => spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))).join("\n");
}
```

- [ ] **Step 3: Write the failing unit tests**

Create `tests/unit/prints-store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { getOrder, loadPrices, readSettings, shipmentsOf, toPrices, toSettings, writeSetting } from "../../src/lib/prints/store";
import { insertOrder, NOW } from "./prints-fakes";
import { sqliteD1 } from "./sqlite-d1";

let db: D1Database;
beforeEach(() => {
  db = sqliteD1();
});

describe("migration 0007", () => {
  test("seeds the agreed price list and an 8% buffer, and no exchange rate", async () => {
    expect(await loadPrices(db)).toEqual({ small: { unframed: 5900, oak: 13900 }, medium: { unframed: 7900, oak: 17900 }, large: { unframed: 11900, oak: 25900 } });
    const settings = await readSettings(db);
    expect(settings.buffer).toBe(0.08);
    expect(settings.rate).toBeNull();
  });

  test("the schema refuses an unknown status, an eleventh line, bad shipments and a reused session", async () => {
    await expect(insertOrder(db, { status: "lost" })).rejects.toThrow();
    await expect(insertOrder(db, {}, Array.from({ length: 11 }, (): [string, "small", "oak", number] => ["fixture-b-01", "small", "oak", 1]))).rejects.toThrow();
    await expect(insertOrder(db, { shipments: "not json" })).rejects.toThrow();
    await insertOrder(db, { id: "01k0000000000000000000000a", stripe_session_id: "cs_test_same" });
    await expect(insertOrder(db, { id: "01k0000000000000000000000b", stripe_session_id: "cs_test_same" })).rejects.toThrow();
  });

  test("grants carry an order id", async () => {
    await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at, order_id) VALUES ('g', NULL, 1, 'o')").run();
    expect(await db.prepare("SELECT order_id FROM photo_download_grants").first("order_id")).toBe("o");
  });
});

describe("prices and settings", () => {
  test("a missing price refuses to sell for nothing", () => {
    expect(() => toPrices([{ tier: "small", frame: "oak", amount: 13900 }])).toThrow("no print price for small unframed");
  });

  test("the rate counts only inside 0.8 to 3, the date only as YYYY-MM-DD, the buffer only inside 0 to 0.2", () => {
    const read = (rows: [string, string][]) => toSettings(rows.map(([key, value]) => ({ key, value })));
    expect(read([["usd_aud", "1.5237"], ["usd_aud_date", "2026-10-07"]])).toMatchObject({ rate: 1.5237, rateDate: "2026-10-07" });
    expect(read([["usd_aud", "0.5"]]).rate).toBeNull();
    expect(read([["usd_aud", "abc"], ["usd_aud_date", "07.10.26"]])).toMatchObject({ rate: null, rateDate: null });
    expect(read([["delivery_buffer", "0.5"]]).buffer).toBe(0.08);
    expect(read([["delivery_buffer", "0"]]).buffer).toBe(0);
    expect(read([["artelo_webhook_at", "1791000000"], ["artelo_webhook_missing", "1"], ["daily_fx_at", "5"]])).toMatchObject({ arteloWebhookAt: 1791000000, webhookMissing: true, daily: { fx: 5, webhook_check: 0, cleanup: 0 } });
  });

  test("writing a setting replaces it", async () => {
    await writeSetting(db, "delivery_buffer", "0.1", NOW);
    await writeSetting(db, "delivery_buffer", "0.12", NOW + 1);
    expect((await readSettings(db)).buffer).toBe(0.12);
    expect(await db.prepare("SELECT updated_at FROM print_settings WHERE key = 'delivery_buffer'").first("updated_at")).toBe(NOW + 1);
  });
});

test("an order reads back whole, with its shipments", async () => {
  const id = await insertOrder(db, { shipments: JSON.stringify([{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }]) });
  const order = await getOrder(db, id);
  expect(order).toMatchObject({ id, status: "paid", print_total: 23800, delivery_amount: 4900, delivery_taxed: 0, livemode: 0 });
  expect(shipmentsOf(order!)).toEqual([{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }]);
  expect(shipmentsOf({ shipments: null })).toEqual([]);
  expect(await getOrder(db, "missing")).toBeNull();
});
```

Create `tests/unit/order-grants.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadAdmin } from "../../src/lib/admin/store";
import { downloadPhoto } from "../../src/lib/photos/download";
import { insertGrant, issueOrderGrant, revokeCatalogueLink, revokeOrderGrants } from "../../src/lib/photos/store";
import { signPhotoToken, verifyPhotoToken } from "../../src/lib/photos/tokens";
import { NOW, PHOTO_KEY, printDb } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";
let db: D1Database;
let errors: ReturnType<typeof vi.spyOn>;

const bucket = () =>
  ({
    head: vi.fn(async () => ({ size: 1000, httpEtag: '"e"', httpMetadata: { contentType: "image/jpeg" } })),
    get: vi.fn(async () => ({ size: 1000, httpEtag: '"e"', httpMetadata: { contentType: "image/jpeg" }, body: new Blob([new Uint8Array(1000)]).stream() })),
  }) as unknown as R2Bucket;
const get = (url: string) => new Request(url);

beforeEach(async () => {
  db = await printDb();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("order grants", () => {
  test("an order grant is scoped to one photo, carries its order and links to the master's route", async () => {
    const link = await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 72 * 3600, "https://curiousgeorge.dev", NOW);
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe("https://curiousgeorge.dev/photos/downloads/fixture-b-01");
    const token = await verifyPhotoToken(PHOTO_KEY, url.searchParams.get("token")!, NOW);
    expect(token).toMatchObject({ photoId: "fixture-b-01", expiresAt: NOW + 72 * 3600 });
    expect(await db.prepare("SELECT photo_id, order_id FROM photo_download_grants WHERE id = ?").bind(token!.grantId).first()).toEqual({ photo_id: "fixture-b-01", order_id: ORDER });
  });

  test("it serves its photo's master after the photo is hidden; a catalogue link doesn't", async () => {
    const link = new URL(await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW));
    await db.prepare("UPDATE photos SET published = 0 WHERE id = 'fixture-b-01'").run();
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(link.href), NOW)).status).toBe(200);
    // Its token names one photo: another is refused
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-02", get(link.href.replace("fixture-b-01", "fixture-b-02")), NOW)).status).toBe(403);
    const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: NOW + 3600 };
    await insertGrant(db, grant);
    const catalogue = await signPhotoToken(PHOTO_KEY, grant, NOW);
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(`https://curiousgeorge.dev/photos/downloads/fixture-b-01?token=${catalogue}`), NOW)).status).toBe(404);
  });

  test("revoking an order's grants stops them, and the admin's revoke can't touch them", async () => {
    const link = new URL(await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW));
    const token = await verifyPhotoToken(PHOTO_KEY, link.searchParams.get("token")!, NOW);
    expect(await revokeCatalogueLink(db, token!.grantId, NOW)).toBe("photo");
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(link.href), NOW)).status).toBe(200);
    expect(await revokeOrderGrants(db, ORDER, NOW)).toBe(1);
    expect(await revokeOrderGrants(db, ORDER, NOW)).toBe(0);
    expect((await downloadPhoto(db, bucket(), PHOTO_KEY, "fixture-b-01", get(link.href), NOW)).status).toBe(403);
  });

  test("order grants never appear among the admin's working links", async () => {
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", Math.floor(Date.now() / 1000));
    expect((await loadAdmin(db)).links).toEqual([]);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/prints-store.test.ts tests/unit/order-grants.test.ts`
Expected: FAIL, `src/lib/prints/store.ts` and the photo store's new functions don't exist.

- [ ] **Step 5: Write the prints store**

Create `src/lib/prints/store.ts`:

```ts
import { FRAMES, TIERS, type Frame, type Tier } from "./catalogue";

// The prints tables (migration 0007): the fixed price list, the settings and the orders. Addresses are never written
// here (spec 21.2): an order row holds its country, amounts, ids, statuses and bookkeeping, nothing personal.

/** AUD cents by tier and frame (spec 14.2) */
export type PriceList = Record<Tier, Record<Frame, number>>;

export const PRICES_SQL = "SELECT tier, frame, amount FROM print_prices";

export function toPrices(rows: readonly { tier: string; frame: string; amount: number }[]): PriceList {
  const prices = Object.fromEntries(TIERS.map((tier) => [tier, Object.fromEntries(FRAMES.map((frame) => [frame, 0]))])) as PriceList;
  for (const row of rows) {
    if ((TIERS as readonly string[]).includes(row.tier) && (FRAMES as readonly string[]).includes(row.frame)) prices[row.tier as Tier][row.frame as Frame] = row.amount;
  }
  // A missing price would sell a print for nothing: refuse to carry on
  for (const tier of TIERS) for (const frame of FRAMES) if (!(prices[tier][frame] > 0)) throw new Error(`no print price for ${tier} ${frame}`);
  return prices;
}

export async function loadPrices(db: D1Database): Promise<PriceList> {
  return toPrices((await db.prepare(PRICES_SQL).all()).results as unknown as { tier: string; frame: string; amount: number }[]);
}

/** The daily jobs of spec 18.6, each with its own timestamp in print_settings (daily_<job>_at) */
export type DailyJob = "fx" | "webhook_check" | "cleanup";

export const DEFAULT_BUFFER = 0.08;

export interface PrintSettings {
  /** Added to Artelo's delivery for exchange-rate movement: 0 to 0.2 (spec 16.4) */
  buffer: number;
  /** A$ per US$1, the ECB's, or null when none is stored (prints are then closed) */
  rate: number | null;
  /** The ECB's date for the rate, YYYY-MM-DD */
  rateDate: string | null;
  /** When Artelo's webhook last arrived (seconds) */
  arteloWebhookAt: number | null;
  /** The daily check found no webhook at Artelo */
  webhookMissing: boolean;
  /** When each daily job last ran (seconds; 0 for never) */
  daily: Record<DailyJob, number>;
}

export const SETTINGS_SQL = "SELECT key, value FROM print_settings";

export function toSettings(rows: readonly { key: string; value: string }[]): PrintSettings {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const number = (key: string) => {
    const value = values.get(key);
    const parsed = value === undefined || value.trim() === "" ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const buffer = number("delivery_buffer");
  const rate = number("usd_aud");
  const rateDate = values.get("usd_aud_date") ?? null;
  return {
    buffer: buffer !== null && buffer >= 0 && buffer <= 0.2 ? buffer : DEFAULT_BUFFER,
    rate: rate !== null && rate >= 0.8 && rate <= 3 ? rate : null,
    rateDate: rateDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(rateDate) ? rateDate : null,
    arteloWebhookAt: number("artelo_webhook_at"),
    webhookMissing: values.get("artelo_webhook_missing") === "1",
    daily: { fx: number("daily_fx_at") ?? 0, webhook_check: number("daily_webhook_check_at") ?? 0, cleanup: number("daily_cleanup_at") ?? 0 },
  };
}

export async function readSettings(db: D1Database): Promise<PrintSettings> {
  return toSettings((await db.prepare(SETTINGS_SQL).all()).results as unknown as { key: string; value: string }[]);
}

export const settingStatement = (db: D1Database, key: string, value: string, now: number) =>
  db.prepare("INSERT INTO print_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, value, now);

export async function writeSetting(db: D1Database, key: string, value: string, now: number): Promise<void> {
  await settingStatement(db, key, value, now).run();
}

export type OrderStatus = "checkout" | "expired" | "paid" | "needs_attention" | "placed" | "in_production" | "shipped" | "delivered" | "cancelled" | "refunded";

/** A parcel's tracking, as stored in print_orders.shipments: a parcel's details, not a person's */
export interface Shipment {
  carrier: string;
  number: string;
  url: string;
}

export interface OrderRow {
  id: string;
  country: string;
  print_total: number;
  delivery_amount: number;
  delivery_taxed: number;
  status: OrderStatus;
  attention_reason: string | null;
  livemode: number;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  artelo_order_id: string | null;
  artelo_status: string | null;
  artelo_cost: number | null;
  shipments: string | null;
  refunded_amount: number | null;
  attempts: number;
  next_attempt_at: number | null;
  retry_until: number | null;
  lease_until: number | null;
  created_at: number;
  paid_at: number | null;
  placed_at: number | null;
  shipped_at: number | null;
  refunded_at: number | null;
  status_checked_at: number | null;
  shipped_email_at: number | null;
  attention_notified_at: number | null;
  /** 0 while George's cancellation or missed-webhook email is due, then when it went; null when none is due */
  admin_notified_at: number | null;
  updated_at: number;
}

export async function getOrder(db: D1Database, id: string): Promise<OrderRow | null> {
  return db.prepare("SELECT * FROM print_orders WHERE id = ?").bind(id).first<OrderRow>();
}

export function shipmentsOf(order: Pick<OrderRow, "shipments">): Shipment[] {
  if (!order.shipments) return [];
  const parsed: unknown = JSON.parse(order.shipments);
  return Array.isArray(parsed) ? (parsed as Shipment[]) : [];
}
```

- [ ] **Step 6: Add order grants to the photo store and the download route**

In `src/lib/photos/store.ts`, change the first line to:

```ts
import { GRANT_ID, PHOTO_ID, signPhotoToken, type PhotoToken } from "./tokens";
```

Replace the whole `grantIsActive` function with:

```ts
/** What an active grant says about itself: a print order's grant carries the order (spec 13.3) */
export interface ActiveGrant {
  orderId: string | null;
}

/** The grant behind a verified token when it is still working and matches the token exactly; null otherwise */
export async function activeGrant(db: D1Database, token: PhotoToken, now: number): Promise<ActiveGrant | null> {
  const row = await db.prepare("SELECT photo_id, expires_at, revoked_at, order_id FROM photo_download_grants WHERE id = ?").bind(token.grantId)
    .first<{ photo_id: string | null; expires_at: number; revoked_at: number | null; order_id: string | null }>();
  if (!row || row.revoked_at !== null || row.expires_at <= now || row.expires_at !== token.expiresAt || row.photo_id !== token.photoId) return null;
  return { orderId: row.order_id };
}

export async function grantIsActive(db: D1Database, token: PhotoToken, now: number): Promise<boolean> {
  return (await activeGrant(db, token, now)) !== null;
}

/** A photograph's row whatever its publication: an order's link serves a paid print even if the photo is hidden later (spec 13.3) */
export async function photoMaster(db: D1Database, id: string): Promise<PhotoRow | null> {
  if (!PHOTO_ID.test(id)) return null;
  return db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first<PhotoRow>();
}

/**
 * The internal link Artelo fetches a paid print's master from (spec 18.2 step 4): a photo-scoped grant carrying its
 * order, signed for `seconds`. Only print fulfilment calls this; no person ever receives the link (ADR-0020 as amended).
 */
export async function issueOrderGrant(db: D1Database, secret: string, orderId: string, photoId: string, seconds: number, origin: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const grant = { grantId: crypto.randomUUID(), photoId, expiresAt: now + seconds };
  const token = await signPhotoToken(secret, grant, now);
  await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at, order_id) VALUES (?, ?, ?, ?)").bind(grant.grantId, photoId, grant.expiresAt, orderId).run();
  const url = new URL(`/photos/downloads/${photoId}`, origin);
  url.searchParams.set("token", token);
  return url.href;
}

/** Switches off every working grant of one order, once its prints are in production (spec 18.3); returns how many */
export async function revokeOrderGrants(db: D1Database, orderId: string, now: number): Promise<number> {
  const result = await db.prepare("UPDATE photo_download_grants SET revoked_at = ? WHERE order_id = ? AND revoked_at IS NULL").bind(now, orderId).run();
  return result.meta.changes;
}
```

In `src/lib/photos/download.ts`, change the import line from `./store` to:

```ts
import { activeGrant, photoById, photoMaster } from "./store";
```

and replace the two lines from `const token = await verifyPhotoToken(…)` through `const photo = await photoById(db, id);` with:

```ts
    const token = await verifyPhotoToken(secret, requestToken(request), now);
    const grant = token && (token.photoId === null || token.photoId === id) ? await activeGrant(db, token, now) : null;
    if (!token || !grant) return photoError("This download link is invalid or expired.", 403);
    // A print order's grant serves its photo's current master whether or not it is published (spec 13.3); a catalogue
    // link still needs publication
    const photo = grant.orderId !== null && token.photoId === id ? await photoMaster(db, id) : await photoById(db, id);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/prints-store.test.ts tests/unit/order-grants.test.ts tests/unit/photo-downloads.test.ts tests/unit/link-actions.test.ts tests/unit/photo-links-route.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 8: Commit**

```bash
git add migrations/0007_prints.sql src/lib/prints/store.ts src/lib/photos/store.ts src/lib/photos/download.ts tests/unit/prints-fakes.ts tests/unit/prints-store.test.ts tests/unit/order-grants.test.ts
git commit -m "feat: migration 0007, the prints store and the internal order grant"
```

---

### Task 4: the address rules, the delivery arithmetic, Artelo's Price Check and the exchange rate

Spec 1.2 step 4 with what it needs (sections 15.4, 16.1, 16.4): the address form's server-side rules and Stripe's country list, the arithmetic that turns Artelo's quoted freight and destination taxes into one delivery line, a small Artelo client that never throws, the Price Check call and the daily exchange-rate job, the first step the cron runs.

**Files:**
- Create: `src/lib/prints/address.ts`, `src/lib/prints/countries.ts`, `src/lib/prints/quote.ts`, `src/lib/prints/artelo.ts`, `src/lib/prints/fx.ts`, `tests/unit/address.test.ts`, `tests/unit/quote.test.ts`, `tests/unit/artelo.test.ts`, `tests/unit/fx.test.ts`
- Modify: `src/lib/prints/cron.ts`, `tests/unit/cron.test.ts`
- Test: the four new unit tests and `tests/unit/cron.test.ts`

**Interfaces:**
- Consumes: `PrintDeps` (Task 1); `Frame`, `Orientation`, `PrintSize` (Task 2); `usd`, `rateText` (Task 2); `readSettings`, `writeSetting`, `settingStatement`, `DailyJob` (Task 3); `testDeps`, `fakeFetch`, `json`, `printDb`, `ADDRESS`, `US_ADDRESS`, `NOW`, `captureLogs` (Task 3).
- Produces (`src/lib/prints/address.ts`): `ADDRESS_FIELDS`; `type AddressField`; `type Address = Record<AddressField, string>`; `type AddressErrors = Partial<Record<AddressField, string>>`; `EMPTY_ADDRESS`; `readAddress(form: FormData): Address`; `checkAddress(fields: Address): { ok: true; address: Address } | { ok: false; errors: AddressErrors }`; `postingTo(address: Address): string`
- Produces (`src/lib/prints/countries.ts`): `COUNTRY_CODES: ReadonlySet<string>`; `countryName(code: string): string`; `countryOptions(): [string, string][]`
- Produces (`src/lib/prints/quote.ts`): `interface TaxLine { field: string; label: string; cents: number }`; `interface OrderCosts { freightCents: number; productionCents: number | null; taxes: TaxLine[]; unknown: string[] }`; `cents(dollars: number): number`; `readOrderCosts(value: unknown): OrderCosts | null`; `deliveryAmount(freightCents: number, taxes: readonly TaxLine[], rate: number, buffer: number): number` (AUD cents, whole dollars); `hasTax(taxes): boolean`; `deliveryLabel(taxes): "delivery" | "delivery and destination taxes"`; `breakdown(q: { freightCents: number; taxes: readonly TaxLine[]; rate: number; buffer: number }): string`
- Produces (`src/lib/prints/artelo.ts`): `ARTELO_TIMEOUT_MS`; `type ArteloResult = { ok: true; status: number; body: unknown } | { ok: false; status: number | null; message: string }`; `artelo(deps, method: "GET" | "POST", path: string, body?: unknown): Promise<ArteloResult>`; `messageOf(body: unknown, text: string): string`; `arteloAddress(address: Address)`; `interface ProductLine { size: PrintSize; frame: Frame; orientation: Orientation }`; `productInfo(line: ProductLine, design?: string)`; `interface QuoteLine extends ProductLine { line: number; quantity: number; unitAmount: number }`; `priceCheckBody(lines, address, rate, quoteId)`; `type PriceCheck = { ok: true; costs: OrderCosts } | { ok: false; refused: string | null }`; `priceCheck(deps, lines: readonly QuoteLine[], address: Address, rate: number): Promise<PriceCheck>`
- Produces (`src/lib/prints/fx.ts`): `refreshRate(deps): Promise<"stored" | "ignored" | "failed">`
- Produces (`src/lib/prints/cron.ts`): `DAILY_EVERY = 72_000`; `daily(deps, job: DailyJob, run: () => Promise<boolean>): Promise<void>`; `cronSteps` now runs the exchange rate

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/address.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { checkAddress, postingTo, readAddress, type Address } from "../../src/lib/prints/address";
import { COUNTRY_CODES, countryName, countryOptions } from "../../src/lib/prints/countries";
import { ADDRESS } from "./prints-fakes";

const check = (over: Partial<Address>) => checkAddress({ ...ADDRESS, ...over });
const errorsOf = (over: Partial<Address>) => {
  const result = check(over);
  return result.ok ? {} : result.errors;
};

describe("checkAddress", () => {
  test("a full address passes as it is", () => {
    expect(check({})).toEqual({ ok: true, address: ADDRESS });
  });

  test("required fields say what's missing; optional ones may be empty", () => {
    expect(errorsOf({ name: "", line1: "", city: "", country: "", phone: "" })).toEqual({
      name: "add your name.", line1: "add the street address.", city: "add the city or suburb.", country: "choose a country.", phone: "add a phone number.",
    });
    expect(check({ line2: "", state: "", postcode: "" }).ok).toBe(true);
  });

  test("each field has its length", () => {
    expect(errorsOf({ name: "a".repeat(101), line1: "a".repeat(101), line2: "a".repeat(101), city: "a".repeat(61), state: "a".repeat(61), postcode: "a".repeat(21) })).toEqual({
      name: "100 characters at most.", line1: "100 characters at most.", line2: "100 characters at most.", city: "60 characters at most.", state: "60 characters at most.", postcode: "20 characters at most.",
    });
    expect(check({ name: "a".repeat(100), city: "a".repeat(60), postcode: "a".repeat(20) }).ok).toBe(true);
  });

  test("the phone: 6 to 20 characters of digits, spaces, +, -, ( and ), with at least six digits", () => {
    expect(errorsOf({ phone: "12345" }).phone).toBe("that phone number looks too short.");
    expect(errorsOf({ phone: "+1 (2) -" }).phone).toBe("that phone number looks too short.");
    expect(errorsOf({ phone: "0400 000 000 ext 1" }).phone).toBe("use digits, spaces, +, -, ( and ) only.");
    expect(errorsOf({ phone: "+61 (0) 400-000-00000" }).phone).toBe("20 characters at most.");
    expect(check({ phone: "123456" }).ok).toBe(true);
    expect(check({ phone: "+61 (02) 9000-0000" }).ok).toBe(true);
  });

  test("one line of plain text, and only a country stripe ships to", () => {
    expect(errorsOf({ line1: "12 Example\nStreet" }).line1).toBe("one line of plain text.");
    expect(errorsOf({ country: "ZZ" }).country).toBe("choose a country.");
    expect(errorsOf({ country: "au" }).country).toBe("choose a country.");
  });

  test("names in other scripts and with punctuation pass untouched (review focus 1)", () => {
    const address = { ...ADDRESS, name: "Zoë O'Brien & Sons", line1: "東京都渋谷区 1-2-3", line2: "<b>unit</b> 3", country: "JP" };
    expect(checkAddress(address)).toEqual({ ok: true, address });
  });
});

test("readAddress trims every field and treats a missing one as empty", () => {
  const form = new FormData();
  form.set("name", "  Ada Lovelace ");
  form.set("country", "AU");
  expect(readAddress(form)).toEqual({ name: "Ada Lovelace", line1: "", line2: "", city: "", state: "", postcode: "", country: "AU", phone: "" });
});

test("posting to reads like an address on an envelope", () => {
  expect(postingTo(ADDRESS)).toBe("Ada Lovelace, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia");
  expect(postingTo({ ...ADDRESS, line2: "", state: "", postcode: "" })).toBe("Ada Lovelace, 12 Example Street, Bondi Beach, australia");
});

test("countries: stripe's list, named in en-AU and lowercased, sorted by name", () => {
  expect(COUNTRY_CODES.has("AU") && COUNTRY_CODES.has("US") && COUNTRY_CODES.has("AQ")).toBe(true);
  expect(COUNTRY_CODES.has("ZZ")).toBe(false);
  expect(countryName("AU")).toBe("australia");
  expect(countryName("US")).toBe("united states");
  const options = countryOptions();
  expect(options).toHaveLength(COUNTRY_CODES.size);
  const names = options.map(([, name]) => name);
  expect([...names].sort(new Intl.Collator("en-AU").compare)).toEqual(names);
  expect(names.every((name) => name === name.toLowerCase())).toBe(true);
});
```

Create `tests/unit/quote.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { breakdown, deliveryAmount, deliveryLabel, readOrderCosts } from "../../src/lib/prints/quote";

describe("readOrderCosts", () => {
  test("freight is arteloShipping; every tax field is kept with its label, known ones first", () => {
    const costs = readOrderCosts({ productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, gst: 0, hst: 0, pst: 0, total: 114.2 });
    expect(costs).toEqual({ freightCents: 3000, productionCents: 8000, taxes: [{ field: "usSalesTax", label: "us sales tax", cents: 420 }], unknown: [] });
  });

  test("canadian taxes and any field that looks like a tax are passed on; other new charges are named for the log", () => {
    const costs = readOrderCosts({ arteloShipping: 25, gst: 1.25, pst: 1.75, importVat: 2, customsDuty: 0.5, branding: 0, holidayFees: 0, packagingFee: 1 })!;
    expect(costs.taxes).toEqual([
      { field: "gst", label: "canadian gst", cents: 125 },
      { field: "pst", label: "canadian pst", cents: 175 },
      { field: "customsDuty", label: "customsduty", cents: 50 },
      { field: "importVat", label: "importvat", cents: 200 },
    ]);
    expect(costs.unknown).toEqual(["packagingFee"]);
  });

  test("an answer without a usable arteloShipping can't be quoted", () => {
    for (const value of [null, [], {}, { arteloShipping: "30" }, { arteloShipping: -1 }, { arteloShipping: Number.NaN }]) expect(readOrderCosts(value)).toBeNull();
  });
});

describe("deliveryAmount", () => {
  test("freight and tax, converted, plus the buffer, rounded up to the dollar (spec 16.1 and 23.2)", () => {
    expect(deliveryAmount(3000, [], 1.5, 0.08)).toBe(4900);
    expect(deliveryAmount(3000, [{ field: "usSalesTax", label: "us sales tax", cents: 420 }], 1.5, 0.08)).toBe(5600);
  });

  test("an exact dollar stays that dollar, whatever floating point does", () => {
    expect(deliveryAmount(2500, [], 1.6, 0)).toBe(4000);
  });

  test("anything over a dollar rounds up to the next", () => {
    // 10 × 1.1 × 1.1 is 12.1
    expect(deliveryAmount(1000, [], 1.1, 0.1)).toBe(1300);
  });
});

describe("labels and the breakdown", () => {
  const tax = [{ field: "usSalesTax", label: "us sales tax", cents: 420 }];

  test("the line names destination taxes only when there are any", () => {
    expect(deliveryLabel([])).toBe("delivery");
    expect(deliveryLabel(tax)).toBe("delivery and destination taxes");
  });

  test("the breakdown says what artelo charged and how it became dollars", () => {
    expect(breakdown({ freightCents: 3000, taxes: [], rate: 1.5, buffer: 0.08 })).toBe(
      "artelo's freight us$30.00 for this address, converted at a$1.50 per us$1, plus 8% in case the exchange rate moves, rounded up to the dollar.",
    );
    expect(breakdown({ freightCents: 3000, taxes: tax, rate: 1.5, buffer: 0.08 })).toBe(
      "artelo's freight us$30.00 and us sales tax us$4.20 for this address, converted at a$1.50 per us$1, plus 8% in case the exchange rate moves, rounded up to the dollar. artelo charges me that tax for posting to this address, so it's passed on at cost.",
    );
  });

  test("several taxes are listed without an oxford comma; no buffer leaves its clause out", () => {
    const text = breakdown({ freightCents: 2500, taxes: [{ field: "gst", label: "canadian gst", cents: 125 }, { field: "pst", label: "canadian pst", cents: 175 }], rate: 1.5237, buffer: 0 });
    expect(text).toBe(
      "artelo's freight us$25.00, canadian gst us$1.25 and canadian pst us$1.75 for this address, converted at a$1.5237 per us$1, rounded up to the dollar. artelo charges me those taxes for posting to this address, so they're passed on at cost.",
    );
  });
});
```

Create `tests/unit/artelo.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { artelo, arteloAddress, priceCheck, priceCheckBody, productInfo, type QuoteLine } from "../../src/lib/prints/artelo";
import { parseSize } from "../../src/lib/prints/catalogue";
import { ADDRESS, captureLogs, fakeFetch, json, printDb, testDeps, US_ADDRESS, type Handler } from "./prints-fakes";

const LINES: QuoteLine[] = [
  { line: 1, quantity: 1, unitAmount: 17900, size: parseSize("x12x18"), frame: "oak", orientation: "Vertical" },
  { line: 2, quantity: 2, unitAmount: 5900, size: parseSize("x8x12"), frame: "unframed", orientation: "Horizontal" },
];
const PRICE_CHECK = "POST https://artelo.test/orders/price-check";
const answering = async (handler: Handler) => {
  const fake = fakeFetch({ [PRICE_CHECK]: handler });
  return { fake, deps: testDeps(await printDb(), { fetch: fake.fetch }) };
};

afterEach(() => vi.restoreAllMocks());

describe("the request", () => {
  test("the address maps as at order time: street2 only when present, phone outside the us", () => {
    expect(arteloAddress(ADDRESS)).toEqual({ name: "Ada Lovelace", street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" });
    expect(arteloAddress(US_ADDRESS)).toEqual({ name: "Grace Hopper", street1: "1600 Example Avenue", city: "Arlington", state: "VA", zipcode: "22201", country: "US" });
    // No state: the city stands in; no postcode: an empty zipcode
    expect(arteloAddress({ ...ADDRESS, state: "", postcode: "" })).toMatchObject({ city: "Bondi Beach", state: "Bondi Beach", zipcode: "" });
  });

  test("one item per line with the order's product info and no designs, the price in us dollars for information", () => {
    const body = priceCheckBody(LINES, ADDRESS, 1.5, "quote-0123456789abcdef");
    expect(body).toMatchObject({ orderId: "quote-0123456789abcdef", currency: "USD", customerAddress: arteloAddress(ADDRESS) });
    expect(body.items).toEqual([
      { orderItemId: "1", quantity: 1, unitPrice: 119.33, productInfo: productInfo(LINES[0]) },
      { orderItemId: "2", quantity: 2, unitPrice: 39.33, productInfo: productInfo(LINES[1]) },
    ]);
    expect(productInfo(LINES[0])).toEqual({
      catalogProductId: "IndividualArtPrint", size: "x12x18", frameColor: "NaturalOak", paperType: "ArchivalMatteFineArt", orientation: "Vertical",
      canvasDesignedFor: null, canvasBorderStyle: null, includeFramingService: false, includeHangingPins: false, includeMats: false,
    });
    expect(productInfo(LINES[1]).frameColor).toBeNull();
    expect(productInfo(LINES[0], "https://x/master")).toMatchObject({ designs: [{ sourceImage: { url: "https://x/master" }, fitOptions: { canvas: "Paper", style: "Outside" } }] });
  });

  test("the key goes in the authorization header, with a 15-second timeout", async () => {
    const { fake, deps } = await answering(() => json({ orderCosts: { arteloShipping: 30 } }));
    await artelo(deps, "POST", "/orders/price-check", {});
    expect(fake.calls[0].headers.get("authorization")).toBe("Bearer artelo-fixture-key");
    expect((vi.mocked(fake.fetch).mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("priceCheck", () => {
  test("a quote reads the freight and taxes, with an orderId that is never stored", async () => {
    const { fake, deps } = await answering(() => json({ orderCosts: { productionCost: 80, arteloShipping: 30, usSalesTax: 4.2, total: 114.2 } }));
    expect(await priceCheck(deps, LINES, US_ADDRESS, 1.5)).toEqual({ ok: true, costs: { freightCents: 3000, productionCents: 8000, taxes: [{ field: "usSalesTax", label: "us sales tax", cents: 420 }], unknown: [] } });
    expect(JSON.parse(fake.calls[0].body).orderId).toMatch(/^quote-[0-9a-f]{16}$/);
  });

  test("a 400 or 422 is artelo refusing, with its message cut to 200 characters and logged only as a status", async () => {
    const logs = captureLogs();
    const { deps } = await answering(() => json({ message: `we don't deliver to Antarctica ${"x".repeat(300)}` }, 400));
    const result = await priceCheck(deps, LINES, { ...ADDRESS, country: "AQ" }, 1.5);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.refused?.length).toBe(200);
    expect(!result.ok && result.refused?.startsWith("we don't deliver to Antarctica")).toBe(true);
    expect(logs()).not.toMatch(/Antarctica|Ada|Example Street/);
    const unprocessable = await answering(() => json({ errors: [{ message: "unknown size" }] }, 422));
    expect(await priceCheck(unprocessable.deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: "unknown size" });
  });

  test("a refusal whose body is a proxy's html page has no message to show (review focus 5)", async () => {
    captureLogs();
    const { deps } = await answering(() => new Response("<html><body>Bad Request</body></html>", { status: 400, headers: { "Content-Type": "text/html" } }));
    expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: "" });
  });

  test("anything else is artelo being unavailable: 401, 403, 408, 429, 5xx, html, timeouts and network errors", async () => {
    captureLogs();
    for (const status of [401, 403, 408, 429, 500, 502, 503]) {
      const { deps } = await answering(() => new Response("<html>bad gateway</html>", { status, headers: { "Content-Type": "text/html" } }));
      expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    }
    for (const handler of [() => { throw new DOMException("timed out", "TimeoutError"); }, () => { throw new TypeError("network"); }, () => new Response("<html>ok</html>", { status: 200 }), () => json({ total: 3 })] as Handler[]) {
      const { deps } = await answering(handler);
      expect(await priceCheck(deps, LINES, ADDRESS, 1.5)).toEqual({ ok: false, refused: null });
    }
  });

  test("a charge this site doesn't know is logged by name, and the quote goes ahead", async () => {
    const logs = captureLogs();
    const { deps } = await answering(() => json({ orderCosts: { arteloShipping: 30, remoteAreaFee: 5 } }));
    expect((await priceCheck(deps, LINES, ADDRESS, 1.5)).ok).toBe(true);
    expect(logs()).toContain("remoteAreaFee");
  });
});
```

Create `tests/unit/fx.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { refreshRate } from "../../src/lib/prints/fx";
import { readSettings } from "../../src/lib/prints/store";
import { captureLogs, fakeFetch, json, NOW, testDeps, type Handler } from "./prints-fakes";
import { sqliteD1 } from "./sqlite-d1";

const withFx = (handler: Handler) => testDeps(sqliteD1(), { fetch: fakeFetch({ "GET https://fx.test/latest": handler }).fetch });

afterEach(() => vi.restoreAllMocks());

test("stores the ecb's rate and date from frankfurter's answer", async () => {
  const deps = withFx(() => json({ amount: 1, base: "USD", date: "2026-10-07", rates: { AUD: 1.5237 } }));
  expect(await refreshRate(deps)).toBe("stored");
  expect(await readSettings(deps.db)).toMatchObject({ rate: 1.5237, rateDate: "2026-10-07" });
  expect(await deps.db.prepare("SELECT updated_at FROM print_settings WHERE key = 'usd_aud'").first("updated_at")).toBe(NOW);
});

test("a rate outside 0.8 to 3, or without a date, is ignored and logged, and the stored one kept", async () => {
  const logs = captureLogs();
  const deps = withFx(() => json({ date: "2026-10-07", rates: { AUD: 1.5 } }));
  await refreshRate(deps);
  for (const body of [{ date: "2026-10-07", rates: { AUD: 15 } }, { date: "2026-10-07", rates: { AUD: 0.5 } }, { rates: { AUD: 1.6 } }, { date: "2026-10-07", rates: {} }]) {
    const odd = testDeps(deps.db, { fetch: fakeFetch({ "GET https://fx.test/latest": () => json(body) }).fetch });
    expect(await refreshRate(odd)).toBe("ignored");
  }
  expect((await readSettings(deps.db)).rate).toBe(1.5);
  expect(logs()).toContain("prints: ignored an exchange rate");
});

test("a failed fetch changes nothing and says it failed", async () => {
  captureLogs();
  expect(await refreshRate(withFx(() => new Response("down", { status: 503 })))).toBe("failed");
  expect(await refreshRate(withFx(() => { throw new TypeError("network"); }))).toBe("failed");
  expect(await refreshRate(withFx(() => new Response("not json")))).toBe("failed");
});
```

Append to `tests/unit/cron.test.ts`:

```ts
import { daily } from "../../src/lib/prints/cron";
import { readSettings } from "../../src/lib/prints/store";
import { NOW, testDeps } from "./prints-fakes";
import { sqliteD1 } from "./sqlite-d1";

test("a daily job runs when its timestamp is over 20 hours old, and records the time only when it is done", async () => {
  const deps = testDeps(sqliteD1());
  const job = vi.fn(async () => true);
  await daily(deps, "fx", job);
  expect(job).toHaveBeenCalledTimes(1);
  expect((await readSettings(deps.db)).daily.fx).toBe(NOW);
  await daily(testDeps(deps.db, { now: () => NOW + 20 * 3600 - 1 }), "fx", job);
  expect(job).toHaveBeenCalledTimes(1);
  await daily(testDeps(deps.db, { now: () => NOW + 20 * 3600 }), "fx", job);
  expect(job).toHaveBeenCalledTimes(2);
  const failing = vi.fn(async () => false);
  await daily(deps, "cleanup", failing);
  expect((await readSettings(deps.db)).daily.cleanup).toBe(0);
});
```

(Move the new imports to the top of the file beside the existing ones.)

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/address.test.ts tests/unit/quote.test.ts tests/unit/artelo.test.ts tests/unit/fx.test.ts tests/unit/cron.test.ts`
Expected: FAIL, the modules and `daily` don't exist.

- [ ] **Step 3: Write the address rules and the countries**

Create `src/lib/prints/countries.ts`:

```ts
// Every ISO 3166 code Stripe accepts as a shipping country (its allowed_countries list, API version 2025-09-30.clover),
// named in Australian English and lowercased (spec 16.4). The page never guesses the visitor's country.
const CODES =
  "AC AD AE AF AG AI AL AM AO AQ AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT " +
  "JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL " +
  "NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TA TC TD TF TG TH TJ " +
  "TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW";

export const COUNTRY_CODES: ReadonlySet<string> = new Set(CODES.split(" "));

// Built on first use, not at import: most pages that import this never name a country
let names: Intl.DisplayNames | undefined;

export function countryName(code: string): string {
  names ??= new Intl.DisplayNames("en-AU", { type: "region" });
  return (names.of(code) ?? code).toLowerCase();
}

/** [code, name] for the country select, sorted by name */
export function countryOptions(): [string, string][] {
  const collator = new Intl.Collator("en-AU");
  return [...COUNTRY_CODES].map((code): [string, string] => [code, countryName(code)]).sort((a, b) => collator.compare(a[1], b[1]));
}
```

Create `src/lib/prints/address.ts`:

```ts
import { countryName, COUNTRY_CODES } from "./countries";

// The delivery address (spec 15.4). It travels only in form bodies, to Stripe and to Artelo, and is never stored or
// logged (spec 21.2): these rules run on the server, which trusts nothing the form sends.

export const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "state", "postcode", "country", "phone"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type Address = Record<AddressField, string>;
export type AddressErrors = Partial<Record<AddressField, string>>;

export const EMPTY_ADDRESS: Address = { name: "", line1: "", line2: "", city: "", state: "", postcode: "", country: "", phone: "" };

/** Every field from a posted form, trimmed; anything missing (or a file) is "" */
export function readAddress(form: FormData): Address {
  const address = { ...EMPTY_ADDRESS };
  for (const name of ADDRESS_FIELDS) {
    const value = form.get(name);
    address[name] = typeof value === "string" ? value.trim() : "";
  }
  return address;
}

const RULES: Record<AddressField, { required?: string; max: number }> = {
  name: { required: "add your name.", max: 100 },
  line1: { required: "add the street address.", max: 100 },
  line2: { max: 100 },
  city: { required: "add the city or suburb.", max: 60 },
  state: { max: 60 },
  postcode: { max: 20 },
  country: { required: "choose a country.", max: 2 },
  phone: { required: "add a phone number.", max: 20 },
};
/** Control characters and line or paragraph separators: every field is one line of printable text */
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function checkAddress(fields: Address): { ok: true; address: Address } | { ok: false; errors: AddressErrors } {
  const errors: AddressErrors = {};
  for (const name of ADDRESS_FIELDS) {
    const value = fields[name];
    const rule = RULES[name];
    if (NOT_ONE_LINE.test(value)) errors[name] = "one line of plain text.";
    else if (value === "" && rule.required) errors[name] = rule.required;
    else if (name !== "country" && value.length > rule.max) errors[name] = `${rule.max} characters at most.`;
  }
  if (!errors.country && !COUNTRY_CODES.has(fields.country)) errors.country = "choose a country.";
  if (!errors.phone) {
    // The carrier may need it; digits and the usual separators only
    if (!/^[0-9 +()-]+$/.test(fields.phone)) errors.phone = "use digits, spaces, +, -, ( and ) only.";
    else if (fields.phone.length < 6 || (fields.phone.match(/\d/g) ?? []).length < 6) errors.phone = "that phone number looks too short.";
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, address: { ...fields } };
}

/** The address on one line, for Stripe's page: name, street, unit, "city state postcode", country (spec 17.1) */
export function postingTo(address: Address): string {
  const place = [address.city, address.state, address.postcode].filter(Boolean).join(" ");
  return [address.name, address.line1, address.line2, place, countryName(address.country)].filter(Boolean).join(", ");
}
```

- [ ] **Step 4: Write the delivery arithmetic**

Create `src/lib/prints/quote.ts`:

```ts
// Value imports here carry their .ts extension: bun run prints:check (Task 14) runs this file under plain Node
import { rateText, usd } from "./money.ts";

// Delivery is Artelo's exact quoted freight for the whole basket and address, plus any destination tax Artelo quotes,
// converted to dollars with a small buffer and rounded up (spec 16.1). George neither profits nor loses on it.

/** One destination tax from Price Check's orderCosts, in US cents, with its label for the breakdown */
export interface TaxLine {
  field: string;
  label: string;
  cents: number;
}

export interface OrderCosts {
  /** arteloShipping, in US cents */
  freightCents: number;
  /** productionCost, in US cents, when Artelo sent it */
  productionCents: number | null;
  /** Every non-zero tax field */
  taxes: TaxLine[];
  /** Numeric fields that are neither a known cost nor a tax, by name, so a new Artelo charge is noticed */
  unknown: string[];
}

const KNOWN_COSTS = new Set(["productionCost", "arteloShipping", "branding", "customPricingAdjustment", "holidayFees", "wholesaleDiscount", "amountRefunded", "total"]);
const TAX_ORDER = ["usSalesTax", "gst", "hst", "pst"];
const TAX_LABELS: Record<string, string> = { usSalesTax: "us sales tax", gst: "canadian gst", hst: "canadian hst", pst: "canadian pst" };
const TAX_LIKE = /tax|vat|gst|hst|pst|duty/i;
const rank = (field: string) => (TAX_ORDER.includes(field) ? TAX_ORDER.indexOf(field) : TAX_ORDER.length);

export const cents = (dollars: number) => Math.round(dollars * 100);

/** Reads Price Check's orderCosts (or an order's details); null when there is no usable arteloShipping */
export function readOrderCosts(value: unknown): OrderCosts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const costs = value as Record<string, unknown>;
  const freight = costs.arteloShipping;
  if (typeof freight !== "number" || !Number.isFinite(freight) || freight < 0) return null;
  const taxes: TaxLine[] = [];
  const unknown: string[] = [];
  for (const [field, amount] of Object.entries(costs)) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || KNOWN_COSTS.has(field)) continue;
    if (TAX_ORDER.includes(field) || TAX_LIKE.test(field)) {
      if (amount !== 0) taxes.push({ field, label: TAX_LABELS[field] ?? field.toLowerCase(), cents: cents(amount) });
    } else unknown.push(field);
  }
  taxes.sort((a, b) => rank(a.field) - rank(b.field) || a.field.localeCompare(b.field));
  const production = costs.productionCost;
  return { freightCents: cents(freight), productionCents: typeof production === "number" && Number.isFinite(production) ? cents(production) : null, taxes, unknown };
}

/** AUD cents, a whole number of dollars: ceil((freight + tax) × rate × (1 + buffer)) */
export function deliveryAmount(freightCents: number, taxes: readonly TaxLine[], rate: number, buffer: number): number {
  const usdCents = freightCents + taxes.reduce((sum, tax) => sum + tax.cents, 0);
  const dollars = (usdCents / 100) * rate * (1 + buffer);
  // Six decimals first, so a product like 25 × 1.6 = 40.000000000000004 stays 40
  return Math.ceil(Number(dollars.toFixed(6))) * 100;
}

export const hasTax = (taxes: readonly TaxLine[]) => taxes.some((tax) => tax.cents > 0);

/** The line's name on the basket, Stripe's page, the order page and the admin (spec 16.1) */
export const deliveryLabel = (taxes: readonly TaxLine[]): "delivery" | "delivery and destination taxes" => (hasTax(taxes) ? "delivery and destination taxes" : "delivery");

/** How the delivery line was reached, from the sealed figures (spec 16.3) */
export function breakdown(quote: { freightCents: number; taxes: readonly TaxLine[]; rate: number; buffer: number }): string {
  const parts = [`artelo's freight ${usd(quote.freightCents)}`, ...quote.taxes.map((tax) => `${tax.label} ${usd(tax.cents)}`)];
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  const buffer = Math.round(quote.buffer * 100);
  let text = `${list} for this address, converted at ${rateText(quote.rate)} per us$1${buffer > 0 ? `, plus ${buffer}% in case the exchange rate moves` : ""}, rounded up to the dollar.`;
  if (quote.taxes.length === 1) text += " artelo charges me that tax for posting to this address, so it's passed on at cost.";
  if (quote.taxes.length > 1) text += " artelo charges me those taxes for posting to this address, so they're passed on at cost.";
  return text;
}
```

- [ ] **Step 5: Write the Artelo client and Price Check**

Create `src/lib/prints/artelo.ts`:

```ts
import type { Address } from "./address";
import type { Frame, Orientation, PrintSize } from "./catalogue";
import type { PrintDeps } from "./config";
// With its extension: bun run prints:check (Task 14) runs this file under plain Node, which resolves no bare relative paths
import { readOrderCosts, type OrderCosts } from "./quote.ts";

// Artelo's open API (spec 16.1, 18.2, 18.3), through fetch with the key and a 15-second timeout. Nothing here throws:
// every call answers ok with a body, or not ok with a status (null for a network error, a timeout or an unreadable 2xx).

export const ARTELO_TIMEOUT_MS = 15_000;

export type ArteloResult = { ok: true; status: number; body: unknown } | { ok: false; status: number | null; message: string };

/** Artelo's own message from an error body, at most 200 characters; "" when it has none (a proxy's html page, say) */
export function messageOf(body: unknown, text: string): string {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const first = Array.isArray(record.errors) ? record.errors[0] : undefined;
  const candidates = [record.message, record.error, record.title, first, first && typeof first === "object" ? (first as Record<string, unknown>).message : undefined];
  const found = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
  const plain = body === null && text && !/<[a-z!/]/i.test(text) ? text : "";
  return (found ?? plain).replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function artelo(deps: PrintDeps, method: "GET" | "POST", path: string, body?: unknown): Promise<ArteloResult> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.config.arteloBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${deps.config.secrets.ARTELO_API_KEY}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ARTELO_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: null, message: "" };
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return parsed === null ? { ok: false, status: null, message: "" } : { ok: true, status: response.status, body: parsed };
  return { ok: false, status: response.status, message: messageOf(parsed, text) };
}

/** The address as Artelo takes it, the same for a quote and an order (spec 16.1, 18.2 step 5) */
export function arteloAddress(address: Address) {
  return {
    name: address.name,
    street1: address.line1,
    ...(address.line2 ? { street2: address.line2 } : {}),
    city: address.city || address.state,
    state: address.state || address.city,
    zipcode: address.postcode,
    country: address.country,
    // Artelo needs a phone only outside the US
    ...(address.country === "US" ? {} : { phone: address.phone }),
  };
}

export interface ProductLine {
  size: PrintSize;
  frame: Frame;
  orientation: Orientation;
}

/** One print as Artelo makes it (spec 14.1): its size, oak or no frame, the paper, its orientation; designs only at order time */
export function productInfo(line: ProductLine, design?: string) {
  return {
    catalogProductId: "IndividualArtPrint",
    size: line.size.size,
    frameColor: line.frame === "oak" ? "NaturalOak" : null,
    paperType: "ArchivalMatteFineArt",
    orientation: line.orientation,
    canvasDesignedFor: null,
    canvasBorderStyle: null,
    includeFramingService: false,
    includeHangingPins: false,
    includeMats: false,
    ...(design ? { designs: [{ sourceImage: { url: design }, fitOptions: { canvas: "Paper", style: "Outside" } }] } : {}),
  };
}

export interface QuoteLine extends ProductLine {
  line: number;
  quantity: number;
  /** AUD cents */
  unitAmount: number;
}

export function priceCheckBody(lines: readonly QuoteLine[], address: Address, rate: number, quoteId: string) {
  return {
    orderId: quoteId,
    currency: "USD",
    customerAddress: arteloAddress(address),
    // unitPrice is informational: the tier price converted to US dollars at the current rate
    items: lines.map((line) => ({ orderItemId: String(line.line), quantity: line.quantity, unitPrice: Math.round(line.unitAmount / rate) / 100, productInfo: productInfo(line) })),
  };
}

const hex = (count: number) => [...crypto.getRandomValues(new Uint8Array(count))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** refused is Artelo's message (possibly "") when it won't quote this basket or address; null when it couldn't be asked */
export type PriceCheck = { ok: true; costs: OrderCosts } | { ok: false; refused: string | null };

/** Artelo's quote for the whole basket to this address (spec 16.1). Its refusals are logged only as a status code */
export async function priceCheck(deps: PrintDeps, lines: readonly QuoteLine[], address: Address, rate: number): Promise<PriceCheck> {
  const result = await artelo(deps, "POST", "/orders/price-check", priceCheckBody(lines, address, rate, `quote-${hex(8)}`));
  if (!result.ok) {
    if (result.status === 400 || result.status === 422) {
      console.error("prints: artelo refused a price check", result.status);
      return { ok: false, refused: result.message };
    }
    console.error("prints: artelo's price check is unavailable", result.status ?? "no answer");
    return { ok: false, refused: null };
  }
  const costs = readOrderCosts((result.body as { orderCosts?: unknown } | null)?.orderCosts);
  if (!costs) {
    console.error("prints: artelo's price check answer couldn't be read");
    return { ok: false, refused: null };
  }
  if (costs.unknown.length > 0) console.warn("prints: artelo's price check has charges this site doesn't know:", costs.unknown.join(", "));
  return { ok: true, costs };
}
```

- [ ] **Step 6: Write the exchange-rate job and run it daily**

Create `src/lib/prints/fx.ts`:

```ts
import type { PrintDeps } from "./config";
import { settingStatement } from "./store";

/**
 * The European Central Bank's reference rate from Frankfurter (no key, no visitor data), into print_settings (spec 16.4).
 * "ignored" (a rate outside 0.8 to 3, or no date) counts as done for the day, so a bad answer isn't logged every five
 * minutes; "failed" (no answer) is tried again on the next run.
 */
export async function refreshRate(deps: PrintDeps): Promise<"stored" | "ignored" | "failed"> {
  let body: unknown;
  try {
    const response = await deps.fetch(deps.config.fxUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      console.error("prints: the exchange rate answered", response.status);
      return "failed";
    }
    body = await response.json();
  } catch (error) {
    console.error("prints: couldn't fetch the exchange rate", error instanceof Error ? error.message : String(error));
    return "failed";
  }
  const { rates, date } = (body ?? {}) as { rates?: { AUD?: unknown }; date?: unknown };
  const rate = rates?.AUD;
  if (typeof rate !== "number" || !(rate >= 0.8 && rate <= 3) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("prints: ignored an exchange rate outside 0.8 to 3, or without a date:", JSON.stringify(rate ?? null));
    return "ignored";
  }
  const now = deps.now();
  await deps.db.batch([settingStatement(deps.db, "usd_aud", String(rate), now), settingStatement(deps.db, "usd_aud_date", date, now)]);
  return "stored";
}
```

In `src/lib/prints/cron.ts`, replace the import line with:

```ts
import type { PrintDeps } from "./config";
import { refreshRate } from "./fx";
import { readSettings, writeSetting, type DailyJob } from "./store";

/** A daily job runs when its timestamp is this old: 20 hours, so a five-minute cron drifting never skips a day */
export const DAILY_EVERY = 20 * 3600;

/** Runs a daily job (spec 18.6) when its print_settings timestamp is over 20 hours old, and records the time once it is done */
export async function daily(deps: PrintDeps, job: DailyJob, run: () => Promise<boolean>): Promise<void> {
  const settings = await readSettings(deps.db);
  if (deps.now() - settings.daily[job] < DAILY_EVERY) return;
  if (await run()) await writeSetting(deps.db, `daily_${job}_at`, String(deps.now()), deps.now());
}
```

and replace the whole `cronSteps` function with:

```ts
/** The five-minute run's steps, in spec 18.6's order. The webhooks are the accelerator; this is the guarantee */
export function cronSteps(deps: PrintDeps): CronStep[] {
  return [
    ["exchange rate", () => daily(deps, "fx", async () => (await refreshRate(deps)) !== "failed")],
  ];
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/address.test.ts tests/unit/quote.test.ts tests/unit/artelo.test.ts tests/unit/fx.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/prints/address.ts src/lib/prints/countries.ts src/lib/prints/quote.ts src/lib/prints/artelo.ts src/lib/prints/fx.ts src/lib/prints/cron.ts tests/unit/address.test.ts tests/unit/quote.test.ts tests/unit/artelo.test.ts tests/unit/fx.test.ts tests/unit/cron.test.ts
git commit -m "feat: the address rules, the delivery arithmetic, artelo's price check and the daily exchange rate"
```

---

### Task 5: the print row, when prints are open and the basket carried through the gallery

Spec 1.2 step 5 (sections 15.1, 15.3 and 16.5): a `prints` row on a photograph's page, between `photo` and `say hi`, shown only while prints are open and the photograph gets a size; the basket carried through `/photos`, `/photos?before=` and `/photos/<id>` when the URL has `items`, never edge-cached then; ` some come as prints.` on the home page's photo line and the gallery's intro while open. The provider stand-in on 4401 and the prints e2e server on 4337 start here, because this is the first page with prints on it.

**Files:**
- Create: `src/lib/prints/open.ts`, `src/lib/prints/carry.ts`, `src/components/prints/PrintRow.astro`, `src/styles/prints.css`, `tests/fixtures/artelo-site.mjs`, `tests/e2e/prints-site.ts`, `tests/e2e/prints.ts`, `tests/e2e/prints-basket.spec.ts`, `tests/unit/open.test.ts`, `tests/unit/carry.test.ts`, `tests/unit/print-row.test.ts`
- Modify: `src/lib/prints/store.ts`, `src/lib/photos/gallery.ts`, `src/components/photos/Entry.astro`, `src/components/photos/Gallery.astro`, `src/components/photos/PhotoView.astro`, `src/scripts/photo-sheet.ts`, `src/pages/photos/index.astro`, `src/pages/photos/[id].astro`, `src/pages/index.astro`, `src/components/Logbook.astro`, `playwright.config.ts`, `tests/unit/gallery-page.test.ts`, `tests/unit/logbook-page.test.ts`
- Test: the three new unit tests, the two modified ones, `tests/unit/gallery.test.ts` and `tests/unit/photo-view.test.ts` (unchanged, must pass), `tests/e2e/prints-basket.spec.ts`, `tests/e2e/gallery.spec.ts` and `tests/e2e/photo-page.spec.ts` (unchanged, must pass)

**Interfaces:**
- Consumes: `PrintConfig`, `printConfig` (Task 1); `printsFor`, `offerFor`, `sizeLabel`, `PhotoPrints`, `Orientation`, `PrintSize` (Task 2); `parseItems`, `validate`, `itemsValue`, `itemsQuery`, `basketHref`, `printCount`, `BasketLine`, `RawEntry` (Task 2); `aud`, `gstSentence`, `plural` (Task 2); `PRICES_SQL`, `SETTINGS_SQL`, `toPrices`, `toSettings`, `readSettings`, `PriceList`, `PrintSettings` (Task 3); `QuoteLine` (Task 4); `photoName`, `previewOf` (plan 6, `src/lib/photos/gallery.ts`); `previewSize`, `Preview`, `PublicPreview` (plan 6, `src/lib/photos/store.ts`).
- Produces (`src/lib/prints/store.ts`): `interface BasketPhoto { id; title; date; width; height; index; total; published: boolean; previews: PublicPreview[] }`; `PHOTO_FACTS` (SQL, filtered by the caller); `interface FactRow`; `toBasketPhoto(row: FactRow): BasketPhoto`; `photoNameOf(photo: BasketPhoto): string`; `interface PricedLine extends BasketLine, QuoteLine { name: string; thumb: PublicPreview | null; image: PublicPreview | null }`; `interface ResolvedBasket { lines: PricedLine[]; items: string; count: number; printTotal: number; unavailable: number; overCap: number }`; `priceBasket(entries, photos, prices): ResolvedBasket`; `loadBasket(db, entries): Promise<{ basket: ResolvedBasket; settings: PrintSettings }>`; `resolveBasket(db, entries): Promise<ResolvedBasket>`; `loadPrintContext(db): Promise<{ prices: PriceList; settings: PrintSettings }>`
- Produces (`src/lib/prints/open.ts`): `type PrintsStatus = { open: true } | { open: false; reason: string }`; `canOpen(config): boolean`; `printsStatus(config, rate: number | null): PrintsStatus`; `printsOpenNow(config, db): Promise<boolean>`
- Produces (`src/lib/prints/carry.ts`): `interface Carry { items: string; count: number }`; `readCarry(db, url: URL): Promise<Carry | null>`; `carried(href: string, carry: Carry | null): string`; `carryLabel(carry: Carry): string`
- Produces: `frameView(photo, index, total, query = "")` (plan 6's, with the basket's query on its `href`); `Gallery`'s new props `carry?: Carry | null` and `prints?: boolean`; `PhotoView`'s new props `prints?: { offers: PhotoPrints; prices: PriceList; gst: string } | null` and `carry?: Carry | null`; `Logbook`'s new prop `prints?: boolean`
- Produces (e2e): the stand-in on 4401 (`GET /fx`, `GET /__requests`, a `route(method, path, handler)` registry later tasks add to above the final `start();`); `tests/e2e/prints-site.ts` with `PRINTS`, `PRINTS_STRIPE`, `STAND_IN`, `FIXTURE_STRIPE_KEY`, `FIXTURE_SECRETS`, `printStore(store)`, `printVars(origin)`; `tests/e2e/prints.ts` with `unique()`, `printsD1(sql, store?)`, `standIn(path, init?)`; the prints server on 4337

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/open.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { printsOpenNow, printsStatus } from "../../src/lib/prints/open";
import { printDb, testConfig } from "./prints-fakes";

afterEach(() => vi.restoreAllMocks());

test("open needs the switch, every secret and a stored rate, and says which is missing", () => {
  expect(printsStatus(testConfig(), 1.5)).toEqual({ open: true });
  expect(printsStatus(testConfig({ switchedOn: false }), 1.5)).toEqual({ open: false, reason: 'PRINTS_OPEN isn\'t "true"' });
  expect(printsStatus(testConfig({ missing: ["ARTELO_API_KEY"] }), 1.5)).toEqual({ open: false, reason: "this secret isn't set: ARTELO_API_KEY" });
  expect(printsStatus(testConfig({ missing: ["STRIPE_SECRET_KEY", "ARTELO_API_KEY", "PRINT_VIEW_SECRET"] }), 1.5)).toEqual({ open: false, reason: "these secrets aren't set: STRIPE_SECRET_KEY, ARTELO_API_KEY and PRINT_VIEW_SECRET" });
  expect(printsStatus(testConfig(), null)).toEqual({ open: false, reason: "no exchange rate has been fetched yet" });
});

test("printsOpenNow reads the rate only when it could open, and a failed read keeps prints closed", async () => {
  const db = await printDb();
  expect(await printsOpenNow(testConfig(), db)).toBe(true);
  const prepare = vi.fn(() => { throw new Error("D1 is down"); });
  expect(await printsOpenNow(testConfig({ switchedOn: false }), { prepare } as unknown as D1Database)).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await printsOpenNow(testConfig(), { prepare } as unknown as D1Database)).toBe(false);
  await db.prepare("DELETE FROM print_settings WHERE key = 'usd_aud'").run();
  expect(await printsOpenNow(testConfig(), db)).toBe(false);
});
```

Create `tests/unit/carry.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { parseItems } from "../../src/lib/prints/basket";
import { carried, carryLabel, readCarry } from "../../src/lib/prints/carry";
import { loadBasket } from "../../src/lib/prints/store";
import { printDb } from "./prints-fakes";

const at = (query: string) => new URL(`https://curiousgeorge.dev/photos${query}`);

afterEach(() => vi.restoreAllMocks());

describe("loadBasket", () => {
  test("prices each line from the list, names its photo and keeps its 240 and 480 previews", async () => {
    const { basket, settings } = await loadBasket(await printDb(), parseItems("fixture-b-01:medium:oak,fixture-b-02:small:unframed,fixture-b-01:medium:oak"));
    expect(settings.rate).toBe(1.5);
    expect(basket).toMatchObject({ items: "fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed", count: 3, printTotal: 41700, unavailable: 0, overCap: 0 });
    expect(basket.lines.map((line) => [line.line, line.name, line.size.size, line.orientation, line.unitAmount, line.quantity])).toEqual([
      [1, "photo 1 of 2 from 14.06.26", "x12x18", "Vertical", 17900, 2],
      [2, "photo 2 of 2 from 14.06.26", "x8x12", "Horizontal", 5900, 1],
    ]);
    expect(basket.lines[0].thumb).toMatchObject({ url: expect.stringMatching(/\/media\/photos\/previews\/fixture-b-01\/.+\/240\.webp$/), width: 160, height: 240 });
    expect(basket.lines[0].image?.url).toMatch(/\/480\.webp$/);
  });

  test("a hidden photo, a size it doesn't get and an unknown photo are dropped and counted", async () => {
    const { basket } = await loadBasket(await printDb(), parseItems("fixture-03:small:oak,fixture-01:medium:oak,nobody-01:small:oak,fixture-01:small:oak"));
    expect(basket.lines.map((line) => `${line.photoId}:${line.tier}`)).toEqual(["fixture-01:small"]);
    expect(basket.lines[0].name).toBe('"a test photograph"');
    expect(basket.unavailable).toBe(3);
  });
});

describe("the carried basket", () => {
  test("a valid items parameter is carried in its canonical form, with its count", async () => {
    expect(await readCarry(await printDb(), at("?items=fixture-b-02:small:oak,fixture-b-01:large:unframed,fixture-b-02:small:oak"))).toEqual({
      items: "fixture-b-02:small:oak,fixture-b-02:small:oak,fixture-b-01:large:unframed", count: 3,
    });
  });

  test("no items, nothing valid or a failed read carries nothing", async () => {
    const db = await printDb();
    expect(await readCarry(db, at(""))).toBeNull();
    expect(await readCarry(db, at("?items=nobody-01:small:oak"))).toBeNull();
    expect(await readCarry(db, at("?items=garbage"))).toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCarry({ batch: () => Promise.reject(new Error("down")), prepare: () => ({ bind: () => ({}) }) } as unknown as D1Database, at("?items=fixture-01:small:oak"))).toBeNull();
  });

  test("links carry it after any query and before any fragment; the label counts prints", () => {
    const carry = { items: "fixture-01:small:oak", count: 1 };
    expect(carried("/photos", carry)).toBe("/photos?items=fixture-01:small:oak");
    expect(carried("/photos?before=12#post-x", carry)).toBe("/photos?before=12&items=fixture-01:small:oak#post-x");
    expect(carried("/photos", null)).toBe("/photos");
    expect(carryLabel(carry)).toBe("basket · 1 print");
    expect(carryLabel({ items: "x", count: 3 })).toBe("basket · 3 prints");
  });
});
```

Create `tests/unit/print-row.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import PhotoView from "../../src/components/photos/PhotoView.astro";
import type { PhotoPage, PublicPhoto } from "../../src/lib/photos/store";
import { printsFor } from "../../src/lib/prints/catalogue";
import { render, text } from "./render";

const PRICES = { small: { unframed: 5900, oak: 13900 }, medium: { unframed: 7900, oak: 17900 }, large: { unframed: 11900, oak: 25900 } };
const GST = "prices include no gst; the seller isn't registered for gst.";
const photo: PublicPhoto = {
  id: "fixture-b-01", collection: "fixture-b", title: "", width: 4000, height: 6000, downloadBytes: 1, date: "2026-06-14", place: null,
  previews: [960, 1600].flatMap((size) => (["webp", "avif"] as const).map((format) => ({ url: `/media/p/${size}.${format}`, width: (size * 2) / 3, height: size, format }))),
};
const page: PhotoPage = { photo, publishedAt: 1781392500, index: 0, total: 2, previous: null, next: "fixture-b-02" };
const prints = { offers: printsFor(4000, 6000)!, prices: PRICES, gst: GST };
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);

describe("the print row", () => {
  test("sits between the photo and say hi, a plain get form to the basket", async () => {
    const doc = await render(PhotoView, { page, prints });
    expect(labels(doc)).toEqual(["photo", "prints", "say hi"]);
    const form = doc.querySelector("form#prints")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["get", "/basket"]);
    expect(text(form.querySelector("p"))).toBe("a print of this photo, made by artelo on archival matte paper and posted from the us.");
    expect(doc.querySelector("script")).toBeNull();
  });

  test("one size radio per tier it gets, the first checked; unframed checked, oak offered", async () => {
    const doc = await render(PhotoView, { page, prints });
    const sizes = [...doc.querySelectorAll('input[name="size"]')];
    expect(sizes.map((input) => [input.getAttribute("value"), input.hasAttribute("checked")])).toEqual([["small", true], ["medium", false], ["large", false]]);
    expect([...doc.querySelectorAll(".size-choice")].map(text)).toEqual([
      "small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed",
      "medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed",
      "large · 16 × 24 in (41 × 61 cm) · $119, or $259 framed",
    ]);
    expect([...doc.querySelectorAll('input[name="frame"]')].map((input) => [input.getAttribute("value"), input.hasAttribute("checked")])).toEqual([["unframed", true], ["oak", false]]);
    expect([...doc.querySelectorAll(".frame-choice")].map(text)).toEqual(["unframed", "oak frame"]);
  });

  test("names the photo to add, says how delivery works and carries a basket only when there is one", async () => {
    let doc = await render(PhotoView, { page, prints });
    expect(doc.querySelector('input[name="add"]')!.getAttribute("value")).toBe("fixture-b-01");
    expect(doc.querySelector('input[name="items"]')).toBeNull();
    expect(text(doc.querySelector("#prints button"))).toBe("add to basket");
    expect(text(doc.querySelector("#prints .prints-hint"))).toBe(`delivery is quoted for your address in the basket. ${GST}`);
    doc = await render(PhotoView, { page, prints, carry: { items: "fixture-01:small:oak", count: 1 } });
    expect(doc.querySelector('input[name="items"]')!.getAttribute("value")).toBe("fixture-01:small:oak");
  });

  test("no row without prints", async () => {
    expect(labels(await render(PhotoView, { page }))).toEqual(["photo", "say hi"]);
  });

  test("a carried basket rides on every gallery link and shows in the head row", async () => {
    const doc = await render(PhotoView, { page, carry: { items: "fixture-01:small:oak", count: 1 } });
    expect(doc.querySelector('a[rel="next"]')!.getAttribute("href")).toBe("/photos/fixture-b-02?items=fixture-01:small:oak");
    expect([...doc.querySelectorAll(".photo-nav a")].at(-1)!.getAttribute("href")).toBe("/photos?before=1781392501&items=fixture-01:small:oak#post-fixture-b");
    const basket = doc.querySelector(".basket-link a")!;
    expect([basket.getAttribute("href"), text(basket)]).toEqual(["/basket?items=fixture-01:small:oak", "basket · 1 print"]);
  });
});
```

Append to `tests/unit/gallery-page.test.ts`, inside the `describe("Gallery", …)` block:

```ts
  test("a carried basket rides on every frame and the pager, shows in the head row and reaches the script", async () => {
    const carry = { items: "fixture-01:small:oak,fixture-01:small:oak", count: 2 };
    const doc = await render(Gallery, { entries: PAGE, next: 1735092000, older: true, carry });
    expect([...doc.querySelectorAll("#post-DFkL1xrsnOH a.frame-link")].map((a) => a.getAttribute("href"))).toEqual([
      "/photos/DFkL1xrsnOH-01?items=fixture-01:small:oak,fixture-01:small:oak", "/photos/DFkL1xrsnOH-03?items=fixture-01:small:oak,fixture-01:small:oak",
    ]);
    expect(doc.querySelector("a.more")!.getAttribute("href")).toBe("/photos?before=1735092000&items=fixture-01:small:oak,fixture-01:small:oak");
    expect(doc.querySelector("ol.entries")!.getAttribute("data-items")).toBe(carry.items);
    expect(text(doc.querySelector(".where"))).toBe("back to the logbook · newest entries · basket · 2 prints");
    expect(doc.querySelector('.where a[href="/photos?items=fixture-01:small:oak,fixture-01:small:oak"]')).not.toBeNull();
    expect(doc.querySelector('.where a[href="/basket?items=fixture-01:small:oak,fixture-01:small:oak"]')).not.toBeNull();
  });

  test("while prints are open the intro says some come as prints", async () => {
    expect(text((await render(Gallery, { entries: PAGE, next: null, older: false, prints: true })).querySelector(".intro"))).toBe(
      "photos i've taken, one entry per instagram post, newest first. some come as prints.",
    );
    expect((await render(Gallery, { entries: PAGE, next: null, older: false })).querySelector("ol.entries")!.hasAttribute("data-items")).toBe(false);
  });
```

Append to `tests/unit/logbook-page.test.ts`, inside the `describe("Logbook", …)` block:

```ts
  test("while prints are open the photos line says some come as prints", async () => {
    const doc = await render(Logbook, { data: { ...full, photos: true }, prints: true });
    expect(text(doc.querySelector("#photos .body"))).toBe("photos i've taken, kept like this log. some come as prints.");
    expect(text((await render(Logbook, { data: { ...full, photos: true } })).querySelector("#photos .body"))).toBe("photos i've taken, kept like this log.");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/open.test.ts tests/unit/carry.test.ts tests/unit/print-row.test.ts tests/unit/gallery-page.test.ts tests/unit/logbook-page.test.ts`
Expected: FAIL, the new modules, props and store functions don't exist.

- [ ] **Step 3: Write the basket's store functions, prints-open and the carry**

Append to `src/lib/prints/store.ts`, and add the imports to the top of the file:

```ts
import { photoName, previewOf } from "../photos/gallery";
import { previewSize, type Preview, type PublicPreview } from "../photos/store";
import type { QuoteLine } from "./artelo";
import { itemsValue, printCount, validate, type BasketLine, type RawEntry } from "./basket";
import { offerFor, printsFor } from "./catalogue";
```

```ts
/** A photograph as a basket, an order and an email name and show it */
export interface BasketPhoto {
  id: string;
  title: string;
  /** Its post's date, YYYY-MM-DD */
  date: string;
  width: number;
  height: number;
  /** Its place among its post's published photographs (plus itself when hidden), for its name (spec 4) */
  index: number;
  total: number;
  published: boolean;
  /** Its 240 and 480 previews */
  previews: PublicPreview[];
}

export interface FactRow {
  id: string;
  title: string;
  print_width: number;
  print_height: number;
  previews: string;
  published: number;
  published_on: string;
  idx: number;
  total: number;
}

/** What naming and showing a photograph needs, joined to its post; the caller adds the WHERE */
export const PHOTO_FACTS = `SELECT photos.id, photos.title, photos.print_width, photos.print_height, photos.previews, photos.published, photo_posts.published_on,
  (SELECT COUNT(*) FROM photos AS s WHERE s.collection = photos.collection AND (s.published = 1 OR s.id = photos.id) AND s.position < photos.position) AS idx,
  (SELECT COUNT(*) FROM photos AS s WHERE s.collection = photos.collection AND (s.published = 1 OR s.id = photos.id)) AS total
  FROM photos JOIN photo_posts ON photo_posts.collection = photos.collection`;

export function toBasketPhoto(row: FactRow): BasketPhoto {
  const previews = (JSON.parse(row.previews) as Preview[]).filter((preview) => previewSize(preview.key) === 240 || previewSize(preview.key) === 480);
  return {
    id: row.id, title: row.title, date: row.published_on, width: row.print_width, height: row.print_height, index: row.idx, total: row.total, published: row.published === 1,
    previews: previews.map(({ key, width, height, format }) => ({ url: `/media/${key}`, width, height, format })),
  };
}

export const photoNameOf = (photo: BasketPhoto) => photoName({ title: photo.title, date: photo.date }, photo.index, photo.total);

/** A basket line with everything a page, a quote and checkout need: its Artelo size, orientation, price and name */
export interface PricedLine extends BasketLine, QuoteLine {
  name: string;
  /** The 240 WebP, for the basket */
  thumb: PublicPreview | null;
  /** The 480 WebP, for Stripe's page */
  image: PublicPreview | null;
}

export interface ResolvedBasket {
  lines: PricedLine[];
  /** The canonical items value, "" when empty */
  items: string;
  count: number;
  /** AUD cents */
  printTotal: number;
  unavailable: number;
  overCap: number;
}

/** The basket against what is published and offered now: the server trusts nothing from the query string (spec 15.2) */
export function priceBasket(entries: readonly RawEntry[], photos: ReadonlyMap<string, BasketPhoto>, prices: PriceList): ResolvedBasket {
  const prints = (photoId: string) => {
    const photo = photos.get(photoId);
    return photo ? printsFor(photo.width, photo.height) : null;
  };
  const { lines, unavailable, overCap } = validate(entries, (entry) => offerFor(prints(entry.photoId), entry.tier) !== undefined);
  const priced = lines.map((line): PricedLine => {
    const photo = photos.get(line.photoId)!;
    const offers = prints(line.photoId)!;
    return {
      ...line, size: offerFor(offers, line.tier)!.size, orientation: offers.orientation, unitAmount: prices[line.tier][line.frame], name: photoNameOf(photo),
      thumb: previewOf(photo, 240, "webp") ?? null, image: previewOf(photo, 480, "webp") ?? null,
    };
  });
  return { lines: priced, items: itemsValue(lines), count: printCount(lines), printTotal: priced.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0), unavailable, overCap };
}

/** The basket's photographs, the price list and the settings in one batch */
export async function loadBasket(db: D1Database, entries: readonly RawEntry[]): Promise<{ basket: ResolvedBasket; settings: PrintSettings }> {
  const ids = [...new Set(entries.map((entry) => entry.photoId))];
  const [facts, prices, settings] = await db.batch([
    // Many ids as one JSON parameter: D1 caps a statement at 100 bound parameters
    db.prepare(`${PHOTO_FACTS} WHERE photos.published = 1 AND photos.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)),
    db.prepare(PRICES_SQL),
    db.prepare(SETTINGS_SQL),
  ]);
  const photos = new Map((facts.results as unknown as FactRow[]).map((row) => [row.id, toBasketPhoto(row)]));
  return {
    basket: priceBasket(entries, photos, toPrices(prices.results as unknown as { tier: string; frame: string; amount: number }[])),
    settings: toSettings(settings.results as unknown as { key: string; value: string }[]),
  };
}

export async function resolveBasket(db: D1Database, entries: readonly RawEntry[]): Promise<ResolvedBasket> {
  return (await loadBasket(db, entries)).basket;
}

/** The price list and the settings in one batch, for a photograph's print row */
export async function loadPrintContext(db: D1Database): Promise<{ prices: PriceList; settings: PrintSettings }> {
  const [prices, settings] = await db.batch([db.prepare(PRICES_SQL), db.prepare(SETTINGS_SQL)]);
  return {
    prices: toPrices(prices.results as unknown as { tier: string; frame: string; amount: number }[]),
    settings: toSettings(settings.results as unknown as { key: string; value: string }[]),
  };
}
```

Create `src/lib/prints/open.ts`:

```ts
import type { PrintConfig } from "./config";
import { readSettings } from "./store";

// Prints are open when PRINTS_OPEN is "true", every print secret is set and an exchange rate is stored (spec 16.5)

export type PrintsStatus = { open: true } | { open: false; reason: string };

const list = (names: readonly string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Whether prints could open before anything is read: the switch and the secrets */
export const canOpen = (config: PrintConfig) => config.switchedOn && config.missing.length === 0;

export function printsStatus(config: PrintConfig, rate: number | null): PrintsStatus {
  if (!config.switchedOn) return { open: false, reason: 'PRINTS_OPEN isn\'t "true"' };
  if (config.missing.length > 0) return { open: false, reason: `${config.missing.length === 1 ? "this secret isn't" : "these secrets aren't"} set: ${list(config.missing)}` };
  if (rate === null) return { open: false, reason: "no exchange rate has been fetched yet" };
  return { open: true };
}

/** For a page's line: no D1 read while prints are switched off, and closed if the read fails */
export async function printsOpenNow(config: PrintConfig, db: D1Database): Promise<boolean> {
  if (!canOpen(config)) return false;
  try {
    return printsStatus(config, (await readSettings(db)).rate).open;
  } catch (error) {
    console.error("prints: couldn't read whether prints are open", error instanceof Error ? error.message : String(error));
    return false;
  }
}
```

Create `src/lib/prints/carry.ts`:

```ts
import { parseItems } from "./basket";
import { resolveBasket } from "./store";

// The basket carried through the gallery (spec 15.3): with a valid items parameter, every link to a gallery page keeps it

export interface Carry {
  /** The canonical items value */
  items: string;
  count: number;
}

/** The basket a gallery page was reached with, validated and canonical, or null; a failed read carries nothing */
export async function readCarry(db: D1Database, url: URL): Promise<Carry | null> {
  const raw = url.searchParams.get("items");
  if (raw === null) return null;
  try {
    const basket = await resolveBasket(db, parseItems(raw));
    return basket.items ? { items: basket.items, count: basket.count } : null;
  } catch (error) {
    console.error("prints: couldn't read a carried basket", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** A gallery link with the basket on it: after any query, before any fragment */
export function carried(href: string, carry: Carry | null): string {
  if (!carry) return href;
  const hash = href.indexOf("#");
  const [path, fragment] = hash < 0 ? [href, ""] : [href.slice(0, hash), href.slice(hash)];
  return `${path}${path.includes("?") ? "&" : "?"}items=${carry.items}${fragment}`;
}

export const carryLabel = (carry: Carry) => `basket · ${carry.count} ${carry.count === 1 ? "print" : "prints"}`;
```

- [ ] **Step 4: Write the print row and its styles**

Create `src/components/prints/PrintRow.astro`:

```astro
---
import { sizeLabel, type PhotoPrints } from "../../lib/prints/catalogue";
import { aud } from "../../lib/prints/money";
import type { PriceList } from "../../lib/prints/store";
import "../../styles/prints.css";

// The print row (spec 15.1): a plain get form with no script, landing on /basket with this print appended
interface Props {
  photoId: string;
  prints: PhotoPrints;
  prices: PriceList;
  /** The carried basket's items, or null */
  items: string | null;
  /** The gst sentence for the current setting */
  gst: string;
}

const { photoId, prints, prices, items, gst } = Astro.props;
---
<form method="get" action="/basket" id="prints" class="print-form">
  <p>a print of this photo, made by artelo on archival matte paper and posted from the us.</p>
  {items && <input type="hidden" name="items" value={items} />}
  <input type="hidden" name="add" value={photoId} />
  <fieldset>
    <legend>size</legend>
    {prints.offers.map((offer, index) => (
      <label class="choice size-choice"><input type="radio" name="size" value={offer.tier} checked={index === 0} /> {sizeLabel(offer)} · {aud(prices[offer.tier].unframed)}, or {aud(prices[offer.tier].oak)} framed</label>
    ))}
  </fieldset>
  <fieldset>
    <legend>frame</legend>
    <label class="choice frame-choice"><input type="radio" name="frame" value="unframed" checked /> unframed</label>
    <label class="choice frame-choice"><input type="radio" name="frame" value="oak" /> oak frame</label>
  </fieldset>
  <button type="submit" class="print-button">add to basket</button>
  <p class="prints-hint">delivery is quoted for your address in the basket. {gst}</p>
</form>
```

Create `src/styles/prints.css`:

```css
/* Prints (spec 15 and 18.5): the print row, the basket and the order page, in the notebook's paper and type */
.print-form { display: grid; gap: 14px; max-width: 34rem; }
.print-form fieldset { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; }
.print-form legend { padding: 0; margin-bottom: 2px; font: 12px/1.5 var(--mono); color: var(--muted); }
/* 44px rows, so each choice is a full tap target on a phone */
.choice { display: flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer; font-size: 15.5px; line-height: 1.35; }
.choice input { flex: none; width: 18px; height: 18px; margin: 0; accent-color: var(--ink); }
.choice input:focus-visible { outline: 1.5px solid var(--ink); outline-offset: 2px; }
.prints-hint { font-size: 14px; color: var(--muted); max-width: 34rem; text-wrap: pretty; }
.print-button {
  justify-self: start; min-height: 44px; padding: 0 16px; cursor: pointer;
  font: 12.5px/1 var(--mono); color: var(--ink); background: var(--mat);
  border: 1px solid var(--rule); border-radius: 999px;
}
.print-button:active { background: #ebe8df; }
/* notebook.css squares every focused button to 3px, which would turn the pill square under the keyboard */
.print-button:focus-visible { border-radius: 999px; }
@media (hover: hover) and (pointer: fine) {
  .print-button { transition: border-color 200ms ease, background-color 200ms ease; }
  .print-button:hover { border-color: color-mix(in oklab, var(--ink) 55%, transparent); }
}
.basket-link { margin-top: 8px; }
```

- [ ] **Step 5: Carry the basket through the gallery's components and script**

In `src/lib/photos/gallery.ts`, replace the `frameView` function's first two lines and its `href` line so it reads:

```ts
/**
 * A frame for the photograph at `index` of the `total` published in its post; null without a 240 preview (never for a
 * published one). `query` is the carried basket ("?items=…", spec 15.3) or "".
 */
export function frameView(photo: PublicPhoto, index: number, total: number, query = ""): FrameView | null {
  const small = previewOf(photo, 240, "webp");
  if (!small) return null;
  return {
    href: `/photos/${photo.id}${query}`,
```

(The rest of the returned object is unchanged.)

In `src/components/photos/Entry.astro`, add to `Props`:

```ts
  /** The carried basket's query ("?items=…", spec 15.3), or "" */
  query?: string;
```

and replace the two lines from `const { entry, first = false } = Astro.props;` through the `views` line with:

```ts
const { entry, first = false, query = "" } = Astro.props;
// Alt text counts published photographs in post order: the entry holds only those (spec 3.2)
const views = entry ? entry.photos.map((photo, index) => frameView(photo, index, entry.photos.length, query)).filter((view): view is FrameView => view !== null) : [];
```

Replace `src/components/photos/Gallery.astro` with:

```astro
---
import Row from "../Row.astro";
import Entry from "./Entry.astro";
import Frame from "./Frame.astro";
import type { Entry as EntryData } from "../../lib/photos/store";
import { basketHref, itemsQuery } from "../../lib/prints/basket";
import { carried, carryLabel, type Carry } from "../../lib/prints/carry";

interface Props {
  /** null when D1 couldn't be read: the head row says so, and nothing else renders */
  entries: EntryData[] | null;
  /** The next page's cursor, or null at the end */
  next: number | null;
  /** A ?before= page */
  older: boolean;
  /** The basket this page was reached with (spec 15.3), carried in every link to a gallery page */
  carry?: Carry | null;
  /** Prints are open: the intro says some come as prints (spec 16.5) */
  prints?: boolean;
}

const { entries, next, older, carry = null, prints = false } = Astro.props;
const query = itemsQuery(carry?.items ?? "");
---
<main class="book photos">
  <Row label="photos of" head>
    <h1>george vlachos</h1>
    <p class="intro">photos i've taken, one entry per instagram post, newest first.{prints && " some come as prints."}</p>
    <p class="where"><a href="/">back to the logbook</a>{older && <> · <a href={carried("/photos", carry)}>newest entries</a></>}{carry && <> · <a href={basketHref(carry.items)}>{carryLabel(carry)}</a></>}</p>
    {entries === null && <p class="down">photos aren't loading right now. try again in a bit.</p>}
  </Row>
  {entries !== null && (
    <Row label="entries" id="entries">
      {entries.length === 0 && !older ? (
        <p class="empty">no photos up yet.</p>
      ) : (
        <>
          {/* data-items hands the carried basket to photo-sheet.ts, which builds the frames of later batches */}
          <ol class="entries" data-items={carry?.items}>
            {entries.map((entry, index) => <Entry entry={entry} first={index === 0} query={query} />)}
          </ol>
          {next !== null ? (
            <>
              <a class="more" href={carried(`/photos?before=${next}`, carry)} data-next={next}><span class="chev" aria-hidden="true"></span><span class="lbl" aria-live="polite">older entries</span></a>
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

In `src/scripts/photo-sheet.ts`, inside `start`, add after `let busy = false;`:

```ts
  // The carried basket (spec 15.3): later batches' frames and the pager keep it, as the server's do
  const items = list.dataset.items ?? "";
  const query = items ? `?items=${items}` : "";
```

replace `const view = frameView(photo, index, data.photos.length);` with:

```ts
      const view = frameView(photo, index, data.photos.length, query);
```

and replace `more.href = \`/photos?before=${page.next}\`;` with:

```ts
      more.href = `/photos?before=${page.next}${items ? `&items=${items}` : ""}`;
```

Replace `src/components/photos/PhotoView.astro` with:

```astro
---
import Row from "../Row.astro";
import SayHi from "../SayHi.astro";
import PrintRow from "../prints/PrintRow.astro";
import { dateAndPlace, photoAlt, photoSizes, previewOf, srcsetOf } from "../../lib/photos/gallery";
import type { PhotoPage } from "../../lib/photos/store";
import { basketHref } from "../../lib/prints/basket";
import { carried, carryLabel, type Carry } from "../../lib/prints/carry";
import type { PhotoPrints } from "../../lib/prints/catalogue";
import type { PriceList } from "../../lib/prints/store";

interface Props {
  page: PhotoPage;
  /** The print row's sizes, prices and gst sentence, when prints are open and this photograph gets a size (spec 15.1) */
  prints?: { offers: PhotoPrints; prices: PriceList; gst: string } | null;
  /** The basket this page was reached with (spec 15.3) */
  carry?: Carry | null;
}

const { page, prints = null, carry = null } = Astro.props;
const { photo, index, total, previous, next, publishedAt } = page;
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
    {/* Each step is a nowrap unit with its separator, so a phone wraps between steps and never strands a dot or splits a name */}
    <p class="photo-nav">photo {index + 1} of {total}
      {previous && <> <span class="step">· <a href={carried(`/photos/${previous}`, carry)} rel="prev"><span class="chev back" aria-hidden="true"></span>previous</a></span></>}
      {next && <> <span class="step">· <a href={carried(`/photos/${next}`, carry)} rel="next">next<span class="chev ahead" aria-hidden="true"></span></a></span></>}
      {" "}<span class="step">· <a href={carried(`/photos?before=${publishedAt + 1}#post-${photo.collection}`, carry)}>the whole entry</a></span></p>
    {carry && <p class="where basket-link"><a href={basketHref(carry.items)}>{carryLabel(carry)}</a></p>}
  </Row>
  {prints && (
    <Row label="prints" id="print-row">
      <PrintRow photoId={photo.id} prints={prints.offers} prices={prints.prices} items={carry?.items ?? null} gst={prints.gst} />
    </Row>
  )}
  <Row label="say hi" id="say-hi"><SayHi /></Row>
</main>
```

In `src/components/Logbook.astro`, add to `Props`:

```ts
  /** Prints are open: the photos line says some come as prints (spec 16.5) */
  prints?: boolean;
```

replace `const { data } = Astro.props;` with `const { data, prints = false } = Astro.props;` and replace the photos row line with:

```astro
  {data && data.photos && <Row label="photos" id="photos"><p><a href="/photos">photos</a> i've taken, kept like this log.{prints && " some come as prints."}</p></Row>}
```

- [ ] **Step 6: Wire the pages**

In `src/pages/index.astro`, add the imports:

```ts
import { printConfig } from "../lib/prints/config";
import { printsOpenNow } from "../lib/prints/open";
```

add after `const data = await loadLogbookSafely(env.DB);`:

```ts
// Only when the line shows: no extra read for a home page with nothing published
const prints = data?.photos ? await printsOpenNow(printConfig(env), env.DB) : false;
```

and replace `<Logbook data={data} />` with `<Logbook data={data} prints={prints} />`.

Replace `src/pages/photos/index.astro` with:

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../../layouts/Notebook.astro";
import Beacon from "../../components/Beacon.astro";
import Gallery from "../../components/photos/Gallery.astro";
import { entryPage, PAGE_ENTRY_LIMIT, type EntryPage } from "../../lib/photos/store";
import { printConfig } from "../../lib/prints/config";
import { readCarry, type Carry } from "../../lib/prints/carry";
import { printsOpenNow } from "../../lib/prints/open";
import "../../styles/photos.css";

const before = Astro.url.searchParams.get("before");
// Anything but a plain count of seconds is the notebook 404 (spec 3.4); a null body makes Astro render 404.astro
if (before !== null && !/^\d{1,10}$/.test(before)) return new Response(null, { status: 404 });
// A page reached with a basket is that visitor's own: never edge-cached, never indexed (spec 15.3)
const carrying = Astro.url.searchParams.has("items");

let page: EntryPage | null = null;
try {
  page = await entryPage(env.DB, before === null ? null : Number(before), PAGE_ENTRY_LIMIT);
} catch (error) {
  console.error("photos: the gallery couldn't read D1", error instanceof Error ? error.message : String(error));
}
let carry: Carry | null = null;
let prints = false;
if (page) {
  if (carrying) carry = await readCarry(env.DB, Astro.url);
  prints = await printsOpenNow(printConfig(env), env.DB);
}
if (page && !carrying) {
  // As the home page (R6.1): fresh for five minutes at the edge, then stale while it refreshes; saves purge the tag
  Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["photos"] });
  Astro.response.headers.set("Cache-Control", "no-cache");
} else {
  // A degraded page, or one carrying a basket, is never cached
  if (!page) Astro.response.status = 503;
  Astro.response.headers.set("Cache-Control", "no-store");
}
---
<Notebook title="photos · george vlachos" description="photos george vlachos has taken, one entry per instagram post." noindex={before !== null || carrying}>
  <Gallery entries={page?.entries ?? null} next={page?.next ?? null} older={before !== null} carry={carry} prints={prints} />
  <Beacon />
  <script>
    // Its own entry: it shares no module with any other script, so the build inlines it
    import "../../scripts/photo-sheet";
  </script>
</Notebook>
```

Replace `src/pages/photos/[id].astro` with:

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../../layouts/Notebook.astro";
import Beacon from "../../components/Beacon.astro";
import Row from "../../components/Row.astro";
import PhotoView from "../../components/photos/PhotoView.astro";
import { dateAndPlace, longDate, previewOf } from "../../lib/photos/gallery";
import { photoPageData, type PhotoPage } from "../../lib/photos/store";
import { printConfig } from "../../lib/prints/config";
import { readCarry, type Carry } from "../../lib/prints/carry";
import { printsFor, type PhotoPrints } from "../../lib/prints/catalogue";
import { gstSentence } from "../../lib/prints/money";
import { canOpen, printsStatus } from "../../lib/prints/open";
import { loadPrintContext, type PriceList } from "../../lib/prints/store";
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
// A page reached with a basket is that visitor's own: never edge-cached, never indexed (spec 15.3)
const carrying = Astro.url.searchParams.has("items");
const config = printConfig(env);
let prints: { offers: PhotoPrints; prices: PriceList; gst: string } | null = null;
let carry: Carry | null = null;
if (page) {
  const offers = printsFor(page.photo.width, page.photo.height);
  // The row only while prints are open and this photograph gets a size (spec 15.1); a failed read just leaves it out
  if (offers && canOpen(config)) {
    try {
      const context = await loadPrintContext(env.DB);
      if (printsStatus(config, context.settings.rate).open) prints = { offers, prices: context.prices, gst: gstSentence(config.gst) };
    } catch (error) {
      console.error("prints: a photo page couldn't read the price list", error instanceof Error ? error.message : String(error));
    }
  }
  if (carrying) carry = await readCarry(env.DB, Astro.url);
}
if (page && !carrying) {
  Astro.cache.set({ maxAge: 300, swr: 86400, tags: ["photos"] });
  Astro.response.headers.set("Cache-Control", "no-cache");
} else {
  if (!page) Astro.response.status = 503;
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
  noindex={!page || carrying}
  ogImage={share ? { url: new URL(share.url, "https://curiousgeorge.dev").href, width: share.width, height: share.height } : undefined}
>
  {page ? (
    <PhotoView page={page} prints={prints} carry={carry} />
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

- [ ] **Step 7: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/open.test.ts tests/unit/carry.test.ts tests/unit/print-row.test.ts tests/unit/gallery-page.test.ts tests/unit/logbook-page.test.ts tests/unit/gallery.test.ts tests/unit/photo-view.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 8: Write the stand-in, the prints server and their helpers**

Create `tests/e2e/prints-site.ts`:

```ts
// The prints e2e servers and their fixture secrets (spec 23.3, ADR-0024). Public on purpose: they only ever sign fixture
// data in throwaway stores. playwright.config.ts, the stand-in and the specs all import them, so each value lives once.

/** Every provider stood in; recreated every run */
export const PRINTS = "http://localhost:4337";
/** Stripe's real test mode, started only when STRIPE_TEST_SECRET_KEY is set (Task 15) */
export const PRINTS_STRIPE = "http://localhost:4338";
/** The stand-in for Artelo, the exchange rate, Stripe's three endpoints and the mail binding */
export const STAND_IN = "http://127.0.0.1:4401";

export const FIXTURE_STRIPE_KEY = "sk_test_fixture_prints";
export const FIXTURE_SECRETS = {
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_prints",
  ARTELO_API_KEY: "artelo-fixture-key",
  ARTELO_WEBHOOK_SECRET: "artelo-fixture-webhook-secret",
  PRINT_VIEW_SECRET: "2".repeat(64),
} as const;

/** A prints server's store, made afresh: the migrations, the gallery fixture and a rate of 1.50 dated today, so prints open at once */
export function printStore(store: string): string {
  return [
    `rm -rf ${store}`,
    `wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to ${store}`,
    `node scripts/seed-photo-test.mjs --persist-to ${store}`,
    `wrangler d1 execute curiousgeorge-logbook --local --persist-to ${store} --command "INSERT INTO print_settings (key, value, updated_at) VALUES ('usd_aud', '1.5', 0), ('usd_aud_date', date('now'), 0)"`,
  ].join(" && ");
}

/**
 * The vars both prints servers share: prints open, the stand-in for Artelo, the rate and mail, the fixture secrets and
 * every print setting at wrangler.jsonc's value. build:test copies George's .dev.vars into dist/server, so anything left
 * unpinned would come from his machine (ADR-0024's reasoning). Each is quoted for the shell: the seller's name has a space
 */
export function printVars(origin: string): string {
  const vars: Record<string, string> = {
    PRINTS_OPEN: "true", SITE_ORIGIN: origin, ARTELO_API_BASE: STAND_IN, FX_URL: `${STAND_IN}/fx`, EMAIL_SINK: `${STAND_IN}/__mail`,
    PRINT_GST: "none", STRIPE_GST_TAX_RATE: "", PRINT_SELLER_NAME: "george vlachos", PRINT_FROM_EMAIL: "prints@curiousgeorge.dev", ADMIN_EMAIL: "hello@curiousgeorge.dev",
    ...FIXTURE_SECRETS,
  };
  return Object.entries(vars).map(([name, value]) => `--var '${name}:${value}'`).join(" ");
}
```

Create `tests/fixtures/artelo-site.mjs`:

```js
// A stand-in for every provider the print code calls (spec 23.3), so no print spec reaches a real service. It starts as
// the exchange rate (Frankfurter's shape); later tasks add Artelo's API, Stripe's three endpoints and the mail sink with
// route(), above the last line. Everything it receives is kept in memory for the specs: GET /__requests.
import { createHmac, createHash } from "node:crypto";
import { createServer } from "node:http";
import { FIXTURE_SECRETS, FIXTURE_STRIPE_KEY, STAND_IN } from "../e2e/prints-site.ts";

const PORT = 4401;
/** What arrived, for the specs to read */
const received = { fx: 0, priceChecks: [], orders: [], webhooks: [], mail: [] };
const routes = [];

/** A handler for a method and an exact path or a pattern: it gets { url, body, headers, match } and returns [status, value, headers?] */
function route(method, path, handler) {
  routes.push({ method, path, handler });
}
const today = () => new Date().toISOString().slice(0, 10);
const keyed = (headers, key) => headers.authorization === `Bearer ${key}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sign = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");

route("GET", "/fx", () => {
  received.fx += 1;
  return [200, { amount: 1, base: "USD", date: today(), rates: { AUD: 1.5 } }];
});
route("GET", "/__requests", () => [200, received]);

function start() {
  createServer(async (request, response) => {
    const url = new URL(request.url, STAND_IN);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    for (const { method, path, handler } of routes) {
      if (method !== request.method) continue;
      const match = typeof path === "string" ? (path === url.pathname ? [url.pathname] : null) : path.exec(url.pathname);
      if (!match) continue;
      try {
        const [status, value, headers = {}] = await handler({ url, body, headers: request.headers, match });
        const plain = typeof value === "string";
        response.writeHead(status, { "content-type": plain ? "text/html; charset=utf-8" : "application/json", "cache-control": "no-store", ...headers });
        response.end(plain ? value : JSON.stringify(value));
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(String(error?.stack ?? error));
      }
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "nothing here" }));
  }).listen(PORT, "127.0.0.1", () => console.log(`print stand-in on ${STAND_IN}`));
}

// Routes added by later tasks go above this line
start();
```

(`createHmac`, `sha256`, `sign`, `keyed`, `FIXTURE_SECRETS` and `FIXTURE_STRIPE_KEY` are used by the routes Tasks 6 to 14 add.)

Create `tests/e2e/prints.ts`:

```ts
import { execFileSync } from "node:child_process";
import { STAND_IN } from "./prints-site";

// Helpers for the print specs. They write only to the prints servers' own stores and read the stand-in.

/** A suffix unique to this attempt, so parallel and retried tests never collide */
export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

/** SQL on a prints server's own local store: reading a row, or setting test data (spec 11.2's rule) */
export function printsD1<T = Record<string, unknown>>(sql: string, store = ".wrangler/prints"): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", store, "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
}

/** JSON from the stand-in */
export async function standIn<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${STAND_IN}${path}`, init);
  if (!response.ok) throw new Error(`the stand-in answered ${response.status} on ${path}`);
  return (await response.json()) as T;
}
```

In `playwright.config.ts`, add the import under the existing one:

```ts
import { FIXTURE_STRIPE_KEY, PRINTS, STAND_IN, printStore, printVars } from "./tests/e2e/prints-site";
```

and add these two entries at the end of the `webServer` array:

```ts
        // The print providers' stand-in: Artelo, the exchange rate, Stripe's three endpoints and the mail sink (spec 23.3)
        { command: "node tests/fixtures/artelo-site.mjs", url: `${STAND_IN}/__requests`, reuseExistingServer: false, timeout: 30_000 },
        // A sixth server for the print specs, every provider stood in, recreated every run like the admin server. Stripe
        // points at the stand-in too, so the money specs run on every run; a first failed order goes straight to
        // needs_attention (PRINT_RETRY_WINDOW=0, spec 19). Specs trigger the cron through wrangler's local explorer (runCron)
        {
          command: `${printStore(".wrangler/prints")} && wrangler dev -c dist/server/wrangler.json --port 4337 --persist-to .wrangler/prints ${PHOTO_KEY_VAR} ${printVars(PRINTS)} --var STRIPE_SECRET_KEY:${FIXTURE_STRIPE_KEY} --var STRIPE_API_BASE:${STAND_IN}/stripe --var PRINT_RETRY_WINDOW:0`,
          url: PRINTS,
          reuseExistingServer: false,
          timeout: 120_000,
        },
```

- [ ] **Step 9: Write the e2e spec**

Create `tests/e2e/prints-basket.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";
import { PRINTS } from "./prints-site";

// The prints server (4337): prints open, every provider stood in. The print specs run in Chromium (spec 23.2)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

const labels = (page: import("@playwright/test").Page) => page.locator(".row > .label");

test("a photograph's page offers the sizes it prints at, priced, with how delivery works; none while prints are closed", async ({ page }) => {
  const response = await page.goto("/photos/fixture-b-01");
  expect(response?.headers()["cache-control"]).toBe("no-cache");
  await expect(labels(page)).toHaveText(["photo", "prints", "say hi"]);
  const form = page.locator("form#prints");
  await expect(form).toHaveAttribute("action", "/basket");
  await expect(form.locator(".size-choice")).toHaveText([
    "small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed",
    "medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed",
    "large · 16 × 24 in (41 × 61 cm) · $119, or $259 framed",
  ]);
  await expect(form.locator(".frame-choice")).toHaveText(["unframed", "oak frame"]);
  await expect(form.locator(".prints-hint")).toHaveText("delivery is quoted for your address in the basket. prices include no gst; the seller isn't registered for gst.");
  // The same photo on the gallery server, where prints are closed: no row, and the plain intro
  await page.goto(`${GALLERY}/photos/fixture-b-01`);
  await expect(page.locator("form#prints")).toHaveCount(0);
  await page.goto(`${GALLERY}/photos`);
  await expect(page.locator(".intro")).toHaveText("photos i've taken, one entry per instagram post, newest first.");
});

test("a square photo prints small only, and one too small or the wrong shape gets no row", async ({ page }) => {
  await page.goto("/photos/fixture-01");
  await expect(page.locator("form#prints .size-choice")).toHaveText(["small · 10 × 10 in (25 × 25 cm) · $59, or $139 framed"]);
  await page.goto("/photos/fixture-c-01");
  await expect(labels(page)).toHaveText(["photo", "say hi"]);
});

test("while prints are open the gallery's intro and the home page's line say some come as prints", async ({ page }) => {
  await page.goto("/photos");
  await expect(page.locator(".intro")).toHaveText("photos i've taken, one entry per instagram post, newest first. some come as prints.");
  await page.goto("/");
  await expect(page.locator("#photos .body")).toHaveText("photos i've taken, kept like this log. some come as prints.");
});

test("a basket rides through the gallery's links, and those pages are never cached or indexed", async ({ page }) => {
  const response = await page.goto("/photos?items=fixture-b-01:medium:oak");
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["cache-tag"]).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.getByRole("link", { name: "basket · 1 print" })).toHaveAttribute("href", "/basket?items=fixture-b-01:medium:oak");
  await expect(page.locator("a.frame-link").first()).toHaveAttribute("href", "/photos/fixture-01?items=fixture-b-01:medium:oak");
  await page.locator('a.frame-link[href^="/photos/fixture-b-01"]').click();
  await expect(page).toHaveURL(/\/photos\/fixture-b-01\?items=fixture-b-01:medium:oak$/);
  await expect(page.locator('form#prints input[name="items"]')).toHaveValue("fixture-b-01:medium:oak");
  await expect(page.locator('a[rel="next"]')).toHaveAttribute("href", "/photos/fixture-b-02?items=fixture-b-01:medium:oak");
});

test("a basket of nothing valid carries nothing, and the page is still never cached", async ({ page }) => {
  const response = await page.goto("/photos/fixture-b-01?items=nobody-01:small:oak");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.locator(".basket-link")).toHaveCount(0);
  await expect(page.locator('form#prints input[name="items"]')).toHaveCount(0);
});
```

- [ ] **Step 10: Build and run the e2e specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bun run check:worker && bunx playwright test tests/e2e/prints-basket.spec.ts tests/e2e/gallery.spec.ts tests/e2e/photo-page.spec.ts tests/e2e/logbook.spec.ts`
Expected: every test passing (the print specs in chromium only, skipped elsewhere).

- [ ] **Step 11: Visual check**

Start the throwaway server as Global Constraints shows, then shoot `http://localhost:4336/photos/fixture-b-01` and `http://localhost:4336/photos/fixture-b-01?items=fixture-b-02:small:oak` at 375 × 812 and 1280 × 900. Look for: the `prints` row's label aligned with the others, each size a full-width tappable row, the radios' circles aligned with the first line of their text, the button a pill like the admin's, the hint in muted 14px and the basket line under the photo-nav on the second URL. Then stop it.

- [ ] **Step 12: Commit**

```bash
git add src/lib/prints/open.ts src/lib/prints/carry.ts src/lib/prints/store.ts src/components/prints/PrintRow.astro src/styles/prints.css src/lib/photos/gallery.ts src/components/photos/Entry.astro src/components/photos/Gallery.astro src/components/photos/PhotoView.astro src/scripts/photo-sheet.ts src/pages/photos/index.astro "src/pages/photos/[id].astro" src/pages/index.astro src/components/Logbook.astro playwright.config.ts tests/fixtures/artelo-site.mjs tests/e2e/prints-site.ts tests/e2e/prints.ts tests/e2e/prints-basket.spec.ts tests/unit/open.test.ts tests/unit/carry.test.ts tests/unit/print-row.test.ts tests/unit/gallery-page.test.ts tests/unit/logbook-page.test.ts
git commit -m "feat: the print row, when prints are open and the basket carried through the gallery"
```

---

### Task 6: the basket page, its address form, the quote and the sealed quote

Spec 1.2 step 6 (sections 15.2, 15.4, 16.1 to 16.3): `/basket` shows the basket from its query string, applies `add`, `one more` and `remove one` with a 303 to the canonical URL, takes the delivery address in a form body only, asks Artelo's Price Check for the whole basket to that address and renders one exact total with a sealed quote that checkout (Task 7) will charge. No script, no cookies, no storage; the address is never in a URL, a log or D1.

**Files:**
- Create: `src/lib/prints/seal.ts`, `src/lib/prints/limits.ts`, `src/lib/prints/basket-page.ts`, `src/pages/basket.astro`, `src/components/prints/Basket.astro`, `src/components/prints/BasketLines.astro`, `src/components/prints/AddressForm.astro`, `src/components/prints/QuoteTotal.astro`, `tests/unit/seal.test.ts`, `tests/unit/basket-page.test.ts`, `tests/unit/basket-view.test.ts`
- Modify: `src/styles/prints.css`, `public/robots.txt`, `tests/fixtures/artelo-site.mjs`, `tests/e2e/prints.ts`, `tests/e2e/prints-basket.spec.ts`
- Test: the three new unit tests, `tests/e2e/prints-basket.spec.ts`

**Interfaces:**
- Consumes: `PrintDeps` (Task 1); `parseItems`, `readOp`, `changeLines`, `itemsValue`, `itemsQuery`, `basketHref`, `droppedNotes`, `CAP_NOTE`, `MAX_PRINTS`, `printLine`, `aud`, `gstSentence` (Task 2); `loadBasket`, `ResolvedBasket`, `PrintSettings` (Tasks 3 and 5); `Address`, `AddressErrors`, `ADDRESS_FIELDS`, `EMPTY_ADDRESS`, `readAddress`, `checkAddress`, `countryOptions`, `priceCheck`, `TaxLine`, `deliveryAmount`, `deliveryLabel`, `breakdown` (Task 4); `printsStatus` (Task 5); `Beacon.astro`, `Row.astro`, `Notebook.astro` (existing).
- Produces (`src/lib/prints/seal.ts`): `QUOTE_SECONDS = 1800`; `interface QuotePayload { items: string; address: Address; printTotal: number; deliveryAmount: number; freightCents: number; taxes: TaxLine[]; buffer: number; rate: number; expires: number }`; `b64url(bytes: Uint8Array): string`; `fromB64url(text: string): Uint8Array | null`; `hmacKey(secret: string): Promise<CryptoKey>`; `sealQuote(secret, payload): Promise<string>`; `openQuote(secret, token: string, now: number): Promise<QuotePayload | null>`; `sameQuote(payload, items: string, address: Address): boolean`
- Produces (`src/lib/prints/limits.ts`): `interface PrintLimits { quote?: RateLimit; checkout?: RateLimit; artelo?: RateLimit }`; `clientKey(request, testClients: boolean): string`; `arteloKey(request, testClients: boolean): string`; `underLimit(limiter: RateLimit | undefined, key: string): Promise<boolean>`
- Produces (`src/lib/prints/basket-page.ts`): `interface QuoteView { printTotal: number; deliveryAmount: number; label: string; breakdown: string; token: string }`; `interface BasketView { basket: ResolvedBasket; notes: string[]; open: boolean; address: Address; errors: AddressErrors & { form?: string }; quote: QuoteView | null; gst: string }`; `type BasketOutcome = { redirect: string } | { status: number; view: BasketView; beacon: boolean }`; `basketGet(deps, url): Promise<BasketOutcome>`; `basketPost(deps, request, url, limits): Promise<BasketOutcome>`; `quoteView(secret, payload): Promise<QuoteView>`; `FORM_UNREADABLE`
- Produces (e2e): the stand-in's `POST /orders/price-check`; in `tests/e2e/prints.ts`: `TWO_PRINTS`, `type TestAddress`, `auAddress(name)`, `usAddress(name)`, `asTestClient(page)`, `fillAddress(page, address)`, `quoteDelivery(page, address)`, `priceChecksFor(name)`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/seal.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { b64url, fromB64url, openQuote, sameQuote, sealQuote, type QuotePayload } from "../../src/lib/prints/seal";
import { ADDRESS, NOW, VIEW_SECRET } from "./prints-fakes";

const payload = (over: Partial<QuotePayload> = {}): QuotePayload => ({
  items: "fixture-b-01:medium:oak,fixture-b-02:small:unframed", address: ADDRESS, printTotal: 23800, deliveryAmount: 4900, freightCents: 3000, taxes: [],
  buffer: 0.08, rate: 1.5, expires: NOW + 1800, ...over,
});
const tamper = (token: string, part: 0 | 1) => {
  const parts = token.split(".");
  const bytes = fromB64url(parts[part])!;
  bytes[0] ^= 1;
  parts[part] = b64url(bytes);
  return parts.join(".");
};

describe("the sealed quote", () => {
  test("opens to exactly what was sealed until it runs out", async () => {
    const token = await sealQuote(VIEW_SECRET, payload());
    expect(await openQuote(VIEW_SECRET, token, NOW)).toEqual(payload());
    expect(await openQuote(VIEW_SECRET, token, NOW + 1799)).toEqual(payload());
    expect(await openQuote(VIEW_SECRET, token, NOW + 1800)).toBeNull();
  });

  test("a changed payload, signature, secret or shape is refused", async () => {
    const token = await sealQuote(VIEW_SECRET, payload());
    expect(await openQuote(VIEW_SECRET, tamper(token, 0), NOW)).toBeNull();
    expect(await openQuote(VIEW_SECRET, tamper(token, 1), NOW)).toBeNull();
    expect(await openQuote("3".repeat(64), token, NOW)).toBeNull();
    // A cheaper delivery sealed under another key, or glued to this signature, opens to nothing
    const cheaper = await sealQuote("3".repeat(64), payload({ deliveryAmount: 100 }));
    expect(await openQuote(VIEW_SECRET, `${cheaper.split(".")[0]}.${token.split(".")[1]}`, NOW)).toBeNull();
    for (const value of ["", "abc", `${token}.x`, "!!.??", "a".repeat(9000)]) expect(await openQuote(VIEW_SECRET, value, NOW)).toBeNull();
  });

  test("the same items and every address field exactly, or it isn't the same quote", () => {
    const sealed = payload();
    expect(sameQuote(sealed, sealed.items, { ...ADDRESS })).toBe(true);
    expect(sameQuote(sealed, "fixture-b-01:medium:oak", ADDRESS)).toBe(false);
    for (const field of Object.keys(ADDRESS) as (keyof typeof ADDRESS)[]) expect(sameQuote(sealed, sealed.items, { ...ADDRESS, [field]: `${ADDRESS[field]}x` })).toBe(false);
  });

  test("an address in another script, with markup and punctuation, round-trips (review focus 1)", async () => {
    const address = { ...ADDRESS, name: "Zoë O'Brien & Sons", line1: "東京都渋谷区 1-2-3", line2: "<b>unit</b> 3", country: "JP" };
    const opened = await openQuote(VIEW_SECRET, await sealQuote(VIEW_SECRET, payload({ address })), NOW);
    expect(opened?.address).toEqual(address);
    expect(sameQuote(opened!, opened!.items, address)).toBe(true);
  });
});
```

Create `tests/unit/basket-page.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { basketGet, basketPost } from "../../src/lib/prints/basket-page";
import { openQuote } from "../../src/lib/prints/seal";
import { ADDRESS, captureLogs, fakeFetch, json, NOW, printDb, testConfig, testDeps, US_ADDRESS, VIEW_SECRET, type Handler } from "./prints-fakes";

const TWO = "fixture-b-01:medium:oak,fixture-b-02:small:unframed";
const PRICE_CHECK = "POST https://artelo.test/orders/price-check";
const quoted: Handler = async (request) => {
  const body = (await request.json()) as { customerAddress: { country: string } };
  return json({ orderCosts: { productionCost: 80, arteloShipping: 30, usSalesTax: body.customerAddress.country === "US" ? 4.2 : 0, total: 110 } });
};
const url = (query: string) => new URL(`https://curiousgeorge.dev/basket${query}`);
const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return new Request("https://curiousgeorge.dev/basket", { method: "POST", body: form, headers });
};
const setup = async (handler: Handler = quoted, over = {}) => {
  const fake = fakeFetch({ [PRICE_CHECK]: handler });
  return { fake, deps: testDeps(await printDb(), { fetch: fake.fetch, ...over }) };
};
const refusing = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;

afterEach(() => vi.restoreAllMocks());

describe("GET /basket", () => {
  test("adding answers 303 to the canonical basket with the print appended, merging identical prints", async () => {
    const { deps } = await setup();
    expect(await basketGet(deps, url("?items=fixture-b-02:small:unframed&add=fixture-b-01&size=medium&frame=oak"))).toEqual({ redirect: "/basket?items=fixture-b-02:small:unframed,fixture-b-01:medium:oak" });
    expect(await basketGet(deps, url("?add=fixture-b-01&size=medium&frame=oak"))).toEqual({ redirect: "/basket?items=fixture-b-01:medium:oak" });
    expect(await basketGet(deps, url(`?items=fixture-b-01:medium:oak,fixture-b-02:small:unframed&add=fixture-b-01&size=medium&frame=oak`))).toEqual({
      redirect: "/basket?items=fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed",
    });
  });

  test("one more and remove one answer 303 to the changed basket; an empty basket's URL has no items", async () => {
    const { deps } = await setup();
    expect(await basketGet(deps, url(`?items=${TWO}&more=2`))).toEqual({ redirect: "/basket?items=fixture-b-01:medium:oak,fixture-b-02:small:unframed,fixture-b-02:small:unframed" });
    expect(await basketGet(deps, url(`?items=${TWO}&remove=1`))).toEqual({ redirect: "/basket?items=fixture-b-02:small:unframed" });
    expect(await basketGet(deps, url("?items=fixture-b-02:small:unframed&remove=1"))).toEqual({ redirect: "/basket" });
  });

  test("a change that can't apply renders the basket with its line instead of redirecting", async () => {
    const { deps } = await setup();
    const ten = Array.from({ length: 10 }, () => "fixture-b-01:small:oak").join(",");
    for (const query of [`?items=${ten}&more=1`, `?items=${ten}&add=fixture-b-02&size=small&frame=oak`]) {
      const outcome = await basketGet(deps, url(query));
      expect("view" in outcome && outcome.view.notes).toEqual(["a basket holds up to 10 prints."]);
      expect("view" in outcome && outcome.view.basket.count).toBe(10);
    }
    const unoffered = await basketGet(deps, url("?add=fixture-01&size=large&frame=oak"));
    expect("view" in unoffered && unoffered.view.notes).toEqual(["1 print was taken out: that photo isn't available as a print any more."]);
  });

  test("a basket edited by hand renders what is still on offer, with a line for what was dropped (review focus 2)", async () => {
    const { deps } = await setup();
    const outcome = await basketGet(deps, url("?items=fixture-b-01:medium:oak,fixture-c-01:small:oak,fixture-03:small:oak"));
    expect(outcome).toMatchObject({ status: 200, beacon: true });
    expect("view" in outcome && outcome.view.basket.items).toBe("fixture-b-01:medium:oak");
    expect("view" in outcome && outcome.view.notes).toEqual(["2 prints were taken out: those photos aren't available as prints any more."]);
    for (const query of ["?items=a-01:small:oak,,", "?items=A-01:SMALL:OAK", "?items=fixture-b-01:medium:oak%20", `?items=${Array.from({ length: 25 }, () => "fixture-b-01:small:oak").join(",")}`]) {
      const odd = await basketGet(deps, url(query));
      expect("view" in odd).toBe(true);
    }
  });

  test("while prints are closed the basket says so", async () => {
    const { deps } = await setup(quoted, { config: testConfig({ switchedOn: false }) });
    const outcome = await basketGet(deps, url(`?items=${TWO}`));
    expect("view" in outcome && outcome.view.open).toBe(false);
  });
});

describe("POST /basket, intent=quote", () => {
  const quote = (address = ADDRESS) => post({ intent: "quote", ...address });

  test("quotes the whole basket to the posted address and seals exactly what it shows", async () => {
    const { fake, deps } = await setup();
    const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 200, beacon: false });
    if (!("view" in outcome)) throw new Error("expected a page");
    expect(outcome.view.quote).toMatchObject({ printTotal: 23800, deliveryAmount: 4900, label: "delivery" });
    expect(outcome.view.address).toEqual(ADDRESS);
    const sealed = await openQuote(VIEW_SECRET, outcome.view.quote!.token, NOW);
    expect(sealed).toEqual({ items: TWO, address: ADDRESS, printTotal: 23800, deliveryAmount: 4900, freightCents: 3000, taxes: [], buffer: 0.08, rate: 1.5, expires: NOW + 1800 });
    const sent = JSON.parse(fake.calls[0].body);
    expect(sent.items.map((item: { orderItemId: string; quantity: number; productInfo: { size: string } }) => [item.orderItemId, item.quantity, item.productInfo.size])).toEqual([["1", 1, "x12x18"], ["2", 1, "x8x12"]]);
    expect(sent.customerAddress).toMatchObject({ name: "Ada Lovelace", street1: "12 Example Street", country: "AU" });
  });

  test("a us address passes on the sales tax in a line that says so", async () => {
    const { deps } = await setup();
    const outcome = await basketPost(deps, quote(US_ADDRESS), url(`?items=${TWO}`), {});
    expect("view" in outcome && outcome.view.quote).toMatchObject({ deliveryAmount: 5600, label: "delivery and destination taxes" });
    expect("view" in outcome && outcome.view.quote?.breakdown).toContain("us sales tax us$4.20");
  });

  test("a field that fails its rule reopens the form with its values and messages, 422, and artelo is never asked", async () => {
    const { fake, deps } = await setup();
    const outcome = await basketPost(deps, quote({ ...ADDRESS, line1: "", phone: "12" }), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 422 });
    expect("view" in outcome && outcome.view.errors).toEqual({ line1: "add the street address.", phone: "that phone number looks too short." });
    expect("view" in outcome && outcome.view.address.name).toBe("Ada Lovelace");
    expect(fake.calls).toHaveLength(0);
  });

  test("artelo refusing shows its message beside the form, 422; artelo unavailable is a 503", async () => {
    captureLogs();
    let { deps } = await setup(() => json({ message: "we don't deliver to Antarctica" }, 400));
    let outcome = await basketPost(deps, quote({ ...ADDRESS, country: "AQ" }), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 422 });
    expect("view" in outcome && outcome.view.errors.form).toBe("artelo couldn't quote delivery to this address: we don't deliver to Antarctica");
    ({ deps } = await setup(() => new Response("<html>bad gateway</html>", { status: 502 })));
    outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), {});
    expect(outcome).toMatchObject({ status: 503 });
    expect("view" in outcome && outcome.view.errors.form).toBe("delivery prices aren't loading right now. try again in a minute.");
    expect("view" in outcome && outcome.view.quote).toBeNull();
  });

  test("past either limit: 429 without reaching artelo", async () => {
    const { fake, deps } = await setup();
    for (const limits of [{ quote: refusing }, { artelo: refusing }]) {
      const outcome = await basketPost(deps, quote(), url(`?items=${TWO}`), limits);
      expect(outcome).toMatchObject({ status: 429 });
      expect("view" in outcome && outcome.view.errors.form).toBe("too many quotes - wait a minute and try again.");
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("test builds key the limits on X-Test-Client; production on the visitor's address and one artelo bucket", async () => {
    const { deps } = await setup();
    const limiter = { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit & { limit: ReturnType<typeof vi.fn> };
    const headers = { "cf-connecting-ip": "203.0.113.9", "x-test-client": "spec-1" };
    await basketPost(deps, post({ intent: "quote", ...ADDRESS }, headers), url(`?items=${TWO}`), { quote: limiter, artelo: limiter });
    expect(limiter.limit.mock.calls.map(([options]) => options.key)).toEqual(["203.0.113.9", "price-check"]);
    const testBuild = testDeps(deps.db, { fetch: deps.fetch, config: testConfig({ testClients: true }) });
    limiter.limit.mockClear();
    await basketPost(testBuild, post({ intent: "quote", ...ADDRESS }, headers), url(`?items=${TWO}`), { quote: limiter, artelo: limiter });
    expect(limiter.limit.mock.calls.map(([options]) => options.key)).toEqual(["test:spec-1", "price-check:spec-1"]);
  });

  test("a basket that lost a print, an empty basket and closed prints get no quote", async () => {
    const { fake, deps } = await setup();
    expect(await basketPost(deps, quote(), url("?items=fixture-b-01:medium:oak,fixture-03:small:oak"), {})).toMatchObject({ status: 422 });
    expect(await basketPost(deps, quote(), url(""), {})).toMatchObject({ status: 200 });
    const closed = testDeps(deps.db, { fetch: deps.fetch, config: testConfig({ missing: ["ARTELO_API_KEY"] }) });
    const outcome = await basketPost(closed, quote(), url(`?items=${TWO}`), {});
    expect("view" in outcome && outcome.view.open).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  test("an unreadable post or an unknown intent says so", async () => {
    const { deps } = await setup();
    for (const request of [new Request("https://curiousgeorge.dev/basket", { method: "POST", body: "x", headers: { "content-type": "text/plain" } }), post({ intent: "pay" })]) {
      const outcome = await basketPost(deps, request, url(`?items=${TWO}`), {});
      expect(outcome).toMatchObject({ status: 422 });
      expect("view" in outcome && outcome.view.errors.form).toBe("that form couldn't be read. try again.");
    }
  });

  test("the address is never logged, whatever happens", async () => {
    const logs = captureLogs();
    for (const handler of [quoted, () => json({ message: "Ada Lovelace at 12 Example Street can't be reached" }, 422), () => new Response("down", { status: 503 })] as Handler[]) {
      const { deps } = await setup(handler);
      await basketPost(deps, quote(), url(`?items=${TWO}`), {});
    }
    expect(logs()).not.toMatch(/Ada|Lovelace|Example Street|Bondi|2026|400 000/);
  });
});
```

Create `tests/unit/basket-view.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import Basket from "../../src/components/prints/Basket.astro";
import { parseItems } from "../../src/lib/prints/basket";
import type { BasketView } from "../../src/lib/prints/basket-page";
import { EMPTY_ADDRESS } from "../../src/lib/prints/address";
import { resolveBasket } from "../../src/lib/prints/store";
import { ADDRESS, printDb } from "./prints-fakes";
import { render, text } from "./render";

const GST = "prices include no gst; the seller isn't registered for gst.";
const viewOf = async (items: string, over: Partial<BasketView> = {}): Promise<BasketView> => ({
  basket: await resolveBasket(await printDb(), parseItems(items)), notes: [], open: true, address: { ...EMPTY_ADDRESS }, errors: {}, quote: null, gst: GST, ...over,
});
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);
const TWO = "fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed";

describe("the basket page", () => {
  test("its head row says where the basket lives and links back to the gallery with it", async () => {
    const doc = await render(Basket, { view: await viewOf(TWO) });
    expect(labels(doc)).toEqual(["basket", "prints", "deliver to"]);
    expect(text(doc.querySelector("h1"))).toBe("your basket");
    expect(text(doc.querySelector(".intro"))).toBe("this basket lives in the address bar: bookmark or share this page to keep it.");
    expect(doc.querySelector(".where a")!.getAttribute("href")).toBe(`/photos?items=${TWO}`);
    expect(text(doc.querySelector(".where a"))).toBe("keep looking");
    expect(doc.querySelector("script")).toBeNull();
  });

  test("one line per print line: its eager 240 preview, name, size, frame, quantity, price and links", async () => {
    const doc = await render(Basket, { view: await viewOf(TWO) });
    const lines = [...doc.querySelectorAll(".basket-line")];
    expect(lines.map((line) => text(line.querySelector(".line-name")))).toEqual(["photo 1 of 2 from 14.06.26", "photo 2 of 2 from 14.06.26"]);
    expect(lines.map((line) => text(line.querySelector(".line-what")))).toEqual(["medium · 12 × 18 in · oak frame × 2 · $358", "small · 8 × 12 in · unframed · $59"]);
    const img = lines[0].querySelector("img")!;
    expect(["loading", "width", "height", "alt"].map((name) => img.getAttribute(name))).toEqual(["eager", "160", "240", ""]);
    expect([...lines[1].querySelectorAll(".line-links a")].map((a) => [text(a), a.getAttribute("href")])).toEqual([
      ["one more", `/basket?items=${TWO}&more=2`], ["remove one", `/basket?items=${TWO}&remove=2`],
    ]);
    expect(text(doc.querySelector(".basket-total"))).toBe("prints $417");
  });

  test("at ten prints there is no one more", async () => {
    const doc = await render(Basket, { view: await viewOf(Array.from({ length: 10 }, () => "fixture-b-01:small:oak").join(",")) });
    expect([...doc.querySelectorAll(".line-links a")].map(text)).toEqual(["remove one"]);
  });

  test("the address form posts to the basket, each field labelled with its shipping autocomplete token", async () => {
    const doc = await render(Basket, { view: await viewOf(TWO) });
    const form = doc.querySelector("form#deliver")!;
    expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["post", `/basket?items=${TWO}`]);
    expect(form.querySelector('input[name="intent"]')!.getAttribute("value")).toBe("quote");
    const fields = [...form.querySelectorAll("input:not([type=hidden]), select")].map((control) => [control.getAttribute("name"), control.getAttribute("autocomplete"), text(form.querySelector(`label[for="${control.id}"]`))]);
    expect(fields).toEqual([
      ["name", "shipping name", "full name"], ["line1", "shipping address-line1", "street address"], ["line2", "shipping address-line2", "apartment, unit or building"],
      ["city", "shipping address-level2", "city or suburb"], ["state", "shipping address-level1", "state or region"], ["postcode", "shipping postal-code", "postcode"],
      ["country", "shipping country", "country"], ["phone", "shipping tel", "phone"],
    ]);
    expect(form.querySelector('input[name="phone"]')!.getAttribute("type")).toBe("tel");
    expect(text(form.querySelector('select option[value=""]'))).toBe("choose a country");
    expect(text(form.querySelector(".prints-hint"))).toBe("this address goes to stripe and artelo, to quote and deliver your prints. this site doesn't keep it.");
    expect(text(form.querySelector("button"))).toBe("quote delivery");
  });

  test("a failed field reopens with its value and a message beside it; addresses are text, never markup", async () => {
    const address = { ...ADDRESS, line2: "<b>unit</b> 3" };
    const doc = await render(Basket, { view: await viewOf(TWO, { address, errors: { phone: "that phone number looks too short.", form: "artelo couldn't quote delivery to this address: no" } }) });
    expect(doc.querySelector('input[name="line2"]')!.getAttribute("value")).toBe("<b>unit</b> 3");
    expect(doc.querySelector("#deliver b")).toBeNull();
    expect(doc.querySelector('input[name="phone"]')!.getAttribute("aria-invalid")).toBe("true");
    expect(text(doc.querySelector("#deliver-phone-error"))).toBe("that phone number looks too short.");
    expect(text(doc.querySelector("#deliver .basket-error[role=alert]"))).toBe("artelo couldn't quote delivery to this address: no");
    expect(doc.querySelector('select[name="country"] option[selected]')!.getAttribute("value")).toBe("AU");
  });

  test("after a quote: the total, the breakdown, the gst sentence and a pay form carrying the address and the sealed quote", async () => {
    const quote = { printTotal: 41700, deliveryAmount: 4900, label: "delivery", breakdown: "artelo's freight us$30.00 for this address, …", token: "sealed.token" };
    const doc = await render(Basket, { view: await viewOf(TWO, { address: ADDRESS, quote }) });
    expect(labels(doc)).toEqual(["basket", "prints", "deliver to", "total"]);
    expect(text(doc.querySelector(".quote-line"))).toBe("prints $417 + delivery $49 = $466");
    expect([...doc.querySelectorAll("#total .prints-hint")].map(text).slice(0, 2)).toEqual(["artelo's freight us$30.00 for this address, …", `in australian dollars. ${GST}`]);
    const pay = doc.querySelector("form#pay")!;
    expect([pay.getAttribute("method"), pay.getAttribute("action")]).toEqual(["post", `/basket?items=${TWO}`]);
    const hidden = Object.fromEntries([...pay.querySelectorAll("input[type=hidden]")].map((input) => [input.getAttribute("name"), input.getAttribute("value")]));
    expect(hidden).toEqual({ intent: "checkout", ...ADDRESS, quote: "sealed.token" });
    expect(text(pay.querySelector("button"))).toBe("continue to payment");
    expect(text(pay.querySelector(".prints-hint"))).toBe("payment happens on stripe's own checkout page, which sets its own cookies. this site sets none. your address is fixed there; to change it, change it here and quote again.");
  });

  test("an empty basket says so; closed prints show the lines and no form; notes are shown", async () => {
    let doc = await render(Basket, { view: await viewOf("") });
    expect(labels(doc)).toEqual(["basket", "prints"]);
    expect(text(doc.querySelector(".empty"))).toBe("your basket is empty. find a photo you like.");
    expect(doc.querySelector('.empty a[href="/photos"]')).not.toBeNull();
    doc = await render(Basket, { view: await viewOf(TWO, { open: false, notes: ["a basket holds up to 10 prints."] }) });
    expect(labels(doc)).toEqual(["basket", "prints"]);
    expect(text(doc.querySelector(".basket-closed"))).toBe("prints are closed for now.");
    expect(text(doc.querySelector(".basket-note"))).toBe("a basket holds up to 10 prints.");
    expect(doc.querySelector("form")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/seal.test.ts tests/unit/basket-page.test.ts tests/unit/basket-view.test.ts`
Expected: FAIL, the modules and components don't exist.

- [ ] **Step 3: Write the seal and the limits**

Create `src/lib/prints/seal.ts`:

```ts
import { ADDRESS_FIELDS, type Address } from "./address";
import type { TaxLine } from "./quote";

// A successful quote is sealed so checkout charges exactly what was shown without asking Artelo again, and so an edited
// address can't keep an old price (spec 16.2). It lives only in the form body and the rendered page.

/** A quote is good for 30 minutes */
export const QUOTE_SECONDS = 30 * 60;

export interface QuotePayload {
  /** The canonical items value quoted */
  items: string;
  /** Every field exactly as validated */
  address: Address;
  /** AUD cents */
  printTotal: number;
  /** AUD cents */
  deliveryAmount: number;
  /** Artelo's freight, US cents */
  freightCents: number;
  taxes: TaxLine[];
  buffer: number;
  rate: number;
  /** Seconds since 1970 */
  expires: number;
}

const encoder = new TextEncoder();
const LABEL = "print-quote:";

export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function fromB64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** PRINT_VIEW_SECRET as an HMAC-SHA256 key; each use signs under its own label */
export const hmacKey = (secret: string) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function sealQuote(secret: string, payload: QuotePayload): Promise<string> {
  const json = JSON.stringify(payload);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(LABEL + json)));
  return `${b64url(encoder.encode(json))}.${b64url(signature)}`;
}

/** The sealed payload when the signature holds (checked in constant time by Web Crypto) and it hasn't run out; null otherwise */
export async function openQuote(secret: string, token: string, now: number): Promise<QuotePayload | null> {
  if (!secret || token.length > 8000) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const body = fromB64url(parts[0]);
  const signature = fromB64url(parts[1]);
  if (!body || !signature || body.length === 0) return null;
  const json = new TextDecoder().decode(body);
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, encoder.encode(LABEL + json)))) return null;
  let payload: QuotePayload;
  try {
    payload = JSON.parse(json) as QuotePayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.expires !== "number" || payload.expires <= now) return null;
  return payload;
}

/** The URL's items and every posted address field exactly as sealed (spec 17.2 step 2) */
export function sameQuote(payload: QuotePayload, items: string, address: Address): boolean {
  return payload.items === items && ADDRESS_FIELDS.every((name) => payload.address?.[name] === address[name]);
}
```

Create `src/lib/prints/limits.ts`:

```ts
// Quotes call Artelo, so they are limited with Workers Rate Limiting, which sets no cookie (spec 21.3). Limits count per
// Cloudflare location, which is accepted.

export interface PrintLimits {
  quote?: RateLimit;
  checkout?: RateLimit;
  artelo?: RateLimit;
}

/** QUOTE_LIMIT and CHECKOUT_LIMIT key on the visitor's address; test builds on X-Test-Client when a request sends it */
export function clientKey(request: Request, testClients: boolean): string {
  const test = testClients ? request.headers.get("x-test-client") : null;
  return test ? `test:${test}` : (request.headers.get("cf-connecting-ip") ?? "unknown");
}

/** ARTELO_LIMIT keeps every quote under Artelo's own limit with one bucket; test builds give each test client its own */
export function arteloKey(request: Request, testClients: boolean): string {
  const test = testClients ? request.headers.get("x-test-client") : null;
  return test ? `price-check:${test}` : "price-check";
}

/** Whether the request is under the limit. A missing or failing binding lets it through, logged: the limit protects Artelo's quota, not money */
export async function underLimit(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (error) {
    console.error("prints: a rate limit couldn't be checked", error instanceof Error ? error.message : String(error));
    return true;
  }
}
```

- [ ] **Step 4: Write the basket's handlers**

Create `src/lib/prints/basket-page.ts`:

```ts
import { checkAddress, EMPTY_ADDRESS, readAddress, type Address, type AddressErrors } from "./address";
import { priceCheck } from "./artelo";
import { basketHref, CAP_NOTE, changeLines, droppedNotes, itemsValue, parseItems, readOp } from "./basket";
import type { PrintDeps } from "./config";
import { arteloKey, clientKey, underLimit, type PrintLimits } from "./limits";
import { gstSentence } from "./money";
import { printsStatus } from "./open";
import { breakdown, deliveryAmount, deliveryLabel } from "./quote";
import { QUOTE_SECONDS, sealQuote, type QuotePayload } from "./seal";
import { loadBasket, type PrintSettings, type ResolvedBasket } from "./store";

// /basket (spec 15.2 to 16.3): the basket from its query string, the address form and the quote. A POST render can't be
// redirected without putting the address in a URL or storing it, so the quote answers 200, not post, redirect, get.

export interface QuoteView {
  printTotal: number;
  deliveryAmount: number;
  label: string;
  breakdown: string;
  /** The sealed quote, for the pay form's hidden field */
  token: string;
}

export interface BasketView {
  basket: ResolvedBasket;
  /** Lines about prints taken out or refused */
  notes: string[];
  open: boolean;
  /** What the address form shows: empty on a GET, as posted on a POST */
  address: Address;
  errors: AddressErrors & { form?: string };
  quote: QuoteView | null;
  gst: string;
}

export type BasketOutcome = { redirect: string } | { status: number; view: BasketView; beacon: boolean };

export const FORM_UNREADABLE = "that form couldn't be read. try again.";

function viewOf(deps: PrintDeps, basket: ResolvedBasket, settings: PrintSettings, over: Partial<BasketView> = {}): BasketView {
  return {
    basket, notes: droppedNotes(basket.unavailable, basket.overCap), open: printsStatus(deps.config, settings.rate).open,
    address: { ...EMPTY_ADDRESS }, errors: {}, quote: null, gst: gstSentence(deps.config.gst), ...over,
  };
}

/** The basket, or a change to it answered with 303 to the canonical URL; a change that can't apply renders with its line */
export async function basketGet(deps: PrintDeps, url: URL): Promise<BasketOutcome> {
  const op = readOp(url.searchParams);
  const raw = parseItems(url.searchParams.get("items"));
  const { basket, settings } = await loadBasket(deps.db, op?.kind === "add" ? [...raw, op.entry] : raw);
  const view = viewOf(deps, basket, settings);
  if (op && view.notes.length === 0) {
    if (op.kind === "add") return { redirect: basketHref(basket.items) };
    const changed = changeLines(basket.lines, op);
    if (!changed.refused) return { redirect: basketHref(itemsValue(changed.lines)) };
    view.notes.push(CAP_NOTE);
  }
  return { status: 200, view, beacon: true };
}

export async function quoteView(secret: string, payload: QuotePayload): Promise<QuoteView> {
  return { printTotal: payload.printTotal, deliveryAmount: payload.deliveryAmount, label: deliveryLabel(payload.taxes), breakdown: breakdown(payload), token: await sealQuote(secret, payload) };
}

/** intent=quote (spec 16.1); Task 7 adds intent=checkout. A POST render carries no beacon */
export async function basketPost(deps: PrintDeps, request: Request, url: URL, limits: PrintLimits): Promise<BasketOutcome> {
  const form = await request.formData().catch(() => null);
  const { basket, settings } = await loadBasket(deps.db, parseItems(url.searchParams.get("items")));
  const address = form ? readAddress(form) : { ...EMPTY_ADDRESS };
  const render = (status: number, over: Partial<BasketView> = {}): BasketOutcome => ({ status, beacon: false, view: viewOf(deps, basket, settings, { address, ...over }) });
  const intent = form?.get("intent");
  if (intent !== "quote") return render(422, { errors: { form: FORM_UNREADABLE } });

  const { testClients } = deps.config;
  // Both limits before anything else, so a flood never reaches Artelo (spec 16.1, 21.3)
  if (!(await underLimit(limits.quote, clientKey(request, testClients))) || !(await underLimit(limits.artelo, arteloKey(request, testClients)))) {
    return render(429, { errors: { form: "too many quotes - wait a minute and try again." } });
  }
  if (!printsStatus(deps.config, settings.rate).open || basket.count === 0) return render(200);
  if (basket.unavailable > 0 || basket.overCap > 0) return render(422);
  const checked = checkAddress(address);
  if (!checked.ok) return render(422, { errors: checked.errors });
  const rate = settings.rate!;
  const result = await priceCheck(deps, basket.lines, checked.address, rate);
  if (!result.ok) {
    if (result.refused === null) return render(503, { errors: { form: "delivery prices aren't loading right now. try again in a minute." } });
    return render(422, { errors: { form: result.refused ? `artelo couldn't quote delivery to this address: ${result.refused}` : "artelo couldn't quote delivery to this address." } });
  }
  const payload: QuotePayload = {
    items: basket.items, address: checked.address, printTotal: basket.printTotal,
    deliveryAmount: deliveryAmount(result.costs.freightCents, result.costs.taxes, rate, settings.buffer),
    freightCents: result.costs.freightCents, taxes: result.costs.taxes, buffer: settings.buffer, rate, expires: deps.now() + QUOTE_SECONDS,
  };
  return render(200, { address: checked.address, quote: await quoteView(deps.config.secrets.PRINT_VIEW_SECRET, payload) });
}
```

- [ ] **Step 5: Write the page and its components**

Create `src/components/prints/BasketLines.astro`:

```astro
---
import { MAX_PRINTS } from "../../lib/prints/basket";
import { printLine } from "../../lib/prints/catalogue";
import { aud } from "../../lib/prints/money";
import type { ResolvedBasket } from "../../lib/prints/store";

// The basket's lines (spec 15.2): each change is a plain link, so it clears any quote; the browser's autofill refills the address
interface Props {
  basket: ResolvedBasket;
}

const { basket } = Astro.props;
const change = (kind: "more" | "remove", line: number) => `/basket?items=${basket.items}&${kind}=${line}`;
---
<ol class="basket-lines">
  {basket.lines.map((line) => (
    <li class="basket-line">
      {/* Eager: a basket holds at most ten, and their width and height keep the layout still */}
      {line.thumb && <img src={line.thumb.url} width={line.thumb.width} height={line.thumb.height} alt="" loading="eager" decoding="async" />}
      <div>
        <p class="line-name">{line.name}</p>
        <p class="line-what">{printLine(line.tier, line.size, line.frame)}{line.quantity > 1 && ` × ${line.quantity}`} · {aud(line.unitAmount * line.quantity)}</p>
        <p class="line-links">{basket.count < MAX_PRINTS && <><a href={change("more", line.line)}>one more</a> · </>}<a href={change("remove", line.line)}>remove one</a></p>
      </div>
    </li>
  ))}
</ol>
<p class="basket-total">prints {aud(basket.printTotal)}</p>
```

Create `src/components/prints/AddressForm.astro`:

```astro
---
import type { Address, AddressErrors, AddressField } from "../../lib/prints/address";
import { countryOptions } from "../../lib/prints/countries";

// The address form (spec 15.4): shipping autocomplete tokens so the browser fills it from its own store; the address
// travels only in this form's body, never in its action's query string
interface Props {
  action: string;
  address: Address;
  errors: AddressErrors & { form?: string };
}

const { action, address, errors } = Astro.props;
const FIELDS: { name: AddressField; label: string; autocomplete: string; max: number; required: boolean }[] = [
  { name: "name", label: "full name", autocomplete: "shipping name", max: 100, required: true },
  { name: "line1", label: "street address", autocomplete: "shipping address-line1", max: 100, required: true },
  { name: "line2", label: "apartment, unit or building", autocomplete: "shipping address-line2", max: 100, required: false },
  { name: "city", label: "city or suburb", autocomplete: "shipping address-level2", max: 60, required: true },
  { name: "state", label: "state or region", autocomplete: "shipping address-level1", max: 60, required: false },
  { name: "postcode", label: "postcode", autocomplete: "shipping postal-code", max: 20, required: false },
];
const describedBy = (name: AddressField) => (errors[name] ? `deliver-${name}-error` : undefined);
---
<form method="post" action={action} id="deliver" class="basket-form">
  {errors.form && <p class="basket-error" role="alert">{errors.form}</p>}
  <input type="hidden" name="intent" value="quote" />
  {FIELDS.map((field) => (
    <div class:list={["field", { invalid: errors[field.name] }]}>
      <label for={`deliver-${field.name}`}>{field.label}</label>
      <input id={`deliver-${field.name}`} name={field.name} type="text" value={address[field.name]} autocomplete={field.autocomplete} maxlength={field.max}
        required={field.required} aria-invalid={errors[field.name] ? "true" : undefined} aria-describedby={describedBy(field.name)} />
      {errors[field.name] && <p class="basket-error" id={`deliver-${field.name}-error`}>{errors[field.name]}</p>}
    </div>
  ))}
  <div class:list={["field", { invalid: errors.country }]}>
    <label for="deliver-country">country</label>
    <select id="deliver-country" name="country" autocomplete="shipping country" required aria-invalid={errors.country ? "true" : undefined} aria-describedby={describedBy("country")}>
      <option value="">choose a country</option>
      {countryOptions().map(([code, name]) => <option value={code} selected={code === address.country}>{name}</option>)}
    </select>
    {errors.country && <p class="basket-error" id="deliver-country-error">{errors.country}</p>}
  </div>
  <div class:list={["field", { invalid: errors.phone }]}>
    <label for="deliver-phone">phone</label>
    <input id="deliver-phone" name="phone" type="tel" value={address.phone} autocomplete="shipping tel" maxlength={20} required
      aria-invalid={errors.phone ? "true" : undefined} aria-describedby={describedBy("phone")} />
    {errors.phone && <p class="basket-error" id="deliver-phone-error">{errors.phone}</p>}
  </div>
  <p class="prints-hint">this address goes to stripe and artelo, to quote and deliver your prints. this site doesn't keep it.</p>
  <button type="submit" class="print-button">quote delivery</button>
</form>
```

Create `src/components/prints/QuoteTotal.astro`:

```astro
---
import { ADDRESS_FIELDS, type Address } from "../../lib/prints/address";
import type { QuoteView } from "../../lib/prints/basket-page";
import { aud } from "../../lib/prints/money";

// The total and the pay form (spec 16.3): the address repeated as hidden fields and the sealed quote, which checkout verifies
interface Props {
  action: string;
  quote: QuoteView;
  address: Address;
  gst: string;
}

const { action, quote, address, gst } = Astro.props;
---
<p class="quote-line">prints {aud(quote.printTotal)} + {quote.label} {aud(quote.deliveryAmount)} = {aud(quote.printTotal + quote.deliveryAmount)}</p>
<p class="prints-hint">{quote.breakdown}</p>
<p class="prints-hint">in australian dollars. {gst}</p>
<form method="post" action={action} id="pay" class="basket-form pay-form">
  <input type="hidden" name="intent" value="checkout" />
  {ADDRESS_FIELDS.map((name) => <input type="hidden" name={name} value={address[name]} />)}
  <input type="hidden" name="quote" value={quote.token} />
  <button type="submit" class="print-button">continue to payment</button>
  <p class="prints-hint">payment happens on stripe's own checkout page, which sets its own cookies. this site sets none. your address is fixed there; to change it, change it here and quote again.</p>
</form>
```

Create `src/components/prints/Basket.astro`:

```astro
---
import Row from "../Row.astro";
import AddressForm from "./AddressForm.astro";
import BasketLines from "./BasketLines.astro";
import QuoteTotal from "./QuoteTotal.astro";
import { itemsQuery } from "../../lib/prints/basket";
import type { BasketView } from "../../lib/prints/basket-page";
import "../../styles/prints.css";

// The basket page (spec 15.2): no script; every form posts to the basket's own URL, its items in the query string
interface Props {
  view: BasketView;
}

const { view } = Astro.props;
const { basket } = view;
const action = `/basket${itemsQuery(basket.items)}`;
---
<main class="book basket">
  <Row label="basket" head>
    <h1>your basket</h1>
    <p class="intro">this basket lives in the address bar: bookmark or share this page to keep it.</p>
    <p class="where"><a href={`/photos${itemsQuery(basket.items)}`}>keep looking</a></p>
  </Row>
  <Row label="prints" id="basket-prints">
    {view.notes.map((note) => <p class="basket-note" role="status">{note}</p>)}
    {basket.count === 0 ? (
      <p class="empty">your basket is empty. <a href="/photos">find a photo you like.</a></p>
    ) : (
      <>
        <BasketLines basket={basket} />
        {!view.open && <p class="basket-closed">prints are closed for now.</p>}
      </>
    )}
  </Row>
  {basket.count > 0 && view.open && (
    <Row label="deliver to" id="deliver-to"><AddressForm action={action} address={view.address} errors={view.errors} /></Row>
  )}
  {basket.count > 0 && view.open && view.quote && (
    <Row label="total" id="total"><QuoteTotal action={action} quote={view.quote} address={view.address} gst={view.gst} /></Row>
  )}
</main>
```

Create `src/pages/basket.astro`:

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../layouts/Notebook.astro";
import Beacon from "../components/Beacon.astro";
import Row from "../components/Row.astro";
import Basket from "../components/prints/Basket.astro";
import { basketGet, basketPost, type BasketOutcome } from "../lib/prints/basket-page";
import { printDeps } from "../lib/prints/config";
import "../styles/prints.css";

// The basket (spec 15.2): never cached, never indexed; a GET counts a page view (the beacon sends the path only), a POST,
// which shows an address, carries no beacon
const deps = printDeps(env, (promise) => Astro.locals.cfContext.waitUntil(promise));
let outcome: BasketOutcome | null = null;
try {
  outcome = Astro.request.method === "POST"
    ? await basketPost(deps, Astro.request, Astro.url, { quote: env.QUOTE_LIMIT, checkout: env.CHECKOUT_LIMIT, artelo: env.ARTELO_LIMIT })
    : await basketGet(deps, Astro.url);
} catch (error) {
  // The message only: never the request, which can carry an address
  console.error("prints: the basket failed", error instanceof Error ? error.message : String(error));
}
if (outcome && "redirect" in outcome) return Astro.redirect(outcome.redirect, 303);
Astro.response.status = outcome ? outcome.status : 503;
Astro.response.headers.set("Cache-Control", "no-store");
---
<Notebook title="your basket · george vlachos" noindex>
  {outcome ? (
    <Basket view={outcome.view} />
  ) : (
    <main class="book basket">
      <Row label="basket" head>
        <h1>your basket</h1>
        <p class="down">the basket isn't loading right now. try again in a bit.</p>
      </Row>
    </main>
  )}
  {outcome?.beacon && <Beacon />}
</Notebook>
```

Append to `src/styles/prints.css`:

```css
/* The basket (spec 15.2) */
.basket-lines { display: grid; gap: 14px; }
.basket-line { display: flex; gap: 14px; align-items: flex-start; }
.basket-line img { flex: none; display: block; height: 88px; width: auto; background: #ecebe5; }
.line-name { font-size: 16px; }
.line-what, .line-links { font: 12.5px/1.55 var(--mono); color: var(--muted); }
.line-links { margin-top: 2px; }
.basket-total { margin-top: 16px; font: 12.5px/1.55 var(--mono); color: var(--ink); }
.basket-note, .basket-closed { margin-bottom: 12px; color: var(--muted); }
.basket-form { display: grid; gap: 12px; max-width: 34rem; }
.basket-form .field { display: grid; gap: 4px; min-width: 0; }
.basket-form label { font: 12px/1.5 var(--mono); color: var(--muted); }
/* 16px keeps iOS from zooming into a focused field; the edge is 3:1 against the paper (WCAG 1.4.11), as the admin's */
.basket-form input:not([type="hidden"]), .basket-form select {
  font: inherit; font-size: 16px; line-height: 1.4; color: var(--ink);
  background: var(--mat); border: 1px solid #85857d; border-radius: 4px; padding: 8px 10px; width: 100%; min-width: 0;
}
.basket-form .invalid input, .basket-form .invalid select { border-color: #a83a24; }
.basket-form input:focus-visible, .basket-form select:focus-visible { outline: 1.5px solid var(--ink); outline-offset: 2px; }
/* --red is under 4.5:1 on paper for small text; this darker red is 5.6:1 */
.basket-error { font-size: 14px; color: #a83a24; }
.quote-line { font-size: 18px; margin-bottom: 8px; }
.pay-form { margin-top: 14px; }
```

In `public/robots.txt`, add two lines at the end:

```
Disallow: /prints/
Disallow: /basket
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/seal.test.ts tests/unit/basket-page.test.ts tests/unit/basket-view.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 7: Add Price Check to the stand-in and the e2e helpers**

In `tests/fixtures/artelo-site.mjs`, add above the line `// Routes added by later tasks go above this line`:

```js
// Price Check (spec 23.3): US$30.00 freight for any basket, US$40.00 production a print, US$4.20 sales tax for a US
// address and nothing elsewhere, and a refusal with a message for Antarctica
route("POST", "/orders/price-check", ({ body, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const order = JSON.parse(body);
  received.priceChecks.push(order);
  const country = order.customerAddress?.country;
  if (country === "AQ") return [400, { message: "artelo doesn't deliver to antarctica" }];
  const prints = order.items.reduce((count, item) => count + item.quantity, 0);
  const tax = country === "US" ? 4.2 : 0;
  return [200, { orderCosts: { productionCost: 40 * prints, arteloShipping: 30, usSalesTax: tax, gst: 0, hst: 0, pst: 0, total: 40 * prints + 30 + tax } }];
});
```

Replace `tests/e2e/prints.ts` with:

```ts
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { STAND_IN } from "./prints-site";

// Helpers for the print specs. They write only to the prints servers' own stores and read the stand-in.

/** A suffix unique to this attempt, so parallel and retried tests never collide */
export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

/** SQL on a prints server's own local store: reading a row, or setting test data (spec 11.2's rule) */
export function printsD1<T = Record<string, unknown>>(sql: string, store = ".wrangler/prints"): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", store, "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
}

/** JSON from the stand-in */
export async function standIn<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${STAND_IN}${path}`, init);
  if (!response.ok) throw new Error(`the stand-in answered ${response.status} on ${path}`);
  return (await response.json()) as T;
}

/** fixture-b-01 medium oak and fixture-b-02 small unframed: $179 + $59 = $238 */
export const TWO_PRINTS = "fixture-b-01:medium:oak,fixture-b-02:small:unframed";

export interface TestAddress {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
}

/** A test address in Australia; the name makes it findable among the stand-in's requests */
export const auAddress = (name: string): TestAddress => ({ name, line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postcode: "2026", country: "AU", phone: "+61 400 000 000" });
export const usAddress = (name: string): TestAddress => ({ name, line1: "1600 Example Avenue", line2: "", city: "Arlington", state: "VA", postcode: "22201", country: "US", phone: "+1 202 555 0100" });

/** Its own rate-limit bucket for this test (spec 21.3): the context's page and request both send it */
export async function asTestClient(page: Page): Promise<string> {
  const client = `spec-${unique()}`;
  await page.context().setExtraHTTPHeaders({ "X-Test-Client": client });
  return client;
}

export async function fillAddress(page: Page, address: TestAddress) {
  for (const name of ["name", "line1", "line2", "city", "state", "postcode", "phone"] as const) await page.locator(`#deliver [name="${name}"]`).fill(address[name]);
  await page.locator('#deliver [name="country"]').selectOption(address.country);
}

export async function quoteDelivery(page: Page, address: TestAddress) {
  await fillAddress(page, address);
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "quote delivery" }).click()]);
}

/** The Price Checks the stand-in received for this address name */
export async function priceChecksFor(name: string) {
  const { priceChecks } = await standIn<{ priceChecks: { customerAddress: Record<string, string>; items: { quantity: number; productInfo: Record<string, unknown> }[] }[] }>("/__requests");
  return priceChecks.filter((check) => check.customerAddress.name === name);
}
```

- [ ] **Step 8: Write the basket's e2e specs**

Append to `tests/e2e/prints-basket.spec.ts`, adding to its imports `import { asTestClient, auAddress, priceChecksFor, quoteDelivery, TWO_PRINTS, unique, usAddress } from "./prints";`:

```ts
test.describe("the basket without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("adding from a photo's page, one more and remove one each land on the canonical basket", async ({ page }) => {
    await page.goto("/photos/fixture-b-01");
    await page.getByLabel("medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed").check();
    await page.getByLabel("oak frame").check();
    await page.getByRole("button", { name: "add to basket" }).click();
    await expect(page).toHaveURL(/\/basket\?items=fixture-b-01:medium:oak$/);
    await expect(page.locator(".line-what")).toHaveText(["medium · 12 × 18 in · oak frame · $179"]);
    await page.getByRole("link", { name: "one more" }).click();
    await expect(page).toHaveURL(/\/basket\?items=fixture-b-01:medium:oak,fixture-b-01:medium:oak$/);
    await expect(page.locator(".line-what")).toHaveText(["medium · 12 × 18 in · oak frame × 2 · $358"]);
    await page.getByRole("link", { name: "keep looking" }).click();
    await expect(page).toHaveURL(/\/photos\?items=fixture-b-01:medium:oak,fixture-b-01:medium:oak$/);
    await page.goBack();
    await page.getByRole("link", { name: "remove one" }).click();
    await expect(page.locator(".basket-total")).toHaveText("prints $179");
  });

  test("a basket holds ten prints, and an entry edited by hand is dropped with a line", async ({ page }) => {
    const ten = Array.from({ length: 10 }, () => "fixture-b-01:small:oak").join(",");
    await page.goto(`/basket?items=${ten}`);
    await expect(page.getByRole("link", { name: "one more" })).toHaveCount(0);
    const response = await page.goto(`/basket?items=${ten}&add=fixture-b-02&size=small&frame=unframed`);
    expect(response?.status()).toBe(200);
    await expect(page.locator(".basket-note")).toHaveText(["a basket holds up to 10 prints."]);
    await page.goto("/basket?items=fixture-b-01:medium:oak,fixture-c-01:small:oak");
    await expect(page.locator(".basket-note")).toHaveText(["1 print was taken out: that photo isn't available as a print any more."]);
    await expect(page.locator(".basket-line")).toHaveCount(1);
  });

  test("the basket is never cached or indexed, counts a page view and is disallowed to crawlers", async ({ page, request }) => {
    const response = await page.goto(`/basket?items=${TWO_PRINTS}`);
    expect(response?.headers()["cache-control"]).toBe("no-store");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator("script")).toHaveCount(1);
    expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/prints\/\nDisallow: \/basket/);
  });

  test("an invalid address reopens with its values and messages", async ({ page }) => {
    await asTestClient(page);
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, { ...auAddress(`Ada ${unique()}`), phone: "12" });
    await expect(page.locator("#deliver-phone-error")).toHaveText("that phone number looks too short.");
    await expect(page.locator('#deliver [name="line1"]')).toHaveValue("12 Example Street");
    await expect(page.locator("#total")).toHaveCount(0);
  });

  test("an australian address is quoted once for the whole basket, exactly, and the address is in no url", async ({ page }) => {
    await asTestClient(page);
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    const name = `Ada ${unique()}`;
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, auAddress(name));
    await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery $49 = $287");
    await expect(page.locator("#total .prints-hint").first()).toHaveText("artelo's freight us$30.00 for this address, converted at a$1.50 per us$1, plus 8% in case the exchange rate moves, rounded up to the dollar.");
    await expect(page.locator("script")).toHaveCount(0);
    const checks = await priceChecksFor(name);
    expect(checks).toHaveLength(1);
    expect(checks[0].customerAddress).toMatchObject({ street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" });
    expect(checks[0].items.map((item) => [item.quantity, item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation])).toEqual([[1, "x12x18", "NaturalOak", "Vertical"], [1, "x8x12", null, "Horizontal"]]);
    expect(urls.filter((url) => /Example|Bondi|Ada|400(%20|\+| )000/.test(decodeURIComponent(url)))).toEqual([]);
  });

  test("a us address passes on the sales tax as destination taxes; antarctica is refused beside the form", async ({ page }) => {
    await asTestClient(page);
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, usAddress(`Grace ${unique()}`));
    await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery and destination taxes $56 = $294");
    await expect(page.locator("#total .prints-hint").first()).toContainText("artelo's freight us$30.00 and us sales tax us$4.20 for this address");
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, { ...auAddress(`Ada ${unique()}`), country: "AQ" });
    await expect(page.locator("#deliver .basket-error[role=alert]")).toHaveText("artelo couldn't quote delivery to this address: artelo doesn't deliver to antarctica");
    await expect(page.locator("#total")).toHaveCount(0);
  });
});

test("the eleventh quote in a minute from one client answers 429 without reaching artelo", async ({ request }) => {
  test.setTimeout(90_000);
  // Miniflare's local limiter aligns its windows to the wall clock's minutes, so start well inside one
  const into = Date.now() % 60_000;
  if (into > 40_000) await new Promise((resolve) => setTimeout(resolve, 60_500 - into));
  const name = `Ada ${unique()}`;
  const client = `spec-${unique()}`;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const response = await request.post(`/basket?items=${TWO_PRINTS}`, { form: { intent: "quote", ...auAddress(name) }, headers: { Origin: PRINTS, "X-Test-Client": client } });
    statuses.push(response.status());
  }
  expect(statuses).toEqual([...Array(10).fill(200), 429]);
  expect(await priceChecksFor(name)).toHaveLength(10);
});
```

- [ ] **Step 9: Build and run the e2e specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-basket.spec.ts tests/e2e/head.spec.ts`
Expected: every test passing.

- [ ] **Step 10: Visual check**

Start the throwaway server, then shoot the basket before and after a quote at both widths:

```bash
node -e '
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  for (const [width, height] of [[375, 812], [1280, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto("http://localhost:4336/basket?items=fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed");
    await page.screenshot({ path: `${process.env.TMPDIR}/basket-${width}.png`, fullPage: true });
    const address = { name: "Ada Lovelace", line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postcode: "2026", phone: "+61 400 000 000" };
    for (const [name, value] of Object.entries(address)) await page.fill(`#deliver [name="${name}"]`, value);
    await page.selectOption("#deliver [name=country]", "AU");
    await Promise.all([page.waitForNavigation(), page.click("text=quote delivery")]);
    await page.screenshot({ path: `${process.env.TMPDIR}/basket-quoted-${width}.png`, fullPage: true });
  }
  await browser.close();
})();'
```

Look for: thumbnails at 88px with their lines beside them, the links in mono, the form's fields full width on a phone with labels above, a failed field's message in the darker red, the total line larger than the breakdown, the pay button and its note under it, nothing wider than the column. Then stop it.

- [ ] **Step 11: Commit**

```bash
git add src/lib/prints/seal.ts src/lib/prints/limits.ts src/lib/prints/basket-page.ts src/pages/basket.astro src/components/prints/Basket.astro src/components/prints/BasketLines.astro src/components/prints/AddressForm.astro src/components/prints/QuoteTotal.astro src/styles/prints.css public/robots.txt tests/fixtures/artelo-site.mjs tests/e2e/prints.ts tests/e2e/prints-basket.spec.ts tests/unit/seal.test.ts tests/unit/basket-page.test.ts tests/unit/basket-view.test.ts
git commit -m "feat: the basket page, its address form, artelo's exact delivery quote and the sealed quote"
```

---

### Task 7: checkout, with the quoted address fixed on the payment

Spec 1.2 step 7 (section 17 and 13.3's CSP change): `POST /basket` with `intent=checkout` verifies the sealed quote, writes the order and its lines before Stripe hears of it, creates a hosted Checkout Session with `fetch` (Adaptive Pricing off, the quoted address on the payment as `payment_intent_data[shipping]` and shown read-only in the custom text) and answers 303 to Stripe. The order page's view key is derived here. The stand-in learns Stripe's three endpoints.

**Files:**
- Create: `src/lib/prints/stripe.ts`, `src/lib/prints/view-key.ts`, `src/lib/prints/checkout.ts`, `tests/unit/checkout.test.ts`, `tests/unit/view-key.test.ts`, `tests/e2e/prints-checkout.spec.ts`
- Modify: `src/lib/prints/store.ts`, `src/lib/prints/basket-page.ts`, `astro.config.mjs`, `tests/fixtures/artelo-site.mjs`, `tests/e2e/prints.ts`
- Test: the two new unit tests, `tests/unit/basket-page.test.ts` (unchanged, must pass), `tests/e2e/prints-checkout.spec.ts`

**Interfaces:**
- Consumes: `PrintDeps`, `PrintConfig` (Task 1); `itemsQuery`, `frameLabel`, `sizeInches`, `gstSentence`, `plural` (Task 2); `getOrder`, `OrderRow` (Task 3); `postingTo`, `Address`, `countryName`, `deliveryLabel`, `hasTax` (Task 4); `PricedLine`, `ResolvedBasket`, `resolveBasket` (Task 5); `openQuote`, `sameQuote`, `QuotePayload`, `b64url`, `fromB64url`, `hmacKey`, `basketPost`'s `render`, `clientKey`, `underLimit` (Task 6); `ulid` (existing).
- Produces (`src/lib/prints/stripe.ts`): `STRIPE_VERSION = "2025-09-30.clover"`; `type StripeResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number | null }`; `stripe(deps, method: "GET" | "POST", path: string, form?: URLSearchParams, idempotencyKey?: string): Promise<StripeResult>`; `interface StripeSession`; `getSession(deps, id)`; `expireSession(deps, id)`; `getPaymentIntent(deps, id)`; `livemodeOf(key: string): 0 | 1`
- Produces (`src/lib/prints/view-key.ts`): `viewKey(secret, orderId): Promise<string>`; `viewKeyMatches(secret, orderId, key: string | null): Promise<boolean>`; `orderPageUrl(config, orderId): Promise<string>`
- Produces (`src/lib/prints/checkout.ts`): `CUSTOM_TEXT_LIMIT = 1200`; `customText(address, gst): string`; `interface SessionInput`; `sessionForm(input: SessionInput): URLSearchParams`; `type CheckoutOutcome = { url: string } | { failure: "stripe" | "long" }`; `startCheckout(deps, basket: ResolvedBasket, payload: QuotePayload): Promise<CheckoutOutcome>`
- Produces (`src/lib/prints/store.ts`): `interface NewOrder { id; country; printTotal; deliveryAmount; deliveryTaxed: 0 | 1; livemode: 0 | 1; now }`; `createOrder(db, order, lines): Promise<void>`; `setSession(db, id, sessionId, now): Promise<void>`; `markExpired(db, id, now): Promise<boolean>`
- Produces (`src/lib/prints/basket-page.ts`): `QUOTE_CHANGED`; `basketPost` handles `intent=checkout`
- Produces (e2e): the stand-in's `POST /stripe/v1/checkout/sessions`, `GET /stripe/v1/checkout/sessions/:id`, `POST /stripe/v1/checkout/sessions/:id/expire`, `GET /stripe/v1/payment_intents/:id`, `POST /__stripe/pay`, `GET /__stripe/sessions`; in `tests/e2e/prints.ts`: `postPayForm(page, site?)`, `sessionsFor(name)`, `type StandInSession`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/view-key.test.ts`:

```ts
import { expect, test } from "vitest";
import { orderPageUrl, viewKey, viewKeyMatches } from "../../src/lib/prints/view-key";
import { testConfig, VIEW_SECRET } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";

test("the view key is derived from the secret and the order, the same every time and never stored", async () => {
  const key = await viewKey(VIEW_SECRET, ORDER);
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await viewKey(VIEW_SECRET, ORDER)).toBe(key);
  expect(await viewKey(VIEW_SECRET, "01k6x00000000000000000000b")).not.toBe(key);
  expect(await orderPageUrl(testConfig(), ORDER)).toBe(`https://curiousgeorge.dev/prints/${ORDER}?key=${key}`);
});

test("only the right key matches; anything else, or no secret, doesn't", async () => {
  const key = await viewKey(VIEW_SECRET, ORDER);
  expect(await viewKeyMatches(VIEW_SECRET, ORDER, key)).toBe(true);
  expect(await viewKeyMatches(VIEW_SECRET, "01k6x00000000000000000000b", key)).toBe(false);
  expect(await viewKeyMatches("3".repeat(64), ORDER, key)).toBe(false);
  expect(await viewKeyMatches("", ORDER, key)).toBe(false);
  for (const wrong of [null, "", "abc", `${key}x`, key.slice(0, -1), "!".repeat(43)]) expect(await viewKeyMatches(VIEW_SECRET, ORDER, wrong)).toBe(false);
});
```

Create `tests/unit/checkout.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { basketPost } from "../../src/lib/prints/basket-page";
import { parseItems } from "../../src/lib/prints/basket";
import { customText, sessionForm, startCheckout } from "../../src/lib/prints/checkout";
import { sealQuote, type QuotePayload } from "../../src/lib/prints/seal";
import { getOrder, resolveBasket, writeSetting } from "../../src/lib/prints/store";
import { viewKey } from "../../src/lib/prints/view-key";
import { ADDRESS, captureLogs, dumpDb, fakeFetch, json, NOW, printDb, testConfig, testDeps, US_ADDRESS, VIEW_SECRET, type Handler } from "./prints-fakes";

const TWO = "fixture-b-01:medium:oak,fixture-b-02:small:unframed";
const SESSIONS = "POST https://stripe.test/v1/checkout/sessions";
const GST = "prices include no gst; the seller isn't registered for gst.";
const payload = (over: Partial<QuotePayload> = {}): QuotePayload => ({
  items: TWO, address: ADDRESS, printTotal: 23800, deliveryAmount: 4900, freightCents: 3000, taxes: [], buffer: 0.08, rate: 1.5, expires: NOW + 1800, ...over,
});
let made = 0;
const created: Handler = () => {
  made += 1;
  return json({ id: `cs_test_${made}`, url: `https://checkout.stripe.com/c/pay/cs_test_${made}` });
};
const setup = async (handler: Handler = created, over = {}) => {
  const fake = fakeFetch({ [SESSIONS]: handler });
  const db = await printDb();
  return { fake, db, deps: testDeps(db, { fetch: fake.fetch, ...over }) };
};
const pay = async (quote: string, address = ADDRESS) => {
  const form = new FormData();
  form.set("intent", "checkout");
  form.set("quote", quote);
  for (const [name, value] of Object.entries(address)) form.set(name, value);
  return new Request("https://curiousgeorge.dev/basket", { method: "POST", body: form });
};
const url = (items = TWO) => new URL(`https://curiousgeorge.dev/basket?items=${items}`);

afterEach(() => vi.restoreAllMocks());

describe("the session form", () => {
  test("adaptive pricing off, cards only, an hour to pay, each line in aud cents, then delivery", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems(TWO));
    const form = Object.fromEntries(sessionForm({ orderId: "01k6x00000000000000000000a", lines: basket.lines, payload: payload(), config: testConfig(), viewKey: "KEY", now: NOW }));
    expect(form).toMatchObject({
      mode: "payment", "payment_method_types[0]": "card", submit_type: "pay", locale: "auto", expires_at: String(NOW + 3600), "adaptive_pricing[enabled]": "false",
      "line_items[0][price_data][currency]": "aud", "line_items[0][price_data][unit_amount]": "17900", "line_items[0][quantity]": "1",
      "line_items[0][price_data][product_data][name]": "print of photo 1 of 2 from 14.06.26 · medium, 12 × 18 in · oak frame",
      "line_items[0][price_data][product_data][description]": "archival matte paper, made and posted by artelo",
      "line_items[1][price_data][unit_amount]": "5900", "line_items[1][price_data][product_data][name]": "print of photo 2 of 2 from 14.06.26 · small, 8 × 12 in · unframed",
      "line_items[2][price_data][currency]": "aud", "line_items[2][price_data][unit_amount]": "4900", "line_items[2][quantity]": "1",
      "line_items[2][price_data][product_data][name]": "delivery to australia, 2 prints",
    });
    expect(form["line_items[0][price_data][product_data][images][0]"]).toMatch(/^https:\/\/curiousgeorge\.dev\/media\/photos\/previews\/fixture-b-01\/.+\/480\.webp$/);
  });

  test("the quoted address rides on the payment and in the custom text, never in metadata or a url", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems(TWO));
    const form = Object.fromEntries(sessionForm({ orderId: "01k6x00000000000000000000a", lines: basket.lines, payload: payload(), config: testConfig(), viewKey: "KEY", now: NOW }));
    expect(form).toMatchObject({
      "payment_intent_data[shipping][name]": "Ada Lovelace", "payment_intent_data[shipping][phone]": "+61 400 000 000",
      "payment_intent_data[shipping][address][line1]": "12 Example Street", "payment_intent_data[shipping][address][line2]": "Unit 3",
      "payment_intent_data[shipping][address][city]": "Bondi Beach", "payment_intent_data[shipping][address][state]": "NSW",
      "payment_intent_data[shipping][address][postal_code]": "2026", "payment_intent_data[shipping][address][country]": "AU",
      "custom_text[submit][message]": `posting to: Ada Lovelace, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia. to change it, go back and quote again. prints are made and posted by artelo in the us. ${GST}`,
      "payment_intent_data[description]": "print order 01k6x00000000000000000000a · prices include no gst; the seller isn't registered for gst",
      client_reference_id: "01k6x00000000000000000000a", "metadata[order_id]": "01k6x00000000000000000000a", "metadata[country]": "AU",
      "metadata[print_total]": "23800", "metadata[delivery_amount]": "4900", "metadata[delivery_taxed]": "0",
      "metadata[line_1]": "fixture-b-01:medium:oak:1", "metadata[line_2]": "fixture-b-02:small:unframed:1",
      "payment_intent_data[metadata][order_id]": "01k6x00000000000000000000a",
      success_url: "https://curiousgeorge.dev/prints/01k6x00000000000000000000a?key=KEY", cancel_url: `https://curiousgeorge.dev/basket?items=${TWO}`,
    });
    for (const [name, value] of Object.entries(form)) {
      if (name.startsWith("payment_intent_data[shipping]") || name === "custom_text[submit][message]") continue;
      expect(value, name).not.toMatch(/Ada|Example Street|Bondi|400 000/);
    }
    expect(form).not.toHaveProperty(["shipping_address_collection[allowed_countries][0]"]);
    expect(form).not.toHaveProperty(["phone_number_collection[enabled]"]);
  });

  test("destination taxes name the delivery line; a missing unit or state is left out; images only on https", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems("fixture-b-01:medium:oak"));
    const form = Object.fromEntries(sessionForm({ orderId: "o", lines: basket.lines, payload: payload({ items: "fixture-b-01:medium:oak", address: US_ADDRESS, taxes: [{ field: "usSalesTax", label: "us sales tax", cents: 420 }] }), config: testConfig({ siteOrigin: "http://localhost:4337" }), viewKey: "K", now: NOW }));
    expect(form["line_items[1][price_data][product_data][name]"]).toBe("delivery and destination taxes to united states, 1 print");
    expect(form["metadata[delivery_taxed]"]).toBe("1");
    expect(form).not.toHaveProperty(["payment_intent_data[shipping][address][line2]"]);
    expect(form).not.toHaveProperty(["line_items[0][price_data][product_data][images][0]"]);
  });

  test("an address in another script, with markup and punctuation, reaches stripe's page exactly (review focus 1)", () => {
    const address = { ...ADDRESS, name: "Zoë O'Brien & Sons", line1: "東京都渋谷区 1-2-3", line2: "<b>unit</b> 3", city: "Shibuya", state: "Tokyo", postcode: "150-0002", country: "JP" };
    expect(customText(address, GST)).toBe(`posting to: Zoë O'Brien & Sons, 東京都渋谷区 1-2-3, <b>unit</b> 3, Shibuya Tokyo 150-0002, japan. to change it, go back and quote again. prints are made and posted by artelo in the us. ${GST}`);
  });

  test("with gst inclusive, an australian order adds the tax rate to every line; another country's doesn't", async () => {
    const db = await printDb();
    const basket = await resolveBasket(db, parseItems(TWO));
    const config = testConfig({ gst: "inclusive", gstTaxRate: "txr_123" });
    const au = sessionForm({ orderId: "o", lines: basket.lines, payload: payload(), config, viewKey: "K", now: NOW });
    expect(au.getAll("line_items[0][tax_rates][0]").concat(au.getAll("line_items[2][tax_rates][0]"))).toEqual(["txr_123", "txr_123"]);
    expect(au.get("custom_text[submit][message]")).toMatch(/prices include gst for orders posted within australia\.$/);
    const us = sessionForm({ orderId: "o", lines: basket.lines, payload: payload({ address: US_ADDRESS }), config, viewKey: "K", now: NOW });
    expect(us.has("line_items[0][tax_rates][0]")).toBe(false);
  });
});

describe("startCheckout", () => {
  test("the order and its lines exist before stripe hears of it, so no payment can arrive for an unknown order", async () => {
    let seen: unknown = "never asked";
    const { fake, db, deps } = await setup(async (request) => {
      const form = new URLSearchParams(await request.text());
      seen = await db.prepare("SELECT status FROM print_orders WHERE id = ?").bind(form.get("client_reference_id")).first("status");
      return json({ id: "cs_test_seen", url: "https://checkout.stripe.com/c/pay/cs_test_seen" });
    });
    const basket = await resolveBasket(db, parseItems(TWO));
    const outcome = await startCheckout(deps, basket, payload());
    expect(outcome).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_seen" });
    expect(seen).toBe("checkout");
    const id = new URLSearchParams(fake.calls[0].body).get("client_reference_id")!;
    expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    expect(await getOrder(db, id)).toMatchObject({ status: "checkout", country: "AU", print_total: 23800, delivery_amount: 4900, delivery_taxed: 0, livemode: 0, stripe_session_id: "cs_test_seen", created_at: NOW });
    expect((await db.prepare("SELECT line, photo_id, tier, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id = ? ORDER BY line").bind(id).all()).results).toEqual([
      { line: 1, photo_id: "fixture-b-01", tier: "medium", size: "x12x18", frame: "oak", quantity: 1, unit_amount: 17900 },
      { line: 2, photo_id: "fixture-b-02", tier: "small", size: "x8x12", frame: "unframed", quantity: 1, unit_amount: 5900 },
    ]);
    expect(fake.calls[0].headers.get("stripe-version")).toBe("2025-09-30.clover");
    expect(fake.calls[0].headers.get("idempotency-key")).toBe(`checkout-${id}`);
    expect(fake.calls[0].headers.get("authorization")).toBe("Bearer sk_test_fixture");
    expect(new URLSearchParams(fake.calls[0].body).get("success_url")).toBe(`https://curiousgeorge.dev/prints/${id}?key=${await viewKey(VIEW_SECRET, id)}`);
  });

  test("stripe refusing or unreachable expires the order, so the buyer never saw a payment page for it", async () => {
    captureLogs();
    for (const handler of [() => json({ error: { message: "no" } }, 400), () => { throw new TypeError("network"); }, () => json({ id: "cs" })] as Handler[]) {
      const { db, deps } = await setup(handler);
      expect(await startCheckout(deps, await resolveBasket(db, parseItems(TWO)), payload())).toEqual({ failure: "stripe" });
      expect((await db.prepare("SELECT status, stripe_session_id FROM print_orders").all()).results).toEqual([{ status: "expired", stripe_session_id: null }]);
    }
  });

  test("an address too long for stripe's page is refused before anything is created", async () => {
    const { fake, db, deps } = await setup();
    const long = { ...ADDRESS, name: "n".repeat(100), line1: "a".repeat(100), line2: "b".repeat(100), city: "c".repeat(60), state: "s".repeat(60), postcode: "p".repeat(20) };
    expect(customText(long, GST).length).toBeLessThan(1200);
    const huge = { ...long, name: "n".repeat(1200) };
    expect(await startCheckout(deps, await resolveBasket(db, parseItems(TWO)), payload({ address: huge }))).toEqual({ failure: "long" });
    expect(fake.calls).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM print_orders").first("n")).toBe(0);
  });

  test("the address is never stored or logged", async () => {
    const logs = captureLogs();
    const { db, deps } = await setup();
    await startCheckout(deps, await resolveBasket(db, parseItems(TWO)), payload());
    expect(await dumpDb(db)).not.toMatch(/Ada|Lovelace|Example Street|Bondi Beach|400 000/);
    expect(logs()).not.toMatch(/Ada|Lovelace|Example Street|Bondi Beach|400 000/);
  });
});

describe("POST /basket, intent=checkout", () => {
  test("a good quote answers 303 to stripe's page, charging the sealed amounts", async () => {
    const { fake, deps } = await setup();
    const outcome = await basketPost(deps, await pay(await sealQuote(VIEW_SECRET, payload())), url(), {});
    expect(outcome).toEqual({ redirect: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_\d+$/) });
    expect(new URLSearchParams(fake.calls[0].body).get("line_items[2][price_data][unit_amount]")).toBe("4900");
  });

  test("an edited address, an edited basket, a tampered or expired quote: 422, nothing created, nothing charged", async () => {
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    const attempts = [
      basketPost(deps, await pay(token, { ...ADDRESS, line1: "13 Example Street" }), url(), {}),
      basketPost(deps, await pay(token), url("fixture-b-01:medium:oak"), {}),
      basketPost(deps, await pay(`${token.slice(0, -2)}xx`), url(), {}),
      basketPost(deps, await pay(await sealQuote(VIEW_SECRET, payload({ expires: NOW }))), url(), {}),
      basketPost(deps, await pay(await sealQuote("3".repeat(64), payload())), url(), {}),
    ];
    for (const outcome of await Promise.all(attempts)) {
      expect(outcome).toMatchObject({ status: 422 });
      expect("view" in outcome && outcome.view.errors.form).toBe("that quote has changed or run out. quote delivery again.");
      expect("view" in outcome && outcome.view.address.name).toBe("Ada Lovelace");
    }
    expect(fake.calls).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM print_orders").first("n")).toBe(0);
  });

  test("a new buffer after the quote changes nothing; a new price list refuses the quote (review focus 4)", async () => {
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    await writeSetting(db, "delivery_buffer", "0.2", NOW);
    await basketPost(deps, await pay(token), url(), {});
    expect(new URLSearchParams(fake.calls[0].body).get("line_items[2][price_data][unit_amount]")).toBe("4900");
    await db.prepare("UPDATE print_prices SET amount = 18900 WHERE tier = 'medium' AND frame = 'oak'").run();
    expect(await basketPost(deps, await pay(token), url(), {})).toMatchObject({ status: 422 });
    expect(fake.calls).toHaveLength(1);
  });

  test("the pay form sent twice makes two tracked orders, never one charged twice (review focus 3)", async () => {
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    await basketPost(deps, await pay(token), url(), {});
    await basketPost(deps, await pay(token), url(), {});
    const ids = fake.calls.map((call) => new URLSearchParams(call.body).get("client_reference_id"));
    expect(new Set(ids).size).toBe(2);
    expect(new Set(fake.calls.map((call) => call.headers.get("idempotency-key"))).size).toBe(2);
    expect((await db.prepare("SELECT status FROM print_orders").all()).results).toEqual([{ status: "checkout" }, { status: "checkout" }]);
  });

  test("a basket that lost a print since the quote is shown with its line; past the limit is 429; stripe down is 503", async () => {
    captureLogs();
    const { fake, db, deps } = await setup();
    const token = await sealQuote(VIEW_SECRET, payload());
    await db.prepare("UPDATE photos SET published = 0 WHERE id = 'fixture-b-02'").run();
    const lost = await basketPost(deps, await pay(token), url(), {});
    expect(lost).toMatchObject({ status: 422 });
    expect("view" in lost && lost.view.notes).toEqual(["1 print was taken out: that photo isn't available as a print any more."]);
    await db.prepare("UPDATE photos SET published = 1 WHERE id = 'fixture-b-02'").run();
    const refusing = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;
    const limited = await basketPost(deps, await pay(token), url(), { checkout: refusing });
    expect("view" in limited && limited.view.errors.form).toBe("too many tries - wait a minute and try again.");
    expect(fake.calls).toHaveLength(0);
    const down = await setup(() => json({}, 500));
    const outcome = await basketPost(down.deps, await pay(token), url(), {});
    expect(outcome).toMatchObject({ status: 503 });
    expect("view" in outcome && outcome.view.errors.form).toBe("couldn't reach the payment page. nothing was charged - try again in a minute.");
  });

  test("a live key on a test build is never used: prints are closed and the basket says so", async () => {
    const { fake, deps } = await setup(created, { config: testConfig({ missing: ["STRIPE_SECRET_KEY"] }) });
    const outcome = await basketPost(deps, await pay(await sealQuote(VIEW_SECRET, payload())), url(), {});
    expect("view" in outcome && outcome.view.open).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/view-key.test.ts tests/unit/checkout.test.ts`
Expected: FAIL, the modules don't exist.

- [ ] **Step 3: Write the Stripe client and the view key**

Create `src/lib/prints/stripe.ts`:

```ts
import type { PrintDeps } from "./config";

// Stripe's REST API with fetch (spec 17.2): no SDK, form-encoded, the API version pinned on every request. Nothing here
// throws: a result is ok with Stripe's object, or not ok with a status (null for a network error or a timeout).

export const STRIPE_VERSION = "2025-09-30.clover";

export type StripeResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number | null };

export async function stripe(deps: PrintDeps, method: "GET" | "POST", path: string, form?: URLSearchParams, idempotencyKey?: string): Promise<StripeResult> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.config.stripeBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${deps.config.secrets.STRIPE_SECRET_KEY}`,
        "Stripe-Version": STRIPE_VERSION,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form?.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, status: null };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) return { ok: false, status: response.status };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: null };
  return { ok: true, body: body as Record<string, unknown> };
}

/** The slice of a Checkout Session the print code reads */
export interface StripeSession {
  id: string;
  url?: string | null;
  status: "open" | "complete" | "expired" | string;
  payment_status: "paid" | "unpaid" | "no_payment_required" | string;
  client_reference_id: string | null;
  livemode: boolean;
  currency: string | null;
  currency_conversion?: unknown;
  amount_total: number | null;
  payment_intent: string | null;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
}

export const getSession = (deps: PrintDeps, id: string) => stripe(deps, "GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`);
export const expireSession = (deps: PrintDeps, id: string) => stripe(deps, "POST", `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`);
export const getPaymentIntent = (deps: PrintDeps, id: string) => stripe(deps, "GET", `/v1/payment_intents/${encodeURIComponent(id)}`);

/** An order is live or test by the key that made it (spec 17.2 step 3) */
export const livemodeOf = (key: string): 0 | 1 => (key.startsWith("sk_live_") ? 1 : 0);
```

Create `src/lib/prints/view-key.ts`:

```ts
import type { PrintConfig } from "./config";
import { b64url, fromB64url, hmacKey } from "./seal";

// The order page's key (spec 17.2 step 4): derived from PRINT_VIEW_SECRET and the order id whenever it's needed, never
// stored. Rotating the secret invalidates every order link already sent, which is accepted.

const LABEL = "order-view:";
const encoder = new TextEncoder();

export async function viewKey(secret: string, orderId: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(LABEL + orderId))));
}

/** Compared in constant time by Web Crypto's verify */
export async function viewKeyMatches(secret: string, orderId: string, key: string | null): Promise<boolean> {
  if (!secret || !key || key.length !== 43) return false;
  const signature = fromB64url(key);
  if (!signature || signature.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), signature, encoder.encode(LABEL + orderId));
}

export async function orderPageUrl(config: PrintConfig, orderId: string): Promise<string> {
  return `${config.siteOrigin}/prints/${orderId}?key=${await viewKey(config.secrets.PRINT_VIEW_SECRET, orderId)}`;
}
```

- [ ] **Step 4: Write the order rows and checkout**

Append to `src/lib/prints/store.ts`:

```ts
export interface NewOrder {
  id: string;
  country: string;
  printTotal: number;
  deliveryAmount: number;
  deliveryTaxed: 0 | 1;
  livemode: 0 | 1;
  now: number;
}

/** The order and its lines in one batch, before any Checkout Session exists (spec 17.2 step 3). The address is not written */
export async function createOrder(db: D1Database, order: NewOrder, lines: readonly PricedLine[]): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO print_orders (id, country, print_total, delivery_amount, delivery_taxed, status, livemode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'checkout', ?, ?, ?)")
      .bind(order.id, order.country, order.printTotal, order.deliveryAmount, order.deliveryTaxed, order.livemode, order.now, order.now),
    ...lines.map((line) =>
      db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(order.id, line.line, line.photoId, line.tier, line.size.size, line.frame, line.quantity, line.unitAmount),
    ),
  ]);
}

export async function setSession(db: D1Database, id: string, sessionId: string, now: number): Promise<void> {
  await db.prepare("UPDATE print_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?").bind(sessionId, now, id).run();
}

/** checkout becomes expired; any other status is left alone. True when it changed */
export async function markExpired(db: D1Database, id: string, now: number): Promise<boolean> {
  return (await db.prepare("UPDATE print_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'checkout'").bind(now, id).run()).meta.changes > 0;
}
```

Create `src/lib/prints/checkout.ts`:

```ts
import { ulid } from "../admin/ulid";
import { postingTo, type Address } from "./address";
import { itemsQuery } from "./basket";
import { frameLabel, sizeInches } from "./catalogue";
import type { PrintConfig, PrintDeps } from "./config";
import { countryName } from "./countries";
import { gstSentence, plural } from "./money";
import { deliveryLabel, hasTax } from "./quote";
import type { QuotePayload } from "./seal";
import { createOrder, markExpired, setSession, type PricedLine, type ResolvedBasket } from "./store";
import { livemodeOf, stripe } from "./stripe";
import { viewKey } from "./view-key";

// Starting checkout (spec 17): the order first, then Stripe's hosted page. Shipping collection is off, so Checkout asks
// only for the email and card; the quoted address rides on the payment, where the buyer can't change it, and is shown
// read-only in the custom text (17.1).

/** Stripe allows 1,200 characters of custom text; the address form's limits keep it well under */
export const CUSTOM_TEXT_LIMIT = 1200;

export const customText = (address: Address, gst: string) =>
  `posting to: ${postingTo(address)}. to change it, go back and quote again. prints are made and posted by artelo in the us. ${gst}`;

export interface SessionInput {
  orderId: string;
  lines: readonly PricedLine[];
  payload: QuotePayload;
  config: PrintConfig;
  viewKey: string;
  now: number;
}

export function sessionForm({ orderId, lines, payload, config, viewKey: key, now }: SessionInput): URLSearchParams {
  const form = new URLSearchParams();
  const set = (name: string, value: string | number) => form.append(name, String(value));
  const gst = gstSentence(config.gst);
  // GST later (17.3): an inclusive rate on every line of an order posted within Australia; exports carry none
  const taxRate = config.gst === "inclusive" && config.gstTaxRate && payload.address.country === "AU" ? config.gstTaxRate : null;
  set("mode", "payment");
  set("payment_method_types[0]", "card");
  set("submit_type", "pay");
  set("locale", "auto");
  set("expires_at", now + 3600);
  // The buyer always pays the AUD total the site showed
  set("adaptive_pricing[enabled]", "false");
  lines.forEach((line, i) => {
    const item = `line_items[${i}]`;
    set(`${item}[price_data][currency]`, "aud");
    set(`${item}[price_data][unit_amount]`, line.unitAmount);
    set(`${item}[price_data][product_data][name]`, `print of ${line.name} · ${line.tier}, ${sizeInches(line.size)} · ${frameLabel(line.frame)}`);
    set(`${item}[price_data][product_data][description]`, "archival matte paper, made and posted by artelo");
    // Stripe fetches the image itself, so a local http origin sends none
    if (config.siteOrigin.startsWith("https://") && line.image) set(`${item}[price_data][product_data][images][0]`, `${config.siteOrigin}${line.image.url}`);
    set(`${item}[quantity]`, line.quantity);
    if (taxRate) set(`${item}[tax_rates][0]`, taxRate);
  });
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const delivery = `line_items[${lines.length}]`;
  set(`${delivery}[price_data][currency]`, "aud");
  set(`${delivery}[price_data][unit_amount]`, payload.deliveryAmount);
  set(`${delivery}[price_data][product_data][name]`, `${deliveryLabel(payload.taxes)} to ${countryName(payload.address.country)}, ${plural(count, "print", "prints")}`);
  set(`${delivery}[quantity]`, 1);
  if (taxRate) set(`${delivery}[tax_rates][0]`, taxRate);
  const address = payload.address;
  const shipping = "payment_intent_data[shipping]";
  set(`${shipping}[name]`, address.name);
  set(`${shipping}[phone]`, address.phone);
  set(`${shipping}[address][line1]`, address.line1);
  if (address.line2) set(`${shipping}[address][line2]`, address.line2);
  set(`${shipping}[address][city]`, address.city);
  if (address.state) set(`${shipping}[address][state]`, address.state);
  if (address.postcode) set(`${shipping}[address][postal_code]`, address.postcode);
  set(`${shipping}[address][country]`, address.country);
  set("custom_text[submit][message]", customText(address, gst));
  // Stripe's free receipt shows the description, so the gst sentence reaches it (spec 17.1)
  set("payment_intent_data[description]", `print order ${orderId} · ${gst.replace(/\.$/, "")}`);
  set("client_reference_id", orderId);
  set("metadata[order_id]", orderId);
  set("metadata[country]", address.country);
  set("metadata[print_total]", payload.printTotal);
  set("metadata[delivery_amount]", payload.deliveryAmount);
  set("metadata[delivery_taxed]", hasTax(payload.taxes) ? "1" : "0");
  lines.forEach((line, i) => set(`metadata[line_${i + 1}]`, `${line.photoId}:${line.tier}:${line.frame}:${line.quantity}`));
  set("payment_intent_data[metadata][order_id]", orderId);
  set("success_url", `${config.siteOrigin}/prints/${orderId}?key=${key}`);
  // Back to the basket, its address form empty
  set("cancel_url", `${config.siteOrigin}/basket${itemsQuery(payload.items)}`);
  return form;
}

export type CheckoutOutcome = { url: string } | { failure: "stripe" | "long" };

/** The sealed quote's amounts, charged exactly; never a posted number (spec 17.2) */
export async function startCheckout(deps: PrintDeps, basket: ResolvedBasket, payload: QuotePayload): Promise<CheckoutOutcome> {
  const { config, db } = deps;
  if (customText(payload.address, gstSentence(config.gst)).length > CUSTOM_TEXT_LIMIT) return { failure: "long" };
  const now = deps.now();
  const id = ulid(now * 1000);
  // The order first, so a payment can never arrive for an order the site doesn't know (spec 19)
  await createOrder(db, { id, country: payload.address.country, printTotal: payload.printTotal, deliveryAmount: payload.deliveryAmount, deliveryTaxed: hasTax(payload.taxes) ? 1 : 0, livemode: livemodeOf(config.secrets.STRIPE_SECRET_KEY), now }, basket.lines);
  const key = await viewKey(config.secrets.PRINT_VIEW_SECRET, id);
  const result = await stripe(deps, "POST", "/v1/checkout/sessions", sessionForm({ orderId: id, lines: basket.lines, payload, config, viewKey: key, now }), `checkout-${id}`);
  const session = result.ok && typeof result.body.id === "string" && typeof result.body.url === "string" ? { id: result.body.id, url: result.body.url } : null;
  if (!session) {
    console.error("prints: stripe didn't create a checkout for order", id, result.ok ? "an answer without a page" : (result.status ?? "no answer"));
    await markExpired(db, id, deps.now());
    return { failure: "stripe" };
  }
  try {
    await setSession(db, id, session.id, deps.now());
  } catch (error) {
    // The buyer never sees that session's page, so it can't be paid; say nothing was charged rather than a broken basket
    console.error("prints: couldn't record the session of order", id, error instanceof Error ? error.message : String(error));
    await markExpired(db, id, deps.now()).catch(() => false);
    return { failure: "stripe" };
  }
  return { url: session.url };
}
```

- [ ] **Step 5: Handle intent=checkout on the basket**

In `src/lib/prints/basket-page.ts`, add to the imports:

```ts
import { startCheckout } from "./checkout";
import { openQuote, sameQuote } from "./seal";
```

(merge `openQuote` and `sameQuote` into the existing `./seal` import), add after `FORM_UNREADABLE`:

```ts
export const QUOTE_CHANGED = "that quote has changed or run out. quote delivery again.";
```

and in `basketPost`, replace the line `if (intent !== "quote") return render(422, { errors: { form: FORM_UNREADABLE } });` with:

```ts
  if (intent === "checkout") return checkout(deps, request, String(form?.get("quote") ?? ""), basket, settings, address, limits, render);
  if (intent !== "quote") return render(422, { errors: { form: FORM_UNREADABLE } });
```

Then add after `basketPost`:

```ts
type Render = (status: number, over?: Partial<BasketView>) => BasketOutcome;

/** intent=checkout (spec 17.2): the sealed quote, exactly, or nothing is created and nothing is charged */
async function checkout(deps: PrintDeps, request: Request, token: string, basket: ResolvedBasket, settings: PrintSettings, address: Address, limits: PrintLimits, render: Render): Promise<BasketOutcome> {
  if (!(await underLimit(limits.checkout, clientKey(request, deps.config.testClients)))) return render(429, { errors: { form: "too many tries - wait a minute and try again." } });
  if (!printsStatus(deps.config, settings.rate).open || basket.count === 0) return render(200);
  // Every photo still published and every size still offered (15.2); a dropped entry shows its line
  if (basket.unavailable > 0 || basket.overCap > 0) return render(422);
  const payload = await openQuote(deps.config.secrets.PRINT_VIEW_SECRET, token, deps.now());
  // An edited address, an edited basket, a quote past its 30 minutes or a price list changed since: quote again
  if (!payload || !sameQuote(payload, basket.items, address) || payload.printTotal !== basket.printTotal) return render(422, { errors: { form: QUOTE_CHANGED } });
  const outcome = await startCheckout(deps, basket, payload);
  if ("url" in outcome) return { redirect: outcome.url };
  if (outcome.failure === "long") return render(422, { errors: { form: "that address is too long for the payment page. shorten it and quote again." } });
  return render(503, { errors: { form: "couldn't reach the payment page. nothing was charged - try again in a minute." } });
}
```

- [ ] **Step 6: Let the checkout redirect through the CSP**

In `astro.config.mjs`, replace `"form-action 'self'",` with:

```js
        // Chrome applies form-action to the redirect after a form post, and checkout is a post answered with a 303 to
        // Stripe's hosted page (spec 13.3)
        "form-action 'self' https://checkout.stripe.com",
```

- [ ] **Step 7: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/view-key.test.ts tests/unit/checkout.test.ts tests/unit/basket-page.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 8: Teach the stand-in Stripe's three endpoints**

In `tests/fixtures/artelo-site.mjs`, add above the line `// Routes added by later tasks go above this line`:

```js
// Stripe's three endpoints (spec 23.3, "Decisions"): sessions are kept with the form that made them, so the specs can
// read what the site sent. /__stripe/pay completes one as Checkout would and answers its checkout.session.completed
// event, which the spec signs and delivers itself
const stripe = { sessions: new Map(), intents: new Map(), keys: new Map(), count: 0 };
const stripeAuth = (headers) => keyed(headers, FIXTURE_STRIPE_KEY) && headers["stripe-version"] === "2025-09-30.clover";
route("POST", "/stripe/v1/checkout/sessions", ({ body, headers }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const idempotency = headers["idempotency-key"];
  if (idempotency && stripe.keys.has(idempotency)) return [200, stripe.sessions.get(stripe.keys.get(idempotency)).session];
  const form = Object.fromEntries(new URLSearchParams(body));
  const id = `cs_test_standin_${++stripe.count}`;
  let total = 0;
  for (let i = 0; form[`line_items[${i}][quantity]`] !== undefined; i++) total += Number(form[`line_items[${i}][price_data][unit_amount]`]) * Number(form[`line_items[${i}][quantity]`]);
  const metadata = Object.fromEntries(Object.entries(form).flatMap(([name, value]) => (/^metadata\[(.+)\]$/.test(name) ? [[/^metadata\[(.+)\]$/.exec(name)[1], value]] : [])));
  const session = {
    id, object: "checkout.session", url: `${STAND_IN}/stripe/pay/${id}`, status: "open", payment_status: "unpaid", client_reference_id: form.client_reference_id,
    livemode: false, currency: "aud", amount_total: total, payment_intent: null, metadata, customer_details: null,
  };
  stripe.sessions.set(id, { session, form });
  if (idempotency) stripe.keys.set(idempotency, id);
  return [200, session];
});
route("GET", /^\/stripe\/v1\/checkout\/sessions\/([^/]+)$/, ({ headers, match }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const found = stripe.sessions.get(match[1]);
  return found ? [200, found.session] : [404, { error: { message: "no such session" } }];
});
route("POST", /^\/stripe\/v1\/checkout\/sessions\/([^/]+)\/expire$/, ({ headers, match }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const found = stripe.sessions.get(match[1]);
  if (!found || found.session.status !== "open") return [400, { error: { message: "only an open session can be expired" } }];
  found.session.status = "expired";
  return [200, found.session];
});
route("GET", /^\/stripe\/v1\/payment_intents\/([^/]+)$/, ({ headers, match }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const intent = stripe.intents.get(match[1]);
  return intent ? [200, intent] : [404, { error: { message: "no such payment intent" } }];
});
// Completes a session as Checkout would: { session, email?, amount?, conversion? } (amount and conversion make a mismatch)
route("POST", "/__stripe/pay", ({ body }) => {
  const { session: id, email = "buyer@example.com", amount, conversion = false } = JSON.parse(body);
  const found = stripe.sessions.get(id);
  if (!found) return [404, { message: "no such session" }];
  const { session, form } = found;
  const intent = `pi_test_standin_${stripe.count}_${id.split("_").at(-1)}`;
  const field = (name) => form[`payment_intent_data[shipping]${name}`] ?? null;
  stripe.intents.set(intent, {
    id: intent, object: "payment_intent",
    shipping: { name: field("[name]"), phone: field("[phone]"), address: { line1: field("[address][line1]"), line2: field("[address][line2]"), city: field("[address][city]"), state: field("[address][state]"), postal_code: field("[address][postal_code]"), country: field("[address][country]") } },
  });
  Object.assign(session, { status: "complete", payment_status: "paid", payment_intent: intent, customer_details: { email }, ...(amount === undefined ? {} : { amount_total: amount }), ...(conversion ? { currency_conversion: { amount_total: 12345, source_currency: "usd" } } : {}) });
  return [200, { event: { id: `evt_test_standin_${id.split("_").at(-1)}`, object: "event", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session } } }];
});
route("GET", "/__stripe/sessions", () => [200, [...stripe.sessions.values()]]);
```

- [ ] **Step 9: Write the checkout e2e helpers and spec**

Append to `tests/e2e/prints.ts` (and add `PRINTS` to its `./prints-site` import):

```ts
/** The pay form, posted as the browser would but without following the 303: the CSP rightly blocks a redirect to the stand-in */
export async function postPayForm(page: Page, site = PRINTS) {
  const action = (await page.locator("form#pay").getAttribute("action"))!;
  const form = Object.fromEntries(await page.locator("form#pay input[type=hidden]").evaluateAll((inputs) => inputs.map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value])));
  return page.request.post(new URL(action, site).href, { form, headers: { Origin: site }, maxRedirects: 0 });
}

export interface StandInSession {
  session: { id: string; client_reference_id: string; status: string; payment_intent: string | null; amount_total: number };
  form: Record<string, string>;
}

/** The stand-in's Checkout Sessions made for this shipping name */
export async function sessionsFor(name: string): Promise<StandInSession[]> {
  return (await standIn<StandInSession[]>("/__stripe/sessions")).filter((entry) => entry.form["payment_intent_data[shipping][name]"] === name);
}
```

Create `tests/e2e/prints-checkout.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { asTestClient, auAddress, postPayForm, printsD1, quoteDelivery, sessionsFor, TWO_PRINTS, unique } from "./prints";
import { PRINTS, STAND_IN } from "./prints-site";

test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("continue to payment writes the order first, then answers 303 to a session holding the quoted address", async ({ page }) => {
  await asTestClient(page);
  const name = `Ada ${unique()}`;
  await page.goto(`/basket?items=${TWO_PRINTS}`);
  await quoteDelivery(page, auAddress(name));
  const response = await postPayForm(page);
  expect(response.status()).toBe(303);
  const location = response.headers()["location"];
  expect(location).toMatch(new RegExp(`^${STAND_IN}/stripe/pay/cs_test_standin_\\d+$`));
  const [{ session, form }] = await sessionsFor(name);
  expect(location.endsWith(session.id)).toBe(true);
  expect(form).toMatchObject({
    "adaptive_pricing[enabled]": "false", "payment_method_types[0]": "card", "line_items[0][price_data][currency]": "aud",
    "line_items[0][price_data][unit_amount]": "17900", "line_items[1][price_data][unit_amount]": "5900", "line_items[2][price_data][unit_amount]": "4900",
    "line_items[2][price_data][product_data][name]": "delivery to australia, 2 prints",
    "payment_intent_data[shipping][address][line1]": "12 Example Street", "payment_intent_data[shipping][address][country]": "AU",
  });
  expect(form["custom_text[submit][message]"]).toBe(`posting to: ${name}, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia. to change it, go back and quote again. prints are made and posted by artelo in the us. prices include no gst; the seller isn't registered for gst.`);
  expect(form).not.toHaveProperty(["line_items[0][price_data][product_data][images][0]"]);
  for (const [field, value] of Object.entries(form)) {
    if (field.startsWith("payment_intent_data[shipping]") || field === "custom_text[submit][message]") continue;
    expect(value, field).not.toContain("Example Street");
    expect(value, field).not.toContain(name);
  }
  const [order] = printsD1<Record<string, unknown>>(`SELECT * FROM print_orders WHERE id = '${session.client_reference_id}'`);
  expect(order).toMatchObject({ status: "checkout", country: "AU", print_total: 23800, delivery_amount: 4900, stripe_session_id: session.id, livemode: 0 });
  expect(JSON.stringify(order)).not.toMatch(/Example Street|Bondi|Ada/);
  expect(printsD1(`SELECT line, photo_id, size FROM print_order_items WHERE order_id = '${session.client_reference_id}' ORDER BY line`)).toEqual([
    { line: 1, photo_id: "fixture-b-01", size: "x12x18" }, { line: 2, photo_id: "fixture-b-02", size: "x8x12" },
  ]);
});

test("the page's policy lets a form's redirect reach stripe's checkout and nowhere else", async ({ page }) => {
  const response = await page.goto(`/basket?items=${TWO_PRINTS}`);
  expect(response?.headers()["content-security-policy"]).toContain("form-action 'self' https://checkout.stripe.com");
});

test.describe("without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("an address edited after the quote is refused at checkout, and nothing reaches stripe", async ({ page }) => {
    await asTestClient(page);
    const name = `Ada ${unique()}`;
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, auAddress(name));
    // The pay form repeats the quoted address; send it with a changed street, as an edit-and-pay would
    await page.locator('form#pay input[name="line1"]').evaluate((input) => ((input as HTMLInputElement).value = "13 Example Street"));
    const response = await postPayForm(page);
    expect(response.status()).toBe(422);
    expect(await response.text()).toContain("that quote has changed or run out. quote delivery again.");
    expect(await sessionsFor(name)).toEqual([]);
    // Back on the page, quoting the edited address again gives a fresh quote
    await quoteDelivery(page, { ...auAddress(name), line1: "13 Example Street" });
    await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery $49 = $287");
  });
});
```

- [ ] **Step 10: Build and run the e2e specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-checkout.spec.ts tests/e2e/prints-basket.spec.ts tests/e2e/head.spec.ts tests/e2e/smoke.spec.ts`
Expected: every test passing.

- [ ] **Step 11: Commit**

```bash
git add src/lib/prints/stripe.ts src/lib/prints/view-key.ts src/lib/prints/checkout.ts src/lib/prints/store.ts src/lib/prints/basket-page.ts astro.config.mjs tests/fixtures/artelo-site.mjs tests/e2e/prints.ts tests/e2e/prints-checkout.spec.ts tests/unit/checkout.test.ts tests/unit/view-key.test.ts
git commit -m "feat: checkout writes the order first and fixes the quoted address on stripe's payment"
```

---

### Task 8: emails and the mail sink

Spec 18.4: Cloudflare Email Service through the `EMAIL` binding (test builds post to `EMAIL_SINK` instead), from `prints@curiousgeorge.dev` as `george vlachos`, replying to `hello@curiousgeorge.dev`, always text and plain HTML. Emails are driven by state (see "Decisions"): `sendDueMail` sends every due `needs attention` email to George and every due `shipped` email to the buyer, each claimed through its guard column so it goes once and is released for the next cron run if the send fails. The buyer's email is read from the Stripe session at send time and never stored. The cron's third step retries what is due.

**Files:**
- Create: `src/lib/prints/mail.ts`, `tests/unit/mail.test.ts`
- Modify: `src/lib/prints/store.ts`, `src/lib/prints/cron.ts`, `tests/fixtures/artelo-site.mjs`
- Test: `tests/unit/mail.test.ts`

**Interfaces:**
- Consumes: `PrintDeps` (Task 1); `printLine`-style labels: `frameLabel` (Task 2); `getOrder`, `shipmentsOf`, `Shipment`, `OrderRow` (Task 3); `PHOTO_FACTS`, `FactRow`, `toBasketPhoto`, `photoNameOf` (Task 5); `getSession` (Task 7); `orderPageUrl` (Task 7); `previewOf` (plan 6).
- Produces (`src/lib/prints/store.ts`): `interface OrderLine { line: number; photoId: string; tier: Tier; size: string; frame: Frame; quantity: number; unitAmount: number; name: string; thumb: PublicPreview | null }`; `orderLines(db, orderIds: string[]): Promise<Map<string, OrderLine[]>>`
- Produces (`src/lib/prints/mail.ts`): `sendAdminNote(deps, orderId): Promise<void>`; `REPLY_TO = "hello@curiousgeorge.dev"`; `interface Mail { to: string; subject: string; text: string }`; `mailHtml(text: string): string`; `sendMail(deps, mail, about: string): Promise<boolean>`; `mailAdmin(deps, subject, text, about): Promise<boolean>`; `shippedText(lines, shipments, pageUrl): string`; `sendAttention(deps, orderId): Promise<void>`; `sendShipped(deps, orderId): Promise<void>`; `sendDueMail(deps): Promise<void>`
- Produces (e2e): the stand-in's `POST /__mail` and `GET /__mail`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/mail.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { mailHtml, sendDueMail, sendMail, shippedText } from "../../src/lib/prints/mail";
import { orderLines } from "../../src/lib/prints/store";
import { viewKey } from "../../src/lib/prints/view-key";
import { captureLogs, dumpDb, fakeFetch, insertOrder, json, NOW, printDb, testConfig, testDeps, VIEW_SECRET, type Handler } from "./prints-fakes";

const SHIPMENTS = JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]);
const binding = () => ({ send: vi.fn(async () => ({ messageId: "m" })) });
const stripeSession = (email: string | null): Handler => () => json({ id: "cs", customer_details: { email } });
const mailDeps = async (handlers: Record<string, Handler> = {}, over = {}) => {
  const db = await printDb();
  const email = binding();
  const fake = fakeFetch(handlers);
  return { db, email, fake, deps: testDeps(db, { email: email as unknown as SendEmail, fetch: fake.fetch, ...over }) };
};

afterEach(() => vi.restoreAllMocks());

describe("sending", () => {
  test("through the binding, from george vlachos at prints@, replying to hello@, with text and plain html", async () => {
    const { email, deps } = await mailDeps();
    expect(await sendMail(deps, { to: "buyer@example.com", subject: "hi", text: "one <two>\n\nthree" }, "a test email")).toBe(true);
    expect(email.send).toHaveBeenCalledWith({
      from: { email: "prints@curiousgeorge.dev", name: "george vlachos" }, to: "buyer@example.com", replyTo: "hello@curiousgeorge.dev",
      subject: "hi", text: "one <two>\n\nthree", html: "<p>one &lt;two&gt;</p>\n<p>three</p>",
    });
    expect(mailHtml("a\nb")).toBe("<p>a<br>b</p>");
  });

  test("a test build posts to the sink instead; a failure is logged with what it was about and nothing else", async () => {
    const logs = captureLogs();
    const sink = vi.fn(async (request: Request) => {
      await request.json();
      return new Response(null, { status: 204 });
    });
    const { email, deps } = await mailDeps({ "POST http://127.0.0.1:4401/__mail": sink }, { config: testConfig({ emailSink: "http://127.0.0.1:4401/__mail" }) });
    expect(await sendMail(deps, { to: "buyer@example.com", subject: "s", text: "t" }, "a test email")).toBe(true);
    expect(email.send).not.toHaveBeenCalled();
    expect(sink).toHaveBeenCalledTimes(1);
    const broken = testDeps(deps.db, { email: { send: vi.fn(async () => { throw new Error("rejected"); }) } as unknown as SendEmail });
    expect(await sendMail(broken, { to: "buyer@example.com", subject: "s", text: "t" }, "shipped email for order x")).toBe(false);
    expect(logs()).toContain("prints: couldn't send the shipped email for order x");
    expect(logs()).not.toContain("buyer@example.com");
  });
});

describe("due mail", () => {
  test("an order needing attention emails george once, with its reason and the admin's link", async () => {
    const { db, email, deps } = await mailDeps();
    const id = await insertOrder(db, { status: "needs_attention", attention_reason: "artelo refused the order: unknown size" });
    await sendDueMail(deps);
    await sendDueMail(deps);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${id} needs attention`, text: "artelo refused the order: unknown size\n\nhttps://curiousgeorge.dev/admin/#orders" }));
    expect(await db.prepare("SELECT attention_notified_at FROM print_orders").first("attention_notified_at")).toBe(NOW);
  });

  test("a shipped order emails the buyer once, from the session's email, with every print, its tracking and its page", async () => {
    const { db, email, deps } = await mailDeps({ "GET https://stripe.test/v1/checkout/sessions/cs_test_ship": stripeSession("buyer@example.com") });
    const id = await insertOrder(db, { status: "shipped", stripe_session_id: "cs_test_ship", shipments: SHIPMENTS });
    await sendDueMail(deps);
    await sendDueMail(deps);
    expect(email.send).toHaveBeenCalledTimes(1);
    const page = `https://curiousgeorge.dev/prints/${id}?key=${await viewKey(VIEW_SECRET, id)}`;
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "buyer@example.com", subject: "your prints are on their way",
      text: `hi, your prints have left the printer:\n\nphoto 1 of 2 from 14.06.26 · medium · oak frame\nphoto 2 of 2 from 14.06.26 · small · unframed\n\ntracking: ups 1Z999AA10123456784 https://www.ups.com/track?tracknum=1Z999AA10123456784\n\nyou can check on them here: ${page}. thanks for buying them. - george`,
    }));
    expect(await dumpDb(db)).not.toContain("buyer@example.com");
  });

  test("one print reads in the singular", async () => {
    const { db } = await mailDeps();
    const id = await insertOrder(db, { status: "shipped" }, [["fixture-01", "small", "oak", 1]]);
    const lines = (await orderLines(db, [id])).get(id)!;
    expect(shippedText(lines, [], "https://x/page")).toBe('hi, your print has left the printer:\n\n"a test photograph" · small · oak frame\n\nyou can check on it here: https://x/page. thanks for buying it. - george');
  });

  test("a failed send releases the claim, so the next cron run tries again until it goes", async () => {
    captureLogs();
    const { db, deps } = await mailDeps({ "GET https://stripe.test/v1/checkout/sessions/cs_test_retry": stripeSession("buyer@example.com") });
    await insertOrder(db, { status: "shipped", stripe_session_id: "cs_test_retry", shipments: SHIPMENTS });
    const failing = { send: vi.fn(async () => { throw new Error("down"); }) };
    await sendDueMail(testDeps(db, { email: failing as unknown as SendEmail, fetch: deps.fetch }));
    expect(await db.prepare("SELECT shipped_email_at FROM print_orders").first("shipped_email_at")).toBeNull();
    await sendDueMail(deps);
    expect(await db.prepare("SELECT shipped_email_at FROM print_orders").first("shipped_email_at")).toBe(NOW);
  });

  test("no email from stripe, or stripe unreachable, sends nothing and leaves it due", async () => {
    captureLogs();
    for (const handler of [stripeSession(null), () => json({}, 503)] as Handler[]) {
      const { db, email, deps } = await mailDeps({ "GET https://stripe.test/v1/checkout/sessions/cs_test_none": handler });
      await insertOrder(db, { status: "shipped", stripe_session_id: "cs_test_none" });
      await sendDueMail(deps);
      expect(email.send).not.toHaveBeenCalled();
      expect(await db.prepare("SELECT shipped_email_at FROM print_orders").first("shipped_email_at")).toBeNull();
    }
  });
});

describe("george's notes", () => {
  test("a cancellation or a missed webhook is due until it goes: a failed send is given back and the cron sends it", async () => {
    captureLogs();
    const { db, deps } = await mailDeps();
    const cancelled = await insertOrder(db, { id: "01k6x00000000000000000000a", status: "cancelled", admin_notified_at: 0 });
    const reconciled = await insertOrder(db, { id: "01k6x00000000000000000000b", status: "paid", admin_notified_at: 0 });
    const failing = { send: vi.fn(async () => { throw new Error("down"); }) };
    await sendDueMail(testDeps(db, { email: failing as unknown as SendEmail }));
    expect((await db.prepare("SELECT admin_notified_at FROM print_orders ORDER BY id").all()).results).toEqual([{ admin_notified_at: 0 }, { admin_notified_at: 0 }]);
    await sendDueMail(deps);
    await sendDueMail(deps);
    expect(deps.email!.send).toHaveBeenCalledTimes(2);
    expect(deps.email!.send).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${cancelled} was cancelled by artelo`, text: `artelo cancelled order ${cancelled}. refund it in stripe.` }));
    expect(deps.email!.send).toHaveBeenCalledWith(expect.objectContaining({ subject: `print order ${reconciled}: stripe's webhook never arrived`, text: `print order ${reconciled} was paid but stripe's webhook never arrived. check the webhook in stripe.` }));
    expect((await db.prepare("SELECT admin_notified_at FROM print_orders ORDER BY id").all()).results).toEqual([{ admin_notified_at: NOW }, { admin_notified_at: NOW }]);
  });
});

test("order lines name each photo, keep a hidden photo's name and leave out its thumbnail", async () => {
  const { db } = await mailDeps();
  const id = await insertOrder(db);
  await db.prepare("UPDATE photos SET published = 0 WHERE id = 'fixture-b-02'").run();
  const [first, second] = (await orderLines(db, [id])).get(id)!;
  // The visible photo's name now counts only what is published; the hidden one counts itself ("Decisions")
  expect(first).toMatchObject({ line: 1, photoId: "fixture-b-01", tier: "medium", size: "x12x18", frame: "oak", quantity: 1, unitAmount: 17900, name: "photo 1 of 1 from 14.06.26" });
  expect(first.thumb?.url).toMatch(/240\.webp$/);
  expect(second).toMatchObject({ name: "photo 2 of 2 from 14.06.26", thumb: null });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `mise exec node@24 -- bunx vitest run tests/unit/mail.test.ts`
Expected: FAIL, `src/lib/prints/mail.ts` and `orderLines` don't exist.

- [ ] **Step 3: Write the order lines**

Append to `src/lib/prints/store.ts`:

```ts
/** One line of a placed order, named for its page and emails */
export interface OrderLine {
  line: number;
  photoId: string;
  tier: Tier;
  /** Artelo's size name, e.g. x12x18 */
  size: string;
  frame: Frame;
  quantity: number;
  /** AUD cents */
  unitAmount: number;
  name: string;
  /** The 240 WebP while the photo is published; a hidden photo's previews aren't served (plan 6) */
  thumb: PublicPreview | null;
}

interface ItemRow {
  order_id: string;
  line: number;
  photo_id: string;
  tier: Tier;
  size: string;
  frame: Frame;
  quantity: number;
  unit_amount: number;
}

/** Each order's lines, in one batch: the items, then their photographs whether or not they are still published */
export async function orderLines(db: D1Database, orderIds: readonly string[]): Promise<Map<string, OrderLine[]>> {
  const ids = JSON.stringify(orderIds);
  const [items, facts] = await db.batch([
    db.prepare("SELECT order_id, line, photo_id, tier, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY order_id, line").bind(ids),
    db.prepare(`${PHOTO_FACTS} WHERE photos.id IN (SELECT photo_id FROM print_order_items WHERE order_id IN (SELECT value FROM json_each(?)))`).bind(ids),
  ]);
  const photos = new Map((facts.results as unknown as FactRow[]).map((row) => [row.id, toBasketPhoto(row)]));
  const lines = new Map<string, OrderLine[]>(orderIds.map((id) => [id, []]));
  for (const row of items.results as unknown as ItemRow[]) {
    const photo = photos.get(row.photo_id);
    lines.get(row.order_id)?.push({
      line: row.line, photoId: row.photo_id, tier: row.tier, size: row.size, frame: row.frame, quantity: row.quantity, unitAmount: row.unit_amount,
      name: photo ? photoNameOf(photo) : `photo ${row.photo_id}`,
      thumb: photo?.published ? (previewOf(photo, 240, "webp") ?? null) : null,
    });
  }
  return lines;
}
```

- [ ] **Step 4: Write mail**

Create `src/lib/prints/mail.ts`:

```ts
import { frameLabel } from "./catalogue";
import type { PrintDeps } from "./config";
import { getOrder, orderLines, shipmentsOf, type OrderLine, type Shipment } from "./store";
import { getSession } from "./stripe";
import { orderPageUrl } from "./view-key";

// Emails (spec 18.4), driven by the orders' state: whatever is due goes out from the cron and right after a change. The
// buyer's address is read from Stripe at send time and never stored; logs name what an email was about, never who.

export const REPLY_TO = "hello@curiousgeorge.dev";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain html twin of a text email: a paragraph per blank-line block, a line break per line */
export const mailHtml = (text: string) => text.split(/\n{2,}/).map((block) => `<p>${block.split("\n").map(escape).join("<br>")}</p>`).join("\n");

export async function sendMail(deps: PrintDeps, mail: Mail, about: string): Promise<boolean> {
  const message = {
    from: { email: deps.config.fromEmail, name: deps.config.sellerName },
    to: mail.to,
    replyTo: REPLY_TO,
    subject: mail.subject,
    text: mail.text,
    html: mailHtml(mail.text),
  };
  try {
    if (deps.config.emailSink) {
      const response = await deps.fetch(deps.config.emailSink, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) });
      if (!response.ok) throw new Error(`the sink answered ${response.status}`);
      return true;
    }
    if (!deps.email) throw new Error("there is no EMAIL binding");
    await deps.email.send(message);
    return true;
  } catch (error) {
    console.error(`prints: couldn't send the ${about}`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export const mailAdmin = (deps: PrintDeps, subject: string, text: string, about: string) => sendMail(deps, { to: deps.config.adminEmail, subject, text }, about);

/** The shipped email's body (spec 18.4), singular for one print */
export function shippedText(lines: readonly OrderLine[], shipments: readonly Shipment[], pageUrl: string): string {
  const one = lines.reduce((sum, line) => sum + line.quantity, 0) === 1;
  const prints = lines.map((line) => `${line.name} · ${line.tier} · ${frameLabel(line.frame)}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`).join("\n");
  const tracking = shipments.map((shipment) => `tracking: ${[shipment.carrier, shipment.number, shipment.url].filter(Boolean).join(" ")}`).join("\n");
  return [
    one ? "hi, your print has left the printer:" : "hi, your prints have left the printer:",
    prints,
    ...(tracking ? [tracking] : []),
    one ? `you can check on it here: ${pageUrl}. thanks for buying it. - george` : `you can check on them here: ${pageUrl}. thanks for buying them. - george`,
  ].join("\n\n");
}

type Guard = "attention_notified_at" | "shipped_email_at";

/** Claims an email in the statement that marks it sent, so two runs never send it twice */
async function claim(db: D1Database, id: string, column: Guard, status: string, now: number): Promise<boolean> {
  return (await db.prepare(`UPDATE print_orders SET ${column} = ? WHERE id = ? AND status = ? AND ${column} IS NULL`).bind(now, id, status).run()).meta.changes > 0;
}

/** A failed send gives the claim back, so the next cron run tries again */
async function release(db: D1Database, id: string, column: Guard, at: number): Promise<void> {
  await db.prepare(`UPDATE print_orders SET ${column} = NULL WHERE id = ? AND ${column} = ?`).bind(id, at).run();
}

/** George's email, once each time an order enters needs_attention (spec 18.4) */
export async function sendAttention(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if (!(await claim(deps.db, id, "attention_notified_at", "needs_attention", now))) return;
  const order = await getOrder(deps.db, id);
  const sent = await mailAdmin(deps, `print order ${id} needs attention`, `${order?.attention_reason ?? "no reason was recorded."}\n\n${deps.config.siteOrigin}/admin/#orders`, `attention email for order ${id}`);
  if (!sent) await release(deps.db, id, "attention_notified_at", now);
}

/** The buyer's email, once, when their order ships (spec 18.4) */
export async function sendShipped(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if (!(await claim(deps.db, id, "shipped_email_at", "shipped", now))) return;
  let sent = false;
  const order = await getOrder(deps.db, id);
  const session = order?.stripe_session_id ? await getSession(deps, order.stripe_session_id) : null;
  const email = session?.ok ? (session.body.customer_details as { email?: unknown } | null | undefined)?.email : null;
  if (order && typeof email === "string" && email) {
    const lines = (await orderLines(deps.db, [id])).get(id) ?? [];
    const one = lines.reduce((sum, line) => sum + line.quantity, 0) === 1;
    sent = await sendMail(deps, { to: email, subject: one ? "your print is on its way" : "your prints are on their way", text: shippedText(lines, shipmentsOf(order), await orderPageUrl(deps.config, id)) }, `shipped email for order ${id}`);
  } else {
    console.error("prints: no buyer email from stripe for order", id, session && !session.ok ? (session.status ?? "no answer") : "none in the session");
  }
  if (!sent) await release(deps.db, id, "shipped_email_at", now);
}

/**
 * George's email about an Artelo cancellation (refund the buyer) or a paid order Stripe's webhook missed: due while
 * admin_notified_at is 0, claimed by setting the time and given back on failure so the cron tries again (spec 18.4)
 */
export async function sendAdminNote(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if ((await deps.db.prepare("UPDATE print_orders SET admin_notified_at = ? WHERE id = ? AND admin_notified_at = 0").bind(now, id).run()).meta.changes === 0) return;
  const order = await getOrder(deps.db, id);
  const sent = order?.status === "cancelled"
    ? await mailAdmin(deps, `print order ${id} was cancelled by artelo`, `artelo cancelled order ${id}. refund it in stripe.`, `cancellation email for order ${id}`)
    : await mailAdmin(deps, `print order ${id}: stripe's webhook never arrived`, `print order ${id} was paid but stripe's webhook never arrived. check the webhook in stripe.`, `missed-webhook email for order ${id}`);
  if (!sent) await deps.db.prepare("UPDATE print_orders SET admin_notified_at = 0 WHERE id = ? AND admin_notified_at = ?").bind(id, now).run();
}

/** Every email that is due: from the cron's third step and right after any change that makes one due */
export async function sendDueMail(deps: PrintDeps): Promise<void> {
  const { results } = await deps.db
    .prepare("SELECT id, status, attention_notified_at, shipped_email_at, admin_notified_at FROM print_orders WHERE (status = 'needs_attention' AND attention_notified_at IS NULL) OR (status = 'shipped' AND shipped_email_at IS NULL) OR admin_notified_at = 0 ORDER BY updated_at LIMIT 20")
    .all();
  for (const row of results as unknown as { id: string; status: string; attention_notified_at: number | null; shipped_email_at: number | null; admin_notified_at: number | null }[]) {
    if (row.status === "shipped" && row.shipped_email_at === null) await sendShipped(deps, row.id);
    if (row.status === "needs_attention" && row.attention_notified_at === null) await sendAttention(deps, row.id);
    if (row.admin_notified_at === 0) await sendAdminNote(deps, row.id);
  }
}
```

- [ ] **Step 5: Retry due mail from the cron, and give the stand-in a sink**

In `src/lib/prints/cron.ts`, add `import { sendDueMail } from "./mail";` and add this step before the exchange rate in `cronSteps`:

```ts
    ["unsent emails", () => sendDueMail(deps)],
```

In `tests/fixtures/artelo-site.mjs`, add above the line `// Routes added by later tasks go above this line`:

```js
// The email sink: test builds post here instead of using the EMAIL binding (spec 23.3)
route("POST", "/__mail", ({ body }) => {
  received.mail.push(JSON.parse(body));
  return [204, ""];
});
route("GET", "/__mail", () => [200, received.mail]);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/mail.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/prints/mail.ts src/lib/prints/store.ts src/lib/prints/cron.ts tests/fixtures/artelo-site.mjs tests/unit/mail.test.ts
git commit -m "feat: print emails, sent once each from the orders' state, with a sink for test builds"
```

---

### Task 9: placing the Artelo order, retries and the cron's placing

Spec 1.2 step 9 (sections 18.2 and 19): `placeOrder` claims a paid order with a lease, looks it up at Artelo before every create, reads the quoted address from the Stripe payment in memory, issues a 72-hour order grant for each print's master and creates one Artelo order with every print. Retryable failures back off (5 minutes × 3ⁿ⁻¹, at most 6 hours) inside a 24-hour window; anything else goes to `needs_attention` at once with a reason that never holds the address. The cron places due orders first.

**Files:**
- Create: `src/lib/prints/place.ts`, `src/lib/prints/artelo-status.ts`, `tests/unit/place.test.ts`
- Modify: `src/lib/prints/artelo.ts`, `src/lib/prints/store.ts`, `src/lib/prints/cron.ts`, `tests/fixtures/artelo-site.mjs`
- Test: `tests/unit/place.test.ts`, `tests/unit/artelo.test.ts` (unchanged, must pass)

**Interfaces:**
- Consumes: `PrintDeps`, `PrintConfig` (Task 1); `parseSize`, `Frame`, `Orientation` (Task 2); `getOrder`, `OrderRow`, `OrderStatus`, `Shipment` (Task 3); `photoMaster`, `issueOrderGrant` (Task 3); `Address` (Task 4); `artelo`, `arteloAddress`, `productInfo`, `ArteloResult`, `readOrderCosts` (Task 4); `getPaymentIntent` (Task 7); `sendDueMail` (Task 8).
- Produces (`src/lib/prints/artelo-status.ts`): `PENDING_REASON`; `REFUND_REASON`; `STATUS_MAP: Record<string, OrderStatus>`; `ARTELO_STATUSES: string[]`; `mapStatus(status: unknown): OrderStatus | null`
- Produces (`src/lib/prints/artelo.ts`): `interface ArteloOrder { id: string; orderId: string | null; status: string | null; costCents: number | null; shipments: Shipment[] | null }`; `unwrap(value: unknown): Record<string, unknown> | null`; `readShipments(value: unknown): Shipment[] | null`; `readArteloOrder(value: unknown): ArteloOrder | null`; `ordersList(value: unknown): unknown[] | null`
- Produces (`src/lib/prints/store.ts`): `toAttention(db, id, reason, now): Promise<void>`
- Produces (`src/lib/prints/place.ts`): `LEASE_SECONDS = 120`; `LINK_SECONDS = 259_200`; `nextDelay(attempt: number): number`; `type PlaceOutcome = "placed" | "adopted" | "not-due" | "retry" | "attention"`; `scrub(message: string, address: Address | null): string`; `placeOrder(deps, orderId): Promise<PlaceOutcome>`; `placeDue(deps): Promise<void>`
- Produces (e2e): the stand-in's `POST /orders/create` (fetches every design and records its SHA-256 and size), `GET /orders/get`, `POST /__mode` (`{ order, mode: "ok" | "down" | { refuse: photoId } }`, per order so parallel specs never share a mode) and `GET /__orders`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/place.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { verifyPhotoToken } from "../../src/lib/photos/tokens";
import { nextDelay, placeDue, placeOrder, scrub } from "../../src/lib/prints/place";
import { getOrder } from "../../src/lib/prints/store";
import { ADDRESS, captureLogs, dumpDb, fakeFetch, insertOrder, json, masters, NOW, PHOTO_KEY, printDb, testConfig, testDeps, type Handler } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";
const LOOKUP = "GET https://artelo.test/orders/get";
const CREATE = "POST https://artelo.test/orders/create";
const INTENT = "GET https://stripe.test/v1/payment_intents/pi_test_place";
const shipping = { name: ADDRESS.name, phone: ADDRESS.phone, address: { line1: ADDRESS.line1, line2: ADDRESS.line2, city: ADDRESS.city, state: ADDRESS.state, postal_code: ADDRESS.postcode, country: ADDRESS.country } };
const accepted: Handler = async (request) => {
  const body = (await request.json()) as { orderId: string };
  return json({ id: "artelo-1", orderId: body.orderId, status: "Received", details: { productionCost: 80, arteloShipping: 30, usSalesTax: 0 } });
};
const world = (over: Record<string, Handler> = {}) => fakeFetch({ [LOOKUP]: () => json([]), [CREATE]: accepted, [INTENT]: () => json({ id: "pi_test_place", shipping }), ...over });
const setup = async (handlers: Record<string, Handler> = {}, columns: Record<string, string | number | null> = {}, over = {}) => {
  const db = await printDb();
  const fake = world(handlers);
  await insertOrder(db, { id: ORDER, stripe_payment_intent: "pi_test_place", ...columns });
  return { db, fake, deps: testDeps(db, { fetch: fake.fetch, ...over }) };
};
const creates = (fake: ReturnType<typeof world>) => fake.calls.filter((call) => call.method === "POST" && call.url.endsWith("/orders/create"));

afterEach(() => vi.restoreAllMocks());

describe("placeOrder", () => {
  test("places the whole order once, to the quoted address, each print made from its own master", async () => {
    captureLogs();
    const { db, fake, deps } = await setup();
    expect(await placeOrder(deps, ORDER)).toBe("placed");
    const [create] = creates(fake);
    const body = JSON.parse(create.body);
    expect(body).toMatchObject({
      orderId: ORDER, createdAt: new Date((NOW - 60) * 1000).toISOString(), currency: "AUD", total: 287, shippingCost: 49, channelName: "curiousgeorge.dev",
      companyName: "george vlachos", isTestOrder: true,
      customerAddress: { name: "Ada Lovelace", street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" },
    });
    expect(body.items.map((item: { orderItemId: string; quantity: number; unitPrice: number; productInfo: Record<string, unknown> }) => [item.orderItemId, item.quantity, item.unitPrice, item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation, item.productInfo.paperType])).toEqual([
      [`${ORDER}-1`, 1, 179, "x12x18", "NaturalOak", "Vertical", "ArchivalMatteFineArt"],
      [`${ORDER}-2`, 1, 59, "x8x12", null, "Horizontal", "ArchivalMatteFineArt"],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/email|dangerouslySkipDPICheck/);
    for (const [index, photoId] of ["fixture-b-01", "fixture-b-02"].entries()) {
      const design = body.items[index].productInfo.designs[0];
      expect(design.fitOptions).toEqual({ canvas: "Paper", style: "Outside" });
      const link = new URL(design.sourceImage.url);
      expect(`${link.origin}${link.pathname}`).toBe(`https://curiousgeorge.dev/photos/downloads/${photoId}`);
      const token = await verifyPhotoToken(PHOTO_KEY, link.searchParams.get("token")!, NOW);
      expect(token).toMatchObject({ photoId, expiresAt: NOW + 72 * 3600 });
      expect(await db.prepare("SELECT order_id FROM photo_download_grants WHERE id = ?").bind(token!.grantId).first("order_id")).toBe(ORDER);
    }
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-1", artelo_status: "Received", artelo_cost: 11000, placed_at: NOW, lease_until: null, attempts: 1 });
  });

  test("every attempt looks the order up first, and adopts one artelo already has instead of creating it again", async () => {
    captureLogs();
    const { db, fake, deps } = await setup({ [LOOKUP]: () => json({ orders: [{ id: "artelo-old", orderId: "someone-else", status: "Received" }, { id: "artelo-7", orderId: ORDER, status: "Received", details: { productionCost: 80, arteloShipping: 30 } }] }) });
    expect(await placeOrder(deps, ORDER)).toBe("adopted");
    expect(fake.calls[0].url).toBe(`https://artelo.test/orders/get?limit=5&name=${ORDER}`);
    expect(creates(fake)).toHaveLength(0);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_order_id: "artelo-7", artelo_cost: 11000 });
  });

  test("a failed or unreadable lookup never creates: it counts as retryable", async () => {
    captureLogs();
    for (const lookup of [() => json({}, 503), () => json({ found: "maybe" }), () => { throw new TypeError("network"); }] as Handler[]) {
      const { db, fake, deps } = await setup({ [LOOKUP]: lookup });
      expect(await placeOrder(deps, ORDER)).toBe("retry");
      expect(creates(fake)).toHaveLength(0);
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", next_attempt_at: NOW + 300, lease_until: null });
    }
  });

  test("the lease stops two runs placing one order; an expired lease is taken over", async () => {
    captureLogs();
    const { fake, deps } = await setup();
    expect((await Promise.all([placeOrder(deps, ORDER), placeOrder(deps, ORDER)])).sort()).toEqual(["not-due", "placed"]);
    expect(creates(fake)).toHaveLength(1);
    const held = await setup({}, { lease_until: NOW + 60 });
    expect(await placeOrder(held.deps, ORDER)).toBe("not-due");
    const lapsed = await setup({}, { lease_until: NOW - 1 });
    expect(await placeOrder(lapsed.deps, ORDER)).toBe("placed");
  });

  test("an order not yet due, or no longer paid, isn't touched", async () => {
    for (const columns of [{ next_attempt_at: NOW + 1 }, { status: "needs_attention" }, { status: "placed" }, { status: "refunded" }] as Record<string, string | number | null>[]) {
      const { fake, deps } = await setup({}, columns);
      expect(await placeOrder(deps, ORDER)).toBe("not-due");
      expect(fake.calls).toHaveLength(0);
    }
  });

  test("retryable: a network error, a timeout, 408, 429 and any 5xx, including a proxy's html page", async () => {
    captureLogs();
    const answers: Handler[] = [() => { throw new TypeError("network"); }, () => { throw new DOMException("timed out", "TimeoutError"); }, () => json({}, 408), () => json({}, 429), () => json({}, 500), () => new Response("<html>bad gateway</html>", { status: 502 })];
    for (const answer of answers) {
      const { db, deps } = await setup({ [CREATE]: answer });
      expect(await placeOrder(deps, ORDER)).toBe("retry");
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", next_attempt_at: NOW + 300, lease_until: null, attempts: 1 });
    }
  });

  test("any other 4xx is permanent: needs attention at once, with artelo's message", async () => {
    captureLogs();
    for (const status of [400, 401, 403, 404, 422]) {
      const { db, deps } = await setup({ [CREATE]: () => json({ message: "unknown size" }, status) });
      expect(await placeOrder(deps, ORDER)).toBe("attention");
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "artelo refused the order: unknown size", lease_until: null, attention_notified_at: null });
    }
  });

  test("a partial refusal refuses the order: nothing is placed for the other print", async () => {
    captureLogs();
    const { db, fake, deps } = await setup({ [CREATE]: () => json({ message: `item ${ORDER}-2: the design for fixture-b-02 can't be printed` }, 400) });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect(creates(fake)).toHaveLength(1);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_order_id: null, attention_reason: `artelo refused the order: item ${ORDER}-2: the design for fixture-b-02 can't be printed` });
  });

  test("backoff: 5 minutes, then 15, 45, 2 hours 15, then every 6 hours", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(nextDelay)).toEqual([300, 900, 2700, 8100, 21600, 21600, 21600, 21600]);
  });

  test("within 24 hours of payment: the eighth failure is the last, and the order needs attention with the last error", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({}, 503) }, { paid_at: NOW, next_attempt_at: NOW, retry_until: NOW + 86_400 });
    let clock = NOW;
    for (let attempt = 0; attempt < 20; attempt++) {
      await placeOrder({ ...deps, now: () => clock }, ORDER);
      const row = (await getOrder(db, ORDER))!;
      if (row.status !== "paid") break;
      clock = row.next_attempt_at!;
    }
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attempts: 8, attention_reason: "artelo didn't take the order within a day: artelo answered 503" });
  });

  test("a window of nothing (the test build's PRINT_RETRY_WINDOW=0) sends the first failure to needs attention", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({}, 503) }, { retry_until: NOW - 60 });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("artelo didn't take the order within a day: artelo answered 503");
  });

  test("a missing master fails the whole order before anything is created", async () => {
    captureLogs();
    const { db, fake, deps } = await setup({}, {}, { photoPrints: masters(["fixture-b-02"]) });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect(creates(fake)).toHaveLength(0);
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("the print file for fixture-b-02 is missing. import it again, then retry.");
  });

  test("the address comes from the payment: unreadable is permanent, unreachable is retryable, none is permanent", async () => {
    captureLogs();
    let { db, deps } = await setup({ [INTENT]: () => json({ error: {} }, 404) });
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("stripe couldn't give the payment's delivery address (404).");
    ({ db, deps } = await setup({ [INTENT]: () => json({}, 503) }));
    expect(await placeOrder(deps, ORDER)).toBe("retry");
    ({ db, deps } = await setup({ [INTENT]: () => json({ id: "pi_test_place", shipping: null }) }));
    expect(await placeOrder(deps, ORDER)).toBe("attention");
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("the payment has no delivery address.");
  });

  test("no signing key is permanent; a live order is a real one", async () => {
    captureLogs();
    const keyless = await setup({}, {}, { config: testConfig({ secrets: { ...testConfig().secrets, PHOTO_LINK_SECRET: "" } }) });
    expect(await placeOrder(keyless.deps, ORDER)).toBe("attention");
    expect((await getOrder(keyless.db, ORDER))?.attention_reason).toBe("PHOTO_LINK_SECRET isn't set.");
    const live = await setup({}, { livemode: 1 });
    await placeOrder(live.deps, ORDER);
    expect(JSON.parse(creates(live.fake)[0].body).isTestOrder).toBe(false);
  });

  test("artelo holding the order for action at once sends it to needs attention, adopted", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: async (request) => json({ id: "artelo-9", orderId: ((await request.json()) as { orderId: string }).orderId, status: "PendingFulfillmentAction" }) });
    await placeOrder(deps, ORDER);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_order_id: "artelo-9", attention_reason: "artelo needs something before it can print: open the order in artelo." });
  });

  test("a full refund landing while artelo makes the order flags it for cancelling there; it is never lost", async () => {
    captureLogs();
    const holder: { db?: D1Database } = {};
    const { db, deps } = await setup({
      [CREATE]: async (request) => {
        await holder.db!.prepare("UPDATE print_orders SET status = 'refunded', refunded_amount = 28700 WHERE id = ?").bind(ORDER).run();
        return accepted(request);
      },
    });
    holder.db = db;
    await placeOrder(deps, ORDER);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", artelo_order_id: "artelo-1", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", lease_until: null });
  });

  test("each attempt revokes the last attempt's master links, so only one set works", async () => {
    captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({}, 503) });
    await placeOrder(deps, ORDER);
    await placeOrder({ ...deps, now: () => NOW + 300 }, ORDER);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ?").bind(ORDER).first("n")).toBe(4);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(2);
  });

  test("a 2xx without an order id is retried, and the next attempt's lookup adopts what artelo made (review focus 5)", async () => {
    captureLogs();
    let made = false;
    const { db, fake, deps } = await setup({
      [CREATE]: () => { made = true; return new Response("<html>ok</html>", { status: 200 }); },
      [LOOKUP]: () => json(made ? [{ id: "artelo-3", orderId: ORDER, status: "Received" }] : []),
    });
    expect(await placeOrder(deps, ORDER)).toBe("retry");
    expect(await placeOrder({ ...deps, now: () => NOW + 300 }, ORDER)).toBe("adopted");
    expect(creates(fake)).toHaveLength(1);
    expect((await getOrder(db, ORDER))?.artelo_order_id).toBe("artelo-3");
  });

  test("artelo's message never stores or logs the address", async () => {
    const logs = captureLogs();
    const { db, deps } = await setup({ [CREATE]: () => json({ message: "Ada Lovelace at 12 Example Street, Bondi Beach can't be delivered to" }, 422) });
    await placeOrder(deps, ORDER);
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("artelo refused the order: [address] at [address], [address] can't be delivered to");
    expect(await dumpDb(db)).not.toMatch(/Ada|Lovelace|Example Street|Bondi|400 000/);
    expect(logs()).not.toMatch(/Ada|Lovelace|Example Street|Bondi|400 000|delivered/);
  });
});

test("scrub replaces each address field, whatever its case", () => {
  expect(scrub("ADA LOVELACE, unit 3, nsw", ADDRESS)).toBe("[address], [address], [address]");
  expect(scrub("unknown size", null)).toBe("unknown size");
});

test("placeDue places due orders oldest first and at most ten, leaving the rest", async () => {
  captureLogs();
  const db = await printDb();
  const fake = fakeFetch({ [LOOKUP]: () => json([]), [CREATE]: accepted, "GET https://stripe.test/v1/payment_intents/pi_test_a": () => json({ shipping }), "GET https://stripe.test/v1/payment_intents/pi_test_b": () => json({ shipping }) });
  await insertOrder(db, { id: "01k6x00000000000000000000b", stripe_payment_intent: "pi_test_b", paid_at: NOW - 10 });
  await insertOrder(db, { id: "01k6x00000000000000000000a", stripe_payment_intent: "pi_test_a", paid_at: NOW - 20 });
  await insertOrder(db, { id: "01k6x00000000000000000000c", stripe_payment_intent: "pi_test_c", next_attempt_at: NOW + 60 });
  await placeDue(testDeps(db, { fetch: fake.fetch }));
  expect(creates(fake).map((call) => JSON.parse(call.body).orderId)).toEqual(["01k6x00000000000000000000a", "01k6x00000000000000000000b"]);
  expect((await getOrder(db, "01k6x00000000000000000000c"))?.status).toBe("paid");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `mise exec node@24 -- bunx vitest run tests/unit/place.test.ts`
Expected: FAIL, `src/lib/prints/place.ts` doesn't exist.

- [ ] **Step 3: Write Artelo's statuses and order readers**

Create `src/lib/prints/artelo-status.ts`:

```ts
import type { OrderStatus } from "./store";

// Artelo's order statuses and what each means for an order here (spec 18.3)

export const PENDING_REASON = "artelo needs something before it can print: open the order in artelo.";
/** A full refund of an order Artelo has (spec 18.1), or reaches while it is being placed: George cancels it there */
export const REFUND_REASON = "refunded in stripe: cancel it in artelo if it hasn't printed.";

export const STATUS_MAP: Record<string, OrderStatus> = {
  ImagesProcessing: "placed",
  Received: "placed",
  // Test orders (isTestOrder) end here
  Ignored: "placed",
  PendingFulfillmentAction: "needs_attention",
  InProduction: "in_production",
  Shipped: "shipped",
  Delivered: "delivered",
  Canceled: "cancelled",
};

/** Every status the webhook asks to hear about (bun run prints:webhook) */
export const ARTELO_STATUSES = Object.keys(STATUS_MAP);

export const mapStatus = (status: unknown): OrderStatus | null => (typeof status === "string" && Object.hasOwn(STATUS_MAP, status) ? STATUS_MAP[status] : null);
```

Append to `src/lib/prints/artelo.ts`, adding `import type { Shipment } from "./store";` to its imports:

```ts
/** An order as Artelo's Create Order, Get Orders and Get Order by Id answer it */
export interface ArteloOrder {
  /** Artelo's own id */
  id: string;
  /** Ours, the orderId we sent */
  orderId: string | null;
  status: string | null;
  /** US cents: production, freight and any tax, from its details */
  costCents: number | null;
  shipments: Shipment[] | null;
}

/** An object, or the object inside its top-level data, which Artelo's webhook example uses */
export function unwrap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.data && typeof record.data === "object" && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : record;
}

/** A parcel's tracking; a tracking URL counts only as https, because it becomes a link */
export function readShipments(value: unknown): Shipment[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry): Shipment[] => {
    if (!entry || typeof entry !== "object") return [];
    const { carrierCode, trackingNumber, trackingUrl } = entry as Record<string, unknown>;
    const shipment = {
      carrier: typeof carrierCode === "string" ? carrierCode.toLowerCase() : "",
      number: typeof trackingNumber === "string" ? trackingNumber : "",
      url: typeof trackingUrl === "string" && trackingUrl.startsWith("https://") ? trackingUrl : "",
    };
    return shipment.number || shipment.url ? [shipment] : [];
  });
}

export function readArteloOrder(value: unknown): ArteloOrder | null {
  const record = unwrap(value);
  if (!record) return null;
  const id = typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : "";
  if (!id) return null;
  const costs = readOrderCosts(record.details);
  return {
    id,
    orderId: typeof record.orderId === "string" ? record.orderId : null,
    status: typeof record.status === "string" ? record.status : null,
    costCents: costs && costs.productionCents !== null ? costs.productionCents + costs.freightCents + costs.taxes.reduce((sum, tax) => sum + tax.cents, 0) : null,
    shipments: readShipments(record.shipments),
  };
}

/** Get Orders' list: an array, or one under orders, data or items; null for anything else, which is a failed lookup */
export function ordersList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["orders", "data", "items"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return null;
}
```

Append to `src/lib/prints/store.ts`:

```ts
/** Into needs_attention with a plain reason (never an address); its email becomes due, and any lease is let go */
export async function toAttention(db: D1Database, id: string, reason: string, now: number): Promise<void> {
  await db.prepare("UPDATE print_orders SET status = 'needs_attention', attention_reason = ?, attention_notified_at = NULL, lease_until = NULL, updated_at = ? WHERE id = ?").bind(reason, now, id).run();
}
```

- [ ] **Step 4: Write placeOrder**

Create `src/lib/prints/place.ts`:

```ts
import { issueOrderGrant, photoMaster, revokeOrderGrants } from "../photos/store";
import type { Address } from "./address";
import { artelo, arteloAddress, ordersList, productInfo, readArteloOrder, type ArteloOrder, type ArteloResult } from "./artelo";
import { mapStatus, PENDING_REASON, REFUND_REASON } from "./artelo-status";
import { parseSize, type Frame, type Orientation } from "./catalogue";
import type { PrintConfig, PrintDeps } from "./config";
import { sendDueMail } from "./mail";
import { getOrder, toAttention, type OrderRow } from "./store";
import { getPaymentIntent } from "./stripe";

// Placing the Artelo order (spec 18.2, 19): the whole order or none of it, never twice. Called from the Stripe
// webhook's waitUntil, the cron and the admin's retry now.

export const LEASE_SECONDS = 120;
/** The master links' ceiling, for orders stuck while Artelo processes images; they are revoked once in production */
export const LINK_SECONDS = 72 * 3600;

/** After failed attempt n: 5 minutes × 3^(n-1), at most 6 hours */
export const nextDelay = (attempt: number) => Math.min(300 * 3 ** (Math.max(attempt, 1) - 1), 6 * 3600);

export type PlaceOutcome = "placed" | "adopted" | "not-due" | "retry" | "attention";

/** Worth another attempt: its message names a status, never anything personal */
class Retryable extends Error {}
/** Needs George: its message is the order's attention reason */
class Permanent extends Error {}

interface Item {
  line: number;
  photo_id: string;
  size: string;
  frame: Frame;
  quantity: number;
  unit_amount: number;
}

/** Each address field, wherever Artelo's message repeats it, becomes [address]: a reason is stored, and an address never is */
export function scrub(message: string, address: Address | null): string {
  if (!address) return message;
  let clean = message;
  for (const value of Object.values(address)) {
    if (value.length < 3) continue;
    clean = clean.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[address]");
  }
  return clean;
}

async function lookUp(deps: PrintDeps, orderId: string): Promise<ArteloOrder | null> {
  const result = await artelo(deps, "GET", `/orders/get?limit=5&name=${encodeURIComponent(orderId)}`);
  if (!result.ok) throw new Retryable(`the lookup at artelo failed (${result.status ?? "no answer"})`);
  const list = ordersList(result.body);
  if (!list) throw new Retryable("the lookup at artelo answered something unreadable");
  for (const entry of list) {
    const found = readArteloOrder(entry);
    if (found && found.orderId === orderId) return found;
  }
  return null;
}

/** The address the delivery was quoted against, from the payment Stripe holds it on; in memory only (spec 18.2 step 3) */
async function quotedAddress(deps: PrintDeps, order: OrderRow): Promise<Address> {
  if (!order.stripe_payment_intent) throw new Permanent("the order has no stripe payment to read its address from.");
  const result = await getPaymentIntent(deps, order.stripe_payment_intent);
  if (!result.ok) {
    if (result.status === null || result.status === 429 || result.status >= 500) throw new Retryable(`stripe answered ${result.status ?? "nothing"}`);
    throw new Permanent(`stripe couldn't give the payment's delivery address (${result.status}).`);
  }
  const shipping = result.body.shipping as { name?: string | null; phone?: string | null; address?: Record<string, string | null> | null } | null;
  const address = shipping?.address;
  if (!shipping?.name || !address?.line1 || !address.country) throw new Permanent("the payment has no delivery address.");
  return {
    name: shipping.name, line1: address.line1, line2: address.line2 ?? "", city: address.city ?? "", state: address.state ?? "",
    postcode: address.postal_code ?? "", country: address.country, phone: shipping.phone ?? "",
  };
}

/** A 72-hour order grant for each photograph's master, after checking the master is there (spec 18.2 step 4) */
async function masterLinks(deps: PrintDeps, orderId: string, items: readonly Item[]): Promise<Map<string, { url: string; orientation: Orientation }>> {
  const secret = deps.config.secrets.PHOTO_LINK_SECRET;
  if (!secret) throw new Permanent("PHOTO_LINK_SECRET isn't set.");
  // The last attempt's links go first: this runs only after the lookup found nothing at Artelo, so nothing needs them
  await revokeOrderGrants(deps.db, orderId, deps.now());
  const links = new Map<string, { url: string; orientation: Orientation }>();
  for (const photoId of new Set(items.map((item) => item.photo_id))) {
    const photo = await photoMaster(deps.db, photoId);
    const object = photo ? await deps.photoPrints.head(photo.print_key) : null;
    if (!photo || !object) throw new Permanent(`the print file for ${photoId} is missing. import it again, then retry.`);
    const url = await issueOrderGrant(deps.db, secret, orderId, photoId, LINK_SECONDS, deps.config.siteOrigin, deps.now());
    links.set(photoId, { url, orientation: photo.print_width > photo.print_height ? "Horizontal" : "Vertical" });
  }
  return links;
}

function createBody(order: OrderRow, items: readonly Item[], links: Map<string, { url: string; orientation: Orientation }>, address: Address, config: PrintConfig) {
  return {
    orderId: order.id,
    createdAt: new Date((order.paid_at ?? order.created_at) * 1000).toISOString(),
    // Amounts in AUD, for the packing slip and the customs declaration only
    currency: "AUD",
    total: (order.print_total + order.delivery_amount) / 100,
    shippingCost: order.delivery_amount / 100,
    channelName: "curiousgeorge.dev",
    companyName: config.sellerName,
    // A Stripe test payment never produces a real print
    isTestOrder: order.livemode === 0,
    customerAddress: arteloAddress(address),
    items: items.map((item) => {
      const link = links.get(item.photo_id)!;
      return { orderItemId: `${order.id}-${item.line}`, quantity: item.quantity, unitPrice: item.unit_amount / 100, productInfo: productInfo({ size: parseSize(item.size), frame: item.frame, orientation: link.orientation }, link.url) };
    }),
  };
}

/** A network error, a timeout, 408, 429 and 5xx are worth retrying; any other 4xx is Artelo refusing (spec 19) */
function refusal(result: Extract<ArteloResult, { ok: false }>, address: Address): Error {
  const { status, message } = result;
  if (status === null || status === 408 || status === 429 || status >= 500) return new Retryable(status === null ? "couldn't reach artelo" : `artelo answered ${status}`);
  return new Permanent(message ? `artelo refused the order: ${scrub(message, address)}` : `artelo refused the order (${status}).`);
}

/** The order is Artelo's now: its id, status, cost and the time, the lease let go (spec 18.2 step 6) */
async function succeed(deps: PrintDeps, order: OrderRow, found: ArteloOrder): Promise<void> {
  const now = deps.now();
  const status = mapStatus(found.status) ?? "placed";
  const result = await deps.db
    .prepare("UPDATE print_orders SET status = ?, attention_reason = ?, attention_notified_at = NULL, artelo_order_id = ?, artelo_status = ?, artelo_cost = ?, shipments = COALESCE(?, shipments), placed_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'paid'")
    .bind(status, status === "needs_attention" ? PENDING_REASON : null, found.id, found.status, found.costCents, found.shipments ? JSON.stringify(found.shipments) : null, now, now, order.id)
    .run();
  if (result.meta.changes === 0) {
    // The order left paid while this attempt held the lease: a full refund landed. Artelo has it all the same, so it
    // keeps Artelo's id and needs George to cancel it there, never silently printed for a refunded buyer
    await deps.db
      .prepare("UPDATE print_orders SET artelo_order_id = ?, artelo_status = ?, artelo_cost = ?, status = CASE WHEN status = 'refunded' THEN 'needs_attention' ELSE status END, attention_reason = CASE WHEN status = 'refunded' THEN ? ELSE attention_reason END, attention_notified_at = CASE WHEN status = 'refunded' THEN NULL ELSE attention_notified_at END, lease_until = NULL, updated_at = ? WHERE id = ?")
      .bind(found.id, found.status, found.costCents, REFUND_REASON, now, order.id)
      .run();
    console.error("prints: order", order.id, "reached artelo after it left paid, so it was flagged for george");
    await sendDueMail(deps);
    return;
  }
  if (status === "needs_attention") await sendDueMail(deps);
}

async function failed(deps: PrintDeps, order: OrderRow, error: unknown): Promise<PlaceOutcome> {
  const now = deps.now();
  if (error instanceof Permanent) {
    await toAttention(deps.db, order.id, error.message, now);
    console.error("prints: order", order.id, "needs attention after a permanent failure");
    await sendDueMail(deps);
    return "attention";
  }
  if (!(error instanceof Retryable)) console.error("prints: placing order", order.id, "threw", error instanceof Error ? error.name : typeof error);
  const reason = error instanceof Retryable ? error.message : "something went wrong placing it";
  const next = now + nextDelay(order.attempts);
  if (next > (order.retry_until ?? now)) {
    await toAttention(deps.db, order.id, `artelo didn't take the order within a day: ${reason}`, now);
    console.error("prints: order", order.id, "needs attention: artelo didn't take it in time");
    await sendDueMail(deps);
    return "attention";
  }
  await deps.db.prepare("UPDATE print_orders SET next_attempt_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'paid'").bind(next, now, order.id).run();
  console.error("prints: order", order.id, "will be retried:", reason);
  return "retry";
}

export async function placeOrder(deps: PrintDeps, orderId: string): Promise<PlaceOutcome> {
  const now = deps.now();
  // The claim: a lease and the attempt count in one statement, so two runs never place one order (step 1)
  const claimed = await deps.db
    .prepare("UPDATE print_orders SET lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'paid' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?)")
    .bind(now + LEASE_SECONDS, now, orderId, now, now)
    .run();
  if (claimed.meta.changes === 0) return "not-due";
  const order = (await getOrder(deps.db, orderId))!;
  let address: Address | null = null;
  try {
    // Look before creating, every attempt: an earlier answer may have been lost after Artelo made the order (step 2)
    const existing = await lookUp(deps, orderId);
    if (existing) {
      await succeed(deps, order, existing);
      console.log("prints: order", orderId, "was already at artelo, so it was adopted");
      return "adopted";
    }
    address = await quotedAddress(deps, order);
    const items = (await deps.db.prepare("SELECT line, photo_id, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id = ? ORDER BY line").bind(orderId).all()).results as unknown as Item[];
    const links = await masterLinks(deps, orderId, items);
    const result = await artelo(deps, "POST", "/orders/create", createBody(order, items, links, address, deps.config));
    if (!result.ok) throw refusal(result, address);
    const created = readArteloOrder(result.body);
    if (!created) throw new Retryable("artelo's answer had no order id");
    await succeed(deps, order, created);
    console.log("prints: order", orderId, "placed with artelo");
    return "placed";
  } catch (error) {
    return failed(deps, order, error);
  }
}

/** The cron's first step: due paid orders, oldest first, at most ten, one at a time (spec 18.6) */
export async function placeDue(deps: PrintDeps): Promise<void> {
  const { results } = await deps.db.prepare("SELECT id FROM print_orders WHERE status = 'paid' AND next_attempt_at <= ? ORDER BY paid_at, id LIMIT 10").bind(deps.now()).all();
  for (const { id } of results as unknown as { id: string }[]) await placeOrder(deps, id);
}
```

- [ ] **Step 5: Place due orders first in the cron**

In `src/lib/prints/cron.ts`, add `import { placeDue } from "./place";` and add this step first in `cronSteps`:

```ts
    ["placing due orders", () => placeDue(deps)],
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/place.test.ts tests/unit/artelo.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 7: Teach the stand-in to take orders**

In `tests/fixtures/artelo-site.mjs`, add `import sharp from "sharp";` to the imports, and add above the line `// Routes added by later tasks go above this line`:

```js
// Orders (spec 23.3). Creation fetches every design URL and records each file's status, type, SHA-256 and size, as
// Artelo would fetch the masters. Its mode is set per order, so parallel specs never share one: "ok", "down" (a 503
// html page) or { refuse: photoId } (a 400 naming that photo's item). Lookups find orders by our orderId
const artelo = { orders: [], modes: new Map(), count: 0 };
async function fetchDesign(url) {
  try {
    const response = await fetch(url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const { width, height, format } = response.ok ? await sharp(bytes).metadata() : {};
    return { url, status: response.status, type: response.headers.get("content-type"), sha256: sha256(bytes), width, height, format };
  } catch (error) {
    return { url, status: 0, error: String(error) };
  }
}
route("POST", "/orders/create", async ({ body, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const order = JSON.parse(body);
  const mode = artelo.modes.get(order.orderId) ?? "ok";
  received.orders.push({ orderId: order.orderId, mode });
  // Artelo refuses a design under 150 dpi unless dangerouslySkipDPICheck is set; the only png here is the margin check's share card
  if (order.items.some((item) => item.productInfo.designs?.[0]?.sourceImage?.url.endsWith(".png")) && !order.dangerouslySkipDPICheck) return [400, { message: "the dpi of one or more designs falls below the 150 threshold" }];
  if (mode === "down") return [503, "<html><body>service unavailable</body></html>"];
  if (mode && typeof mode === "object" && mode.refuse) {
    const item = order.items.find((entry) => entry.productInfo.designs?.[0]?.sourceImage?.url.includes(`/photos/downloads/${mode.refuse}?`));
    if (item) return [400, { message: `item ${item.orderItemId}: the design for ${mode.refuse} can't be printed` }];
  }
  // The margin check's lookup order (Task 14) has a public image that isn't fetched
  const designs = order.orderId.startsWith("check-") ? [] : await Promise.all(order.items.map((item) => fetchDesign(item.productInfo.designs[0].sourceImage.url)));
  const placed = { id: `artelo-${++artelo.count}`, orderId: order.orderId, status: "Received", order, designs, shipments: [] };
  artelo.orders.push(placed);
  const prints = order.items.reduce((count, item) => count + item.quantity, 0);
  return [200, { id: placed.id, orderId: placed.orderId, status: placed.status, details: { productionCost: 40 * prints, arteloShipping: 30, usSalesTax: 0 } }];
});
route("GET", "/orders/get", ({ url, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const name = url.searchParams.get("name");
  return [200, artelo.orders.filter((entry) => entry.orderId === name).slice(0, Number(url.searchParams.get("limit") ?? 5)).map(({ id, orderId, status }) => ({ id, orderId, status }))];
});
route("POST", "/__mode", ({ body }) => {
  const { order, mode } = JSON.parse(body);
  artelo.modes.set(order, mode);
  return [204, ""];
});
route("GET", "/__orders", () => [200, artelo.orders]);
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/prints/place.ts src/lib/prints/artelo-status.ts src/lib/prints/artelo.ts src/lib/prints/store.ts src/lib/prints/cron.ts tests/fixtures/artelo-site.mjs tests/unit/place.test.ts
git commit -m "feat: placing the artelo order once, with a lease, a lookup before every create, retries and a day's window"
```

---

### Task 10: Stripe's webhook, the paid transition and the reconciliation

Spec 1.2 step 8 (sections 18.1, 18.6 step 2 and 19): `POST /api/prints/stripe` verifies Stripe's signature before reading anything, applies each event exactly once (a ledger row in the same batch as the order change), moves a checkout to `paid` (or `needs_attention` when the amount, currency or mode doesn't match the quote) and starts placement; refunds stop retries or flag a placed order. The cron's second step asks Stripe about every checkout older than 65 minutes before anything expires it, so a paid order is noticed even when the webhook never arrives. The two provider webhooks need no `Origin`. The e2e specs walk a full order, a partial refusal and a missed webhook through the stand-ins.

**Files:**
- Create: `src/lib/prints/stripe-events.ts`, `src/lib/prints/http.ts`, `src/pages/api/prints/stripe.ts`, `tests/unit/stripe-events.test.ts`, `tests/unit/stripe-route.test.ts`, `tests/e2e/prints-order.spec.ts`
- Modify: `src/lib/prints/stripe.ts`, `src/lib/prints/cron.ts`, `src/lib/admin/gate.ts`, `tests/unit/gate.test.ts`, `tests/e2e/prints.ts`
- Test: the two new unit tests, `tests/unit/gate.test.ts`, `tests/unit/middleware.test.ts` (unchanged, must pass), `tests/e2e/prints-order.spec.ts`

**Interfaces:**
- Consumes: `PrintDeps`, `printDeps` (Task 1); `offerFor`, `printsFor`, `isTier`, `isFrame` (Task 2); `getOrder`, `OrderRow`, `loadPrices` (Task 3); `photoMaster`, `revokeOrderGrants` (Task 3); `StripeSession`, `getSession`, `expireSession`, `stripe` (Task 7); `markExpired` (Task 7); `sendAdminNote`, `sendDueMail` (Task 8); `placeOrder`, `REFUND_REASON` (Task 9); `fromB64url`-style hex decoding is written here.
- Produces (`src/lib/prints/stripe.ts`): `SIGNATURE_TOLERANCE = 300`; `fromHex(text: string): Uint8Array | null`; `verifyStripeSignature(secret, header: string | null, body: string, now: number): Promise<boolean>`
- Produces (`src/lib/prints/http.ts`): `readCapped(request: Request, limit: number): Promise<string | "big" | null>`; `jsonAnswer(value: unknown, status: number): Response`
- Produces (`src/lib/prints/stripe-events.ts`): `interface StripeEvent { id: string; type: string; livemode: boolean; data: { object: Record<string, unknown> } }`; `readEvent(value: unknown): StripeEvent | null`; `MISMATCH_REASON`, `MODE_REASON`, `MISSING_REASON` (`REFUND_REASON` comes from Task 9's `artelo-status.ts`); `type PaidOutcome = "paid" | "attention" | "unchanged" | "recreated" | "unpaid"`; `applyPaid(deps, session: StripeSession, before: D1PreparedStatement[], livemode?: boolean): Promise<PaidOutcome>`; `handleStripeEvent(deps, event): Promise<200 | 500>`; `RECONCILE_AFTER = 3900`; `reconcileCheckouts(deps): Promise<void>`
- Produces (`src/lib/admin/gate.ts`): `WEBHOOK_PATHS`; `originAllowed` exempts exactly `POST /api/prints/stripe` and `POST /api/prints/artelo`
- Produces (e2e, `tests/e2e/prints.ts`): `checkoutOrder(page, name, items?, site?)`, `payAtStandIn(sessionId, extra?)`, `stripeSignature(body, secret, t?)`, `deliverStripe(site, event, secret?)`, `waitForStatus(orderId, status, store?)`, `setMode(orderId, mode)`, `arteloOrdersFor(orderId)`, `mailFor(match)`, `runCron(site)`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/stripe-events.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { issueOrderGrant } from "../../src/lib/photos/store";
import { applyPaid, handleStripeEvent, reconcileCheckouts, type StripeEvent } from "../../src/lib/prints/stripe-events";
import { verifyStripeSignature } from "../../src/lib/prints/stripe";
import { getOrder } from "../../src/lib/prints/store";
import { captureLogs, fakeFetch, insertOrder, json, NOW, PHOTO_KEY, printDb, testDeps, type Handler } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";
const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1", object: "checkout.session", status: "complete", payment_status: "paid", client_reference_id: ORDER, livemode: false, currency: "aud",
  amount_total: 28700, payment_intent: "pi_test_1", metadata: { order_id: ORDER, country: "AU", print_total: "23800", delivery_amount: "4900", delivery_taxed: "0", line_1: "fixture-b-01:medium:oak:1", line_2: "fixture-b-02:small:unframed:1" },
  ...over,
});
const event = (type: string, object: Record<string, unknown>, id = "evt_1"): StripeEvent => ({ id, type, livemode: false, data: { object } });
const checkout = (db: D1Database, over: Record<string, string | number | null> = {}) =>
  insertOrder(db, { id: ORDER, status: "checkout", stripe_session_id: "cs_test_1", stripe_payment_intent: null, paid_at: null, next_attempt_at: null, retry_until: null, ...over });
// Placement starts in the background against a fake with no Artelo, fails and retries: its logs are silenced
const setup = async (handlers: Record<string, Handler> = {}) => {
  captureLogs();
  const db = await printDb();
  const deps = testDeps(db, { fetch: fakeFetch(handlers).fetch });
  return { db, deps };
};
const events = (db: D1Database) => db.prepare("SELECT id FROM stripe_events").all().then((result) => result.results);

afterEach(() => vi.restoreAllMocks());

describe("the guard", () => {
  test("a paid session moves its order from checkout to paid and starts placing it at once", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect(await events(db)).toEqual([{ id: "evt_1" }]);
    expect(deps.waited).toHaveLength(1);
    // The first attempt ran at once (attempts from 0 to 1, due now) and, with no Artelo here, backed off five minutes
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", paid_at: NOW, stripe_session_id: "cs_test_1", stripe_payment_intent: "pi_test_1", retry_until: NOW + 86_400, attempts: 1, next_attempt_at: NOW + 300 });
  });

  test("an expired checkout that is paid after all becomes paid too", async () => {
    const { db, deps } = await setup();
    await checkout(db, { status: "expired" });
    await handleStripeEvent(deps, event("checkout.session.completed", session()));
    expect((await getOrder(db, ORDER))?.status).toBe("paid");
  });

  test("the same event twice applies once", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session()));
    await db.prepare("UPDATE print_orders SET status = 'placed' WHERE id = ?").bind(ORDER).run();
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect((await getOrder(db, ORDER))?.status).toBe("placed");
    expect(deps.waited).toHaveLength(1);
  });

  test("a concurrent duplicate fails its batch and answers 500, changing nothing; stripe's redelivery then finds the row", async () => {
    captureLogs();
    const { db, deps } = await setup();
    await checkout(db);
    // The race: the other delivery's row lands between this one's look and its batch
    await db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES ('evt_1', 'checkout.session.completed', 1)").run();
    const racing = {
      ...db,
      prepare: (sql: string) => (sql.startsWith("SELECT 1") ? { bind: () => ({ first: async () => null }) } : db.prepare(sql)),
      batch: db.batch.bind(db),
    } as unknown as D1Database;
    expect(await handleStripeEvent({ ...deps, db: racing }, event("checkout.session.completed", session()))).toBe(500);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
  });

  test("two events for one session pay once: the status condition is the session's guard", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session(), "evt_1"));
    await handleStripeEvent(deps, event("checkout.session.completed", session(), "evt_2"));
    expect(deps.waited).toHaveLength(1);
    expect(await events(db)).toEqual([{ id: "evt_1" }, { id: "evt_2" }]);
  });

  test("an event whose order can't be found isn't recorded and answers 500, so stripe sends it again", async () => {
    captureLogs();
    const { db, deps } = await setup();
    expect(await handleStripeEvent(deps, event("checkout.session.expired", session({ id: "cs_none", client_reference_id: "01k6x0000000000000000000zz" })))).toBe(500);
    expect(await handleStripeEvent(deps, event("charge.refunded", { payment_intent: "pi_none", amount: 100, amount_refunded: 100, refunded: true }, "evt_2"))).toBe(500);
    expect(await events(db)).toEqual([]);
  });

  test("a paid session whose order is missing recreates it from the metadata, straight into needs attention", async () => {
    const { db, deps } = await setup();
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session()))).toBe(200);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "the order row was missing; check it before it's placed.", country: "AU", print_total: 23800, delivery_amount: 4900, delivery_taxed: 0, livemode: 0, stripe_session_id: "cs_test_1", stripe_payment_intent: "pi_test_1" });
    expect((await db.prepare("SELECT line, photo_id, tier, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id = ? ORDER BY line").bind(ORDER).all()).results).toEqual([
      { line: 1, photo_id: "fixture-b-01", tier: "medium", size: "x12x18", frame: "oak", quantity: 1, unit_amount: 17900 },
      { line: 2, photo_id: "fixture-b-02", tier: "small", size: "x8x12", frame: "unframed", quantity: 1, unit_amount: 5900 },
    ]);
  });

  test("an amount, currency or currency conversion that doesn't match the quote is paid but needs attention (adaptive pricing off)", async () => {
    for (const over of [{ amount_total: 28600 }, { currency: "usd" }, { currency_conversion: { amount_total: 19000, source_currency: "usd" } }]) {
      const { db, deps } = await setup();
      await checkout(db);
      await handleStripeEvent(deps, event("checkout.session.completed", session(over)));
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "the amount paid differs from the quote", paid_at: NOW, stripe_payment_intent: "pi_test_1" });
    }
    const { db, deps } = await setup();
    await checkout(db);
    await handleStripeEvent(deps, event("checkout.session.completed", session({ livemode: true })));
    expect((await getOrder(db, ORDER))?.attention_reason).toBe("stripe's test and live modes don't match this order; check it before it's placed.");
  });

  test("an unpaid session records nothing; an expired one expires its checkout", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    expect(await handleStripeEvent(deps, event("checkout.session.completed", session({ payment_status: "unpaid" })))).toBe(200);
    expect(await events(db)).toEqual([]);
    expect(await handleStripeEvent(deps, event("checkout.session.expired", session({ status: "expired", payment_status: "unpaid" }), "evt_2"))).toBe(200);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
  });
});

describe("refunds", () => {
  const refund = (amount_refunded: number, refunded: boolean, id = "evt_r") => event("charge.refunded", { payment_intent: `pi_test_${ORDER}`, amount: 28700, amount_refunded, refunded }, id);

  test("a full refund before placement stops the retries and revokes the master links", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    await handleStripeEvent(deps, refund(28700, true));
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "refunded", refunded_amount: 28700, refunded_at: NOW });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n")).toBe(0);
  });

  test("a full refund after placement needs attention, to cancel it at artelo", async () => {
    for (const status of ["placed", "in_production"]) {
      const { db, deps } = await setup();
      await insertOrder(db, { id: ORDER, status, artelo_order_id: "artelo-1" });
      await handleStripeEvent(deps, refund(28700, true));
      expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", refunded_amount: 28700 });
    }
  });

  test("a partial refund changes only the amounts", async () => {
    const { db, deps } = await setup();
    await insertOrder(db, { id: ORDER, status: "placed", artelo_order_id: "artelo-1" });
    await handleStripeEvent(deps, refund(4900, false));
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", refunded_amount: 4900, refunded_at: NOW });
  });
});

describe("Stripe's signature", () => {
  const SECRET = "whsec_fixture";
  const sign = async (body: string, t: number, secret = SECRET) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  test("an HMAC of the timestamp and the raw body, within five minutes, against any of several v1 values", async () => {
    const body = '{"id":"evt_1"}';
    const good = await sign(body, NOW);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good}`, body, NOW)).toBe(true);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${"0".repeat(64)},v1=${good}`, body, NOW + 300)).toBe(true);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good}`, body, NOW + 301)).toBe(false);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${good}`, '{"id":"evt_2"}', NOW)).toBe(false);
    expect(await verifyStripeSignature(SECRET, `t=${NOW},v1=${await sign(body, NOW, "whsec_other")}`, body, NOW)).toBe(false);
    for (const header of [null, "", `v1=${good}`, `t=abc,v1=${good}`, `t=${NOW}`, `t=${NOW},v1=xyz`]) expect(await verifyStripeSignature(SECRET, header, body, NOW)).toBe(false);
    expect(await verifyStripeSignature("", `t=${NOW},v1=${good}`, body, NOW)).toBe(false);
  });
});

describe("reconciliation", () => {
  const OLD = NOW - 3901;
  const SESSION = "GET https://stripe.test/v1/checkout/sessions/cs_test_1";
  const EXPIRE = "POST https://stripe.test/v1/checkout/sessions/cs_test_1/expire";

  test("a paid session whose webhook never arrived becomes paid, starts placing and tells george, never expired", async () => {
    captureLogs();
    const mail = vi.fn(async () => ({ messageId: "m" }));
    const db = await printDb();
    const deps = testDeps(db, { fetch: fakeFetch({ [SESSION]: () => json(session()) }).fetch, email: { send: mail } as unknown as SendEmail });
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("paid");
    expect(await events(db)).toEqual([]);
    expect(deps.waited).toHaveLength(1);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${ORDER}: stripe's webhook never arrived`, text: `print order ${ORDER} was paid but stripe's webhook never arrived. check the webhook in stripe.` }));
    expect((await getOrder(db, ORDER))?.admin_notified_at).toBe(NOW);
  });

  test("the missed-webhook email stays due when its send fails, for the cron to retry", async () => {
    const { db, deps } = await setup({ [SESSION]: () => json(session()) });
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", admin_notified_at: 0 });
  });

  test("a session stripe doesn't know a day after it should have ended expires its order; a younger one waits its turn", async () => {
    let { db, deps } = await setup({ [SESSION]: () => json({ error: {} }, 404) });
    await checkout(db, { created_at: NOW - 25 * 3600 - 1 });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
    ({ db, deps } = await setup({ [SESSION]: () => json({ error: {} }, 404) }));
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "checkout", status_checked_at: NOW });
  });

  test("orders it has just read go to the back of the line, so twenty stuck ones can't hide a newer paid one", async () => {
    captureLogs();
    const db = await printDb();
    const handlers: Record<string, Handler> = { [SESSION]: () => json(session()) };
    for (let i = 0; i < 20; i++) {
      await insertOrder(db, { id: `stuck-${i}`, status: "checkout", stripe_session_id: `cs_stuck_${i}`, stripe_payment_intent: null, paid_at: null, created_at: OLD - 1000 - i });
      handlers[`GET https://stripe.test/v1/checkout/sessions/cs_stuck_${i}`] = () => json(session({ id: `cs_stuck_${i}`, status: "complete", payment_status: "unpaid" }));
    }
    await checkout(db, { created_at: OLD });
    const fetch = fakeFetch(handlers).fetch;
    await reconcileCheckouts(testDeps(db, { fetch }));
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    await reconcileCheckouts(testDeps(db, { fetch, now: () => NOW + 300 }));
    expect((await getOrder(db, ORDER))?.status).toBe("paid");
  });

  test("an open session is expired at stripe and left for the next run; an expired one expires its order", async () => {
    const expire = vi.fn(() => json(session({ status: "expired" })));
    let { db, deps } = await setup({ [SESSION]: () => json(session({ status: "open", payment_status: "unpaid" })), [EXPIRE]: expire });
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect(expire).toHaveBeenCalledTimes(1);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    ({ db, deps } = await setup({ [SESSION]: () => json(session({ status: "expired", payment_status: "unpaid" })) }));
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
  });

  test("an order stripe never answered for expires; a recent one and an unreadable session are left alone", async () => {
    captureLogs();
    let { db, deps } = await setup();
    await checkout(db, { created_at: OLD, stripe_session_id: null });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("expired");
    ({ db, deps } = await setup({ [SESSION]: () => json(session()) }));
    await checkout(db, { created_at: NOW - 3800 });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
    ({ db, deps } = await setup({ [SESSION]: () => json({}, 503) }));
    await checkout(db, { created_at: OLD });
    await reconcileCheckouts(deps);
    expect((await getOrder(db, ORDER))?.status).toBe("checkout");
  });

  test("applyPaid with no event row needs no ledger: the status condition guards it", async () => {
    const { db, deps } = await setup();
    await checkout(db);
    expect(await applyPaid(deps, session() as never, [])).toBe("paid");
    expect(await applyPaid(deps, session() as never, [])).toBe("unchanged");
  });
});
```

Create `tests/unit/stripe-route.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";
import { insertOrder, printDb } from "./prints-fakes";

// The route reads the Worker's env; stand in a store and the fixture secrets
const env = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, PHOTO_PRINTS: {}, PRINTS_OPEN: "true", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_SECRET_KEY: "sk_test_x" }));
vi.mock("cloudflare:workers", () => ({ env }));
vi.stubGlobal("__TEST_HOOKS__", false);
const { POST } = await import("../../src/pages/api/prints/stripe");

const ORDER = "01k6x00000000000000000000a";
const sign = async (body: string, t = Math.floor(Date.now() / 1000)) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_fixture"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${mac}`;
};
const call = async (body: string, signature: string | null) =>
  (await POST({ request: new Request("https://curiousgeorge.dev/api/prints/stripe", { method: "POST", body, headers: signature ? { "Stripe-Signature": signature } : {} }), locals: { cfContext: { waitUntil: () => {} } } } as never)) as Response;

beforeEach(async () => {
  env.DB = await printDb();
});

test("a bad signature is a 400 before the body is read for anything", async () => {
  const response = await call("not json at all", "t=1,v1=00");
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM stripe_events").first("n")).toBe(0);
});

test("a body past 256KB is a 413", async () => {
  expect((await call("x".repeat(256 * 1024 + 1), "t=1,v1=00")).status).toBe(413);
});

test("a signed body that isn't an event is a 400; a signed event is applied and answered 200", async () => {
  expect((await call("[]", await sign("[]"))).status).toBe(400);
  await insertOrder(env.DB, { id: ORDER, status: "checkout", stripe_session_id: "cs_test_1", stripe_payment_intent: null, paid_at: null });
  const body = JSON.stringify({ id: "evt_route", type: "checkout.session.expired", livemode: false, data: { object: { id: "cs_test_1", client_reference_id: ORDER, status: "expired", payment_status: "unpaid" } } });
  const response = await call(body, await sign(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  expect(await env.DB.prepare("SELECT status FROM print_orders WHERE id = ?").bind(ORDER).first("status")).toBe("expired");
});
```

Append to `tests/unit/gate.test.ts`, inside `describe("originAllowed", …)`:

```ts
  test("exactly the two provider webhooks may post without an Origin; they verify a signature instead", () => {
    for (const path of ["/api/prints/stripe", "/api/prints/artelo"]) expect(originAllowed(request("POST"), new URL(`https://curiousgeorge.dev${path}`))).toBe(true);
    for (const path of ["/api/prints/stripe/", "/api/prints/other", "/basket", "/admin/"]) expect(originAllowed(request("POST"), new URL(`https://curiousgeorge.dev${path}`))).toBe(false);
    expect(originAllowed(request("PUT"), new URL("https://curiousgeorge.dev/api/prints/stripe"))).toBe(false);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/stripe-events.test.ts tests/unit/stripe-route.test.ts tests/unit/gate.test.ts`
Expected: FAIL, the modules, the route and the exemption don't exist.

- [ ] **Step 3: Verify Stripe's signature and read capped bodies**

Append to `src/lib/prints/stripe.ts`:

```ts
/** Stripe's signed timestamp may be at most five minutes from now (spec 18.1) */
export const SIGNATURE_TOLERANCE = 300;

export function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(text)) return null;
  return Uint8Array.from(text.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

/** Stripe-Signature: t=<seconds>,v1=<hex>[,v1=…], an HMAC-SHA256 of "<t>.<raw body>", compared in constant time by Web Crypto */
export async function verifyStripeSignature(secret: string, header: string | null, body: string, now: number): Promise<boolean> {
  if (!secret || !header) return false;
  const pairs = header.split(",").map((part) => {
    const at = part.indexOf("=");
    return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
  });
  const t = pairs.find(([name]) => name === "t")?.[1];
  const signatures = pairs.filter(([name]) => name === "v1").map(([, value]) => fromHex(value)).filter((value): value is Uint8Array => value !== null);
  if (!t || !/^\d{1,12}$/.test(t) || Math.abs(now - Number(t)) > SIGNATURE_TOLERANCE || signatures.length === 0) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${t}.${body}`);
  for (const signature of signatures) if (await crypto.subtle.verify("HMAC", key, signature, data)) return true;
  return false;
}
```

Create `src/lib/prints/http.ts`:

```ts
// The provider webhooks' plumbing: a raw body read with a ceiling, and a JSON answer no cache keeps

/** At most `limit` bytes of the body as text; "big" past it however it arrives, null if the read fails */
export async function readCapped(request: Request, limit: number): Promise<string | "big" | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return "big";
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export const jsonAnswer = (value: unknown, status: number) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
```

- [ ] **Step 4: Write the event handling and the reconciliation**

Create `src/lib/prints/stripe-events.ts`:

```ts
import { photoMaster, revokeOrderGrants } from "../photos/store";
import { REFUND_REASON } from "./artelo-status";
import { isFrame, isTier, offerFor, printsFor } from "./catalogue";
import type { PrintDeps } from "./config";
import { sendAdminNote, sendDueMail } from "./mail";
import { placeOrder } from "./place";
import { getOrder, loadPrices, markExpired, type OrderRow } from "./store";
import { expireSession, getSession, type StripeSession } from "./stripe";

// Stripe's webhook, processed exactly once (spec 18.1), and the cron's reconciliation (18.6 step 2), which share the paid
// transition. Logs carry only event ids, types and order ids.

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

export function readEvent(value: unknown): StripeEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const data = event.data as { object?: unknown } | undefined;
  if (typeof event.id !== "string" || typeof event.type !== "string" || !data?.object || typeof data.object !== "object") return null;
  return { id: event.id, type: event.type, livemode: event.livemode === true, data: { object: data.object as Record<string, unknown> } };
}

export const MISMATCH_REASON = "the amount paid differs from the quote";
export const MODE_REASON = "stripe's test and live modes don't match this order; check it before it's placed.";
export const MISSING_REASON = "the order row was missing; check it before it's placed.";
export type PaidOutcome = "paid" | "attention" | "unchanged" | "recreated" | "unpaid";

/** Why a paid session can't go straight to placing, or null. Adaptive Pricing is off, so any conversion is a mismatch */
function mismatch(order: OrderRow, session: StripeSession): string | null {
  if (Number(session.livemode === true) !== order.livemode) return MODE_REASON;
  if (session.currency !== "aud" || (session.currency_conversion !== undefined && session.currency_conversion !== null) || session.amount_total !== order.print_total + order.delivery_amount) return MISMATCH_REASON;
  return null;
}

/** Whole non-negative cents from metadata text, else 0: migration 0007 refuses a fractional or negative amount, and a refused insert would lose a paid order */
const cents = (value: string | undefined): number => {
  const rounded = Math.round(Number(value));
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : 0;
};

/** A missing order rebuilt from the session's metadata, straight into needs_attention (it never should happen) */
async function recreate(deps: PrintDeps, session: StripeSession, orderId: string, livemode: boolean): Promise<D1PreparedStatement[]> {
  const { db } = deps;
  const now = deps.now();
  const meta = session.metadata ?? {};
  const prices = await loadPrices(db);
  const statements = [
    db.prepare("INSERT INTO print_orders (id, country, print_total, delivery_amount, delivery_taxed, status, attention_reason, livemode, stripe_session_id, stripe_payment_intent, attempts, retry_until, next_attempt_at, created_at, paid_at, updated_at) VALUES (?, ?, ?, ?, ?, 'needs_attention', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(orderId, /^[A-Z]{2}$/.test(meta.country ?? "") ? meta.country : "ZZ", cents(meta.print_total), cents(meta.delivery_amount), meta.delivery_taxed === "1" ? 1 : 0, MISSING_REASON, livemode ? 1 : 0, session.id, session.payment_intent, now + deps.config.retryWindow, now, now, now, now),
  ];
  for (let line = 1; line <= 10; line++) {
    const [photoId = "", tier = "", frame = "", quantity = ""] = (meta[`line_${line}`] ?? "").split(":");
    if (!photoId || !isTier(tier) || !isFrame(frame) || !/^\d{1,2}$/.test(quantity)) continue;
    const photo = await photoMaster(db, photoId);
    const size = photo ? (offerFor(printsFor(photo.print_width, photo.print_height), tier)?.size.size ?? "") : "";
    statements.push(
      db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .bind(orderId, line, photoId, tier, size, frame, Number(quantity), prices[tier][frame]),
    );
  }
  return statements;
}

/**
 * The paid transition (spec 18.1), shared by the webhook (with its ledger row first in `before`) and the reconciliation
 * (with none: the status condition is the guard). The batch commits the order change with the ledger row, or neither.
 */
export async function applyPaid(deps: PrintDeps, session: StripeSession, before: D1PreparedStatement[], livemode = session.livemode === true): Promise<PaidOutcome> {
  if (session.payment_status !== "paid") return "unpaid";
  const { db } = deps;
  const orderId = session.client_reference_id;
  if (!orderId) throw new Error("a paid session without an order id");
  const order = await getOrder(db, orderId);
  if (!order) {
    await db.batch([...before, ...(await recreate(deps, session, orderId, livemode))]);
    deps.waitUntil(sendDueMail(deps));
    return "recreated";
  }
  const now = deps.now();
  const reason = mismatch(order, session);
  const results = await db.batch([
    ...before,
    db.prepare("UPDATE print_orders SET status = ?, attention_reason = ?, attention_notified_at = NULL, paid_at = ?, stripe_session_id = ?, stripe_payment_intent = ?, attempts = 0, retry_until = ?, next_attempt_at = ?, lease_until = NULL, status_checked_at = NULL, updated_at = ? WHERE id = ? AND status IN ('checkout', 'expired')")
      .bind(reason ? "needs_attention" : "paid", reason, now, session.id, session.payment_intent, now + deps.config.retryWindow, now, now, order.id),
  ]);
  if (results.at(-1)!.meta.changes === 0) return "unchanged";
  // The first placement attempt runs after the answer (spec 18.1)
  deps.waitUntil(reason ? sendDueMail(deps) : placeOrder(deps, order.id));
  return reason ? "attention" : "paid";
}

/** 200 once the event is applied or was already; 500 when it can't be, so Stripe delivers it again (it retries for 3 days) */
export async function handleStripeEvent(deps: PrintDeps, event: StripeEvent): Promise<200 | 500> {
  const { db } = deps;
  if (await db.prepare("SELECT 1 AS seen FROM stripe_events WHERE id = ?").bind(event.id).first()) return 200;
  const record = db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)").bind(event.id, event.type, deps.now());
  const object = event.data.object;
  try {
    if (event.type === "checkout.session.completed") {
      const session = object as unknown as StripeSession;
      if (session.payment_status !== "paid") {
        console.log("prints: stripe event", event.id, "is for an unpaid session; nothing recorded");
        return 200;
      }
      await applyPaid(deps, session, [record], event.livemode);
      return 200;
    }
    if (event.type === "checkout.session.expired") {
      const id = typeof object.client_reference_id === "string" ? object.client_reference_id : null;
      if (!id || !(await getOrder(db, id))) throw new Error("no order for this session");
      await db.batch([record, db.prepare("UPDATE print_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'checkout'").bind(deps.now(), id)]);
      return 200;
    }
    if (event.type === "charge.refunded") {
      const intent = typeof object.payment_intent === "string" ? object.payment_intent : null;
      const order = intent ? await db.prepare("SELECT * FROM print_orders WHERE stripe_payment_intent = ?").bind(intent).first<OrderRow>() : null;
      if (!order) throw new Error("no order for this payment");
      const now = deps.now();
      const refunded = Number(object.amount_refunded) || 0;
      const statements = [record, db.prepare("UPDATE print_orders SET refunded_at = ?, refunded_amount = ?, updated_at = ? WHERE id = ?").bind(now, refunded, now, order.id)];
      if (object.refunded === true) {
        statements.push(
          // Not yet placed: nothing to make, so the retries stop
          db.prepare("UPDATE print_orders SET status = 'refunded', lease_until = NULL, updated_at = ? WHERE id = ? AND status IN ('paid', 'needs_attention') AND artelo_order_id IS NULL").bind(now, order.id),
          // Already with Artelo: George cancels it there
          db.prepare("UPDATE print_orders SET status = 'needs_attention', attention_reason = ?, attention_notified_at = NULL, updated_at = ? WHERE id = ? AND status IN ('placed', 'in_production')").bind(REFUND_REASON, now, order.id),
        );
      }
      await db.batch(statements);
      // Refunded before Artelo had it: nothing will be made, so its master links go now (Artelo's statuses revoke the rest)
      if (object.refunded === true && order.artelo_order_id === null) await revokeOrderGrants(db, order.id, now);
      deps.waitUntil(sendDueMail(deps));
      return 200;
    }
    // Only the three events are subscribed; anything else is recorded and ignored
    await record.run();
    return 200;
  } catch (error) {
    console.error("prints: stripe event", event.id, event.type, "wasn't applied:", error instanceof Error ? error.message : String(error));
    return 500;
  }
}

/** Checkouts older than this are asked about: sessions expire after an hour */
export const RECONCILE_AFTER = 65 * 60;
/** A session Stripe doesn't know this long after its order began (a session lasts an hour) is gone for good */
export const UNKNOWN_SESSION_AFTER = 25 * 3600;

/**
 * The cron's second step (spec 18.6): no paid order goes unnoticed, and nothing expires before Stripe is asked. Each
 * order read goes to the back of the line (status_checked_at), so twenty that stay checkout can't hide a newer paid one
 */
export async function reconcileCheckouts(deps: PrintDeps): Promise<void> {
  const { results } = await deps.db
    .prepare("SELECT id, stripe_session_id, created_at FROM print_orders WHERE status = 'checkout' AND created_at < ? ORDER BY COALESCE(status_checked_at, created_at), created_at LIMIT 20")
    .bind(deps.now() - RECONCILE_AFTER)
    .all();
  for (const row of results as unknown as { id: string; stripe_session_id: string | null; created_at: number }[]) {
    // Stripe never answered, so the buyer never saw a payment page
    if (!row.stripe_session_id) {
      await markExpired(deps.db, row.id, deps.now());
      continue;
    }
    const now = deps.now();
    await deps.db.prepare("UPDATE print_orders SET status_checked_at = ? WHERE id = ?").bind(now, row.id).run();
    const result = await getSession(deps, row.stripe_session_id);
    if (!result.ok) {
      if (result.status === 404 && row.created_at < now - UNKNOWN_SESSION_AFTER) {
        await markExpired(deps.db, row.id, now);
        console.error(`prints: order ${row.id}'s session is unknown to stripe; expired`);
      } else console.error("prints: couldn't read the session of order", row.id, result.status ?? "no answer");
      continue;
    }
    const session = result.body as unknown as StripeSession;
    if (session.status === "complete" && session.payment_status === "paid") {
      const outcome = await applyPaid(deps, session, []);
      if (outcome === "paid" || outcome === "attention") {
        // George's email is due until it goes: claimed and released like the others and retried by the cron (spec 18.4)
        await deps.db.prepare("UPDATE print_orders SET admin_notified_at = 0 WHERE id = ?").bind(row.id).run();
        await sendAdminNote(deps, row.id);
      }
    } else if (session.status === "expired") {
      await markExpired(deps.db, row.id, deps.now());
    } else if (session.status === "open") {
      // Expire it now and let its expiry be seen on the next run
      await expireSession(deps, session.id);
    }
  }
}
```

- [ ] **Step 5: Write the route, the exemption and the cron step**

Create `src/pages/api/prints/stripe.ts`:

```ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { printDeps } from "../../../lib/prints/config";
import { jsonAnswer, readCapped } from "../../../lib/prints/http";
import { handleStripeEvent, readEvent } from "../../../lib/prints/stripe-events";
import { verifyStripeSignature } from "../../../lib/prints/stripe";

// Stripe's webhook (spec 18.1): the signature first, before anything in the body is read; Stripe sends no Origin
export const POST: APIRoute = async ({ request, locals }) => {
  const deps = printDeps(env, (promise) => locals.cfContext.waitUntil(promise));
  const raw = await readCapped(request, 256 * 1024);
  if (raw === "big") return jsonAnswer({ error: "too large" }, 413);
  if (raw === null || !(await verifyStripeSignature(deps.config.secrets.STRIPE_WEBHOOK_SECRET, request.headers.get("stripe-signature"), raw, deps.now()))) return jsonAnswer({ error: "invalid signature" }, 400);
  let event: ReturnType<typeof readEvent> = null;
  try {
    event = readEvent(JSON.parse(raw));
  } catch {
    event = null;
  }
  if (!event) return jsonAnswer({ error: "not an event" }, 400);
  const status = await handleStripeEvent(deps, event);
  return jsonAnswer(status === 200 ? { received: true } : { error: "try again" }, status);
};
```

In `src/lib/admin/gate.ts`, replace `originAllowed` with:

```ts
/** Providers' webhooks send no Origin; each verifies its signature before reading anything else (spec 13.3) */
export const WEBHOOK_PATHS = ["/api/prints/stripe", "/api/prints/artelo"];

/** Writes must come from this site: a missing or different Origin header is refused (spec 7), except at the two webhooks */
export function originAllowed(request: Request, url: URL): boolean {
  if (SAFE_METHODS.includes(request.method)) return true;
  if (request.method === "POST" && WEBHOOK_PATHS.includes(url.pathname)) return true;
  return request.headers.get("origin") === url.origin;
}
```

In `src/lib/prints/cron.ts`, add `import { reconcileCheckouts } from "./stripe-events";` and add this step second in `cronSteps`, after placing:

```ts
    ["reconciling checkouts", () => reconcileCheckouts(deps)],
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/stripe-events.test.ts tests/unit/stripe-route.test.ts tests/unit/gate.test.ts tests/unit/middleware.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 7: Write the order e2e helpers and specs**

Append to `tests/e2e/prints.ts` (add `import { createHmac } from "node:crypto";` and `import { expect } from "@playwright/test";` to the imports, and `FIXTURE_SECRETS` to the `./prints-site` import):

```ts
/** A basket quoted for an Australian test address and sent to checkout; the order and its session at the stand-in */
export async function checkoutOrder(page: Page, name: string, items = TWO_PRINTS, site = PRINTS): Promise<{ orderId: string; sessionId: string }> {
  await page.goto(`${site}/basket?items=${items}`);
  await quoteDelivery(page, auAddress(name));
  const response = await postPayForm(page, site);
  if (response.status() !== 303) throw new Error(`checkout answered ${response.status()}`);
  const sessionId = response.headers()["location"].split("/").at(-1)!;
  const [found] = (await sessionsFor(name)).filter((entry) => entry.session.id === sessionId);
  return { orderId: found.session.client_reference_id, sessionId };
}

/** Completes a session at the stand-in as Checkout would; its checkout.session.completed event, for the spec to deliver */
export async function payAtStandIn(sessionId: string, extra: Record<string, unknown> = {}) {
  return standIn<{ event: { id: string } & Record<string, unknown> }>("/__stripe/pay", { method: "POST", body: JSON.stringify({ session: sessionId, ...extra }) });
}

export function stripeSignature(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Delivers an event to a prints server as Stripe would: signed, and with no Origin */
export async function deliverStripe(site: string, event: unknown, secret: string = FIXTURE_SECRETS.STRIPE_WEBHOOK_SECRET): Promise<number> {
  const body = JSON.stringify(event);
  return (await fetch(`${site}/api/prints/stripe`, { method: "POST", body, headers: { "Content-Type": "application/json", "Stripe-Signature": stripeSignature(body, secret) } })).status;
}

export async function waitForStatus(orderId: string, status: string, store = ".wrangler/prints") {
  await expect.poll(() => printsD1<{ status: string }>(`SELECT status FROM print_orders WHERE id = '${orderId}'`, store)[0]?.status, { timeout: 30_000 }).toBe(status);
}

/** How the stand-in answers this order's creation: "ok", "down" or { refuse: photoId } */
export async function setMode(orderId: string, mode: "ok" | "down" | { refuse: string }) {
  await fetch(`${STAND_IN}/__mode`, { method: "POST", body: JSON.stringify({ order: orderId, mode }) });
}

export interface StandInOrder {
  id: string;
  orderId: string;
  status: string;
  order: { customerAddress: Record<string, string>; isTestOrder: boolean; items: { orderItemId: string; quantity: number; productInfo: Record<string, unknown> & { designs: { sourceImage: { url: string } }[] } }[] };
  designs: { url: string; status: number; type: string; sha256: string; width: number; height: number }[];
}

export async function arteloOrdersFor(orderId: string): Promise<StandInOrder[]> {
  return (await standIn<StandInOrder[]>("/__orders")).filter((entry) => entry.orderId === orderId);
}

/** The sink's emails whose subject or text contains this */
export async function mailFor(match: string) {
  return (await standIn<{ to: string; subject: string; text: string; html: string; replyTo: string; from: { email: string; name: string } }[]>("/__mail")).filter((mail) => mail.subject.includes(match) || mail.text.includes(match));
}

/**
 * Runs the prints cron once through wrangler's local explorer, as snapshots-live.spec.ts does: GET /__scheduled can't
 * reach a Worker built with no_bundle
 */
export async function runCron(site = PRINTS) {
  const response = await fetch(`${site}/cdn-cgi/local/explorer/api/local/scheduled?worker=personal-website`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cron: "*/5 * * * *" }) });
  const answer = (await response.json().catch(() => null)) as { success?: boolean } | null;
  if (!response.ok || !answer?.success) throw new Error(`the cron answered ${response.status}`);
}
```

Create `tests/e2e/prints-order.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { arteloOrdersFor, asTestClient, checkoutOrder, deliverStripe, mailFor, payAtStandIn, printsD1, runCron, setMode, unique, waitForStatus } from "./prints";
import { PRINTS } from "./prints-site";

// Whole orders through the stand-ins on 4337: checkout, a paid session, Stripe's event, Artelo's order (spec 23.2)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("a paid basket becomes one artelo order with every print, made from the masters, however often stripe's event arrives", async ({ page }) => {
  await asTestClient(page);
  const name = `Ada ${unique()}`;
  const { orderId, sessionId } = await checkoutOrder(page, name);
  const { event } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  await waitForStatus(orderId, "placed");
  const orders = await arteloOrdersFor(orderId);
  expect(orders).toHaveLength(1);
  const [{ order, designs }] = orders;
  expect(order.isTestOrder).toBe(true);
  expect(order.customerAddress).toMatchObject({ name, street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" });
  expect(order.items.map((item) => [item.orderItemId, item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation, item.productInfo.paperType])).toEqual([
    [`${orderId}-1`, "x12x18", "NaturalOak", "Vertical", "ArchivalMatteFineArt"],
    [`${orderId}-2`, "x8x12", null, "Horizontal", "ArchivalMatteFineArt"],
  ]);
  const masters = Object.fromEntries(printsD1<{ id: string; print_sha256: string }>("SELECT id, print_sha256 FROM photos WHERE id IN ('fixture-b-01', 'fixture-b-02')").map((row) => [row.id, row.print_sha256]));
  expect(designs.map((design) => [new URL(design.url).pathname, design.status, design.type, design.width, design.height, design.sha256])).toEqual([
    ["/photos/downloads/fixture-b-01", 200, "image/jpeg", 4000, 6000, masters["fixture-b-01"]],
    ["/photos/downloads/fixture-b-02", 200, "image/jpeg", 6000, 4000, masters["fixture-b-02"]],
  ]);
  expect(printsD1(`SELECT COUNT(*) AS n FROM stripe_events WHERE id = '${event.id}'`)).toEqual([{ n: 1 }]);
  const [row] = printsD1<Record<string, unknown>>(`SELECT * FROM print_orders WHERE id = '${orderId}'`);
  expect(row).toMatchObject({ artelo_order_id: orders[0].id, artelo_status: "Received", artelo_cost: 11000 });
  expect(JSON.stringify(row)).not.toMatch(/Example Street|Bondi|buyer@example\.com/);
});

test("a refusal naming one print refuses the order: it needs attention and nothing is placed for the other", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  await setMode(orderId, { refuse: "fixture-b-02" });
  const { event } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  await waitForStatus(orderId, "needs_attention");
  const [{ attention_reason }] = printsD1<{ attention_reason: string }>(`SELECT attention_reason FROM print_orders WHERE id = '${orderId}'`);
  expect(attention_reason).toBe(`artelo refused the order: item ${orderId}-2: the design for fixture-b-02 can't be printed`);
  expect(await arteloOrdersFor(orderId)).toEqual([]);
  await expect.poll(async () => (await mailFor(`print order ${orderId} needs attention`)).length).toBe(1);
});

test("a paid order whose webhook never arrives is found by the cron and placed; george is told", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  await payAtStandIn(sessionId);
  // Older than the hour a session lasts, plus five minutes
  printsD1(`UPDATE print_orders SET created_at = created_at - 4000 WHERE id = '${orderId}'`);
  await runCron();
  await waitForStatus(orderId, "placed");
  expect(await arteloOrdersFor(orderId)).toHaveLength(1);
  const [mail] = await mailFor(`print order ${orderId}: stripe's webhook never arrived`);
  expect(mail).toMatchObject({ to: "hello@curiousgeorge.dev", text: `print order ${orderId} was paid but stripe's webhook never arrived. check the webhook in stripe.`, replyTo: "hello@curiousgeorge.dev", from: { email: "prints@curiousgeorge.dev", name: "george vlachos" } });
});

test("an amount that differs from the quote is paid but needs attention, and is never placed", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  const { event } = await payAtStandIn(sessionId, { conversion: true });
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  await waitForStatus(orderId, "needs_attention");
  expect(printsD1(`SELECT attention_reason FROM print_orders WHERE id = '${orderId}'`)).toEqual([{ attention_reason: "the amount paid differs from the quote" }]);
  expect(await arteloOrdersFor(orderId)).toEqual([]);
});

test("an unsigned or wrongly signed event is refused before anything is read", async () => {
  expect((await fetch(`${PRINTS}/api/prints/stripe`, { method: "POST", body: "{}" })).status).toBe(400);
  expect(await deliverStripe(PRINTS, { id: "evt_forged", type: "checkout.session.completed", data: { object: {} } }, "whsec_wrong")).toBe(400);
});
```

- [ ] **Step 8: Build and run the e2e specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-order.spec.ts tests/e2e/prints-checkout.spec.ts tests/e2e/admin-page.spec.ts tests/e2e/ingest.spec.ts`
Expected: every test passing.

- [ ] **Step 9: Commit**

```bash
git add src/lib/prints/stripe-events.ts src/lib/prints/http.ts src/lib/prints/stripe.ts src/lib/prints/cron.ts src/pages/api/prints/stripe.ts src/lib/admin/gate.ts tests/unit/stripe-events.test.ts tests/unit/stripe-route.test.ts tests/unit/gate.test.ts tests/e2e/prints.ts tests/e2e/prints-order.spec.ts
git commit -m "feat: stripe's webhook applied once per event, the paid transition and the cron's reconciliation"
```

---

### Task 11: Artelo's webhook and the status poll

Spec 1.2 step 10 (section 18.3): `POST /api/prints/artelo` verifies Artelo's hex HMAC over the raw body or its re-serialised JSON, reads `orderId`, `status` and `shipments` from the top level or a `data` object and applies the status rules: statuses only move forward, a late one is ignored, final states stay final, production revokes the order's grants, shipping stores the tracking and makes the buyer's email due, and Artelo's cancellation tells George. It always answers 200 for a signed body, so Artelo never deletes the webhook over an order it can't match. Because Artelo deletes a webhook after 20 failed deliveries, the cron also polls orders not checked for 12 hours.

**Files:**
- Create: `src/lib/prints/artelo-updates.ts`, `src/pages/api/prints/artelo.ts`, `tests/unit/artelo-status.test.ts`, `tests/unit/artelo-route.test.ts`
- Modify: `src/lib/prints/cron.ts`, `tests/fixtures/artelo-site.mjs`, `tests/e2e/prints.ts`, `tests/e2e/prints-order.spec.ts`
- Test: the two new unit tests, `tests/e2e/prints-order.spec.ts`

**Interfaces:**
- Consumes: `PrintDeps`, `printDeps` (Task 1); `getOrder`, `writeSetting`, `OrderRow`, `OrderStatus`, `Shipment` (Task 3); `revokeOrderGrants` (Task 3); `artelo` (Task 4); `fromHex` (Task 10); `sendDueMail`, `sendAdminNote` (Task 8); `mapStatus`, `PENDING_REASON` (Task 9); `unwrap`, `readShipments`, `readArteloOrder` (Task 9); `readCapped`, `jsonAnswer` (Task 10).
- Produces (`src/lib/prints/artelo-updates.ts`): `interface ArteloUpdate { orderId: string; status: string; shipments: Shipment[] | null }`; `readArteloUpdate(value: unknown): ArteloUpdate | null`; `verifyArteloSignature(secret, header: string | null, raw: string): Promise<boolean>`; `type UpdateOutcome = "applied" | "ignored" | "unknown"`; `applyArteloUpdate(deps, update): Promise<UpdateOutcome>`; `POLL_AFTER = 43_200`; `pollStatuses(deps, pause?: (ms: number) => Promise<void>): Promise<void>`
- Produces (e2e): the stand-in's `GET /orders/get-by-id`, `POST /__ship` (`{ site, order, status?, wrap? }`, signs and delivers an `OrderStatusChange`) and `POST /__status` (`{ order, status }`, changes the stand-in's order without a webhook); in `tests/e2e/prints.ts`: `placedOrder(page, name)`, `ship(site, orderId, status?)`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/artelo-status.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { issueOrderGrant } from "../../src/lib/photos/store";
import { mapStatus } from "../../src/lib/prints/artelo-status";
import { applyArteloUpdate, pollStatuses, readArteloUpdate, verifyArteloSignature } from "../../src/lib/prints/artelo-updates";
import { getOrder } from "../../src/lib/prints/store";
import { captureLogs, fakeFetch, insertOrder, json, NOW, PHOTO_KEY, printDb, testDeps, type Handler } from "./prints-fakes";

const ORDER = "01k6x00000000000000000000a";
const TRACKING = [{ carrierCode: "UPS", trackingNumber: "1Z999AA10123456784", trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }];
const setup = async (columns: Record<string, string | number | null> = {}, handlers: Record<string, Handler> = {}) => {
  captureLogs();
  const db = await printDb();
  await insertOrder(db, { id: ORDER, status: "placed", artelo_order_id: "artelo-1", placed_at: NOW - 3600, ...columns });
  return { db, deps: testDeps(db, { fetch: fakeFetch(handlers).fetch }) };
};
const update = (status: string, shipments: unknown[] | null = null, orderId = "artelo-1") => ({ orderId, status, shipments: shipments ? readArteloUpdate({ orderId, status, shipments })!.shipments : null });
const activeGrants = (db: D1Database) => db.prepare("SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = ? AND revoked_at IS NULL").bind(ORDER).first("n");

afterEach(() => vi.restoreAllMocks());

test("artelo's statuses map to the order's", () => {
  expect(["ImagesProcessing", "Received", "Ignored", "PendingFulfillmentAction", "InProduction", "Shipped", "Delivered", "Canceled", "OnHold"].map(mapStatus)).toEqual([
    "placed", "placed", "placed", "needs_attention", "in_production", "shipped", "delivered", "cancelled", null,
  ]);
});

describe("applying a status", () => {
  test("production revokes the order's grants; shipping stores the tracking and makes the buyer's email due", async () => {
    const { db, deps } = await setup();
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("applied");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "in_production", artelo_status: "InProduction", status_checked_at: NOW });
    expect(await activeGrants(db)).toBe(0);
    expect(await applyArteloUpdate(deps, update("Shipped", TRACKING))).toBe("applied");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "shipped", shipped_at: NOW, shipments: JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]) });
    expect(deps.waited).toHaveLength(1);
  });

  test("a lower status arriving late is ignored, but recorded as artelo's", async () => {
    const { db, deps } = await setup({ status: "shipped" });
    expect(await applyArteloUpdate(deps, update("Received"))).toBe("ignored");
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "shipped", artelo_status: "InProduction" });
  });

  test("artelo needing something sends a placed order to needs attention and emails george; after production it is ignored", async () => {
    let { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, update("PendingFulfillmentAction"))).toBe("applied");
    expect(deps.waited).toHaveLength(1);
    // The email's claim runs at once; with no binding here it is released, so wait for that before reading the row
    await Promise.all(deps.waited);
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "artelo needs something before it can print: open the order in artelo.", attention_notified_at: null });
    // A later status moves it on and clears the attention
    await db.prepare("UPDATE print_orders SET attention_notified_at = 1 WHERE id = ?").bind(ORDER).run();
    await Promise.all(deps.waited);
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("applied");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "in_production", attention_reason: null, attention_notified_at: null });
    ({ db, deps } = await setup({ status: "in_production" }));
    expect(await applyArteloUpdate(deps, update("PendingFulfillmentAction"))).toBe("ignored");
    expect((await getOrder(db, ORDER))?.status).toBe("in_production");
  });

  test("cancelled, delivered and refunded are final", async () => {
    for (const status of ["cancelled", "delivered", "refunded"]) {
      const { db, deps } = await setup({ status });
      expect(await applyArteloUpdate(deps, update("Shipped", TRACKING))).toBe("ignored");
      expect((await getOrder(db, ORDER))?.status).toBe(status);
    }
  });

  test("artelo cancelling tells george to refund, unless the order is already fully refunded, and revokes its grants", async () => {
    const mail = vi.fn(async () => ({ messageId: "m" }));
    let { db, deps } = await setup();
    deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    await issueOrderGrant(db, PHOTO_KEY, ORDER, "fixture-b-01", 3600, "https://curiousgeorge.dev", NOW);
    expect(await applyArteloUpdate(deps, update("Canceled"))).toBe("applied");
    await Promise.all(deps.waited);
    expect((await getOrder(db, ORDER))?.status).toBe("cancelled");
    expect(await activeGrants(db)).toBe(0);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: `print order ${ORDER} was cancelled by artelo`, text: `artelo cancelled order ${ORDER}. refund it in stripe.` }));
    ({ db } = await setup({ refunded_amount: 28700 }));
    mail.mockClear();
    deps = testDeps(db, { email: { send: mail } as unknown as SendEmail });
    await applyArteloUpdate(deps, update("Canceled"));
    await Promise.all(deps.waited);
    expect(mail).not.toHaveBeenCalled();
  });

  test("a needs attention this site set (a refund to cancel at artelo) isn't cleared by artelo's later statuses", async () => {
    const { db, deps } = await setup({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed." });
    expect(await applyArteloUpdate(deps, update("InProduction"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "needs_attention", attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", artelo_status: "InProduction" });
    expect(await applyArteloUpdate(deps, update("Canceled"))).toBe("applied");
    expect((await getOrder(db, ORDER))?.status).toBe("cancelled");
  });

  test("a status for an order still being placed is only recorded, so the next attempt's lookup adopts it", async () => {
    const { db, deps } = await setup({ status: "paid", artelo_order_id: null });
    expect(await applyArteloUpdate(deps, update("Received", null, ORDER))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "paid", artelo_order_id: null, artelo_status: "Received" });
  });

  test("a status this site doesn't map changes nothing but artelo's status; an unknown order is unknown", async () => {
    const { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, update("OnHold"))).toBe("ignored");
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", artelo_status: "OnHold" });
    expect(await applyArteloUpdate(deps, update("Shipped", null, "artelo-404"))).toBe("unknown");
  });

  test("the order is found by artelo's id, or failing that by ours", async () => {
    const { db, deps } = await setup();
    expect(await applyArteloUpdate(deps, update("InProduction", null, ORDER))).toBe("applied");
    expect((await getOrder(db, ORDER))?.status).toBe("in_production");
  });
});

describe("reading the webhook", () => {
  test("orderId, status and shipments at the top level or inside data; anything else can't be read", () => {
    expect(readArteloUpdate({ orderId: 12345, status: "Shipped", shipments: TRACKING })).toEqual({ orderId: "12345", status: "Shipped", shipments: [{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }] });
    expect(readArteloUpdate({ data: { orderId: "artelo-1", status: "InProduction" } })).toEqual({ orderId: "artelo-1", status: "InProduction", shipments: null });
    for (const body of [null, [], {}, { orderId: "x" }, { status: "Shipped" }, "Shipped"]) expect(readArteloUpdate(body)).toBeNull();
  });

  test("a tracking url only counts as https", () => {
    expect(readArteloUpdate({ orderId: "a", status: "Shipped", shipments: [{ carrierCode: "ups", trackingNumber: "1Z", trackingUrl: "javascript:alert(1)" }] })?.shipments).toEqual([{ carrier: "ups", number: "1Z", url: "" }]);
  });

  test("the signature is the hex hmac of the raw body, or of the body re-serialised as artelo's example signs it", async () => {
    const secret = "artelo-fixture-webhook-secret";
    const hex = async (text: string) => {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const raw = '{ "orderId": "artelo-1",  "status": "Shipped" }';
    expect(await verifyArteloSignature(secret, await hex(raw), raw)).toBe(true);
    expect(await verifyArteloSignature(secret, await hex(JSON.stringify(JSON.parse(raw))), raw)).toBe(true);
    expect(await verifyArteloSignature(secret, await hex(raw), raw.replace("Shipped", "Delivered"))).toBe(false);
    expect(await verifyArteloSignature("other", await hex(raw), raw)).toBe(false);
    for (const header of [null, "", "zz", "00"]) expect(await verifyArteloSignature(secret, header, raw)).toBe(false);
    expect(await verifyArteloSignature("", await hex(raw), raw)).toBe(false);
  });
});

describe("the poll", () => {
  test("asks artelo about orders not checked for twelve hours, 300ms apart, then applies what it says", async () => {
    const { db, deps } = await setup({ status_checked_at: NOW - 43_201 }, {
      "GET https://artelo.test/orders/get-by-id": (request) => json({ id: new URL(request.url).searchParams.get("orderId"), status: "Shipped", shipments: TRACKING }),
    });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "in_production", artelo_order_id: "artelo-2", placed_at: NOW - 50_000 });
    await insertOrder(db, { id: "01k6x00000000000000000000c", status: "placed", artelo_order_id: "artelo-3", placed_at: NOW - 3600 });
    await insertOrder(db, { id: "01k6x00000000000000000000d", status: "delivered", artelo_order_id: "artelo-4", placed_at: NOW - 90_000 });
    const pause = vi.fn(async () => {});
    await pollStatuses(deps, pause);
    expect((await getOrder(db, ORDER))?.status).toBe("shipped");
    expect((await getOrder(db, "01k6x00000000000000000000b"))?.status).toBe("shipped");
    // Placed an hour ago: not yet due; delivered: final
    expect((await getOrder(db, "01k6x00000000000000000000c"))?.status).toBe("placed");
    expect((await getOrder(db, "01k6x00000000000000000000d"))?.status).toBe("delivered");
    expect(pause.mock.calls).toEqual([[300]]);
  });

  test("a failed check leaves the order to be asked again", async () => {
    const { db, deps } = await setup({ placed_at: NOW - 50_000 }, { "GET https://artelo.test/orders/get-by-id": () => json({}, 503) });
    await pollStatuses(deps, async () => {});
    expect(await getOrder(db, ORDER)).toMatchObject({ status: "placed", status_checked_at: null });
  });
});
```

Create `tests/unit/artelo-route.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { insertOrder, printDb } from "./prints-fakes";

const env = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, PHOTO_PRINTS: {}, ARTELO_WEBHOOK_SECRET: "artelo-fixture-webhook-secret" }));
vi.mock("cloudflare:workers", () => ({ env }));
vi.stubGlobal("__TEST_HOOKS__", false);
const { POST } = await import("../../src/pages/api/prints/artelo");

const ORDER = "01k6x00000000000000000000a";
const sign = (text: string) => createHmac("sha256", "artelo-fixture-webhook-secret").update(text).digest("hex");
const call = async (body: string, signature: string | null = sign(body)) =>
  (await POST({ request: new Request("https://curiousgeorge.dev/api/prints/artelo", { method: "POST", body, headers: signature ? { "x-artelo-signature": signature } : {} }), locals: { cfContext: { waitUntil: () => {} } } } as never)) as Response;

beforeEach(async () => {
  env.DB = await printDb();
  await insertOrder(env.DB, { id: ORDER, status: "placed", artelo_order_id: "artelo-1" });
});
afterEach(() => vi.restoreAllMocks());

test("a mismatched signature answers 400 with artelo's own code, and nothing is read", async () => {
  const response = await call('{"orderId":"artelo-1","status":"Shipped"}', "00");
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "invalid_signature" });
  expect(await env.DB.prepare("SELECT status FROM print_orders").first("status")).toBe("placed");
});

test("a body past 64KB is a 413", async () => {
  expect((await call("x".repeat(64 * 1024 + 1))).status).toBe(413);
});

test("a signed update is applied and remembered as heard", async () => {
  const response = await call(JSON.stringify({ data: { orderId: "artelo-1", status: "InProduction" } }));
  expect(response.status).toBe(200);
  expect(await env.DB.prepare("SELECT status FROM print_orders").first("status")).toBe("in_production");
  expect(Number(await env.DB.prepare("SELECT value FROM print_settings WHERE key = 'artelo_webhook_at'").first("value"))).toBeGreaterThan(0);
});

test("a signed body it can't read, or for an unknown order, still answers 200 and logs only the body's keys", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect((await call(JSON.stringify({ event: "ping", secretThing: "Ada Lovelace" }))).status).toBe(200);
  expect((await call(JSON.stringify({ orderId: "artelo-404", status: "Shipped" }))).status).toBe(200);
  expect(warn.mock.calls.map((args) => args.join(" "))).toEqual([
    "prints: an artelo webhook couldn't be read; its keys: event, secretThing",
    "prints: an artelo webhook named an unknown order; its keys: orderId, status",
  ]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/artelo-status.test.ts tests/unit/artelo-route.test.ts`
Expected: FAIL, `artelo-updates.ts` and the route don't exist.

- [ ] **Step 3: Write the status rules, the signature and the poll**

Create `src/lib/prints/artelo-updates.ts`:

```ts
import { revokeOrderGrants } from "../photos/store";
import { artelo, readArteloOrder, readShipments, unwrap } from "./artelo";
import { mapStatus, PENDING_REASON } from "./artelo-status";
import type { PrintDeps } from "./config";
import { sendDueMail } from "./mail";
import { getOrder, type OrderRow, type OrderStatus, type Shipment } from "./store";
import { fromHex } from "./stripe";

// Artelo's statuses arriving by webhook or by the poll (spec 18.3). Artelo's webhook carries no timestamp, so the order
// of statuses is the guard: placed < in_production < shipped < delivered, a lower one arriving late is ignored, and
// cancelled, delivered and refunded are final. That also makes a replayed body harmless.

export interface ArteloUpdate {
  /** Artelo's id or ours: both are looked up */
  orderId: string;
  status: string;
  shipments: Shipment[] | null;
}

/** orderId, status and shipments from the top level of the body, or from a top-level data object */
export function readArteloUpdate(value: unknown): ArteloUpdate | null {
  const record = unwrap(value);
  if (!record) return null;
  const orderId = typeof record.orderId === "string" || typeof record.orderId === "number" ? String(record.orderId) : "";
  if (!orderId || typeof record.status !== "string") return null;
  return { orderId, status: record.status, shipments: readShipments(record.shipments) };
}

/** x-artelo-signature: the hex HMAC-SHA256 of the body. Artelo's example signs JSON.stringify(req.body), so either form matches */
export async function verifyArteloSignature(secret: string, header: string | null, raw: string): Promise<boolean> {
  if (!secret || !header) return false;
  const signature = fromHex(header.trim());
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const forms = [raw];
  try {
    forms.push(JSON.stringify(JSON.parse(raw)));
  } catch {
    // Not JSON: only the raw form can match
  }
  for (const form of forms) if (await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(form))) return true;
  return false;
}

/** needs_attention set by Artelo ranks with placed; an order not yet Artelo's (checkout, expired, paid) has no rank */
const RANK: Partial<Record<OrderStatus, number>> = { placed: 1, needs_attention: 1, in_production: 2, shipped: 3, delivered: 4 };
const NOT_YET_ARTELOS: ReadonlySet<OrderStatus> = new Set(["checkout", "expired", "paid"]);
const FINAL: ReadonlySet<OrderStatus> = new Set(["cancelled", "delivered", "refunded"]);
/** Once in production nothing needs the masters, and after a cancellation neither ("Decisions") */
const REVOKES: ReadonlySet<OrderStatus> = new Set(["in_production", "shipped", "delivered", "cancelled"]);

export type UpdateOutcome = "applied" | "ignored" | "unknown";

/** Applies one status to its order: D1 only, inline; any email goes out after the answer, in waitUntil */
export async function applyArteloUpdate(deps: PrintDeps, update: ArteloUpdate): Promise<UpdateOutcome> {
  const { db } = deps;
  const order = (await db.prepare("SELECT * FROM print_orders WHERE artelo_order_id = ?").bind(update.orderId).first<OrderRow>()) ?? (await getOrder(db, update.orderId));
  if (!order) return "unknown";
  const now = deps.now();
  const target = mapStatus(update.status);
  const current = RANK[order.status] ?? -1;
  const record = () => db.prepare("UPDATE print_orders SET artelo_status = ?, status_checked_at = ?, updated_at = ? WHERE id = ?").bind(update.status, now, now, order.id).run();
  if (!target || FINAL.has(order.status)) {
    await record();
    if (!target) console.log("prints: artelo sent order", order.id, "a status this site doesn't map:", update.status);
    return "ignored";
  }
  // Still being placed (an answer lost, say): only recorded, so placement's next lookup adopts the order properly rather
  // than leaving it placed with no Artelo id, where neither placement nor the poll would ever look at it again
  if (NOT_YET_ARTELOS.has(order.status)) {
    await record();
    return "ignored";
  }
  // A needs_attention this site set (a refund to cancel at Artelo, say) isn't Artelo's to clear: only needs_attention set
  // by Artelo ranks with placed (spec 18.3). A cancellation still ends it
  if (order.status === "needs_attention" && order.attention_reason !== PENDING_REASON && target !== "cancelled") {
    await record();
    return "ignored";
  }
  if (target === "cancelled") {
    // George's email is due unless the buyer is already refunded in full; it is sent and retried like the others (spec 18.4)
    await db
      .prepare("UPDATE print_orders SET status = 'cancelled', attention_reason = NULL, artelo_status = ?, status_checked_at = ?, lease_until = NULL, admin_notified_at = CASE WHEN COALESCE(refunded_amount, 0) < print_total + delivery_amount THEN 0 ELSE NULL END, updated_at = ? WHERE id = ?")
      .bind(update.status, now, now, order.id)
      .run();
    await revokeOrderGrants(db, order.id, now);
    deps.waitUntil(sendDueMail(deps));
    return "applied";
  }
  if (target === "needs_attention") {
    if (current >= 2 || order.status === "needs_attention") {
      await record();
      return "ignored";
    }
    await db.prepare("UPDATE print_orders SET status = 'needs_attention', attention_reason = ?, attention_notified_at = NULL, artelo_status = ?, status_checked_at = ?, updated_at = ? WHERE id = ?").bind(PENDING_REASON, update.status, now, now, order.id).run();
    deps.waitUntil(sendDueMail(deps));
    return "applied";
  }
  if ((RANK[target] ?? 0) <= current) {
    await record();
    return "ignored";
  }
  const shipments = update.shipments && update.shipments.length > 0 ? JSON.stringify(update.shipments) : null;
  await db
    .prepare("UPDATE print_orders SET status = ?, attention_reason = NULL, attention_notified_at = NULL, artelo_status = ?, shipments = COALESCE(?, shipments), shipped_at = CASE WHEN ? = 'shipped' THEN ? ELSE shipped_at END, status_checked_at = ?, updated_at = ? WHERE id = ?")
    .bind(target, update.status, shipments, target, now, now, now, order.id)
    .run();
  if (REVOKES.has(target)) await revokeOrderGrants(db, order.id, now);
  if (target === "shipped") deps.waitUntil(sendDueMail(deps));
  return "applied";
}

/** An order is polled when its last check, or its placement, is this old */
export const POLL_AFTER = 12 * 3600;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The cron's fourth step: Artelo deletes a webhook after 20 failed deliveries, so ask (at most 20, 300ms apart; Artelo allows 50 in 10 seconds) */
export async function pollStatuses(deps: PrintDeps, pause: (ms: number) => Promise<void> = sleep): Promise<void> {
  const { results } = await deps.db
    .prepare("SELECT id, artelo_order_id FROM print_orders WHERE artelo_order_id IS NOT NULL AND status IN ('placed', 'in_production', 'shipped', 'needs_attention') AND COALESCE(status_checked_at, placed_at, 0) < ? ORDER BY COALESCE(status_checked_at, placed_at, 0), id LIMIT 20")
    .bind(deps.now() - POLL_AFTER)
    .all();
  for (const [index, row] of (results as unknown as { id: string; artelo_order_id: string }[]).entries()) {
    if (index > 0) await pause(300);
    const result = await artelo(deps, "GET", `/orders/get-by-id?orderId=${encodeURIComponent(row.artelo_order_id)}`);
    const found = result.ok ? readArteloOrder(result.body) : null;
    if (!found?.status) {
      console.error("prints: couldn't check order", row.id, "at artelo:", result.ok ? "an unreadable answer" : (result.status ?? "no answer"));
      continue;
    }
    await applyArteloUpdate(deps, { orderId: row.artelo_order_id, status: found.status, shipments: found.shipments });
  }
}
```

Create `src/pages/api/prints/artelo.ts`:

```ts
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { applyArteloUpdate, readArteloUpdate, verifyArteloSignature } from "../../../lib/prints/artelo-updates";
import { printDeps } from "../../../lib/prints/config";
import { jsonAnswer, readCapped } from "../../../lib/prints/http";
import { writeSetting } from "../../../lib/prints/store";

// Artelo's webhook (spec 18.3): the signature before anything is read. A signed body always answers 200, so Artelo
// never retries twenty times and deletes the webhook over an order it can't match; such a body logs only its keys
export const POST: APIRoute = async ({ request, locals }) => {
  const deps = printDeps(env, (promise) => locals.cfContext.waitUntil(promise));
  const raw = await readCapped(request, 64 * 1024);
  if (raw === "big") return jsonAnswer({ code: "too_large" }, 413);
  if (raw === null || !(await verifyArteloSignature(deps.config.secrets.ARTELO_WEBHOOK_SECRET, request.headers.get("x-artelo-signature"), raw))) return jsonAnswer({ code: "invalid_signature" }, 400);
  await writeSetting(deps.db, "artelo_webhook_at", String(deps.now()), deps.now());
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).join(", ") : "none";
  const update = readArteloUpdate(body);
  if (!update) {
    console.warn("prints: an artelo webhook couldn't be read; its keys:", keys);
    return jsonAnswer({ received: true }, 200);
  }
  if ((await applyArteloUpdate(deps, update)) === "unknown") console.warn("prints: an artelo webhook named an unknown order; its keys:", keys);
  return jsonAnswer({ received: true }, 200);
};
```

In `src/lib/prints/cron.ts`, add `import { pollStatuses } from "./artelo-updates";` and add this step after the unsent emails in `cronSteps`:

```ts
    ["artelo statuses", () => pollStatuses(deps)],
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/artelo-status.test.ts tests/unit/artelo-route.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 5: Teach the stand-in to report and send statuses**

In `tests/fixtures/artelo-site.mjs`, add above the line `// Routes added by later tasks go above this line`:

```js
// Statuses: Get Order by Id for the poll, /__ship to sign and deliver an OrderStatusChange as Artelo would (wrap puts it
// in a data object), and /__status to change an order quietly, as a webhook Artelo never delivered would
const shippedTracking = [{ carrierCode: "UPS", trackingNumber: "1Z999AA10123456784", trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }];
function setStatus(found, status) {
  found.status = status;
  if (status === "Shipped") found.shipments = shippedTracking;
}
route("GET", "/orders/get-by-id", ({ url, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const found = artelo.orders.find((entry) => entry.id === url.searchParams.get("orderId"));
  return found ? [200, { id: found.id, orderId: found.orderId, status: found.status, shipments: found.shipments }] : [404, { message: "no such order" }];
});
route("POST", "/__ship", async ({ body }) => {
  const { site, order, status = "Shipped", wrap = false } = JSON.parse(body);
  const found = artelo.orders.find((entry) => entry.orderId === order);
  if (!found) return [404, { message: "no such order" }];
  setStatus(found, status);
  const payload = { orderId: found.id, status, shipments: found.shipments };
  const text = JSON.stringify(wrap ? { data: payload } : payload);
  const response = await fetch(`${site}/api/prints/artelo`, { method: "POST", body: text, headers: { "content-type": "application/json", "x-artelo-signature": sign(FIXTURE_SECRETS.ARTELO_WEBHOOK_SECRET, text) } });
  received.webhooks.push({ order, status, answered: response.status });
  return [200, { answered: response.status }];
});
route("POST", "/__status", ({ body }) => {
  const { order, status } = JSON.parse(body);
  const found = artelo.orders.find((entry) => entry.orderId === order);
  if (!found) return [404, { message: "no such order" }];
  setStatus(found, status);
  return [204, ""];
});
```

- [ ] **Step 6: Write the e2e helpers and specs**

Append to `tests/e2e/prints.ts`:

```ts
/** An order taken all the way to placed through the stand-ins: checkout, payment, Stripe's event, Artelo's order */
export async function placedOrder(page: Page, name: string, site = PRINTS, store = ".wrangler/prints"): Promise<string> {
  const { orderId, sessionId } = await checkoutOrder(page, name, TWO_PRINTS, site);
  const { event } = await payAtStandIn(sessionId);
  if ((await deliverStripe(site, event)) !== 200) throw new Error("stripe's event wasn't taken");
  await waitForStatus(orderId, "placed", store);
  return orderId;
}

/** Artelo's signed OrderStatusChange for this order, delivered to the site; the site's answer */
export async function ship(site: string, orderId: string, status = "Shipped", wrap = false): Promise<number> {
  return (await standIn<{ answered: number }>("/__ship", { method: "POST", body: JSON.stringify({ site, order: orderId, status, wrap }) })).answered;
}
```

Append to `tests/e2e/prints-order.spec.ts`, adding `placedOrder` and `ship` to its `./prints` import and `STAND_IN` to its `./prints-site` import:

```ts
test("artelo's signed shipped status stores the tracking, revokes the master links and emails the buyer once", async ({ page }) => {
  await asTestClient(page);
  const orderId = await placedOrder(page, `Ada ${unique()}`);
  expect(printsD1(`SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = '${orderId}' AND revoked_at IS NULL`)).toEqual([{ n: 2 }]);
  expect(await ship(PRINTS, orderId, "Shipped", true)).toBe(200);
  await waitForStatus(orderId, "shipped");
  expect(printsD1<{ shipments: string }>(`SELECT shipments FROM print_orders WHERE id = '${orderId}'`)[0].shipments).toBe(JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]));
  expect(printsD1(`SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = '${orderId}' AND revoked_at IS NULL`)).toEqual([{ n: 0 }]);
  // A replay of the same body changes nothing
  expect(await ship(PRINTS, orderId, "Shipped")).toBe(200);
  await expect.poll(async () => (await mailFor(orderId)).filter((mail) => mail.subject === "your prints are on their way").length).toBe(1);
  const [mail] = (await mailFor(orderId)).filter((entry) => entry.subject === "your prints are on their way");
  expect(mail.to).toBe("buyer@example.com");
  expect(mail.text).toContain("tracking: ups 1Z999AA10123456784 https://www.ups.com/track?tracknum=1Z999AA10123456784");
});

test("a status artelo's webhook never delivered is caught by the twelve-hourly poll", async ({ page }) => {
  await asTestClient(page);
  const orderId = await placedOrder(page, `Ada ${unique()}`);
  await fetch(`${STAND_IN}/__status`, { method: "POST", body: JSON.stringify({ order: orderId, status: "InProduction" }) });
  printsD1(`UPDATE print_orders SET placed_at = placed_at - 50000 WHERE id = '${orderId}'`);
  await runCron();
  await waitForStatus(orderId, "in_production");
});
```

- [ ] **Step 7: Build and run the e2e specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-order.spec.ts`
Expected: every test passing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/prints/artelo-updates.ts src/pages/api/prints/artelo.ts src/lib/prints/cron.ts tests/fixtures/artelo-site.mjs tests/e2e/prints.ts tests/e2e/prints-order.spec.ts tests/unit/artelo-status.test.ts tests/unit/artelo-route.test.ts
git commit -m "feat: artelo's webhook and the twelve-hourly poll move orders forward, store tracking and revoke master links"
```

---

### Task 12: the admin's print orders section

Spec 1.2 step 12 (section 20): a third new section, `orders`, after `links`: whether prints are open and why not, the exchange rate and its date, whether Artelo's webhook is heard; the delivery buffer as a whole-number percent from 0 to 20 (no deploy needed); the latest 100 orders with `needs attention` first, each line saying what George needs (prints, amounts, status word, test, refunds, Artelo's id and cost, tracking); `retry now` on an attention order Artelo doesn't have, which resets the 24-hour window and places it in `waitUntil`; and a `refund in stripe ›` link. It purges nothing.

**Files:**
- Create: `src/lib/prints/admin.ts`, `src/components/admin/OrdersAdmin.astro`, `tests/unit/orders-admin.test.ts`, `tests/e2e/prints-admin.spec.ts`
- Modify: `src/lib/admin/actions.ts`, `src/lib/admin/validate.ts`, `src/lib/admin/submit.ts`, `src/pages/admin/index.astro`, `src/styles/admin.css`, `tests/unit/submit.test.ts`
- Test: `tests/unit/orders-admin.test.ts`, `tests/unit/submit.test.ts`, `tests/unit/actions.test.ts` (unchanged, must pass), `tests/e2e/prints-admin.spec.ts`, `tests/e2e/admin-layout.spec.ts` (unchanged, must pass)

**Interfaces:**
- Consumes: `PrintConfig`, `printConfig`, `printDeps` (Task 1); `Tier`, `Frame` (Task 2); `SETTINGS_SQL`, `toSettings`, `shipmentsOf`, `writeSetting`, `OrderRow`, `OrderStatus`, `Shipment` (Task 3); `countryName` (Task 4); `printsStatus`, `PrintsStatus` (Task 5); `aud`, `usd`, `rateText` (Task 2); `placeOrder` (Task 9); `formState`, `Field.astro`, `readFields`, `Checked`, `Fields` (existing admin).
- Produces (`src/lib/prints/admin.ts`): `interface AdminOrderLine { photoId: string; tier: Tier; frame: Frame; quantity: number }`; `interface AdminOrder { id; paidAt: number | null; lines: AdminOrderLine[]; country: string; printTotal: number; deliveryAmount: number; status: OrderStatus; reason: string | null; livemode: boolean; refundedAmount: number | null; arteloId: string | null; arteloCost: number | null; shipments: Shipment[]; paymentIntent: string | null }`; `interface OrdersAdmin { status: PrintsStatus; rate: number | null; rateDate: string | null; stale: boolean; webhookAt: number | null; webhookMissing: boolean; buffer: number; orders: AdminOrder[] }`; `loadOrdersAdmin(db, config, now): Promise<OrdersAdmin>`; `STATUS_WORDS: Record<OrderStatus, string>`; `stamp(seconds: number): string` (`08.10.26 14:02`, Sydney)
- Produces (`src/lib/admin/validate.ts`): `BUFFER_FIELDS`; `checkBuffer(fields): Checked<number>` (a whole percent)
- Produces (`src/lib/admin/actions.ts`): `AdminSection` gains `"orders"`; `ActionDeps.orders?: { placeLater(orderId: string): void; retryWindow: number }`; the ok `ActionResult` gains `note?: "retry"`; intents `prints.buffer` and `order.retry`
- Produces (`src/lib/admin/submit.ts`): a save with a note redirects to `/admin/?saved=<section>&note=<note>#<section>`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/orders-admin.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import OrdersAdmin from "../../src/components/admin/OrdersAdmin.astro";
import { runAction, type ActionDeps } from "../../src/lib/admin/actions";
import { loadOrdersAdmin, stamp } from "../../src/lib/prints/admin";
import { getOrder, readSettings } from "../../src/lib/prints/store";
import { insertOrder, NOW, printDb, testConfig } from "./prints-fakes";
import { render, text } from "./render";

const ORDER = "01k6x00000000000000000000a";
const formOf = (entries: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.append(name, value);
  return form;
};
const depsOf = (db: D1Database, placeLater = vi.fn()): ActionDeps & { orders: { placeLater: ReturnType<typeof vi.fn>; retryWindow: number } } => ({ db, media: {} as R2Bucket, images: {} as ImagesBinding, orders: { placeLater, retryWindow: 86_400 } });

afterEach(() => vi.restoreAllMocks());

describe("the orders section's actions", () => {
  test("the buffer saves a whole percent from 0 to 20 as a share", async () => {
    const db = await printDb();
    expect(await runAction(formOf({ intent: "prints.buffer", buffer: "12" }), depsOf(db))).toEqual({ ok: true, section: "orders" });
    expect((await readSettings(db)).buffer).toBe(0.12);
    expect(await runAction(formOf({ intent: "prints.buffer", buffer: "0" }), depsOf(db))).toEqual({ ok: true, section: "orders" });
    for (const buffer of ["21", "-1", "8.5", "", "eight"]) {
      expect(await runAction(formOf({ intent: "prints.buffer", buffer }), depsOf(db))).toEqual({ ok: false, section: "orders", form: "buffer", errors: { buffer: "a whole number from 0 to 20" }, values: { buffer } });
    }
    expect((await readSettings(db)).buffer).toBe(0);
  });

  test("retry now sets an attention order back to paid with a fresh day and places it in the background", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", attention_reason: "artelo didn't take the order within a day: artelo answered 503", attempts: 8, attention_notified_at: 1, lease_until: 5 });
    const deps = depsOf(db);
    const before = Math.floor(Date.now() / 1000);
    expect(await runAction(formOf({ intent: "order.retry", id: ORDER }), deps)).toEqual({ ok: true, section: "orders", note: "retry" });
    const order = (await getOrder(db, ORDER))!;
    expect(order).toMatchObject({ status: "paid", attempts: 0, attention_reason: null, attention_notified_at: null, lease_until: null });
    expect(order.retry_until! - order.next_attempt_at!).toBe(86_400);
    expect(order.next_attempt_at).toBeGreaterThanOrEqual(before);
    expect(deps.orders.placeLater).toHaveBeenCalledWith(ORDER);
    // A repeat counts as saved, and starts nothing new
    expect(await runAction(formOf({ intent: "order.retry", id: ORDER }), deps)).toEqual({ ok: true, section: "orders", note: "retry" });
    expect(deps.orders.placeLater).toHaveBeenCalledTimes(1);
  });

  test("an order artelo already has, or one that isn't stuck, can't be retried from here; an unknown one is gone", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention", artelo_order_id: "artelo-1" });
    expect(await runAction(formOf({ intent: "order.retry", id: ORDER }), depsOf(db))).toEqual({ ok: false, section: "orders", form: `order-${ORDER}`, errors: { form: "that order can't be retried from here." }, values: {} });
    expect(await runAction(formOf({ intent: "order.retry", id: "01k6x0000000000000000000zz" }), depsOf(db))).toEqual({ ok: false, section: null, form: "", errors: { form: "that order no longer exists" }, values: {} });
    expect(await runAction(formOf({ intent: "order.retry", id: "../x" }), depsOf(db))).toMatchObject({ ok: false, errors: { form: "that order no longer exists" } });
  });
});

describe("loadOrdersAdmin", () => {
  test("needs attention first, then newest paid; checkout and expired orders left out; lines in order", async () => {
    const db = await printDb();
    await insertOrder(db, { id: "01k6x00000000000000000000a", status: "placed", paid_at: NOW - 100, artelo_order_id: "artelo-1", artelo_cost: 6140 });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "needs_attention", attention_reason: "artelo refused the order: unknown size", paid_at: NOW - 900 });
    await insertOrder(db, { id: "01k6x00000000000000000000c", status: "shipped", paid_at: NOW - 50, livemode: 1, refunded_amount: 4900, shipments: JSON.stringify([{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }]) });
    await insertOrder(db, { id: "01k6x00000000000000000000d", status: "checkout", paid_at: null });
    await insertOrder(db, { id: "01k6x00000000000000000000e", status: "expired", paid_at: null });
    const data = await loadOrdersAdmin(db, testConfig(), NOW);
    expect(data.orders.map((order) => order.id)).toEqual(["01k6x00000000000000000000b", "01k6x00000000000000000000c", "01k6x00000000000000000000a"]);
    expect(data.orders[1]).toMatchObject({ status: "shipped", livemode: true, refundedAmount: 4900, shipments: [{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }], paymentIntent: "pi_test_01k6x00000000000000000000c" });
    expect(data.orders[2].lines).toEqual([{ photoId: "fixture-b-01", tier: "medium", frame: "oak", quantity: 1 }, { photoId: "fixture-b-02", tier: "small", frame: "unframed", quantity: 1 }]);
    expect(data).toMatchObject({ status: { open: true }, rate: 1.5, rateDate: "2026-10-07", stale: false, webhookAt: null, webhookMissing: false, buffer: 0.08 });
  });

  test("a rate older than a week is stale; no rate closes prints", async () => {
    const db = await printDb();
    expect((await loadOrdersAdmin(db, testConfig(), NOW + 8 * 86_400)).stale).toBe(true);
    await db.prepare("DELETE FROM print_settings WHERE key = 'usd_aud'").run();
    expect((await loadOrdersAdmin(db, testConfig(), NOW)).status).toEqual({ open: false, reason: "no exchange rate has been fetched yet" });
  });

  test("time stamps read in sydney, either side of daylight saving", () => {
    // 03:02 UTC on 8 October 2026 is 14:02 in Sydney (AEDT); 04:02 UTC on 8 June is 14:02 (AEST)
    expect(stamp(Date.UTC(2026, 9, 8, 3, 2) / 1000)).toBe("08.10.26 14:02");
    expect(stamp(Date.UTC(2026, 5, 8, 4, 2) / 1000)).toBe("08.06.26 14:02");
  });
});

describe("the orders section", () => {
  const base = async () => {
    const db = await printDb();
    await insertOrder(db, { id: "01k6x00000000000000000000a", status: "needs_attention", attention_reason: "artelo didn't take the order within a day: artelo answered 503", paid_at: Date.UTC(2026, 9, 8, 3, 2) / 1000 });
    await insertOrder(db, { id: "01k6x00000000000000000000b", status: "shipped", livemode: 1, artelo_order_id: "48213", artelo_cost: 6140, refunded_amount: 4900, stripe_payment_intent: "pi_live_1", shipments: JSON.stringify([{ carrier: "ups", number: "1Z999", url: "https://www.ups.com/track?tracknum=1Z999" }]) });
    await insertOrder(db, { id: "01k6x00000000000000000000c", status: "needs_attention", artelo_order_id: "48214", attention_reason: "artelo needs something before it can print: open the order in artelo.", paid_at: NOW - 200_000 });
    return loadOrdersAdmin(db, testConfig(), NOW);
  };

  test("the status lines first: open or why not, the rate, the webhook", async () => {
    let doc = await render(OrdersAdmin, { data: await base(), failure: null });
    expect([...doc.querySelectorAll(".orders-status li")].map(text)).toEqual(["prints are open", "us$1 = a$1.50 · ecb rate of 07.10.26", "artelo webhook: not heard from yet"]);
    const closed = { ...(await base()), status: { open: false as const, reason: 'PRINTS_OPEN isn\'t "true"' }, stale: true, webhookMissing: true };
    doc = await render(OrdersAdmin, { data: closed, failure: null });
    expect([...doc.querySelectorAll(".orders-status li")].map(text)).toEqual(['prints are closed: PRINTS_OPEN isn\'t "true"', "us$1 = a$1.50 · ecb rate of 07.10.26 - older than a week, check the rate job", "artelo webhook: missing - run bun run prints:webhook --remote"]);
    doc = await render(OrdersAdmin, { data: { ...(await base()), webhookAt: Date.UTC(2026, 9, 8, 3, 2) / 1000 }, failure: null });
    expect(text(doc.querySelectorAll(".orders-status li")[2])).toBe("artelo webhook: connected · last heard 08.10.26 14:02");
  });

  test("the buffer form shows the current percent and its hint", async () => {
    const doc = await render(OrdersAdmin, { data: await base(), failure: null });
    const form = doc.querySelector("form#buffer")!;
    expect(form.querySelector('input[name="intent"]')!.getAttribute("value")).toBe("prints.buffer");
    expect(form.querySelector('input[name="buffer"]')!.getAttribute("value")).toBe("8");
    expect(text(form.querySelector(".hint"))).toBe("added to artelo's delivery cost for exchange-rate movement. it applies to the next quote.");
  });

  test("each order says what george needs, attention first with its reason and a red dot", async () => {
    const doc = await render(OrdersAdmin, { data: await base(), failure: null });
    // Attention first (the newer paid first), then the rest
    const [stuck, held, shipped] = [...doc.querySelectorAll(".orders-admin > li")];
    expect(stuck.classList.contains("attention")).toBe(true);
    expect(stuck.querySelector(".attention-dot")).not.toBeNull();
    expect(text(stuck.querySelector(".order-line"))).toBe("08.10.26 14:02 · 01k6x00000000000000000000a");
    expect(text(stuck.querySelector(".order-prints"))).toBe("2 prints: fixture-b-01 medium oak, fixture-b-02 small unframed");
    expect(stuck.querySelector('.order-prints a[href="/photos/fixture-b-01"]')).not.toBeNull();
    expect(text(stuck.querySelector(".order-sums"))).toBe("to au · $238 + $49 = $287 · needs attention · test");
    expect(text(stuck.querySelector(".reason"))).toBe("artelo didn't take the order within a day: artelo answered 503");
    expect(stuck.querySelector('form input[name="intent"][value="order.retry"]')).not.toBeNull();
    expect(text(shipped.querySelector(".order-sums"))).toBe("to au · $238 + $49 = $287 · shipped · refunded $49 · artelo 48213 us$61.40");
    expect(shipped.querySelector(".order-tracking a")!.getAttribute("href")).toBe("https://www.ups.com/track?tracknum=1Z999");
    expect(text(shipped.querySelector(".order-tracking a"))).toBe("ups 1Z999");
    expect(shipped.querySelector("form")).toBeNull();
    // Artelo has it: no retry, open it there instead
    expect(held.querySelector("form")).toBeNull();
    expect(text(held.querySelector(".open-in-artelo"))).toBe("open it in artelo (order 48214)");
  });

  test("refunds happen in stripe: a link per paid order, to test or live, in a new tab", async () => {
    const doc = await render(OrdersAdmin, { data: await base(), failure: null });
    const links = [...doc.querySelectorAll(".refund")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://dashboard.stripe.com/test/payments/pi_test_01k6x00000000000000000000a",
      "https://dashboard.stripe.com/test/payments/pi_test_01k6x00000000000000000000c",
      "https://dashboard.stripe.com/payments/pi_live_1",
    ]);
    expect(links.every((a) => a.getAttribute("target") === "_blank" && a.getAttribute("rel") === "noopener noreferrer")).toBe(true);
    expect(text(doc.querySelector(".orders-hint"))).toBe("refunds happen in stripe. a refund doesn't cancel the artelo order, and an artelo cancellation doesn't refund the buyer; a full refund of a placed order shows here as needs attention until it's cancelled in artelo.");
  });

  test("no orders, and an unreadable section, each say so", async () => {
    const db = await printDb();
    expect(text((await render(OrdersAdmin, { data: await loadOrdersAdmin(db, testConfig(), NOW), failure: null })).querySelector(".empty"))).toBe("no print orders yet.");
    expect(text((await render(OrdersAdmin, { data: null, failure: null })).querySelector(".empty"))).toBe("orders aren't loading right now. try again in a bit.");
  });
});
```

Append to `tests/unit/submit.test.ts`, inside `describe("submitForm", …)`:

```ts
  test("a retry redirects to the orders section with its note, purging nothing", async () => {
    await db.prepare("INSERT INTO print_orders (id, country, print_total, delivery_amount, status, livemode, created_at, updated_at) VALUES ('01k6x00000000000000000000a', 'AU', 1, 1, 'needs_attention', 0, 1, 1)").run();
    const purge = cache();
    const placeLater = vi.fn();
    const outcome = await submitForm(formOf({ intent: "order.retry", id: "01k6x00000000000000000000a" }), { ...deps(), orders: { placeLater, retryWindow: 86_400 } }, purge, waiter().waitUntil);
    expect(outcome).toEqual({ redirect: "/admin/?saved=orders&note=retry#orders" });
    expect(purge.invalidate).not.toHaveBeenCalled();
    expect(placeLater).toHaveBeenCalledWith("01k6x00000000000000000000a");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/orders-admin.test.ts tests/unit/submit.test.ts`
Expected: FAIL, the section, its loader and the two intents don't exist.

- [ ] **Step 3: Write the section's loader**

Create `src/lib/prints/admin.ts`:

```ts
import type { Frame, Tier } from "./catalogue";
import type { PrintConfig } from "./config";
import { printsStatus, type PrintsStatus } from "./open";
import { SETTINGS_SQL, shipmentsOf, toSettings, type OrderRow, type OrderStatus, type Shipment } from "./store";

// The admin's orders section (spec 20): the state of prints, then the latest orders, needs_attention first

export interface AdminOrderLine {
  photoId: string;
  tier: Tier;
  frame: Frame;
  quantity: number;
}

export interface AdminOrder {
  id: string;
  paidAt: number | null;
  lines: AdminOrderLine[];
  country: string;
  printTotal: number;
  deliveryAmount: number;
  status: OrderStatus;
  reason: string | null;
  livemode: boolean;
  refundedAmount: number | null;
  arteloId: string | null;
  /** US cents */
  arteloCost: number | null;
  shipments: Shipment[];
  paymentIntent: string | null;
}

export interface OrdersAdmin {
  status: PrintsStatus;
  rate: number | null;
  rateDate: string | null;
  /** The rate is over a week old: the rate job needs a look */
  stale: boolean;
  webhookAt: number | null;
  webhookMissing: boolean;
  buffer: number;
  orders: AdminOrder[];
}

export const STATUS_WORDS: Record<OrderStatus, string> = {
  checkout: "at checkout", expired: "expired", paid: "waiting to place", needs_attention: "needs attention", placed: "with artelo",
  in_production: "printing", shipped: "shipped", delivered: "delivered", cancelled: "cancelled", refunded: "refunded",
};

const LISTED = "SELECT * FROM print_orders WHERE status NOT IN ('checkout', 'expired') ORDER BY (status = 'needs_attention') DESC, paid_at DESC, id DESC LIMIT 100";

/** Everything the section shows, in one batch */
export async function loadOrdersAdmin(db: D1Database, config: PrintConfig, now: number): Promise<OrdersAdmin> {
  const [settingRows, orderRows, itemRows] = await db.batch([
    db.prepare(SETTINGS_SQL),
    db.prepare(LISTED),
    db.prepare(`SELECT order_id, line, photo_id, tier, frame, quantity FROM print_order_items WHERE order_id IN (SELECT id FROM (${LISTED})) ORDER BY order_id, line`),
  ]);
  const settings = toSettings(settingRows.results as unknown as { key: string; value: string }[]);
  const lines = new Map<string, AdminOrderLine[]>();
  for (const row of itemRows.results as unknown as { order_id: string; photo_id: string; tier: Tier; frame: Frame; quantity: number }[]) {
    lines.set(row.order_id, [...(lines.get(row.order_id) ?? []), { photoId: row.photo_id, tier: row.tier, frame: row.frame, quantity: row.quantity }]);
  }
  return {
    status: printsStatus(config, settings.rate),
    rate: settings.rate,
    rateDate: settings.rateDate,
    stale: settings.rateDate !== null && Date.parse(`${settings.rateDate}T00:00:00Z`) / 1000 < now - 7 * 86_400,
    webhookAt: settings.arteloWebhookAt,
    webhookMissing: settings.webhookMissing,
    buffer: settings.buffer,
    orders: (orderRows.results as unknown as OrderRow[]).map((row) => ({
      id: row.id, paidAt: row.paid_at, lines: lines.get(row.id) ?? [], country: row.country, printTotal: row.print_total, deliveryAmount: row.delivery_amount,
      status: row.status, reason: row.attention_reason, livemode: row.livemode === 1, refundedAmount: row.refunded_amount, arteloId: row.artelo_order_id,
      arteloCost: row.artelo_cost, shipments: shipmentsOf(row), paymentIntent: row.stripe_payment_intent,
    })),
  };
}

let sydney: Intl.DateTimeFormat | undefined;

/** A time in Sydney as the admin writes it: 08.10.26 14:02 */
export function stamp(seconds: number): string {
  sydney ??= new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const part = Object.fromEntries(sydney.formatToParts(new Date(seconds * 1000)).map((entry) => [entry.type, entry.value]));
  return `${part.day}.${part.month}.${part.year} ${part.hour}:${part.minute}`;
}
```

- [ ] **Step 4: Add the two intents**

In `src/lib/admin/validate.ts`, append:

```ts
// Print orders (spec 20)

export const BUFFER_FIELDS = ["buffer"] as const;

/** The delivery buffer as a whole percent from 0 to 20 */
export function checkBuffer(fields: Fields): Checked<number> {
  const errors: Fields = {};
  if (!/^\d{1,2}$/.test(fields.buffer) || Number(fields.buffer) > 20) errors.buffer = "a whole number from 0 to 20";
  return finish(errors, () => Number(fields.buffer));
}
```

In `src/lib/admin/actions.ts`:

- add `import { writeSetting } from "../prints/store";` beside the other imports, and add `BUFFER_FIELDS` and `checkBuffer` to the `./validate` import list;
- replace the `AdminSection` line with:

```ts
export type AdminSection = "now" | "before" | "log" | "lately" | "records" | "snapshots" | "photographs" | "links" | "orders";
```

- add to `ActionDeps`, after `origin?: string;`:

```ts
  /** Print orders (spec 20): retry now places in the background, with a fresh window of this many seconds */
  orders?: { placeLater(orderId: string): void; retryWindow: number };
```

- replace the `ActionResult` line with:

```ts
/** `purge`: cache tags this save purges beyond its section's own (a hidden photograph's previews); `note`: which saved line to show */
export type ActionResult = { ok: true; section: AdminSection; issued?: IssuedLink; purge?: string[]; note?: "retry" } | ActionFailure;
```

- replace the `gone` line with:

```ts
const gone = (what: "line" | "entry" | "record" | "post" | "photo" | "link" | "order") => fail(null, "", { form: `that ${what} no longer exists` });
```

- add these two cases to `runAction`'s switch, before `default:`:

```ts
    case "prints.buffer":
      return saveBuffer(form, deps);
    case "order.retry":
      return retryOrder(form, deps);
```

- append at the end of the file:

```ts
// Print orders (spec 20)

/** A lowercase ULID: an order's id */
const ORDER_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;

async function saveBuffer(form: FormData, { db }: ActionDeps): Promise<ActionResult> {
  const fields = readFields(form, BUFFER_FIELDS);
  const checked = checkBuffer(fields);
  if (!checked.ok) return fail("orders", "buffer", checked.errors, fields);
  // It applies to the next quote; a quote already sealed keeps its own (spec 16.2)
  await writeSetting(db, "delivery_buffer", String(checked.value / 100), Math.floor(Date.now() / 1000));
  return { ok: true, section: "orders" };
}

/** retry now (spec 20): only an attention order Artelo doesn't have; safe against duplicates, because every attempt looks first */
async function retryOrder(form: FormData, { db, orders }: ActionDeps): Promise<ActionResult> {
  const id = String(form.get("id") ?? "");
  if (!ORDER_ID.test(id)) return gone("order");
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare("UPDATE print_orders SET status = 'paid', attempts = 0, retry_until = ?, next_attempt_at = ?, lease_until = NULL, attention_reason = NULL, attention_notified_at = NULL, updated_at = ? WHERE id = ? AND status = 'needs_attention' AND artelo_order_id IS NULL")
    .bind(now + (orders?.retryWindow ?? 86_400), now, now, id)
    .run();
  if (result.meta.changes > 0) {
    orders?.placeLater(id);
    return { ok: true, section: "orders", note: "retry" };
  }
  const row = await db.prepare("SELECT status FROM print_orders WHERE id = ?").bind(id).first<{ status: string }>();
  if (!row) return gone("order");
  // Already set going by an earlier tap counts as saved (ADR-0012)
  if (row.status === "paid") return { ok: true, section: "orders", note: "retry" };
  return fail("orders", `order-${id}`, { form: "that order can't be retried from here." });
}
```

In `src/lib/admin/submit.ts`, add `orders: [],` after `links: [],` in `PURGES`, and replace the redirect line with:

```ts
      return { redirect: `/admin/?saved=${result.section}${result.note ? `&note=${result.note}` : ""}${purged ? "" : "&later=1"}#${result.section}` };
```

- [ ] **Step 5: Write the section and wire it into the page**

Create `src/components/admin/OrdersAdmin.astro`:

```astro
---
import Field from "./Field.astro";
import { formState } from "../../lib/admin/form-state";
import type { ActionFailure } from "../../lib/admin/actions";
import { STATUS_WORDS, stamp, type OrdersAdmin } from "../../lib/prints/admin";
import { aud, rateText, usd } from "../../lib/prints/money";
import { formatLogDate } from "../../lib/text";

// The print orders section (spec 20): the state of prints, the buffer, then the orders. It purges nothing
interface Props {
  data: OrdersAdmin | null;
  failure: ActionFailure | null;
}

const { data, failure } = Astro.props;
const buffer = formState(failure, "buffer", { buffer: data ? String(Math.round(data.buffer * 100)) : "8" });
const frameWord = (frame: string) => (frame === "oak" ? "oak" : "unframed");
---
{data === null ? (
  <p class="empty">orders aren't loading right now. try again in a bit.</p>
) : (
  <>
    <ul class="orders-status">
      <li>{data.status.open ? "prints are open" : `prints are closed: ${data.status.reason}`}</li>
      <li>{data.rate === null ? "no exchange rate yet" : `us$1 = ${rateText(data.rate)}${data.rateDate ? ` · ecb rate of ${formatLogDate(data.rateDate, "day")}` : ""}${data.stale ? " - older than a week, check the rate job" : ""}`}</li>
      <li>{data.webhookMissing ? "artelo webhook: missing - run bun run prints:webhook --remote" : data.webhookAt !== null ? `artelo webhook: connected · last heard ${stamp(data.webhookAt)}` : "artelo webhook: not heard from yet"}</li>
    </ul>
    <form method="post" action="/admin/#buffer" id="buffer" class="admin-form">
      <h3>delivery buffer</h3>
      {buffer.errors.form && <p class="error" role="alert">{buffer.errors.form}</p>}
      <input type="hidden" name="intent" value="prints.buffer" />
      <Field form="buffer" name="buffer" label="buffer (%)" value={buffer.values.buffer} error={buffer.errors.buffer} required plain inputmode="numeric" maxlength={2}
        hint="added to artelo's delivery cost for exchange-rate movement. it applies to the next quote." />
      <button type="submit" class="button">save</button>
    </form>
    {data.orders.length === 0 ? (
      <p class="empty">no print orders yet.</p>
    ) : (
      <ol class="entries orders-admin">
        {data.orders.map((order) => {
          const id = `order-${order.id}`;
          const { errors } = formState(failure, id, {});
          const count = order.lines.reduce((sum, line) => sum + line.quantity, 0);
          const stuck = order.status === "needs_attention";
          return (
            <li class:list={["entry", { attention: stuck }]} id={id}>
              <div>
                <p class="order-line">{stuck && <span class="attention-dot" aria-hidden="true"></span>}{order.paidAt !== null && `${stamp(order.paidAt)} · `}<span class="mono">{order.id}</span></p>
                <p class="order-prints">{count} {count === 1 ? "print" : "prints"}: {order.lines.map((line, index) => <>{index > 0 && ", "}<a href={`/photos/${line.photoId}`}>{line.photoId}</a> {line.tier} {frameWord(line.frame)}{line.quantity > 1 && ` × ${line.quantity}`}</>)}</p>
                <p class="order-sums">to {order.country.toLowerCase()} · {aud(order.printTotal)} + {aud(order.deliveryAmount)} = {aud(order.printTotal + order.deliveryAmount)} · {STATUS_WORDS[order.status]}{!order.livemode && " · test"}{order.refundedAmount ? ` · refunded ${aud(order.refundedAmount)}` : ""}{order.arteloId && ` · artelo ${order.arteloId}${order.arteloCost !== null ? ` ${usd(order.arteloCost)}` : ""}`}</p>
                {stuck && order.reason && <p class="reason">{order.reason}</p>}
                {order.status === "shipped" && order.shipments.length > 0 && (
                  <p class="order-tracking">{order.shipments.map((shipment, index) => <>{index > 0 && " · "}{shipment.url ? <a href={shipment.url} rel="noopener noreferrer">{shipment.carrier} {shipment.number}<span class="chev" aria-hidden="true"></span></a> : `${shipment.carrier} ${shipment.number}`}</>)}</p>
                )}
                <p class="order-actions">
                  {order.paymentIntent && <a class="refund" href={`https://dashboard.stripe.com/${order.livemode ? "" : "test/"}payments/${order.paymentIntent}`} target="_blank" rel="noopener noreferrer">refund in stripe<span class="chev" aria-hidden="true"></span></a>}
                  {stuck && order.arteloId && <span class="open-in-artelo">open it in artelo (order {order.arteloId})</span>}
                </p>
                {stuck && !order.arteloId && (
                  <form method="post" action={`/admin/#${id}`} class="admin-form retry-form">
                    {errors.form && <p class="error" role="alert">{errors.form}</p>}
                    <input type="hidden" name="intent" value="order.retry" />
                    <input type="hidden" name="id" value={order.id} />
                    <button type="submit" class="button quiet">retry now</button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    )}
    <p class="hint orders-hint">refunds happen in stripe. a refund doesn't cancel the artelo order, and an artelo cancellation doesn't refund the buyer; a full refund of a placed order shows here as needs attention until it's cancelled in artelo.</p>
  </>
)}
```

Append to `src/styles/admin.css`:

```css
/* Print orders (spec 20): the state of prints, then the orders, needs attention first with a red dot */
.orders-status { display: grid; gap: 2px; margin-bottom: 8px; font: 12.5px/1.55 var(--mono); color: var(--muted); }
.orders-admin .entry { grid-template-columns: minmax(0, 1fr); }
.orders-admin .entry p { padding-top: 6px; font-size: 14.5px; }
.orders-admin .order-line { font: 12.5px/1.55 var(--mono); color: var(--muted); }
.orders-admin .mono { color: var(--ink); }
.orders-admin .reason { color: var(--error); }
.attention-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--red); margin-right: 8px; transform: translateY(-1px); }
.orders-admin .order-actions { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.orders-admin .open-in-artelo { color: var(--muted); }
/* Drawn chevrons, as the log's: DM Mono has no arrow glyphs */
.orders-admin .chev { display: inline-block; width: 5px; height: 5px; border: solid currentColor; border-width: 0 0 1px 1px; transform: translateY(-1px) rotate(-135deg); margin-left: 5px; }
.orders-admin .retry-form { padding: 6px 0 10px; }
.orders-hint { margin-top: 10px; max-width: 40rem; }
```

In `src/pages/admin/index.astro`:

- add the imports:

```ts
import OrdersAdmin from "../../components/admin/OrdersAdmin.astro";
import { loadOrdersAdmin, type OrdersAdmin as OrdersData } from "../../lib/prints/admin";
import { printConfig, printDeps } from "../../lib/prints/config";
import { placeOrder } from "../../lib/prints/place";
```

- add `"orders"` at the end of `SECTIONS`;
- replace the `const deps = { … };` block inside the POST branch with:

```ts
  const waitUntil = (promise: Promise<unknown>) => Astro.locals.cfContext.waitUntil(promise);
  const prints = printDeps(env, waitUntil);
  const deps = {
    db: env.DB, media: env.MEDIA, images: env.IMAGES, snapshots: env.SNAPSHOTS, prints: env.PHOTO_PRINTS,
    photoLinkSecret: env.PHOTO_LINK_SECRET, origin: Astro.url.origin,
    // retry now places in the background; the saved line asks George to refresh (spec 20)
    orders: { placeLater: (orderId: string) => waitUntil(placeOrder(prints, orderId)), retryWindow: prints.config.retryWindow },
  };
```

and replace `(promise) => Astro.locals.cfContext.waitUntil(promise)` in the `submitForm` call with `waitUntil`;

- add after `const data = await loadAdmin(env.DB);`:

```ts
// Its own read, so a prints problem (migration 0007 not applied, say) can't take the rest of the admin down
let orders: OrdersData | null = null;
try {
  orders = await loadOrdersAdmin(env.DB, printConfig(env), Math.floor(Date.now() / 1000));
} catch (error) {
  console.error("admin: the orders section couldn't load", error instanceof Error ? error.message : String(error));
}
```

- add as the first line of `savedLine`'s body:

```ts
  if (section === "orders") return Astro.url.searchParams.get("note") === "retry" ? "retrying - refresh in a minute to see how it went." : "saved - it applies to the next quote.";
```

- add after the `links` row:

```astro
    <AdminRow label="orders" id="orders" notice={notice("orders")}><OrdersAdmin data={orders} failure={failure} /></AdminRow>
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/orders-admin.test.ts tests/unit/submit.test.ts tests/unit/actions.test.ts tests/unit/photo-actions.test.ts tests/unit/link-actions.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 7: Write the admin e2e spec**

Create `tests/e2e/prints-admin.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { arteloOrdersFor, asTestClient, checkoutOrder, deliverStripe, mailFor, payAtStandIn, setMode, unique, waitForStatus } from "./prints";
import { PRINTS } from "./prints-site";

// The orders section on the prints server's admin (the test build's local bypass, R7)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("the section opens with the state of prints and the rate", async ({ page }) => {
  await page.goto("/admin/#orders");
  await expect(page.locator("#orders .orders-status li").nth(0)).toHaveText("prints are open");
  // Dated the day the store was seeded, or the day the cron's first refresh fetched the stand-in's 1.50
  await expect(page.locator("#orders .orders-status li").nth(1)).toHaveText(/^us\$1 = a\$1\.50 · ecb rate of \d\d\.\d\d\.\d\d$/);
});

test("the buffer saves a whole percent and refuses anything else", async ({ page }) => {
  await page.goto("/admin/#orders");
  // Saving the value it already has: other specs quote on this server at the same time
  await page.locator("#buffer-buffer").fill("8");
  await page.locator("#buffer").getByRole("button", { name: "save" }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=orders#orders$/);
  await expect(page.locator("#orders .notice")).toHaveText("saved - it applies to the next quote.");
  await page.locator("#buffer-buffer").fill("25");
  const [response] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator("#buffer").getByRole("button", { name: "save" }).click()]);
  expect(response.status()).toBe(422);
  await expect(page.locator("#buffer-buffer-error")).toHaveText("a whole number from 0 to 20");
});

test("an order artelo won't take shows first with its reason and george is emailed; retry now places it once", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  await setMode(orderId, "down");
  const { event } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  // PRINT_RETRY_WINDOW=0 on this server: the first retryable failure is the last (spec 19)
  await waitForStatus(orderId, "needs_attention");
  await expect.poll(async () => (await mailFor(`print order ${orderId} needs attention`)).length).toBe(1);
  await page.goto("/admin/#orders");
  const entry = page.locator(`#order-${orderId}`);
  await expect(entry).toHaveClass(/attention/);
  await expect(entry.locator(".reason")).toHaveText("artelo didn't take the order within a day: artelo answered 503");
  await expect(entry.locator(".order-sums")).toHaveText("to au · $238 + $49 = $287 · needs attention · test");
  // Every needs-attention entry comes before every other
  const classes = await page.locator("#orders .orders-admin > li").evaluateAll((items) => items.map((item) => item.classList.contains("attention")));
  expect(classes.indexOf(false) === -1 || classes.slice(classes.indexOf(false)).every((attention) => !attention)).toBe(true);
  await setMode(orderId, "ok");
  await entry.getByRole("button", { name: "retry now" }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=orders&note=retry#orders$/);
  await expect(page.locator("#orders .notice")).toHaveText("retrying - refresh in a minute to see how it went.");
  await waitForStatus(orderId, "placed");
  expect(await arteloOrdersFor(orderId)).toHaveLength(1);
});
```

- [ ] **Step 8: Build and run the e2e specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-admin.spec.ts tests/e2e/admin-page.spec.ts tests/e2e/admin-layout.spec.ts tests/e2e/admin-links.spec.ts`
Expected: every test passing.

- [ ] **Step 9: Visual check**

Start the throwaway server and put two orders in its store, one needing attention with no Artelo id and one shipped, partly refunded and taxed:

```bash
bunx wrangler d1 execute curiousgeorge-logbook --local --persist-to .wrangler/visual --command "INSERT INTO print_orders (id, country, print_total, delivery_amount, delivery_taxed, status, attention_reason, livemode, stripe_session_id, stripe_payment_intent, artelo_order_id, artelo_cost, refunded_amount, shipments, created_at, paid_at, updated_at) VALUES ('01k6x00000000000000000000a', 'AU', 23800, 4900, 0, 'needs_attention', 'artelo didn''t take the order within a day: artelo answered 503', 0, 'cs_v1', 'pi_v1', NULL, NULL, NULL, NULL, 1791400000, 1791400000, 1791400000), ('01k6x00000000000000000000b', 'US', 23800, 5600, 1, 'shipped', NULL, 0, 'cs_v2', 'pi_v2', '48213', 6140, 5600, '[{\"carrier\":\"ups\",\"number\":\"1Z999AA10123456784\",\"url\":\"https://www.ups.com/track?tracknum=1Z999AA10123456784\"}]', 1791300000, 1791300000, 1791300000); INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES ('01k6x00000000000000000000a', 1, 'fixture-b-01', 'medium', 'x12x18', 'oak', 1, 17900), ('01k6x00000000000000000000a', 2, 'fixture-b-02', 'small', 'x8x12', 'unframed', 1, 5900), ('01k6x00000000000000000000b', 1, 'fixture-b-01', 'medium', 'x12x18', 'oak', 1, 17900), ('01k6x00000000000000000000b', 2, 'fixture-b-02', 'small', 'x8x12', 'unframed', 1, 5900)"
```

Then shoot `http://localhost:4336/admin/` at both widths (the test build's bypass answers it on localhost) and look at the orders section. Look for: the status lines in muted mono, the buffer field as narrow as the admin's other number fields, the red dot aligned with the line's first text, the reason in the error red, the tracking and refund links with drawn chevrons, the retry button as a quiet pill, nothing wider than the column on a phone. Then stop it.

- [ ] **Step 10: Commit**

```bash
git add src/lib/prints/admin.ts src/components/admin/OrdersAdmin.astro src/lib/admin/actions.ts src/lib/admin/validate.ts src/lib/admin/submit.ts src/pages/admin/index.astro src/styles/admin.css tests/unit/orders-admin.test.ts tests/unit/submit.test.ts tests/e2e/prints-admin.spec.ts
git commit -m "feat: the admin's print orders section: prints' state, the delivery buffer, the orders, retry now and refunds in stripe"
```

---

### Task 13: the buyer's order page

Spec 1.2 step 13 (sections 18.5, 13.3 and 21.1): `/prints/<order id>?key=<view key>` shows a buyer their prints, what they paid and where the order is, or the notebook 404 for any other key, so it never says whether an order exists. It gets the private headers (the middleware now treats `/prints/` like `/photos/downloads`), `noindex`, `referrer="no-referrer"`, no beacon and no script; while the payment is still landing it refreshes itself every 10 seconds. The ingest proxy refuses `/prints/` events.

**Files:**
- Create: `src/pages/prints/[id].astro`, `src/components/prints/Order.astro`, `src/lib/prints/order-page.ts`, `tests/unit/order-page.test.ts`
- Modify: `src/layouts/Notebook.astro`, `src/lib/photos/http.ts`, `src/middleware.ts`, `src/lib/ingest.ts`, `src/styles/prints.css`, `tests/unit/middleware.test.ts`, `tests/unit/ingest.test.ts`, `tests/e2e/prints-order.spec.ts`
- Test: `tests/unit/order-page.test.ts`, `tests/unit/middleware.test.ts`, `tests/unit/ingest.test.ts`, `tests/unit/notebook.test.ts` (unchanged, must pass), `tests/e2e/prints-order.spec.ts`

**Interfaces:**
- Consumes: `printConfig` (Task 1); `printLine`, `parseSize` (Task 2); `aud`, `gstSentence` (Task 2); `getOrder`, `shipmentsOf`, `OrderRow`, `OrderStatus` (Task 3); `countryName` (Task 4); `viewKeyMatches` (Task 7); `orderLines`, `OrderLine` (Task 8); `sydneyDate` (existing `src/lib/time.ts`), `formatLogDate` (existing).
- Produces: `Notebook`'s new prop `refresh?: number`; `isPrivatePath` covers `/prints/`; `Order.astro` with props `{ order: OrderRow; lines: OrderLine[]; gst: string }`; `ORDER_STATUS_LINES: Record<OrderStatus, [many: string, one: string]>` exported from `Order.astro`'s companion `src/lib/prints/order-page.ts`
- Produces (e2e): in `tests/e2e/prints.ts`, `orderPageFor(name)` (the success URL Stripe would send the buyer to)

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/order-page.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import Order from "../../src/components/prints/Order.astro";
import Notebook from "../../src/layouts/Notebook.astro";
import { ORDER_STATUS_LINES } from "../../src/lib/prints/order-page";
import { getOrder, orderLines, type OrderRow } from "../../src/lib/prints/store";
import { insertOrder, printDb } from "./prints-fakes";
import { render, text } from "./render";

const GST = "prices include no gst; the seller isn't registered for gst.";
const ORDER = "01k6x00000000000000000000a";
const load = async (columns: Record<string, string | number | null> = {}, lines?: Parameters<typeof insertOrder>[2]) => {
  const db = await printDb();
  await insertOrder(db, { id: ORDER, paid_at: Date.UTC(2026, 9, 8, 3, 2) / 1000, ...columns }, lines);
  return { order: (await getOrder(db, ORDER)) as OrderRow, lines: (await orderLines(db, [ORDER])).get(ORDER)! };
};
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);

describe("the order page", () => {
  test("its prints, where they go, what was paid, the gst sentence and the paid date", async () => {
    const doc = await render(Order, { ...(await load({ status: "placed" })), gst: GST });
    expect(labels(doc)).toEqual(["your order", "status", "say hi"]);
    expect(text(doc.querySelector("h1"))).toBe("your prints");
    expect([...doc.querySelectorAll(".basket-line")].map((line) => [text(line.querySelector(".line-name")), text(line.querySelector(".line-what"))])).toEqual([["photo 1 of 2 from 14.06.26", "medium · 12 × 18 in · oak frame"], ["photo 2 of 2 from 14.06.26", "small · 8 × 12 in · unframed"]]);
    expect(doc.querySelector(".basket-line img")!.getAttribute("width")).toBe("160");
    expect([...doc.querySelectorAll(".order-facts p")].map(text)).toEqual(["to australia", "prints $238 + delivery $49 = $287", GST, "paid 08.10.26"]);
    expect(text(doc.querySelector(".order-status"))).toBe("they're with the printer.");
    expect(text(doc.querySelector("#say-hi"))).toContain("questions about your order? hello@curiousgeorge.dev");
    expect(doc.querySelector('#say-hi a[href="mailto:hello@curiousgeorge.dev"]')).not.toBeNull();
    expect(doc.querySelector("script")).toBeNull();
  });

  test("a taxed delivery says so; one print reads in the singular; quantities show", async () => {
    let doc = await render(Order, { ...(await load({ status: "paid", delivery_taxed: 1, delivery_amount: 5600, country: "US" })), gst: GST });
    expect([...doc.querySelectorAll(".order-facts p")].map(text).slice(0, 2)).toEqual(["to united states", "prints $238 + delivery and destination taxes $56 = $294"]);
    doc = await render(Order, { ...(await load({ status: "in_production" }, [["fixture-01", "small", "oak", 1]])), gst: GST });
    expect(text(doc.querySelector("h1"))).toBe("your print");
    expect(text(doc.querySelector(".order-status"))).toBe("it's being printed and packed.");
    doc = await render(Order, { ...(await load({ status: "placed" }, [["fixture-01", "small", "oak", 2]])), gst: GST });
    expect(text(doc.querySelector(".basket-line"))).toContain("× 2");
  });

  test("every status has its line, in the plural and the singular", () => {
    expect(ORDER_STATUS_LINES).toEqual({
      checkout: ["your payment's on its way through. this page updates when it lands.", "your payment's on its way through. this page updates when it lands."],
      expired: ["this checkout wasn't finished, so nothing was charged.", "this checkout wasn't finished, so nothing was charged."],
      paid: ["paid. your prints are being sent to the printer.", "paid. your print is being sent to the printer."],
      needs_attention: ["paid. something needs sorting before they print. george knows and will email you.", "paid. something needs sorting before it prints. george knows and will email you."],
      placed: ["they're with the printer.", "it's with the printer."],
      in_production: ["they're being printed and packed.", "it's being printed and packed."],
      shipped: ["they're on their way:", "it's on its way:"],
      delivered: ["delivered. enjoy them.", "delivered. enjoy it."],
      cancelled: ["this order was cancelled. george will be in touch about a refund.", "this order was cancelled. george will be in touch about a refund."],
      refunded: ["refunded.", "refunded."],
    });
  });

  test("shipped lists each parcel's carrier and a tracking link; an order not yet paid shows no paid date", async () => {
    const shipments = JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }, { carrier: "usps", number: "9400", url: "" }]);
    let doc = await render(Order, { ...(await load({ status: "shipped", shipments })), gst: GST });
    expect([...doc.querySelectorAll(".tracking li")].map(text)).toEqual(["ups 1Z999AA10123456784", "usps 9400"]);
    const link = doc.querySelector(".tracking a")!;
    expect([link.getAttribute("href"), link.getAttribute("rel")]).toEqual(["https://www.ups.com/track?tracknum=1Z999AA10123456784", "noopener noreferrer"]);
    doc = await render(Order, { ...(await load({ status: "checkout", paid_at: null })), gst: GST });
    expect([...doc.querySelectorAll(".order-facts p")].map(text)).not.toContain("paid 08.10.26");
  });

  test("a recreated order's line with no artelo size still reads", async () => {
    const db = await printDb();
    await insertOrder(db, { id: ORDER, status: "needs_attention" }, [["fixture-b-01", "medium", "oak", 1]]);
    await db.prepare("UPDATE print_order_items SET size = '' WHERE order_id = ?").bind(ORDER).run();
    const doc = await render(Order, { order: (await getOrder(db, ORDER))!, lines: (await orderLines(db, [ORDER])).get(ORDER)!, gst: GST });
    expect(text(doc.querySelector(".line-what"))).toBe("medium · oak frame");
  });

  test("the notebook refreshes a page only when asked", async () => {
    const asked = await render(Notebook, { title: "t", noindex: true, refresh: 10 });
    expect(asked.querySelector('meta[http-equiv="refresh"]')!.getAttribute("content")).toBe("10");
    expect((await render(Notebook, { title: "t" })).querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });
});
```

Append to `tests/unit/middleware.test.ts`:

```ts
test("an order page is private too: never cached, indexed or passed on as a referrer", async () => {
  for (const path of ["/prints/01k6x00000000000000000000a?key=private", "/prints/anything"]) {
    expect(isPrivatePath(path.split("?")[0])).toBe(true);
    const response = await run(path, () => Promise.resolve(new Response("ok", { headers: { "Cache-Control": "public, max-age=999" } })));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  }
  for (const path of ["/prints", "/printsx", "/basket"]) expect(isPrivatePath(path)).toBe(false);
});

test("an order page that throws says so in its own words, still private", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await run("/prints/01k6x00000000000000000000a?key=private", () => Promise.reject(new Error("down")));
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("this page isn't loading right now. try again in a bit.");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
```

Append to `tests/unit/ingest.test.ts`:

```ts
test("an event from an order page is refused and never forwarded", async () => {
  const upstream = vi.fn(async () => new Response(null, { status: 200 }));
  for (const properties of [{ $pathname: "/prints/01k6x00000000000000000000a" }, { $current_url: "https://curiousgeorge.dev/prints/01k6x00000000000000000000a?key=private" }, { $current_url: "https://curiousgeorge.dev/basket?key=private" }]) {
    const response = await forwardEvent(new Request("https://curiousgeorge.dev/ingest/i/v0/e/", { method: "POST", body: JSON.stringify({ event: "$pageview", properties }) }), { key: "phc_test", host: "https://us.i.posthog.com", country: null }, upstream);
    expect(response.status).toBe(400);
  }
  expect(upstream).not.toHaveBeenCalled();
});
```

(If `tests/unit/ingest.test.ts` doesn't import `vi`, add it to its `vitest` import.)

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/order-page.test.ts tests/unit/middleware.test.ts tests/unit/ingest.test.ts`
Expected: FAIL, the component, the status lines, the refresh prop and the two private-path changes don't exist.

- [ ] **Step 3: Write the status lines, the component and the page**

Create `src/lib/prints/order-page.ts`:

```ts
import type { OrderStatus } from "./store";

/** The order page's status line by status, [several prints, one print] (spec 18.5) */
export const ORDER_STATUS_LINES: Record<OrderStatus, [string, string]> = {
  checkout: ["your payment's on its way through. this page updates when it lands.", "your payment's on its way through. this page updates when it lands."],
  expired: ["this checkout wasn't finished, so nothing was charged.", "this checkout wasn't finished, so nothing was charged."],
  paid: ["paid. your prints are being sent to the printer.", "paid. your print is being sent to the printer."],
  needs_attention: ["paid. something needs sorting before they print. george knows and will email you.", "paid. something needs sorting before it prints. george knows and will email you."],
  placed: ["they're with the printer.", "it's with the printer."],
  in_production: ["they're being printed and packed.", "it's being printed and packed."],
  shipped: ["they're on their way:", "it's on its way:"],
  delivered: ["delivered. enjoy them.", "delivered. enjoy it."],
  cancelled: ["this order was cancelled. george will be in touch about a refund.", "this order was cancelled. george will be in touch about a refund."],
  refunded: ["refunded.", "refunded."],
};
```

Create `src/components/prints/Order.astro`:

```astro
---
import Row from "../Row.astro";
import { frameLabel, parseSize, printLine } from "../../lib/prints/catalogue";
import { countryName } from "../../lib/prints/countries";
import { aud } from "../../lib/prints/money";
import { ORDER_STATUS_LINES } from "../../lib/prints/order-page";
import { shipmentsOf, type OrderLine, type OrderRow } from "../../lib/prints/store";
import { formatLogDate } from "../../lib/text";
import { sydneyDate } from "../../lib/time";
import "../../styles/prints.css";

// A buyer's order (spec 18.5): what they bought, what they paid and where it is. No script
interface Props {
  order: OrderRow;
  lines: OrderLine[];
  gst: string;
}

const { order, lines, gst } = Astro.props;
const one = lines.reduce((sum, line) => sum + line.quantity, 0) === 1;
const label = order.delivery_taxed === 1 ? "delivery and destination taxes" : "delivery";
const status = ORDER_STATUS_LINES[order.status][one ? 1 : 0];
const shipments = order.status === "shipped" ? shipmentsOf(order) : [];
---
<main class="book order">
  <Row label="your order" head>
    <h1>{one ? "your print" : "your prints"}</h1>
    <ol class="basket-lines order-lines">
      {lines.map((line) => (
        <li class="basket-line">
          {line.thumb && <img src={line.thumb.url} width={line.thumb.width} height={line.thumb.height} alt="" loading="eager" decoding="async" />}
          <div>
            <p class="line-name">{line.name}</p>
            {/* A recreated order's line may have no Artelo size (spec 18.1): it still reads */}
            <p class="line-what">{line.size ? printLine(line.tier, parseSize(line.size), line.frame) : `${line.tier} · ${frameLabel(line.frame)}`}{line.quantity > 1 && ` × ${line.quantity}`}</p>
          </div>
        </li>
      ))}
    </ol>
    <div class="order-facts">
      <p>to {countryName(order.country)}</p>
      <p>prints {aud(order.print_total)} + {label} {aud(order.delivery_amount)} = {aud(order.print_total + order.delivery_amount)}</p>
      <p class="prints-hint">{gst}</p>
      {order.paid_at !== null && <p>paid {formatLogDate(sydneyDate(new Date(order.paid_at * 1000)), "day")}</p>}
    </div>
  </Row>
  <Row label="status" id="status">
    <p class="order-status">{status}</p>
    {shipments.length > 0 && (
      <ul class="tracking">
        {shipments.map((shipment) => (
          <li>{shipment.carrier} {shipment.url ? <a href={shipment.url} rel="noopener noreferrer">{shipment.number}<span class="chev" aria-hidden="true"></span></a> : shipment.number}</li>
        ))}
      </ul>
    )}
  </Row>
  <Row label="say hi" id="say-hi">
    <p>questions about your order? <a href="mailto:hello@curiousgeorge.dev">hello@curiousgeorge.dev</a></p>
  </Row>
</main>
```

Create `src/pages/prints/[id].astro`:

```astro
---
import { env } from "cloudflare:workers";
import Notebook from "../../layouts/Notebook.astro";
import Row from "../../components/Row.astro";
import Order from "../../components/prints/Order.astro";
import { printConfig } from "../../lib/prints/config";
import { gstSentence } from "../../lib/prints/money";
import { getOrder, orderLines, type OrderLine, type OrderRow } from "../../lib/prints/store";
import { viewKeyMatches } from "../../lib/prints/view-key";

// A buyer's private order page (spec 18.5): the right key, or the notebook 404, so the page never says whether an order
// exists. The middleware sends the private headers; no beacon, no script and the key never logged
const id = Astro.params.id ?? "";
const config = printConfig(env);
let found: { order: OrderRow; lines: OrderLine[] } | null = null;
let down = false;
if (/^[0-9a-hjkmnp-tv-z]{26}$/.test(id) && (await viewKeyMatches(config.secrets.PRINT_VIEW_SECRET, id, Astro.url.searchParams.get("key")))) {
  try {
    const order = await getOrder(env.DB, id);
    if (order) found = { order, lines: (await orderLines(env.DB, [id])).get(id) ?? [] };
  } catch (error) {
    down = true;
    console.error("prints: an order page couldn't read D1", error instanceof Error ? error.message : String(error));
  }
}
if (!found && !down) return new Response(null, { status: 404 });
if (down) Astro.response.status = 503;
const one = found ? found.lines.reduce((sum, line) => sum + line.quantity, 0) === 1 : false;
---
<Notebook title={`${one ? "your print" : "your prints"} · george vlachos`} noindex referrer="no-referrer" refresh={found?.order.status === "checkout" ? 10 : undefined}>
  {found ? (
    <Order order={found.order} lines={found.lines} gst={gstSentence(config.gst)} />
  ) : (
    <main class="book order">
      <Row label="your order" head>
        <h1>your prints</h1>
        <p class="down">this page isn't loading right now. try again in a bit.</p>
      </Row>
    </main>
  )}
</Notebook>
```

Append to `src/styles/prints.css`:

```css
/* The order page (spec 18.5) */
.order-lines { margin-top: 20px; }
.order-facts { margin-top: 18px; display: grid; gap: 4px; }
.order-facts p:first-child, .order-facts p:last-child { font: 12.5px/1.55 var(--mono); color: var(--muted); }
.order-status { font-size: 18px; }
.tracking { margin-top: 8px; display: grid; gap: 4px; font: 12.5px/1.55 var(--mono); }
/* Drawn chevrons, as the log's: DM Mono has no arrow glyphs */
.tracking .chev { display: inline-block; width: 5px; height: 5px; border: solid currentColor; border-width: 0 0 1px 1px; transform: translateY(-1px) rotate(-135deg); margin-left: 5px; }
```

- [ ] **Step 4: Refresh, privacy and ingest**

In `src/layouts/Notebook.astro`, add to `Props`:

```ts
  /** Seconds after which the page reloads itself: an order page waiting for its payment to land (spec 18.5) */
  refresh?: number;
```

add `refresh,` after `referrer,` in the destructuring, and add after the `referrer` meta line:

```astro
    {refresh && <meta http-equiv="refresh" content={String(refresh)} />}
```

In `src/lib/photos/http.ts`, replace `isPrivatePath` and its comment with:

```ts
/**
 * Paths whose responses carry a bearer token or what it unlocks: the middleware gives them PRIVATE_HEADERS whatever the
 * route sent, so they are never cached, indexed or passed on as a referrer (spec 5.2): the downloads and a buyer's order page (spec 13.3).
 */
export const isPrivatePath = (pathname: string) =>
  pathname === "/api/photos/downloads" || pathname === "/api/photos/downloads/" || pathname === "/photos/downloads" || pathname.startsWith("/photos/downloads/") || pathname.startsWith("/prints/");
```

In `src/middleware.ts`, replace the private paths' `catch` line, `catch { console.error("photos: route unavailable"); response = plain("Downloads are temporarily unavailable.", 503); }`, with:

```ts
      catch {
        // An order page has its own words; the downloads keep theirs
        console.error(url.pathname.startsWith("/prints/") ? "prints: an order page failed" : "photos: route unavailable");
        response = plain(url.pathname.startsWith("/prints/") ? "this page isn't loading right now. try again in a bit." : "Downloads are temporarily unavailable.", 503);
      }
```

In `src/lib/ingest.ts`, replace `isDownloadsUrl` with:

```ts
/** Whether a URL is a private page (the downloads, an order page) or carries a token or a view key in its query */
function isPrivateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname.startsWith("/photos/downloads") || url.pathname.startsWith("/prints/") || url.searchParams.has("token") || url.searchParams.has("key");
  } catch {
    return false;
  }
}
```

and replace the two refusal lines in `forwardEvent` (the `pathname` check and the `currentUrl` check) with:

```ts
  // Neither the downloads page nor an order page carries a beacon; should one ever be added, its events are still never
  // counted (spec 2.2, 13.3). $current_url is checked too: it is forwarded as sent, and a hand-made event could carry it
  const pathname = parsed.properties.$pathname;
  if (typeof pathname === "string" && (pathname.startsWith("/photos/downloads") || pathname.startsWith("/prints/"))) return ingestAnswer(400);
  const currentUrl = parsed.properties.$current_url;
  if (typeof currentUrl === "string" && isPrivateUrl(currentUrl)) return ingestAnswer(400);
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/order-page.test.ts tests/unit/middleware.test.ts tests/unit/ingest.test.ts tests/unit/notebook.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 6: Write the e2e spec**

Append to `tests/e2e/prints.ts`:

```ts
/** The order page Stripe sends the buyer back to: the session's success_url, with its view key */
export async function orderPageFor(name: string): Promise<string> {
  const [{ form }] = await sessionsFor(name);
  return form.success_url;
}
```

Append to `tests/e2e/prints-order.spec.ts`, adding `orderPageFor` to its `./prints` import:

```ts
test("the order page shows a buyer their order with private headers, and anyone else the notebook 404", async ({ page }) => {
  await asTestClient(page);
  const name = `Ada ${unique()}`;
  const { orderId, sessionId } = await checkoutOrder(page, name);
  const url = await orderPageFor(name);
  expect(url).toMatch(new RegExp(`^${PRINTS}/prints/${orderId}\\?key=[A-Za-z0-9_-]{43}$`));
  // Before the payment lands: the waiting line, and the page refreshes itself
  let response = await page.goto(url);
  expect(response?.status()).toBe(200);
  expect(response?.headers()).toMatchObject({ "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
  await expect(page.locator(".order-status")).toHaveText("your payment's on its way through. this page updates when it lands.");
  await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute("content", "10");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator("script")).toHaveCount(0);
  const { event } = await payAtStandIn(sessionId);
  await deliverStripe(PRINTS, event);
  await waitForStatus(orderId, "placed");
  await page.goto(url);
  await expect(page.locator("h1")).toHaveText("your prints");
  await expect(page.locator(".order-facts p")).toHaveText(["to australia", "prints $238 + delivery $49 = $287", "prices include no gst; the seller isn't registered for gst.", /^paid \d\d\.\d\d\.\d\d$/]);
  await expect(page.locator(".order-status")).toHaveText("they're with the printer.");
  await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
  await ship(PRINTS, orderId);
  await waitForStatus(orderId, "shipped");
  await page.goto(url);
  await expect(page.locator(".order-status")).toHaveText("they're on their way:");
  await expect(page.getByRole("link", { name: "1Z999AA10123456784" })).toHaveAttribute("href", "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  for (const wrong of [url.replace(/key=.+$/, "key=wrong"), url.replace(/key=.+$/, ""), url.replace(orderId, "01k6x0000000000000000000zz")]) {
    response = await page.goto(wrong);
    expect(response?.status()).toBe(404);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.locator("#not-found")).toBeVisible();
  }
});
```

- [ ] **Step 7: Build and run the e2e specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-order.spec.ts tests/e2e/downloads.spec.ts tests/e2e/ingest.spec.ts tests/e2e/head.spec.ts`
Expected: every test passing.

- [ ] **Step 8: Visual check**

Start the throwaway server, add the two orders of Task 12's visual check with the same command, and work out the shipped one's view key from the throwaway server's fixture secret:

```bash
bunx wrangler d1 execute curiousgeorge-logbook --local --persist-to .wrangler/visual --command "INSERT INTO print_orders (id, country, print_total, delivery_amount, delivery_taxed, status, attention_reason, livemode, stripe_session_id, stripe_payment_intent, artelo_order_id, artelo_cost, refunded_amount, shipments, created_at, paid_at, updated_at) VALUES ('01k6x00000000000000000000a', 'AU', 23800, 4900, 0, 'needs_attention', 'artelo didn''t take the order within a day: artelo answered 503', 0, 'cs_v1', 'pi_v1', NULL, NULL, NULL, NULL, 1791400000, 1791400000, 1791400000), ('01k6x00000000000000000000b', 'US', 23800, 5600, 1, 'shipped', NULL, 0, 'cs_v2', 'pi_v2', '48213', 6140, 5600, '[{\"carrier\":\"ups\",\"number\":\"1Z999AA10123456784\",\"url\":\"https://www.ups.com/track?tracknum=1Z999AA10123456784\"}]', 1791300000, 1791300000, 1791300000); INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES ('01k6x00000000000000000000a', 1, 'fixture-b-01', 'medium', 'x12x18', 'oak', 1, 17900), ('01k6x00000000000000000000a', 2, 'fixture-b-02', 'small', 'x8x12', 'unframed', 1, 5900), ('01k6x00000000000000000000b', 1, 'fixture-b-01', 'medium', 'x12x18', 'oak', 1, 17900), ('01k6x00000000000000000000b', 2, 'fixture-b-02', 'small', 'x8x12', 'unframed', 1, 5900)"
```

```bash
KEY=$(node -e 'process.stdout.write(require("node:crypto").createHmac("sha256", "2".repeat(64)).update("order-view:01k6x00000000000000000000b").digest("base64url"))')
```

Then shoot `http://localhost:4336/prints/01k6x00000000000000000000b?key=$KEY` at both widths. Look for: the two lines with their thumbnails as the basket shows them, the facts in mono and the total in body text, the status line larger, the tracking link with its drawn chevron, the say hi row like the home page's. Then stop it.

- [ ] **Step 9: Commit**

```bash
git add "src/pages/prints/[id].astro" src/components/prints/Order.astro src/lib/prints/order-page.ts src/layouts/Notebook.astro src/lib/photos/http.ts src/middleware.ts src/lib/ingest.ts src/styles/prints.css tests/unit/order-page.test.ts tests/unit/middleware.test.ts tests/unit/ingest.test.ts tests/e2e/prints.ts tests/e2e/prints-order.spec.ts
git commit -m "feat: the buyer's private order page, refreshing until the payment lands; /prints/ is private and never counted"
```

---

### Task 14: the margin check, the webhook script and the daily jobs

Spec 1.2 step 14 (sections 17.5 and 18.6 step 5): `bun run prints:check` checks every size and frame against Artelo's costs and Price Check at five landmark addresses, fails on a refused combination or a margin under 15%, warns under 30% or when a quote drifts from the catalogue, prints Antarctica's answer and proves the order lookup the duplicate guard needs. `bun run prints:webhook` saves Artelo's webhook for every status a real order goes through and pipes its secret straight to the Worker's secret store. The cron's daily jobs check the webhook is still there and clear out old expired orders and Stripe events. Neither script is in CI (both need the live key); their tests run them against the stand-in.

**Files:**
- Create: `src/lib/prints/margin.ts`, `src/lib/prints/daily.ts`, `scripts/print-check.mjs`, `scripts/artelo-webhook.mjs`, `tests/unit/margin.test.ts`, `tests/unit/daily.test.ts`, `tests/e2e/prints-scripts.spec.ts`
- Modify: `src/lib/prints/cron.ts`, `package.json`, `tests/fixtures/artelo-site.mjs`
- Test: the two new unit tests, `tests/e2e/prints-scripts.spec.ts`

**Interfaces:**
- Consumes: `PrintDeps` (Task 1); `FAMILIES`, `TIERS`, `FRAMES`, `Tier`, `Frame`, `PrintSize` (Task 2); `aud`, `usd`, `rateText` (Task 2); `writeSetting` (Task 3); `Address`, `deliveryAmount`, `readOrderCosts`, `artelo`, `arteloAddress`, `priceCheckBody`, `productInfo` (Task 4); `mailAdmin` (Task 8); `ordersList`, `readArteloOrder`, `ARTELO_STATUSES` (Task 9); `daily` (Task 4); `photoPlatform` (existing `scripts/photo-platform.mjs`).
- Produces (`src/lib/prints/margin.ts`): `CARD_RATE = 0.035`; `CARD_FIXED = 30`; `FX_MARGIN = 0.03`; `FAIL_BELOW = 0.15`; `WARN_BELOW = 0.3`; `TOTAL_DRIFT = 0.05`; `interface Combination { family: string; tier: Tier; size: PrintSize; frame: Frame }`; `COMBINATIONS: Combination[]`; `interface Margin { productionAud: number; cardFee: number; deliveryAud: number; shortfall: number; margin: number; share: number }`; `marginFor(input: { priceCents: number; productionUsdCents: number; freightUsdCents: number; rate: number; buffer: number }): Margin`; `verdict(share: number): "fail" | "warn" | "ok"`; `drifted(quotedCents: number, catalogueCents: number): boolean`; `LANDMARKS: { label: string; address: Address }[]`; `ANTARCTICA: Address`
- Produces (`src/lib/prints/daily.ts`): `webhookUrl(config): string`; `webhooksList(value: unknown): unknown[] | null`; `checkArteloWebhook(deps): Promise<boolean>`; `EXPIRED_KEEP = 2_592_000`; `EVENTS_KEEP = 7_776_000`; `cleanUp(deps): Promise<boolean>`
- Produces: `bun run prints:check --local | --remote [--persist-to DIR]` (reads `ARTELO_API_KEY`, `ARTELO_API_BASE`, `FX_URL` and `PRINTS_CHECK_PACE_MS` from the environment) and `bun run prints:webhook --local [--origin URL] | --remote` (reads `ARTELO_API_KEY`, `ARTELO_API_BASE` and, for `--local`, `PRINTS_SECRET_SINK`)
- Produces (e2e): the stand-in's `POST /catalog/get-costs`, `POST /webhooks/save`, `GET /webhooks/get`, `GET /__hooks`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/margin.test.ts`:

```ts
import { expect, test } from "vitest";
import { ANTARCTICA, COMBINATIONS, drifted, LANDMARKS, marginFor, verdict } from "../../src/lib/prints/margin";

test("every size in the table, unframed and oak: thirty combinations", () => {
  expect(COMBINATIONS).toHaveLength(30);
  expect(COMBINATIONS.slice(0, 2).map((combination) => `${combination.family} ${combination.tier} ${combination.size.size} ${combination.frame}`)).toEqual(["2:3 small x8x12 unframed", "2:3 small x8x12 oak"]);
});

test("the margin: production at the rate plus 3%, the worst card fee, any freight shortfall, out of the price", () => {
  expect(marginFor({ priceCents: 5900, productionUsdCents: 1500, freightUsdCents: 2000, rate: 1.5, buffer: 0.08 })).toEqual({
    productionAud: 2318, cardFee: 237, deliveryAud: 3300, shortfall: 0, margin: 3345, share: 3345 / 5900,
  });
  // No buffer: the card fee on delivery and 3% exchange come out of the margin
  expect(marginFor({ priceCents: 5900, productionUsdCents: 1500, freightUsdCents: 2000, rate: 1.5, buffer: 0 }).shortfall).toBe(195);
});

test("under 15% fails, under 30% warns", () => {
  expect(verdict(marginFor({ priceCents: 5900, productionUsdCents: 4000, freightUsdCents: 3000, rate: 1.5, buffer: 0.08 }).share)).toBe("fail");
  expect(verdict(marginFor({ priceCents: 5900, productionUsdCents: 2600, freightUsdCents: 3000, rate: 1.5, buffer: 0.08 }).share)).toBe("warn");
  expect(verdict(0.3)).toBe("ok");
  expect(verdict(0.15)).toBe("warn");
});

test("a quote drifts when it differs from the catalogue's costs by more than 5%", () => {
  expect(drifted(7000, 6000)).toBe(true);
  expect(drifted(6300, 6000)).toBe(false);
  expect(drifted(5600, 6000)).toBe(true);
});

test("the landmark addresses are public places in australia, the us and britain, with antarctica for the refusal", () => {
  expect(LANDMARKS.map((landmark) => [landmark.label, landmark.address.country])).toEqual([
    ["sydney opera house", "AU"], ["parliament house darwin", "AU"], ["the white house", "US"], ["iolani palace", "US"], ["10 downing street", "GB"],
  ]);
  expect(ANTARCTICA.country).toBe("AQ");
});
```

Create `tests/unit/daily.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { daily } from "../../src/lib/prints/cron";
import { checkArteloWebhook, cleanUp } from "../../src/lib/prints/daily";
import { readSettings } from "../../src/lib/prints/store";
import { captureLogs, fakeFetch, insertOrder, json, NOW, printDb, testConfig, testDeps, type Handler } from "./prints-fakes";

const HOOKS = "GET https://artelo.test/webhooks/get";
const withHooks = async (handler: Handler) => {
  const db = await printDb();
  const mail = vi.fn(async () => ({ messageId: "m" }));
  return { db, mail, deps: testDeps(db, { fetch: fakeFetch({ [HOOKS]: handler }).fetch, email: { send: mail } as unknown as SendEmail }) };
};

afterEach(() => vi.restoreAllMocks());

describe("the webhook check", () => {
  test("our url and topic among artelo's webhooks: connected", async () => {
    const { db, mail, deps } = await withHooks(() => json([{ topic: "OrderStatusChange", url: "https://curiousgeorge.dev/api/prints/artelo" }]));
    expect(await checkArteloWebhook(deps)).toBe(true);
    expect((await readSettings(db)).webhookMissing).toBe(false);
    expect(mail).not.toHaveBeenCalled();
  });

  test("none of ours: missing, and george is emailed", async () => {
    const { db, mail, deps } = await withHooks(() => json({ webhooks: [{ topic: "OrderStatusChange", url: "https://elsewhere.test/hook" }] }));
    expect(await checkArteloWebhook(deps)).toBe(true);
    expect((await readSettings(db)).webhookMissing).toBe(true);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@curiousgeorge.dev", subject: "the artelo webhook is missing" }));
  });

  test("with no artelo key yet (before launch), nothing is asked and the day counts as checked", async () => {
    const db = await printDb();
    const fake = fakeFetch({});
    const deps = testDeps(db, { fetch: fake.fetch, config: testConfig({ secrets: { ...testConfig().secrets, ARTELO_API_KEY: "" } }) });
    await daily(deps, "webhook_check", () => checkArteloWebhook(deps));
    expect(fake.calls).toHaveLength(0);
    expect((await readSettings(db)).daily.webhook_check).toBe(NOW);
  });

  test("artelo unreachable or unreadable decides nothing and is tried again", async () => {
    captureLogs();
    for (const handler of [() => json({}, 503), () => json({ hooks: "?" })] as Handler[]) {
      const { db, deps } = await withHooks(handler);
      expect(await checkArteloWebhook(deps)).toBe(false);
      expect((await readSettings(db)).webhookMissing).toBe(false);
    }
  });
});

test("the clean-up deletes expired orders over 30 days old with their lines and stripe events over 90 days old, nothing else", async () => {
  const { db, deps } = await withHooks(() => json([]));
  await insertOrder(db, { id: "01k6x00000000000000000000a", status: "expired", created_at: NOW - 31 * 86_400 });
  await insertOrder(db, { id: "01k6x00000000000000000000b", status: "expired", created_at: NOW - 29 * 86_400 });
  await insertOrder(db, { id: "01k6x00000000000000000000c", status: "delivered", created_at: NOW - 400 * 86_400 });
  await db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES ('evt_old', 't', ?), ('evt_new', 't', ?)").bind(NOW - 91 * 86_400, NOW - 89 * 86_400).run();
  expect(await cleanUp(deps)).toBe(true);
  expect((await db.prepare("SELECT id FROM print_orders ORDER BY id").all()).results).toEqual([{ id: "01k6x00000000000000000000b" }, { id: "01k6x00000000000000000000c" }]);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM print_order_items WHERE order_id = '01k6x00000000000000000000a'").first("n")).toBe(0);
  expect((await db.prepare("SELECT id FROM stripe_events").all()).results).toEqual([{ id: "evt_new" }]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `mise exec node@24 -- bunx vitest run tests/unit/margin.test.ts tests/unit/daily.test.ts`
Expected: FAIL, the modules don't exist.

- [ ] **Step 3: Write the margin arithmetic and the daily jobs**

Create `src/lib/prints/margin.ts`:

```ts
// The margin check's arithmetic and addresses (spec 17.5). Value imports carry their .ts extension: bun run prints:check
// runs this file under plain Node
import type { Address } from "./address";
import { FAMILIES, FRAMES, TIERS, type Frame, type PrintSize, type Tier } from "./catalogue.ts";
import { deliveryAmount } from "./quote.ts";

/** Stripe's international card rate in Australia, the worse of its two (assumption 15) */
export const CARD_RATE = 0.035;
export const CARD_FIXED = 30;
/** Production is converted at the rate plus 3%: deliberately conservative, though George's card has no foreign fee */
export const FX_MARGIN = 0.03;
export const FAIL_BELOW = 0.15;
export const WARN_BELOW = 0.3;
export const TOTAL_DRIFT = 0.05;

export interface Combination {
  family: string;
  tier: Tier;
  size: PrintSize;
  frame: Frame;
}

/** Every size in the table, unframed and oak */
export const COMBINATIONS: Combination[] = FAMILIES.flatMap((family) => TIERS.flatMap((tier) => FRAMES.map((frame) => ({ family: family.name, tier, size: family.tiers[tier], frame }))));

export interface Margin {
  /** AUD cents, at the rate plus 3% */
  productionAud: number;
  cardFee: number;
  /** What the buyer pays for delivery at this rate and buffer */
  deliveryAud: number;
  /** What the delivery line fails to cover of the freight and its card fee, worst case */
  shortfall: number;
  margin: number;
  /** The margin as a share of the price */
  share: number;
}

export function marginFor(input: { priceCents: number; productionUsdCents: number; freightUsdCents: number; rate: number; buffer: number }): Margin {
  const worst = input.rate * (1 + FX_MARGIN);
  const productionAud = Math.round(input.productionUsdCents * worst);
  const cardFee = Math.round(input.priceCents * CARD_RATE) + CARD_FIXED;
  const deliveryAud = deliveryAmount(input.freightUsdCents, [], input.rate, input.buffer);
  const shortfall = Math.max(0, Math.round(input.freightUsdCents * worst) + Math.round(deliveryAud * CARD_RATE) - deliveryAud);
  const margin = input.priceCents - productionAud - cardFee - shortfall;
  return { productionAud, cardFee, deliveryAud, shortfall, margin, share: margin / input.priceCents };
}

export const verdict = (share: number): "fail" | "warn" | "ok" => (share < FAIL_BELOW ? "fail" : share < WARN_BELOW ? "warn" : "ok");

export const drifted = (quotedCents: number, catalogueCents: number) => Math.abs(quotedCents - catalogueCents) / catalogueCents > TOTAL_DRIFT;

const place = (name: string, line1: string, city: string, state: string, postcode: string, country: string, phone: string): Address => ({ name, line1, line2: "", city, state, postcode, country, phone });

/** Public landmark addresses, sent only to Artelo's Price Check by George's own run */
export const LANDMARKS: { label: string; address: Address }[] = [
  { label: "sydney opera house", address: place("price check", "Bennelong Point", "Sydney", "NSW", "2000", "AU", "+61 2 0000 0000") },
  { label: "parliament house darwin", address: place("price check", "State Square", "Darwin", "NT", "0800", "AU", "+61 8 0000 0000") },
  { label: "the white house", address: place("price check", "1600 Pennsylvania Avenue NW", "Washington", "DC", "20500", "US", "") },
  { label: "iolani palace", address: place("price check", "364 South King Street", "Honolulu", "HI", "96813", "US", "") },
  { label: "10 downing street", address: place("price check", "10 Downing Street", "London", "", "SW1A 2AA", "GB", "+44 20 0000 0000") },
];

/** Stripe accepts Antarctica as a shipping country; Artelo's real answer there is printed for the refusal handling (16.1) */
export const ANTARCTICA: Address = place("price check", "McMurdo Station", "McMurdo Station", "", "", "AQ", "+1 000 000 0000");
```

Create `src/lib/prints/daily.ts`:

```ts
import { artelo } from "./artelo";
import type { PrintConfig, PrintDeps } from "./config";
import { mailAdmin } from "./mail";
import { writeSetting } from "./store";

// The cron's daily jobs beside the exchange rate (spec 18.6 step 5)

export const webhookUrl = (config: PrintConfig) => `${config.siteOrigin}/api/prints/artelo`;

/** Get Webhooks' list: an array, or one under webhooks, data or items; null for anything else */
export function webhooksList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["webhooks", "data", "items"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return null;
}

/** Artelo lists a webhook with our URL and topic, or /admin and an email say it's missing; true once it has decided */
export async function checkArteloWebhook(deps: PrintDeps): Promise<boolean> {
  // Before launch there is no key: decided for the day, rather than a refused call every five minutes
  if (!deps.config.secrets.ARTELO_API_KEY) return true;
  const result = await artelo(deps, "GET", "/webhooks/get");
  if (!result.ok) {
    console.error("prints: couldn't list artelo's webhooks", result.status ?? "no answer");
    return false;
  }
  const list = webhooksList(result.body);
  if (!list) {
    console.error("prints: artelo's webhook list couldn't be read");
    return false;
  }
  const url = webhookUrl(deps.config);
  const found = list.some((hook) => !!hook && typeof hook === "object" && (hook as Record<string, unknown>).url === url && (hook as Record<string, unknown>).topic === "OrderStatusChange");
  await writeSetting(deps.db, "artelo_webhook_missing", found ? "0" : "1", deps.now());
  if (!found) {
    // At most once a day: the check itself runs at most every 20 hours
    await mailAdmin(deps, "the artelo webhook is missing", `artelo has no OrderStatusChange webhook for ${url}, so order updates only arrive through the twelve-hourly check. run bun run prints:webhook --remote to save it again.`, "webhook-missing email");
  }
  return true;
}

/** Expired orders are kept 30 days, Stripe's event ledger 90 */
export const EXPIRED_KEEP = 30 * 86_400;
export const EVENTS_KEEP = 90 * 86_400;

export async function cleanUp(deps: PrintDeps): Promise<boolean> {
  const { db } = deps;
  const now = deps.now();
  await db.batch([
    db.prepare("DELETE FROM print_order_items WHERE order_id IN (SELECT id FROM print_orders WHERE status = 'expired' AND created_at < ?)").bind(now - EXPIRED_KEEP),
    db.prepare("DELETE FROM print_orders WHERE status = 'expired' AND created_at < ?").bind(now - EXPIRED_KEEP),
    db.prepare("DELETE FROM stripe_events WHERE received_at < ?").bind(now - EVENTS_KEEP),
  ]);
  return true;
}
```

In `src/lib/prints/cron.ts`, add `import { checkArteloWebhook, cleanUp } from "./daily";` and replace the whole `cronSteps` function with its final form:

```ts
/** The five-minute run's steps, in spec 18.6's order. The webhooks are the accelerator; this is the guarantee */
export function cronSteps(deps: PrintDeps): CronStep[] {
  return [
    ["placing due orders", () => placeDue(deps)],
    ["reconciling checkouts", () => reconcileCheckouts(deps)],
    ["unsent emails", () => sendDueMail(deps)],
    ["artelo statuses", () => pollStatuses(deps)],
    ["exchange rate", () => daily(deps, "fx", async () => (await refreshRate(deps)) !== "failed")],
    ["artelo webhook check", () => daily(deps, "webhook_check", () => checkArteloWebhook(deps))],
    ["clean-up", () => daily(deps, "cleanup", () => cleanUp(deps))],
  ];
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `mise exec node@24 -- bunx vitest run tests/unit/margin.test.ts tests/unit/daily.test.ts tests/unit/cron.test.ts tests/unit/worker-entry.test.ts && bun run typecheck`
Expected: PASS; typecheck at 0 errors.

- [ ] **Step 5: Write the two scripts**

Create `scripts/print-check.mjs`:

```js
// bun run prints:check --local | --remote [--persist-to DIR] (spec 17.5): every size and frame against Artelo's costs and
// Price Check at five landmark addresses, two prints together to each, Antarctica's answer and the order lookup the
// duplicate guard depends on. George runs it before opening prints and whenever Artelo's prices or the rate move a lot;
// it is not part of CI (it needs the live key). The key comes from ARTELO_API_KEY and is never printed.
// Exit 1: a refused combination, a margin under 15% or a failed lookup. Warnings (exit 0): a margin under 30%, or a quote
// that differs from the catalogue's costs by more than 5%.
import { artelo, arteloAddress, ordersList, priceCheckBody, productInfo } from "../src/lib/prints/artelo.ts";
import { ANTARCTICA, COMBINATIONS, drifted, LANDMARKS, marginFor, verdict } from "../src/lib/prints/margin.ts";
import { aud, rateText, usd } from "../src/lib/prints/money.ts";
import { readOrderCosts } from "../src/lib/prints/quote.ts";
import { photoPlatform } from "./photo-platform.mjs";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
if (args.includes("--local") === args.includes("--remote")) {
  console.error("usage: bun run prints:check --local | --remote [--persist-to DIR]");
  process.exit(2);
}
const key = process.env.ARTELO_API_KEY;
if (!key) {
  console.error("set ARTELO_API_KEY in the environment; it is never printed");
  process.exit(2);
}
const pace = Number(process.env.PRINTS_CHECK_PACE_MS ?? 250);
const deps = { config: { arteloBase: (process.env.ARTELO_API_BASE ?? "https://www.artelo.com/api/open").replace(/\/+$/, ""), secrets: { ARTELO_API_KEY: key } }, fetch: (input, init) => fetch(input, init) };
// 250ms apart keeps the run under Artelo's 50 requests in 10 seconds
const call = async (method, path, body) => {
  await new Promise((resolve) => setTimeout(resolve, pace));
  return artelo(deps, method, path, body);
};

let failures = 0;
let warnings = 0;
const fail = (text) => {
  failures += 1;
  console.log(`FAIL ${text}`);
};
const warn = (text) => {
  warnings += 1;
  console.log(process.env.CI ? `::warning::${text}` : `warn ${text}`);
};
const refused = (result) => `${result.status ?? "no answer"}${result.message ? `: ${result.message}` : ""}`;
const pct = (share) => `${Math.round(share * 100)}%`;

// The prices, the buffer and the rate from the chosen D1. Reads only: with --local this can be a running test server's
// store (the scripts spec opens 4337's), so nothing here may ever write
const platform = await photoPlatform({ remote: args.includes("--remote"), persistTo: arg("--persist-to") ?? ".wrangler/state" });
let prices;
let settings;
try {
  prices = Object.fromEntries((await platform.env.DB.prepare("SELECT tier, frame, amount FROM print_prices").all()).results.map((row) => [`${row.tier}:${row.frame}`, row.amount]));
  settings = Object.fromEntries((await platform.env.DB.prepare("SELECT key, value FROM print_settings").all()).results.map((row) => [row.key, row.value]));
} finally {
  await platform.dispose();
}
const buffer = Number(settings.delivery_buffer ?? 0.08);
let rate = Number(settings.usd_aud);
if (!(rate >= 0.8 && rate <= 3)) {
  const answer = await (await fetch(process.env.FX_URL ?? "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD")).json();
  rate = answer?.rates?.AUD;
}
console.log(`rate ${rateText(rate)} per us$1, buffer ${pct(buffer)}`);

const singles = new Map();
for (const combination of COMBINATIONS) {
  const name = `${combination.family} ${combination.tier} ${combination.size.size} ${combination.frame}`;
  const price = prices[`${combination.tier}:${combination.frame}`];
  const catalogue = {};
  for (const country of ["AU", "US"]) {
    // Get Catalog Product Costs' required fields: shippingDestination, the three booleans and a listed frameStyle
    const result = await call("POST", "/catalog/get-costs", { catalogProductId: "IndividualArtPrint", size: combination.size.size, frameStyle: combination.frame === "oak" ? "Oak" : "Unframed", includeMats: false, includeFramingService: false, includeHangingPins: false, paperType: "ArchivalMatteFineArt", shippingDestination: country, quantity: 1 });
    if (!result.ok) {
      fail(`${name}: artelo refused its catalogue costs to ${country} (${refused(result)})`);
      continue;
    }
    const { productionCost, shippingCost } = result.body ?? {};
    if (typeof productionCost !== "number" || typeof shippingCost !== "number") {
      fail(`${name}: artelo's catalogue costs to ${country} couldn't be read: ${JSON.stringify(result.body)}`);
      continue;
    }
    catalogue[country] = Math.round((productionCost + shippingCost) * 100);
  }
  for (const landmark of LANDMARKS) {
    const line = { line: 1, quantity: 1, unitAmount: price, size: combination.size, frame: combination.frame, orientation: "Vertical" };
    const result = await call("POST", "/orders/price-check", priceCheckBody([line], landmark.address, rate, `check-quote-${Date.now()}`));
    if (!result.ok) {
      fail(`${name} to ${landmark.label}: artelo refused the price check (${refused(result)})`);
      continue;
    }
    console.log(`  ${name} to ${landmark.label}: ${JSON.stringify(result.body?.orderCosts)}`);
    const quoted = readOrderCosts(result.body?.orderCosts);
    if (!quoted || quoted.productionCents === null) {
      fail(`${name} to ${landmark.label}: the price check couldn't be read`);
      continue;
    }
    singles.set(`${name}|${landmark.label}`, quoted.freightCents);
    const margin = marginFor({ priceCents: price, productionUsdCents: quoted.productionCents, freightUsdCents: quoted.freightCents, rate, buffer });
    console.log(`${name} to ${landmark.label}: production ${usd(quoted.productionCents)} (${aud(margin.productionAud)}), price ${aud(price)}, card fee ${aud(margin.cardFee)}, freight shortfall ${aud(margin.shortfall)}, margin ${aud(margin.margin)} (${pct(margin.share)}), delivery ${aud(margin.deliveryAud)}`);
    const judged = verdict(margin.share);
    if (judged === "fail") fail(`${name} to ${landmark.label}: the margin is ${pct(margin.share)}, under 15%`);
    if (judged === "warn") warn(`${name} to ${landmark.label}: the margin is ${pct(margin.share)}, under the 30% floor`);
    const total = quoted.productionCents + quoted.freightCents + quoted.taxes.reduce((sum, tax) => sum + tax.cents, 0);
    const expected = catalogue[landmark.address.country];
    if (expected && drifted(total, expected)) warn(`${name} to ${landmark.label}: price check's total ${usd(total)} differs from the catalogue's ${usd(expected)} by more than 5%`);
  }
}

// Two prints together, beside each alone, so George sees how Artelo prices combined delivery
const small = COMBINATIONS.find((combination) => combination.family === "2:3" && combination.tier === "small" && combination.frame === "unframed");
const large = COMBINATIONS.find((combination) => combination.family === "2:3" && combination.tier === "large" && combination.frame === "oak");
for (const landmark of LANDMARKS) {
  const lines = [small, large].map((combination, index) => ({ line: index + 1, quantity: 1, unitAmount: prices[`${combination.tier}:${combination.frame}`], size: combination.size, frame: combination.frame, orientation: "Vertical" }));
  const result = await call("POST", "/orders/price-check", priceCheckBody(lines, landmark.address, rate, `check-quote-${Date.now()}`));
  const quoted = result.ok ? readOrderCosts(result.body?.orderCosts) : null;
  if (!quoted) {
    fail(`two prints to ${landmark.label}: artelo refused or the answer couldn't be read (${result.ok ? "unreadable" : refused(result)})`);
    continue;
  }
  const alone = [small, large].map((combination) => singles.get(`${combination.family} ${combination.tier} ${combination.size.size} ${combination.frame}|${landmark.label}`));
  console.log(`two prints to ${landmark.label}: freight ${usd(quoted.freightCents)} together; alone ${alone.map((cents) => (cents === undefined ? "?" : usd(cents))).join(" and ")}`);
}

// Antarctica: Artelo's real refusal, to check the basket's handling of it against
const antarctic = await call("POST", "/orders/price-check", priceCheckBody([{ line: 1, quantity: 1, unitAmount: prices["small:unframed"], size: small.size, frame: "unframed", orientation: "Vertical" }], ANTARCTICA, rate, `check-quote-${Date.now()}`));
console.log(antarctic.ok ? `antarctica: artelo quoted ${JSON.stringify(antarctic.body?.orderCosts)}` : `antarctica: artelo answered ${antarctic.status ?? "nothing"} ${antarctic.message}`);

// The lookup check: a test order, then Get Orders by its name, because placing depends on finding an order before creating it
const checkId = `check-${Date.now()}`;
const created = await call("POST", "/orders/create", {
  orderId: checkId, createdAt: new Date().toISOString(), currency: "AUD", total: prices["small:unframed"] / 100, shippingCost: 0, channelName: "curiousgeorge.dev",
  companyName: "george vlachos", isTestOrder: true, customerAddress: arteloAddress(LANDMARKS[0].address),
  // Only this test order skips the DPI check: its image is the 1200 × 630 share card, about 100 ppi at 8 × 12 in. Real
  // orders never send it (Task 9's test pins that)
  dangerouslySkipDPICheck: true,
  items: [{ orderItemId: `${checkId}-1`, quantity: 1, unitPrice: prices["small:unframed"] / 100, productInfo: productInfo({ size: small.size, frame: "unframed", orientation: "Vertical" }, "https://curiousgeorge.dev/og.png") }],
});
if (!created.ok) fail(`lookup check: artelo refused the test order (${refused(created)})`);
else {
  const lookup = await call("GET", `/orders/get?limit=5&name=${encodeURIComponent(checkId)}`);
  const list = lookup.ok ? ordersList(lookup.body) : null;
  if (list?.some((entry) => entry && entry.orderId === checkId)) console.log("lookup check: ok");
  else fail(`lookup check: get orders didn't return ${checkId}${lookup.ok ? `: ${JSON.stringify(lookup.body).slice(0, 300)}` : ` (${refused(lookup)})`}`);
}

console.log(`${failures} failed, ${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
process.exit(failures > 0 ? 1 : 0);
```

Create `scripts/artelo-webhook.mjs`:

```js
// bun run prints:webhook --local [--origin URL] | --remote (spec 18.6): saves Artelo's OrderStatusChange webhook for every
// status and pipes the returned secret straight to the Worker's secret store on standard input, never printing it.
// --remote stores it with wrangler secret put ARTELO_WEBHOOK_SECRET; --local hands it to PRINTS_SECRET_SINK, a command
// that reads it from standard input. The Artelo key comes from ARTELO_API_KEY.
import { spawnSync } from "node:child_process";
import { ARTELO_STATUSES } from "../src/lib/prints/artelo-status.ts";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
if (remote === args.includes("--local")) {
  console.error("usage: bun run prints:webhook --local [--origin URL] | --remote");
  process.exit(2);
}
const key = process.env.ARTELO_API_KEY;
if (!key) {
  console.error("set ARTELO_API_KEY in the environment; it is never printed");
  process.exit(2);
}
const sink = remote ? ["bunx", "wrangler", "secret", "put", "ARTELO_WEBHOOK_SECRET"] : (process.env.PRINTS_SECRET_SINK ?? "").split(" ").filter(Boolean);
// Checked before Artelo is asked, so no webhook is saved whose secret has nowhere to go
if (sink.length === 0) {
  console.error("--local needs PRINTS_SECRET_SINK, a command that takes the secret on standard input");
  process.exit(2);
}
const origin = remote ? "https://curiousgeorge.dev" : (args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "http://localhost:4331");
const base = (process.env.ARTELO_API_BASE ?? "https://www.artelo.com/api/open").replace(/\/+$/, "");
const response = await fetch(`${base}/webhooks/save`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
  // Ignored is a test order's end and isn't among Save Webhook's filter values; test orders never need a webhook
  body: JSON.stringify({ topic: "OrderStatusChange", url: `${origin}/api/prints/artelo`, filters: { statuses: ARTELO_STATUSES.filter((status) => status !== "Ignored") } }),
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) {
  console.error(`artelo answered ${response.status}; nothing was stored on the worker`);
  process.exit(1);
}
const body = await response.json().catch(() => null);
const secret = typeof body?.secret === "string" ? body.secret : typeof body?.data?.secret === "string" ? body.data.secret : null;
if (!secret) {
  console.error("artelo's answer had no secret; nothing was stored on the worker");
  process.exit(1);
}
const put = spawnSync(sink[0], sink.slice(1), { input: secret, stdio: ["pipe", "ignore", "inherit"] });
if (put.status !== 0) {
  console.error("storing the secret failed; run this again");
  process.exit(1);
}
console.log(remote ? "webhook saved; its secret is stored on the worker." : "webhook saved; its secret went to the local sink.");
```

In `package.json`, add after `"photos:link"`:

```json
    "prints:check": "node scripts/print-check.mjs",
    "prints:webhook": "node scripts/artelo-webhook.mjs",
```

- [ ] **Step 6: Teach the stand-in costs and webhooks, and write the scripts' spec**

In `tests/fixtures/artelo-site.mjs`, add above the line `// Routes added by later tasks go above this line`:

```js
// Catalogue costs (US$40.00 production and US$20.00 shipping for everything) and webhooks, for the two scripts
const hooks = [];
route("POST", "/catalog/get-costs", ({ body, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  // The fields Artelo's reference marks required, so the margin check can't drift from them unnoticed
  const query = JSON.parse(body);
  const booleans = ["includeMats", "includeFramingService", "includeHangingPins"].every((name) => typeof query[name] === "boolean");
  if (!query.shippingDestination || !booleans || !["PremiumMetal", "PremiumOak", "Unframed", "Metal", "Oak"].includes(query.frameStyle)) return [400, { message: "shippingDestination, includeMats, includeFramingService, includeHangingPins and a listed frameStyle are required" }];
  return [200, { productionCost: 40, shippingCost: 20 }];
});
route("POST", "/webhooks/save", ({ body, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const hook = { ...JSON.parse(body), id: `hook-${hooks.length + 1}`, secret: `artelo-hook-secret-${hooks.length + 1}-${Date.now().toString(36)}` };
  hooks.push(hook);
  return [200, hook];
});
route("GET", "/webhooks/get", ({ headers }) => (keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY) ? [200, hooks.map(({ secret, ...hook }) => hook)] : [401, { message: "invalid api key" }]));
route("GET", "/__hooks", () => [200, hooks]);
```

Create `tests/e2e/prints-scripts.spec.ts`:

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { standIn } from "./prints";
import { FIXTURE_SECRETS, PRINTS, STAND_IN } from "./prints-site";

// Both scripts against the stand-in and the prints server's own store; never against Artelo or George's stores
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("prints:webhook saves the webhook for every real status and pipes its secret straight to the store, printing one line", async () => {
  const folder = mkdtempSync(join(tmpdir(), "prints-webhook-"));
  const sink = join(folder, "sink.mjs");
  const stored = join(folder, "secret.txt");
  writeFileSync(sink, `import { readFileSync, writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stored)}, readFileSync(0));`);
  const result = spawnSync("node", ["scripts/artelo-webhook.mjs", "--local", "--origin", PRINTS], {
    env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: `node ${sink}` }, encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("webhook saved; its secret went to the local sink.\n");
  const hook = (await standIn<{ url: string; topic: string; filters: { statuses: string[] }; secret: string }[]>("/__hooks")).findLast((entry) => entry.url === `${PRINTS}/api/prints/artelo`)!;
  expect(hook).toMatchObject({ topic: "OrderStatusChange", filters: { statuses: ["ImagesProcessing", "Received", "PendingFulfillmentAction", "InProduction", "Shipped", "Delivered", "Canceled"] } });
  expect(readFileSync(stored, "utf8")).toBe(hook.secret);
  expect(result.stdout + result.stderr).not.toContain(hook.secret);
});

test("prints:webhook refuses to save anything when the secret has nowhere to go", async () => {
  const before = (await standIn<unknown[]>("/__hooks")).length;
  const result = spawnSync("node", ["scripts/artelo-webhook.mjs", "--local"], { env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: "" }, encoding: "utf8" });
  expect(result.status).toBe(2);
  expect((await standIn<unknown[]>("/__hooks")).length).toBe(before);
});

test("prints:check prints every answer, fails a margin under 15%, prints antarctica's refusal and checks the lookup", async () => {
  test.setTimeout(180_000);
  const result = spawnSync("node", ["scripts/print-check.mjs", "--local", "--persist-to", ".wrangler/prints"], {
    env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, ARTELO_API_BASE: STAND_IN, PRINTS_CHECK_PACE_MS: "0", CI: "" }, encoding: "utf8", timeout: 170_000,
  });
  // The stand-in's US$40.00 production a print sinks the small unframed margin, so the run fails, as it should
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("rate a$1.50 per us$1, buffer 8%");
  expect(result.stdout).toMatch(/FAIL 2:3 small x8x12 unframed to sydney opera house: the margin is -?\d+%, under 15%/);
  expect(result.stdout).toContain("two prints to the white house: freight us$30.00 together; alone us$30.00 and us$30.00");
  expect(result.stdout).toContain("antarctica: artelo answered 400 artelo doesn't deliver to antarctica");
  expect(result.stdout).toContain("lookup check: ok");
  expect(result.stdout + result.stderr).not.toContain(FIXTURE_SECRETS.ARTELO_API_KEY);
});
```

- [ ] **Step 7: Build and run the e2e spec**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-scripts.spec.ts`
Expected: every test passing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/prints/margin.ts src/lib/prints/daily.ts src/lib/prints/cron.ts scripts/print-check.mjs scripts/artelo-webhook.mjs package.json tests/fixtures/artelo-site.mjs tests/unit/margin.test.ts tests/unit/daily.test.ts tests/e2e/prints-scripts.spec.ts
git commit -m "feat: prints:check, prints:webhook and the cron's daily jobs"
```

---

### Task 15: a real test order through Stripe, privacy, budgets, layout shift and the docs

Spec 1.2 step 15 and sections 21.1, 23.1 and 23.2: the one spec that walks a basket through `checkout.stripe.com` in test mode on a seventh server (4338), started only when `STRIPE_TEST_SECRET_KEY` is set, asserting from Stripe's own API that Adaptive Pricing stayed off and the quoted address is on the payment; the privacy spec's print row and quoted basket; the budget and layout-shift gates on the print row and the basket; CI passing the test key; the guide, README, roadmap and follow-ups.

**Files:**
- Create: `tests/e2e/prints-stripe.spec.ts`, `docs/prints.md`, `docs/superpowers/plans/2026-10-08-plan-7-followups.md`
- Modify: `playwright.config.ts`, `tests/e2e/privacy.spec.ts`, `tests/e2e/budgets.spec.ts`, `tests/e2e/perf.spec.ts`, `.github/workflows/ci.yml`, `README.md`, `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`
- Test: the four specs named, then the whole suite

**Interfaces:**
- Consumes: `PRINTS`, `PRINTS_STRIPE`, `printStore`, `printVars`, `PHOTO_KEY_VAR` (Task 5 and plan 6); every helper in `tests/e2e/prints.ts` (Tasks 5 to 13); `watch`, `expectPrivate` (existing in `privacy.spec.ts`); `weigh` (existing in `budgets.spec.ts`); `watchShifts`, `shifted` (existing in `perf.spec.ts`).
- Produces: the 4338 server; the docs.

- [ ] **Step 1: Add the Stripe test-mode server**

In `playwright.config.ts`, add `PRINTS_STRIPE` to the `./tests/e2e/prints-site` import, and add at the end of the `webServer` array:

```ts
        // A seventh server, only when STRIPE_TEST_SECRET_KEY is set (George's GitHub secret; locally, your own test key):
        // the full test order through Stripe's hosted page in test mode (spec 23.2). The key reaches wrangler through the
        // shell, never this file, though it shows on the process's command line in ps while the server runs, which is
        // acceptable for a test key; a test build refuses a live key (spec 21.4). Stripe's base and the retry window are
        // pinned too, so nothing in .dev.vars can change them (ADR-0024's reasoning)
        ...(process.env.STRIPE_TEST_SECRET_KEY
          ? [{
              command: `${printStore(".wrangler/stripe")} && wrangler dev -c dist/server/wrangler.json --port 4338 --persist-to .wrangler/stripe ${PHOTO_KEY_VAR} ${printVars(PRINTS_STRIPE)} --var STRIPE_SECRET_KEY:$STRIPE_TEST_SECRET_KEY --var STRIPE_API_BASE:https://api.stripe.com --var PRINT_RETRY_WINDOW:86400`,
              url: PRINTS_STRIPE,
              reuseExistingServer: false,
              timeout: 120_000,
            }]
          : []),
```

In `.github/workflows/ci.yml`, replace `- run: bun run test:e2e` in the `check` job with:

```yaml
      - run: bun run test:e2e
        env:
          # Stripe's test mode, for the one full order through checkout.stripe.com; the spec skips without it
          STRIPE_TEST_SECRET_KEY: ${{ secrets.STRIPE_TEST_SECRET_KEY }}
```

- [ ] **Step 2: Write the full test order**

Create `tests/e2e/prints-stripe.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { arteloOrdersFor, auAddress, deliverStripe, mailFor, priceChecksFor, printsD1, quoteDelivery, ship, TWO_PRINTS, unique, waitForStatus } from "./prints";
import { PRINTS_STRIPE } from "./prints-site";

// The full test order (spec 23.2) on 4338, which talks to Stripe's real test mode. Artelo is still the stand-in. Stripe's
// webhooks can't reach a local server, so the spec fetches the real event from Stripe's API and delivers it itself
test.use({ baseURL: PRINTS_STRIPE });
test.skip(!process.env.STRIPE_TEST_SECRET_KEY, "needs STRIPE_TEST_SECRET_KEY, a key for stripe's test mode");
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

const STORE = ".wrangler/stripe";
const stripeApi = async (path: string) =>
  (await fetch(`https://api.stripe.com${path}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_TEST_SECRET_KEY}`, "Stripe-Version": "2025-09-30.clover" } })).json();

test("two prints, one exact total, paid on stripe's page in test mode, one artelo order from the masters, shipped", async ({ page }) => {
  test.setTimeout(240_000);
  const name = `Ada ${unique()}`;
  await page.goto("/photos/fixture-b-01");
  await page.getByLabel("medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed").check();
  await page.getByLabel("oak frame").check();
  await page.getByRole("button", { name: "add to basket" }).click();
  // keep looking carries the basket to the next photo, whose print row adds to it
  await page.getByRole("link", { name: "keep looking" }).click();
  await page.locator('a.frame-link[href^="/photos/fixture-b-02"]').click();
  await page.getByRole("button", { name: "add to basket" }).click();
  await expect(page).toHaveURL(new RegExp(`/basket\\?items=${TWO_PRINTS}$`));
  await quoteDelivery(page, auAddress(name));
  await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery $49 = $287");
  const [check] = await priceChecksFor(name);
  expect(check.items).toHaveLength(2);

  await page.getByRole("button", { name: "continue to payment" }).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 60_000 });
  // Stripe's page: the address read-only in the custom text, two print lines and one delivery line, no shipping form
  await expect(page.getByText(`posting to: ${name}, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia.`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("delivery to australia, 2 prints")).toBeVisible();
  await expect(page.getByText(/print of photo 1 of 2 from 14\.06\.26 · medium, 12 × 18 in · oak frame/)).toBeVisible();
  await expect(page.getByText(/print of photo 2 of 2 from 14\.06\.26 · small, 8 × 12 in · unframed/)).toBeVisible();
  await expect(page.locator("#shippingName, #shippingAddressLine1")).toHaveCount(0);
  await page.locator("#email").fill("buyer@example.com");
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill(name);
  const country = page.locator("#billingCountry");
  if (await country.count()) await country.selectOption("AU");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible().catch(() => false)) await postal.fill("2026");
  // Events from a minute before paying on: the test account may be shared with other runs
  const started = Math.floor(Date.now() / 1000) - 60;
  await page.locator("button[type=submit]").click();
  await page.waitForURL(new RegExp(`^${PRINTS_STRIPE}/prints/[0-9a-z]{26}\\?key=`), { timeout: 90_000 });
  const orderId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.locator("h1")).toHaveText("your prints");

  // Stripe's own record: paid in aud with no conversion (adaptive pricing off), the quoted address on the payment
  const [{ stripe_session_id: sessionId }] = printsD1<{ stripe_session_id: string }>(`SELECT stripe_session_id FROM print_orders WHERE id = '${orderId}'`, STORE);
  let event: { id: string; data: { object: { id: string } } } | undefined;
  await expect.poll(async () => {
    event = ((await stripeApi(`/v1/events?type=checkout.session.completed&created%5Bgte%5D=${started}&limit=100`)).data as (typeof event)[]).find((entry) => entry?.data.object.id === sessionId);
    return !!event;
  }, { timeout: 60_000 }).toBe(true);
  const session = await stripeApi(`/v1/checkout/sessions/${sessionId}`);
  expect(session).toMatchObject({ currency: "aud", amount_total: 28700, payment_status: "paid", client_reference_id: orderId });
  expect(session.currency_conversion ?? null).toBeNull();
  const intent = await stripeApi(`/v1/payment_intents/${session.payment_intent}`);
  expect(intent.shipping).toMatchObject({ name, phone: "+61 400 000 000", address: { line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postal_code: "2026", country: "AU" } });

  // The event, twice, signed with the local test webhook secret: one artelo order
  expect(await deliverStripe(PRINTS_STRIPE, event)).toBe(200);
  expect(await deliverStripe(PRINTS_STRIPE, event)).toBe(200);
  await waitForStatus(orderId, "placed", STORE);
  const orders = await arteloOrdersFor(orderId);
  expect(orders).toHaveLength(1);
  const [{ order, designs }] = orders;
  expect(order.isTestOrder).toBe(true);
  expect(order.customerAddress).toMatchObject({ name, street1: "12 Example Street", country: "AU" });
  expect(order.items.map((item) => [item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation, item.productInfo.paperType])).toEqual([
    ["x12x18", "NaturalOak", "Vertical", "ArchivalMatteFineArt"], ["x8x12", null, "Horizontal", "ArchivalMatteFineArt"],
  ]);
  const masters = Object.fromEntries(printsD1<{ id: string; print_sha256: string }>("SELECT id, print_sha256 FROM photos WHERE id IN ('fixture-b-01', 'fixture-b-02')", STORE).map((row) => [row.id, row.print_sha256]));
  expect(designs.map((design) => [design.width, design.height, design.sha256])).toEqual([[4000, 6000, masters["fixture-b-01"]], [6000, 4000, masters["fixture-b-02"]]]);

  // Artelo ships it: the tracking on the order page, the links revoked, one email to the buyer
  expect(await ship(PRINTS_STRIPE, orderId)).toBe(200);
  await waitForStatus(orderId, "shipped", STORE);
  await page.reload();
  await expect(page.locator(".order-status")).toHaveText("they're on their way:");
  await expect(page.getByRole("link", { name: "1Z999AA10123456784" })).toHaveAttribute("href", "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  expect(printsD1(`SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = '${orderId}' AND revoked_at IS NULL`, STORE)).toEqual([{ n: 0 }]);
  await expect.poll(async () => (await mailFor(orderId)).filter((mail) => mail.subject === "your prints are on their way" && mail.to === "buyer@example.com").length).toBe(1);
});
```

- [ ] **Step 3: Extend the privacy, budget and layout-shift specs**

In `tests/e2e/privacy.spec.ts`, add `import { auAddress, quoteDelivery } from "./prints";` and `import { PRINTS } from "./prints-site";` to the imports, and append:

```ts
test("the print row and a basket quoted for an address set nothing, stay first party and keep the address out of every url", async ({ page }) => {
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local prints server");
  await page.context().setExtraHTTPHeaders({ "X-Test-Client": `privacy-${Date.now()}` });
  const seen = watch(page, PRINTS);
  const sent: string[] = [];
  page.on("request", (request) => {
    sent.push(request.url());
    const referer = request.headers()["referer"];
    if (referer) sent.push(referer);
  });
  await page.goto(`${PRINTS}/photos/fixture-b-01`, { waitUntil: "networkidle" });
  await expect(page.locator("form#prints")).toBeVisible();
  await page.goto(`${PRINTS}/basket?items=fixture-b-01:medium:oak,fixture-b-02:small:unframed`, { waitUntil: "networkidle" });
  await quoteDelivery(page, auAddress("Privacy Tester"));
  await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery $49 = $287");
  await expectPrivate(page, seen);
  expect(sent.filter((url) => /Privacy|Tester|Example Street|Bondi/.test(decodeURIComponent(url)))).toEqual([]);
});
```

In `tests/e2e/budgets.spec.ts`, add `import { PRINTS } from "./prints-site";` to the imports, and append:

```ts
// Prints spec 23.1, on the prints server: the print row and the basket add no script, so the beacon is all there is
for (const path of ["/photos/fixture-b-01", "/basket?items=fixture-b-01:medium:oak,fixture-b-02:small:unframed"]) {
  test(`${path} with prints open stays inside the page budgets`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "measured once, in Chromium");
    test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "measured on the local prints server");
    const sizes = await weigh(page, `${PRINTS}${path}`);
    console.log(`budgets for ${path} (bytes)`, sizes);
    expect(sizes.js).toBeGreaterThan(0);
    expect(sizes.js).toBeLessThan(10 * 1024);
    expect(sizes.css).toBeLessThan(15 * 1024);
    expect(sizes.html).toBeLessThan(30 * 1024);
    expect(sizes.fonts).toBe(2);
    await expect(page.locator("script[src]")).toHaveCount(0);
  });
}

test("the basket's previews load eagerly, at most ten", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured once, in Chromium");
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "measured on the local prints server");
  const ten = ["fixture-b-01:small:oak", "fixture-b-02:small:oak", "fixture-01:small:oak", "fixture-02:small:oak", "fixture-b-01:medium:oak", "fixture-b-02:medium:oak", "fixture-b-01:large:oak", "fixture-b-02:large:oak", "fixture-b-01:small:unframed", "fixture-b-02:small:unframed"].join(",");
  await page.goto(`${PRINTS}/basket?items=${ten}`);
  const loading = await page.locator(".basket-line img").evaluateAll((images) => images.map((image) => image.getAttribute("loading")));
  expect(loading).toHaveLength(10);
  expect(loading.every((value) => value === "eager")).toBe(true);
});
```

In `tests/e2e/perf.spec.ts`, add `import { PRINTS } from "./prints-site";` to the imports, and add inside the existing `for (const [width, height] of [[1280, 800], [375, 812]])` loop, after the photo page's test:

```ts
  test(`nothing shifts on a photo's page with its print row, or on a basket, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await watchShifts(page);
    for (const path of ["/photos/fixture-b-01", "/basket?items=fixture-b-01:medium:oak,fixture-b-02:small:unframed"]) {
      await page.goto(`${PRINTS}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const cls = await shifted(page);
      test.info().annotations.push({ type: "cls", description: `layout shift on ${path} at ${width}px: ${cls}` });
      expect(cls).toBeLessThan(0.01);
    }
  });
```

- [ ] **Step 4: Run the four specs**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run build:test && bunx playwright test tests/e2e/prints-stripe.spec.ts tests/e2e/privacy.spec.ts tests/e2e/budgets.spec.ts tests/e2e/perf.spec.ts`
Expected: every test passing; without `STRIPE_TEST_SECRET_KEY` in the environment the full test order is skipped with its annotation. If an implementer or reviewer has a Stripe test key, run it once more with `STRIPE_TEST_SECRET_KEY=sk_test_…` set in their shell (never written into a file) and confirm it passes; Stripe's checkout page selectors (`#email`, `#cardNumber`, `#cardExpiry`, `#cardCvc`, `#billingName`, `#billingCountry`, `#billingPostalCode`) are assumption 20 in "Assumptions", and a change there is fixed in this spec only.

- [ ] **Step 5: Write the docs**

Create `docs/prints.md`:

```markdown
# Prints

How print ordering works on curiousgeorge.dev ([spec](superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md), part 2; [ADR-0021](adr/0021-prints-sold-on-site-through-artelo.md) as amended).

## What a buyer sees

- A photograph that prints well has a `prints` row: small, medium and large (the frameable Artelo size nearest A4, A3 and A2 for its ratio, at 200 pixels per inch or better), unframed or in oak. Prices are the fixed list in `print_prices`, in AUD, with no GST.
- `add to basket` lands on `/basket`, whose basket lives only in the query string (`items=<photo>:<tier>:<frame>,…`, at most ten prints). The gallery carries it while browsing; those pages are never cached.
- The buyer types a delivery address and presses `quote delivery`. Artelo's Price Check quotes the whole basket to that address; delivery is its freight plus any destination tax it quotes, converted at the ECB's rate plus the buffer (`print_settings.delivery_buffer`, 8% to start), rounded up to the dollar. The quote is sealed with `PRINT_VIEW_SECRET` for 30 minutes.
- `continue to payment` writes the order, then sends the buyer to Stripe's hosted checkout, where the quoted address is fixed on the payment and shown read-only. Adaptive Pricing is off, so they pay the AUD total they saw.
- Stripe sends them back to `/prints/<order id>?key=<view key>`, a private page that follows the order to delivery.

## What happens after payment

- Stripe's webhook (`/api/prints/stripe`) moves the order to `paid` once per event and starts placing it. The five-minute cron is the guarantee: it places due orders, asks Stripe about every checkout older than 65 minutes before anything expires it, sends due emails, polls Artelo for orders it hasn't heard about for 12 hours and runs the daily jobs (the exchange rate, the Artelo webhook check, the clean-up).
- Placing looks the order up at Artelo before every create, reads the address from the Stripe payment in memory, gives Artelo a 72-hour link to each print's master and retries with backoff for 24 hours; anything Artelo refuses goes to `needs attention` in `/admin` with a reason, and George gets an email.
- Artelo's webhook (`/api/prints/artelo`) moves the order on; shipping stores the tracking and emails the buyer.
- The address is never stored or logged: it lives in the form body, on the Stripe payment and with Artelo.

## Running it locally

- `bun run test:e2e` starts the stand-in for every provider (`tests/fixtures/artelo-site.mjs`, port 4401) and the prints server (4337). With `STRIPE_TEST_SECRET_KEY` set to a Stripe test key in your shell, it also starts 4338 and runs the one full order through Stripe's hosted page.
- `bun run prints:check --local` and `bun run prints:webhook --local` run against whatever `ARTELO_API_BASE` points at; their spec points them at the stand-in.

## Launch

Spec section 24 lists George's steps: the Stripe account and its webhook, `PRINT_VIEW_SECRET`, the Artelo account and key, `bun run prints:webhook --remote` and `bun run prints:check --remote`, Cloudflare Email Sending, `PRINTS_OPEN` set to `"true"` and a real two-print order. The follow-ups file for plan 7 tracks what is left.
```

In `README.md`, add a section before `## Snapshots and analytics`:

```markdown
## Prints

Print ordering: a `prints` row on a photograph's page, a basket kept in the URL, delivery quoted exactly for the buyer's address by Artelo's Price Check, payment on Stripe's hosted checkout, one Artelo order per paid basket, a private order page, emails and the `orders` section in `/admin`. How it works: [prints guide](docs/prints.md). The e2e suite stands in for Stripe, Artelo, the exchange rate and the mail binding (`tests/fixtures/artelo-site.mjs`, port 4401) on the prints server (4337); set `STRIPE_TEST_SECRET_KEY` to a Stripe test key in your shell to also run the full order through Stripe's test mode (4338).

Decisions: [ADR-0021](docs/adr/0021-prints-sold-on-site-through-artelo.md) (amended; prints sold on the site through Artelo). Launch steps, all George's, are in section 24 of the [spec](docs/superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md); prints stay closed until `PRINTS_OPEN` is `"true"`, every print secret is set and an exchange rate is stored.
```

In `docs/superpowers/plans/2026-10-03-redesign-roadmap.md`, add a row after plan 6's:

```markdown
| 7. Prints | Migration 0007; the print row, the basket in the URL and the gallery's carry; the address form, Artelo's exact delivery quote and the sealed quote; checkout with the quoted address fixed on Stripe's payment; Stripe's webhook, the reconciliation and placing with a lease and a lookup; Artelo's webhook and poll; emails; the admin's orders section; the order page; `prints:check` and `prints:webhook`; the provider stand-in ([spec](../specs/2026-10-08-photo-gallery-and-prints-design.md), part 2) | 6 | [Plan](2026-10-08-plan-7-prints.md); [follow-ups](2026-10-08-plan-7-followups.md) |
```

Create `docs/superpowers/plans/2026-10-08-plan-7-followups.md`:

```markdown
# Plan 7 follow-ups

What plan 7 (print ordering) leaves for later: the launch steps, what was never run for real and what the build assumed.

## Launch (George's)

Spec section 24's steps, in its order: the Stripe account (public name `george vlachos`, customer emails on, Adaptive Pricing off in the dashboard too) with `STRIPE_SECRET_KEY` on the Worker and `STRIPE_TEST_SECRET_KEY` in GitHub Actions; the webhook endpoint at `https://curiousgeorge.dev/api/prints/stripe` on API version `2025-09-30.clover` with its three events and `STRIPE_WEBHOOK_SECRET`; `PRINT_VIEW_SECRET`; the Artelo account, billing and `ARTELO_API_KEY`; `bun run prints:webhook --remote` and `bun run prints:check --remote`; Cloudflare Email Sending for the domain; `PRINTS_OPEN` set to `"true"` and a deploy; a real two-print order shipped to George.

Migration 0007 arrives with the deploy (the deploy job runs `migrations apply`), after 0005 and 0006.

## Never run for real

- Artelo's real API: Price Check, Create Order, Get Orders' `name` filter, Get Order by Id, the webhook's payload and signature, Get Catalog Product Costs and the webhook endpoints are all exercised against the stand-in. `prints:check` and the launch order are the first real runs (spec 25).
- Stripe's hosted page in test mode runs only where `STRIPE_TEST_SECRET_KEY` is set; Stripe's live mode and its receipts only at launch.
- The `EMAIL` binding: every test build sends to the sink.
- The cron under a real Cloudflare trigger: locally it runs through wrangler's local explorer (`/cdn-cgi/local/explorer/api/local/scheduled`).

## Known gaps

- A shipped order whose Stripe session has no email is retried by every cron run, with a Stripe call each time, until it has one. Cheap, and it should never happen with Checkout collecting the email; if it shows up in the logs, back the retry off.
- Spec 17.5 still names `country` and an unframed `frameStyle: null` for Get Catalog Product Costs; Artelo's reference requires `shippingDestination`, the three booleans and `frameStyle: "Unframed"`, which `prints:check` sends (plan 7, assumption 12). Correct the spec's wording when it is next edited.

## Assumptions to confirm

Plan 7's "Assumptions" section lists each assumption about Stripe and Artelo a task depends on, with how it is checked.
```

Run: `perl -CSD -ne 'print "$ARGV:$.: $_" if /\x{2014}/; close ARGV if eof' docs/prints.md docs/superpowers/plans/2026-10-08-plan-7-followups.md README.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md`
Expected: no matches.

- [ ] **Step 6: The whole suite**

Run: `pkill -f "port 433[0-9]"; pkill -f "artelo-site.mjs"; bun run check`
Expected: typecheck at 0 errors, every unit test passing, the built worker check passing, the migrations and seeds applied and every e2e spec passing (the print specs in chromium only; the full Stripe order skipped without its key).

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts .github/workflows/ci.yml tests/e2e/prints-stripe.spec.ts tests/e2e/privacy.spec.ts tests/e2e/budgets.spec.ts tests/e2e/perf.spec.ts docs/prints.md README.md docs/superpowers/plans/2026-10-03-redesign-roadmap.md docs/superpowers/plans/2026-10-08-plan-7-followups.md
git commit -m "test: a real test order through stripe, privacy, budgets and layout shift with prints; docs for prints"
```

---

## Assumptions about Stripe and Artelo

Each assumption a task depends on, and how the build checks it. Spec section 25's numbered list stands; these are the ones the plan's code leans on, with what the plan added.

1. **Artelo's sizes, oak frame and paper** (spec 25.1 to 25.3): every size in the table exists for `IndividualArtPrint` on `ArchivalMatteFineArt`, framed (`frameColor: "NaturalOak"`) and unframed (`frameColor: null`). Tasks 2, 4 and 9. Checked by `prints:check`, which fails on a refused combination.
2. **Price Check's request and answer** (25.4, 25.5): `POST /orders/price-check` takes the order's `customerAddress` and `items` without `designs`, in `currency: "USD"`, and answers `{ orderCosts: { productionCost, arteloShipping, usSalesTax, gst, hst, pst, total, … } }` in US dollars as numbers; its freight and tax are what Artelo charges for the same order. Artelo's reference marks `canvasDesignedFor`, `canvasBorderStyle`, `state` and `zipcode` required, and the plan sends `null`, `null`, the city as a fallback and `""` where an address has none; `prints:check` is the check. Tasks 4 and 6. Checked by `prints:check` and the launch order's cost against the quote.
3. **Price Check refusals** (25.6): an address or product Artelo won't take answers 400 or 422 with a `message` (or `error`, `title` or `errors[0].message`) fit to show the buyer; everything else is "unavailable". Task 4. Checked by `prints:check`'s Antarctica line.
4. **Create Order's answer** (plan): Artelo refuses a design under 150 dpi unless `dangerouslySkipDPICheck` is sent, which only the margin check's test order does; a 2xx whose body (or its `data`) holds the order's `id`, `orderId`, `status` and `details` with the cost fields of assumption 2; a 2xx without an `id` counts as retryable and the next attempt's lookup adopts what Artelo made. Task 9. Checked by the launch order.
5. **Get Orders** (25.8, plan): `GET /orders/get?limit=5&name=<our orderId>` answers a list, or an object holding one under `orders`, `data` or `items`, whose entries carry our `orderId`; anything else is a failed lookup, which is retryable and never followed by a create. Artelo's reference confirms a bare array, a `name` filter matching "name or orderId" and `allOrders` defaulting to API-created orders only. Artelo itself doesn't refuse a duplicate `orderId`. Task 9. Checked by `prints:check`'s lookup check.
6. **Get Order by Id** (plan): `GET /orders/get-by-id?orderId=<artelo id>` answers the order (or it in `data`) with `status` and `shipments`. Task 11. Checked by the launch order's status reaching `/admin` and, after launch, by `last heard`.
7. **The webhook** (25.9): `x-artelo-signature` is the hex HMAC-SHA256 of the raw body or of `JSON.stringify` of it; the body (or its `data`) carries `orderId` (Artelo's or ours), `status` and, when shipped, `shipments` of `{ carrierCode, trackingNumber, trackingUrl }`; a tracking URL that isn't `https://` is kept without its link. Task 11. Checked by the first real status change (`last heard` in `/admin`), backed by the 12-hour poll.
8. **Artelo's statuses** (spec 18.3): `ImagesProcessing`, `Received`, `Ignored`, `PendingFulfillmentAction`, `InProduction`, `Shipped`, `Delivered`, `Canceled`; any other is stored and logged and changes nothing. Save Webhook's filter lists every one but `Ignored` (a test order's end, which needs no webhook), so `prints:webhook` leaves it out. Tasks 9, 11 and 14. Checked by the launch order and George's first `prints:webhook --remote`.
9. **The master link** (25.7): Artelo fetches each design from an `https://` URL with a query string, answering a 10 to 30MB JPEG with `Content-Disposition: attachment`, within 72 hours. Task 9. Mimicked by the stand-in, which fetches every design and checks its SHA-256 and size; truly checked by the launch order.
10. **Addresses and amounts** (25.10, 25.11): Artelo accepts the city and state fallbacks and an empty `zipcode`, needs a phone only outside the US, and uses `total`, `shippingCost` and `unitPrice` (in AUD) only for paperwork. Tasks 4 and 9. Checked by the launch order.
11. **Test orders** (25.12): `isTestOrder: true` costs nothing, is never produced and ends `Ignored`. Task 9. From Artelo's Create Order documentation; the tests use only the stand-in.
12. **Webhook management and catalogue costs** (plan): `POST /webhooks/save` with `{ topic, url, filters: { statuses } }` answers the webhook with its `secret` (or it in `data`); `GET /webhooks/get` lists webhooks with `url` and `topic` (as a list or under `webhooks`, `data` or `items`); `POST /catalog/get-costs` with `{ catalogProductId, size, frameStyle: "Oak" | "Unframed", includeMats, includeFramingService, includeHangingPins, paperType, shippingDestination, quantity }` (the fields Artelo's reference marks required; spec 17.5's wording predates this) answers `{ productionCost, shippingCost }` in US dollars, and `prints:check` prints the raw answer and fails the combination when it can't read it. Task 14. Checked by George's first `prints:webhook --remote` and `prints:check --remote`.
13. **Artelo's rate limit** (spec 18.3, 21.3): 50 requests in 10 seconds, so quotes keep to 30 and the poll and the check pace themselves. Tasks 6, 11 and 14.
14. **The quoted address on Stripe** (25.13): with `shipping_address_collection` and `phone_number_collection` off, `payment_intent_data[shipping]` is stored on the PaymentIntent unchanged and hosted Checkout shows no address form; the buyer sees the address only in `custom_text[submit][message]` (at most 1,200 characters). Tasks 7 and 9. Checked by Task 15's order against Stripe's test mode.
15. **Adaptive Pricing** (25.19): `adaptive_pricing[enabled]=false` keeps a session in AUD with no `currency_conversion`. Tasks 7 and 10. Checked by Task 15's order (and the webhook sends any session with a conversion to `needs_attention`).
16. **Stripe's API shapes** (plan): Checkout Session creation answers `{ id, url }`; `GET /v1/checkout/sessions/:id` answers `status` (`open`, `complete`, `expired`), `payment_status`, `client_reference_id`, `livemode`, `currency`, `amount_total`, `payment_intent` as an id and `customer_details.email` on API version `2025-09-30.clover`; `POST /v1/checkout/sessions/:id/expire` expires an open session; `charge.refunded`'s charge carries `payment_intent`, `amount_refunded` and `refunded` (true when refunded in full). Tasks 7, 8 and 10. Checked by Task 15 (sessions and payment intents) and the launch order (receipts and refunds).
17. **Stripe's webhook signature** (spec 18.1): `Stripe-Signature: t=<seconds>,v1=<hex>[,v1=…]`, an HMAC-SHA256 of `<t>.<raw body>` with the endpoint's secret. Task 10. Checked by Task 15 delivering a real event signed the same way and at launch by Stripe's own deliveries.
18. **Stripe's country list** (spec 16.4, plan): `src/lib/prints/countries.ts` copies Stripe's shipping `allowed_countries` list for API version `2025-09-30.clover` (excluding `ZZ`). Task 4. The implementer compares it with Stripe's API reference page while building Task 4; Stripe doesn't validate `payment_intent_data[shipping]` against it, so a gap shows only as a country missing from the select.
19. **Test-mode details** (25.16, 25.18): Stripe accepts `http://localhost` success and cancel URLs in test mode; line item images are sent only from an `https://` origin, so local sessions carry none. Tasks 7 and 15. Checked by Task 15.
20. **Stripe's hosted page selectors** (plan): the full order fills `#email`, `#cardNumber`, `#cardExpiry`, `#cardCvc` and `#billingName` (and `#billingCountry` and `#billingPostalCode` when shown) and presses `button[type=submit]`, with Stripe's published test card `4242 4242 4242 4242`. Task 15. If Stripe renames a field, only that spec changes.
21. **Stripe's fees and receipts** (25.14, 25.15): 3.5% + $0.30 is the worst card fee `prints:check` uses; Stripe's free receipt shows the payment description with the GST sentence, and only in live mode. Tasks 7 and 14. Checked by the launch order's receipt.
22. **The `send_email` binding** (spec 18.4, plan): `env.EMAIL.send({ from: { email, name }, to, replyTo, subject, text, html })` sends from the onboarded domain. Task 8. Every test build uses the sink; checked at launch.
23. **The Worker entry** (spec 13.3, plan): the adapter keeps a custom `main` and the built `wrangler.json` keeps the cron, the three rate limits and the email binding. Task 1. Checked by Task 1's probe and by `bun run check:worker` after every build, in CI too.
