import { notFound } from 'next/navigation';

import { groupSegmentsByDay } from '@/components/features/segments/group-by-day';
import { buildRailDays } from '@/components/features/trip-map/build-rail-days';
import { ChronoTripMap } from '@/components/features/trip-map/chrono-trip-map';
import { indexMapGeometry } from '@/components/features/trip-map/timeline-model';
import { requireUser } from '@/lib/auth/session';
import { countryName } from '@/lib/countries';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripMapRepo from '@/lib/trip-map/repo';
import * as tripsRepo from '@/lib/trips/repo';

interface MapTabPageProps {
  params: Promise<{ id: string }>;
  // `country` is the spatial filter (chip strip), read here to resolve
  // the active country + chip names server-side. `day` (the temporal
  // focus) also round-trips on the URL but is read CLIENT-side via
  // useSearchParams in ChronoTripMap — the live URL is its single source
  // of truth, so the server doesn't read it.
  searchParams: Promise<{ country?: string; day?: string }>;
}

export default async function MapTabPage({ params, searchParams }: MapTabPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const { country: countryParam } = await searchParams;
  const activeCountry = countryParam?.toUpperCase() ?? null;

  // Layout already 404'd on missing trip — re-fetch for independence.
  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [mapData, allCountryCodes, wishlistPins, segments] = await Promise.all([
    tripMapRepo.getTripMapDataForUser(user.id, id),
    segmentsRepo.listCountryCodesForTrip(user.id, id),
    tripMapRepo.getWishlistOverlayForTrip(user.id, id),
    // The full scheduled segment list backs the timeline. Undated
    // segments (e.g. wishlist activities) carry no day and don't belong
    // on a chronological rail, so filter to scheduled here.
    segmentsRepo.listForTrip(user.id, id, { scheduled: true }),
  ]);

  // Country chip strip only matters when the trip touched 2+ places.
  // Names are resolved server-side so the client bundle stays free of
  // the ISO_COUNTRIES list.
  const countries = allCountryCodes.map((code) => ({
    code,
    name: countryName(code) ?? code,
  }));

  // Shape the timeline: group segments into days, then join each day's
  // segments to the map's pins / arcs by segmentId so the rail knows
  // which rows are mappable and where they sit. The `scheduled: true`
  // filter above means no unscheduled bucket here.
  //
  // Deliberately NO server-side past/today/future classification: the
  // rail reclassifies client-side in the VIEWER's timezone (matching the
  // itinerary tab, ADR-0016), so the two tabs never disagree on "today"
  // near midnight in a non-UTC zone. The server only ships clock-agnostic
  // shape — day buckets, their rows, and the span-capable check-ins the
  // client may surface as continuations.
  const { days } = groupSegmentsByDay(segments);
  const geometry = indexMapGeometry(mapData.pins, mapData.arcs);
  const railDays = buildRailDays(days, geometry);

  // Collapsed-past + auto-scroll-to-today fire only for an active trip
  // (issue #8 parity) — passed through to gate them client-side.
  const isActive = trip.status === 'active';

  return (
    <ChronoTripMap
      tripId={id}
      pins={mapData.pins}
      arcs={mapData.arcs}
      ungeocoded={mapData.ungeocoded}
      countries={countries}
      activeCountry={activeCountry}
      wishlistPins={wishlistPins}
      geocodeWorkerStatus={mapData.geocodeWorkerStatus}
      days={railDays}
      isActive={isActive}
      tripTitle={trip.title}
    />
  );
}
