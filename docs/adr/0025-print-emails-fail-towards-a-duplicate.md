# ADR-0025: Print emails fail towards a rare duplicate, never a loss

- Status: Proposed
- Date: 2026-10-09
- Authors: George Vlachos

## Context

Print ordering sends three kinds of email from a five-minute cron: the buyer's "shipped" email, George's "needs attention" note and his note about a cancellation or a payment whose Stripe webhook never arrived (spec 18.4). Each is guarded by a column on the order so that two overlapping runs can't both send it. Spec 18.4 first set the guard to the send time in the same statement that claimed the send, so the claim was also the "sent" mark. Reviewing plan 7's Task 8 showed what that costs: when anything failed between the claim and the send (a D1 hiccup, the Worker being cut off, the release itself failing), the guard stayed set and nothing ever retried it. A scratch reproduction lost a buyer's shipped email for good. Every email is either a duplicate risk or a loss risk, and the design has to pick one.

## Decision

Emails fail towards a rare duplicate, never a silent loss. The claim stays one atomic conditional UPDATE, but it writes the claim time negated (in flight). A send that succeeds writes the time, and a send that fails gives the claim back (NULL, or 0 for `admin_notified_at`, where 0 means due). An in-flight claim older than 15 minutes counts as due again, in both the cron's due query and the claim's own condition, so a run that died part way is picked up by a later one. Spec 18.4 is amended to match.

## Consequences

No email can be lost to a crash or a failed write. A "needs attention" note is how George learns a paid order is stuck, so losing one would leave a buyer charged with nobody looking. The cost is that a Worker cut off after the provider accepted a send but before the "sent" write leaves a claim that is retried 15 minutes later, so the buyer, or George, gets that email twice. The guard columns now hold three kinds of value (empty or 0 for due, negative for sending, positive for sent), so anything that reads them, such as the admin orders section, must show a negative value as "sending", not as a time. An email that fails every time is retried every five minutes indefinitely; that is accepted for now and watched by the daily job.

## Alternatives considered

- **Mark sent at claim time (the spec's first design):** simplest and never duplicates, but a crash or a failed release loses the email silently.
- **Mark sent only after the send, with no claim:** never loses an email, but two overlapping cron runs would both send every due email.
- **A separate outbox table with attempt counts:** more robust, and it would also give failing emails a backoff, but it needs a migration and more code for three kinds of email.
