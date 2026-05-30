# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

---

## Project Overview

**Atlas** is a self-hosted personal travel companion. It manages trips, flights, hotels, activities, documents (boarding passes, reservations, tickets), and maps — all in one place. Designed for single-user / small-household use on a homelab, but built to professional standards so it remains extensible.

Two map surfaces ship today: a visited-countries world choropleth at `/map`, and a per-trip map at `/trips/[id]/map` showing flight arcs plus geocoded pins for hotels, activities, and transit. Both run on a self-hosted Protomaps PMTiles basemap (ADR-0011) with non-flight locations resolved via Nominatim (ADR-0010).

**Core principles:**

- Self-hosted, owns its own data
- Modern but boring tech where it counts
- Documents are first-class citizens: original files are immutable, parsed data is separate and re-derivable
- Extensible by feature, not by hack
- Operational simplicity wins ties — this is a personal app, not SaaS

---

## Tech Stack

| Layer            | Choice                                            | Why                                                                            |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Framework        | **Next.js 16** (App Router, RSC)                  | Full-stack TS, mature ecosystem, server actions                                |
| Language         | **TypeScript** (strict mode)                      | Type safety end-to-end                                                         |
| Styling          | **Tailwind CSS** + **shadcn/ui**                  | Sophisticated default, zero lock-in, fully owned components                    |
| Database         | **PostgreSQL 18**                                 | JSONB, native UUIDv7, async I/O, FTS, PostGIS-ready                            |
| ORM              | **Drizzle ORM** + `drizzle-kit`                   | SQL-first, lightweight, great TS inference                                     |
| File storage     | **Local filesystem** (bind-mounted volume)        | Single-user homelab — see ADR-0001. Behind a `Storage` interface.              |
| DB backups       | **nfrastack/container-db-backup**                 | Scheduled, compressed, retention-managed — see `atlas-backups` skill           |
| Maps             | **MapLibre GL JS** + **Protomaps PMTiles**        | Fully self-hostable, no tile server, no licensing concerns                     |
| Geocoding        | **Nominatim** (public OSM) + DB cache             | Pin non-flight segments on maps — see ADR-0010                                 |
| Auth             | **Auth.js + PocketID** (OIDC, passkeys)           | Passwordless, phishing-resistant; see ADR-0002 and "Auth" section              |
| Data fetching    | **TanStack Query** (client) + RSC (server)        | Use RSC by default, Query for interactive client state                         |
| Validation       | **Zod**                                           | Schema-first input validation, shared client/server                            |
| Forms            | **react-hook-form** + Zod resolver                | Performant, type-safe                                                          |
| PDF parsing      | `pdf-parse` / `pdfjs-dist`                        | Most hotel/flight confirmations are text PDFs                                  |
| OCR fallback     | **Tesseract.js** (Node) or PaddleOCR sidecar      | Only when PDF text extraction fails                                            |
| Structuring      | **Ollama** (local LLM, e.g. Qwen)                 | Extract structured data from raw OCR/text — see ADR-0006                       |
| Airline lookup   | **Static IATA→name table** (OpenFlights snapshot) | Friendly carrier names without an external API — see ADR-0009                  |
| Airport lookup   | **Static IATA→airport table** (OurAirports)       | Coords + timezone for flight pins/times, no runtime API call                   |
| Jobs             | **pg-boss** (`Jobs` interface, Postgres-backed)   | Durable background work + recurring schedules; one schema, no Redis (ADR-0012) |
| Notifications    | **ntfy** (self-hosted)                            | Push reminders for upcoming segments, extraction events, errors                |
| Testing          | **Vitest** (unit) + **Playwright** (e2e)          | Fast unit, real-browser e2e                                                    |
| Lint / Format    | **ESLint** (flat config) + **Prettier**           | Standard                                                                       |
| Git hooks        | **Husky** + **lint-staged** + **gitleaks**        | Lint, format, and secret-scan staged files before commit                       |
| CI               | **GitHub Actions** (private repo, free 2k min/mo) | Lint, typecheck, test, build, secret-scan on PR/main                           |
| Dep updates      | **Dependabot** (grouped, weekly)                  | Free, no Actions minutes for itself                                            |
| Containerization | **Docker** + Docker Compose                       | Single-host self-hosting                                                       |

