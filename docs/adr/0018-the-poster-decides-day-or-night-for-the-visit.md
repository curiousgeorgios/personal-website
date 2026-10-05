# ADR-0018: The poster's day or night holds for the whole visit

- Status: Accepted
- Date: 2026-10-05
- Authors: George Vlachos

## Context

The listening corner's 3D scene lights itself by Sydney time: daylight, then golden hour from 16:00, then candlelight from 19:00 to 06:00. Until the scene's first frame, a poster stands in for it, and plan 5 added a night pair of posters, picked by an inline script before first paint, so the take-over from poster to scene doesn't jump from daylight to candlelight after dark. The page is edge-cached for a day, so only the visitor's browser can choose. The scene starts later than the poster is chosen, often seconds later and on phones only when the row comes near, so a visit that loads at 18:59 would show the day poster and then a candlelit scene if each read the clock for itself.

## Decision

The poster decides. The inline script that picks the night pair also marks the deck host with `data-night`, and the scene's light (`lightFor`) takes day or night from that mark for the rest of the visit instead of reading the clock again when the scene starts. Within the day the light still follows the clock (golden hour included), and after 19:00 a day visit holds golden hour at its last angle rather than turning to night.

## Consequences

Poster and scene always agree at take-over, whatever the visitor's own time zone; a review compared the script's rule with the scene's at every minute of two years and every second of the DST change days without a mismatch. A visit that spans 19:00 or 06:00 keeps its starting light until a reload, which is the honest reading of "the scene you saw is the scene you get". Without JavaScript there is no scene and the day poster shows. Changing the night hours means changing the inline script (and so its CSP hash, which a test pins) and the scene's rule together.

## Alternatives considered

- **The scene reads the clock when it starts:** simpler, but a visit that crosses 19:00 or 06:00 between load and take-over swaps the lighting, the jump the night posters exist to prevent.
- **A third poster pair for golden hour:** would match the late afternoon more closely, but golden hour is a gentle warm shift, not a jump, and isn't worth two more images.
