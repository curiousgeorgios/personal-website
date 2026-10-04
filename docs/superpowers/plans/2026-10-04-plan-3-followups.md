# Plan 3 follow-ups

What plan 3 (the admin page) found or left for later, by where it belongs.

## Plan 4 (snapshots and analytics)

- The snapshots Worker writes `snapshot_status` with the values in `src/lib/snapshots.ts` (`ok`, `navigation-error`, `http-error`, `challenge`, `too-small`) and `snapshot_at` as an ISO time. The admin's snapshots section already reads both.
- Add the "re-shoot now" button to the snapshots section (a POST with an `intent`, like every other admin write) and the service binding it calls.
- Changing a line's page to snapshot clears its `snapshot_key`, time and status but leaves the old images in R2; the Worker's clean-up of superseded objects should cover them.
- The site-wide `Origin` rule covers `/ingest/i/v0/e/` too: the beacon's POST (fetch or `sendBeacon`) sends `Origin`, but a hand-made request or a test without it gets a 403.

## Later

- A record's files can't be replaced: remove the record and add it again.
- If deleting a record's files fails, the files stay in R2 and only a log line says so ("admin: couldn't delete a record's files" after a removal, "... a failed record's files" or "... an unneeded record's files" after an add). After a removal the row is already gone. And if a record's insert throws and the check for whether it saved also throws, the files are kept on purpose, since deleting the files of a row that exists would break it (logged as "admin: couldn't check whether the record saved, so its files were kept").
- Reloading the page after a save shows the "saved" line again, because it comes from the address.
- If D1 fails, `/admin` shows Astro's error page rather than a notebook-style message.
- A save from a stale page, for a line, entry or record removed elsewhere, that also has a field problem comes back 422 with no message, because its form isn't on the page any more.
- If the Access session has expired, a save is answered with Access's sign-in redirect and its form data is lost (an upload included); sign in again and redo it.
- After a failed save the page scrolls to the form but doesn't move focus to the first field with a message (`autofocus` would, without JavaScript).
- Activating two different records from two tabs at the same moment could leave seven active until one is deactivated (the check runs before the update; ADR-0012).

## Questions for George

- How long the Access session should last (a week is kinder on a phone; a day is tighter).
- Whether the Worker should also check the signed-in email against an `ADMIN_EMAIL` var, so `/admin` stays closed even if the Access policy is ever loosened by mistake.
