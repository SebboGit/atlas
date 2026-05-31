'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import { cn } from '@/lib/utils';

interface TripFilterBarProps {
  codes: string[];
}

// Country filter bar. The layout auto-hides this when the trip spans
// fewer than two countries (see ADR-0004), but we re-check here as a
// safety net. The trip layout also doesn't render this on the map
// route — the focused map chrome strips everything but back / title /
// dates — so a per-pathname guard here would be belt-and-braces.
export function TripFilterBar({ codes }: TripFilterBarProps) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const active = sp.get('country')?.toUpperCase() ?? null;

  if (codes.length < 2) return null;

  const buildHref = (code: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (code) params.set('country', code);
    else params.delete('country');
    const q = params.toString();
    return q ? `${pathname}?${q}` : (pathname ?? '/');
  };

  return (
    <ScrollTabStrip
      ariaLabel="Filter by country"
      activeKey={active ?? '__all__'}
      className="gap-1.5"
    >
      <span className="text-foreground/45 mr-1 shrink-0 self-center font-mono text-[9px] tracking-[0.24em] uppercase">
        Country
      </span>
      <FilterChip href={buildHref(null)} active={!active}>
        All
      </FilterChip>
      {codes.map((code) => (
        <FilterChip key={code} href={buildHref(code)} active={active === code}>
          {code}
        </FilterChip>
      ))}
    </ScrollTabStrip>
  );
}

function FilterChip({
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
      // Filter tweaks shouldn't pollute browser history (ADR-0004).
      replace
      className={cn(
        'inline-flex shrink-0 snap-start items-center rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.2em] uppercase transition-colors',
        // 44 px floor on every viewport — tablet-sized touch devices hit
        // `sm:` but are still touch-input.
        'min-h-11',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-foreground/20 text-foreground/70 hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
