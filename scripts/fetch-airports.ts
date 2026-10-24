// One-shot: refresh src/lib/airports/iata-airports.json (and its
// server-only sibling iata-airport-cities.json) from OpenFlights.
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
// timezone: upstream's, or — where upstream left it blank, as it does
// for most airports opened since ~2015 — the zone the row's coordinates
// fall in. Heliports, closed airports, and bus/train stations live in
// this file too — none of which we want.
//
// We also resolve OpenFlights' free-text country name to an ISO 3166-1
// alpha-2 code (via src/lib/countries/data.ts + a small alias map for
// known mismatches). Country is optional in the output: if a row's
// name doesn't resolve, we still keep the airport (the timezone is
// useful on its own) and log the unmapped name so the alias map can
// grow over time.
//
// Derived zones come from `zoneAt` (src/lib/timezones/), so they depend
// on the @photostructure/tz-lookup version: after bumping it, re-run this
// script and diff the rows upstream had no zone for.
//
// Lat/lng come from the same row and feed the trip-detail map's
// flight-destination pins. They're optional in the output (treated
// the same as country): a row with malformed coords still keeps tz
// and country if those are sound.
//
// The city goes to a separate file, iata-airport-cities.json, read
// only through src/lib/airports/cities.ts. iata-airports.json ships to
// the browser with the segment forms; the city names are only needed
// by server-rendered pages, so they stay out of the client bundle.
// Same rows, same filter: a code has a city only if it's in the main
// snapshot. Upstream's city column is uneven, so `cleanCity` tidies it
// with two generic rules (all-caps values title-cased, a trailing
// "International" / "Intl" / "Airport" dropped) and IATA_CITY_OVERRIDES
// names the popular airports upstream gets wrong. Blank cities are
// skipped.

import fs from 'node:fs/promises';
import path from 'node:path';

import { ISO_COUNTRIES } from '../src/lib/countries/data';
import { tzOffsetMs } from '../src/lib/timezones/convert';
import { zoneAt } from '../src/lib/timezones/resolve';

const SOURCE_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const OUTPUT_REL = 'src/lib/airports/iata-airports.json';
const CITIES_OUTPUT_REL = 'src/lib/airports/iata-airport-cities.json';

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

// Before → after pairs for each generic rule, logged so a refresh's
// changes can be read rather than just counted.
type CityFixes = { titleCased: string[]; suffixDropped: string[] };

// A trailing airport word some rows put in the city column ("Queenstown
// International", "Al Ghaidah Intl", "Qeqertarsuaq Airport"), with the
// separator before it and any punctuation after ("Foo, Intl."). Only at
// the end, so "International Falls" keeps its name.
const CITY_AIRPORT_SUFFIX =
  /[\s,\-–]+(?:(?:International|Intl\.?)(?:\s+Airport)?|Airport)[\s.,]*$/i;