---

## Repository Layout

```
/
├── .claude/                 # Claude Code local settings (gitignored bits + settings.local.json)
├── .github/
│   ├── workflows/
│   │   └── ci.yml           # Lint · typecheck · test · build
│   ├── dependabot.yml       # Grouped weekly dep updates (npm, docker, actions)
│   └── pull_request_template.md
├── data/                    # Runtime data (GITIGNORED contents)
│   ├── documents/           # User-uploaded files, bind-mounted into the app
│   ├── tiles/               # Protomaps PMTiles (world basemap), bind-mounted at /api/tiles
│   └── backups/
│       ├── db/              # Compressed dumps from the db-backup container
│       └── documents/       # Snapshots produced by scripts/backup-documents.sh
├── docker/
│   ├── ollama/              # `atlas-extract` Modelfile + setup notes (LLM extraction)
│   └── postgres/            # Postgres init scripts (extensions)
├── docs/
│   ├── adr/                 # Architecture Decision Records (numbered, immutable once accepted)
│   ├── ARCHITECTURE.md      # High-level system design
│   └── DOMAIN_MODEL.md      # Entities, relationships, invariants
├── public/                  # Static assets
│   ├── basemaps-assets/     # Self-hosted MapLibre fonts + sprites (no third-party origins)
│   └── geo/                 # Static GeoJSON for the visited-countries world map
├── scripts/                 # Dev/ops scripts
├── src/
│   ├── app/                 # Next.js App Router (routes, layouts, server actions)
│   │   ├── (app)/           # Authenticated app shell (trips, documents, etc.)
│   │   ├── signin/          # Custom sign-in page (PocketID kick-off)
│   │   └── api/
│   │       ├── auth/        # Auth.js routes
│   │       └── documents/   # Authenticated download proxy for stored files
│   ├── components/
│   │   ├── ui/              # shadcn/ui primitives
│   │   └── features/        # Feature-scoped components (TripCard, FlightForm, MapView…)
│   ├── db/
│   │   ├── schema/          # Drizzle schemas, one file per domain aggregate
│   │   ├── migrations/      # Generated SQL migrations (committed)
│   │   └── client.ts        # DB connection
│   ├── lib/
│   │   ├── auth/            # Auth.js config — provider-agnostic
│   │   ├── storage/         # Filesystem storage adapter (see "Storage" section)
│   │   ├── documents/       # Document repo + server actions (upload/list/delete)
│   │   ├── trips/           # Trip repo + server actions
│   │   ├── segments/        # Flight/hotel/activity/transit/food/note repo + actions
│   │   ├── trip-map/        # Per-trip map data shaping (flight arcs, geocoded pins)
│   │   ├── geocoding/       # Nominatim client + DB-cached lookup (ADR-0010)
│   │   ├── airlines/        # Reference data — static IATA → airline-name lookup (OpenFlights snapshot)
│   │   ├── airports/        # Reference data — static IATA → airport (coords, tz, country)
│   │   ├── countries/       # Reference data — country names + ISO codes
│   │   ├── ocr/             # PDF text extraction + OCR fallback
│   │   ├── extraction/      # Ollama-backed structuring
│   │   ├── jobs/            # Jobs interface (send/register/schedule), pg-boss-backed — see ADR-0012
│   │   ├── notifications/   # ntfy client (planned — directory not yet present)
│   │   ├── maintenance/     # Reusable housekeeping (prune, status sweep) — shared by CLI + worker
│   │   ├── scheduler/       # Worker-side handler + schedule registration for pg-boss
│   │   ├── search/          # Cmd+K palette over Postgres FTS + pg_trgm (ADR-0013)
│   │   ├── stats/           # Read-only aggregation for the /stats dashboard
│   │   ├── validators/      # Shared Zod schemas
│   │   ├── format/          # Shared formatters (dates, money, durations)
│   │   └── log.ts           # Structured logger entrypoint
│   └── types/               # Cross-cutting types
├── docker-compose.yml       # Local dev stack (app, postgres, worker; db-backup behind profile)
├── docker-compose.prod.yml  # Production overlay
├── Dockerfile               # App image (dev + prod targets)
├── drizzle.config.ts        # Drizzle Kit config
├── .env.example             # Documented env vars (real .env is gitignored)
├── CLAUDE.md                # THIS FILE
└── README.md
```

