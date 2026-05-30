# Architecture

> Living document. Sections here are binding until superseded by an ADR
> (see [`adr/`](./adr/)). Last reviewed: 2026-05-30.

## High-level diagram

```
                         ┌─────────────────────┐
                         │     Browser (UI)    │
                         │ Next.js RSC + React │
                         └──────────┬──────────┘
                                    │ HTTPS (Caddy/Tailscale)
                                    ▼
                         ┌─────────────────────┐
                         │   Next.js App (TS)  │
                         │  RSC · Server Acts  │
                         │  /api routes (few)  │
                         └─┬──────────────┬────┘
                           │              │
                  ┌────────┘              └─────────┐
                  ▼                                 ▼
         ┌──────────────┐                   ┌────────────────┐
         │  PostgreSQL  │◄──────┐           │  Extraction    │
         │  (Drizzle)   │       │ scheduled │  pdf · OCR ·   │
         │              │       │ pg_dump   │  Ollama (local)│
         └──────┬───────┘       │           └────────────────┘
                │               │
                │ fs r/w via    │
                │ storage adptr │
                ▼               │
     ┌───────────────────┐      │
     │  data/documents/  │      │
     │  (bind mount)     │      │
     └───────────────────┘      │
                                │
                       ┌────────┴───────────┐
                       │  db-backup         │
                       │  (nfrastack image) │
                       │  ZSTD · retention  │
                       └─────────┬──────────┘
                                 ▼
                       ┌────────────────────┐
                       │ data/backups/db/   │
                       │ (bind mount)       │
                       └────────────────────┘
                                 ▲
                                 │ rsync (host cron)
                                 │
                       ┌────────────────────┐
                       │ Offsite (rsync)    │
                       └────────────────────┘
```

## Request flow (typical)

1. User loads `/trips` → React Server Component reads via repo layer → renders HTML.
2. User adds a flight → form submits via Server Action → Zod-validated → repo writes → revalidate path.
3. User uploads a hotel PDF →
   - Upload handler streams the file to disk via `lib/storage` (computes SHA-256 inline, validates MIME via magic bytes).
   - A `Document` row is inserted with `status='pending'` and the generated storage key.
   - Background job (or inline if quick) runs the extraction pipeline.
   - Pipeline writes `Document.parsed` JSONB and `Document.confidence`.
   - UI shows the parsed result for user confirmation.
   - On confirm → a `Segment(hotel)` row is created or updated, linked to the document.
4. User views a stored boarding pass → browser loads `/api/documents/[id]` → handler authenticates, looks up `Document.objectKey`, streams the file from the storage adapter with proper headers (`Content-Disposition`, `nosniff`, `Cache-Control: private`).

## Storage layer

Documents live on the local filesystem, addressed by a generated key (`<yyyy>/<mm>/<uuid><ext>`). All access goes through the `Storage` interface in `src/lib/storage/`. Today's implementation is `fs.ts`, using `node:fs/promises` and `node:stream`. Future-you can swap in `s3.ts` without touching feature code if the personal-app assumption ever breaks.

See **ADR-0001** for the local-filesystem decision and **CLAUDE.md → Storage** for the contract and rules.

## Backup layer

Two coordinated paths, captured into a single offsite-friendly tree:

- **DB dumps** — `db-backup` container (nfrastack image), ZSTD-compressed, retention-managed. Writes to `./data/backups/db/`.
- **Documents** — `scripts/backup-documents.sh` rsyncs `./data/documents/` into `./data/backups/documents/<timestamp>/`. Runs from host cron after the DB dump.

Operator's offsite rsync targets `./data/backups/` and captures everything.

See **CLAUDE.md → Backups** for schedules, retention, and restore commands.

## Extraction pipeline

```
Input file → detect type
  ├── PDF (text)  → pdf-parse → raw text
  ├── PDF (scan)  → pdfjs rasterize → Tesseract/Paddle → raw text
  ├── Image       → Tesseract/Paddle → raw text
  └── PKPass      → unzip + JSON → already structured

Raw text → LLM structuring (Ollama, local)
        → JSON {hotel: {…}, checkIn, checkOut, confirmation, price, …}
        → confidence score per field
        → user review UI
```

Cloud LLMs are explicitly **not** part of this pipeline (see ADR-0006). The
`LLMExtractor` interface in `src/lib/extraction/` makes the choice swappable
if that ever changes.

### Smart form-fill (parallel path)

Manual segment entry stays manual. The document-extraction pipeline pulls dates,
times, and airline names directly from the file via Ollama plus a static airline
lookup — no live flight-metadata API. See ADR-0009 for the rationale.

- **Airline name auto-fill** → `displayCarrier()` against the static
  `iata-airlines.json` snapshot (OpenFlights). Pure-local; no network.
- **Country auto-fill** → derived from the existing Nominatim geocode of a
  segment's address (ADR-0010). No new provider.

## Key non-functional requirements

- **Privacy:** all data stays on the host. Document content never leaves it — LLM structuring runs against a local Ollama instance, by design (ADR-0006). No outbound calls in the runtime hot path; the only network call in the extraction layer is the static-data refresh script (run rarely, manually).
- **Resilience:** extraction failures degrade gracefully — the document is still stored; user can manually enter.
- **Backups:** see above. Test restore from a real snapshot quarterly.
- **Reversibility:** parsing can be re-run; user confirmations are preserved via `Document.overrides`.

## Open questions

_(Track these as ADRs once decided.)_

- Job queue: **resolved** — pg-boss backs the `Jobs` interface for durable work and in-stack scheduling (ADR-0012).
- Search: **resolved** — Postgres-native `tsvector` columns on the source tables, no out-of-process search engine (ADR-0013).
- Image thumbnailing: sharp in-process vs sidecar? Probably in-process — `sharp` is good enough for one user.
