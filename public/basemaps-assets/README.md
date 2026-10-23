# Protomaps basemap assets

Self-hosted font glyph PBFs + sprite for the trip-detail map. Sourced from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets).
See [ADR-0011](../../docs/adr/0011-protomaps-pmtiles-basemap.md).

## Contents

- `fonts/Noto Sans Regular/` — primary Latin glyphs
- `fonts/Noto Sans Italic/` — italic variant
- `fonts/Noto Sans Medium/` — medium-weight variant
- `fonts/Noto Sans Devanagari Regular v1/` — non-Latin script support
- `fonts/OFL.txt` — SIL Open Font License (compliance)
- `sprites/v4/light.{png,json}` + `@2x` — road shields, oneway arrows,
  town dots and POI icons; used by the White flavor (light theme), which
  draws no POIs, so only the first three matter. Upstream also ships a
  `white` sheet; Atlas has always paired White with `light`.
- `sprites/v4/black.{png,json}` + `@2x` — road shields, oneway arrows and
  town dots for the Black flavor (dark theme), which draws no POIs either

The map picks the flavor from the theme on screen: White in light, Black
in dark. The pairing lives in `BASEMAP_FLAVOR` in
`src/components/features/trip-map/basemap-style.ts`.

These are the only fontstacks referenced by `@protomaps/basemaps`'s
White and Black layer specs, which use the same four Noto stacks. They
were enumerated by walking the `layers()` output of each flavor for
`text-font` references. If a future basemaps schema version adds new
fontstacks, or another flavor is added, re-run the enumeration and copy
any missing ones from `protomaps/basemaps-assets`.

## Updating

```bash
git clone --depth 1 https://github.com/protomaps/basemaps-assets.git /tmp/basemaps-assets
# Copy the directories listed above into public/basemaps-assets/
```

No automated fetch script — this is a yearly-cadence operation at most.
