import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth/session';
import { countryName } from '@/lib/countries';
import * as documentsRepo from '@/lib/documents/repo';
import { getUploadMaxBytesOrFallback } from '@/lib/documents/upload-limit';
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

  // getByIdForUser returns household trips created by anyone (ADR-0015),
  // so the viewer isn't necessarily the owner. Trip-row actions
  // (edit/archive/delete/upload/visibility) stay owner-only, so the
  // chrome hides those controls for a non-owner viewing a shared trip.
  const isOwner = trip.userId === user.id;

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

  // Every trip tab renders through this layout, so a misconfigured
  // STORAGE_MAX_BYTES must not take trip browsing down with it — a household
  // member reading `/trips/<id>/map` would get a 500 from an operator typo.
  // The loudness lands where a file is actually uploaded instead: the
  // Documents tab and uploadDocumentAction both still throw on it.
  const uploadMaxBytes = getUploadMaxBytesOrFallback();

  return (
    <TripChrome
      trip={trip}
      isOwner={isOwner}
      countries={countries}
      attachedDocumentCount={attachedDocumentCount}
      uploadMaxBytes={uploadMaxBytes}
    >
      {children}
    </TripChrome>
  );
}
