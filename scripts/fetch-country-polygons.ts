// One-shot: refresh public/geo/world-countries-110m.geojson from Natural Earth.
//
// Country borders shift very slowly. The committed GeoJSON is the runtime
// source of truth for the visited-countries world map; we ship the
// snapshot rather than fetch from an API at request time. Re-run this
// script when a border actually moves or a missing country is reported:
//
//   pnpm tsx --env-file-if-exists=.env scripts/fetch-country-polygons.ts
//
// Source: nvkelso/natural-earth-vector mirror of Natural Earth, scale
// 1:110m (the smallest size — perfect for a world choropleth at low
// zoom). Public domain — no attribution required, but credited in the
// fetched-from URL comment in the output file.
//
// We slim the upstream file aggressively: each feature keeps only the
// 2-letter ISO code and its geometry. Names, populations, sovereignty
// fields, alternative codes — all stripped. The app already has its own
// ISO name table (src/lib/countries/data.ts) for display, so the
// polygons just need an ID we can join on.

import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
// Lives under public/ so MapLibre can fetch it as a static asset.
// Not imported as a TS module — that path is reserved for the small
// lookup snapshots (airlines, airports) that the server actually reads.
const OUTPUT_REL = 'public/geo/world-countries-110m.geojson';

// Natural Earth carries a few records that aren't ISO-coded sovereign
// states. For some of them we want the polygon to render anyway, keyed
// to the ISO code Atlas already knows. Anything missing from this list
// AND lacking a real ISO_A2 code is dropped.
const ISO_A2_FALLBACKS: Readonly<Record<string, string>> = {
  // ADMIN name → ISO 3166-1 alpha-2.
  France: 'FR',
  Norway: 'NO',
  Kosovo: 'XK',
  'N. Cyprus': 'CY',
  Somaliland: 'SO',
};

interface NEFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
}

interface NECollection {
  type: 'FeatureCollection';
  features: NEFeature[];
}

interface SlimFeature {
  type: 'Feature';
  id: string;
  properties: { iso_a2: string };
  geometry: unknown;
}

interface SlimCollection {
  type: 'FeatureCollection';
  features: SlimFeature[];
}

function resolveIsoA2(props: Record<string, unknown>): string | null {
  // Natural Earth has overlapping ISO fields. ISO_A2_EH ("Eurostat
  // harmonized") fixes a few quirks the raw ISO_A2 leaves at "-99"
  // (Kosovo, France, Norway). Prefer it when present.
  const eh = typeof props.ISO_A2_EH === 'string' ? props.ISO_A2_EH : null;
  if (eh && eh !== '-99' && /^[A-Z]{2}$/.test(eh)) return eh;
  const raw = typeof props.ISO_A2 === 'string' ? props.ISO_A2 : null;
  if (raw && raw !== '-99' && /^[A-Z]{2}$/.test(raw)) return raw;
  const admin = typeof props.ADMIN === 'string' ? props.ADMIN : null;
  if (admin && ISO_A2_FALLBACKS[admin]) return ISO_A2_FALLBACKS[admin]!;
  return null;
}

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching world-110m`);
  const raw = (await res.json()) as NECollection;
  if (raw.type !== 'FeatureCollection') {
    throw new Error(`Expected FeatureCollection, got ${raw.type}`);
  }

  const slim: SlimFeature[] = [];
  const dropped: string[] = [];

  for (const f of raw.features) {
    const iso = resolveIsoA2(f.properties);
    if (!iso) {
      const admin = typeof f.properties.ADMIN === 'string' ? f.properties.ADMIN : '(unknown)';
      dropped.push(admin);
      continue;
    }
    slim.push({
      type: 'Feature',
      id: iso,
      properties: { iso_a2: iso },
      geometry: f.geometry,
    });
  }

  slim.sort((a, b) => a.id.localeCompare(b.id));

  const out: SlimCollection = { type: 'FeatureCollection', features: slim };
  const outPath = path.resolve(process.cwd(), OUTPUT_REL);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  // No pretty-printing — the file is 250-ish features of geometry and
  // grows ten-fold when indented. The runtime never reads it as text,
  // and git stores it compactly either way.
  await fs.writeFile(outPath, JSON.stringify(out), 'utf8');

  console.log(
    `Wrote ${OUTPUT_REL}: ${slim.length} features kept` +
      (dropped.length ? `, ${dropped.length} dropped (${dropped.join(', ')})` : ''),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
