import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { segments, trips, type Segment } from '@/db/schema';
import { getAirportCoords } from '@/lib/airports';
import {
  buildGeocodeQuery,
  enqueueGeocodeFetch,
  getCachedMany,
  getGeocodeWorkerStatus,
  normalizeForGeocoder,
  normalizeQuery,
  type GeocodeWorkerStatus,
} from '@/lib/geocoding';
import * as segmentsRepo from '@/lib/segments/repo';
import {
  activityDataSchema,
  flightDataSchema,
  foodDataSchema,
  hotelDataSchema,
} from '@/lib/segments/validators';
import * as wishlistRepo from '@/lib/wishlist/repo';

// Re-exported so the client trip-map component can type its prop off
// the repo barrel (a type-only import) without reaching into the
// geocoding module directly.
export type { GeocodeWorkerStatus };

// Plain serialisable fields — these cross the RSC → client boundary.
// Don't add Map/Set/BigInt or anything Next can't pass over the wire.
/**
 * Pin kind drives the icon + colour. Flight pins come from the
 * committed IATA airport snapshot; hotel / activity / transit / food
 * pins come from the geocode cache (ADR-0010). The renderer maps
 * `kind → icon` via `ICON_BY_KIND` in pin-marker.tsx, so adding a
 * kind here requires only that one-row addition.
 */
export type TripMapPinKind = 'flight' | 'hotel' | 'activity' | 'transit' | 'food';

export interface TripMapPin {
  segmentId: string;
  kind: TripMapPinKind;
  /**
   * Primary label. Always-on for `flight` (IATA) and `hotel` (property
   * name); hover-only for the other kinds via the floating tooltip.
   * The renderer truncates long values with ellipsis — pass the full
   * string here so the hover tooltip can show the un-truncated form.
   */
  label: string;
  /** Optional context line (e.g. "WY 287"). */
  sublabel?: string;
  /**
   * Compact date string painted under the always-on label for hotels
   * ("1–5 Jun", "31 May – 3 Jun", "29 Dec 2025 – 2 Jan 2026"). Set
   * server-side so the client doesn't have to re-derive the same
   * formatting; the floating tooltip still renders its own longer-
   * form date from `date`.
   */
  dateLabel?: string;
  /** ISO 3166-1 alpha-2 of the pin's country. Drives chip-strip filtering. */
  country: string | null;
  lat: number;
  lng: number;
  /** Primary date for the segment; null for undated activity wishlists. */
  date: Date | null;
}

export interface TripMapArc {
  segmentId: string;
  /** Origin coordinates (from the flight's origin airport). */
  originLat: number;
  originLng: number;
  /** Destination coordinates (from the flight's destination airport). */
  destLat: number;
  destLng: number;
  /** ISO 3166-1 alpha-2 of each endpoint — drives chip-strip dimming. */
  originCountry: string | null;
  destCountry: string | null;
}

export interface UngeocodedSegment {
  segmentId: string;
  type: Segment['type'];
  /** Short human label to show in the "not pinned" list. */
  label: string;
  /** One-line reason — surfaced verbatim under the segment in the UI. */
  reason: string;
}

export interface TripMapData {
  pins: TripMapPin[];
  /**
   * Flight arcs. Drawn only when both endpoints' countries have at
   * least one non-flight segment on this trip — same "real trip
   * presence" rule the world-map visited query uses. That filter
   * keeps inbound/outbound home-airport flights from painting a
   * cross-continent line just because you departed there.
   */
  arcs: TripMapArc[];
  /**
   * Segments we couldn't place on the map. Surfaced under the map so
   * "missing" data is visible rather than silently dropped — no pin
   * is the most surprising bug class for a map view.
   */
  ungeocoded: UngeocodedSegment[];
  /**
   * Whether geocoding looks unable to resolve this trip's pending pins
   * right now: `'unconfigured'` (NOMINATIM_CONTACT_EMAIL unset) or
   * `'worker-down'` (the background worker isn't draining the queue).
   * `'ok'` whenever nothing is pending or the worker is healthy. Drives
   * the trip-map banner — see issue #24.
   */
  geocodeWorkerStatus: GeocodeWorkerStatus;
}