// Trim and collapse whitespace ("Norfolk  Nebraska"), undo the
// backslash-escaped apostrophes some rows carry, title-case a value that
// is all capitals ("ST MARY'S" → "St Mary's") and drop a trailing airport
// word. `\N` and blanks → null. Records each rule's hits in `fixes`.
function cleanCity(raw: string | undefined, fixes: CityFixes): string | null {
  if (!raw || raw === '\\N') return null;
  let city = raw.replace(/\\'/g, "'").replace(/\s+/g, ' ').trim();
  if (/\p{Lu}/u.test(city) && city === city.toUpperCase()) {
    // Capitalise after a space, hyphen, slash or bracket — not after an
    // apostrophe, so the possessive stays lower-case.
    const titled = city
      .toLowerCase()
      .replace(/(^|[\s\-/(])(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
    fixes.titleCased.push(`${city} → ${titled}`);
    city = titled;
  }
  const trimmed = city.replace(CITY_AIRPORT_SUFFIX, '');
  if (trimmed !== city && trimmed.length > 0) {
    fixes.suffixDropped.push(`${city} → ${trimmed}`);
    city = trimmed;
  }
  return city.length > 0 ? city : null;
}

// Per-IATA city names, for popular airports where upstream's city is
// misspelt, missing its diacritics, the region or the airport's own
// district rather than the city it serves, or a non-English name where
// English has its own. Wins over the cleaned upstream value. Diacritics
// appear only where an entry adds them; the long tail keeps upstream's
// ASCII. Not a full audit of ~6,000 rows: add an entry when an airport
// someone flies reads wrong on the stats page. A refresh logs each
// override against the value it replaces, and entries that are redundant
// or matched no airport.
const IATA_CITY_OVERRIDES: Readonly<Record<string, string>> = {
  ALA: 'Almaty', // upstream "Alma-ata", the Soviet-era name
  AMN: 'Alma', // upstream "Kamloops", a different airport's city
  BIQ: 'Biarritz', // upstream "Biarritz-bayonne"
  BSL: 'Basel', // EuroAirport Basel-Mulhouse; upstream "Mulhouse"
  CFU: 'Corfu', // upstream "Kerkyra/corfu"
  CJU: 'Jeju', // upstream "Cheju", the pre-2000 romanisation
  CLJ: 'Cluj-Napoca', // upstream "Cluj-napoca"
  DAD: 'Da Nang', // upstream "Danang"
  DUS: 'Düsseldorf', // upstream "Duesseldorf"
  FDF: 'Fort-de-France', // upstream "Fort-de-france"
  FMO: 'Münster', // upstream "Munster"
  GIG: 'Rio de Janeiro', // upstream "Rio De Janeiro"
  GOT: 'Gothenburg', // upstream "Gothenborg"
  GRU: 'São Paulo', // upstream "Sao Paulo"
  IEV: 'Kyiv', // upstream "Kiev"
  INT: 'Winston-Salem', // upstream "Winston-salem"
  JTR: 'Santorini', // upstream "Thira", the island's Greek name
  KBP: 'Kyiv', // upstream "Kiev"
  KEF: 'Reykjavík', // the town is Keflavík; the airport serves Reykjavík
  LBC: 'Lübeck', // upstream "Luebeck"
  LYR: 'Longyearbyen', // upstream "Svalbard", the archipelago
  MAA: 'Chennai', // upstream "Madras", renamed 1996
  MXP: 'Milan', // upstream "Milano"; LIN already reads "Milan"
  NUE: 'Nuremberg', // upstream "Nuernberg"
  OEL: 'Oryol', // upstream "Oakley", a different airport's city
  OKA: 'Naha', // upstream "Okinawa", the prefecture
  PNH: 'Phnom Penh', // upstream "Phnom-penh"
  PQC: 'Phu Quoc', // upstream "Phuquoc"
  REP: 'Siem Reap', // upstream "Siem-reap"
  RHO: 'Rhodes', // upstream "Rhodos"
  SCN: 'Saarbrücken', // upstream "Saarbruecken"
  SDU: 'Rio de Janeiro', // upstream "Rio De Janeiro"
  SIA: "Xi'an", // upstream "Xi'AN" — mixed case, so not caught by the caps rule
  SVQ: 'Seville', // upstream "Sevilla"
  TER: 'Terceira', // upstream "Lajes (terceira Island)"; Lajes is the airfield
  TLL: 'Tallinn', // upstream "Tallinn-ulemiste International", the district
  TLV: 'Tel Aviv', // upstream "Tel-aviv"
  TOS: 'Tromsø', // upstream "Tromso"
  TSE: 'Astana', // upstream "Tselinograd", the Soviet-era name; NQZ since 2020
  ZRH: 'Zürich', // upstream "Zurich"
};

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
// island, so a single name → ISO mapping cannot be right. A few single
// rows carry another airport's city and country outright; those are
// here too, with the city fixed in IATA_CITY_OVERRIDES.
const IATA_COUNTRY_OVERRIDES: Readonly<Record<string, string>> = {
  AMN: 'US', // Gratiot Community, Alma MI; upstream says Kamloops, Canada
  OEL: 'RU', // Oryol Yuzhny; upstream says Oakley, United States
  BON: 'BQ', // Bonaire
  CUR: 'CW', // Curaçao
  EUX: 'BQ', // Sint Eustatius
  SAB: 'BQ', // Saba
  SXM: 'SX', // Sint Maarten
};

// Per-IATA timezone for airports whose zone the script would otherwise
// get wrong. Upstream leaves the zone blank on ~550 rows and the script
// derives it from the coordinates (see `zoneAt` below); a boundary lookup
// can land on the wrong side of a nearby border, so this map wins over
// both upstream and the derived zone. Each entry below is a blank-zone
// row whose derived zone belongs to the neighbouring country or region.
// A refresh logs derived zones whose offsets disagree with upstream's
// `utc_offset` column; most of those are stale upstream offsets, but
// check them, and new rows against their country, before adding more
// (IST and PKX used to live here; their derived zones are right).
const IATA_TZ_OVERRIDES: Readonly<Record<string, string>> = {
  // Derived zone is hours off.
  CWJ: 'Asia/Shanghai', // Cangyuan, on the Myanmar border (derived Asia/Yangon)
  OKL: 'Asia/Jayapura', // Oksibil, Papua (derived Pacific/Port_Moresby)
  TEI: 'Asia/Kolkata', // Tezu, Arunachal Pradesh (derived Asia/Yangon)
  YXQ: 'America/Whitehorse', // Beaver Creek, Yukon (derived America/Anchorage)
  DKV: 'Australia/Darwin', // Docker River, just inside the NT (derived Australia/Perth)
  TLK: 'Asia/Yakutsk', // Talakan, Sakha's Lensky district (derived Asia/Irkutsk)
  // Same offset, the neighbour's zone.
  AOU: 'Asia/Vientiane', // Attapeu, Laos (derived Asia/Phnom_Penh)
  BWW: 'America/Havana', // Cayo Santa María, Cuba (derived America/Nassau)
  CQS: 'America/Porto_Velho', // Costa Marques, Rondônia (derived America/La_Paz)
  ION: 'Africa/Brazzaville', // Impfondo, Republic of the Congo (derived Africa/Kinshasa)
  KDA: 'Africa/Dakar', // Kolda, Senegal (derived Africa/Bissau)
  SQX: 'America/Sao_Paulo', // São Miguel do Oeste, Santa Catarina (derived America/Argentina/Cordoba)
  XIJ: 'Asia/Kuwait', // Ahmed Al Jaber Air Base, Kuwait (derived Asia/Riyadh)
};

// Mid-January and mid-July of the current year: a zone's winter and
// summer offsets, for the upstream-offset sanity check.
const OFFSET_PROBES = [0, 6].map((month) => Date.UTC(new Date().getUTCFullYear(), month, 15, 12));

// Airports OpenFlights has no row for at all — its data stops around
// 2019, before Berlin Brandenburg opened (2020). Merged into both
// snapshots after the upstream rows; an upstream row for the same code
// wins and the refresh logs it, so the entry can be dropped. Coords are
// OurAirports' (public domain), checked against Wikipedia. Keep the
// predecessors (TXL, SXF): older trips still reference them.
const EXTRA_AIRPORTS: Readonly<
  Record<string, { tz: string; country: string; lat: number; lng: number; city: string }>
> = {
  BER: { tz: 'Europe/Berlin', country: 'DE', lat: 52.36174, lng: 13.50234, city: 'Berlin' },
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
  let droppedNoTz = 0;
  let tzFromCoords = 0;
  const offsetMismatches: string[] = [];
  const usedTzOverrides = new Set<string>();
  const usedCountryOverrides = new Set<string>();
  const cityFixes: CityFixes = { titleCased: [], suffixDropped: [] };
  const cityOverrides: string[] = [];
  const usedCityOverrides = new Set<string>();
  const unmappedCountries = new Map<string, number>();

  type Entry = {
    tz: string;
    country: string | null;
    lat: number | null;
    lng: number | null;
    city: string | null;
    sourceId: number;
  };
  const byIata = new Map<string, Entry>();
  let withCoords = 0;

  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 14) continue;
    const [
      idRaw,
      nameRaw,
      cityRaw,
      countryRaw,
      iata,
      ,
      latRaw,
      lngRaw,
      ,
      offsetRaw,
      ,
      tzRaw,
      type,
    ] = cols;
    if (type !== 'airport') continue;
    typeAirport += 1;

    if (!iata || iata === '\\N') continue;
    const code = iata.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;

    // Coords. Drop anything non-numeric or outside the WGS84 valid range;
    // a row with an upstream zone is still kept (tz + country alone is
    // useful for non-map callers), the coords just won't appear in the
    // output so map callers fall through to "no pin" rather than
    // mispinning to (0,0).
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

    // Timezone. A per-IATA override wins, then upstream's IANA zone, then
    // the zone the coordinates fall in. IANA zones contain "/"
    // (Asia/Saigon, America/New_York); OpenFlights occasionally puts "U"
    // or other artefacts in this slot, so require the separator. Upstream
    // leaves the zone blank on ~550 rows, newer airports among them (Doha
    // Hamad, Hyderabad); the boundary lookup the reminders use
    // (`zoneAt`) fills those. An `Etc/` answer means the point is at sea,
    // so it doesn't count.
    const upstreamTz = tzRaw && tzRaw !== '\\N' && tzRaw.includes('/') ? tzRaw : null;
    const tzOverride = IATA_TZ_OVERRIDES[code];
    if (tzOverride) {
      usedTzOverrides.add(code);
      if (upstreamTz && upstreamTz !== tzOverride) {
        console.log(`IATA_TZ_OVERRIDES shadows upstream: ${code} ${upstreamTz} → ${tzOverride}`);
      }
    }
    let tz = tzOverride ?? upstreamTz;
    if (!tz && lat !== null && lng !== null) {
      const derived = zoneAt(lat, lng);
      if (derived && !derived.startsWith('Etc/')) {
        tz = derived;
        tzFromCoords += 1;
        // Upstream's numeric `utc_offset` is often set where the zone
        // isn't. When neither the winter nor the summer offset of the
        // derived zone matches it, the lookup may have crossed a boundary
        // — or upstream is stale. Logged for a human to judge.
        const upstreamOffset = offsetRaw && offsetRaw !== '\\N' ? Number(offsetRaw) : NaN;
        if (Number.isFinite(upstreamOffset)) {
          const offsets = OFFSET_PROBES.map((at) => tzOffsetMs(derived, at) / 3_600_000);
          if (!offsets.includes(upstreamOffset)) {
            offsetMismatches.push(
              `${code} ${nameRaw ?? ''}: derived ${derived} (${offsets.join('/')}), upstream offset ${upstreamOffset}`,
            );
          }
        }
      }
    }
    if (!tz) {
      // Count IATA-coded airports still dropped for a missing zone —
      // upstream left it blank and the row has no usable coords. A
      // flight through one of these is a candidate for IATA_TZ_OVERRIDES.
      droppedNoTz += 1;
      continue;
    }

    const sourceId = Number(idRaw);
    if (Number.isNaN(sourceId)) continue;

    let country: string | null = IATA_COUNTRY_OVERRIDES[code] ?? null;
    if (country) usedCountryOverrides.add(code);
    if (!country && countryRaw && countryRaw !== '\\N' && countryRaw.trim().length > 0) {
      const key = normaliseName(countryRaw);
      country = countryIndex[key] ?? null;
      if (!country) {
        unmappedCountries.set(countryRaw, (unmappedCountries.get(countryRaw) ?? 0) + 1);
      }
    }

    const existing = byIata.get(code);
    if (existing) {
      collisions += 1;
      if (existing.sourceId <= sourceId) continue;
    }
    const cityOverride = IATA_CITY_OVERRIDES[code];
    let city: string | null;
    if (cityOverride) {
      usedCityOverrides.add(code);
      const upstreamCity = cleanCity(cityRaw, { titleCased: [], suffixDropped: [] });
      cityOverrides.push(
        upstreamCity === cityOverride
          ? `${code} ${cityOverride} (redundant: upstream already reads this)`
          : `${code} ${upstreamCity ?? '(none)'} → ${cityOverride}`,
      );
      city = cityOverride;
    } else {
      city = cleanCity(cityRaw, cityFixes);
    }
    byIata.set(code, { tz, country, lat, lng, city, sourceId });
  }

  for (const [code, extra] of Object.entries(EXTRA_AIRPORTS)) {
    if (byIata.has(code)) {
      console.log(`Upstream now has ${code} — drop it from EXTRA_AIRPORTS.`);
      continue;
    }
    byIata.set(code, { ...extra, sourceId: -1 });
  }

  type OutEntry = { tz: string; country?: string; lat?: number; lng?: number };
  const sorted: Record<string, OutEntry> = {};
  const cities: Record<string, string> = {};
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
    if (entry.city) cities[code] = entry.city;
  }

  const outPath = path.resolve(process.cwd(), OUTPUT_REL);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  const citiesPath = path.resolve(process.cwd(), CITIES_OUTPUT_REL);
  await fs.writeFile(citiesPath, `${JSON.stringify(cities, null, 2)}\n`, 'utf8');

  console.log(
    `Wrote ${OUTPUT_REL}: ${byIata.size} airports (type=airport rows: ${typeAirport}, collisions resolved: ${collisions}, with country: ${withCountry}, with coords: ${withCoords}, tz from coords: ${tzFromCoords}, dropped for missing tz: ${droppedNoTz})`,
  );
  console.log(
    `Wrote ${CITIES_OUTPUT_REL}: ${Object.keys(cities).length} cities (title-cased: ${cityFixes.titleCased.length}, airport word dropped: ${cityFixes.suffixDropped.length}, overridden: ${cityOverrides.length})`,
  );
  for (const [label, pairs] of [
    ['Title-cased', cityFixes.titleCased],
    ['Airport word dropped', cityFixes.suffixDropped],
    ['IATA_CITY_OVERRIDES', cityOverrides],
  ] as const) {
    if (pairs.length === 0) continue;
    console.log(`${label}:`);
    for (const pair of pairs) console.log(`  ${pair}`);
  }

  if (droppedNoTz > 0) {
    console.log(
      `Dropped ${droppedNoTz} IATA-coded airport(s) with no timezone and no usable coords. ` +
        'If a flight turns up an airport with no zone, add it to ' +
        'IATA_TZ_OVERRIDES in scripts/fetch-airports.ts and re-run.',
    );
  }

  if (offsetMismatches.length > 0) {
    console.log(
      `Derived zones whose winter and summer offsets both differ from upstream's utc_offset (${offsetMismatches.length}) — ` +
        'mostly stale upstream offsets; add a real boundary miss to IATA_TZ_OVERRIDES:',
    );
    for (const line of offsetMismatches) console.log(`  ${line}`);
  }

  for (const [name, map, used] of [
    ['IATA_TZ_OVERRIDES', IATA_TZ_OVERRIDES, usedTzOverrides],
    ['IATA_COUNTRY_OVERRIDES', IATA_COUNTRY_OVERRIDES, usedCountryOverrides],
    ['IATA_CITY_OVERRIDES', IATA_CITY_OVERRIDES, usedCityOverrides],
  ] as const) {
    const unused = Object.keys(map).filter((code) => !used.has(code));
    if (unused.length > 0) {
      console.log(`${name} entries that matched no airport (drop them?): ${unused.join(', ')}`);
    }
  }

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
