# ADR-0004: Update the logbook through a private admin page backed by D1

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

The logbook (ADR-0001) only works if it stays current: dated log entries, what's on the shelf and in the kettle and the records in the listening corner. A log that stops being updated looks abandoned, so updating has to be easy enough that it actually happens. George was offered editing a content file in the repo, posting from a Telegram bot, a private admin page or pulling data automatically from services such as last.fm, Literal and Strava.

## Decision

Living content is edited through a private `/admin` page protected by Cloudflare Access and stored in Cloudflare D1. The admin page covers log entries, the "lately" facts and the record crate (including uploading a track and its cover to R2).

## Consequences

George can update the site from his phone without opening a laptop or deploying. The site needs a D1 database with migrations (applied with `wrangler d1 migrations apply`), a Cloudflare Access policy, R2 for uploads and server-side validation on every admin write. Public pages read from D1, so they should be cached at the edge and fall back gracefully if D1 is unavailable. The admin page is a new surface to secure and maintain.

## Alternatives considered

- **Edit a content file and deploy:** zero infrastructure, but needs a laptop and a deploy for every small update.
- **Post from a Telegram bot:** fits the theme, but adds bot authentication and message parsing to build and secure.
- **Pull from services automatically:** truly live, but depends on accounts George may not use and on third-party APIs staying up.
