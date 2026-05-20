# ADR-0002: Authentication via PocketID (passkey-only OIDC)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** @SebboGit

## Context

Atlas needs user authentication. Operator already runs [PocketID](https://github.com/pocket-id/pocket-id) in the homelab — a self-hosted OIDC provider that supports passkeys exclusively (WebAuthn/FIDO2). No passwords, no TOTP fallback.

The original stub specified Auth.js with a credentials provider (bcrypt + password). That was a placeholder, chosen for simplicity. With PocketID available, there is no reason to maintain a parallel password-based auth path.

### Forces

- **Security:** passkey authentication is phishing-resistant by construction. Eliminates password storage, password reset flows, and credential-stuffing attack surface.
- **Operational simplicity:** Atlas does not store, hash, or rotate any credentials. PocketID is the single source of identity. One IdP across the homelab.
- **Standards:** OIDC is a stable, well-supported standard. Auth.js has solid generic OIDC support — no PocketID-specific code needed.
- **Reversibility:** If PocketID is ever replaced (Authentik, Authelia, Keycloak), the change is a config swap. Feature code uses the Auth.js session abstraction and is provider-agnostic.

## Decision

Atlas authenticates users via **PocketID** as the sole identity provider, integrated through Auth.js's **generic OIDC provider**.

- No credentials provider. No password fields. No "register" form.
- Atlas's `User` table is populated **just-in-time** on first successful sign-in, keyed by the OIDC `sub` claim (immutable subject identifier) with `email` and `name` from claims as display attributes.
- Sessions are stored in the database (not JWT) so revocation works.
- All provider config lives in `src/lib/auth/`. Feature code MUST NOT reference `pocket-id` or any provider-specific fields.

## Consequences

### Positive

- No password storage = no password breach risk.
- Phishing-resistant by default.
- One sign-in flow for the whole homelab.
- Simpler `User` table — no `passwordHash`, no `passwordResetToken`, no email-verification dance.
- Auth.js generic OIDC provider is mature; minimal custom code.

### Negative / tradeoffs

- Atlas depends on PocketID being reachable at sign-in time. If PocketID is down, no one can sign in.
  - _Mitigation:_ Sessions live up to 30 days. A user already signed in keeps working through a PocketID outage. New sign-ins fail clearly with "IdP unreachable" rather than degrading silently.
- Users must have at least one passkey. No fallback for "lost my YubiKey, can't find my phone."
  - _Mitigation:_ PocketID supports one-time login codes for device recovery (operator-issued). Atlas does not need to solve this.
- Tighter coupling to one IdP than the original "provider-agnostic" framing implied. The abstraction is real but starting position is OIDC, not "swap-OIDC-in-later."

### Neutral

- The "no leaking the auth provider" guardrail still applies and is enforced exactly the same way.

## Alternatives considered

- **Auth.js credentials provider (password).** Rejected: gives up the security benefits PocketID was chosen for. Adds password-management UX nobody wants.
- **Authentik / Authelia.** Rejected: heavier than needed. Operator already runs PocketID.
- **Magic-link email auth.** Rejected: depends on email delivery, weaker than passkeys, more code to maintain.
- **No auth (network-only, behind Tailscale).** Rejected: defense in depth. The app should authenticate even if the network layer is bypassed.

## Implementation notes

### Auth.js provider config

Generic OIDC provider, no PocketID-specific library required:

```ts
// src/lib/auth/providers/pocket-id.ts
export const pocketId = {
  id: 'pocket-id',
  name: 'PocketID',
  type: 'oidc' as const,
  issuer: process.env.OIDC_ISSUER_URL!, // e.g. https://id.example.com
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  authorization: { params: { scope: 'openid profile email groups' } },
};
```

Auth.js performs OIDC discovery against `{issuer}/.well-known/openid-configuration`.

### Required PocketID config (operator-side)

- Create OIDC client named `atlas` in PocketID admin UI.
- Callback URL: `https://atlas.example.com/api/auth/callback/pocket-id`
- Scopes granted: `openid profile email groups`
- Restrict to a specific user group (e.g. `atlas-users`) for access control.

### Required Atlas env vars

- `OIDC_ISSUER_URL` — PocketID base URL
- `OIDC_CLIENT_ID` — from PocketID
- `OIDC_CLIENT_SECRET` — from PocketID
- `AUTH_SECRET` — Auth.js session signing key (`openssl rand -base64 32`)
- `AUTH_URL` — Atlas's canonical URL (used in callback)

### User table

`User` (`id`, `sub` UNIQUE, `email`, `name`, `groups[]`, `createdAt`, `lastSeenAt`). `sub` is the PocketID subject; `email` and `name` are display attributes refreshed on each sign-in.

`groups` claim from PocketID is stored for future role-based access — not used today.

## References

- [PocketID](https://github.com/pocket-id/pocket-id)
- [Auth.js OIDC provider docs](https://authjs.dev/getting-started/providers/oidc)
- `src/lib/auth/` — implementation lives here
- `CLAUDE.md` → "Auth" section

## Revisit if

- PocketID becomes unmaintained or the project pivots away from passkey-only.
- A second IdP is needed for a different audience (unlikely for a personal app).
- Multi-tenant requirements emerge (different IdPs per tenant).