// Wishlist overlay pin — a muted, toggleable marker layer drawn on
// top of the regular trip-map pins. Items already materialised on
// this trip are excluded at the repo layer; items without resolved
// coords (cache miss / null) are also dropped here — the overlay is
// a hint, not a "missing" surface.
export interface WishlistMapPin {
  itemId: string;
  kind: 'food' | 'activity';
  label: string;
  /** ISO 3166-1 alpha-2 of the wishlist item's country. */
  country: string;
  lat: number;
  lng: number;
}

const segmentCols = getTableColumns(segments);

/**
 * Build the pin set for a trip's map tab. Verifies ownership through
 * the trips.userId join (no separate ACL check needed — a foreign
 * userId returns an empty result, not a 403).
 *
 * Two coord sources:
 *   - Flights: in-memory IATA airport snapshot (`src/lib/airports`).
 *   - Hotel / activity / transit / food: geocode_cache, populated in
 *     the background by the segment lifecycle hook (ADR-0010). One
 *     batch SELECT covers every non-flight segment on the trip — no
 *     on-demand network calls in the request path.
 *
 * Notes (`segment.type === 'note'`) never appear on the map — they
 * have no place by definition.
 */
export async function getTripMapDataForUser(userId: string, tripId: string): Promise<TripMapData> {
  const rows = await db
    .select(segmentCols)
    .from(segments)
    .innerJoin(trips, eq(segments.tripId, trips.id))
    .where(and(eq(segments.tripId, tripId), eq(trips.userId, userId)))
    .orderBy(sql`${segments.startsAt} asc nulls last`, asc(segments.createdAt));

  const pins: TripMapPin[] = [];
  const arcs: TripMapArc[] = [];
  const ungeocoded: UngeocodedSegment[] = [];
  // Set when at least one segment resolved to a cache MISS (not a null
  // result, not a no-query row). Only a real miss can be explained by a
  // down/unconfigured worker, so the banner check is gated on this.
  let hasPendingMiss = false;

  // Flight pins are accumulated keyed by IATA so a transfer airport
  // shared by two consecutive legs (BOS→FRA, FRA→MUC) shows up as a
  // single FRA marker instead of two stacked at the same coords.
  // First-write wins on label/sublabel — both legs touching the same
  // airport agree on the airport identity, and the spatial overview
  // doesn't need to enumerate every flight number landing there.
  const flightPinsByAirport = new Map<string, TripMapPin>();

  // Non-flight rows that have a geocodable query — these get resolved
  // in one batch SELECT against the cache after the row scan.
  const pending: Array<{ row: Segment; query: string }> = [];

  for (const row of rows) {
    if (row.type === 'note') continue;

    if (row.type === 'flight') {
      const parsed = flightDataSchema.safeParse(row.data);
      const dest = parsed.success ? parsed.data.destinationAirport : undefined;
      const origin = parsed.success ? parsed.data.originAirport : undefined;
      const destCoords = dest ? getAirportCoords(dest) : null;
      const originCoords = origin ? getAirportCoords(origin) : null;

      if (!dest) {
        ungeocoded.push({
          segmentId: row.id,
          type: 'flight',
          label: flightLabel(row, parsed.success ? parsed.data : undefined),
          reason: 'Flight has no destination airport.',
        });
        continue;
      }
      if (!destCoords) {
        ungeocoded.push({
          segmentId: row.id,
          type: 'flight',
          label: flightLabel(row, parsed.success ? parsed.data : undefined),
          reason: `Airport ${dest} isn't in our snapshot — refresh src/lib/airports.`,
        });
        continue;
      }

      const flightNo = parsed.success
        ? [parsed.data.carrier, parsed.data.flightNumber].filter(Boolean).join(' ').trim()
        : '';

      // Both endpoints get pinned. Per ADR-0005, segments.countryCode
      // is the *destination* country and originCountryCode is the
      // origin — drive each pin's country off the matching column so
      // chip-strip filtering treats the two ends independently.
      if (!flightPinsByAirport.has(dest)) {
        flightPinsByAirport.set(dest, {
          segmentId: row.id,
          kind: 'flight',
          label: dest,
          ...(flightNo ? { sublabel: flightNo } : {}),
          country: row.countryCode,
          lat: destCoords.lat,
          lng: destCoords.lng,
          date: row.startsAt,
        });
      }
      if (origin && originCoords && !flightPinsByAirport.has(origin)) {
        flightPinsByAirport.set(origin, {
          segmentId: row.id,
          kind: 'flight',
          label: origin,
          ...(flightNo ? { sublabel: flightNo } : {}),
          country: row.originCountryCode,
          lat: originCoords.lat,
          lng: originCoords.lng,
          date: row.startsAt,
        });
      }

      // Arc gate: just both endpoints need real coords. On the "All"
      // chip we draw every flight so the user sees the full shape of
      // their travel (including the inbound from home); the chip-strip
      // dimming in TripMap then mutes arcs that aren't fully in the
      // active country, so a country-narrowed view stays uncluttered.
      if (originCoords) {
        arcs.push({
          segmentId: row.id,
          originLat: originCoords.lat,
          originLng: originCoords.lng,
          destLat: destCoords.lat,
          destLng: destCoords.lng,
          originCountry: row.originCountryCode,
          destCountry: row.countryCode,
        });
      }
      continue;
    }

    // hotel / activity / transit / food — geocode_cache resolves
    // these to a pin. buildGeocodeQuery owns the per-type derivation;
    // normalizeForGeocoder strips address noise (postcodes, floor /
    // suite designators) the same way the lifecycle hook does on the
    // write side, so identical inputs produce identical cache keys.
    const raw = buildGeocodeQuery(row);
    const query = raw === null ? null : normalizeForGeocoder(raw);
    if (!query) {
      ungeocoded.push({
        segmentId: row.id,
        type: row.type,
        label: pinLabelForType(row),
        reason: noQueryReason(row.type),
      });
      continue;
    }
    pending.push({ row, query });
  }

  if (pending.length > 0) {
    const cache = await getCachedMany(pending.map((p) => p.query));
    for (const { row, query } of pending) {
      const cached = cache.get(normalizeQuery(query));
      if (cached?.kind === 'hit') {
        const isHotel = row.type === 'hotel';
        // Hotel pins paint an always-on two-line label (property
        // name + check-in→check-out range). Activities, transit, and
        // food keep the hover-only treatment for now — their
        // identifiers are short enough that a tooltip works fine.
        // Hotel and food both resolve their label off the venue/
        // property name (the recognisable headline) rather than the
        // neighbourhood-y locationName; everything else stays on
        // locationName via nonFlightLabel.
        const label = pinLabelForType(row);
        const dateLabel =
          isHotel && row.startsAt ? formatHotelDateRange(row.startsAt, row.endsAt) : undefined;
        pins.push({
          segmentId: row.id,
          kind: row.type as Exclude<TripMapPinKind, 'flight'>,
          label,
          ...(dateLabel ? { dateLabel } : {}),
          country: row.countryCode,
          lat: cached.result.lat,
          lng: cached.result.lng,
          date: row.startsAt,
        });
        continue;
      }
      if (cached?.kind === 'null') {
        ungeocoded.push({
          segmentId: row.id,
          type: row.type,
          label: pinLabelForType(row),
          reason: "We couldn't find this place on the map.",
        });
        continue;
      }
      // 'miss' (or undefined — defensive; getCachedMany always
      // returns an entry per input). The miss covers two cases:
      //   - The lifecycle hook fired but the background fetch is
      //     still in flight (genuine race; the user just saved).
      //   - The segment pre-dates the lifecycle hook deploy, so no
      //     fetch was ever queued for it.
      // Defensive enqueue handles the second case — the per-process
      // in-flight set in `enqueueGeocodeFetch` keeps rapid page
      // refreshes from fanning out into duplicate calls.
      hasPendingMiss = true;
      enqueueGeocodeFetch(query);
      ungeocoded.push({
        segmentId: row.id,
        type: row.type,
        label: pinLabelForType(row),
        reason: 'Geocoding pending — try again in a moment.',
      });
    }
  }

  // Append the deduped flight pins after the non-flight pins; render
  // order doesn't affect MapLibre markers, this just keeps the array
  // grouped by kind for callers that scan it.
  for (const pin of flightPinsByAirport.values()) pins.push(pin);

  // Only probe worker health when there's a pending miss to explain —
  // an all-resolved (or all-null) trip needs no banner, and this keeps
  // the env/pg-boss check off the hot path for healthy maps.
  const geocodeWorkerStatus: GeocodeWorkerStatus = hasPendingMiss
    ? await getGeocodeWorkerStatus()
    : 'ok';

  return { pins, arcs, ungeocoded, geocodeWorkerStatus };
}

