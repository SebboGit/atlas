# ADR-0011: Self-hosted Protomaps PMTiles basemap

- **Status:** Accepted
- **Date:** 2026-05-17
- **Deciders:** @SebboGit

## Context

The trip-detail map (`/trips/[id]/map`) renders flight arcs and
geocoded hotel / activity / transit pins on top of country polygons.
When the user zooms into a country there's no basemap underneath —
just polygon shapes against an ocean colour. Pinning a hotel in a
named city is hard to orient against. An earlier Carto raster
basemap was tried and reverted (see commit history).

CLAUDE.md committed Atlas to a **self-hosted** basemap via Protomaps
PMTiles. This ADR locks the open dials: which file, where it lives,
how it's served, how operators get one.

## Decision

Render the trip-detail map on top of a self-hosted Protomaps PMTiles
basemap, sourced from Protomaps' daily planet build, clipped to
zoom levels 0–13 (~33 GB on disk).

### 1. Source

- **Provider:** Protomaps daily planet build, basemap **schema v4**
  (the current schema; `@protomaps/basemaps` v5.x emits v4-compatible
  layers). Schema v4 lives ONLY at the daily build CDN — the Source
  Cooperative S3 mirror at `data.source.coop/protomaps/openstreetmap/tiles/`
  carries only `v2` (2023) and `v3.pmtiles` (2024-08-30) snapshots,
  not v4. The pragmatic implication: bulk pulls go through
  `https://build.protomaps.com/<YYYYMMDD>.pmtiles`, where `<YYYYMMDD>`
  is yesterday's date (safe — today's may still be propagating).
  This CDN is less reliable than S3; pair with `--overfetch=0` so a
  transient stream reset costs MB rather than GB.
- **Detail ceiling:** Z0-13 — neighbourhood / street-block detail
  worldwide. Z14 (~60-70 GB) and Z15 (~120 GB) would give individual
  buildings but Atlas isn't a navigation app; the marginal value
  doesn't pay for the storage. Z12 (~8-10 GB) was considered but
  leaves hotels pinned in city-shaped blobs without the surrounding
  street context.
- **Coverage:** worldwide. Atlas's users travel internationally; a
  regional extract closes off future trips to bbox edges.
- **Acquisition:** `go-pmtiles` CLI's `extract` command byte-range-
  fetches just the Z0-13 portion from the remote planet, so the
  operator pulls ~33 GB instead of the full 120 GB. The CLI is the
  only external dependency the operator must install (Homebrew, apt,
  or a GitHub release binary). Recommended flags: `--maxzoom=13`,
  `--download-threads=4`, `--overfetch=0` — the last one breaks the
  fetch into smaller HTTP requests so a transient stream reset
  doesn't restart the whole download.

### 2. Storage

Mirrors the `data/documents` pattern that ADR-0001 set:

```
data/
├── documents/     # ADR-0001
├── backups/       # existing
└── tiles/         # NEW
    └── world.pmtiles
```

- **Host-side**, gitignored under the existing `data/` rule.
- **Bind-mounted** read-only into the container at `/app/data/tiles`.
- New env var `TILES_DIR`, default `./data/tiles`. Docker-compose
  overrides to the absolute container path, same shape as `STORAGE_DIR`.
- **Excluded from `scripts/backup-documents.sh`** — tiles are
  regenerable and large. Re-running the fetch on a new host is
  cheaper than paying for ~8 GB of offsite-storage growth per
  refresh.

### 3. Serving

The browser fetches `/tiles/world.pmtiles` — a same-origin URL on
the Atlas host. Two delivery paths, same URL contract:

| Path                                                                        | When                       | Why                                                                             |
| --------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| **Next.js route handler** at `/api/tiles/[...path]` with byte-range support | Default, always-on         | Works for `pnpm dev` zero-config; works in prod as a fallback                   |
| **Reverse proxy (Caddy) serving `data/tiles/` directly**                    | Optional prod optimisation | Skips Next.js for static byte streams when an operator wants the lower overhead |

The route handler is implemented first; Caddy bypass is a deployment
note, not code Atlas ships.

### 4. Style

**Protomaps "White"** style — warm beige terrain, muted roads,
matches Atlas's paper aesthetic. The style JSON is committed under
`src/components/features/trip-map/protomaps-style.ts` (TypeScript
module wrapping the published JSON) so the basemap doesn't fetch
its style from a CDN at runtime. Style updates are operator-initiated
re-fetches, not automatic.