**Rule:** New top-level directories require an entry in this section. If you create one, update this file in the same commit.

---

## Domain Model (Mental Model)

A high-level mental model — the canonical version lives in `docs/DOMAIN_MODEL.md`.

```
User
 └── Trip (id, title, summary, status, startDate, endDate, coverImageId)
      ├── Country[]               # countries visited on this trip (many-to-many)
      ├── Segment[]               # discriminated union: flight | hotel | activity | transit | food | note
      │    └── Document[]         # boarding pass, reservation, ticket (immutable originals)
      └── Location[]              # geocoded points for map rendering

Document
 ├── original file (on local filesystem, addressed by storage key)
 ├── parsed payload (JSONB, re-derivable)
 ├── extraction confidence + source method (pdf-text | ocr-tesseract | ocr-paddle | llm-ollama | manual)
 └── review status (pending | confirmed | rejected)
```

**Key invariants:**

- `Document.originalFile` is **immutable**. Never overwrite — store a new document and supersede.
- `Document.parsed` is **re-derivable**. We can re-run extraction with improved pipelines; user-confirmed values are preserved via `Document.overrides`.
- `Segment` uses a discriminated union via a `type` column + JSONB `data` column. Don't add per-segment-type SQL tables until a type's query patterns demand it.
- Dates are stored as `timestamptz`. UI handles timezone display.
- Money is stored as integer minor units + currency code. Never float.

---

## Auth

Atlas authenticates users via **PocketID** (passkey-only OIDC), integrated through Auth.js's generic OIDC provider. No passwords. No registration form. See **ADR-0002** for rationale and `src/lib/auth/README.md` for the contract.

- **Library:** Auth.js (NextAuth) — generic OIDC provider, not a PocketID-specific package.
- **Sessions:** DB-backed (not JWT) so revocation works. Drizzle adapter.
- **User creation:** just-in-time on first sign-in, keyed by OIDC `sub` claim. The `User` row stores `sub`, `email`, `name`, `groups[]` — refreshed from claims on every sign-in.
- **Provider isolation:** all provider config lives in `src/lib/auth/`. Feature code uses `getCurrentUser()` / `requireUser()` from `@/lib/auth/session` — never imports from `next-auth` directly, never references `pocket-id` by name.
- **At the network layer:** Atlas usually runs behind Tailscale. PocketID is reachable at its own URL. The app's own auth is the inner ring; reverse-proxy SSO is an outer ring you can layer on if you want defense in depth.

If you ever swap PocketID for Authentik / Authelia / Keycloak: it's a provider config change in `src/lib/auth/providers/`, plus an ADR. Feature code stays untouched.

---

## Storage (Documents)

Documents live on the **local filesystem**, bind-mounted into the container at `/app/data/documents`. See **ADR-0001** for the rationale (vs. MinIO/S3).

### Storage adapter contract

All file I/O goes through `src/lib/storage/`. The adapter exposes a small, swappable interface:

```ts
interface Storage {
  put(
    stream: ReadableStream | Buffer,
    opts: { mime: string; size: number },
  ): Promise<{ key: string; sha256: string }>;
  get(key: string): Promise<ReadableStream>;
  stat(key: string): Promise<{ size: number; mime: string; createdAt: Date }>;
  delete(key: string): Promise<void>;
  // Returns an internal app URL (NOT a public presigned URL). Authentication is enforced server-side.
  url(key: string, opts?: { disposition?: 'inline' | 'attachment'; filename?: string }): string;
}
```

### Storage rules

1. **Filenames are random.** The adapter generates `<yyyy>/<mm>/<uuid><ext>` from a random UUID. Never use user-supplied names on disk. The original filename is stored on the `Document` row for display.
2. **No direct file serving.** Nginx/Caddy never serves `/data/documents` directly. All reads go through `/api/documents/[id]`, which authenticates the user and authorises access against `Document.userId`.
3. **MIME via magic bytes.** Use `file-type` to detect actual MIME; don't trust `Content-Type` on upload.
4. **Hash on write.** Compute SHA-256 streaming during `put`. Store on `Document.sha256` for idempotency and integrity checks.
5. **Immutable.** Files on disk are write-once. To "update" a document, write a new key and supersede.
6. **Future-proofed.** If you ever outgrow local storage, swap `src/lib/storage/fs.ts` for `s3.ts`. Feature code MUST NOT import the adapter directly — only the `Storage` interface.

