# ADR-0033: Photo downloads require approved email codes

- Status: Accepted
- Date: 2026-10-14
- Source: George requested emailed one-time codes with a session lasting a couple of weeks. He clarified that access is only for people he approves.
- Supersedes: ADR-0020's human bearer-link access. Its private storage, delivery and Artelo order grants remain.

## Decision

Integrated local checks passed. On 14 October 2026 George approved committing, pushing, creating a PR and merging/deploying after required CI passes. Production release remains pending that CI gate.

George approves individual email addresses in the existing owner-only administration. Approval covers every published, undeleted photograph. The recipient visits `/photos/downloads`, requests a six-digit email code and enters it in the same browser. No password or external identity service is introduced. The download is the prepared full-resolution sRGB JPEG, not a RAW source file.

Codes expire ten minutes after request, work once and allow five attempts. A 60-second resend cooldown and durable D1 limits of three requests per hour and ten per day per address, plus twenty per hour per client, limit guessing and mailbox abuse. Resending replaces the previous challenge. Codes only become usable after the email service accepts the message. Unapproved addresses receive the same public response but no email, approval or session.

The code is bound to a random HttpOnly browser challenge cookie. Consuming it and creating a fresh opaque session happen in a single D1 transaction; concurrent verification creates at most one session. The session lasts fourteen days from sign-in, without sliding renewal. It uses a `__Host-` cookie with Secure, HttpOnly, SameSite=Lax and Path=/, and has no Domain attribute. Every write requires an exact same-origin Origin header. UI fetches explicitly use `referrerPolicy: "same-origin"` so private pages' no-referrer policy does not suppress their Origin.

Each download checks the stored session and the current approval before reading R2, including HEAD, range and conditional requests. Hiding or deleting a photograph excludes it immediately. Revoking an email removes its pending codes and sessions, erases its stored address and stops subsequent downloads. Reapproval creates a new approval identifier, so old sessions or codes never revive. Logout removes the session server-side and clears both cookies.

Human catalogue tokens cannot authorise a page, catalogue API or attachment. Old issue-link routes and forms refuse new grants. Existing catalogue records may still be revoked. There is no automatic email approval migration because bearer links identify no recipient. George must approve recipients by address. Internal photo-scoped grants that carry a print order remain valid for Artelo, including fulfilment of hidden or deleted photographs.

## Data and operations

The existing `PHOTO_LINK_SECRET` supplies domain-separated HMACs for email lookup, client limits and codes. Session and challenge tokens are random 256-bit values; only their SHA-256 hashes are stored. Codes, cookies, URLs, client addresses and provider error objects are never logged. Email addresses are stored only for active owner approvals; unapproved attempts retain keyed hashes solely for temporary abuse limits. Approval addresses are private, separate from payment/order records and never passed to analytics.

The existing Cloudflare EMAIL binding sends the code from the configured sender. A test-only mail sink permits wholly synthetic tests without sending mail. Expiry is enforced on access even before cleanup runs. The existing daily cleanup removes expired challenges, sessions and limit counters, plus revoked approval metadata after thirty days.

Migration 0010 adds these tables without altering photos, masters, order records or supplier grants. Production migration and release use the existing main-only GitHub Actions path after release approval and required checks. Ordinary browsing and analytics remain cookieless. Optional download sign-in uses essential cookies, which the visitor and checkout copy must explain.

## Validation

Unit checks cover input validation, unapproved addresses, concurrency, five-guess lockout, expiry, resend and client/email limits, delivery failure, transactional rollback, session rotation, logout, immediate revocation and reapproval. Download checks cover private responses, publication, deletion, byte ranges, conditional requests and legacy-link rejection. Artelo order-grant tests independently cover supplier delivery and revocation. Integrated local acceptance passed 1190 unit tests and 40 targeted browser checks across Chromium, WebKit and phone projects, including the actual HTTPS local D1/cookie flow. Fourteen backend HTTP checks intentionally run once rather than repeating across browser engines. Typechecking, production build and Worker binding checks passed; required release CI remains separate.

References: [Cloudflare email Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [D1 transactional batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
