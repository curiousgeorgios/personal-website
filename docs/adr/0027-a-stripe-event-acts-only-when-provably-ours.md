# ADR-0027: A Stripe event changes a print order only when it is provably from the site's own checkout

- Status: Proposed
- Date: 2026-10-09
- Authors: George Vlachos

## Context

Print payments are confirmed by Stripe's webhook (spec 18.1), which is subscribed account-wide: it hears every checkout and every refund on George's Stripe account, not only print orders. Plan 7's Task 10 first treated any signed checkout event whose `client_reference_id` named an order as that order's payment. Reviewing it showed two problems. A Stripe Payment Link accepts `?client_reference_id=` in its URL, so a payment made through any Payment Link on the account could pay a print order, overwrite its stored payment and redirect the prints to the payer's own shipping address. And events from George's other Stripe uses (a refunded invoice, a Payment Link checkout) were answered with a 500, which Stripe retries for days and may eventually answer by disabling the endpoint, stopping real print webhooks too.

## Decision

A Stripe event changes a print order only when it is provably from the checkout the site created:

- A checkout event counts only when `metadata.order_id` equals `client_reference_id` (the site sets both; a Payment Link can set only the second), that value has a print order id's shape (a lowercase ULID, one pattern in `src/lib/prints/order-id.ts`; amended 2026-10-09) and, when the order row holds a `stripe_session_id`, the event's session is that one. The conditions are repeated in the writes themselves, not only in a read before them, and reconciliation applies the same match.
- A refund counts as ours when a stored order holds its payment intent. Stripe copies the payment intent's metadata, which checkout sets, onto the charge once, so a print order's charge names its order in `metadata.order_id`; but `order_id` is a common key (WooCommerce's Stripe gateway sets it), so naming an order alone isn't enough (amended 2026-10-09).
- An event that is ours but can't apply yet answers 500 so Stripe retries it. That is only a refund whose `metadata.order_id` has a print order id's shape and names an order still `checkout` or `expired`, waiting for the paid transition to store its intent, or one that stored this intent between the handler's two reads (amended 2026-10-09). Everything else that isn't ours, or that no retry can help (an expired session whose order row is gone, or a refund whose id has another shape or names no order still waiting for its payment), is recorded in the event ledger, logged by id and answered 200 with nothing changed.

## Consequences

No payment outside the site's own checkout can pay, expire or rewrite an order, and George can use Stripe for other things without the webhook failing. The refund rule rests on Stripe copying metadata to the charge, which its documentation states but the test stand-in only imitates, so one test-mode refund at launch confirms it. A genuine print checkout with mismatched metadata would be ignored by the webhook; the site writes both fields itself, and reconciliation still asks Stripe about every checkout older than 65 minutes. The 200-and-ignore paths depart from spec 18.1's first wording, which is amended.

## Alternatives considered

- **Trust `client_reference_id` alone:** Stripe's usual pattern, but any Payment Link on the account can set it.
- **Answer 500 for any event with no matching order:** safe against losing a print event, but every unrelated refund on the account would retry for days and risk the endpoint being disabled.
- **A separate Stripe account or restricted webhook for prints:** isolates the events completely, but adds an account to run for one small shop.
