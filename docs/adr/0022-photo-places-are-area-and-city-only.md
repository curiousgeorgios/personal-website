# ADR-0022: A photograph's place is shown as area and city, and coordinates never leave George's Mac

- Status: Accepted
- Date: 2026-10-08
- Authors: George Vlachos

## Context

The gallery groups photographs into dated entries, one per original Instagram post, and George wants their locations shown. Most originals in his Photos library carry GPS coordinates (55 of 60 in a sample). The full-resolution delivery copies already have their location metadata stripped (ADR-0020), but the place itself is still worth showing. Exact coordinates of some photos could reveal his home or friends' addresses.

## Decision

The import step reads each original's GPS on George's Mac, turns it into a place name with macOS's own geocoder, and stores only "area, city" (for example "bondi, sydney") for each post. Coordinates are never stored in D1 or R2, never sent to the site and never sent to a third-party service. George can edit or hide any post's place in `/admin`.

## Consequences

Entries read like the log ("14.02.25 · bondi, sydney") without the site holding anything that pinpoints an address. Photos without GPS simply show no place. Geocoding needs macOS and runs only during preparation, like the RAW rendering already does. A place that is too revealing for a particular post has to be caught by George and edited or hidden.

## Alternatives considered

- **City or country only:** safest, but less interesting.
- **Exact spot with a map link:** most interesting, but some photos could pinpoint private addresses unless every one is checked.
- **An online geocoding service:** simpler to call, but sends George's coordinates to a third party.
