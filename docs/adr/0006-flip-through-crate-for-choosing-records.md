# ADR-0006: Choose records by flipping through a crate, with the track list driving it

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

In the first versions of the listening corner (ADR-0005), the record sleeves lay fanned and overlapping on top of the console. George found them "to close and hard to click" and asked for "a better way to select through the vinyl".

## Decision

Records stand upright in a small walnut crate on the console with their covers facing the visitor. Each record pivots on its bottom edge: the records in front of the one being viewed tip forward, the rest lean back, so one cover is fully visible at a time. The rules:

- A small control on the console's front edge, under the crate, reads `‹ ▶ title ›`. It is the primary way to flip and play, with arrows that grey out at either end and while a record is travelling. Its geometry is fixed (three fixed columns): the label is always just the title, truncated if needed, and state is shown by the icon morphing between play and stop (dimmed while cueing), so nothing in the control moves or resizes as states change or things are hovered.
- Clicking the visible cover, or anywhere on the crate, plays that record; clicking the cover of the record that is playing stops it. Clicking a record in front of or behind the cover flips one step.
- Hovering the 3D crate previews the click (the cover lifts or the nearest record starts to tip) and highlights the matching button in the control.
- A second press on the same record within 450 ms is ignored, so a double-click plays rather than playing then stopping. Fast repeated flips retarget the same animation instead of stacking new ones.
- Hovering or focusing a track in the HTML list flips the crate to that record, and the list marks which record is in view.
- Easter egg: dragging the spinning record scratches it (the platter follows the pointer and the playback rate bends with it), and letting go spins it back up. A plain click on the record still stops it.

## Consequences

The click target is one large cover rather than overlapping slivers, and browsing mirrors a familiar physical gesture. The crate raises the top of the scene, because a sleeve lifts out of it before its record slides free, so the camera frames a taller scene and the console appears a little smaller. Only one cover is fully visible at a time, so the HTML list remains the quickest way to see every record at once.

## Alternatives considered

- **Sleeves fanned flat on the console:** the original layout, rejected as too close together and hard to click.
