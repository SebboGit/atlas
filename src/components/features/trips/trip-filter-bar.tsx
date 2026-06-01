'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import { cn } from '@/lib/utils';

interface TripFilterBarProps {
  countries: { code: string; name: string }[];
}

// Country filter bar. The layout auto-hides this below two countries (see
// ADR-0004); re-checked here as a safety net. Chips read the full country
// name (resolved server-side in the layout) so the control says
// "United Kingdom", not a bare "GB"; the filter value stays the code.
export function TripFilterBar({ countries }: TripFilterBarProps) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const active = sp.get('country')?.toUpperCase() ?? null;

  if (countries.length < 2) return null;

  const buildHref = (code: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (code) params.set('country', code);
    else params.delete('country');
    const q = params.toString();
    return q ? `${pathname}?${q}` : (pathname ?? '/');
  };

  return (
    <ScrollTabStrip ariaLabel="Filter by country" activeKey={active ?? '__all__'} className="gap-2">
      <span className="text-foreground/55 mr-1 shrink-0 self-center font-mono text-[10px] tracking-[0.2em] uppercase">
        Country
      </span>
      <FilterChip href={buildHref(null)} active={!active}>
        All
      </FilterChip>
      {countries.map(({ code, name }) => (
        <FilterChip key={code} href={buildHref(code)} active={active === code}>
          {name}
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
        // 44px floor on every viewport — tablet-sized touch devices hit
        // `sm:` but are still touch-input.
        'inline-flex min-h-11 shrink-0 snap-start items-center rounded-full border px-3.5 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-[0_6px_16px_-10px_hsl(18_52%_36%/0.7)]'
          : 'border-foreground/20 bg-card/50 text-foreground/70 hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
