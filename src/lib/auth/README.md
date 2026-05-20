# Auth — PocketID (OIDC)

Atlas authenticates users via [PocketID](https://github.com/pocket-id/pocket-id), a self-hosted passkey-only OIDC provider, integrated through Auth.js's generic OIDC provider.

> **Why PocketID and not credentials?** See [`docs/adr/0002-auth-via-pocketid.md`](../../../docs/adr/0002-auth-via-pocketid.md).

## What lives in this folder

```
src/lib/auth/
├── providers/
│   └── pocket-id.ts        # Auth.js OIDC provider config
├── config.ts               # NextAuth() initialization
├── adapter.ts              # Drizzle adapter for DB sessions
├── session.ts              # session helpers (getCurrentUser, requireUser)
└── jit-user.ts             # just-in-time User row creation/refresh on sign-in
```

## Contract

Feature code only ever uses two things:

```ts
import { getCurrentUser, requireUser } from '@/lib/auth/session';

// In a Server Component or Server Action:
const user = await getCurrentUser(); // User | null
const user = await requireUser(); // User — throws 401 if missing
```

That's it. Feature code MUST NOT:

- Reference `pocket-id` or any provider id by name
- Reference OIDC claims directly (use the `User` row)
- Import from `next-auth` directly (always via `@/lib/auth/*`)

This is the same isolation pattern as `src/lib/storage/` — keeps the IdP swappable.

## Just-in-time user creation

On every successful sign-in, the `signIn` callback:

1. Looks up `User` by `sub` (the OIDC subject — immutable identifier).
2. If found: refresh `email`, `name`, `groups`, `lastSeenAt`.
3. If not found: insert a new row.
4. Return the local `user.id` for the session.

Feature code never sees the `sub` again — it uses `user.id`.

## Session strategy

- DB-backed sessions (not JWT). Revocation works.
- Default lifetime: 30 days, sliding.
- Stored via the Drizzle adapter alongside the rest of the schema.

## Required env vars

| Var                  | Source                          |
| -------------------- | ------------------------------- |
| `AUTH_SECRET`        | `openssl rand -base64 32`       |
| `AUTH_URL`           | Atlas's canonical URL           |
| `OIDC_ISSUER_URL`    | PocketID base URL               |
| `OIDC_CLIENT_ID`     | PocketID admin UI (OIDC client) |
| `OIDC_CLIENT_SECRET` | PocketID admin UI (OIDC client) |

## Operator setup (PocketID side, one-time)

1. In PocketID admin UI: **OIDC Clients → New Client**, name `atlas`.
2. Callback URL: `${AUTH_URL}/api/auth/callback/pocket-id`
3. Scopes: `openid profile email groups`
4. Restrict client to the group(s) allowed to use Atlas (e.g. `atlas-users`).
5. Copy client ID + secret into Atlas's `.env`.

## Tests to write

- `requireUser` throws when no session.
- JIT user creation: new sub → row inserted, claims mapped correctly.
- JIT refresh: existing sub → display attrs updated, `id` unchanged.
- Path-safety: the `pocket-id` callback rejects mismatched issuer / audience.
