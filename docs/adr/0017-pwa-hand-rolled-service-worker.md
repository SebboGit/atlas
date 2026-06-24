# ADR-0017: Installable PWA with a hand-rolled service worker

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** @SebboGit

## Context

Atlas is accessed on a phone at the gate and the hotel front desk. Run in a
mobile browser it carries the browser's address bar and tabs, which makes a
carefully designed app read as "a website." We want it to install to the home
screen, launch full-screen, and remain viewable offline — specifically, being
able to check an already-opened itinerary on a plane with no signal.

A Progressive Web App delivers all of this from the existing codebase: a web
manifest, icons, and a service worker, with zero rewrite. The only real design
question is the service worker.

The usual way to author one is a build plugin — `next-pwa`,
`@ducanh2912/next-pwa`, or Serwist — which generates a Workbox service worker
and precaches every build asset. But those are **webpack** plugins. Atlas
builds with **Turbopack**, the default bundler in Next 16 (`next build`).
Turbopack does not yet expose the stable build-output hook those plugins rely
on, so adopting any of them means reverting the production build to webpack
(`next build --webpack`):

- dev (Turbopack) would no longer match prod/CI (webpack), reintroducing the
  bundler-divergence bugs Turbopack-everywhere was chosen to avoid;
- the CSP in `next.config.ts` (which has Turbopack-aware `unsafe-eval` notes)
  would need re-verification under webpack;
- builds get slower, and CI runs `build` against the 2k-minute budget.

Serwist ships an experimental `@serwist/turbopack` aimed at keeping Turbopack,
but it is early and not something to put under a production app with real blast
radius today.

A second force: Atlas is a server-driven RSC + Server Actions app. Offline is
inherently read-only (mutations need the network), and the Protomaps basemap
streams through `/api/tiles` — too large to cache. So full build-asset
precaching buys little here; the valuable offline surface is "pages I already
loaded," which does not require a precache manifest.

## Decision

Ship the PWA with a **hand-rolled service worker** (`public/sw.js`) and the
native Next metadata API for the manifest (`src/app/manifest.ts`) and Apple
tags (`src/app/layout.tsx`). No PWA build plugin; the build stays on Turbopack.

The service worker uses a **cache-what-you-visit** strategy:

- navigations → network-first, falling back to the last-seen copy of that page,
  then a static `public/offline.html`;
- `/_next/static/` (content-hashed, immutable) → cache-first;
- RSC payloads and other same-origin static assets → stale-while-revalidate;
- non-GET (server actions), cross-origin, and `/api/*` (auth, document
  streaming, map tiles) → never intercepted.

Registration is production-only (`ServiceWorkerRegister`) so it does not fight
Turbopack HMR in `next dev`; local install/offline testing uses `pnpm build &&
pnpm start`.

**Revisit trigger:** when a Turbopack-native PWA/precaching plugin (most likely
a stable `@serwist/turbopack`, or first-party Next support) reaches stable
release, re-evaluate migrating to it for full-precache offline — supersede this
ADR rather than amend it.

## Consequences

### Positive

- Zero new dependencies; the production build stays entirely on Turbopack.
- The cached/uncached boundary is ~120 lines of readable, auditable JS.
- Installable on Android and iOS; already-opened pages work offline.
- No CSP changes needed — `worker-src 'self' blob:` already covers `/sw.js`.

### Negative / tradeoffs

- No build-asset precaching: a route or asset never opened online is not
  guaranteed offline (acceptable — the itinerary is opened before boarding).
- We own the caching logic and its versioning (`VERSION` bump on changes)
  instead of delegating to Workbox.

### Neutral

- Offline is read-only and the basemap is unavailable offline — true of any
  service-worker approach here, not specific to hand-rolling. The trip map
  shows a client-side offline banner (`MapOfflineBanner`) so the bare map
  (arcs/pins/country shapes, no basemap) is explained rather than mysterious;
  the `/map` choropleth is GeoJSON-only and renders fully offline.

## Alternatives considered

- **`@ducanh2912/next-pwa` / `next-pwa`** — webpack-only; would force
  `next build --webpack`. Rejected: degrades the toolchain for a single-user
  feature.
- **Serwist (`@serwist/next`)** — the maintained successor and the right tool
  for full offline-first, but its documented Next 16 path also requires the
  webpack build. Rejected for now; the natural target of the revisit trigger.
- **`@serwist/turbopack`** — keeps Turbopack, but experimental. Rejected as too
  immature for production today.

## References

- ADR-0011 — self-hosted Protomaps basemap (the `/api/tiles` stream excluded
  from caching)
- `public/sw.js`, `src/app/manifest.ts`, `src/components/pwa/`
- Serwist Turbopack support: https://serwist.pages.dev/docs/next
- Next 16 / Turbopack default bundler: https://nextjs.org/blog/next-16
