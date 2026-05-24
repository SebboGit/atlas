import { notFound } from 'next/navigation';

import { TripMap } from '@/components/features/trip-map/trip-map';
import { requireUser } from '@/lib/auth/session';
import { countryName } from '@/lib/countries';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripMapRepo from '@/lib/trip-map/repo';
import * as tripsRepo from '@/lib/trips/repo';

interface MapTabPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

export default async function MapTabPage({ params, searchParams }: MapTabPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const { country: countryParam } = await searchParams;
  const activeCountry = countryParam?.toUpperCase() ?? null;

  // Layout already 404'd on missing trip — re-fetch for independence.
  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [mapData, allCountryCodes, wishlistPins] = await Promise.all([
    tripMapRepo.getTripMapDataForUser(user.id, id),
    segmentsRepo.listCountryCodesForTrip(user.id, id),
    tripMapRepo.getWishlistOverlayForTrip(user.id, id),
  ]);

  // Country chip strip only matters when the trip touched 2+ places.
  // Names are resolved server-side so the client bundle stays free of
  // the ISO_COUNTRIES list.
  const countries = allCountryCodes.map((code) => ({
    code,
    name: countryName(code) ?? code,
  }));

  // No TabHeader on this tab — the chip strip below already carries
  // the country signal and the count of pins reads as nonsensical
  // ("Map · 06" — 6 maps?). The map itself is the count.
  return (
    <TripMap
      pins={mapData.pins}
      arcs={mapData.arcs}
      ungeocoded={mapData.ungeocoded}
      countries={countries}
      activeCountry={activeCountry}
      tripId={id}
      wishlistPins={wishlistPins}
    />
  );
}
