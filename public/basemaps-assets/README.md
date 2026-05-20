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
- `sprites/v4/light.{png,json}` + `@2x` — road shields + POI icons

These are the only fontstacks referenced by `@protomaps/basemaps`'s
White-flavor layer spec — enumerated by walking the `layers()` output
for `text-font` references. If a future basemaps schema version adds
new fontstacks, re-run the enumeration and copy any missing ones from
`protomaps/basemaps-assets`.

## Updating

```bash
git clone --depth 1 https://github.com/protomaps/basemaps-assets.git /tmp/basemaps-assets
# Copy the directories listed above into public/basemaps-assets/
```

No automated fetch script — this is a yearly-cadence operation at most.
