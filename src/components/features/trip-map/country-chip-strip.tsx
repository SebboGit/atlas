import Link from 'next/link';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import { cn } from '@/lib/utils';

interface CountryChipStripProps {
  countries: Array<{ code: string; name: string }>;
  activeCountry: string | null;
  tripId: string;
}

/**
 * URL-driven country filter. Chips are real links to
 * `/trips/:id/map?country=XX` so browser back/forward + shared links
 * round-trip the filter without client-state plumbing.
 *
 * Only rendered when the trip touched 2+ countries — see TripMap.
 */
export function CountryChipStrip({ countries, activeCountry, tripId }: CountryChipStripProps) {
  const baseHref = `/trips/${tripId}/map`;
  const allActive = activeCountry === null;

  return (
    <ScrollTabStrip
      ariaLabel="Filter by country"
      activeKey={activeCountry ?? '__all__'}
      className="atlas-rise mb-4 gap-1.5"
      style={{ animationDelay: '80ms' }}
    >
      <Chip href={baseHref} active={allActive}>
        <span>All</span>
      </Chip>
      {countries.map((c) => {
        const active = activeCountry === c.code;
        return (
          // encodeURIComponent matches the trip-tabs pattern. ISO codes
          // are safe ASCII today, but consistent encoding keeps a future
          // free-form filter value from becoming a foot-gun.
          <Chip
            key={c.code}
            href={`${baseHref}?country=${encodeURIComponent(c.code)}`}
            active={active}
          >
            <span className="truncate">{c.name}</span>
            <span
              className={cn(
                'font-mono text-[10px] tracking-[0.18em]',
                // Mono code suffix gives chips the same texture as
                // CountrySelect options — recognisably "this is the
                // ISO code", quietly de-emphasised when inactive.
                active ? 'text-primary-foreground/70' : 'text-foreground/40',
              )}
            >
              {c.code}
            </span>
          </Chip>
        );
      })}
    </ScrollTabStrip>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-active={active || undefined}
      // Min height keeps the chip touch-friendly at 360px without
      // forcing the row to wrap on laptop.
      className={cn(
        'inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors sm:min-h-[36px]',
        active
          ? 'bg-primary text-primary-foreground border-primary shadow-[0_2px_8px_-3px_rgba(155,74,38,0.5)]'
          : 'border-foreground/12 bg-card/60 text-foreground/75 hover:border-foreground/25 hover:text-foreground hover:bg-card/85',
      )}
      aria-current={active ? 'true' : undefined}
    >
      {children}
    </Link>
  );
}
