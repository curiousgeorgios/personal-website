# Plan 3 follow-ups

What plan 3 (the admin page) found or left for later, by where it belongs.

## Plan 4 (snapshots and analytics)

Done in [plan 4](2026-10-05-plan-4-snapshots-analytics.md).

- The snapshots Worker writes `snapshot_status` with the values in `src/lib/snapshots.ts` (`ok`, `navigation-error`, `http-error`, `challenge`, `too-small`) and `snapshot_at` as an ISO time. The admin's snapshots section already reads both.
- Add the "re-shoot now" button to the snapshots section (a POST with an `intent`, like every other admin write) and the service binding it calls.
- Changing a line's page to snapshot clears its `snapshot_key`, time and status but leaves the old images in R2; the Worker's clean-up of superseded objects should cover them.
- The site-wide `Origin` rule covers `/ingest/i/v0/e/` too: the beacon's POST (fetch or `sendBeacon`) sends `Origin`, but a hand-made request or a test without it gets a 403.

## Later

- A record's files can't be replaced: remove the record and add it again.
- If deleting a record's files fails, the files stay in R2 and only a log line says so ("admin: couldn't delete a record's files" after a removal, "... a failed record's files" or "... an unneeded record's files" after an add). After a removal the row is already gone. And if a record's insert throws and the check for whether it saved also throws, the files are kept on purpose, since deleting the files of a row that exists would break it (logged as "admin: couldn't check whether the record saved, so its files were kept").
- Reloading the page after a save shows the "saved" line again, because it comes from the address.
- If D1 fails, `/admin` answers with a plain "the admin page couldn't load. try again." (status 500, with the admin headers) rather than a notebook-style page.
- A save from a stale page, for a line, entry or record removed elsewhere, that also has a field problem comes back 422 with no message, because its form isn't on the page any more.
- If the Access session has expired, a save may be blocked by the page's `form-action 'self'` rather than reach Access's sign-in page (to check on the iPhone at launch). Either way, reload the page to sign in again; the typed text (an upload included) is lost.
- After a failed save the page scrolls to the form but doesn't move focus to the first field with a message (`autofocus` would, without JavaScript).
- After a save the page lands at the top of the section, not the line just edited; on a phone with many lines that loses your place (land on `#item-<id>` with the notice beside it).
- A notice or alert that's already on the page when it loads (the saved line, the error banner) is rarely announced by screen readers.
- Activating two different records from two tabs at the same moment could leave seven active until one is deactivated (the check runs before the update; ADR-0012).

## Questions for George

- How long the Access session should last (a week is kinder on a phone; a day is tighter).
- Whether the Worker should also check the signed-in email against an `ADMIN_EMAIL` var, so `/admin` stays closed even if the Access policy is ever loosened by mistake (the final review recommends yes: it's one comparison and keeps /admin closed if the Access policy is ever loosened).

## Decisions made while building

Calls made during plan 3 without asking George, each easy to undo:

- An identical repeat of an add (a line, a log entry or a record) counts as already saved, and so do removing something already removed and activating a record that's already active. A double-tapped move still moves twice (ADR-0012).
- The empty-artist message is "the record needs an artist"; "mp3" stays lowercase beside "JPEG, PNG or WebP".
- The Access check pins RS256, logs why a token was refused (never the token) and refuses a mistyped team domain with a 403; the test-only bypass works only on localhost.
- Link checks refuse empty or blank link text, brackets and spaces in an address and `http:` links, but allow a link inside a bracketed aside like "(see [x](https://example.com))".
- A snapshot address must be `https://` with a host and no spaces, because plan 4's Worker will fetch it as typed.
- Snapshot dates show Sydney's date, since the nightly capture runs at 17:00 UTC.
- A record insert that throws is checked before its files are deleted, so a record that did save never loses its files.
- Saves run under `waitUntil` (with the purge), so a double tap that cancels the first request doesn't cut its save off half way.
- Page-level errors sit in a banner that stays at the top of the screen; something unexpected is a 500 with the same banner.
- Form fields have 3:1 borders, buttons and summaries are 44px tall, and iOS doesn't capitalise or autocorrect slugs and addresses.
- An add form keeps its own section (moving a line between sections is done from its edit form).
- The purge-failure notice says "the logbook may show the old version for a little while", because stale-while-revalidate can serve the old copy for longer than five minutes.
