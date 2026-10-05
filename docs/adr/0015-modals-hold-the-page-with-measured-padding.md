# ADR-0015: A modal holds the page still with the scrollbar's measured width, not scrollbar-gutter

- Status: Proposed
- Date: 2026-10-05
- Authors: George Vlachos

## Context

The closer look (plan 4) opens a snapshot in a modal dialog and stops the page scrolling behind it with `overflow: hidden` on the root. Where scrollbars are classic rather than overlaid (Windows by default, and any system set to always show them), that removes the scrollbar, so the page jumps sideways by its width as the dialog opens and the image grown from its frame lands beside the frame on the way back. `scrollbar-gutter: stable` on the root is the standard fix and the one a reviewer proposed, but an end-to-end check with a real 15px scrollbar in Chromium 153 showed the line still moving 7.5px with it in place: Chromium reserved no gutter from the root.

## Decision

Before `showModal()`, the closer look measures the scrollbar as `innerWidth - document.documentElement.clientWidth` and, when it is above zero, sets that width as `padding-right` on `<html>`; every way the dialog closes clears it. The root gets no `scrollbar-gutter` rule, so an engine that honours one can't add the space twice. Any later modal that hides the root's overflow does the same.

## Consequences

The page and the frame stay put on every platform measured, and overlay-scrollbar platforms (macOS by default, phones) measure zero and get no padding. The cost is a few lines of script on every modal and a style written to `<html>` that each close path must clear; a missed path would leave the page padded until reload. A Chromium-only check forces a classic scrollbar and fails if the page moves. Firefox and Safari with scrollbars always shown have not been measured.

## Alternatives considered

- **`scrollbar-gutter: stable` on the root while the dialog is open:** CSS only and the documented fix, but it did not hold in Chromium on the root.
- **Leave the jump:** invisible where scrollbars overlay, but a shift of half a scrollbar on Windows and a layout-shift cost against spec 11's budget.
