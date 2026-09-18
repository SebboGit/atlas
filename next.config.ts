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
// NB: `output: 'standalone'` bakes this value into the build, so the
// envelope is a property of the IMAGE, not of the runtime env. A published
// image carries the envelope the build was given — the 20 MB default unless
// the build stage was passed `--build-arg STORAGE_MAX_BYTES=…` (see the
// Dockerfile's build stage). Raising STORAGE_MAX_BYTES at runtime alone does
// NOT widen it, so the app clamps the runtime limit to the baked ceiling and
// warns; `ATLAS_UPLOAD_ENVELOPE_BYTES` below is how it learns the baked
// value. An empty string (an unset build arg still sets the variable) falls
// back to the default rather than parsing as 0, but a value that is set and
// unparseable throws here with the same message `requireStorageMaxBytes()`
// raises at runtime — one policy for the variable, whichever side reads it.
//
// Raising the ceiling is not free: Next buffers the body twice, before the
// proxy's auth decision, so each concurrent upload can hold ~2× the value in
// memory against the container's mem_limit. Cap the body at the reverse proxy
// (Caddy `request_body max_size`) if the app is reachable by anyone else.
function resolveStorageMaxBytes(): number {
  const raw = process.env.STORAGE_MAX_BYTES?.trim();
  if (!raw) return 20 * 1024 * 1024;
  const parsed = Number(raw);
  // Plain Error, not the storage layer's StorageError: this file is loaded by
  // the Next CLI outside the app's module graph and must not import from
  // `@/lib/*`. Same predicate as `readStorageMaxBytes()` — a whole number of
  // bytes, exponent notation included.
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('STORAGE_MAX_BYTES must be a positive integer');
  }
  return parsed;
}

const storageMaxBytes = resolveStorageMaxBytes();
const serverActionBodyLimit = storageMaxBytes + 1024 * 1024;

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
      // MapLibre GL's tile-decoder worker is served same-origin from
      // /maplibre/ (staged out of node_modules by
      // scripts/copy-maplibre-worker.ts), so `'self'` is what starts it.
      // The browser checks `worker-src` (or `default-src` as fallback)
      // when spawning workers; block it and the map renders only its
      // background layer — a white/blank canvas with nothing in the
      // console. `blob:` is held over from MapLibre v5, which built the
      // worker as an inline Blob; v6 only falls back to a Blob URL for a
      // cross-origin worker, which Atlas never loads. Dropping it is a
      // safe tightening, deliberately left out of the v6 upgrade.
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
  // Next 16.3+ `next dev` appends a managed rules block to CLAUDE.md
  // whenever it detects a coding agent in the environment. CLAUDE.md is
  // hand-maintained here, so opt out rather than dirty every worktree.
  agentRules: false,
  // pdfjs-dist's legacy build loads `pdf.worker.mjs` next to `pdf.mjs`
  // via a dynamic import. When Turbopack bundles the package into
  // .next/dev/server/chunks/ssr/, the worker sibling isn't copied
  // there and the runtime import fails with "Setting up fake worker
  // failed: Cannot find module 'pdf.worker.mjs'". Excluding the
  // package from the server bundle lets Node's normal resolution find
  // the worker at its real node_modules path — the legacy build's
  // documented entry contract.
  serverExternalPackages: ['pdfjs-dist'],
  // The request envelope is sized at build time (see `storageMaxBytes`),
  // so the ceiling it was sized from has to travel with the bundle. Next
  // inlines this wherever `process.env.ATLAS_UPLOAD_ENVELOPE_BYTES` is
  // read; `getUploadMaxBytes()` clamps the runtime STORAGE_MAX_BYTES to it
  // and the upload dialog rejects oversized files before they leave the
  // browser. Deliberately NOT `NEXT_PUBLIC_`-prefixed: no client code reads
  // it, and the prefix would suggest a runtime knob when the value is fixed
  // at build. The prod image also exports it as a real env var so the clamp
  // survives a future bundler that stops inlining.
  env: {
    ATLAS_UPLOAD_ENVELOPE_BYTES: String(storageMaxBytes),
  },
  experimental: {
    // See `serverActionBodyLimit` above — lifts the Server Action body cap
    // from its 1 MB default to just over STORAGE_MAX_BYTES so document
    // uploads aren't 413'd before the storage layer can size-check them.
    serverActions: {
      bodySizeLimit: serverActionBodyLimit,
    },
    // Second cap on the same request. Every non-GET request matched by
    // `src/proxy.ts` gets its body buffered, and past this limit Next
    // TRUNCATES the stream and logs a warning instead of erroring, so the
    // Server Action receives half a multipart body and the upload dies as
    // a generic "Something went wrong." The default is 10 MB, which cut
    // off uploads well under the storage limit. Both caps carry the same
    // value, so storage owns the real ceiling for anything the envelope
    // admits; a body past the envelope is still truncated, and "File is
    // too large." stays out of reach for those.
    //
    // Cost: Next buffers the body into two streams without backpressure,
    // and starts before the proxy's auth decision — so a matched POST can
    // hold ~2× this value in memory before it is even rejected. Fine for a
    // single-user homelab behind Tailscale; a public deployment should cap
    // the body at the reverse proxy (Caddy `request_body max_size`).
    proxyClientMaxBodySize: serverActionBodyLimit,
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
