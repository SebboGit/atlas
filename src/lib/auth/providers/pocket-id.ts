import type { OIDCConfig } from 'next-auth/providers';

import type { PocketIDProfile } from '../profile-schema';

// PocketIDProfile is the Zod-validated shape used by JIT refresh. The
// provider sees the raw OIDC userinfo here; validation happens at the
// edge (events.signIn → jit-user.ts → pocketIdProfileSchema).

/**
 * Generic OIDC provider config pointed at PocketID. Discovery happens
 * via {issuer}/.well-known/openid-configuration — Auth.js handles it.
 *
 * The `id` is the provider key used in callback URLs:
 *   ${AUTH_URL}/api/auth/callback/pocket-id
 *
 * Env vars are read LAZILY here, not thrown on absence. Auth.js will
 * call this once at startup; if the env is missing, sign-in attempts
 * fail with a clear error, but `next build` (which collects page data
 * for routes that transitively import this) succeeds in environments
 * where the env hasn't been wired yet — e.g. inside a `docker build`
 * stage that doesn't have OIDC secrets at build time.
 *
 * The real validation happens when a sign-in is attempted: Auth.js
 * passes `issuer` / `clientId` / `clientSecret` to its OIDC handshake,
 * which will fail loudly with empty strings.
 */
export function pocketIdProvider(): OIDCConfig<PocketIDProfile> {
  return {
    id: 'pocket-id',
    name: 'PocketID',
    type: 'oidc',
    issuer: process.env.OIDC_ISSUER_URL ?? '',
    clientId: process.env.OIDC_CLIENT_ID ?? '',
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    authorization: { params: { scope: 'openid profile email groups' } },
    // Map claims → adapter-facing profile shape.
    //
    // `id` is REQUIRED even though we don't want it on the User row.
    // Auth.js core uses `profile().id` as the `providerAccountId` for the
    // Account row; if it's undefined, it falls back to crypto.randomUUID(),
    // which means every sign-in writes a fresh random providerAccountId
    // and subsequent sign-ins can't find their own account → permanent
    // OAuthAccountNotLinked error. We pass the OIDC `sub` (stable per
    // identity) and let @auth/drizzle-adapter's createUser strip the `id`
    // before insert, so the User row still gets its uuidv7 default.
    //
    // Display attributes (email, name) are refreshed on every sign-in by
    // events.signIn → jit-user.ts with proper Zod validation; the mapping
    // here is the bare minimum the adapter needs to insert the row.
    profile(profile) {
      return {
        id: profile.sub,
        email: profile.email ?? '',
        name: profile.name ?? profile.preferred_username ?? null,
      };
    },
  };
}

export type { PocketIDProfile } from '../profile-schema';
