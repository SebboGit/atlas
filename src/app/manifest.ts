import type { MetadataRoute } from 'next';

// Bump when the icon art changes; the favicon in layout.tsx and the precache
// entry in public/sw.js carry the same revision. Home-screen icon caches are
// keyed by URL and extremely sticky — changing the file contents under the
// same path isn't enough, so this query string forces a re-fetch.
const ICON_REV = '3';

// Web app manifest — makes Atlas installable to the home screen and lets it
// launch standalone (no browser chrome). Next serves this at
// /manifest.webmanifest and injects the <link rel="manifest"> automatically.
// Colors track the light palette (--color-background / themeColor).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Atlas — Travel Companion',
    short_name: 'Atlas',
    description: 'A self-hosted personal travel companion.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#e9ecf2',
    theme_color: '#e9ecf2',
    lang: 'en',
    dir: 'ltr',
    categories: ['travel'],
    icons: [
      {
        src: `/icons/icon-192.png?v=${ICON_REV}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/icons/icon-512.png?v=${ICON_REV}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/icons/icon-maskable-192.png?v=${ICON_REV}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: `/icons/icon-maskable-512.png?v=${ICON_REV}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
