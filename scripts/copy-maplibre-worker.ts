// Stage MapLibre's tile-decoder worker under `public/` so the browser can
// load it from a same-origin URL.
//
// MapLibre GL JS v6 ships ESM only and loads its worker as a real URL rather
// than the inline Blob v5 used. Next.js (Turbopack and `--webpack` alike)
// turns `new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)`
// into a hashed asset WITHOUT emitting the worker's `maplibre-gl-shared.mjs`
// sibling next to it, so the worker dies on its first import. The map then
// mounts but never decodes a tile — a blank canvas with nothing in the
// console. Serving the files ourselves and pointing `setWorkerUrl` at them is
// MapLibre's documented Next.js setup.
//
// The staging directory is stamped with the installed maplibre-gl version.
// `src/lib/maplibre/worker-url.ts` builds the same path from the runtime
// `getVersion()`, so a stale copy can never be served to a newer bundle — and
// the service worker's static-asset cache (ADR-0017) keeps the map working
// offline without ever pinning an outdated worker. Directories for other
// versions are pruned on every run so they don't pile up.
//
// Which files get staged is derived from the worker's own import specifiers
// rather than hard-coded; see scripts/lib/maplibre-worker-files.ts, which also
// explains why source maps stay behind. The copy runs from node_modules on
// every `dev` and `build`, so it always matches the installed version. pnpm
// does not run npm `pre`/`post` lifecycle hooks by default, so the package
// scripts chain this explicitly instead of relying on `predev` / `prebuild`.

import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { maplibreDistDir, maplibreVersion, stagedWorkerFiles } from './lib/maplibre-worker-files';

const dist = maplibreDistDir();
const version = maplibreVersion();
const root = path.join(import.meta.dirname, '..', 'public', 'maplibre');
const dest = path.join(root, version);

const files = stagedWorkerFiles(dist);

mkdirSync(dest, { recursive: true });
for (const file of files) {
  const target = path.join(dest, file);
  // A chunk nested in a subdirectory would otherwise fail with a bare
  // ENOENT; cheap insurance against a future dist layout.
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(dist, file), target);
}

// Drop anything left behind by a previous maplibre-gl version — earlier
// staging directories, and the flat files an earlier unstamped layout wrote
// straight into `public/maplibre/`. `rmSync` handles both.
for (const entry of readdirSync(root)) {
  if (entry !== version) {
    rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

console.log(`▸ staged maplibre-gl ${version} worker → public/maplibre/${version}/`);
console.log(`  ${files.join(', ')}`);
