# Interactive print preview handoff for Claude

George wants buyers on curiousgeorge.dev to see their selected photograph unframed or in oak, with a meaningful visual change when they choose a print size. Claude owns the design and UI implementation. Build the feature in the existing notebook style and return a tested implementation for review.

## Repository and live state

Start from `curiousgeorgios/personal-website` main at `3f8b4d1cc342b6c47f7700ba8a481e5c4537c558`, or a newer main containing it. PR #6 opened ordering on 14 October. The live catalogue has 458 published photographs and four private holds. The main pipeline passed 1,126 unit tests, 493 browser tests and five live privacy/media checks. Live selection and a two-item basket passed. Physical fulfilment and the first real sample remain unverified.

The public example is https://curiousgeorge.dev/photos/DdxL8f5kh3c-01. Use public responsive previews, never private masters, download grants or owner-only images. Existing publication and print-readiness gates must continue to control whether ordering appears.

## Buyer behaviour

1. Show a preview of the selected photo beside or near the existing print choices. Preserve a way to see the original photograph.
2. Switching unframed to oak changes the same artwork's presentation immediately. Unframed is edge to edge. The oak option has no mat or invented white border, matching the current product payload.
3. Switching small, medium or large changes its visible size against a consistent scale or reference. Fitting every selected size independently into the same maximum rectangle would hide the difference and does not satisfy this request. Reserve the largest required space so the controls do not jump.
4. Show the selected dimensions in inches and centimetres, with portrait or landscape axes in the correct order. Identify these as print dimensions. Show exact outer-frame dimensions only when verified separately.
5. The preview, selected size/frame, selected price and submitted basket values agree. Use the existing offer list and price data; offer no unavailable tier.
6. Match the selected product's centred edge-to-edge crop. The existing catalogue permits up to 3% cropping. Represent it rather than fitting the full source inside a different ratio or stretching it.
7. Keep the radio groups and add-to-basket form usable with a keyboard, on touch screens and without JavaScript. If a small script is needed, add progressive enhancement and retain a useful static preview. Announce selection information accessibly and respect reduced motion.
8. Keep the preview lightweight. Reuse public responsive image assets and the existing page's image when appropriate. Avoid a new framework, 3D runtime, generated replacement photograph or external mockup service. A brief illustrative-preview label can distinguish screen appearance from physical colour and timber grain without obscuring the product choices.

Claude should choose the layout and visual treatment. A front-facing product view and a consistent size reference are suitable options; the design need not invent a room, furnishings or a person.

## Product contract

`src/lib/prints/catalogue.ts` is the source for available sizes and orientations. `printsFor(width, height)` selects one of five ratio families and filters tiers at 200 PPI or higher, with a 3% crop limit. The families are 2:3, 3:4, 4:5, ISO A and square. For 2:3, the tiers are 8 × 12, 12 × 18 and 16 × 24 inches. Other families use different dimensions, so do not hard-code those sizes for every photo. Use the physical dimensions from the selected offer and rotate them for horizontal images.

`src/lib/prints/artelo.ts` sends `IndividualArtPrint`, `ArchivalMatteFineArt`, `NaturalOak` or `Unframed`, no mats and `fitOptions: { canvas: "Paper", style: "Outside" }`. Artelo documents Outside as filling the canvas by cropping the larger image dimension. The current product has `includeFramingService: false` and `includeHangingPins: false`; do not change supplier options or pricing to make a mockup look nicer.

Verify the exact frame profile mapping before claiming supplier-accurate frame geometry. Artelo's current framing page lists standard oak at 1.4 × 1.6cm with acrylic and premium oak at 1.8 × 2.6cm with glass. Those are profile specifications, not automatically exact outer dimensions or visible openings. The API option currently used is NaturalOak; do not infer which current marketing profile it maps to from the code comment alone. Use provider geometry if available, otherwise label the frame appearance as illustrative and report the unverified measurements.

Artelo's documentation also differs on frame assembly: its bulk-order tutorial says a false framing-service flag ships the print and frame separately, while its create-order documentation says this flag is relevant only to unframed products or frames without prints. Verify the current product's treatment before promising ready-to-hang delivery. This preview task does not authorise changes to the product contract or supplier charges.

Provider sources, checked 14 October 2026:

