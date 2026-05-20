import NextAuth from 'next-auth';

import { drizzleAdapter } from './adapter';
import { refreshUserFromClaims } from './jit-user';
import { pocketIdProvider } from './providers/pocket-id';

// Single source of truth for Auth.js wiring. Feature code imports the
// session helpers from ./session — never this file directly.
const nextAuth = NextAuth({
  adapter: drizzleAdapter,
  providers: [pocketIdProvider()],
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days, sliding (Auth.js default behaviour).
  },
  pages: {
    signIn: '/signin',
  },
  events: {
    // POST-insert hook. The adapter has already created/looked-up the
    // users row by the time we get here; user.id refers to a real row.
    // We refresh display attributes and (on first sign-in) populate
    // users.sub from the OIDC subject.
    async signIn({ user, account, profile }) {
      if (!user?.id || !account?.providerAccountId) return;
      // refreshUserFromClaims Zod-validates the profile before writing.
      await refreshUserFromClaims(user.id, account.providerAccountId, profile);
    },
  },
});

export const { auth, signIn, signOut, handlers } = nextAuth;
// Re-export the route handlers at the top level so the [...nextauth]
// route can `export { GET, POST } from '@/lib/auth/config'` directly.
export const GET = nextAuth.handlers.GET;
export const POST = nextAuth.handlers.POST;