function flightLabel(
  row: Segment,
  data: { carrier?: string; flightNumber?: string; destinationAirport?: string } | undefined,
): string {
  if (data?.flightNumber) {
    return [data.carrier, data.flightNumber].filter(Boolean).join(' ').trim();
  }
  return row.locationName ?? 'Flight';
}

// Label for activity / transit rows — `locationName` first, with the
// capitalised type as a last-resort fallback. Hotels and food don't
// reach here: `pinLabelForType` routes them to their venue-first
// labellers so the place's own name headlines the pin.
function nonFlightLabel(row: Segment): string {
  if (row.locationName) return row.locationName;
  return row.type.charAt(0).toUpperCase() + row.type.slice(1);
}

// Map-pin label for a hotel — propertyName first, locationName as a
// fallback. Inverted vs `nonFlightLabel` (which favours
// `locationName`) because on the map the hotel's *brand name* is the
// recognisable headline. The renderer truncates long values with
// ellipsis; the floating tooltip surfaces the un-truncated form.
function hotelPinLabel(row: Segment, hotelData: { propertyName: string } | null): string {
  if (hotelData?.propertyName) return hotelData.propertyName;
  if (row.locationName) return row.locationName;
  return 'Hotel';
}

// Map-pin label for a food segment — venue first, locationName as a
// fallback. Mirrors `hotelPinLabel`: the restaurant's *venue name*
// is the recognisable headline, exactly like a hotel's property
// name, so a neighbourhood-y `locationName` ("Bukit Bintang") must
// not win over it.
function foodPinLabel(row: Segment, foodData: { venue: string } | null): string {
  if (foodData?.venue) return foodData.venue;
  if (row.locationName) return row.locationName;
  return 'Food';
}

