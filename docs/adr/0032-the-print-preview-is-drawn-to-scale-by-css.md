# ADR-0032: The print preview is drawn to scale by CSS, with an illustrative frame

- Status: Accepted
- Date: 2026-10-14
- Authors: Claude, for George Vlachos

## Context

George asked for buyers to see the chosen photograph unframed or in oak, and for the size choice to make a visible difference ([handoff](../print-preview-handoff.md)). The print row was a plain get form with no script (spec 15.1), the photo page's mobile LCP is already above target, and the CSP allows no inline style attributes. Fitting each size into the same box would hide the difference between sizes.

Artelo's [framing page](https://www.artelo.com/framing) lists a standard oak profile (1.4 × 1.6 cm, acrylic) and a premium one (1.8 × 2.6 cm, glass). These are profile specifications. They do not establish which profile our `NaturalOak` payload selects ([create-order contract](https://www.artelo.com/artelo-api/documentation/orders/create)), the visible opening, how much of the paper the frame's lip covers or the outer size. We have not verified those details. Artelo's descriptions of frame assembly also conflict ([bulk-order tutorial](https://help.artelo.com/en/articles/10471480-bulk-uploading-orders-tutorial) against the create-order documentation), so we have not verified that either. The build environment could not fetch Artelo's pages; George's reviewer read them directly.

## Decision

The preview is drawn on one scale per orientation, against centimetre rulers that read 0 at the paper's corner. The drawing area is fixed by the catalogue's largest size and frame, so a small looks small on every page and the controls never move. The other sizes the photograph gets are dashed outlines at their own sizes.

The radios drive the drawing through CSS `:has()`, so it works without JavaScript. A browser without `:has()` keeps the plain row. One small inline script fills a hidden `role="status"` line, so a screen reader hears the size, frame and price together.

The paper reuses the photo page's own `<picture>` sources and sizes, lazily, so the browser takes the copy it already has. It is cropped from the centre with `object-fit: cover`, as Artelo's Outside fit cuts it. No master or new image is fetched.

Per-family sizes live in `prints.css` by family class, because the CSP forbids style attributes. A unit test holds them to `FAMILIES`, and a browser test measures every family's drawn sizes.

The oak moulding is drawn outside the paper with an illustrative 1.5 cm face and no mat. The paper's dimensions and centre crop match the selected catalogue option exactly. The page names the print's dimensions only, never an outer frame size, says the frame is illustrative and makes no ready-to-hang promise. The supplier payload, prices, catalogue and `PRINTS_OPEN` are unchanged.

## Consequences

- The size difference is visible and measurable, and the preview, caption, radios and basket share one state.
- The page gains about 1KB of gzipped CSS and a script of a few hundred bytes. The CSS family table must change whenever `FAMILIES` does, and the unit test fails until it does.
- The frame profile `NaturalOak` selects, its overlap with the paper and whether it arrives assembled (`includeFramingService: false`; Artelo's bulk-order tutorial and API documentation disagree) stay unverified. These need Artelo's confirmation or the first physical sample before the drawing or copy claims supplier accuracy. Fulfilment settings stay as they are until then.
- The cloud evidence was Chromium only. On 14 October Codex checked the preview, photo page and gallery in genuine macOS WebKit on desktop and an iPhone-sized project. CI now runs the preview spec in Chromium, WebKit and the phone project. Late-image checks compare geometry in every browser and retain the CLS limit where that metric is exposed.
