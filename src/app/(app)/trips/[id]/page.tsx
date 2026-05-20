import { redirect } from 'next/navigation';

// Trip detail is now tabbed (see ADR-0004). The bare /trips/:id route
// redirects to the default tab, preserving the country filter query
// string if present so deep links survive.
interface TripIndexPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

export default async function TripIndexPage({ params, searchParams }: TripIndexPageProps) {
  const { id } = await params;
  const { country } = await searchParams;
  const qs = country ? `?country=${encodeURIComponent(country)}` : '';
  redirect(`/trips/${id}/itinerary${qs}`);
}