---

## External Integrations

Atlas talks to a small, deliberate set of outside services. Every one of them sits behind an interface so the choice is a config swap, never a feature rewrite.

### LLM extraction — Ollama (local-only)

Structured-data extraction (OCR/text → JSON) runs against a self-hosted **Ollama** instance. No cloud LLM calls. See **ADR-0006** for the rationale.

- **Interface:** `LLMExtractor` in `src/lib/extraction/`. Feature code only depends on the interface.
- **Implementation:** `src/lib/extraction/ollama.ts` — talks to `OLLAMA_URL`, model from `OLLAMA_MODEL`.
- **Default model:** `atlas-extract:latest` — a derived Ollama model built from `qwen2.5:7b` with deterministic sampling, `num_ctx 8192` (Ollama's default would silently truncate our 8000-char inputs), and a JSON-only SYSTEM prompt baked in. **This is not fine-tuning** — it's an Ollama Modelfile. Source and build instructions live in [`docker/ollama/`](./docker/ollama/). Build once on the Ollama host with `ollama create atlas-extract -f docker/ollama/atlas-extract.Modelfile`. Falling back to bare `qwen2.5:7b` still works but loses determinism and risks input truncation.
- **Behavior:** synchronous-ish from the caller's perspective today; once latency or queue depth justifies it, wrap in the future `Jobs` interface (see Extension Points).
- **Privacy:** no document content leaves the host. This is non-negotiable.
- **Swap door:** if you ever want a cloud fallback, drop a `ClaudeExtractor` (or similar) next to `ollama.ts` and switch via env. Don't reintroduce the cloud path without an ADR superseding 0006.

### Airline name lookup — static IATA → name table

The flight form stores carrier names ("Vietnam Airlines"), not bare IATA codes ("VN"). The lookup is a committed JSON snapshot from OpenFlights — no external API call at runtime. See **ADR-0009**.

- **Module:** `src/lib/airlines/` exposing `getAirlineName(iata)` (strict) and `displayCarrier(stored)` (UI helper that resolves IATA-shaped values and passes everything else through).
- **Data:** `src/lib/airlines/iata-airlines.json`, ~970 active carriers keyed by 2-character IATA designator.
- **Refresh:** `pnpm tsx scripts/fetch-airlines.ts` re-generates the JSON from openflights.org. Airlines don't change often; run this every few years or when a missing carrier turns up.
- **Applied at two layers:** the document-extraction mapper (`from-payload.ts`) resolves the IATA the LLM/pkpass extracted so the segment stores a friendly name; flight-segment cards also run `displayCarrier` so legacy rows storing a bare code still render readably without a data migration.

### Geocoding — Nominatim (public OSM endpoint, DB-cached)

Non-flight segments (hotels, activities, transit endpoints) get pinned on the per-trip map by geocoding their address through **Nominatim**, the public OpenStreetMap geocoder. Results are cached in Postgres with a TTL so we don't hit the public endpoint on every render. See **ADR-0010**.

- **Module:** `src/lib/geocoding/` — `geocode(query, type)` returns `{ lat, lon }` or `null`. Per-segment-type query builders shape the request (a hotel query is different from an activity query).
- **Cache:** `src/db/schema/geocode-cache.ts` keyed by normalised query. Past-expiry rows are treated as cache misses on read; the nightly `prune` job sweeps them out of the table.
- **Etiquette:** Nominatim's public usage policy requires a contact email in `User-Agent`. Set `NOMINATIM_CONTACT_EMAIL`. Don't hammer the endpoint — the DB cache is what makes this tolerable.
- **Labels vs. coordinates:** `Segment.locationName` is the pin's display label, NOT what we geocode. The geocode query is built per-segment-type from structured fields; the label stays whatever the user/extractor wrote.
- **Swap door:** if Nominatim usage limits ever bite, drop a self-hosted Nominatim instance or a different provider behind the same module. Cache schema stays the same.

### Push notifications — ntfy (planned)

Atlas pushes short, user-facing notifications to a self-hosted **ntfy** server: upcoming flight reminders, hotel check-in nudges, extraction completion / failure, and document upload errors. No third-party push providers.

- **Interface:** `Notifier` in `src/lib/notifications/` — `notify({ topic, title, body, priority, tags })`. Feature code only depends on the interface.
- **Implementation:** `src/lib/notifications/ntfy.ts` — `POST` to `${NTFY_URL}/${topic}` with appropriate headers. Token auth via `NTFY_TOKEN` when the server requires it.
- **Topic strategy:** one topic per user (`atlas-<userId-short>`), so a second household user gets their own stream. Topic name is stored on the `User` row, generated at first sign-in.
- **Triggering:** fired from server actions and the extraction orchestrator. Never block the caller — wrap dispatch in the `Jobs` interface so a slow or down ntfy server doesn't break the UI flow.
- **Graceful degradation:** ntfy unreachable → log and continue. Notifications are not the source of truth; the UI is.
- **Privacy:** notification bodies must not contain PNRs, passport numbers, or full document contents. Keep titles/bodies short and generic ("Flight VN54 in 4 hours · HAN → CDG").

### Operating rules for any external service

1. **Behind an interface.** Feature code never imports a provider SDK directly. One file per provider; one interface for the capability.
2. **Cache writes go through the DB.** No in-memory caches for cross-request data — they don't survive Next.js dev reloads or container restarts.
3. **Secrets in env only.** Never log API keys or full response bodies; redact at the logger boundary.
4. **Graceful degradation.** Every external call has a "the provider is down or rate-limited" path. Manual entry must always remain possible.
5. **No retries that compound quota.** A rate-limited free-tier API will not be saved by retries.

---

## Architectural Guardrails

1. **Server Components by default.** Reach for `'use client'` only when you need interactivity, browser APIs, or hooks. Justify client components in the PR description if non-obvious.
2. **Server Actions for mutations.** Avoid creating REST endpoints for first-party UI mutations; use server actions. Only add `/api/*` routes for: webhooks, third-party integrations, document streaming, exports, or programmatic access.
3. **No leaking the DB layer.** Components never import from `src/db/*`. All DB access happens in `src/lib/<feature>/repo.ts` or server actions.
4. **No leaking the storage layer.** Components never import from `src/lib/storage/*` directly; they get a URL string from a server action or repo function.
5. **No leaking the auth provider.** Feature code uses Auth.js's session abstraction — never references provider-specific fields. Makes the credentials → OIDC swap painless.
6. **Validation at trust boundaries.** Every server action and API route validates input with Zod. No exceptions.
7. **Documents are append-only.** New version → new row. Never mutate original files on disk.
8. **Extraction is layered.** Try cheap → expensive: `pdf-text → ocr → llm (Ollama)`. Log which path produced the final structured data. Cloud LLMs are not part of the pipeline — see ADR-0006.
9. **Idempotent imports.** Importing the same boarding pass twice doesn't create duplicate flights. Use content hashes.
10. **Migrations are forward-only.** `drizzle-kit generate` → review the SQL → commit. No rolling back in production; write a forward-fix migration instead.
11. **Secrets via env, never committed.** `.env.example` documents every required var. `.env` is gitignored. In CI, use GitHub Secrets.
12. **Errors are typed.** Return `Result<T, Error>` or throw tagged errors at boundaries. No silent catches.
13. **Reference data is a committed snapshot, not a runtime API.** Anything we can canonicalise — IATA codes, ISO country codes, the airport/aircraft data we'll add later — lives in `src/lib/<thing>/` as a committed JSON snapshot with a pure lookup module and a refresh script in `scripts/`. No DB, no runtime network, no provider. **Pair this with LLM extraction:** the LLM handles free-text fields the document prints (carrier name, flight time, hotel name); the lookup canonicalises the parts that have a stable identity (IATA → name). Don't reach for a live API when a snapshot will do — see ADR-0009 for the rationale.

---

## Coding Conventions

- **TypeScript:** `"strict": true`, plus `noUncheckedIndexedAccess`. No `any` without a justification comment.
- **Imports:** absolute paths via `@/*` alias rooted at `src/`.
- **File naming:** `kebab-case.ts` for files, `PascalCase` for React components inside (e.g. `trip-card.tsx` exports `TripCard`).
- **Component composition:** small, composable, props-typed. No giant page components — extract once you cross ~150 lines or three responsibilities.
- **Server actions:** colocated with the feature, exported from `actions.ts`, all input Zod-validated.
- **Tests:**
  - Unit tests next to the file: `foo.ts` + `foo.test.ts`.
  - E2E tests in `tests/e2e/`.
  - Don't test the framework. Test domain logic, validators, extraction pipelines, and critical user flows.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`). One logical change per commit.
- **Branches:** `feat/<short-name>`, `fix/<short-name>`. Main is always deployable.
- **PRs:** Small, focused, with description of what changed and _why_. Use the PR template. Reference the ADR if architectural.

---

## Security & Privacy (DevSecOps mindset)

This is a personal app but contains travel documents (passports, boarding passes, addresses). Treat it accordingly.

- **Auth:** see "Auth" section above. Provider-agnostic; sessions in DB.
- **Network:** Designed to run behind Tailscale or a reverse proxy with TLS (Caddy). Don't expose Postgres publicly.
- **CSRF:** Next.js server actions are CSRF-protected by default. Keep it that way; don't write custom mutation endpoints that bypass this.
- **Headers:** Strict CSP, HSTS, X-Content-Type-Options, Referrer-Policy. Configure in `next.config.ts`.
- **File uploads:**
  - Validate MIME via magic bytes (`file-type`), not `Content-Type`.
  - Enforce size limits server-side (config in env, default 20MB).
  - Store with random UUID filenames, never user-supplied names.
  - Serve via authenticated `/api/documents/[id]` route — never expose the data directory directly via the reverse proxy.
  - The download route MUST set `Content-Disposition` and `X-Content-Type-Options: nosniff`.
- **Path safety:** The storage adapter resolves all paths relative to `STORAGE_DIR` and rejects any key containing `..`, absolute paths, or null bytes. Test this.
- **Logging:** Structured JSON logs. **Never** log document contents, full PNRs, passport numbers, or auth tokens. Redact at the logger boundary.
- **Backups:** see the `atlas-backups` skill. Test restore from a real snapshot at least once per quarter.
- **Dependencies:** Dependabot handles updates. `pnpm audit` in CI as a soft signal.
- **Secret scanning:** gitleaks blocks credentials at three layers — a pre-commit hook, a CI job, and GitHub's server-side push protection. Rules and the allowlist live in `.gitleaks.toml`.
- **Threat model:** A one-pager lives in `docs/THREAT_MODEL.md` (to be written). Update when adding features that touch auth, file uploads, or external services.

---

## Performance Budgets

- LCP < 2.0s on the main trip list view (local network)
- Server actions < 300ms p95 for non-extraction work
- Extraction pipeline runs in the background, never blocks UI; user sees an optimistic "Processing…" state
- DB queries: indexed. Anything iterating over user trips uses a covering index.
- Document streaming: `/api/documents/[id]` streams the file — never `readFile` it into memory.

---

## Responsive Design (Non-Negotiable)

Atlas runs on a laptop at the desk while planning, and on a phone at the gate
or hotel front desk. Both must feel like the app was designed for that form
factor — not like one got stretched or cropped to fit the other.

This means UI work is done when it looks intentional at **both** ends of the
range, not when it merely doesn't break.

### Target viewports

| Class   | Width       | Primary input | Examples                      |
| ------- | ----------- | ------------- | ----------------------------- |
| Mobile  | 360–430px   | Touch         | iPhone 15, Pixel 8            |
| Tablet  | 768–1024px  | Touch + hover | iPad mini, iPad               |
| Laptop  | 1280–1440px | Pointer       | MacBook Air, most desk setups |
| Desktop | 1680px+     | Pointer       | External monitors             |

Tailwind's default breakpoints (`sm:` 640, `md:` 768, `lg:` 1024, `xl:` 1280,
`2xl:` 1536) cover this well. Use them.

