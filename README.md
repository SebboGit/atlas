<div align="center">

# Atlas

**Self-hosted personal travel companion.**

Trips, flights, hotels, activities, documents and maps.

[![CI](https://github.com/SebboGit/atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/SebboGit/atlas/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)](.nvmrc)
[![License: PolyForm NC 1.0.0](https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-blue.svg)](./LICENSE)
[![Status: Pre-1.0](https://img.shields.io/badge/status-pre--1.0-orange.svg)]()

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

**Requires:** Node.js 24, pnpm 9.15+, Docker with Compose v2.

```bash
git clone https://github.com/SebboGit/atlas.git
cd atlas
pnpm install
cp .env.example .env
# Edit .env

pnpm dev:up      # one-shot: postgres → migrate → seed → next dev
```

Open http://localhost:3000.

For a production deployment (PocketID, basemap, Ollama, reverse proxy,
backups), see **[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)**.

For the development workflow, conventions, and gates, see
**[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)**.

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

Atlas is pre-1.0. The trip, segment, document, and map layers are
implemented. Notifications and household-sharing are on the roadmap.
Breaking changes can still land on `main`.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE).

- Use, modify, fork, redistribute — fine, for any noncommercial purpose.
- Charities, schools, universities, public bodies — fine.
- Selling it, paid hosting, shipping it as part of a paid product — not fine.

Unclear use case? Open a discussion before acting.
