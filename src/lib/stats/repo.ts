import { eq, getTableColumns } from 'drizzle-orm';

import { db } from '@/db/client';
import { segments, trips } from '@/db/schema';
import { displayCarrier } from '@/lib/airlines';
import { getAirportCoords } from '@/lib/airports';
import { countryName } from '@/lib/countries';
import {
  buildGeocodeQuery,
  getCachedMany,
  normalizeForGeocoder,
  normalizeQuery,
} from '@/lib/geocoding';
import { flightDataSchema } from '@/lib/segments/validators';

import { haversineKm } from './geo';
import { visibleTripsPredicate } from './visibility';

// ─── Public shapes ───────────────────────────────────────────────────
// Every field below is a plain serialisable primitive or a Date, so the
// whole result crosses the RSC → client boundary cleanly. Don't add
// Map/Set/BigInt here.

/** Lifetime headline numbers. */
export interface LifetimeStats {
  countriesVisited: number;
  /**
   * ISO code + name of the most recently first-visited country, if any.
   * `name` always resolves to a display string — `countryName` falls
   * back to the bare code for an unknown ISO value, so it's never null.
   */
  newestCountry: { code: string; name: string; firstVisitAt: Date } | null;
  /** Total nights away — summed hotel-stay durations across all trips. */
  nightsAway: number;
  /** Count of flight segments. */
  flightsTaken: number;
  /** Sum of great-circle distances between flight origin/destination, km. */
  distanceFlownKm: number;
}

/** One row of a year-over-year strip. */
export interface YearTally {
  year: number;
  count: number;
}

export interface YearOverYearStats {
  tripsPerYear: YearTally[];
  nightsPerYear: YearTally[];
  newCountriesPerYear: YearTally[];
}

export interface PersonalRecords {
  /** Longest trip by nights; null when no dated multi-night trip exists. */
  longestTrip: { tripId: string; title: string; nights: number } | null;
  /** Most extreme latitudes touched by any placed point. */
  northernmost: { label: string; lat: number } | null;
  southernmost: { label: string; lat: number } | null;
  /** Airport IATA appearing on the most flight legs (origin or dest). */
  mostVisitedAirport: { code: string; visits: number } | null;
  /** Carrier name on the most flight segments. */
  topAirline: { name: string; flights: number } | null;
}

export interface StatsDashboardData {
  lifetime: LifetimeStats;
  yearOverYear: YearOverYearStats;
  records: PersonalRecords;
  /** True when the user has no trips at all — drives the empty state. */
  isEmpty: boolean;
}

// ─── Internal query helpers ──────────────────────────────────────────

const segmentCols = getTableColumns(segments);

/**
 * Trips in scope for this viewer. Today {@link visibleTripsPredicate}
 * is a no-op (full household sharing), so this is every trip — but the
 * predicate is threaded through so per-viewer privacy is a one-line
 * change when `trips.visibility` lands. See visibility.ts.
 */
function tripsScope(currentUserId: string) {
  return visibleTripsPredicate(currentUserId);
}

// Nights between two timestamps, floored, never negative. A hotel
// stay's nights = checkout day − checkin day. Computed off the UTC
// calendar date so a stay stored as `timestamptz` doesn't gain or lose
// a night across the host's local-offset.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function nightsBetween(start: Date, end: Date): number {
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const n = Math.floor((endDay - startDay) / MS_PER_DAY);
  return n > 0 ? n : 0;
}

// ─── The one entry point ─────────────────────────────────────────────

