// One-shot: refresh src/lib/airlines/iata-airlines.json from OpenFlights.
//
// Airlines don't change often — the committed JSON is the runtime source
// of truth. Run this script manually when the upstream data warrants a
// bump (every few years, or when a missing carrier turns up in practice):
//
//   pnpm tsx --env-file-if-exists=.env scripts/fetch-airlines.ts
//
// Source: https://github.com/jpatokal/openflights (CC-BY-SA 3.0). The
// airlines.dat file has columns:
//
//   id, name, alias, iata, icao, callsign, country, active
//
// We keep only Active='Y' rows with a real 2-letter IATA code. When two
// active rows share an IATA (rare but happens — regional sub-carriers,
// defunct codes recycled), the lower OpenFlights ID wins for
// deterministic output across refreshes.

import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat';
const OUTPUT_REL = 'src/lib/airlines/iata-airlines.json';

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

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching airlines.dat`);
  const text = await res.text();

  const lines = text.split('\n').filter((l) => l.length > 0);
  let activeRows = 0;
  let kept = 0;
  let collisions = 0;

  const byIata = new Map<string, { name: string; sourceId: number }>();

  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 8) continue;
    const [idRaw, name, _alias, iata, _icao, _callsign, _country, active] = cols;
    if (active !== 'Y') continue;
    activeRows += 1;
    if (!iata || iata === '\\N') continue;
    const code = iata.toUpperCase();
    // Valid IATA airline designators are 2 chars, alphanumeric, and
    // contain at least one letter. Pure-digit codes ("11", "99", "01")
    // and OpenFlights noise are filtered out here.
    if (!/^[A-Z0-9]{2}$/.test(code)) continue;
    if (!/[A-Z]/.test(code)) continue;
    if (!name || name.trim().length === 0) continue;
    // OpenFlights includes community-submitted "virtual" airlines used
    // by flight-sim communities. They share IATA codes with real
    // carriers and pollute the lookup. Real boarding passes don't
    // come from them.
    if (/\bvirtual\b/i.test(name)) continue;
    // Reject suspect names: 1- or 2-character entries (almost always
    // OpenFlights garbage like "L" or "Zz"), and 3-char entries unless
    // they're all-lowercase brand styling (legitimately "bmi", "dba").
    const trimmedName = name.trim();
    if (trimmedName.length < 3) continue;
    if (trimmedName.length === 3 && trimmedName !== trimmedName.toLowerCase()) continue;
    // Defence against entries where the "name" is just the IATA code
    // again (e.g. N1 → "N1").
    if (trimmedName.toUpperCase() === code) continue;

    const sourceId = Number(idRaw);
    if (Number.isNaN(sourceId)) continue;

    const existing = byIata.get(code);
    if (existing) {
      collisions += 1;
      if (existing.sourceId <= sourceId) continue;
    }
    byIata.set(code, { name: trimmedName, sourceId });
    kept = byIata.size;
  }

  const sorted: Record<string, string> = {};
  for (const code of [...byIata.keys()].sort()) {
    const entry = byIata.get(code);
    if (entry) sorted[code] = entry.name;
  }

  const outPath = path.resolve(process.cwd(), OUTPUT_REL);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

  console.log(
    `Wrote ${OUTPUT_REL}: ${kept} airlines (active rows: ${activeRows}, collisions resolved: ${collisions})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
