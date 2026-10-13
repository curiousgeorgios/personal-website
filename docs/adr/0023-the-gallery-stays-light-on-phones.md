# ADR-0023: The gallery stays light on phones: small previews, two entries a page and loading only after a scroll

- Status: Accepted
- Date: 2026-10-08
- Authors: George Vlachos

## Context

The `/photos` page shows each Instagram post as a dated entry with a contact sheet of its photographs, and the gallery spec sets a budget of 250KB of images loaded before any scroll at 375 × 812, the same discipline as the logbook. Measured against George's real photographs (the newest four posts, 68 frames, the first with 20), the first design blew that budget badly: 374KB at 1× and 1,235KB on a 3× phone. Two causes: with responsive images, a 3× phone picks the 480 preview for a 59px-wide frame, and Chromium's lazy loading fetches images 1,250 to 3,000px below the screen, so a long first page of "lazy" thumbnails still downloads up front. The page loads older entries by itself as the visitor nears the end, and with a short first page that trigger could already be in range on load.

## Decision

- On phones (the notebook's 680px breakpoint) contact-sheet frames are offered only the 240-pixel preview, at every screen density. The photograph's own page still shows the large one.
- A server-rendered gallery page holds two entries; the catalogue API's batches stay at four.
- The script that loads older entries starts watching only after the visitor scrolls (scroll, wheel or touch), presses a scrolling key without a modifier, or focuses the "older entries" link. Nothing is fetched on load.

## Consequences

The first screen on a real 3× phone fell from 1,235KB to 198KB, and at 1× from 374KB to 198KB; a page of two 20-frame posts, the worst case, is about 225KB. Thumbnails on 3× phones are a little soft, an accepted trade for a contact sheet whose job is to be scanned, with sharp images one tap away. Visitors see two entries before scrolling instead of four, and the next batch arrives as they scroll. Without JavaScript, "older entries" stays a plain link. The budget test now runs on fixture previews generated to weigh what real ones do, so it measures something real.

## Alternatives considered

- **Offer phones the 480 previews:** sharper on 3× screens, but over four times the budget on George's real photographs.
- **Keep four entries on the first page:** more to browse at once, but about 293KB with three entries and 374KB with four, both over budget.
- **Count only the frames on screen in the budget:** would pass the test without changing what a phone actually downloads.
- **Start loading older entries straight away:** simpler, but on a two-entry page it fetched about 300KB more before the visitor did anything.
