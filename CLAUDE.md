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

| Layer            | Choice                                            | Why                                                               |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Framework        | **Next.js 15** (App Router, RSC)                  | Full-stack TS, mature ecosystem, server actions                   |
| Language         | **TypeScript** (strict mode)                      | Type safety end-to-end                                            |
| Styling          | **Tailwind CSS** + **shadcn/ui**                  | Sophisticated default, zero lock-in, fully owned components       |
| Database         | **PostgreSQL 18**                                 | JSONB, native UUIDv7, async I/O, FTS, PostGIS-ready               |
| ORM              | **Drizzle ORM** + `drizzle-kit`                   | SQL-first, lightweight, great TS inference                        |
| File storage     | **Local filesystem** (bind-mounted volume)        | Single-user homelab — see ADR-0001. Behind a `Storage` interface. |
| DB backups       | **nfrastack/container-db-backup**                 | Scheduled, compressed, retention-managed — see "Backups" section  |
| Maps             | **MapLibre GL JS** + **Protomaps PMTiles**        | Fully self-hostable, no tile server, no licensing concerns        |
| Geocoding        | **Nominatim** (public OSM) + DB cache             | Pin non-flight segments on maps — see ADR-0010                    |
| Auth             | **Auth.js + PocketID** (OIDC, passkeys)           | Passwordless, phishing-resistant; see ADR-0002 and "Auth" section |
| Data fetching    | **TanStack Query** (client) + RSC (server)        | Use RSC by default, Query for interactive client state            |
| Validation       | **Zod**                                           | Schema-first input validation, shared client/server               |
| Forms            | **react-hook-form** + Zod resolver                | Performant, type-safe                                             |
| PDF parsing      | `pdf-parse` / `pdfjs-dist`                        | Most hotel/flight confirmations are text PDFs                     |
| OCR fallback     | **Tesseract.js** (Node) or PaddleOCR sidecar      | Only when PDF text extraction fails                               |
| Structuring      | **Ollama** (local LLM, e.g. Qwen)                 | Extract structured data from raw OCR/text — see ADR-0006          |
| Airline lookup   | **Static IATA→name table** (OpenFlights snapshot) | Friendly carrier names without an external API — see ADR-0009     |
| Airport lookup   | **Static IATA→airport table** (OurAirports)       | Coords + timezone for flight pins/times, no runtime API call      |
| Jobs             | **In-process `Jobs` interface** (`InlineJobs`)    | Background work without a queue today; BullMQ swap when needed    |
| Notifications    | **ntfy** (self-hosted)                            | Push reminders for upcoming segments, extraction events, errors   |
| Testing          | **Vitest** (unit) + **Playwright** (e2e)          | Fast unit, real-browser e2e                                       |
| Lint / Format    | **ESLint** (flat config) + **Prettier**           | Standard                                                          |
| Git hooks        | **Husky** + **lint-staged**                       | Enforce gates before commit                                       |
| CI               | **GitHub Actions** (private repo, free 2k min/mo) | Lint, typecheck, test, build on PR/main                           |
| Dep updates      | **Dependabot** (grouped, weekly)                  | Free, no Actions minutes for itself                               |
| Containerization | **Docker** + Docker Compose                       | Single-host self-hosting                                          |

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
│   │   ├── segments/        # Flight/hotel/activity/transit/note repo + actions
│   │   ├── trip-map/        # Per-trip map data shaping (flight arcs, geocoded pins)
│   │   ├── geocoding/       # Nominatim client + DB-cached lookup (ADR-0010)
│   │   ├── airlines/        # Reference data — static IATA → airline-name lookup (OpenFlights snapshot)
│   │   ├── airports/        # Reference data — static IATA → airport (coords, tz, country)
│   │   ├── countries/       # Reference data — country names + ISO codes
│   │   ├── ocr/             # PDF text extraction + OCR fallback
│   │   ├── extraction/      # Ollama-backed structuring
│   │   ├── jobs/            # In-process Jobs interface (`InlineJobs`) — swap door for BullMQ
│   │   ├── notifications/   # ntfy client (planned — directory not yet present)
│   │   ├── maintenance/     # Reusable housekeeping (prune queries) — shared by CLI + scheduler
│   │   ├── scheduler/       # In-stack cron (croner). Runs in the `cron` compose service.
│   │   ├── validators/      # Shared Zod schemas
│   │   ├── format/          # Shared formatters (dates, money, durations)
│   │   └── log.ts           # Structured logger entrypoint
│   └── types/               # Cross-cutting types
├── docker-compose.yml       # Local dev stack (app, postgres, cron; db-backup behind profile)
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
      ├── Segment[]               # discriminated union: flight | hotel | activity | transit | note
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