Country polygons stay rendered on top with zoom-interpolated
opacity — prominent at world zoom, fade out as the basemap takes
over at city zoom. Same opacity-curve shape the Carto raster
attempt used (the curve was right; the tile source was wrong).

### 5. Refresh policy

Operator-driven. The fetch script is run once at first setup; OSM
changes slowly at the zoom levels Atlas exposes, so re-running
once a year is plenty. The script is idempotent: re-running
overwrites `world.pmtiles` in place.

### 6. CSP

Same-origin throughout. `connect-src 'self'` already suffices; no
`next.config.ts` changes needed.

## Consequences

### Positive

- **Fully self-hosted.** No CDN, no API key, no quota, no third-party
  hotlinking (which Protomaps explicitly discourages).
- **Zero runtime fetches outside Atlas.** Style JSON committed,
  tiles served from the same origin.
- **Affordable storage.** ~33 GB on a homelab NAS is manageable. A
  laptop SSD fits it without strain. Backups exclude the tiles dir
  (regenerable), so this isn't ongoing offsite-sync cost.
- **Operator dials are documented.** A homelab user who wants Z14
  detail can override `--maxzoom=14`; one who wants regional-only
  can override `--bbox`. Same code path.

### Negative / tradeoffs

- **One external CLI dependency** (`go-pmtiles`). Not embedded; the
  operator installs it once. Atlas's runtime image stays slim.
- **33 GB fetch is slow over a residential connection.** Expect
  45-90 min for the first run, longer if the link can't sustain
  60+ MB/s. The fetch doesn't gate the rest of the install — the
  map will simply show "no basemap" until the file is in place
  (route handler returns 404, MapLibre handles it gracefully).
- **Manual refresh.** No cron, no auto-update. Atlas users don't
  need fresh OSM data weekly.

### Neutral

- The `PROTOMAPS_PMTILES_URL` env var already declared in
  `.env.example` becomes the contract the browser sees; default
  stays `/tiles/world.pmtiles`.

## Alternatives considered

- **CDN (`api.protomaps.com`).** Free tier exists; per-tile cost beyond.
  Rejected: diverges from CLAUDE.md self-hosting principle, makes
  Atlas's basemap a third-party dependency in a way storage and
  extraction explicitly aren't.
- **Z0-15 full planet (~120 GB).** Building-level detail everywhere,
  but the marginal value over Z0-13 doesn't pay for the 4× storage
  on a single-user homelab. Operator can opt in via `--maxzoom=15`
  override if they want it.
- **Z0-12 (~8-10 GB).** Quarter the size; cities clearly drawn but
  no street network. Hotels would pin in city-shaped blobs without
  the surrounding context. Rejected as the default; operator can
  opt down via `--maxzoom=12`.
- **Regional extract (e.g. Europe only).** Smaller (~3-6 GB at Z13
  for Europe) but closes off future trips to bbox edges. Rejected as
  the default; operator can opt in via `--bbox` override.
- **Raster basemap (Carto Voyager via CDN).** Tried earlier and
  reverted. Diverges from self-hosting and didn't ship cleanly.
- **`protomaps/go-pmtiles serve` sidecar container.** Cleaner
  separation but overkill for a single-user app. The Next.js route
  handler handles byte-range fine.

## When to revisit

- **Pin density at high zoom outpaces the basemap detail.** If users
  start pinning multiple hotels on the same street and Z13 can't
  visually separate them, bump to Z14.
- **Storage pressure on the homelab.** If 33 GB starts mattering,
  switch to Z0-12 (~8-10 GB) or regional extracts driven by
  `user_visited_countries`.
- **Refresh fatigue.** If operators want fresher OSM data without
  re-running a 30-minute fetch, add an incremental-diff mechanism —
  Protomaps may offer this; not investigated.

## References

- ADR-0001 — Local filesystem storage (same bind-mount pattern).
- ADR-0006 — Ollama-only LLM extraction (same self-hosted philosophy).
- ADR-0010 — Nominatim geocoding (same OSM ecosystem; attribution
  line already reads "Map data © OpenStreetMap contributors ·
  Country shapes © Natural Earth · Geocoding by Nominatim" — no
  attribution change needed for the basemap; OSM is OSM).
- [Protomaps docs: Basemap Downloads](https://docs.protomaps.com/basemaps/downloads)
- [Protomaps docs: pmtiles CLI](https://docs.protomaps.com/pmtiles/cli)
- [`protomaps/PMTiles`](https://github.com/protomaps/PMTiles)
