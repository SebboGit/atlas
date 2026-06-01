import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth/session';
import { countryName } from '@/lib/countries';
import * as documentsRepo from '@/lib/documents/repo';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';

import { TripChrome } from './trip-chrome';

interface TripLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function TripLayout({ children, params }: TripLayoutProps) {
  const user = await requireUser();
  const { id } = await params;

  // Layout runs ONCE per trip — Next's layout-boundary optimisation
  // reuses it across sibling pages (`/itinerary` → `/map` etc.) and
  // does NOT re-execute the server code. The fetched data is therefore
  // stable for the trip; the chrome variant decision lives client-side
  // in TripChrome where usePathname stays reactive across navigations.
  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  // Country codes drawn from actual segment attribution (see ADR-0005).
  // The filter bar auto-hides when fewer than two distinct countries
  // exist on this trip, so a brand-new or single-country trip never
  // shows it.
  const countryCodes = await segmentsRepo.listCountryCodesForTrip(user.id, id);
  // Surfaced to the Delete-trip dialog so the user can decide whether
  // to also remove the documents (rows + files) when destroying a trip.
  const attachedDocumentCount = await documentsRepo.countForTrip(user.id, id);

  // Resolve display names server-side (keeps the ISO_COUNTRIES list off the
  // client bundle) so the filter chips read "United Kingdom", not "GB".
  const countries = countryCodes.map((code) => ({ code, name: countryName(code) ?? code }));

  return (
    <TripChrome trip={trip} countries={countries} attachedDocumentCount={attachedDocumentCount}>
      {children}
    </TripChrome>
  );
}