### Rules

1. **Design for two anchors, not one.** When building a screen, sketch the
   360px and 1440px versions first. The intermediate widths should be smooth
   interpolations, not retrofits.

2. **Layout adapts, not just resizes.**
   - Phone: single column, bottom-anchored primary actions, hamburger or
     bottom nav.
   - Laptop: sidebar or top nav, multi-column where it earns the space
     (trip list + detail pane, map + itinerary side-by-side, etc.).
   - Don't stretch a mobile column to 1440px — that's wasted screen and
     looks amateur. Use it.

3. **Information density follows the viewport.** Show more columns, more
   metadata, more secondary actions on laptop. Hide non-essential things
   behind disclosure on mobile. Don't show the same dense table on both.

4. **Touch targets ≥ 44×44px on touch devices.** Use `@media (hover: hover)`
   to enable hover-only affordances on pointer devices, but never hide
   critical info or actions behind hover — they have to be reachable by
   touch too.

5. **Tables on laptop become card stacks on mobile.** A flight segment is
   a row in a table at 1440px and a card at 360px. Build the component
   to switch.

6. **Forms.**
   - Mobile: native input modes (`inputMode="email"`, `"numeric"`, `"tel"`),
     native pickers (`type="date"`, `type="time"`).
   - Laptop: keyboard-first. Tab order matters. `Enter` submits, `Esc` cancels.
   - Both: clear validation states, no jumping layout on error display.

