# Prints

How print ordering works on curiousgeorge.dev, how George launches it and how he runs it once it is open ([spec](superpowers/specs/2026-10-08-photo-gallery-and-prints-design.md), part 2; [ADR-0021](adr/0021-prints-sold-on-site-through-artelo.md) as amended; [ADR-0025](adr/0025-print-emails-fail-towards-a-duplicate.md), [ADR-0026](adr/0026-a-print-order-is-fenced-not-keyed.md) and [ADR-0027](adr/0027-a-stripe-event-acts-only-when-provably-ours.md)). This guide is internal: it names the services the site uses.

## What a buyer sees

- A photograph that prints well has a `prints` row: small, medium and large (the frameable Artelo size nearest A4, A3 and A2 for its ratio, at 200 pixels per inch or better), unframed or in oak. Prices are the fixed list in `print_prices`, in AUD, with no GST.
- `add to basket` lands on `/basket`, whose basket lives only in the query string (`items=<photo>:<tier>:<frame>,…`, at most ten prints). The gallery carries it while browsing; those pages are never cached.
- The buyer types a delivery address and presses `quote delivery`. Artelo's Price Check quotes the whole basket to that address; delivery is its freight plus any destination tax it quotes, converted at the ECB's rate plus the buffer (`print_settings.delivery_buffer`, 8% to start), rounded up to the dollar. The quote is sealed with `PRINT_VIEW_SECRET` for 30 minutes.
- `continue to payment` writes the order, then sends the buyer to Stripe's hosted checkout, where the quoted address is fixed on the payment and shown read-only. Adaptive Pricing is off, so they pay the AUD total they saw.
- Stripe sends them back to `/prints/<order id>?key=<view key>`, a private page that follows the order to delivery.

## What happens after payment

- Stripe's webhook (`/api/prints/stripe`) moves the order to `paid` once per event and starts placing it. The five-minute cron is the guarantee: it places due orders, asks Stripe about every checkout older than 65 minutes before anything expires it, sends due emails, polls Artelo for orders it hasn't heard about for 12 hours and runs the daily jobs (below).
- Placing looks the order up at Artelo before every create, reads the address from the Stripe payment in memory, gives Artelo a 72-hour link to each print's master and retries with backoff for 24 hours; anything Artelo refuses goes to `needs attention` in `/admin` with a reason, and George gets an email.
- Artelo's webhook (`/api/prints/artelo`) moves the order on; shipping stores the tracking and emails the buyer.
- The address is never stored or logged: it lives in the form body, on the Stripe payment and with Artelo. The buyer's email is read from the Stripe session when the shipped email goes, and never stored.

## Running it locally

- `bun run test:e2e` starts the stand-in for every provider (`tests/fixtures/artelo-site.mjs`, port 4401) and the prints server (4337). With `STRIPE_TEST_SECRET_KEY` set to a Stripe test key in your shell, it also starts 4338 and runs the one full order through Stripe's hosted page (`tests/e2e/prints-stripe.spec.ts`); without it, that spec is skipped.
- `bun run prints:check --local` and `bun run prints:webhook --local` run against whatever `ARTELO_API_BASE` points at; their spec points them at the stand-in.

## Launch checklist

Every step is George's, in this order. Prints stay closed (`PRINTS_OPEN` is `"false"` in `wrangler.jsonc`) until the last step, so the merge itself changes nothing a visitor can buy. Plan 6 (the gallery) and plan 7 (prints) merge together from `feature/photos-and-prints`.

Where a step pastes a key into the shell, read it without echo so it stays out of your history: `read -rs NAME && export NAME`, then paste and press return.

### Before merge

1. **Cloudflare Email Service.** Turn on Email Sending for the domain, so the Worker's `send_email` binding has somewhere to send from (a deploy with the binding may fail without it):
   ```bash
   bunx wrangler email sending enable curiousgeorge.dev
   ```
   Add the DNS records it asks for beside the domain's existing mail records (merge any SPF change into the one existing SPF record rather than adding a second), and wait until the dashboard shows the domain ready to send. Emails go from `prints@curiousgeorge.dev` with replies to `hello@curiousgeorge.dev`.
