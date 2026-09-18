// Point MapLibre at the tile-decoder worker Atlas serves from `public/`.
//
// MapLibre GL JS v6 is ESM-only and loads its worker from a real URL instead
// of the inline Blob v5 built at runtime. Under Next.js the default
// `import.meta.url` resolution emits the worker as a hashed asset without its
// `maplibre-gl-shared.mjs` sibling, so the worker throws on its first import:
// the map mounts, the canvas stays empty, and nothing reaches the console.
//
// `scripts/copy-maplibre-worker.ts` stages the worker and everything it
// imports under `public/maplibre/<version>/` on every `pnpm dev` and
// `pnpm build`, straight out of node_modules. The path is built here from the
// same library's `getVersion()`, so the URL and the staged copy cannot skew:
// a bundle only ever asks for the worker that shipped with it. Same-origin,
// which keeps the request inside the `worker-src 'self'` half of the CSP and
// inside the service worker's static-asset cache, so a map you have opened
// still renders offline (ADR-0017).
//
// Importing this module for its side effect is enough — it must run before
// the first `new maplibregl.Map(...)`, which module evaluation order
// guarantees for any component that imports it.

import { getVersion, setWorkerUrl } from 'maplibre-gl';

export function maplibreWorkerUrl(version: string = getVersion()): string {
  return `/maplibre/${version}/maplibre-gl-worker.mjs`;
}

if (typeof window !== 'undefined') {
  setWorkerUrl(maplibreWorkerUrl());
}
