import { NextTripHero } from '@/components/features/home/next-trip-hero';
import { SectionTile } from '@/components/features/home/section-tile';
import { TripFormDialog } from '@/components/features/trips/trip-form-dialog';
import { SectionEyebrow } from '@/components/section-eyebrow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import type { Trip } from '@/lib/trips';
import { partitionForDashboard } from '@/lib/trips/dashboard-groups';
import * as tripsRepo from '@/lib/trips/repo';

// The next-trip hero carries section 01 (Trips); these tiles carry the
// remaining three destinations.
const TILES = [
  { href: '/wishlist', index: '02', title: 'Wishlist' },
  { href: '/map', index: '03', title: 'Map' },
  { href: '/stats', index: '04', title: 'Stats' },
] as const;

export default async function HomePage() {
  const user = await requireUser();
  const firstName = user.name?.split(' ')[0] ?? user.email.split('@')[0];

  // Same fetch + partition the trips page uses — the home screen now shows
  // the user's actual next trip instead of four buttons echoing the nav.
  const trips = await tripsRepo.listForUser(user.id);
  const { upcoming } = partitionForDashboard(trips);
  const nextTrip = upcoming[0] ?? null;

  // Decorative "today" stamp under the greeting. Rendered in UTC (the
  // app's canonical clock, ADR-0014/0016) so it's deterministic and never
  // depends on the server container's timezone; the viewer-relative day
  // count lives in the hero countdown, not here.
  const stampDate = new Date()
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    .toUpperCase();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-8 pb-24 sm:px-8 sm:pt-20">
      <section className="atlas-rise" style={{ animationDelay: '60ms' }}>
        <SectionEyebrow>Section 00 · Logbook</SectionEyebrow>
        <h1 className="font-display text-foreground text-4xl leading-[1.02] font-medium tracking-tight sm:text-5xl md:text-7xl">
          Welcome back,
          <br />
          <span className="italic">{firstName}</span>.
        </h1>
        <p className="text-muted-foreground mt-5 font-mono text-[10px] tracking-[0.22em] uppercase">
          {buildStateOfPlay(trips.length, nextTrip, stampDate)}
        </p>
      </section>

      <div
        aria-hidden
        className="atlas-rise atlas-rule-double mt-10 mb-9"
        style={{ animationDelay: '140ms' }}
      />

      {nextTrip ? <NextTripHero trip={nextTrip} /> : <NoUpcoming hasTrips={trips.length > 0} />}

      <section className="mt-6 grid gap-5 sm:grid-cols-3">
        {TILES.map((t, i) => (
          <SectionTile key={t.href} {...t} delay={`${320 + i * 60}ms`} />
        ))}
      </section>
    </main>
  );
}

// One mono line of "where things stand" under the greeting.
function buildStateOfPlay(count: number, nextTrip: Trip | null, stamp: string): string {
  if (count === 0) return `${stamp} · Logbook empty`;
  const label = `${count} ${count === 1 ? 'trip' : 'trips'} logged`;
  if (!nextTrip) return `${stamp} · ${label} · none upcoming`;
  // "now" when you're on the trip, "next" when it's still upcoming — saying
  // "next" for the trip you're currently on misreads. No day-count here:
  // the hero countdown shows it in the viewer's timezone.
  const lead = nextTrip.status === 'active' ? 'now' : 'next';
  return `${stamp} · ${label} · ${lead}: ${nextTrip.title}`;
}

// Shown in the hero slot when there's no upcoming trip — keeps section 01
// present and routes to the create flow.
function NoUpcoming({ hasTrips }: { hasTrips: boolean }) {
  return (
    <Card
      variant="glass"
      className="atlas-rise relative overflow-hidden"
      style={{ animationDelay: '220ms' }}
    >
      <span
        aria-hidden
        className="border-primary/40 text-primary/80 absolute top-5 right-5 inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px]"
      >
        01
      </span>
      <CardContent className="flex flex-col items-start gap-4 px-6 py-9 sm:px-8 sm:py-11">
        <p className="text-primary font-mono text-[10px] tracking-[0.28em] uppercase">
          Next departure
        </p>
        <h2 className="font-display text-foreground text-3xl leading-tight font-medium tracking-tight sm:text-4xl">
          {hasTrips ? 'Nothing on the horizon.' : 'Your logbook starts here.'}
        </h2>
        <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
          {hasTrips
            ? 'No upcoming trips on the books.'
            : 'Add a destination and Atlas takes it from there.'}
        </p>
        <div className="mt-2">
          <TripFormDialog
            mode="create"
            trigger={<Button>{hasTrips ? 'Plan a trip' : 'Start your first trip'}</Button>}
          />
        </div>
      </CardContent>
    </Card>
  );
}
