// Dev-only convenience: trade a fixture session token for the
// `authjs.session-token` cookie + a redirect to `/`. Spares the
// operator from pasting a long token into DevTools after every
// `pnpm seed:dev`.
//
// Three layers of guard so this can't ever serve in production:
//
//   1. `process.env.NODE_ENV === 'development'` returns 404 otherwise.
//      Production builds (`next build` / `next start`) set NODE_ENV to
//      "production" automatically, so a leaked deploy still 404s.
//   2. The token must exist in the `sessions` table — random tokens
//      don't grant access, only ones that the fixture script (or some
//      other dev write) has already inserted. The seed prints the
//      token, so only the operator who ran it has the value.
//   3. The proxy is configured to let this path through unauthenticated
//      (otherwise the redirect-to-signin would beat us here). The path
//      is namespaced under `/api/dev/` so the exception is tight.
//
// Not a real auth-bypass surface — anything this does, the user can
// already do by pasting the same cookie manually.

import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/db/client';
import { sessions } from '@/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse(null, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json(
      { error: 'Missing ?token=. Re-run `pnpm seed:dev` to get a fresh sign-in link.' },
      { status: 400 },
    );
  }

  // Token must correspond to a real, non-expired session row. Avoids
  // setting cookies for arbitrary attacker-supplied values and surfaces
  // a useful failure when the DB was wiped (or the fixture was re-run
  // and the old token in the bookmark is stale).
  const [row] = await db
    .select({ expires: sessions.expires })
    .from(sessions)
    .where(eq(sessions.sessionToken, token))
    .limit(1);

  if (!row || row.expires.getTime() < Date.now()) {
    return NextResponse.json(
      { error: 'Token not found or expired. Re-run `pnpm seed:dev` for a fresh one.' },
      { status: 400 },
    );
  }

  const next = req.nextUrl.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  // Relative Location so the browser resolves it against the host it actually
  // used. Building an absolute URL from `req.nextUrl.origin` breaks behind a
  // reverse proxy (Caddy): dev's origin collapses to `localhost:3000`, which an
  // external client can't reach. A relative redirect needs no forwarded-host
  // trust to land on the right place.
  const res = new NextResponse(null, { status: 307, headers: { Location: safeNext } });

  // Match the cookie name Auth.js will read. With AUTH_TRUST_HOST it derives
  // `useSecureCookies` from the forwarded proto, so a dev instance served over
  // HTTPS through a reverse proxy expects the `__Secure-` prefix; bare-localhost
  // HTTP expects the unprefixed name. Setting the wrong one means the session
  // silently fails to resolve and the page bounces to /signin.
  const isSecure = req.headers.get('x-forwarded-proto') === 'https';
  const cookieName = isSecure ? '__Secure-authjs.session-token' : 'authjs.session-token';
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: Math.max(1, Math.floor((row.expires.getTime() - Date.now()) / 1000)),
  });
  return res;
}
