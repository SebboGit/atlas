import { createRequire } from 'node:module';

import { expect, test } from './fixtures/auth';

// MapLibre GL JS v6 loads its tile-decoder worker from a URL, and Atlas
// stages that file under /maplibre/<version>/ (scripts/copy-maplibre-worker.ts)
// because Next.js won't emit it with the chunk it imports. Get that wrong and
// the map mounts, the canvas stays blank, and nothing lands in the console —
// so no rendering assertion catches it. Asking the server for the asset does.
//
// The version comes from the installed package, which is the same value
// `getVersion()` hands src/lib/maplibre/worker-url.ts in the browser: if the
// staging path and the runtime path ever disagree, this 404s.
//
// The request goes through the authed context because src/proxy.ts gates
// same-origin static paths, exactly as it does for /basemaps-assets/.

const require = createRequire(import.meta.url);
const { version } = require('maplibre-gl/package.json') as { version: string };

test.describe('maplibre worker asset', () => {
  test('is served at the version-stamped path the browser asks for', async ({ authedPage }) => {
    const response = await authedPage.request.get(
      `/maplibre/${version}/maplibre-gl-worker.mjs`,
      // Follow nothing: a redirect here means the asset is missing and the
      // proxy bounced us, which is the failure we want named as such.
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/javascript/);
  });
});
