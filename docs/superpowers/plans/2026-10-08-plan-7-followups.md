# Plan 7 follow-ups

What plan 7 (print ordering) leaves for later: the launch steps, what was never run for real, what the reviews parked, the known flakes and what the build assumed.

## Launch (George's)

The ordered checklist, split into before merge and after merge with the exact commands, is in the [prints guide](../../prints.md#launch-checklist). Plans 6 and 7 merge together from `feature/photos-and-prints`, and prints stay closed until its last step sets `PRINTS_OPEN` to `"true"`.

Before merge, in short: Cloudflare Email Sending for the domain, the `curiousgeorge-photo-prints` R2 bucket, migrations 0005, 0006, 0007 and 0008 with `wrangler d1 migrations apply curiousgeorge-logbook --remote`, `PHOTO_LINK_SECRET`, `PRINT_VIEW_SECRET`, the Stripe account and `STRIPE_SECRET_KEY` (a standard `sk_live_` or restricted `rk_live_` key), the GitHub secret `STRIPE_TEST_SECRET_KEY` and one Stripe test-mode order and refund. After merge: the Stripe webhook and `STRIPE_WEBHOOK_SECRET`, `ARTELO_API_KEY` then `prints:webhook --remote` (which alone sets `ARTELO_WEBHOOK_SECRET`), `prints:check --remote`, the photo import and review, the live budget and privacy checks, `send me a test email` from `/admin` (don't open if it doesn't arrive), `PRINTS_OPEN` (in the same change as deleting the `PRINTS_OPEN` check from `scripts/check-built-worker.mjs`, which otherwise fails CI and the deploy on purpose) with the cache purge and a real two-print order.

Three answers only the launch can give, to record here once known:

- Whether a real Price Check's `total` counts `branding`, `holidayFees` and `customPricingAdjustment` in and `wholesaleDiscount` out, as `src/lib/prints/quote.ts` assumes (`prints:check --remote` prints every `orderCosts` answer). If not, every quote is refused as unreadable. If all four are 0 in every answer, the assumption stays unproven; that is safe, because `readOrderCosts` refuses a quote whose parts don't reconcile with `total`, so a buyer would see delivery as unavailable, never a wrong price.
- Whether Stripe's `charge.refunded` carries `metadata.order_id` copied from the payment intent (the test-mode refund, launch step 8; [ADR-0027](../../adr/0027-a-stripe-event-acts-only-when-provably-ours.md)).
- Whether Stripe's hosted page renders Markdown in `custom_text[submit][message]` (launch step 8). If it does, a buyer's name or street with `*`, `_` or brackets shows formatted, and `customText` in `src/lib/prints/checkout.ts` should escape them.

## Never run for real

- Artelo's real API: Price Check, Create Order, Get Orders' `name` filter, Get Order by Id, the webhook's payload and signature, Get Catalog Product Costs and the webhook endpoints are all exercised against the stand-in. `prints:check` and the launch order are the first real runs (spec 25).
- Stripe's hosted page in test mode runs only where `STRIPE_TEST_SECRET_KEY` is set (`tests/e2e/prints-stripe.spec.ts` on 4338); it was written without a key and has never run, so its selectors on Stripe's page (plan 7, assumption 20) are unproven until CI or George runs it. They tolerate a line Stripe shows twice and a second submit button, but remain guesses until then. Stripe's live mode and its receipts run only at launch.
- The `EMAIL` binding: every test build sends to the sink. `/admin`'s `send me a test email` (launch step 15) is its first real run, before prints open.
- The cron under a real Cloudflare trigger: locally it runs through wrangler's local explorer (`/cdn-cgi/local/explorer/api/local/scheduled`).
- `prints:webhook --remote` and `prints:check --remote` were written and tested with `--local` only.

## Known gaps

- Spec 17.5 still names `country` and an unframed `frameStyle: null` for Get Catalog Product Costs; Artelo's reference requires `shippingDestination`, the three booleans and `frameStyle: "Unframed"`, which `prints:check` sends (plan 7, assumption 12). Correct the spec's wording when it is next edited.
- If Artelo's cancellation of a duplicate order names the site's order id rather than its own, the site cancels the real order (see the Task 11 line below). The guide's operating section tells George what to do.
- `mark resolved` (added after the final review) doesn't stop an attention email that is still due: if Email Sending fails, the cron keeps retrying it after George has resolved the order. A resolved order Artelo has is still polled every 12 hours for good (a refund-to-cancel order that printed anyway, say); that was kept on purpose so a later status still records, and costs one Artelo call per such order twice a day.
- `send me a test email` is proved while prints are closed in unit tests only; the e2e check runs on the prints server, which is open, because only the prints servers have the mail sink.

## Parked by reviews

Each was weighed in its task's review and parked, not missed:

- `tests/fixtures/artelo-site.mjs`: the stand-in replays a Stripe idempotency key whatever the parameters, where Stripe refuses a mismatch. Parked because nothing depends on it; match Stripe if a spec ever leans on idempotency (Task 7).
- `src/lib/prints/mail.ts`: an email that fails every time (a Stripe session with no email, a Stripe 404 after a key change, a bad `ADMIN_EMAIL`) is retried every five minutes, with a Stripe call each time for a shipped one, and 20 such rows would hold back newer due emails. Parked because starving the queue needs 20 of them and Checkout always collects the email; if repeats show in the logs, add a backoff or an attempt count (Task 8, [ADR-0025](../../adr/0025-print-emails-fail-towards-a-duplicate.md)).
- `src/lib/prints/mail.ts`: the log scrub misses a quoted local part with a space (`"john smith"@example.com`) and leaves `o'` of `o'brien@example.com`. Parked because Stripe returns plain addresses (Task 8).
- `src/lib/prints/place.ts` (`leftPaid`): that it touches nothing on another run's order is pinned through the lease but not through the master links (two mutants survive). Parked as harmless: the lease check already stops it (Task 9).
- `src/lib/prints/artelo-updates.ts`: an Artelo status matched by the site's own order id can apply a duplicate Artelo order's status, so cancelling the duplicate would cancel the real order, email "refund it in stripe" and make the real order's later shipped status ignored. Parked because it needs ADR-0026's near-impossible duplicate; the fix, if wanted, is to only record such an update when the order already holds a different Artelo id (Task 11).
- `src/lib/prints/place.ts`: an adopted order Artelo has already moved on is recorded `placed` first, so if applying its status then fails it shows `placed` with live master links until the poll. Parked because the poll heals it within 12 hours and the links expire in 72 (Task 11).
- `src/lib/prints/admin.ts`: the orders list query scans and sorts every listed order, twice. Parked because the list is bounded at 100 and the table is small; revisit if orders number in the thousands (Task 12).
- `src/lib/prints/daily.ts` with `src/lib/prints/stripe-events.ts`: an order the daily lookup flagged as unmatched can be moved back to `refunded` by a later `charge.refunded` under a new event id, and the next daily run flags it and emails George again. Parked because it can never reach `paid`, and Stripe sends no new full-refund event once a charge is refunded in full (Task 14).
- `src/lib/prints/daily.ts`: the webhook-missing email goes once a day for as long as the webhook is missing, and a failed send waits for the next day. Accepted by ruling, since `/admin` shows the state (Task 14).

## Known flakes

Load-only; each passes when rerun alone. Plan 5's list ([plan 5 follow-ups](2026-10-05-plan-5-followups.md), testing) carries the first three too.

- `tests/e2e/ingest.spec.ts:21` (a body over 32KB is refused with a 413): failed once under load in a full run (Task 10).
- `tests/e2e/ingest.spec.ts:32` (anything else under `/ingest` is a 404): answered 500 once in a full run (Task 7).
- `tests/e2e/prints-basket.spec.ts:67` (later batches of a carried basket's gallery keep it on their frames): failed once in 87 prints runs and passed 60 of 60 alone (Task 10).
- `tests/e2e/prints-admin.spec.ts:16` (the buffer) and `:29` (an order Artelo won't take, then retry now): fail only under stress (repeated runs at once), when wrangler's local D1 answers `internal error` to two readers of one store (Task 12).

## Assumptions to confirm

The [plan](2026-10-08-plan-7-prints.md)'s last section, "Assumptions about Stripe and Artelo", lists each assumption a task depends on, with how it is checked. The three launch answers above are the ones still open beyond spec 25's list.
