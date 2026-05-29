import { RecordsPanel } from '@/components/features/stats/records-panel';
import { StatTile } from '@/components/features/stats/stat-tile';
import { YearStrip } from '@/components/features/stats/year-strip';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { getStatsDashboardData } from '@/lib/stats';
import { convertDistance, getDistanceUnit, groupDigits, monthYear } from '@/lib/stats/format';

export const metadata = {
  title: 'Stats · Atlas',
};

export default async function StatsPage() {
  const user = await requireUser();
  // currentUserId is threaded through every stats query. Today the
  // visibility predicate inside the repo is a no-op (full household
  // sharing) — see src/lib/stats/visibility.ts.
  const { lifetime, yearOverYear, records, isEmpty } = await getStatsDashboardData(user.id);

  const stampDate = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();

  // Distance is computed in km server-side (haversineKm); convert to the
  // operator-chosen display unit here, before render. Var unset → km.
  const distanceUnit = getDistanceUnit();
  const distanceFlown = convertDistance(lifetime.distanceFlownKm, distanceUnit);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-8 pb-24 sm:px-8 sm:pt-20">
      <header className="atlas-rise mb-8" style={{ animationDelay: '20ms' }}>
        <p className="text-muted-foreground mb-4 hidden items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase sm:flex">
          <span aria-hidden className="bg-foreground/30 h-px w-8" />
          <span>Logbook · {stampDate}</span>
        </p>
        <h1 className="font-display text-foreground text-5xl leading-[1.02] font-medium tracking-tight sm:text-6xl">
          The tally so far.
        </h1>
      </header>

      <div className="atlas-rule mb-10" aria-hidden />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-12">
          {/* ── Lifetime headline — 2×2 on phone, single row on laptop ── */}
          <section
            className="atlas-rise grid grid-cols-2 gap-5 lg:grid-cols-4"
            style={{ animationDelay: '120ms' }}
          >
            <StatTile
              label="Countries"
              value={String(lifetime.countriesVisited)}
              caption={
                lifetime.newestCountry
                  ? `Newest: ${lifetime.newestCountry.name}, ${monthYear(
                      lifetime.newestCountry.firstVisitAt,
                    )}.`
                  : undefined
              }
            />
            <StatTile
              label="Nights away"
              value={groupDigits(lifetime.nightsAway)}
              caption="Across all hotel stays."
            />
            <StatTile
              label="Flights"
              value={groupDigits(lifetime.flightsTaken)}
              caption="Counted by leg."
            />
            <StatTile
              label="Distance flown"
              value={groupDigits(distanceFlown)}
              unit={distanceUnit}
              caption="Great-circle distance between airports."
            />
          </section>

          {/* ── Year over year — three strips, 3-col on laptop ── */}
          <section className="atlas-rise flex flex-col gap-5" style={{ animationDelay: '220ms' }}>
            <p className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
              Year by year
            </p>
            <div className="grid gap-5 lg:grid-cols-3">
              <YearStrip label="Trips" tallies={yearOverYear.tripsPerYear} accent="primary" />
              <YearStrip label="Nights away" tallies={yearOverYear.nightsPerYear} accent="accent" />
              <YearStrip
                label="New countries"
                tallies={yearOverYear.newCountriesPerYear}
                accent="primary"
              />
            </div>
          </section>

          {/* ── Personal records ── */}
          <section className="atlas-rise" style={{ animationDelay: '320ms' }}>
            <RecordsPanel records={records} />
          </section>
        </div>
      )}
    </main>
  );
}

/**
 * Shown when the user has no trips at all. Keeps the page from looking
 * broken on a fresh install — the dashboard earns its content from
 * logged trips, so there's nothing to tally yet.
 */
function EmptyState() {
  return (
    <Card variant="glass" className="atlas-rise" style={{ animationDelay: '120ms' }}>
      <CardContent className="flex min-h-64 flex-col items-center justify-center px-6 py-14 text-center">
        <span
          aria-hidden
          className="border-foreground/25 text-foreground/70 mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.2em]"
        >
          ø
        </span>
        <p className="font-display text-foreground text-2xl tracking-tight">
          Nothing to tally yet.
        </p>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
          Log a trip with a few flights and hotels, and this page fills in on its own — countries,
          nights away, distance flown, and the records that come with them.
        </p>
      </CardContent>
    </Card>
  );
}