// Map-pin label for an activity segment — title first, then
// locationName, then the generic type fallback. Same pattern as
// hotels and food: the *thing's name* ("Senso-ji Temple") is the
// recognisable headline. The plain `locationName`-first fallback
// in `nonFlightLabel` is too generic for activities — it leaves
// a pin reading "Activity" whenever the user didn't supply a
// pin-style label, even though the activity has a perfectly good
// title in `data`.
function activityPinLabel(row: Segment, activityData: { title: string } | null): string {
  if (activityData?.title) return activityData.title;
  if (row.locationName) return row.locationName;
  return 'Activity';
}

// Resolve the map-pin / "not pinned" label for a non-flight row.
// Hotels and food headline on their venue/property name (see
// `hotelPinLabel` / `foodPinLabel`); everything else keeps the
// `locationName`-first `nonFlightLabel`. Used for both resolved pins
// and ungeocoded entries so the user recognises a row by the same
// name everywhere it appears.
function pinLabelForType(row: Segment): string {
  if (row.type === 'hotel') {
    const parsed = hotelDataSchema.safeParse(row.data);
    return hotelPinLabel(row, parsed.success ? parsed.data : null);
  }
  if (row.type === 'food') {
    const parsed = foodDataSchema.safeParse(row.data);
    return foodPinLabel(row, parsed.success ? parsed.data : null);
  }
  if (row.type === 'activity') {
    const parsed = activityDataSchema.safeParse(row.data);
    return activityPinLabel(row, parsed.success ? parsed.data : null);
  }
  return nonFlightLabel(row);
}

// Compact date-range formatter for the always-on hotel label.
//
//   same month                 → "1–5 Jun"
//   different month, same year → "31 May – 3 Jun"
//   different year             → "29 Dec 2025 – 2 Jan 2026"
//   no end date                → "1 Jun"
//
// UTC-based so a check-in on Jun 1 stored as `timestamptz` doesn't
// render as May 31 in west-of-UTC sessions — same rule the tooltip
// uses for its own date formatting.
function formatHotelDateRange(start: Date, end: Date | null): string {
  const startDay = start.getUTCDate();
  const startMonth = start.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  if (!end) {
    return `${startDay} ${startMonth}`;
  }
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const endDay = end.getUTCDate();
  if (sameMonth) {
    return `${startDay}–${endDay} ${startMonth}`;
  }
  const endMonth = end.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  if (sameYear) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
  }
  return (
    `${startDay} ${startMonth} ${start.getUTCFullYear()} ` +
    `– ${endDay} ${endMonth} ${end.getUTCFullYear()}`
  );
}

