# ADR-0001: Redesign the site as a logbook with gallery-style wall labels

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

The site had not been touched in months and was built from v0 scaffolding: blurred gradient orbs, autoplaying audio, a section switcher and dozens of unused UI components. The brief for the redesign was that the site "should feel like you've briefly left the rest of the internet" and should carry George's values (plain English, craft shown before it's stated, no invented numbers). Four directions were mocked up and compared as working pages: a single-page letter (A), a field-notebook logbook with a living corner (B), a gallery of projects with museum wall labels (C) and an interactive top-down desk (D).

## Decision

We build direction B, the logbook, with small hints of C. The page is a field notebook: dot-grid paper, a red margin rule with lowercase mono labels in the margin, Schibsted Grotesk for text and DM Mono for labels and dates. Its sections are now, lately, a dated log, a listening corner, before, say hi and visitor info. From C we keep three things:

- Wall labels for things George made (what it's made of, the decision or lesson that mattered, a red "live and in use" dot). They open in place from an outlined "label" pill. The whole line is clickable and a small preview floats up out of the pill on hover.
- A closer look at each project preview, which grows out of its frame and returns to it.
- A "visitor info" block in place of a colophon (open whenever, entry free, cookies none, based Sydney and Canberra).

The degree of subtlety in the agreed mockup is deliberate: labels stay closed until asked for.

## Consequences

The page reads in a few seconds for casual visitors while the reasoning behind each project is one click away. Wall labels force a real reason per project, so label copy needs George's own words before launch; the mockup's "decision" lines were placeholders. A log that stops being updated starts to look abandoned, which is why updating has to be easy (see ADR-0004). Hover previews do not exist on touch screens, so the label pill stays visible there and tapping the line opens the label.

## Alternatives considered

- **A, the letter:** calm and low upkeep, but so quiet it could read as anyone's site if the writing isn't sharp.
- **C, the exhibition, as the whole site:** the strongest proof of craft, but it leans towards a portfolio and closer to "the rest of the internet".
- **D, the desk:** the most memorable, but slowest for getting facts from and hard to make work well on phones. Its idea of light following the time in Sydney carries over to the turntable.
