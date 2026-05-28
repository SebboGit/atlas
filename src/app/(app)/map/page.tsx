import { ManageCountriesPopover } from '@/components/features/map/manage-countries-popover';
import { WorldMap } from '@/components/features/map/world-map';
import { requireUser } from '@/lib/auth/session';
import { countryName } from '@/lib/countries';
import {
  listManualVisitedCountriesForUser,
  listVisitedCountriesForUser,
} from '@/lib/countries/repo';

export const metadata = {
  title: 'Map · Atlas',
};

export default async function MapPage() {
  const user = await requireUser();
  const [visited, manualCodes] = await Promise.all([
    listVisitedCountriesForUser(user.id),
    listManualVisitedCountriesForUser(user.id),
  ]);

  // Name lookup runs on the server so the client bundle stays free of
  // the ISO_COUNTRIES list.
  const enriched = visited.map((v) => ({ ...v, name: countryName(v.code) ?? v.code }));
  const totalCountries = enriched.length;

  return (
    // /map intentionally runs tighter top padding + smaller heading
    // than the other pages so the world map fits the laptop viewport
    // without scrolling. The other sections scroll naturally and keep
    // the standard generous header.
    <main className="mx-auto w-full max-w-6xl px-6 pt-8 pb-24 sm:px-8 sm:pt-10">
      <header className="atlas-rise mb-5" style={{ animationDelay: '40ms' }}>
        <p className="text-muted-foreground mb-3 hidden items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase sm:flex">
          <span aria-hidden className="bg-foreground/30 h-px w-8" />
          <span>Section 03 · Map</span>
        </p>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h1 className="font-display text-foreground text-4xl leading-[1.02] font-medium tracking-tight sm:text-5xl">
            Where you&apos;ve been.
          </h1>
          <div className="flex items-center gap-5">
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase">
              {totalCountries} {totalCountries === 1 ? 'country' : 'countries'}
            </p>
            <ManageCountriesPopover manualCodes={manualCodes} />
          </div>
        </div>
      </header>

      <div className="atlas-rule mb-5" aria-hidden />

      <div className="atlas-rise" style={{ animationDelay: '160ms' }}>
        <WorldMap visited={enriched} />
      </div>

      <p
        className="text-muted-foreground atlas-rise mt-6 text-center font-mono text-[10px] tracking-[0.2em] uppercase"
        style={{ animationDelay: '220ms' }}
      >
        Map data © OpenStreetMap contributors · Country shapes © Natural Earth
      </p>

      {totalCountries === 0 && (
        <p
          className="text-muted-foreground atlas-rise mt-10 text-center text-sm"
          style={{ animationDelay: '280ms' }}
        >
          No countries on the map yet. Log a trip with a flight or hotel and the country will light
          up here.
        </p>
      )}
    </main>
  );
}
