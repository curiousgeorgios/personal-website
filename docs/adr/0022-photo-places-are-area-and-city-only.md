# ADR-0022: A photograph's place is shown as area and city, and its coordinates never reach the site

- Status: Accepted
- Date: 2026-10-08
- Authors: George Vlachos

## Context

The gallery groups photographs into dated entries, one per original Instagram post, and George wants their locations shown. Most originals in his Photos library carry GPS coordinates (55 of 60 in a sample). The full-resolution delivery copies already have their location metadata stripped (ADR-0020), but the place itself is still worth showing. Exact coordinates of some photos could reveal his home or friends' addresses.

## Decision

The import step reads each original's GPS on George's Mac, turns it into a place name with Apple's geocoder through macOS, and stores only "area, city" (for example "bondi, sydney") for each post. Coordinates are never stored in D1 or R2, never sent to the site and never sent to anyone but Apple's geocoding service (see the amendment below). George can edit or hide any post's place in `/admin`.

Amended 2026-10-08 at George's direction: the place lookup uses Apple's geocoder through macOS (the same service Photos uses to name places), and that service is not on the Mac. Each photo's coordinates are sent to Apple's geocoding service once, at import, from George's Mac, and the answer is cached there so they aren't sent again. They are never stored in D1 or R2, never sent to the site and never sent to anyone else. Only "area, city" is kept.

## Consequences

A lookup that fails on a later import never erases a place found earlier: the import keeps the existing place unless George has edited or cleared it in `/admin`, which always wins. Entries read like the log ("14.02.25 · bondi, sydney") without the site holding anything that pinpoints an address. Photos without GPS simply show no place. Geocoding needs macOS and a network connection to Apple's geocoding service, and runs only during preparation, like the RAW rendering already does. A place that is too revealing for a particular post has to be caught by George and edited or hidden.

## Alternatives considered

- **City or country only:** safest, but less interesting.
- **Exact spot with a map link:** most interesting, but some photos could pinpoint private addresses unless every one is checked.
- **Another online geocoding service:** simpler to call from Node, but sends George's coordinates to a further company as well as Apple, which Photos already uses for these places.
- **An offline geocoder with bundled place data:** nothing leaves the Mac, but it needs a bundled boundaries dataset and a day's extra work, and names places less well outside Australia.
