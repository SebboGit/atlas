<div align="center">

# Atlas

**Self-hosted personal travel companion.**

Trips, flights, hotels, activities, documents and maps.

[![CI](https://github.com/SebboGit/atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/SebboGit/atlas/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)](.nvmrc)
[![License: PolyForm NC 1.0.0](https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/SebboGit/atlas?sort=semver)](https://github.com/SebboGit/atlas/releases)

<br />

![Trip map with flight arcs between Europe and Japan](./docs/screenshots/trip-map.png)

</div>

---

## What Atlas is

Atlas is a self-hosted travel app for one user or a small household. It
manages a trip end-to-end: the planning, the documents you receive by email,
the day-of-departure checklist, and the trip itself. Boarding passes, hotel
confirmations, and PKPasses are parsed locally by a small LLM, so flights,
hotels, and transit show up as segments without manual entry. Trips also
include activities, undated wishlist items, freeform notes, and two map
views — a per-trip map with flight arcs and a global map of every country
you've been to. All extraction, geocoding, and tile serving happens on your
own hardware. Built for homelab self-hosting on the same machine you already
run Nextcloud, Immich, or Plex on.

## Features

- **Trips & itineraries** — flights, hotels, activities, transit, and notes in one timeline.
- **Document extraction** — local PDF → OCR → LLM pipeline. Files stay on your disk.
- **Maps** — global countries-visited choropleth plus per-trip flight arcs and pins. Self-hosted basemap.
- **Passwordless auth** — passkeys via PocketID (OIDC).
- **Wishlist mode** — undated activities pinned to a trip, promoted to the itinerary when scheduled.
- **Multi-leg flights** — one document, one PNR, many segments. Edits propagate in a single transaction.
- **Backups** — daily Postgres + document snapshots, ready for offsite rsync.
- **Notifications** — push reminders via self-hosted [ntfy](https://ntfy.sh) _(planned)_.

## Typical workflow

1. Create a trip with a title and dates.
2. Upload everything from your inbox — boarding passes, hotel confirmations, train tickets, PKPasses.
3. Run extraction. Ollama parses each file locally; segments auto-generate and link back.
4. Itinerary usually complete in minutes.
5. Add activities or wishlist items for anything not yet booked.

## Screenshots

### Countries visited

Global map of everywhere you've been.

![Global map showing countries visited as a choropleth](./docs/screenshots/world-map.png)

### Trip detail

Tabbed itinerary with a country filter for multi-country trips.

![Trip detail page showing a day-by-day itinerary with a flight segment](./docs/screenshots/trip-detail.png)

### Documents

Uploaded files with extraction status and parsed fields.

![Documents tab showing uploaded files with extraction status](./docs/screenshots/documents.png)

### Trip map — zoomed in

Click a pin to zoom in on a city and see its details.

![Trip map zoomed in on a city with a hotel pin selected](./docs/screenshots/trip-map-zoom.png)

## Tech stack

| Layer         | Choice                                 |
| ------------- | -------------------------------------- |
| Framework     | Next.js 16 (App Router, RSC)           |
| Language      | TypeScript (strict)                    |
| Styling       | Tailwind CSS + shadcn/ui               |
| Database      | PostgreSQL 18 + Drizzle ORM            |
| Storage       | Local filesystem (swappable interface) |
| Maps          | MapLibre GL JS + Protomaps PMTiles     |
| Auth          | Auth.js + PocketID (OIDC, passkeys)    |
| Extraction    | pdf-parse → Tesseract/Paddle → Ollama  |
| Geocoding     | Nominatim with a DB-backed cache       |
| Notifications | ntfy _(planned)_                       |
| Testing       | Vitest + Playwright                    |
| Containers    | Docker + Docker Compose                |

The full rationale and architectural rules live in [`CLAUDE.md`](./CLAUDE.md).
Decisions of consequence are recorded as ADRs in [`docs/adr/`](./docs/adr/).

---

## Quick start

### Run the published images (Docker Compose)

**Requires:** Docker with Compose v2. No source checkout or Node toolchain
needed — this pulls the released images from GHCR.

Each release publishes **two** images from one version: the app at
`ghcr.io/sebbogit/atlas` and the pg-boss worker at
`ghcr.io/sebbogit/atlas:<tag>-worker`. You need both — the worker runs database
migrations on boot and the app waits for it before serving.

Create a `.env` (start from [`.env.example`](./.env.example)) with at least a
`POSTGRES_PASSWORD`, your PocketID OIDC settings, and `ATLAS_IMAGE_TAG` (pin a
release, e.g. `1.0.0`). Then drop this `compose.yaml` next to it:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: atlas
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set a strong POSTGRES_PASSWORD in .env}
      POSTGRES_DB: atlas
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U atlas -d atlas']
      interval: 10s
      timeout: 5s
      retries: 5

  worker:
    image: ghcr.io/sebbogit/atlas:${ATLAS_IMAGE_TAG:-latest}-worker
    depends_on:
      postgres:
        condition: service_healthy
    env_file: [.env]
    environment:
      DATABASE_URL: postgres://atlas:${POSTGRES_PASSWORD}@postgres:5432/atlas
      STORAGE_DIR: /app/data/documents
    volumes:
      - ./data/documents:/app/data/documents
    healthcheck:
      test: ['CMD-SHELL', 'test -f /tmp/atlas-worker-ready']
      interval: 5s
      timeout: 2s
      retries: 60
      start_period: 5s

  app:
    image: ghcr.io/sebbogit/atlas:${ATLAS_IMAGE_TAG:-latest}
    depends_on:
      postgres:
        condition: service_healthy
      # Wait for the worker to finish migrations before serving requests.
      worker:
        condition: service_healthy
    env_file: [.env]
    environment:
      DATABASE_URL: postgres://atlas:${POSTGRES_PASSWORD}@postgres:5432/atlas
      STORAGE_DIR: /app/data/documents
      TILES_DIR: /app/data/tiles
    ports:
      - '127.0.0.1:3000:3000'
    volumes:
      - ./data/documents:/app/data/documents
      - ./data/tiles:/app/data/tiles:ro

volumes:
  postgres-data:
```

```bash
docker compose up -d
```

Open http://localhost:3000. The map stays blank until you fetch the basemap,
and extraction needs an Ollama host — both are covered in the deploy guide.

This is the minimal shape. The repo also ships the real
[`docker-compose.yml`](./docker-compose.yml) plus a hardened
[`docker-compose.prod.yml`](./docker-compose.prod.yml) overlay (resource limits,
runtime confinement, scheduled backups). For a production deployment, use those
and follow **[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)** (PocketID, basemap,
Ollama, reverse proxy, backups):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup up -d
```

### Develop from source

**Requires:** Node.js 24, pnpm 9.15+, Docker with Compose v2.

```bash
git clone https://github.com/SebboGit/atlas.git
cd atlas
pnpm install
cp .env.example .env
# Edit .env

pnpm dev:up      # one-shot: postgres → migrate → seed → next dev
```

Open http://localhost:3000. For the development workflow, conventions, and
gates, see **[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)**.

---

## Data layout

Everything stateful lives under `./data/`:

```
data/
├── documents/      User-uploaded files (immutable originals)
├── tiles/          Protomaps PMTiles basemap (regenerable, not backed up)
└── backups/
    ├── db/         ZSTD-compressed Postgres dumps
    └── documents/  Timestamped document snapshots
```

---

## Documentation

| Doc                                              | What's in it                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)     | End-to-end deployment: PocketID, basemap, Ollama, reverse proxy, backups |
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)   | Dev setup, quality gates, conventions, git workflow                      |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | High-level system design                                                 |
| [`docs/DOMAIN_MODEL.md`](./docs/DOMAIN_MODEL.md) | Entities, relationships, invariants                                      |
| [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md) | Assets, trust boundaries, and the threats Atlas defends against          |
| [`docs/adr/`](./docs/adr/)                       | Architecture Decision Records                                            |
| [`CLAUDE.md`](./CLAUDE.md)                       | Canonical rules and conventions (the source of truth)                    |

---

## Status

Atlas is stable. Trips, segments, documents and extraction, both map surfaces,
search, stats, and the wishlist are all implemented, and releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Push notifications
(ntfy) are the next planned addition.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE).

- Use, modify, fork, redistribute — fine, for any noncommercial purpose.
- Charities, schools, universities, public bodies — fine.
- Selling it, paid hosting, shipping it as part of a paid product — not fine.

Unclear use case? Open a discussion before acting.
