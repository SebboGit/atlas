import { NextResponse, type NextRequest } from 'next/server';

// Outer-ring auth gate.
//
// We deliberately do NOT import from @/lib/auth/* here. Auth.js v5 pulls
// jose, which pulls Node `crypto` and CompressionStream — none of those
// work in the Edge runtime that proxy uses. Trying to call `auth()`
// from proxy crashes the request before the route ever renders.
//
// Instead, this is a presence-only check: do we have an Auth.js session
// cookie? If yes, let the request through. If no, redirect to sign-in.
// Cookie validity is enforced by the route layer's `requireUser()`,
// which runs in the Node runtime and does the real DB lookup. So:
//
//   - Outer ring (here): "you have a cookie that LOOKS like a session"
//   - Inner ring (requireUser in /(app)/layout.tsx): "your session is
//     valid and resolves to a real user"
//
// A user with an expired cookie will pass proxy, then be redirected
// to sign-in by requireUser. One extra hop is an acceptable trade for
// keeping proxy Edge-safe.

// Auth.js v5 names the cookie with a `__Secure-` prefix when AUTH_URL
// is https. Check both spellings.
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (req.cookies.has(name)) return true;
  }
  return false;
}

export function proxy(req: NextRequest): NextResponse {
  if (hasSessionCookie(req)) return NextResponse.next();

  const signInUrl = new URL('/signin', req.nextUrl.origin);
  signInUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(signInUrl);
}

// Match every path EXCEPT:
//   - /api/auth/*        (sign-in flow itself)
//   - /api/dev/*         (dev-only convenience endpoints. The routes themselves
//                         return 404 when NODE_ENV != "development", so the
//                         exception is only meaningful at dev time.)
//   - /api/health        (Dockerfile HEALTHCHECK)
//   - /_next/*           (Next internals + static assets)
//   - /favicon.ico
//   - /favicon.svg       (modern SVG favicon — must be reachable without a session.)
//   - /atlas_logo.svg    (brand mark — rendered on /signin,
//                         so it must be reachable without a session.)
//   - /.well-known/*     (reserved IETF discovery namespace — ACME, security.txt,
//                         Chrome DevTools workspace probe, etc. Must be public
//                         AND must not be a valid callbackUrl after sign-in.)
//   - /signin            (the custom sign-in page itself — must be reachable
//                         without a session, otherwise we redirect-loop.)
//
// Deny-by-default. Public pages must be explicitly added to the negation
// pattern. Today the only public surface is `/signin` — everything else,
// including `/`, is gated. New routes are gated automatically; new PUBLIC
// routes need to be added here on purpose. That's the right direction for
// a personal app with sensitive data.
export const config = {
  matcher: [
    '/((?!api/auth|api/dev|api/health|_next/static|_next/image|favicon.ico|favicon\\.svg|atlas_logo\\.svg|\\.well-known|signin).*)',
  ],
};
