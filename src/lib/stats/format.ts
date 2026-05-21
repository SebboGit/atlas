// Display formatters for the stats dashboard. Pure, dependency-free —
// no React, no DB. Kept in the stats module (not the shared
// src/lib/format) because these phrasings are dashboard-specific:
// memory-tool voice, not generic number formatting.

/**
 * Group a non-negative integer with thin spaces every three digits:
 * `12480` → `"12 480"`. Thin space (U+202F) rather than a comma so the
 * number reads as a quiet figure on the page, not a financial total.
 */
export function groupDigits(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * A month + year, e.g. `"March 2025"`. Used for "last new country"
 * style lines. UTC-based so a date stored as `timestamptz` doesn't
 * slip a month at either end depending on the host offset.
 */
export function monthYear(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * A signed latitude rendered as degrees with a hemisphere letter:
 * `64.13` → `"64.1° N"`, `-45.03` → `"45.0° S"`, `0` → `"0.0°"`.
 */
export function latitudeLabel(lat: number): string {
  const abs = Math.abs(lat).toFixed(1);
  if (lat > 0) return `${abs}° N`;
  if (lat < 0) return `${abs}° S`;
  return `${abs}°`;
}

/** Pluralise a noun against a count: `(1, 'night')` → `"night"`. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

// ---------------------------------------------------------------------------
// Distance unit
// ---------------------------------------------------------------------------

/** The distance units the stats dashboard can report `distanceFlown` in. */
export type DistanceUnit = 'km' | 'mi';

/** Kilometres in one international (statute) mile. */
const KM_PER_MILE = 1.609344;

/**
 * Resolve the active distance unit from the environment. Reads
 * `ATLAS_DISTANCE_UNIT` — a server-only var (no `NEXT_PUBLIC_` prefix),
 * since distance is computed and converted server-side in the stats
 * repo before it crosses the RSC boundary. Unknown / unset values fall
 * back to `km`.
 *
 * Pure read — no caching — so tests can stub `process.env` per case.
 */
export function getDistanceUnit(): DistanceUnit {
  const raw = process.env.ATLAS_DISTANCE_UNIT?.toLowerCase().trim();
  return raw === 'mi' ? 'mi' : 'km';
}

/**
 * Convert a kilometre figure to the requested display unit. `km` is a
 * no-op passthrough; `mi` divides by the statute-mile constant. The
 * result is left unrounded — callers format it (e.g. `groupDigits`,
 * which rounds) at render time.
 */
export function convertDistance(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? km / KM_PER_MILE : km;
}
