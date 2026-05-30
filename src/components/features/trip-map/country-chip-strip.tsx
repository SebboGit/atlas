'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import { cn } from '@/lib/utils';

interface CountryChipStripProps {
  countries: Array<{ code: string; name: string }>;
  activeCountry: string | null;
  tripId: string;
}

/**
 * URL-driven country filter. Chips are real links so browser
 * back/forward + shared links round-trip the filter without
 * client-state plumbing. Each chip MERGES into the live query string
 * (set/delete only `country`), preserving the timeline's `?day=` focus
 * so the spatial and temporal controls compose in BOTH directions —
 * mirroring ChronoTripMap.writeDay. `replace` (like the day focus)
 * keeps a filter tweak from stacking history entries.
 *
 * Only rendered when the trip touched 2+ countries — see TripMap.
 */
export function CountryChipStrip({ countries, activeCountry, tripId }: CountryChipStripProps) {
  const pathname = usePathname() ?? `/trips/${tripId}/map`;
  const searchParams = useSearchParams();
  const allActive = activeCountry === null;

  // Build an href that keeps every existing param (notably `?day=`) and
  // only sets/deletes `country`.
  const hrefFor = (code: string | null): string => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (code) params.set('country', code);
    else params.delete('country');
    const q = params.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  return (
    <ScrollTabStrip
      ariaLabel="Filter by country"
      activeKey={activeCountry ?? '__all__'}
      className="atlas-rise mb-4 gap-1.5"
      style={{ animationDelay: '80ms' }}
    >
      <Chip href={hrefFor(null)} active={allActive}>
        <span>All</span>
      </Chip>
      {countries.map((c) => {
        const active = activeCountry === c.code;
        return (
          <Chip key={c.code} href={hrefFor(c.code)} active={active}>
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
      replace
      data-active={active || undefined}
      // 44 px floor keeps the chip touch-friendly on every viewport.
      // Tablet-sized touch devices (768–1024 px) hit `sm:` but are
      // still touch-input, so we don't shrink the target at `sm:`.
      className={cn(
        'inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
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
