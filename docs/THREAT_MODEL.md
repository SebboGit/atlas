# Threat Model

Atlas stores travel documents — boarding passes, hotel confirmations, and
PKPasses that can carry names, home addresses, passport numbers, and booking
references. This one-pager records what that data is, the assumptions Atlas is
built on, and the threats the design does and does not defend against. Update
it whenever a change touches authentication, file uploads, or an external
service.

## Assets

- **Original documents** on disk — immutable uploads that may contain
  personally identifying and travel data. The most sensitive asset.
- **Parsed and trip data** in Postgres — itineraries, locations, dates, and
  the structured fields extracted from documents.
- **Sessions and OIDC tokens** — the credentials that grant access to all of
  the above.

## Deployment assumptions

These are the boundaries the rest of the model relies on. Break one and the
guarantees below weaken accordingly.

- **Single user or a small household, not multi-tenant.** A `userId` records
  who created a row, not who may read it: household members see each other's
  trips by design. There is no per-user isolation boundary inside the app.
- **Private network, never raw on the public internet.** Atlas expects to run
  behind Tailscale or a TLS reverse proxy, with Postgres unpublished. It does
  not harden itself against internet-scale exposure.
- **Authentication is delegated to PocketID** (passkey-only OIDC). Atlas
  trusts the issuer's `sub` claim and creates a user just in time on first
  sign-in. Deciding _who_ may authenticate is PocketID's job, because any
  identity that signs in becomes a full household account.
- **Extraction, geocoding cache, and tile serving run on the operator's own
  hardware.** Document content never leaves the host for the LLM; the one
  exception is geocoding, which sends place names and addresses to the public
  Photon endpoint, with public Nominatim as the fallback, unless self-hosted
  instances are configured.

## Threats considered, and what answers them

- **Reading someone else's documents** — every file read goes through the
  authenticated `/api/documents/[id]` route, checked against the session; the
  data directory is never served directly by the reverse proxy, and files are
  stored under random UUID names rather than user-supplied ones.
- **Malicious or oversized uploads** — MIME is validated by magic bytes
  rather than the `Content-Type` header, size is capped server-side, and the
  storage adapter rejects keys containing `..`, absolute paths, or null bytes.
  Stored files are write-once.
- **Path traversal and SSRF** — storage keys resolve only under `STORAGE_DIR`,
  the tile route is constrained to `TILES_DIR`, and outbound calls go only to
  the configured Photon, Nominatim, Ollama, and tile endpoints.
- **Session theft and revocation** — sessions are database-backed (not JWTs)
  so they can be revoked; mutations run through Next.js server actions, which
  are CSRF-protected by default.
- **Secret and data leakage** — secrets live only in the environment; gitleaks
  scans at the pre-commit hook, in CI, and via GitHub push protection; the
  logger redacts PNRs, passport numbers, and tokens at its boundary. Response
  headers set a strict Content-Security-Policy, HSTS, `nosniff`,
  `X-Frame-Options: DENY`, and a conservative referrer policy, with no
  third-party origins permitted in production (dev loosens the CSP for HMR).
- **Vulnerable dependencies** — Dependabot opens grouped weekly updates, and
  CI runs an advisory `pnpm audit --prod` step that surfaces findings for
  manual review; it does not gate merges. There is no accepted-risk baseline
  today; one would live in package.json `pnpm.auditConfig.ignoreGhsas`.

## Out of scope

- **Per-user privacy within a household.** Full sharing is intentional; the
  only sanctioned extension is a `trips.visibility` enum behind a new ADR.
- **Public-internet exposure and DoS.** Mitigated by the deployment model, not
  by the app.
- **Physical access** to the host or its disks — use host-level disk
  encryption.
- **Compromise of the upstream PocketID instance** or the operator's own
  network.

## Residual risks

- Anyone who can authenticate through the configured PocketID instance gains
  full household access. Gate this with PocketID's client group restriction.
- Geocoding sends each hotel, food, activity, and transit query to the public
  Photon endpoint, and to public Nominatim when Photon finds nothing
  (ADR-0018). A query is a venue or station name with its place or country
  context, or an address; Plus Code pins also send their decoded coordinates
  for a display name. Train, bus, and ferry legs look up each end by its
  Plus Code or address when it has one, else by its station name; for a
  station name Photon also receives a category filter and the segment's ISO
  country code, and the pin lookup sends Nominatim only the plain name
  (ADR-0019). This is the
  one place structured location data leaves the host; point `PHOTON_URL` and
  `NOMINATIM_URL` at self-hosted instances to close it.
- The transit Directions link puts both ends of a leg into a Google Maps URL:
  each end's station name, decoded Plus Code, or address (ADR-0019). It leaves
  the host only when the user opens the link in their own browser, sent with
  `noreferrer`, and the server never calls Google. The Plus Code badge link
  is the same class of disclosure.
- Push notifications (planned) must keep PNRs, passport numbers, and document
  contents out of their bodies — this is a design constraint, not yet enforced
  by code.