2. **The photo bucket.** `wrangler.jsonc` binds it, so a deploy without it fails:
   ```bash
   bunx wrangler r2 bucket create curiousgeorge-photo-prints --location oc
   ```
   In the dashboard, confirm it has no `r2.dev` URL and no custom domain.
3. **Remote migrations.** Production has none of 0005 (photos), 0006 (the gallery), 0007 (prints) or 0008 (an order's `resolved_at`, for `mark resolved`) yet. All four are additive, so the live site carries on unchanged:
   ```bash
   bunx wrangler d1 migrations apply curiousgeorge-logbook --remote
   ```
   This is what `bun run db:migrate:remote` and the deploy job run, so the deploy then finds nothing left to apply. Never `wrangler d1 execute --file`: it leaves the `d1_migrations` tracker behind, and the next `apply` fails on a migration it thinks is new.
4. **`PHOTO_LINK_SECRET`**, fresh and never the local one (the downloads page answers 503 without it, and placing an order needs it to give Artelo its links):
   ```bash
   openssl rand -hex 32 | bunx wrangler secret put PHOTO_LINK_SECRET
   ```
5. **`PRINT_VIEW_SECRET`**, which seals quotes and derives every order page's key:
   ```bash
   openssl rand -hex 32 | bunx wrangler secret put PRINT_VIEW_SECRET
   ```
   Set it once and keep it: changing it breaks every order page link already emailed and every quote still open.
6. **The Stripe account.** Open it as an individual, set the public business name to `george vlachos`, turn on customer emails for successful payments and turn off Adaptive Pricing in the dashboard too (the site also turns it off on every session). Then set the live key:
   ```bash
   bunx wrangler secret put STRIPE_SECRET_KEY
   ```
   A standard `sk_live_` key or a restricted `rk_live_` key both work. A restricted key needs write access to Checkout Sessions and read access to PaymentIntents (the site creates, reads and expires sessions and reads a payment's delivery address); if a checkout fails with a permissions error, add what Stripe's message names.
7. **The GitHub secret for CI.** Add a Stripe test-mode key as a repository secret (the `check` job has no environment, so an environment secret wouldn't reach it):
   ```bash
   gh secret set STRIPE_TEST_SECRET_KEY
   ```
   From then on every CI run, this branch's pull request included, runs the full order through `checkout.stripe.com` in test mode on its own server (4338). It must pass before merging. A pull request that is already open picks up a newly added secret only on its next run, so re-run its checks (or push a commit) after adding it. It has never run against Stripe's real page, so a first failure is likely to be a renamed field on Stripe's page (plan 7, assumption 20); that is fixed in `tests/e2e/prints-stripe.spec.ts` alone.
8. **One Stripe test-mode order and refund.** Run the full order once on the Mac, so you can see Stripe's page:
   ```bash
   read -rs STRIPE_TEST_SECRET_KEY && export STRIPE_TEST_SECRET_KEY
   bun run build:test
   bunx playwright test tests/e2e/prints-stripe.spec.ts --project=chromium --headed --trace on
   bunx playwright show-trace test-results/<the prints-stripe folder>/trace.zip
   ```
   Stop any `bun run serve` of your own first (no test server is reused). Then:
   - In the trace, look at Stripe's page: is the custom text (`posting to: …`) shown as plain text, or does Stripe render Markdown in it? A buyer's name or street with `*`, `_` or brackets would then show formatted. Record what you saw in the [plan 7 follow-ups](superpowers/plans/2026-10-08-plan-7-followups.md).
   - In Stripe's dashboard, in test mode, open the payment (its description reads `print order <id> · prices include no gst…`) and refund it in full.
   - Open the `charge.refunded` event for that charge (Developers, Events) and confirm `data.object.metadata.order_id` holds the order id. A refund that arrives before the site has recorded the payment finds its order only through it ([ADR-0027](adr/0027-a-stripe-event-acts-only-when-provably-ours.md)); if it is missing, don't open prints until the refund handling is changed.

   Then take the key out of the shell: `unset STRIPE_TEST_SECRET_KEY`.

### After merge

9. **Watch the deploy.** The job applies migrations (none left after step 3), deploys both Workers, purges the `logbook` and `photos` cache tags and checks the visitor info's promises on the live site. The Worker now has the five-minute cron and the three rate limits. Within a few minutes the orders section of `/admin` reads `prints are closed: PRINTS_OPEN isn't "true"`, and after the first cron run it shows an exchange rate (`us$1 = a$… · ecb rate of …`).
10. **The Stripe webhook**, in live mode, now that the route exists: add an endpoint at `https://curiousgeorge.dev/api/prints/stripe` on API version `2025-09-30.clover`, subscribed to exactly `checkout.session.completed`, `checkout.session.expired` and `charge.refunded` (the three the site handles; anything else is recorded and ignored). Reveal its signing secret and set it:
    ```bash
    bunx wrangler secret put STRIPE_WEBHOOK_SECRET
    ```
    Then prove the secret: send a test event to the endpoint from Stripe's dashboard (any of the three events) and check it is answered 200. If the dashboard offers no test event for a live endpoint, use `stripe trigger checkout.session.completed` from the Stripe CLI against the same endpoint, or watch the endpoint's delivery log on the first real order instead. A signed event that isn't one of the site's orders is recorded and answered 200, while a wrong secret answers 400; otherwise a wrong secret would show only as a missed-webhook email 65 minutes after the first real order.
11. **Artelo.** Open the account, connect the API integration and set up billing on George's card (no foreign transaction fee). Then set the key and save Artelo's webhook straight after, so the cron's daily webhook check never finds a key with no webhook:
    ```bash
    read -rs ARTELO_API_KEY && export ARTELO_API_KEY
    printf %s "$ARTELO_API_KEY" | bunx wrangler secret put ARTELO_API_KEY
    bun run prints:webhook --remote
    ```
    It prints `webhook saved; its secret is stored on the worker.` and sets `ARTELO_WEBHOOK_SECRET` itself; never set that secret by hand. If it says `artelo already has a webhook for https://curiousgeorge.dev/api/prints/artelo`, a secret can't be read back from Artelo, so delete that webhook in Artelo's dashboard and run it again. It never saves a second one.
12. **The margin and lookup check**, with `ARTELO_API_KEY` still exported:
    ```bash
    bun run prints:check --remote
    ```
    - It must end with `lookup check: ok` and `0 failed`. Any `FAIL lookup check` line means don't open prints: placing depends on Artelo finding an order the moment it is created ([ADR-0026](adr/0026-a-print-order-is-fenced-not-keyed.md)).
    - Read every indented `orderCosts` line. The site assumes Artelo's `total` is `productionCost` plus `arteloShipping`, the taxes, `branding`, `holidayFees` and `customPricingAdjustment`, less `wholesaleDiscount`. Check those four fields count towards `total` that way in the real answers; if they don't, every quote will be refused as unreadable, so get `src/lib/prints/quote.ts` changed before opening. If all four are 0 in every answer, the assumption is unproven rather than confirmed, which is safe: should one ever be non-zero and not reconcile, `readOrderCosts` refuses that quote, so the buyer sees delivery as unavailable, never a wrong price. Note it in the follow-ups either way.
    - Fix anything it fails on, and look at every warning (a margin under 30%, or Price Check more than 5% from the catalogue's costs). The Antarctica line shows Artelo's real refusal.
    - It creates one free Artelo test order, which is never produced, and prints `lookup check: test order <artelo id> created (<status>)`. Cancel it in Artelo if you like.
    - Prove Artelo's webhook secret: once that test order changes status at Artelo, `/admin` should read `artelo webhook: connected · last heard …` (any delivery that passes the signature check stamps it; a wrong secret answers 400, and Artelo eventually deletes a webhook that keeps failing). If it still reads `not heard from yet` an hour or so later, Artelo may not send a test order's changes; then check Artelo's webhook delivery log, and watch for `last heard` to change during the first real order (step 17).

    Then take the key out of the shell: `unset ARTELO_API_KEY`.
13. **The photographs** (plan 6's steps):
    - From the Mac, under Node 24: `bun run photos:prepare`, filling `scripts/photo-cities.json` wherever it stops, then `bun run photos:import --remote`.
    - In `/admin`, review every post (places included) and publish what should be public, looking hardest at the 96 RAW candidates with `raw` pills.
    - Issue the first catalogue link from `/admin` and open it on a phone.
14. **Checks against the live site**, once something is published: the image gate and the photo pages' privacy check, then Lighthouse.
    ```bash
    PLAYWRIGHT_BASE_URL=https://curiousgeorge.dev bunx playwright test tests/e2e/budgets.spec.ts tests/e2e/privacy.spec.ts -g "images before any scroll|photo pages" --project=chromium
    bun run lighthouse https://curiousgeorge.dev/
    ```
    Also confirm a catalogue link's download works and that Workers Logs hold no `token=`.
15. **Prove email.** In the orders section of `/admin`, press `send me a test email`. It works while prints are closed. The page should say `test email sent`, and the email (`test email from curiousgeorge.dev prints`) should arrive at `ADMIN_EMAIL` (`hello@curiousgeorge.dev`) within a minute or two; look in spam too. If the page says `couldn't send the test email`, or nothing arrives, don't open prints: every note to George (needs attention, a cancellation, a missed webhook) and every buyer's shipped email go the same way. Search Workers Logs for `prints: couldn't send`, fix Email Sending (step 1) and press the button again.
16. **Open prints, last.** In one change, set `"PRINTS_OPEN": "true"` in `wrangler.jsonc` and delete the `PRINTS_OPEN` check from `scripts/check-built-worker.mjs`: the line `if (config.vars?.PRINTS_OPEN !== "false") problems.push(…)` (line 15) and the comment above it, and drop the words about keeping prints closed from the file's header comment (line 2) and its success message (line 23). That check makes `bun run check:worker` fail any build with prints switched on, so that a merge can never open them by accident; both CI jobs run it, so with the check still in place the pull request goes red and the deploy job stops before deploying. The change touches code, so an agent can make the pull request. Merge it to `main`. The deploy job purges the `logbook` and `photos` cache tags, which is what makes cached photo pages show the print row and the home page's line end `some come as prints`. Confirm its `Purge the cached pages` step passed; if it didn't, purge the tags `photos` and `logbook` in the Cloudflare dashboard (Caching, Purge cache, Custom purge, Tags). Then `/admin` reads `prints are open`; if it lists secrets that aren't set or says no exchange rate has been fetched yet, prints stay closed until that is fixed.
17. **The first real order.** Buy two prints in one order (one small unframed, one framed) with a real card, shipped to yourself. Watch it reach `shipped` in `/admin`, with the tracking email and Stripe's receipt showing the GST sentence, and compare Artelo's cost on the order (`artelo us$…`) with the quote. Then decide whether to keep or refund them. This is the only check of Artelo's real image fetch, address handling, combined freight and webhooks (spec 25).

## Operating

### The orders section in /admin

The section opens with three lines: whether prints are open (or why not), the exchange rate and its ECB date (`- older than a week, check the rate job` once it is stale; quotes are refused then) and the Artelo webhook (`connected · last heard …`, `not heard from yet` or `missing - run bun run prints:webhook --remote`). Then the delivery buffer and `send me a test email`, which sends `test email from curiousgeorge.dev prints` to `ADMIN_EMAIL` through the same path as every note about an order, prints open or closed. The page says `test email sent` only once the send succeeded, and otherwise `couldn't send the test email. check workers logs for "prints: couldn't send"`. Then the latest 100 orders past checkout, `needs attention` first (unless marked resolved, below).

Each order's state:

- **waiting to place** (`paid`): paid, and the site is placing it with Artelo, retrying with backoff for 24 hours if Artelo is down.
- **needs attention**: something needs George. A red dot and the reason show under it (below), and he was emailed once when it got there. Once marked resolved, the dot goes and `resolved <date>` shows under the reason.
- **with artelo** (`placed`): Artelo has it; its id and cost show.
- **printing** (`in_production`): Artelo is making it. The links to the masters are revoked from here on.
- **shipped**: tracking shows, and the buyer has been emailed it.
- **delivered**: the tracking stays.
- **cancelled**: Artelo cancelled it; refund the buyer in Stripe if that hasn't happened.
- **refunded**: refunded in full before Artelo had it, so nothing will be made.

`test` marks a Stripe test-mode order, and `refunded $…` any refund, part or whole. A part refund changes nothing else. `refund in stripe ›` opens the payment in Stripe's dashboard; refunds only ever happen there. Orders still at checkout or expired aren't listed.

### Emails to George

All go to `ADMIN_EMAIL` (`hello@curiousgeorge.dev`). An email that fails is retried by the next cron run, so one can rarely arrive twice ([ADR-0025](adr/0025-print-emails-fail-towards-a-duplicate.md)).

- **`print order <id> needs attention`**: its body is the reason and a link to `/admin/#orders`. Read the reason (below) and act on it.
- **`print order <id> was cancelled by artelo`**: Artelo cancelled the order. Refund the buyer in Stripe from the order's `refund in stripe ›` link, and email them if it helps. Not sent when the buyer was already refunded in full.
- **`print order <id> was cancelled and refunded`**: Artelo cancelled an order the buyer has been refunded for in full, while a note about it was still waiting to go. Nothing to do.
- **`print order <id>: stripe's webhook never arrived`**: the cron found the order paid at Stripe with no webhook, applied the payment itself and is placing it, so the order needs nothing unless a needs-attention email for it comes too. Check the webhook in Stripe's dashboard: the endpoint is enabled, its recent deliveries succeed and its signing secret is the one in `STRIPE_WEBHOOK_SECRET`.
- **`the artelo webhook is missing`**: the daily check found no webhook at Artelo for the site, so status changes arrive only through the twelve-hourly poll. Run `bun run prints:webhook --remote` (step 11). It comes once a day until fixed.

The buyer gets Stripe's receipt and, from the site, one email when the order ships (`your prints are on their way`, or `your print is on its way` for one print).

### Reading a needs-attention reason

| Reason | What it means | What to do |
| --- | --- | --- |
| `artelo didn't take the order within a day: <last error>` | Every attempt for 24 hours failed in a way worth retrying: Artelo unreachable, down or busy (`artelo answered 503`), a lookup it couldn't read or Stripe busy | Check Artelo and Workers Logs, then `retry now` |
| `artelo refused the order: <artelo's message>` or `artelo refused the order (<status>).` | Artelo refused it outright: a bad key (401 or 403), an address it won't take or a print (size, frame or paper) it won't make. A refusal of one print refuses the whole order | Fix the cause (the key, or the size table with `prints:check`), then `retry now`; or refund in Stripe |
| `artelo needs something before it can print: open the order in artelo.` | Artelo holds the order in `PendingFulfillmentAction`, for example a design it can't use | Sort it out in Artelo's dashboard; the order moves on by itself when Artelo does |
| `refunded in stripe: cancel it in artelo if it hasn't printed.` | The buyer was refunded in full while Artelo has the order, or the daily lookup found a refunded order at Artelo | Cancel it in Artelo; the cancellation moves it to `cancelled`. If it has already printed, it stays here, and there is nothing more to do. `retry now` never shows |
| `the amount paid differs from the quote` | Stripe's total or currency doesn't match the order (or Stripe converted the currency, which Adaptive Pricing being off should prevent) | Check the payment in Stripe; `retry now` places it as it is, or refund |
| `stripe's test and live modes don't match this order; check it before it's placed.` | A test payment met a live order or the reverse, usually around a key change | Check it in Stripe; refund, or `retry now` if it is genuine |
| `the order row was missing; check it before it's placed.` | The payment arrived for an order the store didn't have, and the site rebuilt it from the payment's details | Check the rebuilt prints and amounts against the payment, then `retry now` or refund |
| `the order has no stripe payment to read its address from.`, `stripe couldn't give the payment's delivery address (<status>).` or `the payment has no delivery address.` | The site couldn't read the delivery address from Stripe; a 401 or 403 usually means the key, or a restricted key without PaymentIntents read | Fix the key, then `retry now` |
| `PHOTO_LINK_SECRET isn't set.` | The masters' links can't be signed | Set it (step 4), then `retry now` |
| `the print file for <photo> is missing. import it again, then retry.` | That photograph's master isn't in the photo bucket | Run `bun run photos:import --remote` again, then `retry now` |

### Retry now

`retry now` shows only on a `needs attention` order that Artelo doesn't have and whose buyer hasn't been refunded, in full or with the refund reason above. It sets the order back to `paid` with a fresh 24-hour retry window and starts the first attempt at once; the page says `retrying - refresh in a minute to see how it went.` It can't make a second Artelo order, because every attempt looks the order up at Artelo before creating it. It never shows on a refunded order (it would print for a buyer who has their money back) and never on one Artelo already has, which shows `open it in artelo (order <artelo id>)` instead. A second tap counts as the first; a tap on an order that has moved on meanwhile says `that order can't be retried from here.`

### Mark resolved

`mark resolved` shows on every `needs attention` order that isn't already resolved. Press it once you have dealt with the order outside the site and nothing more will happen to it here: for example a refunded order that Artelo printed anyway, or an unmatched stranded refund whose cancellation Artelo reported under its own id. The order stays listed with its reason and a `resolved <date>` note, but it loses its red dot, moves down among the other orders by date and no longer shows `retry now`; the page says `saved - it's marked resolved.` Nothing else about the order changes, and nothing is sent. A second tap does nothing.

It is not final. Anything that moves the order into `needs attention` again (a failed placement, a refund of an order Artelo has, Artelo asking for something or the daily stranded-refund lookup) clears it, so the new problem shows at the top with its red dot and George is emailed again. Artelo's later statuses still apply to a resolved order Artelo has: the twelve-hourly check keeps asking about it, so a cancellation or a shipment is still recorded.

### The cron and its daily jobs

Every five minutes the cron places due orders, asks Stripe about checkouts older than 65 minutes, sends due emails and polls Artelo about orders it hasn't heard of for 12 hours. Quiet runs log nothing; a run that did work or failed logs one `prints: cron ran; …` line. Once every 20 hours or so it also:

- **refreshes the exchange rate** from the ECB (through Frankfurter). Quotes are refused once the stored rate is more than a week old, so a run of failures shows in `/admin` before it shows to buyers.
- **checks Artelo's webhook**: with no webhook for the site, `/admin` says it's missing and George gets the email above. Before `ARTELO_API_KEY` is set it checks nothing.
- **cleans up**: it deletes expired checkouts older than 30 days (with their lines) and Stripe's event ledger entries older than 90 days. Paid orders are never deleted.
- **looks up stranded refunds**: every refunded order paid in the last 30 days that has no Artelo id is looked up at Artelo, up to 20 each run, the longest unchecked first. One Artelo has (a create that timed out just as the refund landed) moves to `needs attention` with the refund reason, and George is emailed to cancel it there.

### A duplicate Artelo order

The fence and the lookup make a second Artelo order for one paid basket practically impossible, so it raises no email and no `needs attention` ([ADR-0026](adr/0026-a-print-order-is-fenced-not-keyed.md)). If one ever happens, it shows only in Workers Logs (Cloudflare dashboard, Workers, `personal-website`, Logs): search for `two artelo orders`, which logs `prints: order <id> has two artelo orders, <first> and <second>: cancel one in artelo`. The site keeps the first id, the one `/admin` shows; cancel the other in Artelo's dashboard by hand. A related line, `reached artelo after it left paid`, means Artelo has an order the site had already moved on from; a refunded one is flagged in `/admin` for cancelling.

One known gap (in the [plan 7 follow-ups](superpowers/plans/2026-10-08-plan-7-followups.md)): if Artelo's cancellation of the duplicate arrives naming the site's order id rather than its own, the site may mark the real order `cancelled` and email "refund it in stripe". Ignore that email while the first Artelo order is still printing, and send the buyer its tracking yourself, because the site will then ignore that order's later shipped status.