/**
 * Build the full stats dashboard payload for `currentUserId`.
 *
 * Pure read — no writes, no schema dependency beyond the existing
 * trips / segments tables and the geocode cache. Two independent query
 * batches run in parallel; the aggregation is done in TypeScript
 * because the shapes (per-country first-visit, per-year tallies,
 * haversine sums) are clearer in code than in SQL and the data volume
 * is personal-app small.
 *
 * Coordinate sources for the north/south extremes:
 *   - Flight airports: the committed IATA snapshot (`src/lib/airports`).
 *     No network round-trip.
 *   - Non-flight points (hotel / activity / transit): the geocode
 *     cache (`geocode_cache`, ADR-0010), read with the same
 *     `buildGeocodeQuery` → `getCachedMany` path the trip-map repo
 *     uses. This is a read-only cache lookup — the stats page never
 *     triggers a live geocode (rate limits, dashboard latency), so
 *     non-flight extremes are best-effort over points already
 *     geocoded by the segment lifecycle hook. A segment whose place
 *     hasn't been geocoded yet simply doesn't contribute.
 */
export async function getStatsDashboardData(currentUserId: string): Promise<StatsDashboardData> {
  const scope = tripsScope(currentUserId);

  const [tripRows, segmentRows] = await Promise.all([
    // Trips: dated rows drive year tallies + longest-trip; the count
    // also tells us whether to show the empty state.
    db
      .select({
        id: trips.id,
        title: trips.title,
        startDate: trips.startDate,
        endDate: trips.endDate,
      })
      .from(trips)
      .where(scope),
    // Every segment on an in-scope trip. The join applies the viewer
    // predicate; per-type aggregation happens below.
    db
      .select(segmentCols)
      .from(segments)
      .innerJoin(trips, eq(segments.tripId, trips.id))
      .where(scope),
  ]);

  // Resolve non-flight segment coordinates from the geocode cache.
  // buildGeocodeQuery owns the per-type derivation (the lifecycle hook
  // used the same function on the write side), so identical inputs hit
  // the same cache key. One batch SELECT covers every geocodable
  // non-flight segment; no on-demand geocoding.
  const nonFlightPoints = await resolveNonFlightPoints(segmentRows);

  return {
    lifetime: buildLifetime(segmentRows),
    yearOverYear: buildYearOverYear(tripRows, segmentRows),
    records: buildRecords(tripRows, segmentRows, nonFlightPoints),
    isEmpty: tripRows.length === 0,
  };
}

/**
 * A geocoded non-flight point that contributes to the north/south
 * extremes — its display label plus resolved coordinates.
 */
