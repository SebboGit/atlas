/*
 * Atlas service worker — hand-rolled, "cache-what-you-visit" offline.
 *
 * Deliberately NOT a generated Workbox/precache service worker: those are
 * webpack plugins, and Atlas builds with Turbopack (Next 16's default).
 * See docs/adr/0017-pwa-hand-rolled-service-worker.md for the full rationale
 * and the trigger to revisit once a Turbopack-native plugin is stable.
 *
 * What this gives you: anything you opened while online (your itinerary
 * before takeoff) is viewable offline. What it can't: pages you never
 * opened, live mutations (server actions need the network), and the map
 * basemap (tiles stream through /api and are too large to cache).
 */

const VERSION = 'atlas-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = '/offline.html';
const MANIFEST_URL = '/manifest.webmanifest';

// Brand assets referenced by the app chrome (topbar, /signin). Precached at
// install: runtime cache-what-you-visit doesn't guarantee these were ever
// stored, and a cached page rendering a broken logo offline looks worse than
// no offline support at all. The versioned icon PNGs are precached too, but
// their URLs are read from the manifest at install time (see below) so the
// list can't drift from ICON_REV in src/app/manifest.ts.
const PRECACHE_URLS = [OFFLINE_URL, '/atlas_logo.svg', '/favicon.svg'];

// Same-origin static assets worth caching lazily (the offline page leans on
// these too). Map tiles live under /api and are intentionally excluded.
const STATIC_ASSET =
  /^\/(?:icons|basemaps-assets|geo)\/|\.(?:svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf)$/;

// Only cache clean, same-origin 200s. Skips opaque/cross-origin responses
// and — importantly — auth redirects (a logged-out → /signin bounce must not
// be cached under the page the user actually asked for).
function cacheable(response) {
  return Boolean(response) && response.ok && response.type === 'basic' && !response.redirected;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // No fallbackUrl (the RSC branch): a real error response makes the
    // router fall back to a hard navigation, which lands in the
    // navigate branch above and gets the offline page properly.
    if (!fallbackUrl) return Response.error();
    return (await caches.match(fallbackUrl)) ?? Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) {
        // Clone synchronously, before respondWith can lock the body stream —
        // cloning inside the caches.open() callback races the page consuming
        // the response and intermittently skips the cache write.
        const copy = response.clone();
        caches.open(cacheName).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    // Network failed and there's no cached copy: retry the match ignoring
    // the query string — versioned asset URLs (`/icons/icon-192.png?v=N`)
    // orphan the previous revision's cache entry on every bump, and offline
    // a one-rev-stale asset beats a broken image. Falls back to a real error
    // response: resolving to `undefined` would make respondWith() a hard
    // network error.
    .catch(
      async () =>
        cached ?? (await caches.match(request, { ignoreSearch: true })) ?? Response.error(),
    );
  return cached ?? network;
}

self.addEventListener('install', (event) => {
  // Fetch + validate each URL explicitly instead of `cache.addAll`:
  // `cache.addAll` would store a redirect (e.g. a logged-out → /signin
  // bounce) and would abort the whole install on any non-2xx. We apply the
  // same `cacheable()` invariant used everywhere else, and never block
  // activation on any of it — a missing precache entry is degraded, not
  // fatal.
  event.waitUntil(
    (async () => {
      const precache = async (url) => {
        try {
          const cache = await caches.open(STATIC_CACHE);
          const response = await fetch(url, { cache: 'reload' });
          if (cacheable(response)) await cache.put(url, response.clone());
          return response;
        } catch {
          return undefined;
        }
      };

      // The manifest lists the icon PNGs with their current `?v=` revision —
      // precache exactly those URLs so the entries stay in sync with
      // ICON_REV without duplicating it here. The manifest itself is only
      // fetched as the icon-URL source, not cached: no fetch-handler branch
      // serves it, and an installed PWA keeps its manifest metadata OS-side.
      const precacheManifestIcons = async () => {
        try {
          const response = await fetch(MANIFEST_URL, { cache: 'reload' });
          if (!cacheable(response)) return;
          const manifest = await response.json();
          const iconUrls = (manifest.icons ?? [])
            .map((icon) => icon?.src)
            .filter((src) => typeof src === 'string' && src.startsWith('/'));
          await Promise.all(iconUrls.map(precache));
        } catch {
          // No manifest (or unparseable) — icons stay runtime-cached only.
        }
      };

      await Promise.all([...PRECACHE_URLS.map(precache), precacheManifestIcons()]);

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never intercept mutations (server actions) or cross-origin requests.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Auth, document streaming, and map tiles must always hit the network.
  if (url.pathname.startsWith('/api/')) return;

  // Full-page loads: fresh online, last-seen copy then offline page when not.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGES_CACHE, OFFLINE_URL));
    return;
  }

  // Content-hashed build output is immutable — cache-first is safe.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // RSC payloads (soft navigations, link prefetches, and the refetches
  // the router fires after a server action revalidates). These MUST be
  // network-first: serving the cached copy first (the old
  // stale-while-revalidate) meant every soft navigation showed
  // last-seen data while online — a segment created by the background
  // worker never appeared on its tab until a hard reload, and a
  // post-action refetch could overwrite the action's fresh tree with
  // the page-load-era payload (rename + Extract visibly "reverting").
  // The cache write is purely the offline fallback for already-seen
  // routes; the Vary header keeps RSC and HTML variants distinct, and
  // offline soft-nav stays best-effort (full page loads are the
  // reliable offline path).
  if (request.headers.has('RSC')) {
    event.respondWith(networkFirst(request, PAGES_CACHE, null));
    return;
  }

  // Other same-origin static assets (icons, fonts, sprites, GeoJSON).
  if (STATIC_ASSET.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Everything else: straight to the network.
});