## Backups

Two layers, captured into the same snapshot tree so a single offsite sync covers both.

### 1. Postgres → `nfrastack/container-db-backup`

Runs as the `db-backup` service in compose.

- **Schedule:** daily at 03:30 (configurable via `DB01_BACKUP_BEGIN`).
- **Compression:** ZSTD level 3 (good ratio, fast).
- **Checksums:** SHA1 alongside each dump.
- **Retention:** 30 days in dev, 90 in prod (configurable via `DB01_CLEANUP_TIME`).
- **Archive:** older dumps move to an `archive/` subdir for offsite-friendly handling.
- **Output:** `./data/backups/db/` on the host.
- **Profile:** opt-in (`--profile backup`) in dev; activated in prod via the same flag.
- **Restores:** enter the container and run `restore` for an interactive wizard. Document any restoration drills in `docs/OPERATIONS.md` when it's written.

### 2. Documents → `scripts/backup-documents.sh`

The DB-backup container only knows about Postgres. The documents directory is host-side, captured by a small rsync-based script.

- **Schedule:** suggested cron entry on the host at 03:35 (just after the DB dump).
- **Output:** `./data/backups/documents/<UTC-timestamp>/`.
- **Retention:** 30 days by default (env-tunable).

### 3. Offsite (operator's responsibility)

`./data/backups/` is the only directory you need to rsync offsite. One target captures both DB and documents.

When adding a second stateful service later, route its backups into `./data/backups/<service>/` so the offsite story stays "one directory."

### 4. Nightly DB prune (in-stack)

Auth.js doesn't reap its own expired `sessions` / `verificationTokens`, and the geocode cache (`src/db/schema/geocode-cache.ts`) treats past-expiry rows as cache misses on read but never deletes them. The `cron` compose service sweeps all three nightly.

- **How it runs:** the `cron` service in `docker-compose.yml` reuses the Atlas image with the `pnpm cron` entrypoint (`scripts/cron.ts`). Inside, `src/lib/scheduler/` uses `croner` to register jobs. Today there's one job — `prune` — but new scheduled work (e.g. upcoming-flight ntfy reminders) registers in the same place.
- **Default schedule:** 03:40 daily, UTC. Override with `CRON_PRUNE_SCHEDULE` (six-field cron expression, `sec min hour day month weekday`) and `CRON_TZ` (IANA zone) in `.env`.
- **Behaviour:** the cron job calls into `src/lib/maintenance/prune.ts`, the same module the CLI uses. They never diverge. Concurrent runs are blocked (`protect: true` in `Cron`), so a stuck DB won't pile up parallel attempts.
- **Manual run (anytime):** `pnpm db:prune` (dry-run) or `pnpm db:prune --apply`.
- **No host cron required.** This works out of the box on plain Docker Compose or any single-host orchestrator that can run a second container.
- Pruning is purely housekeeping — the read paths already ignore expired rows, so this only reclaims storage, it doesn't change behaviour.

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

## CI / GitHub Actions

The repo runs on GitHub Actions under the free 2,000-minute private-repo allowance. Defaults are chosen to stay well inside that budget.

### What runs

`.github/workflows/ci.yml` runs on every push to `main` and every PR targeting it:

1. Set up pnpm + Node (version pinned by `.nvmrc`)
2. `pnpm install --frozen-lockfile` (cached by pnpm-lock hash)
3. `pnpm db:migrate` against a Postgres service container
4. `pnpm typecheck` · `pnpm lint` · `pnpm test --run` · `pnpm build`

### Cost discipline

- **Linux runners only** (1x multiplier). No macOS or Windows.
- `concurrency` group cancels superseded runs on the same branch.
- pnpm cache enabled via `actions/setup-node`.
- `timeout-minutes: 15` per job — fail fast on a stuck pipeline.
- Dependabot groups minor/patch updates, so one PR triggers one CI run, not ten.

Rough budget at 4 minutes/run: ~500 runs/month before exhausting the free tier. Track usage at _Settings → Billing → Plans and usage_.

### Adding workflows

