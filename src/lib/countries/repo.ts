import { and, eq, isNotNull, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { segments, trips, userVisitedCountries } from '@/db/schema';
import { tripVisibleToViewer } from '@/lib/trips/repo';

// Plain Date fields are safe to cross the RSC → client boundary
// (Next serialises them with date-fns-style support). Don't introduce
// Map/Set/BigInt fields here without revisiting the serialisation path.
export interface VisitedCountry {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** Distinct trips that touched this country (0 if only manually marked). */
  tripCount: number;
  /** Earliest start of any contributing trip; null when only manually marked. */
  firstVisitAt: Date | null;
  /** Latest end (or start, if no end) of any contributing trip; null when only manually marked. */
  lastVisitAt: Date | null;
  /** True when the user manually added this country (independently of any trip). */
  manuallyMarked: boolean;
}

/**
 * Visited-country roll-up for the world map. Merges two sources:
 *
 * 1. **Trip-derived**: any **non-flight** segment with a `countryCode`
 *    on a trip that has actually started (`startDate IS NOT NULL` and
 *    `startDate <= now()`). Hotels, activities, transit, notes all
 *    count; flights don't — a layover or a departure airport in your
 *    home country shouldn't paint that country as "visited." Logging
 *    a hotel or activity is the signal that you actually spent time
 *    there. Archived trips are included (archiving is a list-view
 *    filter, not a "didn't happen" signal).
 *
 * 2. **Manually marked**: `user_visited_countries` rows added by the
 *    user from the Manage Countries UI. Lets the user fill in places
 *    they visited before Atlas existed without fabricating trip data.
 *
 * A country present in both sources gets trip stats AND
 * `manuallyMarked: true`. Both sources independently make a country
 * "visited"; neither overrides the other.
 *
 * Visibility (ADR-0015): the trip-derived source respects
 * `tripVisibleToViewer` — household trips count for every member, but
 * another member's *private* trip never paints a country here. Manual
 * marks stay a per-viewer personal overlay (keyed by `userId`) — "places
 * I'd been before Atlas" is personal, not shared.
 *
 * See ADR-0005 for the per-segment country attribution rationale.
 */
export async function listVisitedCountriesForUser(userId: string): Promise<VisitedCountry[]> {
  const [segmentRows, manualRows] = await Promise.all([
    db
      .select({
        tripId: trips.id,
        tripStartDate: trips.startDate,
        segmentStartsAt: segments.startsAt,
        segmentEndsAt: segments.endsAt,
        countryCode: segments.countryCode,
      })
      .from(segments)
      .innerJoin(trips, eq(segments.tripId, trips.id))
      .where(
        and(
          tripVisibleToViewer(userId),
          isNotNull(trips.startDate),
          lte(trips.startDate, sql`now()`),
          ne(segments.type, 'flight'),
          isNotNull(segments.countryCode),
        ),
      ),
    db
      .select({ countryCode: userVisitedCountries.countryCode })
      .from(userVisitedCountries)
      .where(eq(userVisitedCountries.userId, userId)),
  ]);

  // Aggregate per country directly off segment dates — not trip dates.
  // A hotel in Malaysia in July inside a Jul–Sep trip should report
  // "Last Jul" for Malaysia even if the trip ended in Sep in Vietnam.
  // Trip startDate is only used as a fallback when the segment itself
  // has no dates (e.g. an undated "TBD" hotel that still tells us the
  // user is in that country during the trip).
  interface CountryStats {
    trips: Set<string>;
    firstDate: Date | null;
    lastDate: Date | null;
  }
  const byCode = new Map<string, CountryStats>();
  for (const row of segmentRows) {
    if (!row.countryCode) continue;
    const stats = byCode.get(row.countryCode) ?? {
      trips: new Set<string>(),
      firstDate: null,
      lastDate: null,
    };
    stats.trips.add(row.tripId);
    const segFirst = row.segmentStartsAt ?? row.tripStartDate;
    const segLast = row.segmentEndsAt ?? row.segmentStartsAt ?? row.tripStartDate;
    if (segFirst && (!stats.firstDate || segFirst < stats.firstDate)) stats.firstDate = segFirst;
    if (segLast && (!stats.lastDate || segLast > stats.lastDate)) stats.lastDate = segLast;
    byCode.set(row.countryCode, stats);
  }

  const manualSet = new Set(manualRows.map((r) => r.countryCode));

  const out: VisitedCountry[] = [];
  for (const [code, stats] of byCode) {
    out.push({
      code,
      tripCount: stats.trips.size,
      firstVisitAt: stats.firstDate,
      lastVisitAt: stats.lastDate,
      manuallyMarked: manualSet.has(code),
    });
  }

  // Manual-only countries (no trip segments at all) get a row with
  // null dates and zero trip count. These render the same fill on the
  // map; the tooltip shows the "Marked as visited" variant.
  for (const code of manualSet) {
    if (byCode.has(code)) continue;
    out.push({
      code,
      tripCount: 0,
      firstVisitAt: null,
      lastVisitAt: null,
      manuallyMarked: true,
    });
  }

  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Just the user's manual codes — used by the Manage UI to render
 * removable chips without going through the full merged query.
 */
export async function listManualVisitedCountriesForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ countryCode: userVisitedCountries.countryCode })
    .from(userVisitedCountries)
    .where(eq(userVisitedCountries.userId, userId));
  return rows.map((r) => r.countryCode).sort();
}

/**
 * Add a manual visited-country mark. Idempotent — re-adding an existing
 * code is a no-op (PG `on conflict do nothing` on the composite PK).
 */
export async function addManualVisitedCountry(userId: string, code: string): Promise<void> {
  await db.insert(userVisitedCountries).values({ userId, countryCode: code }).onConflictDoNothing();
}

/**
 * Remove a manual mark. If the same country still has trip-derived
 * segments, it will still appear as "visited" on the map — that's the
 * intended behavior; the two sources are independent.
 */
export async function removeManualVisitedCountry(userId: string, code: string): Promise<void> {
  await db
    .delete(userVisitedCountries)
    .where(
      and(eq(userVisitedCountries.userId, userId), eq(userVisitedCountries.countryCode, code)),
    );
}
