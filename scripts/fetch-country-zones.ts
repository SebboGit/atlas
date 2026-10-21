// One-shot: refresh src/lib/timezones/country-zones.json from the IANA
// time zone database.
//
// The committed JSON is the runtime source of truth (ADR-0020's zone
// fallback). Countries rarely gain or lose a zone; run this when a tzdata
// release adds one, or every year or two:
//
//   pnpm tsx scripts/fetch-country-zones.ts
//
// Source: zone.tab from https://data.iana.org/time-zones/ (public domain).
// Each non-comment line is `<ISO 3166 code>\t<coordinates>\t<zone>[\t<comment>]`,
// one country per zone. We keep only the code → zones mapping, sorted so
// refreshes diff cleanly.

import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_URL = 'https://data.iana.org/time-zones/tzdb/zone.tab';
const OUTPUT_REL = 'src/lib/timezones/country-zones.json';

async function main(): Promise<void> {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();

  const byCountry = new Map<string, Set<string>>();
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [code, , zone] = line.split('\t');
    if (!code || !zone || !/^[A-Z]{2}$/.test(code)) continue;
    let zones = byCountry.get(code);
    if (!zones) byCountry.set(code, (zones = new Set()));
    zones.add(zone.trim());
  }

  const out: Record<string, string[]> = {};
  for (const code of [...byCountry.keys()].sort()) {
    out[code] = [...byCountry.get(code)!].sort();
  }

  const target = path.resolve(process.cwd(), OUTPUT_REL);
  await fs.writeFile(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`wrote ${Object.keys(out).length} countries to ${OUTPUT_REL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
