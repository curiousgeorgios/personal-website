# ADR-0007: Rebuild the site with Astro on Cloudflare Workers for visitor performance

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

The existing site is a Next.js 14 app on Cloudflare via OpenNext. George's other recent projects (Digital Nachos, canberra.events) use Next.js 15 and React 19 on Workers, so that was the default. When asked how to build the redesign, George asked which option gives the highest performance. The redesigned page is a single, mostly static logbook with a few small interactive pieces and a 3D listening corner that loads on approach.

## Decision

We rebuild the site with Astro 7 and its Cloudflare adapter, deployed as a Worker with static assets. Pages ship plain HTML and CSS with no framework runtime; interactivity lives in small vanilla TypeScript page scripts, and Three.js is imported only after the page has loaded and the listening corner is near. The home page is rendered from D1 and cached with Astro's route caching and its Cloudflare provider, which puts Cloudflare's Worker cache in front of the Worker (five minutes of freshness with a day of stale-while-revalidate, so deploys show within minutes) and lets the admin page purge the `logbook` tag globally on every save. Stylesheets are inlined so a cached page never points at a stylesheet a later deploy removed. The old `/jobs/video-editor` page is retired with a redirect to the home page.

## Consequences

Visitors download no framework JavaScript before interacting, and the HTML is served from the edge cache. George now maintains one Astro project alongside his Next.js projects, so patterns (data access, auth, caching) differ slightly between them. The OpenNext configuration and worker patch scripts go away.

## Alternatives considered

- **Next.js 15 house stack:** consistent with George's other projects, but ships roughly 90KB of React and Next runtime even for server-rendered pages and renders uncached requests through OpenNext.
- **Hand-rolled Worker with plain HTML:** the same visitor performance as Astro, but routing, forms, font handling and admin glue would all be written by hand.
