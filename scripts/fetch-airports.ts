// One-shot: refresh src/lib/airports/iata-airports.json from OpenFlights.
//
// Airports change rarely — IATA-coded commercial airports change names
// occasionally, but the IATA↔IANA-timezone mapping is essentially
// stable. Run this manually when an extracted boarding pass shows an
// airport we don't recognise:
//
//   pnpm tsx --env-file-if-exists=.env scripts/fetch-airports.ts
//
// Source: https://github.com/jpatokal/openflights (CC-BY-SA 3.0).
// airports.dat columns:
//
//   id, name, city, country, iata, icao, lat, lng, alt, utc_offset,
//   dst, tz_database_time_zone, type, source
//
// We keep only type='airport' rows with a valid 3-letter IATA and a
// non-empty IANA timezone. Heliports, closed airports, and bus/train
// stations live in this file too — none of which we want.
//
// We also resolve OpenFlights' free-text country name to an ISO 3166-1
// alpha-2 code (via src/lib/countries/data.ts + a small alias map for
// known mismatches). Country is optional in the output: if a row's
// name doesn't resolve, we still keep the airport (the timezone is
// useful on its own) and log the unmapped name so the alias map can
// grow over time.
//
// Lat/lng come from the same row and feed the trip-detail map's
// flight-destination pins. They're optional in the output (treated
// the same as country): a row with malformed coords still keeps tz
// and country if those are sound.

import fs from 'node:fs/promises';
import path from 'node:path';

import { ISO_COUNTRIES } from '../src/lib/countries/data';

const SOURCE_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const OUTPUT_REL = 'src/lib/airports/iata-airports.json';

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

// Normalise a country name for fuzzy matching: lowercase, strip
// diacritics, collapse whitespace, drop trailing parenthetical
// qualifiers ("Falkland Islands (Malvinas)" → "falkland islands").
function normaliseName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Aliases for OpenFlights' country names that don't match our
// ISO_COUNTRIES display strings even after normalisation. Keys are the
// normalised OpenFlights name; values are ISO 3166-1 alpha-2 codes.
// Add more entries when the script logs an unmapped country and you
// want to start resolving it.
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  burma: 'MM',
  usa: 'US',
  uk: 'GB',
  'czech republic': 'CZ',
  'ivory coast': 'CI',
  'cote d ivoire': 'CI',
  "cote d'ivoire": 'CI',
  'republic of the congo': 'CG',
  'democratic republic of the congo': 'CD',
  'congo brazzaville': 'CG',
  'congo kinshasa': 'CD',
  'south korea': 'KR',
  'north korea': 'KP',
  'republic of korea': 'KR',
  "democratic people's republic of korea": 'KP',
  'east timor': 'TL',
  macao: 'MO',
  'cape verde': 'CV',
  swaziland: 'SZ',
  macedonia: 'MK',
  'palestinian territory': 'PS',
  'west bank': 'PS',
  'gaza strip': 'PS',
  'wake island': 'UM',
  'midway islands': 'UM',
  'johnston atoll': 'UM',
  'virgin islands': 'VI',
  'us virgin islands': 'VI',
  'british virgin islands': 'VG',
  'falkland islands': 'FK',
  reunion: 'RE',
  curacao: 'CW',
  'sao tome and principe': 'ST',
  'aland islands': 'AX',
  svalbard: 'SJ',
  'svalbard and jan mayen': 'SJ',
  'sint maarten': 'SX',
  'saint barthelemy': 'BL',
  'saint martin': 'MF',
  'collectivity of saint martin': 'MF',
  turkey: 'TR',
  turkiye: 'TR',
  vatican: 'VA',
  'vatican city': 'VA',
  'holy see': 'VA',
  'micronesia federated states of': 'FM',
  'federated states of micronesia': 'FM',
  'republic of moldova': 'MD',
  "lao people's democratic republic": 'LA',
  'brunei darussalam': 'BN',
  'libyan arab jamahiriya': 'LY',
  'russian federation': 'RU',
  'syrian arab republic': 'SY',
  'united republic of tanzania': 'TZ',
  'bolivarian republic of venezuela': 'VE',
  'cocos islands': 'CC',
  'caribbean netherlands': 'BQ',
  bonaire: 'BQ',
  'sint eustatius': 'BQ',
  saba: 'BQ',
  'saint helena': 'SH',
  'saint helena ascension and tristan da cunha': 'SH',
  pitcairn: 'PN',
};

// Per-IATA overrides for cases where the country-name lookup gives
// the wrong answer for an entire group of airports — typically because
// OpenFlights still tags them by a dissolved political entity. The
// Dutch Caribbean is the only such cluster today: "Netherlands
// Antilles" was dissolved in 2010 and the successor codes differ by
// island, so a single name → ISO mapping cannot be right.
const IATA_COUNTRY_OVERRIDES: Readonly<Record<string, string>> = {
  BON: 'BQ', // Bonaire
  CUR: 'CW', // Curaçao
  EUX: 'BQ', // Sint Eustatius
  SAB: 'BQ', // Saba
  SXM: 'SX', // Sint Maarten
};

