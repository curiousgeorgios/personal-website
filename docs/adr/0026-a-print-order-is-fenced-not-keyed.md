# ADR-0026: A paid order reaches Artelo once through a lease fence and a lookup, not an idempotency key

- Status: Proposed
- Date: 2026-10-09
- Authors: George Vlachos

## Context

Once a buyer has paid, the site places one Artelo order for every print (spec 18.2), from the Stripe webhook, the five-minute cron or George's "retry now". The two failures that matter are printing twice and never printing. Plan 7's Task 9 claims a paid order with a 120-second lease and looks the order up at Artelo by our order id before every create. Reviewing it showed a gap: if an attempt ran past its lease (only possible when D1 or R2 stalls for over a minute), a second run could claim the order, find nothing at the lookup while the first create was still in flight, and create a second Artelo order. The first Artelo id was then overwritten, so the double print would show nowhere. The obvious fix, an idempotency key on Artelo's create, isn't available: Artelo documents none, and spec 25 assumption 8 records that it doesn't refuse a duplicate `orderId`.

## Decision

Three rules together keep a paid order to one Artelo order:

- **The lookup fails closed.** Before every create, the site searches Artelo for our order id. Only an empty answer means "not found"; an answer that doesn't clearly name our order counts as unreadable and is retried, never followed by a create.
- **The create is fenced.** Immediately before the create, a conditional UPDATE refreshes the lease to 120 seconds, but only if the order is still `paid` and the lease is still the one this attempt wrote. If nothing changes, the attempt stops without creating. The create has a 15-second timeout, so no other run can claim the order while it is in flight.
- **The first Artelo id is kept.** Recording a result never overwrites a different Artelo id; if two ever meet, both are written to the Worker's error log with our order id.

## Consequences

A second create now needs a D1 stall between the fence and the request leaving the Worker, which is not a realistic window, and a refund that lands before the fence stops the create. Because a duplicate is that unlikely, it raises no email or `needs_attention` copy; if one ever happened it would show only in Workers Logs, and George would cancel it at Artelo by hand. The design leans entirely on Artelo's order search finding an order the moment it is created, so `prints:check` must prove that against a just-created order before launch (spec 25 assumption 8); index lag would defeat the lookup. An unreadable lookup costs a retry and, after 24 hours, a `needs_attention` order for George, never a duplicate.

## Alternatives considered

- **An idempotency key on Artelo's create:** the standard fix, but Artelo documents none, so sending one would be untested and give false comfort.
- **A longer lease:** narrows the window without closing it, and slows recovery after a crashed attempt.
- **Flag a duplicate as `needs_attention` with its own email:** more visible, but it needs new copy and a new state for a case the fence already makes practically impossible.