Be careful about adding workflows that burn minutes. Heavy candidates to defer or gate:

- Docker image builds → push to GHCR. Only on tag, not every push.
- E2E (Playwright) → only on PRs, not push to main, or only when changed paths include `src/app/`.
- Security scans → fine, usually fast.

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
- **Backups:** see "Backups" section. Test restore from a real snapshot at least once per quarter.
- **Dependencies:** Dependabot handles updates. `pnpm audit` in CI as a soft signal.
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
4. **Schema changes go through migrations.** Edit the Drizzle schema, run `pnpm db:generate`, review the SQL, commit both.
5. **Run gates before declaring done:**
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
   - Build the app (`pnpm build`) if you touched routing, RSC boundaries, or config.
6. **Keep CLAUDE.md current.** If you change conventions, structure, or major tech choices, update this file in the same PR.
7. **Use the agents.** See below.

---

## Agents

Sub-agents are installed at the **user scope** (`~/.claude/agents/`), shared across all projects on this machine. There is no project-scoped `.claude/agents/` directory in this repo — if a future need calls for a truly Atlas-specific agent, add `.claude/agents/<name>.md` and document it here.

**Recommended agents for this project:**

| Agent                 | When to invoke                                                     |
| --------------------- | ------------------------------------------------------------------ |
| Frontend Developer    | React/Next.js component work, UI features                          |
| Backend Architect     | API design, server actions, data flow design                       |
| Database Optimizer    | Schema design, indexing, query tuning                              |
| Software Architect    | New module/aggregate, cross-cutting design, ADR drafting           |
| Security Engineer     | Auth changes, file upload paths, anything touching secrets/PII     |
| Code Reviewer         | Pre-merge review on any non-trivial PR                             |
| Technical Writer      | Updating docs/, ADRs, README                                       |
| Git Workflow Master   | Branching strategy, commit hygiene, history cleanup                |
| Reality Checker       | "Is this actually production-ready?" gate before tagging a release |
| Accessibility Auditor | New UI surfaces, before considering a feature complete             |

**Invocation:** Reference the agent by name in a Claude Code session:

> "Use the Backend Architect agent to design the segment import flow."
> "Have the Security Engineer review this file upload code."
> "Run the Reality Checker before I tag v0.1."

---

## Environment Variables

See `.env.example` for the full documented list. At minimum:

- `DATABASE_URL` — Postgres connection string
- `AUTH_SECRET` — random 32+ byte secret for Auth.js
- `AUTH_URL` — canonical app URL
- `OIDC_ISSUER_URL` — PocketID base URL (e.g. `https://id.example.com`)
- `OIDC_CLIENT_ID` — from PocketID admin UI
- `OIDC_CLIENT_SECRET` — from PocketID admin UI
- `STORAGE_DIR` — document storage root. Default `./data/documents` (project-relative — works for `pnpm dev`). docker-compose overrides to the absolute container path `/app/data/documents` and bind-mounts the host directory onto it.
- `STORAGE_MAX_BYTES` — per-upload size cap, default `20971520` (20MB)
- `STORAGE_ALLOWED_MIMES` — comma-separated MIME allowlist enforced server-side after magic-byte detection
- `TILES_DIR` — directory holding Protomaps PMTiles served by `/api/tiles` (default `./data/tiles`)
- `PROTOMAPS_PMTILES_URL` — URL the client loads the basemap from (default `/api/tiles/world.pmtiles`)
- `OCR_ENGINE` — `tesseract` (default, in-process) or `paddle` (sidecar via `PADDLEOCR_URL`)
- `PADDLEOCR_URL` — base URL of the PaddleOCR sidecar (only when `OCR_ENGINE=paddle`)
- `OLLAMA_URL` — base URL of the Ollama instance used for extraction (default `http://localhost:11434`)
- `OLLAMA_MODEL` — model tag to use (e.g. `qwen2.5:7b`)
- `NOMINATIM_CONTACT_EMAIL` — contact email sent in the Nominatim `User-Agent` (required per Nominatim usage policy)
- `NTFY_URL` — base URL of the self-hosted ntfy server (e.g. `https://ntfy.example.com`)
- `NTFY_TOKEN` — optional access token when the ntfy server requires auth
- `CRON_PRUNE_SCHEDULE` — six-field cron expression for the nightly prune (default `0 40 3 * * *`)
- `CRON_TZ` — IANA timezone for scheduler jobs (default `UTC`)
- `ATLAS_DEV_ORIGINS` — comma-separated origins allowed for cross-origin RSC/HMR in `pnpm dev` (homelab LAN access). No effect in prod.
- `NEXT_PUBLIC_ATLAS_DATE_FORMAT` — client-side date display format (default `iso`)
- `LOG_LEVEL` — pino log level (`trace` | `debug` | `info` | `warn` | `error`), default `info`
- `LOG_PRETTY` — `true` to pretty-print logs in dev; leave `false` in prod for JSON

