# ADR-0012: An identical repeat of an admin add counts as already saved

- Status: Proposed
- Date: 2026-10-04
- Authors: George Vlachos

## Context

The admin page has no JavaScript (spec 7), so nothing stops a double tap on a slow phone from sending the same form twice, and the browser shows the answer to the second request. A review of plan 3 showed the consequences: a log entry was saved twice, a second copy of a line came back as "that slug is taken" although the first had saved, and a record could be added twice with both uploads stored. Checking for a duplicate before inserting doesn't close the gap, because two requests that arrive together can both pass the check.

## Decision

An add that repeats one already saved is treated as that save and adds nothing:

- a line with the same slug, section and text;
- a log entry with the same date, precision and text;
- a record with the same title and artist that is already in the crate (active).

Each insert checks this in the same SQL statement (`ON CONFLICT (slug) DO NOTHING` for lines, `INSERT … SELECT … WHERE NOT EXISTS` for log entries and records, the record insert also checking the six-record cap), so two requests at once can't both add. When a record insert adds nothing, the files it just uploaded are deleted again. A slug used by a different line is still refused with a message.

## Consequences

A double tap, a resent form or two tabs saving the same thing leave one copy and show "saved". A second record with the same title and artist can't be added while the first is in the crate, and the six-record cap can't be passed by two adds at once. Deliberately adding an identical log entry (same date and text) is no longer possible, which is unlikely to matter. The store's add functions return 0 when they add nothing, and the actions decide whether that means "already saved" or a refusal.

## Alternatives considered

- **Disable the button with JavaScript:** the admin page is deliberately script-free, and it wouldn't cover two tabs or a resent form.
- **Check, then insert:** simpler to read, but two requests arriving together can both pass the check.
- **A one-time token per form:** handles every case, but needs server-side state for each rendered form, which the site otherwise avoids (no sessions, no cookies).
