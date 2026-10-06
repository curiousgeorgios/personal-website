# ADR-0008: Deploy through GitHub Actions, gated on tests and budgets

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

The site deploys from `main` through Cloudflare Workers Builds and has no CI. The redesign adds behaviour that is easy to break without noticing (the listening corner's playback runner, the crate control, the privacy promises in the visitor info) and explicit performance budgets. George was offered GitHub Actions gating the deploy, GitHub Actions on pull requests only or a local check before pushing.

## Decision

Every push to `main` runs, in GitHub Actions: typecheck, unit tests, the build, Playwright in Chromium and WebKit, the performance budget check and the privacy smoke test. Only if all pass does the workflow apply D1 migrations (`wrangler d1 migrations apply DB --remote`) and deploy the site and snapshots Workers. Workers Builds is disconnected. Pull requests run the same checks without deploying.

## Consequences

A broken turntable, a blown budget or a stray cookie cannot reach production. Deploys take a few minutes longer than a direct Workers Builds deploy, and the GitHub repository needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Real-device Safari checks for audio stay a manual launch step, because Playwright's WebKit does not enforce the user-gesture rule.

## Alternatives considered

- **GitHub Actions on pull requests only:** checks exist, but pushing straight to `main` still deploys unchecked.
- **A local check before pushing:** fastest, but relies on remembering to run it.
