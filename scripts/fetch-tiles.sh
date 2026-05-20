#!/usr/bin/env bash
# =============================================================================
# Atlas — Basemap tile fetch (host-side)
#
# Wraps `pmtiles extract` against build.protomaps.com's daily build to
# produce a Z0-13 worldwide PMTiles file at $TILES_DIR/world.pmtiles.
# Schema v4 only (current @protomaps/basemaps emitter — see ADR-0011).
#
# One-time setup (or annual refresh when OSM data feels too stale):
#   pnpm tiles:fetch                       # ~33 GB, ~45-90 min on fast pipe
#   pnpm tiles:fetch --force               # overwrite an existing file
#
# Env knobs (all optional):
#   TILES_DIR          Target directory (default: ./data/tiles)
#   TILES_MAX_ZOOM     Detail ceiling (default: 13; 12 ≈ 8GB, 14 ≈ 60GB)
#   TILES_SOURCE_DATE  Daily-build date YYYYMMDD (default: yesterday UTC)
#   TILES_BBOX         Optional regional clip, "minlon,minlat,maxlon,maxlat"
# =============================================================================
set -euo pipefail

TILES_DIR="${TILES_DIR:-./data/tiles}"
TILES_MAX_ZOOM="${TILES_MAX_ZOOM:-13}"

# Cross-platform "yesterday in UTC" — macOS BSD date and GNU date use
# different flag spelling. Try BSD first; fall back to GNU.
TILES_SOURCE_DATE="${TILES_SOURCE_DATE:-$(date -u -v-1d +%Y%m%d 2>/dev/null || date -u -d 'yesterday' +%Y%m%d)}"

OUTPUT="${TILES_DIR}/world.pmtiles"
SOURCE_URL="https://build.protomaps.com/${TILES_SOURCE_DATE}.pmtiles"

FORCE=0
for arg in "$@"; do
  case "${arg}" in
    --force|-f) FORCE=1 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: ${arg}" >&2; exit 2 ;;
  esac
done

if ! command -v pmtiles >/dev/null 2>&1; then
  cat >&2 <<'MSG'
ERROR: `pmtiles` CLI not found on PATH.

Install via Homebrew:
  brew install pmtiles

Or grab a release binary:
  https://github.com/protomaps/go-pmtiles/releases
MSG
  exit 1
fi

mkdir -p "${TILES_DIR}"

if [[ -f "${OUTPUT}" && "${FORCE}" -ne 1 ]]; then
  echo "ERROR: ${OUTPUT} already exists." >&2
  echo "       Re-run with --force to overwrite, or delete the file first." >&2
  exit 1
fi

# Refuse to fetch from an obviously-wrong URL if the date is in the
# future or absurdly old — saves operators from typo'd TILES_SOURCE_DATE.
if ! [[ "${TILES_SOURCE_DATE}" =~ ^[0-9]{8}$ ]]; then
  echo "ERROR: TILES_SOURCE_DATE must be YYYYMMDD (got: ${TILES_SOURCE_DATE})" >&2
  exit 1
fi

ARGS=(
  extract
  "${SOURCE_URL}"
  "${OUTPUT}"
  "--maxzoom=${TILES_MAX_ZOOM}"
  --download-threads=4
  # --overfetch=0 breaks the fetch into smaller HTTP requests, so a
  # transient stream reset on build.protomaps.com costs MB rather than
  # GB of re-work. See ADR-0011.
  --overfetch=0
)

if [[ -n "${TILES_BBOX:-}" ]]; then
  ARGS+=("--bbox=${TILES_BBOX}")
fi

cat <<INFO
→ Source:    ${SOURCE_URL}
→ Output:    ${OUTPUT}
→ Max zoom:  ${TILES_MAX_ZOOM}
${TILES_BBOX:+→ BBox:      ${TILES_BBOX}
}→ Threads:   4   (overfetch=0)

Schema v4. If the basemap renders with miscoloured layers after this
completes, the daily-build URL may have advanced to schema v5 — pin
the date or update @protomaps/basemaps.
INFO

exec pmtiles "${ARGS[@]}"
