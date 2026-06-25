import { ChartColumn, Map as MapIcon, Plane, Star } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';

// Mobile-only home quick-nav. The laptop SectionTile grid is hidden on phone
// (its index badge, eyebrow, and ruled edge are all sm:-gated, so it collapses
// to bare title cards) — but a tap-to-jump 2×2 grid reads like an app. Trips
// lives in the next-trip hero on laptop; here it gets its own tile to the full
// trip list. Laptop keeps the three-tile SectionTile grid unchanged.
const TILES = [
  { href: '/trips', label: 'Trips', Icon: Plane },
  { href: '/wishlist', label: 'Wishlist', Icon: Star },
  { href: '/map', label: 'Map', Icon: MapIcon },
  { href: '/stats', label: 'Stats', Icon: ChartColumn },
] as const;

export function MobileNavGrid() {
  return (
    <section
      className="atlas-rise mt-6 grid grid-cols-2 gap-3 sm:hidden"
      style={{ animationDelay: '320ms' }}
    >
      {TILES.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="focus-visible:ring-primary/40 focus-visible:ring-offset-background block rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Card variant="glass" className="flex min-h-[5.5rem] flex-col justify-between gap-3 p-4">
            <Icon aria-hidden className="text-primary h-5 w-5" strokeWidth={1.5} />
            <span className="heading-card">{label}</span>
          </Card>
        </Link>
      ))}
    </section>
  );
}
