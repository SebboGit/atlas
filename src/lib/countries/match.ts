// Country name matching for typeaheads. Pure lookup over the committed
// snapshot in ./data — no DB, no network, no runtime provider
// (CLAUDE.md guardrail 13).
//
// Exists because a plain `name.includes(query)` fails the way people
// actually type. "South Korea" finds nothing against the ISO display
// name "Korea, South"; "USA" finds nothing against "United States";
// "Turkiye" and "Türkiye" are different strings. Three layers fix that:
// a normaliser that folds accents and punctuation, a generic
// comma-inversion rule, and a small alias table for the names people
// use that share no substring with the official one.
//
// The result is RANKED, not filtered. Callers (the wishlist country
// filter, the form's CountrySelect) keep a highlighted index into the
// returned array and commit whatever sits at index 0 on Enter, so the
// ordering is what makes "JP" land on Japan instead of on whichever
// country happens to be alphabetically first.

import { ISO_COUNTRIES, type CountryRef } from './data';

/**
 * What people type that shares no useful substring with the ISO
 * display name. Keyed by alpha-2 code; every value is run through the
 * same normaliser as the query, so "U.S.A." and "usa" both land here.
 *
 * Deliberately NOT listed:
 *   - Korea (North/South) and the DR Congo's inverted form — the
 *     comma-inversion rule below already produces them.
 *   - "Türkiye" — accent folding makes it identical to the stored
 *     name; the alias people need is "Turkey".
 *   - "macedonia", "vatican", "czech" — already substrings of
 *     "North Macedonia", "Holy See (Vatican City)", "Czechia".
 *   - Cities (dubai → AE) and archaic names (persia, siam). The table
 *     grows without bound once it starts accepting those.
 */
export const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  US: ['usa', 'united states of america', 'america'],
  GB: ['uk', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  AE: ['uae', 'emirates'],
  NL: ['holland'],
  MM: ['burma'],
  // "Côte d'Ivoire" normalises to "cote d ivoire" — the apostrophe
  // becomes a space, so the run-together spelling needs its own entry.
  CI: ['ivory coast', 'cote divoire'],
  CZ: ['czech republic'],
  TR: ['turkey'],
  CV: ['cape verde'],
  CD: ['drc', 'dr congo', 'democratic republic of congo', 'congo kinshasa'],
  CG: ['republic of the congo', 'congo brazzaville'],
  SZ: ['swaziland'],
  TL: ['east timor'],
  MO: ['macao'],
  // "Cocos (Keeling) Islands" — the parenthetical sits mid-name, so
  // the common short form isn't a substring.
  CC: ['cocos islands'],
  VI: ['us virgin islands', 'united states virgin islands'],
  VG: ['british virgin islands'],
  BQ: ['caribbean netherlands'],
};

/**
 * Fold a country name or a user query to a comparable form: accents
 * stripped, punctuation flattened, casing dropped.
 *
 * Periods are deleted rather than spaced so "U.S.A." collapses to
 * "usa" and matches the alias; every other separator becomes a space
 * so "Timor-Leste" and "Timor Leste" agree. A leading article is
 * dropped ("the Netherlands"), and the "st"/"saint" token swap covers
 * the seven Saint * entries without seven alias rows.
 *
 * NOT shared with src/lib/geocoding/normalize.ts — that one is the
 * geocode_cache primary key and deliberately preserves accents.
 * Folding there would silently re-key every cached row.
 */
function normalizeCountryText(value: string): string {
  const folded = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
  if (folded === '') return '';
  return folded
    .split(' ')
    .map((token) => (token === 'st' ? 'saint' : token))
    .join(' ');
}

/**
 * Flip an inverted ISO display name back to spoken order:
 * "Korea, South" → "South Korea".
 *
 * Only the first comma is considered, and a tail containing "and" is
 * skipped — "Bonaire, Sint Eustatius and Saba" is a LIST, not an
 * inversion, and flipping it yields the junk variant "sint eustatius
 * and saba bonaire". Those are the only four comma-bearing names in
 * the snapshot today (Korea ×2, Congo DR, Bonaire).
 */
function invertOnComma(name: string): string | null {
  const comma = name.indexOf(',');
  if (comma === -1) return null;
  const head = name.slice(0, comma).trim();
  const tail = name.slice(comma + 1).trim();
  if (head === '' || tail === '') return null;
  if (/\band\b/i.test(tail)) return null;
  return `${tail} ${head}`;
}

/** Every normalised string a country can be found by. */
function variantsFor(country: CountryRef): readonly string[] {
  const out = [normalizeCountryText(country.name)];
  const inverted = invertOnComma(country.name);
  if (inverted) out.push(normalizeCountryText(inverted));
  for (const alias of COUNTRY_ALIASES[country.code] ?? []) {
    out.push(normalizeCountryText(alias));
  }
  return out.filter((v) => v !== '');
}

// Built once at import — 250 entries, a few strings each. Per-keystroke
// work is then a scan of precomputed strings, nothing rebuilt. Mirrors
// the `_byCode` index in ./data.
const _variantsByCode = new Map<string, readonly string[]>(
  ISO_COUNTRIES.map((c) => [c.code, variantsFor(c)]),
);

function variantsOf(country: CountryRef): readonly string[] {
  return _variantsByCode.get(country.code) ?? variantsFor(country);
}

// Lower rank sorts first. An exact ISO code beats everything so a power
// user typing "JP" lands on Japan rather than on Jamaica-then-Japan;
// the cost is that any 2-letter query privileges the code ("ma" ranks
// Morocco above Malaysia), which is the intended trade.
const RANK_CODE = 0;
const RANK_EXACT = 1;
const RANK_PREFIX = 2;
const RANK_SUBSTRING = 3;

function rankOf(query: string, country: CountryRef): number | null {
  if (query === country.code.toLowerCase()) return RANK_CODE;
  let best: number | null = null;
  for (const variant of variantsOf(country)) {
    if (variant === query) return RANK_EXACT;
    if (variant.startsWith(query)) {
      if (best === null || best > RANK_PREFIX) best = RANK_PREFIX;
      continue;
    }
    if (variant.includes(query)) {
      if (best === null || best > RANK_SUBSTRING) best = RANK_SUBSTRING;
    }
  }
  return best;
}

/**
 * Rank `pool` against a free-text country query, dropping non-matches.
 *
 * Generic over the pool element so callers can carry a payload — the
 * wishlist filter passes `{ code, name, count }` and gets the same
 * rows back rather than re-joining by code. An empty or
 * punctuation-only query returns `pool` unchanged, by reference and in
 * its original order.
 *
 * Ties keep pool order: the sort is by rank alone and
 * `Array.prototype.sort` is stable, so a name-sorted pool stays
 * name-sorted within each tier.
 */
export function searchCountries<T extends CountryRef>(
  query: string,
  pool: readonly T[],
): readonly T[] {
  const q = normalizeCountryText(query);
  if (q === '') return pool;
  const ranked: Array<{ item: T; rank: number }> = [];
  for (const item of pool) {
    const rank = rankOf(q, item);
    if (rank !== null) ranked.push({ item, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.item);
}