7. **Keyboard shortcuts on laptop.** At minimum: `Cmd/Ctrl+K` opens a
   command palette / search, `Esc` closes modals, `/` focuses search.
   Don't gate primary actions behind shortcuts — touch users still need them.

8. **Respect device chrome.** Use `env(safe-area-inset-*)` on iOS so nothing
   hides behind the notch or home indicator. Sticky bottom bars on mobile
   account for this padding.

9. **No horizontal scroll** anywhere outside an intentional component
   (e.g. a date-range timeline strip).

10. **Map view** is touch-pannable, pinch-zoomable, and scroll-wheel-zoomable.
    MapLibre handles this; don't override. The surrounding UI (filters, legend,
    trip overlay) follows the density rule — compact controls on laptop,
    larger touch-friendly versions on mobile.

### Definition of done for any UI feature

Before declaring a UI change complete, verify in browser devtools at:

- **360×640** — iPhone SE class, smallest realistic target
- **1440×900** — typical MacBook viewport

Both should look intentional. If one looks like a compromise made to make
the other work, the design isn't done yet.

---

## Workflow Expectations for Claude Code

When working in this repo, Claude Code is expected to:

1. **Read before writing.** Skim `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN_MODEL.md`, and the closest existing feature before adding code.
2. **Match existing patterns.** If a feature already does X a certain way, follow it. If you want to deviate, propose an ADR first.
3. **Plan, then code.** For any non-trivial change (>1 file, schema change, new feature), produce a brief plan first. Wait for confirmation on architectural moves.
4. **Keep CLAUDE.md current.** If you change conventions, structure, or major tech choices, update this file in the same PR.
5. **Feature-sized work uses a worktree and a PR; trivial fixes go directly to `main`.** Before any new task, run `git pull --ff-only` on `main` so you branch from current remote state, not a stale local commit. Feature work then happens in a sibling-directory worktree (`../<repo>-<branch>`) and lands via PR. Typo fixes, doc tweaks, and one-line changes can commit straight to `main` — no worktree, no PR (still pull first). Once the repo is public, CodeRabbit reviews every PR automatically.

