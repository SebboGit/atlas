import { Sparkles } from 'lucide-react';

import { GeocodePoller } from '@/components/features/segments/geocode-poller';
import { WishlistCard } from '@/components/features/wishlist/wishlist-card';
import { WishlistFilters } from '@/components/features/wishlist/wishlist-filters';
import { WishlistFormDialog } from '@/components/features/wishlist/wishlist-form-dialog';
import { SectionEyebrow } from '@/components/section-eyebrow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { getPlaceCoordsView } from '@/lib/geocoding';
import * as repo from '@/lib/wishlist/repo';
import { WISHLIST_ITEM_TYPES, type WishlistItemType } from '@/lib/wishlist';

export const dynamic = 'force-dynamic';

interface WishlistPageProps {
  searchParams: Promise<{ type?: string; country?: string }>;
}

function parseType(raw: string | undefined): WishlistItemType | null {
  if (!raw) return null;
  return (WISHLIST_ITEM_TYPES as readonly string[]).includes(raw)
    ? (raw as WishlistItemType)
    : null;
}

function parseCountry(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  return t.length === 2 ? t : null;
}

export default async function WishlistPage({ searchParams }: WishlistPageProps) {
  await requireUser();
  const { type: rawType, country: rawCountry } = await searchParams;
  const activeType = parseType(rawType);
  const activeCountry = parseCountry(rawCountry);

  // Three datasets: the filtered list (what we render), per-type counts
  // for the chip labels (counted server-side from a separate cheap
  // query — both indexes lit), and the country list for the chip
  // strip. All household-shared.
  const [items, allItems, countriesWithItems, nameById] = await Promise.all([
    repo.list({
      type: activeType ?? undefined,
      countryCode: activeCountry ?? undefined,
    }),
    repo.list(),
    repo.listCountriesWithItems(),
    repo.listUserDisplayNames(),
  ]);

  const counts = {
    all: allItems.length,
    food: allItems.filter((i) => i.type === 'food').length,
    activity: allItems.filter((i) => i.type === 'activity').length,
  };

  // WishlistItem satisfies PlaceLike (type/data/locationName) — same
  // chain as segments, single round-trip against geocode_cache.
  const { coordsById, pendingCount } = await getPlaceCoordsView(items);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-8 pb-24 sm:px-8 sm:pt-20">
      <header className="atlas-rise mb-8" style={{ animationDelay: '40ms' }}>
        <SectionEyebrow>Section 02 · Wishlist</SectionEyebrow>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h1 className="heading-page">Wishlist.</h1>
          <WishlistFormDialog trigger={<Button size="default">New wishlist item</Button>} />
        </div>
      </header>

      <div className="atlas-rule-double mb-8" aria-hidden />

      <div className="atlas-rise mb-8" style={{ animationDelay: '100ms' }}>
        <WishlistFilters
          activeType={activeType}
          activeCountry={activeCountry}
          countriesWithItems={countriesWithItems}
          counts={counts}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState filtered={!!activeType || !!activeCountry} />
      ) : (
        <ul className="atlas-rise grid gap-5 sm:grid-cols-2" style={{ animationDelay: '160ms' }}>
          {items.map((item) => (
            <li key={item.id}>
              <WishlistCard
                item={item}
                addedByLabel={nameById.get(item.createdBy) ?? null}
                coords={coordsById.get(item.id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      <GeocodePoller pending={pendingCount} />
    </main>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <Card variant="glass" className="atlas-rise relative overflow-hidden">
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <div
          aria-hidden
          className="border-foreground/25 text-foreground/65 inline-flex h-12 w-12 items-center justify-center rounded-full border"
        >
          <Sparkles className="size-5" strokeWidth={1.5} />
        </div>
        <h2 className="font-display text-foreground text-2xl font-medium tracking-tight">
          {filtered ? 'Nothing matches.' : 'Empty wishlist.'}
        </h2>
        <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
          {filtered
            ? 'Try a different filter, or clear them all to see everything.'
            : 'Drop a place worth coming back to.'}
        </p>
        {!filtered && <WishlistFormDialog trigger={<Button size="sm">Add your first</Button>} />}
      </CardContent>
    </Card>
  );
}
