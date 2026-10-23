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
 * A short month + year, e.g. `"Mar 2025"`. Used for the "newest
 * country" line. UTC-based so a date stored as `timestamptz` doesn't
 * slip a month at either end depending on the host offset.
 */
export function shortMonthYear(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The page's "as of" date, day first: `"23 Oct 2026"`. UTC, the same
 * clock the stats repo counts "has happened" against, so the stamp and
 * the tallies agree on what today is.
 */
export function dayMonthYear(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** First word of a display name, or null when there's no name to show. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

// A calendar-average month (365.25 / 12 days).
const DAYS_PER_MONTH = 30.4375;

/**
 * Nights away as time on the road: `299` → `"10 months on the road"`,
 * `430` → `"1 year, 2 months on the road"`. Rounded to the nearest
 * month; under one full month there's nothing worth saying, so null.
 */
export function timeOnTheRoad(nights: number): string | null {
  if (nights < DAYS_PER_MONTH) return null;
  const months = Math.round(nights / DAYS_PER_MONTH);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const monthPart = `${rest} ${plural(rest, 'month')}`;
  if (years === 0) return `${monthPart} on the road`;
  const yearPart = `${years} ${plural(years, 'year')}`;
  return rest === 0 ? `${yearPart} on the road` : `${yearPart}, ${monthPart} on the road`;
}

/** Equatorial circumference, km. */
const EARTH_CIRCUMFERENCE_KM = 40_075;

/**
 * Distance flown as laps of the Earth: one decimal below 100 laps,
 * a whole number from 100 (`"1.6"`, `"311"`). Null when it would read
 * as nothing (`"0.0"`). Always from kilometres, whatever the display
 * unit — a lap is a lap.
 */
export function earthLaps(km: number): string | null {
  const laps = km / EARTH_CIRCUMFERENCE_KM;
  if (laps >= 99.95) return groupDigits(laps);
  const oneDecimal = laps.toFixed(1);
  return oneDecimal === '0.0' ? null : oneDecimal;
}

// Approximate advance widths, in em, of the lifetime pass's display
// figure (Bricolage Grotesque, heavy, tabular digits, tracked -0.04em).
// Measured in the browser and rounded up, so the estimate errs wide.
const DIGIT_EM = 0.62;
const THIN_SPACE_EM = 0.14;

/**
 * Estimated width of a grouped figure in em. The distance row sizes its
 * figure as "available width ÷ this", so the line can shrink to fit
 * instead of wrapping — `"12 480 300"` must still sit on one line at
 * 360px.
 */
export function figureWidthEm(figure: string): number {
  let em = 0;
  for (const ch of figure) em += ch === '\u202F' || ch === ' ' ? THIN_SPACE_EM : DIGIT_EM;
  return Math.round(em * 100) / 100;
}

/**
 * A signed latitude rendered as degrees with a hemisphere letter:
 * `64.13` → `"64.1° N"`, `-45.03` → `"45.0° S"`, `0` or `-0.04` → `"0.0°"`.
 */
export function latitudeLabel(lat: number): string {
  const abs = Math.abs(lat).toFixed(1);
  // Judge the hemisphere on the rounded figure, so -0.04 reads "0.0°"
  // rather than "0.0° S".
  if (abs === '0.0') return '0.0°';
  return lat > 0 ? `${abs}° N` : `${abs}° S`;
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
