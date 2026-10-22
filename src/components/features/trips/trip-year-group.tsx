import { TripListCard } from './trip-list-card';
import type { Trip } from '@/lib/trips';

interface TripYearGroupProps {
  /** Either a numeric year (e.g. 2024) or the literal "Undated" label. */
  label: number | 'Undated';
  trips: Trip[];
  /** Running index across the whole past section, for the entrance stagger. */
  startIndex: number;
}

/**
 * A year section of the past-trips list — sticky-header + the same
 * `TripListCard` grid used by the upcoming surface. The sticky offset
 * is `top-16` to clear the app's 64 px topbar; the negative horizontal
 * margin bleeds the backdrop to the container edges so the header
 * reads as a section break rather than a floating chip.
 */
export function TripYearGroup({ label, trips, startIndex }: TripYearGroupProps) {
  if (trips.length === 0) return null;
  const headingId = `year-${label}`;
  return (
    <section aria-labelledby={headingId} className="mb-6 sm:mb-8">
      <header className="bg-background/85 supports-[backdrop-filter]:bg-background/55 sticky top-16 z-30 -mx-6 mb-4 px-6 py-3 backdrop-blur-md sm:-mx-8 sm:mb-5 sm:px-8 sm:py-4">
        <div className="flex items-baseline gap-4">
          <h2 id={headingId} className="heading-section leading-none">
            {label}
          </h2>
          <span className="text-muted-foreground shrink-0 font-mono text-[11px] tracking-[0.06em] uppercase">
            {trips.length} {trips.length === 1 ? 'trip' : 'trips'}
          </span>
        </div>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-5">
        {trips.map((trip, i) => (
          <li
            key={trip.id}
            // Same 60 ms stagger the upcoming grid uses, so the entrance
            // rhythm stays consistent across sections.
            style={{ animationDelay: `${160 + (startIndex + i) * 60}ms` }}
          >
            <TripListCard trip={trip} />
          </li>
        ))}
      </ul>
    </section>
  );
}