/**
 * Wishlist-overlay pins for a trip: items whose country is in this
 * trip's country list and which aren't already materialised on this
 * trip. Items with no cached coords (cache miss or null result) are
 * silently dropped — the overlay is a suggestion, not a "missing"
 * surface. The user can refine an unresolved item via #16's address
 * picker later, and the next render will pick it up.
 *
 * Same per-type query construction as segments (`buildGeocodeQuery`)
 * so the wishlist item shares its `geocode_cache` row with any
 * segment materialised from it.
 */
export async function getWishlistOverlayForTrip(
  userId: string,
  tripId: string,
): Promise<WishlistMapPin[]> {
  // Trip ownership AND the country list both come from
  // `listCountryCodesForTrip`, which derives the codes from
  // segment attribution (ADR-0005) via a user-scoped JOIN. A
  // foreign userId returns an empty list — no separate ACL check
  // needed.
  const countryCodes = await segmentsRepo.listCountryCodesForTrip(userId, tripId);
  if (countryCodes.length === 0) return [];

  const items = await wishlistRepo.listForCountries(countryCodes, {
    excludeMaterialisedOnTrip: tripId,
  });
  if (items.length === 0) return [];

  const queryFor = (place: {
    type: 'food' | 'activity' | Segment['type'];
    data: unknown;
    locationName: string | null;
  }): string | null => {
    const raw = buildGeocodeQuery({
      type: place.type,
      data: place.data,
      locationName: place.locationName,
    });
    return raw === null ? null : normalizeForGeocoder(raw);
  };

  // Belt-and-braces dedup. The FK-based `excludeMaterialisedOnTrip`
  // filter covers segments whose `wishlistItemId` is intact, but the
  // FK is `ON DELETE SET NULL` — so a segment materialised from a
  // wishlist item that was later deleted (and possibly re-created)
  // has a NULL backref. Without this step, the muted overlay marker
  // would render on top of the segment's own pin at the same coords,
  // and the user can't easily tell why a segment looks like a
  // wishlist pin.
  //
  // The dedup happens by *derived geocode query* — same logical
  // place, same cache row, same coordinates. We fetch all segments
  // on the trip and build their normalised query set; any wishlist
  // item that produces the same normalised string is filtered out.
  const tripSegments = await segmentsRepo.listForTrip(userId, tripId);
  const segmentQueries = new Set<string>();
  for (const seg of tripSegments) {
    const q = queryFor(seg);
    if (q && q.trim() !== '') segmentQueries.add(normalizeQuery(q));
  }

  // Pair each item with its derived query so we can map cache hits
  // back to the item. Skip items whose query matches a segment on
  // this trip (the dedup case above).
  const withQuery: Array<{ item: (typeof items)[number]; query: string }> = [];
  for (const item of items) {
    const q = queryFor(item);
    if (!q || q.trim() === '') continue;
    if (segmentQueries.has(normalizeQuery(q))) continue;
    withQuery.push({ item, query: q });
  }
  if (withQuery.length === 0) return [];

  const cache = await getCachedMany(withQuery.map((p) => p.query));
  const pins: WishlistMapPin[] = [];
  for (const { item, query } of withQuery) {
    const cached = cache.get(normalizeQuery(query));
    if (cached?.kind !== 'hit') continue;
    // Headline label — same source as the materialised segment's pin
    // label (venue / title), kept short for the muted marker.
    const label = wishlistPinLabel(item);
    pins.push({
      itemId: item.id,
      kind: item.type,
      label,
      country: item.countryCode,
      lat: cached.result.lat,
      lng: cached.result.lng,
    });
  }
  return pins;
}

function wishlistPinLabel(item: { type: 'food' | 'activity'; data: unknown }): string {
  if (item.type === 'food') {
    const parsed = foodDataSchema.safeParse(item.data);
    return parsed.success ? parsed.data.venue : 'Food spot';
  }
  const parsed = activityDataSchema.safeParse(item.data);
  return parsed.success ? parsed.data.title : 'Attraction';
}

function noQueryReason(type: Segment['type']): string {
  // Type-specific copy so the fix is actionable. Activities and hotels
  // shouldn't usually land here (the validator requires title /
  // propertyName); transit segments do, when neither endpoint has a
  // name set.
  switch (type) {
    case 'hotel':
      return 'Add a name or address to pin this on the map.';
    case 'activity':
      return 'Add a title to pin this on the map.';
    case 'transit':
      return 'Add a station or stop name to pin this on the map.';
    case 'food':
      return 'Add a venue or address to pin this on the map.';
    default:
      return 'Missing details — add a location to pin this on the map.';
  }
}