### Procedural skills

Detailed procedures live as auto-loaded skills under `.claude/skills/`. Reach for these when the trigger applies — they aren't loaded into every session, so they don't clog this file:

- **`atlas-quality-gates`** — pre-merge checklist (typecheck / lint / test / build + responsive verify at 360 × 640 and 1440 × 900)
- **`atlas-migrations`** — Drizzle schema → `pnpm db:generate` → review SQL → commit-both workflow
- **`atlas-commands`** — full reference for `pnpm dev:up`, db tasks, backup commands, scheduler, maintenance
- **`atlas-env-vars`** — every documented environment variable and what it controls
- **`atlas-backups`** — DB dumps via the `db-backup` service, documents rsync, restore wizard, nightly DB prune
- **`atlas-ci`** — what CI runs, the 2k-minute budget, and rules for adding workflows safely
- **`atlas-agents`** — when to invoke which sub-agent (Frontend Developer, Backend Architect, etc.)

---

## Extension Points (Designed for Future Growth)

The following are deliberately stubbed but not yet built. Keep them in mind so today's decisions don't paint them into a corner:

- **Household sharing visibility.** Atlas is built for ~2 users via separate PocketID identities, not SaaS-scale tenancy. The chosen model is **full household sharing by default**: `userId` columns mean `createdBy` provenance, not ownership. If per-trip privacy is ever needed, the only acceptable extension is a `trips.visibility` enum on the existing schema — not an `ownerships` join table.
- **Mobile companion.** Backend is API-first via server actions + a small `/api` surface. A future Expo/React Native app can consume it.
- **ntfy notifications.** Push reminders for upcoming flights / hotel check-ins, plus extraction success/failure. Self-hosted ntfy server, per-user topic. See "External Integrations → Push notifications".
- **Calendar sync.** ICS export of confirmed segments; CalDAV later.
- **Storage backend swap.** If usage ever justifies it, replace `src/lib/storage/fs.ts` with `s3.ts`. The `Storage` interface stays the same.
- **Job queue (graduation past pg-boss).** The `Jobs` interface at `src/lib/jobs/` is backed by **pg-boss** (ADR-0012, accepted). Three methods — `send` (app code), `register` + `schedule` (worker only). One Postgres schema (`pgboss.*`), one container (`worker` compose service), one operational model for ad-hoc + scheduled work. If pg-boss ever stops being enough — multi-tenant scale, sub-second latency — BullMQ + Redis is the next graduation step behind the same interface.

