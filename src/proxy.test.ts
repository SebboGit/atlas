import { describe, expect, it } from 'vitest';

import { config } from './proxy';

// The proxy `matcher` is deny-by-default: any path it MATCHES runs through the
// auth gate (and is redirected to /signin without a session). Public assets
// must be excluded via the negative-lookahead, or they 307 to /signin when
// fetched unauthenticated — which breaks PWA installability and, worse, lets
// the SW cache the sign-in page as the offline page (it fetches /offline.html
// on install).
const matcher = new RegExp(`^${config.matcher[0]}$`);
const isGated = (path: string) => matcher.test(path);

describe('proxy matcher', () => {
  it('gates app routes (auth required)', () => {
    for (const path of ['/', '/trips', '/trips/123', '/map', '/stats', '/wishlist']) {
      expect(isGated(path), `${path} should be gated`).toBe(true);
    }
  });

  it('exempts the PWA install surface (must be reachable without a session)', () => {
    for (const path of [
      '/sw.js',
      '/offline.html',
      '/manifest.webmanifest',
      '/icons/icon-192.png',
      '/icons/icon-maskable-512.png',
      '/apple-touch-icon.png',
    ]) {
      expect(isGated(path), `${path} should be public`).toBe(false);
    }
  });

  it('exempts the existing brand + sign-in surface', () => {
    for (const path of ['/favicon.svg', '/atlas_logo.svg', '/signin']) {
      expect(isGated(path), `${path} should be public`).toBe(false);
    }
  });
});
