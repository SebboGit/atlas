import type { NextConfig } from 'next';

// The OIDC sign-in flow POSTs a form to /api/auth/signin/<provider>, which
// 302s the browser to the IdP's authorize endpoint. CSP `form-action`
// applies to the redirect chain, not just the immediate target, so the IdP
// origin must be allow-listed or the browser blocks the navigation.
function oidcIssuerOrigin(): string | null {
  const raw = process.env.OIDC_ISSUER_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const formActionSources = ["'self'", oidcIssuerOrigin()].filter(Boolean).join(' ');

const isDev = process.env.NODE_ENV !== 'production';

// Document uploads POST their file through a Server Action
// (uploadDocumentAction), and Server Actions buffer the whole request body
// in memory behind a cap that defaults to 1 MB. Our upload ceiling is
// STORAGE_MAX_BYTES (default 20 MB), so any larger file used to 413 with a
// generic "Something went wrong." before the storage layer could return its
// friendly "File is too large." Size the envelope just above the storage
// limit so storage (not Next) owns the real cap and its message — the few
// hundred bytes of multipart framing fit comfortably in the 1 MB headroom.
//
// NB: `output: 'standalone'` bakes this value into the build, so raising
// STORAGE_MAX_BYTES at runtime needs an image rebuild to keep the two in
// sync — otherwise storage would accept files Next then 413s.
const storageMaxBytes = Number(process.env.STORAGE_MAX_BYTES ?? 20 * 1024 * 1024);
const serverActionBodyLimit =
  Number.isFinite(storageMaxBytes) && storageMaxBytes > 0
    ? storageMaxBytes + 1024 * 1024
    : 21 * 1024 * 1024;

// `next dev` ships eval-based source maps and an HMR websocket. Both
// are blocked by the production CSP. Loosen *only* in development so
// interactive UI works at localhost; production headers stay strict.
//   - 'unsafe-eval' covers source-map evaluation and webpack hot-update
//   - ws: in connect-src covers the HMR socket
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";
const connectSrc = isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'";

// Atlas runs behind a reverse proxy (Caddy / Tailscale). Headers here are
// belt-and-braces — the proxy should set or strengthen them too.
//
// `blob:` on `worker-src` and `img-src` is required everywhere — not just
// on map routes — because per-route scoping via `next.config.ts::headers()`
// doesn't actually narrow the policy. Multiple matching entries that all
// set Content-Security-Policy emit MULTIPLE CSP response headers, and the
// browser enforces the INTERSECTION of all received policies (CSP spec).
// So a "strict default + relaxed override on /map" would still block the
// MapLibre tile-decoder worker, leaving the canvas white. A per-request
// CSP via `src/proxy.ts` would work but is deferred (per-route CSP
// scoping was attempted and reverted). Today the document-download
// route serves with `Content-Disposition: attachment` and
// `X-Content-Type-Options: nosniff`, which prevents the browser from
// inline-rendering uploads — the defense-in-depth gap is small.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // MapLibre GL builds its tile-decoder worker as an inline
      // `Blob`, then spawns it via `new Worker(URL.createObjectURL(...))`.
      // The browser checks `worker-src` (or `default-src` as fallback)
      // when starting workers; without `blob:` allow-listed here the
      // worker silently fails and the map renders only its background
      // layer — looks like a white/blank canvas. `'self'` keeps any
      // future same-origin worker scripts working.
      "worker-src 'self' blob:",
      connectSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      `form-action ${formActionSources}`,
    ].join('; '),
  },
  // No `preload` here — Atlas runs at a homelab hostname behind Tailscale
  // and is not preload-list material. Add `preload` only if/when Atlas
  // ever lives at a stable public hostname with proper CT logging.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // `typedRoutes` moved to top-level in Next 15.5 — `experimental` is
  // the deprecated location.
  typedRoutes: true,
  // pdfjs-dist's legacy build loads `pdf.worker.mjs` next to `pdf.mjs`
  // via a dynamic import. When Turbopack bundles the package into
  // .next/dev/server/chunks/ssr/, the worker sibling isn't copied
  // there and the runtime import fails with "Setting up fake worker
  // failed: Cannot find module 'pdf.worker.mjs'". Excluding the
  // package from the server bundle lets Node's normal resolution find
  // the worker at its real node_modules path — the legacy build's
  // documented entry contract.
  serverExternalPackages: ['pdfjs-dist'],
  experimental: {
    // See `serverActionBodyLimit` above — lifts the Server Action body cap
    // from its 1 MB default to just over STORAGE_MAX_BYTES so document
    // uploads aren't 413'd before the storage layer can size-check them.
    serverActions: {
      bodySizeLimit: serverActionBodyLimit,
    },
  },
  // Allow `next dev` HMR + RSC requests from extra hosts so the app can
  // be exercised on a phone over the LAN. Dev-only — production builds
  // don't consult this list. Comma-separated env var keeps the
  // operator-specific IP out of the committed config; an empty/unset
  // value falls back to localhost defaults.
  allowedDevOrigins: process.env.ATLAS_DEV_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