interface NonFlightPoint {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Read cached coordinates for every geocodable non-flight segment.
 * Mirrors the trip-map repo's resolution path: derive a per-type
 * query, batch-read the cache, keep only the rows that resolved to a
 * coordinate. Cache misses and "couldn't find" entries are skipped —
 * the stats page makes no live geocode calls.
 */
async function resolveNonFlightPoints(segmentRows: SegmentRow[]): Promise<NonFlightPoint[]> {
  const pending: Array<{ label: string; query: string }> = [];
  for (const seg of segmentRows) {
    if (seg.type === 'flight' || seg.type === 'note') continue;
    const raw = buildGeocodeQuery(seg);
    const query = raw === null ? null : normalizeForGeocoder(raw);
    if (!query) continue;
    pending.push({ label: nonFlightPointLabel(seg), query });
  }
  if (pending.length === 0) return [];

  const cache = await getCachedMany(pending.map((p) => p.query));
  const points: NonFlightPoint[] = [];
  for (const { label, query } of pending) {
    const cached = cache.get(normalizeQuery(query));
    if (cached?.kind === 'hit') {
      points.push({ label, lat: cached.result.lat, lng: cached.result.lng });
    }
  }
  return points;
}

// Display label for a non-flight extreme. `locationName` is the user's
// pin-style shorthand and the most recognisable thing to surface; when
// it's missing we fall back to the segment type ("Hotel", "Activity").
function nonFlightPointLabel(seg: SegmentRow): string {
  const loc = seg.locationName?.trim();
  if (loc) return loc;
  return seg.type.charAt(0).toUpperCase() + seg.type.slice(1);
}

// ─── Lifetime headline ───────────────────────────────────────────────

type SegmentRow = typeof segments.$inferSelect;
type TripRow = { id: string; title: string; startDate: Date | null; endDate: Date | null };

function buildLifetime(segmentRows: SegmentRow[]): LifetimeStats {
  // Countries: a non-flight segment with a countryCode is the "actually
  // spent time there" signal — same rule the world-map query uses
  // (ADR-0005). A bare flight layover doesn't paint a country.
  const countryFirstVisit = new Map<string, Date>();
  for (const seg of segmentRows) {
    if (seg.type === 'flight' || !seg.countryCode) continue;
    const when = seg.startsAt;
    if (!when) continue;
    const prev = countryFirstVisit.get(seg.countryCode);
    if (!prev || when < prev) countryFirstVisit.set(seg.countryCode, when);
  }

  let newestCountry: LifetimeStats['newestCountry'] = null;
  for (const [code, firstVisitAt] of countryFirstVisit) {
    if (!newestCountry || firstVisitAt > newestCountry.firstVisitAt) {
      // countryName falls back to the bare code for an unknown ISO
      // value, so `name` is always a usable display string.
      newestCountry = { code, name: countryName(code), firstVisitAt };
    }
  }

  // Nights away: sum hotel-stay durations. Hotels are the honest
  // "slept here" record; activities/transit don't imply an overnight.
  let nightsAway = 0;
  for (const seg of segmentRows) {
    if (seg.type !== 'hotel' || !seg.startsAt || !seg.endsAt) continue;
    nightsAway += nightsBetween(seg.startsAt, seg.endsAt);
  }

  // Flights + distance flown.
  let flightsTaken = 0;
  let distanceFlownKm = 0;
  for (const seg of segmentRows) {
    if (seg.type !== 'flight') continue;
    flightsTaken += 1;
    const parsed = flightDataSchema.safeParse(seg.data);
    if (!parsed.success) continue;
    const origin = getAirportCoords(parsed.data.originAirport);
    const dest = getAirportCoords(parsed.data.destinationAirport);
    if (origin && dest) {
      distanceFlownKm += haversineKm(
        { lat: origin.lat, lng: origin.lng },
        { lat: dest.lat, lng: dest.lng },
      );
    }
  }

  return {
    countriesVisited: countryFirstVisit.size,
    newestCountry,
    nightsAway,
    flightsTaken,
    distanceFlownKm: Math.round(distanceFlownKm),
  };
}

// ─── Year-over-year strips ───────────────────────────────────────────

function buildYearOverYear(tripRows: TripRow[], segmentRows: SegmentRow[]): YearOverYearStats {
  // Trips per year — keyed off the trip's start date. Undated trips
  // (wishlist drafts, ADR-0003) have no year and are excluded.
  const tripsByYear = new Map<number, number>();
  for (const trip of tripRows) {
    if (!trip.startDate) continue;
    const y = trip.startDate.getUTCFullYear();
    tripsByYear.set(y, (tripsByYear.get(y) ?? 0) + 1);
  }

  // Nights per year — hotel-stay nights attributed to the check-in year.
  const nightsByYear = new Map<number, number>();
  for (const seg of segmentRows) {
    if (seg.type !== 'hotel' || !seg.startsAt || !seg.endsAt) continue;
    const y = seg.startsAt.getUTCFullYear();
    nightsByYear.set(y, (nightsByYear.get(y) ?? 0) + nightsBetween(seg.startsAt, seg.endsAt));
  }

  // New countries per year — a country counts in the year of its
  // *first* non-flight visit, so each country contributes to exactly
  // one year's tally.
  const countryFirstVisit = new Map<string, Date>();
  for (const seg of segmentRows) {
    if (seg.type === 'flight' || !seg.countryCode || !seg.startsAt) continue;
    const prev = countryFirstVisit.get(seg.countryCode);
    if (!prev || seg.startsAt < prev) countryFirstVisit.set(seg.countryCode, seg.startsAt);
  }
  const newCountriesByYear = new Map<number, number>();
  for (const firstVisitAt of countryFirstVisit.values()) {
    const y = firstVisitAt.getUTCFullYear();
    newCountriesByYear.set(y, (newCountriesByYear.get(y) ?? 0) + 1);
  }

  return {
    tripsPerYear: toSortedTallies(tripsByYear),
    nightsPerYear: toSortedTallies(nightsByYear),
    newCountriesPerYear: toSortedTallies(newCountriesByYear),
  };
}

// Map<year, count> → ascending-by-year array. Years with zero activity
// simply don't appear; the strip renders the years that have data.
function toSortedTallies(byYear: Map<number, number>): YearTally[] {
  return [...byYear.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);
}

// ─── Personal records ────────────────────────────────────────────────

function buildRecords(
  tripRows: TripRow[],
  segmentRows: SegmentRow[],
  nonFlightPoints: NonFlightPoint[],
): PersonalRecords {
  // Longest trip by nights between start and end date. Both dates are
  // required — a partially-dated wishlist trip (ADR-0003) has no
  // measurable duration and doesn't qualify.
  let longestTrip: PersonalRecords['longestTrip'] = null;
  for (const trip of tripRows) {
    if (!trip.startDate || !trip.endDate) continue;
    const nights = nightsBetween(trip.startDate, trip.endDate);
    if (nights <= 0) continue;
    if (!longestTrip || nights > longestTrip.nights) {
      longestTrip = { tripId: trip.id, title: trip.title, nights };
    }
  }

  // North / south extremes — pooled from two coordinate sources:
  //   - flight airports (committed IATA snapshot)
  //   - geocoded non-flight points (geocode cache, read-only)
  // We take whichever point reaches furthest from the equator.
  let northernmost: PersonalRecords['northernmost'] = null;
  let southernmost: PersonalRecords['southernmost'] = null;
  const considerPoint = (label: string, lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!northernmost || lat > northernmost.lat) northernmost = { label, lat };
    if (!southernmost || lat < southernmost.lat) southernmost = { label, lat };
  };