// Build a normalised lookup from our authoritative list, then layer
// the alias map on top. Aliases win on conflict.
function buildCountryIndex(): Readonly<Record<string, string>> {
  const idx: Record<string, string> = {};
  for (const c of ISO_COUNTRIES) {
    idx[normaliseName(c.name)] = c.code;
  }
  for (const [name, code] of Object.entries(COUNTRY_ALIASES)) {
    idx[name] = code;
  }
  return idx;
}

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching airports.dat`);
  const text = await res.text();

  const countryIndex = buildCountryIndex();

  const lines = text.split('\n').filter((l) => l.length > 0);
  let typeAirport = 0;
  let collisions = 0;
  let withCountry = 0;
  const unmappedCountries = new Map<string, number>();

  type Entry = {
    tz: string;
    country: string | null;
    lat: number | null;
    lng: number | null;
    sourceId: number;
  };
  const byIata = new Map<string, Entry>();
  let withCoords = 0;

  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 14) continue;
    const [idRaw, , , countryRaw, iata, , latRaw, lngRaw, , , , tz, type] = cols;
    if (type !== 'airport') continue;
    typeAirport += 1;

    if (!iata || iata === '\\N') continue;
    const code = iata.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;

    if (!tz || tz === '\\N' || tz.length === 0) continue;
    // Sanity: IANA zones contain "/" (e.g. Asia/Saigon, America/New_York).
    // OpenFlights occasionally puts "U" or other artefacts in this slot.
    if (!tz.includes('/')) continue;

    const sourceId = Number(idRaw);
    if (Number.isNaN(sourceId)) continue;

    let country: string | null = IATA_COUNTRY_OVERRIDES[code] ?? null;
    if (!country && countryRaw && countryRaw !== '\\N' && countryRaw.trim().length > 0) {
      const key = normaliseName(countryRaw);
      country = countryIndex[key] ?? null;
      if (!country) {
        unmappedCountries.set(countryRaw, (unmappedCountries.get(countryRaw) ?? 0) + 1);
      }
    }

    // Coords. Drop anything non-numeric or outside the WGS84 valid range;
    // the row is still kept (tz + country alone is useful for non-map
    // callers), the coords just won't appear in the output so map
    // callers fall through to "no pin" rather than mispinning to (0,0).
    let lat: number | null = null;
    let lng: number | null = null;
    const latN = latRaw ? Number(latRaw) : NaN;
    const lngN = lngRaw ? Number(lngRaw) : NaN;
    if (
      Number.isFinite(latN) &&
      Number.isFinite(lngN) &&
      Math.abs(latN) <= 90 &&
      Math.abs(lngN) <= 180
    ) {
      lat = latN;
      lng = lngN;
    }

    const existing = byIata.get(code);
    if (existing) {
      collisions += 1;
      if (existing.sourceId <= sourceId) continue;
    }
    byIata.set(code, { tz, country, lat, lng, sourceId });
  }

  type OutEntry = { tz: string; country?: string; lat?: number; lng?: number };
  const sorted: Record<string, OutEntry> = {};
  for (const code of [...byIata.keys()].sort()) {
    const entry = byIata.get(code);
    if (!entry) continue;
    const out: OutEntry = { tz: entry.tz };
    if (entry.country) {
      out.country = entry.country;
      withCountry += 1;
    }
    if (entry.lat !== null && entry.lng !== null) {
      // Round to 5dp (~1m precision) — enough for a map pin, half the
      // bytes of the raw float. Math.round keeps it locale-safe.
      out.lat = Math.round(entry.lat * 1e5) / 1e5;
      out.lng = Math.round(entry.lng * 1e5) / 1e5;
      withCoords += 1;
    }
    sorted[code] = out;
  }

  const outPath = path.resolve(process.cwd(), OUTPUT_REL);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

  console.log(
    `Wrote ${OUTPUT_REL}: ${byIata.size} airports (type=airport rows: ${typeAirport}, collisions resolved: ${collisions}, with country: ${withCountry}, with coords: ${withCoords})`,
  );

  if (unmappedCountries.size > 0) {
    const top = [...unmappedCountries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    console.log(`Unmapped country names (top ${top.length} of ${unmappedCountries.size}):`);
    for (const [name, count] of top) {
      console.log(`  ${count.toString().padStart(4)}  ${name}`);
    }
    console.log(
      'Add aliases to COUNTRY_ALIASES in scripts/fetch-airports.ts and re-run to map them.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
