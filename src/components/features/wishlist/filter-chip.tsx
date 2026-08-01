import Link from 'next/link';

import { cn } from '@/lib/utils';

// The filter pill shared by the wishlist's type row and its country row.
// Extracted so the two can't drift: the country row is a client island
// (it holds the search query) while the type row stays a server
// component, and duplicating the class string across that boundary is
// exactly how two rows of "the same" chips end up looking different.
export function FilterChipLink({
  href,
  active,
  children,
  count,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // items-center (not baseline): with a 44px min-height touch target,
        // baseline alignment parked the label + count at the top of the
        // pill; centring keeps them vertically middled.
        'inline-flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
        // Tap target on touch per CLAUDE.md.
        'min-h-11',
        // Hover gated to pointer devices (rule 4) so it doesn't stick on tap.
        active
          ? 'border-foreground/45 bg-foreground/8 text-foreground'
          : 'border-foreground/15 text-foreground/70 [@media(hover:hover)]:hover:border-foreground/30 [@media(hover:hover)]:hover:text-foreground',
      )}
    >
      <span>{children}</span>
      {typeof count === 'number' && (
        <span className="text-foreground/60 font-mono text-[10px] tracking-wider">
          {String(count).padStart(2, '0')}
        </span>
      )}
    </Link>
  );
}
