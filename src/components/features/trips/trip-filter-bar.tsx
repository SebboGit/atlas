'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

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
    <div
      role="group"
      aria-label="Filter by country"
      className="flex flex-wrap items-center gap-1.5"
    >
      <span className="text-foreground/45 mr-1 font-mono text-[9px] tracking-[0.24em] uppercase">
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
    </div>
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
      // Filter tweaks shouldn't pollute browser history (ADR-0004).
      replace
      className={cn(
        'rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.2em] uppercase transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-foreground/20 text-foreground/65 hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