  // Flight airports + airport-visit tally + carrier tally in one pass.
  const airportVisits = new Map<string, number>();
  const airlineFlights = new Map<string, number>();
  for (const seg of segmentRows) {
    if (seg.type !== 'flight') continue;
    const parsed = flightDataSchema.safeParse(seg.data);
    if (!parsed.success) continue;
    const { originAirport, destinationAirport, carrier } = parsed.data;
    for (const code of [originAirport, destinationAirport]) {
      if (!code) continue;
      const coords = getAirportCoords(code);
      // Only tally — and only place — codes the IATA snapshot knows.
      // A non-IATA typo has no coordinates and no real identity, so
      // it must not be eligible to win "most-visited airport". This
      // matches how distance and extremes already skip unknown codes.
      if (!coords) continue;
      airportVisits.set(code, (airportVisits.get(code) ?? 0) + 1);
      considerPoint(code, coords.lat, coords.lng);
    }
    // Resolve the stored carrier to a friendly name before tallying.
    // `data.carrier` may hold a bare IATA code ("BA") on legacy rows or
    // the full name ("British Airways") on newer ones; `displayCarrier`
    // normalises both, so the two forms tally as one airline and the
    // record reads "British Airways", never "BA".
    const carrierName = displayCarrier(carrier);
    if (carrierName) {
      airlineFlights.set(carrierName, (airlineFlights.get(carrierName) ?? 0) + 1);
    }
  }
  for (const pt of nonFlightPoints) considerPoint(pt.label, pt.lat, pt.lng);

  return {
    longestTrip,
    northernmost,
    southernmost,
    mostVisitedAirport: topEntry(airportVisits, (code, visits) => ({ code, visits })),
    topAirline: topEntry(airlineFlights, (name, flights) => ({ name, flights })),
  };
}

// Highest-count entry of a Map<string, number>. Ties broken by the
// key's natural sort order so the result is deterministic across runs.
function topEntry<T>(
  counts: Map<string, number>,
  shape: (key: string, count: number) => T,
): T | null {
  let bestKey: string | null = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && bestKey !== null && key < bestKey)) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey === null ? null : shape(bestKey, bestCount);
}