- [Framing profiles](https://www.artelo.com/framing)
- [Create-order product and image-fit contract](https://www.artelo.com/artelo-api/documentation/orders/create)
- [Frame assembly wording in bulk-order tutorial](https://help.artelo.com/en/articles/10471480-bulk-uploading-orders-tutorial)
- [Printing file guidelines](https://help.artelo.com/en/articles/11943177-artelo-printing-file-guidelines)

## Relevant implementation and checks

Read `src/components/photos/PhotoView.astro`, `src/components/prints/PrintRow.astro`, `src/pages/photos/[id].astro`, `src/lib/prints/catalogue.ts`, `src/lib/prints/artelo.ts`, `src/lib/photos/gallery.ts`, `src/styles/photos.css` and `src/styles/prints.css`. Existing tests include `tests/unit/print-row.test.ts`, `tests/unit/catalogue.test.ts`, `tests/e2e/prints-basket.spec.ts`, `tests/e2e/budgets.spec.ts` and `tests/e2e/privacy.spec.ts`. Consult the plan 6/7 specification and ADRs for the existing privacy, basket and page budgets.

Amend the old no-script print-row specification and tests only to the extent needed for the chosen preview implementation. Preserve the 10KiB JavaScript, 15KiB CSS and 30KiB HTML budgets unless a justified change is reviewed. The existing mobile LCP measurements are already over target; do not add to that problem. Do not weaken privacy tests or the private-master boundary.

Add meaningful tests for proportional size changes, correct portrait/landscape crop, oak/unframed state and agreement between preview and basket values. Cover all ratio families, a photo with only one available tier and one with no print offers. Exercise mouse, keyboard, touch-sized layout, reduced motion and no-JavaScript behaviour. Inspect actual desktop and phone-sized screenshots. Use synthetic fixtures for local D1 tests and provider stand-ins; the cloud task has no need for production secrets or real orders.

Use Bun for package commands. Run type checking, the relevant unit and browser tests, the production build and the built-Worker guard. Preserve existing test hooks only in fixture builds. Read current repo instructions before changing files.

## Delivery and release boundary

Include the current live-release documentation updates and this handoff in the proposed feature changes. Report the design choice, changed files, validation results and screenshots, along with any remaining supplier-geometry or assembly question. Keep the existing published catalogue, live opening configuration, prices and fulfilment behaviour intact.

George's standing rule is commit only when asked and never push. This handoff authorises design and implementation in the cloud task, not a production release. Prepare the reviewable result and stop before commit, push, merge or deployment approval. Do not enter provider credentials, accept terms, change provider accounts, place orders or send messages to others.

## Outcome, 14 October 2026

Claude built the preview as [ADR-0032](adr/0032-the-print-preview-is-drawn-to-scale-by-css.md) (Proposed) describes, and amended spec 15.1 and 23.1 to match. Each size is drawn on one fixed scale per orientation against centimetre rulers, with the photograph's other sizes as dashed outlines. The radios drive it through CSS `:has()`, so it works without JavaScript. A script of under 200 gzipped bytes announces the caption to screen readers. The preview reuses the page's own image and fetches no new image. On the fixture photo page, JavaScript rose from 967 to 1,139 bytes, CSS from 4,223 to 5,320 and HTML from 6,689 to 8,356, all gzipped. Each remains within its budget.

George's decision: keep the 1.5 cm oak face explicitly illustrative. The paper's dimensions and centre crop match the selected catalogue option. There is no mat, no exact outer-frame dimension and no ready-to-hang promise. The supplier payload, prices, catalogue and `PRINTS_OPEN` are unchanged. These unknowns do not block the labelled preview.

Artelo's framing page lists standard oak at 1.4 × 1.6 cm and premium oak at 1.8 × 2.6 cm. We have not verified the following for our actual payload:

- Which profile `NaturalOak` selects.
- The frame's visible opening, lip overlap and outer dimensions.
- Whether `includeFramingService: false` ships the print and frame separately for a framed product. The bulk-order tutorial and the create-order documentation disagree, and fulfilment settings are not changed on inference.

Artelo support or the first physical sample should settle these questions.

Validation in the cloud task:

- Type checking: no errors.
- Unit tests (`bun run test:unit`): 1,146 passed, 0 failed, 0 skipped, against 1,126 on the base commit in the same environment. The 20 new tests are 14 in `print-preview.test.ts` and 6 in `print-row.test.ts`. One existing test was renamed and kept, with its no-script check changed to "exactly one script, the preview's".
- Browser tests: 15 new tests pass, and the existing prints, budgets, privacy, photo-page, photos, gallery, layout and head suites pass.
- Production build and the built-Worker guard: pass.

All browser runs were in Chromium, the only browser in the container. The phone project also ran in Chromium instead of WebKit, so a genuine WebKit check is still needed before release.

## WebKit and release approval, 14 October 2026

George authorised Codex to run the WebKit checks, then merge and deploy if all checks pass. The local check used genuine macOS WebKit for the preview, photo-page and gallery suites in the desktop and iPhone projects. The combined run passed 78 tests with two intentional gallery skips; the remaining two keyboard tests passed in a focused run after using macOS Safari's Option-Tab navigation. A responsive image's intrinsic-ratio rounding moved the layout by 0.16 CSS pixels, so the added geometry check allows less than half a CSS pixel in every axis while Chromium retains its CLS limit of 0.01. Original failing traces and the corrected runs are saved in reports/print-previews-2026-10-14 on George's Mac and excluded from Git.

The preview spec now runs in Chromium, WebKit and the iPhone project in CI. The release still requires the PR checks and main deployment pipeline to pass. Supplier choices, prices, opening settings and the illustrative-frame boundary are unchanged.
