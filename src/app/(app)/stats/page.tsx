import { LifetimePass } from '@/components/features/stats/lifetime-pass';
import { RecordTickets } from '@/components/features/stats/record-tickets';
import { YearTickets } from '@/components/features/stats/year-tickets';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { getStatsDashboardData, type StatsDashboardData } from '@/lib/stats';
import { layoutBarcode } from '@/lib/stats/barcode';
import {
  convertDistance,
  dayMonthYear,
  earthLaps,
  firstName,
  getDistanceUnit,
  groupDigits,
  plural,
  shortMonthYear,
  timeOnTheRoad,
} from '@/lib/stats/format';
import { buildYearRows, tripsSince } from '@/lib/stats/year-rows';

export const metadata = {
  title: 'Stats · Atlas',
};

export default async function StatsPage() {
  const user = await requireUser();
  // One clock for the whole page: the tallies, the "as of" stamp and the
  // current year all read the same instant, on the repo's UTC day.
  const now = new Date();
  // currentUserId scopes every stats query to this viewer: their own
  // trips plus household trips, never another member's private trip
  // (ADR-0015, via tripVisibleToViewer in @/lib/trips/repo).
  const data = await getStatsDashboardData(user.id, now);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-7 pb-24 sm:px-8 sm:pt-14">
      <header
        className="atlas-rise mb-5 flex items-baseline justify-between gap-4 sm:mb-8 sm:justify-start sm:gap-[1.125rem]"
        style={{ animationDelay: '20ms' }}
      >
        <h1 className="text-foreground text-[2.5rem] leading-none font-bold tracking-[-0.035em] sm:text-[3.5rem]">
          Stats
        </h1>
        <p className="text-muted-foreground text-[0.9375rem] whitespace-nowrap sm:text-lg">
          as of {dayMonthYear(now)}
        </p>
      </header>

      {data.isEmpty ? <EmptyState /> : <Dashboard data={data} now={now} name={user.name} />}
    </main>
  );
}

function Dashboard({
  data,
  now,
  name,
}: {
  data: StatsDashboardData;
  now: Date;
  name: string | null;
}) {
  const { lifetime, yearOverYear, records } = data;
  const currentYear = now.getUTCFullYear();

  // Distance is computed in km server-side (haversineKm); convert to the
  // operator-chosen display unit here, before render. Var unset → km.
  // Laps of the Earth always count in km.
  const unit = getDistanceUnit();
  const since = tripsSince(yearOverYear);

  return (
    <div className="flex flex-col gap-11 md:gap-[4.5rem]">
      <div className="atlas-rise" style={{ animationDelay: '120ms' }}>
        <LifetimePass
          data={{
            countries: groupDigits(lifetime.countriesVisited),
            countriesWord: plural(lifetime.countriesVisited, 'country', 'countries'),
            nights: groupDigits(lifetime.nightsAway),
            nightsWord: `${plural(lifetime.nightsAway, 'night')} away`,
            flights: groupDigits(lifetime.flightsTaken),
            flightsWord: plural(lifetime.flightsTaken, 'flight'),
            newestCountry: lifetime.newestCountry
              ? `${lifetime.newestCountry.name}, ${shortMonthYear(lifetime.newestCountry.firstVisitAt)}`
              : null,
            timeOnTheRoad: timeOnTheRoad(lifetime.nightsAway),
            distance: groupDigits(convertDistance(lifetime.distanceFlownKm, unit)),
            distanceWord: unit === 'mi' ? 'miles flown' : 'km flown',
            earthLaps: earthLaps(lifetime.distanceFlownKm),
            firstName: firstName(name),
            tripsSince: since
              ? `${groupDigits(since.trips)} ${plural(since.trips, 'trip')} since ${since.since}`
              : null,
            barcode: layoutBarcode(yearOverYear.tripsPerYear, currentYear),
          }}
        />
      </div>

      <div className="atlas-rise" style={{ animationDelay: '220ms' }}>
        <YearTickets rows={buildYearRows(yearOverYear, currentYear)} />
      </div>

      <div className="atlas-rise" style={{ animationDelay: '320ms' }}>
        <RecordTickets records={records} />
      </div>
    </div>
  );
}

/**
 * Shown when nothing has happened yet — no trips at all, or only trips
 * still upcoming. Keeps the page from looking broken on a fresh install
 * and spares a future-only dashboard from being a wall of zeros; the
 * tallies only ever count what has already happened.
 */
function EmptyState() {
  return (
    <Card
      variant="paper"
      className="atlas-rise flex flex-col overflow-hidden sm:flex-row"
      style={{ animationDelay: '120ms' }}
    >
      <div className="ticket-stub bg-muted text-muted-foreground flex h-14 shrink-0 items-center px-5 [--color-perforation:var(--color-input)] sm:h-auto sm:w-36 sm:justify-center">
        <span
          aria-hidden
          className="border-foreground/25 inline-flex size-10 items-center justify-center rounded-full border font-mono text-sm"
        >
          ø
        </span>
      </div>
      <div className="flex min-h-48 flex-col justify-center px-5 py-8 sm:px-8 sm:py-12">
        <p className="text-foreground text-2xl font-bold tracking-[-0.02em]">
          Nothing to tally yet.
        </p>
        <p className="text-muted-foreground mt-2 max-w-md text-[0.9375rem] leading-relaxed">
          Log a trip with a few flights and hotels, and this page fills in on its own — countries,
          nights away, distance flown, and the records that come with them.
        </p>
      </div>
    </Card>
  );
}