---

## Common Commands

```bash
# First-time setup (one-time)
pnpm install
cp .env.example .env       # then edit .env — set AUTH_SECRET and (for sign-in) OIDC_*

# The one-shot dev command — every iteration after first-time setup
pnpm dev:up                # docker compose up -d --wait postgres → migrate → seed → next dev

# Individual pieces (when dev:up is overkill)
pnpm dev                   # just next dev (requires postgres running + DB migrated)
pnpm db:setup              # migrate + seed
pnpm db:reset              # nuke postgres volume, bring up fresh, migrate + seed
pnpm db:generate           # generate a migration from schema changes
pnpm db:migrate            # apply pending migrations only
pnpm db:seed               # seed dev data only
pnpm db:studio             # Drizzle Studio (browse DB)

# Full compose stack (app container, not just postgres)
docker compose up -d                      # app + postgres
docker compose --profile backup up -d     # also activate scheduled DB backups

# Quality gates (what CI runs)
pnpm typecheck
pnpm lint
pnpm test                  # Vitest
pnpm test:e2e              # Playwright (local only — not in CI yet)
pnpm build                 # Production build

# Backups
./scripts/backup-documents.sh                  # docs snapshot (DB handled by the container)
docker compose exec db-backup backup-now       # trigger an ad-hoc DB dump
docker compose exec -it db-backup restore      # interactive restore wizard

# Maintenance
pnpm docs:cleanup-orphans                      # list documents with no trip/segment links (dry-run)
pnpm docs:cleanup-orphans --apply              # delete the orphan rows + files
pnpm db:prune                                  # list expired sessions/tokens/geocode rows (dry-run)
pnpm db:prune --apply                          # delete expired rows from all three tables
pnpm db:prune --sessions --apply               # scope to a single table (also --tokens, --geocode)

# Scheduler (runs automatically in the `cron` compose service)
pnpm cron                                      # boot the scheduler locally (foreground, SIGINT to stop)
docker compose logs -f cron                    # tail the in-stack scheduler running in Docker
```

---

## Extension Points (Designed for Future Growth)

The following are deliberately stubbed but not yet built. Keep them in mind so today's decisions don't paint them into a corner:

- **Multi-user / household sharing.** Atlas is built for ~2 users via separate PocketID identities, not SaaS-scale tenancy. Schema has `userId` everywhere from day one; add an `ownerships` join table for shared trips when household-sharing UX is designed.
- **Mobile companion.** Backend is API-first via server actions + a small `/api` surface. A future Expo/React Native app can consume it.
- **Cost tracking.** Per-segment and per-trip expense aggregation. Money is already integer-minor-units, so this is additive — add a `expenses` table and a trip-level rollup view; no schema rewrites needed.
- **ntfy notifications.** Push reminders for upcoming flights / hotel check-ins, plus extraction success/failure. Self-hosted ntfy server, per-user topic. See "External Integrations → Push notifications".
- **Calendar sync.** ICS export of confirmed segments; CalDAV later.
- **Storage backend swap.** If usage ever justifies it, replace `src/lib/storage/fs.ts` with `s3.ts`. The `Storage` interface stays the same.
- **Job queue.** A small `Jobs` interface lives at `src/lib/jobs/` with an in-process floating-promise implementation (`InlineJobs`). Use it for any background work that would otherwise block a server action — extraction is the first consumer. When in-process stops being enough (multi-process, restart-survivability, retry policies, scheduled work), swap the implementation for BullMQ + Redis behind the same interface and write an ADR.

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
- **ADR-0012** — pg-boss for durable jobs and in-stack scheduling (graduates `Jobs` and `cron` service from their minimal in-process implementations). Proposed.
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

- Real-time collaboration / CRDTs
- AI-generated trip suggestions / itineraries
- Public trip discovery / social features
- Payment processing

When in doubt: **ship the boring, reliable version first.**
