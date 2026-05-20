import Link from 'next/link';

import { TripFormDialog } from '@/components/features/trips/trip-form-dialog';
import { TripListCard } from '@/components/features/trips/trip-list-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import * as tripsRepo from '@/lib/trips/repo';

interface TripsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function TripsPage({ searchParams }: TripsPageProps) {
  const user = await requireUser();
  const { status } = await searchParams;

  const showingArchived = status === 'archived';
  const trips = await tripsRepo.listForUser(user.id, {
    statuses: showingArchived ? ['archived'] : undefined,
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-16 pb-24 sm:px-8 sm:pt-20">
      <header className="atlas-rise mb-10" style={{ animationDelay: '40ms' }}>
        <p className="text-muted-foreground mb-4 flex items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase">
          <span aria-hidden className="bg-foreground/30 h-px w-8" />
          <span>Section 01 · Trips</span>
        </p>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h1 className="font-display text-foreground text-5xl leading-[1.02] font-medium tracking-tight sm:text-6xl">
            {showingArchived ? 'Archived.' : 'Trips.'}
          </h1>
          <TripFormDialog mode="create" trigger={<Button size="default">New trip</Button>} />
        </div>
      </header>

      <div className="atlas-rule mb-8" aria-hidden />

      {/* Quiet filter strip — current view + the toggle to the other one */}
      <div
        className="atlas-rise mb-8 flex flex-wrap items-center justify-between gap-3 text-xs"
        style={{ animationDelay: '100ms' }}
      >
        <p className="text-muted-foreground">
          {trips.length === 0
            ? showingArchived
              ? 'Nothing archived yet.'
              : 'No trips on the books.'
            : `${trips.length} ${trips.length === 1 ? 'trip' : 'trips'}.`}
        </p>
        <Link
          href={{ pathname: '/trips', query: showingArchived ? undefined : { status: 'archived' } }}
          className="text-foreground/55 hover:text-foreground font-mono text-[10px] tracking-[0.24em] uppercase transition-colors"
        >
          {showingArchived ? '← All trips' : 'View archived →'}
        </Link>
      </div>

      {trips.length === 0 ? (
        <EmptyState archived={showingArchived} />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2">
          {trips.map((trip, i) => (
            <li key={trip.id} style={{ animationDelay: `${160 + i * 60}ms` }}>
              <TripListCard trip={trip} index={i} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState({ archived }: { archived: boolean }) {
  return (
    <Card
      variant="glass"
      className="atlas-rise relative overflow-hidden"
      style={{ animationDelay: '160ms' }}
    >
      {/* Faint topographic contour, lower-right — atmospheric, decorative. */}
      <svg
        aria-hidden
        className="text-foreground/10 pointer-events-none absolute -right-16 -bottom-16 h-72 w-72"
        viewBox="0 0 200 200"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <ellipse
            key={i}
            cx="100"
            cy="100"
            rx={20 + i * 8}
            ry={14 + i * 7}
            transform={`rotate(${-18 + i * 1.5} 100 100)`}
          />
        ))}
      </svg>

      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-14 text-center">
        <span className="border-foreground/25 text-foreground/55 mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.2em]">
          ø
        </span>
        <p className="font-display text-foreground text-2xl tracking-tight">
          {archived ? 'No archived trips.' : 'No trips yet.'}
        </p>
        <p className="text-muted-foreground mt-2 max-w-xs text-sm">
          {archived
            ? 'Anything you archive lands here. Nothing is permanently deleted unless you say so.'
            : 'Add a destination, drop a boarding pass, and Atlas does the rest.'}
        </p>
        {!archived && (
          <div className="mt-6">
            <TripFormDialog
              mode="create"
              trigger={
                <Button variant="outline" size="sm">
                  Add your first trip
                </Button>
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