---

## Decision Log

Architectural decisions live in `docs/adr/` as numbered ADRs.

- **ADR-0001** — Local filesystem for document storage (vs. MinIO/S3). Accepted.
- **ADR-0002** — Auth via PocketID (passkey-only OIDC). Accepted.
- **ADR-0003** — Wishlist trips modelled via nullable `startsAt`. Accepted.
- **ADR-0004** — Tabbed trip detail layout. Accepted.
- **ADR-0005** — Per-segment country attribution (dual column for flights). Accepted.
- **ADR-0006** — Ollama (local-only) for LLM extraction. Accepted.
- **ADR-0007** — AviationStack free tier for flight metadata lookup. Superseded by ADR-0009.
- **ADR-0008** — Auto-create and link segments on document extraction (manual trigger, soft ±2 day date check). Accepted.
- **ADR-0009** — Drop flight-metadata lookup; Ollama extracts times directly + static airline-name table. Accepted.
- **ADR-0010** — Geocoding via Nominatim (public OSM endpoint), DB-cached. Accepted.
- **ADR-0011** — Self-hosted Protomaps PMTiles basemap (bind-mounted, byte-range served, no third-party tile origins). Accepted.
- **ADR-0012** — pg-boss for durable jobs and in-stack scheduling (graduates `Jobs` and the `worker` service from their minimal in-process implementations). Accepted.
- **ADR-0013** — Postgres-native search via generated `tsvector` columns directly on source tables (no central `search_index`, no out-of-process search engine). Accepted.

When making a non-obvious choice (a library, a pattern, a tradeoff), write a short ADR. Template in `docs/adr/0000-template.md`.

---

## Out of Scope (Will Not Be Built)

These were considered and **deliberately dropped** — not just deferred. Don't reintroduce without an ADR.

- **Email ingest via n8n.** Won't ship. The extraction pipeline is invoked from the upload UI; there is no shared inbox.
- **PDF itinerary export.** Won't ship. The app is the canonical view; no printable export.
- **Trip sharing (public read-only links).** Won't ship. Atlas runs on a private network (Tailscale / homelab); it is never exposed publicly.
- **Live flight status (delays / gates).** Won't ship. Would require a paid provider; not worth the dependency for a personal app.
- **Hotel metadata lookup provider.** Won't ship. Extraction already pulls hotel names/addresses from confirmations and geocoding handles lat/lon. Manual entry covers the rest.

Deferred until v1.0 ships (not actively planned, but not rejected either):

- **Cost tracking.** Per-segment and per-trip expense aggregation. Design was reached (costs on segments, DB-backed daily FX, `splitCount`, ISO 4217 currency picker) and shelved because incidentals won't get logged consistently — partial totals would mislead. Money is already stored as integer minor units, so adding it later is additive.
- Real-time collaboration / CRDTs
- AI-generated trip suggestions / itineraries
- Public trip discovery / social features
- Payment processing

When in doubt: **ship the boring, reliable version first.**
