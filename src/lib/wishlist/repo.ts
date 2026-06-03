import { and, desc, eq, inArray, notExists } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  segments,
  trips,
  users,
  wishlistItems,
  type WishlistItem,
  type Segment,
} from '@/db/schema';

import { tripVisibleToViewer } from '@/lib/trips/repo';

import type {
  WishlistItemCreateInput,
  WishlistItemUpdateInput,
  WishlistListFilters,
} from './validators';

// Re-exported so the feature barrel can surface the row type without
// the consumer reaching into @/db/*.
export type { WishlistItem };

// Personal-app cap. The whole point of the wishlist is reuse over
// years — if a household pushes past this, switch to cursored
// pagination on (createdAt, id).
const LIST_LIMIT = 500 as const;

// All wishlist items, household-shared. Filters by type and / or
// country. No `createdBy` filter — provenance only, not auth.
export async function list(filters: WishlistListFilters = {}): Promise<WishlistItem[]> {
  const conditions = [];
  if (filters.type) conditions.push(eq(wishlistItems.type, filters.type));
  if (filters.countryCode) conditions.push(eq(wishlistItems.countryCode, filters.countryCode));

  return db
    .select()
    .from(wishlistItems)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(wishlistItems.createdAt))
    .limit(LIST_LIMIT);
}

export interface SuggestionFilter {
  /**
   * When set, exclude wishlist items already materialised as a segment
   * on this trip. The user explicitly required "if I add it to one
   * trip, keep suggesting it on a DIFFERENT trip" — so the exclusion
   * is per-trip, not per-item.
   */
  excludeMaterialisedOnTrip?: string;
  /** Restrict to a single wishlist type — drives the per-tab panels. */
  type?: WishlistItem['type'];
}

// Suggestions panel query: items in any of the trip's countries,
// optionally excluding items already added to *this* trip. Same item
// keeps appearing on every other trip that touches one of these
// countries — that's the load-bearing reusability requirement.
export async function listForCountries(
  countryCodes: readonly string[],
  filter: SuggestionFilter = {},
): Promise<WishlistItem[]> {
  if (countryCodes.length === 0) return [];

  const conditions = [inArray(wishlistItems.countryCode, [...countryCodes])];

  if (filter.type) conditions.push(eq(wishlistItems.type, filter.type));

  if (filter.excludeMaterialisedOnTrip) {
    // NOT EXISTS anti-join — proper shape for a "rows without a match"
    // exclusion. NOT IN on a nullable column (segments.wishlistItemId)
    // collapses the whole predicate to UNKNOWN if any subquery row is
    // NULL; NOT EXISTS doesn't have that footgun. The planner also
    // recognises the anti-join and can use the partial index on
    // (wishlist_item_id) WHERE NOT NULL more freely than with NOT IN.
    const tripId = filter.excludeMaterialisedOnTrip;
    conditions.push(
      notExists(
        db
          .select({ one: segments.id })
          .from(segments)
          .where(and(eq(segments.tripId, tripId), eq(segments.wishlistItemId, wishlistItems.id))),
      ),
    );
  }

  return db
    .select()
    .from(wishlistItems)
    .where(and(...conditions))
    .orderBy(desc(wishlistItems.createdAt))
    .limit(LIST_LIMIT);
}

export async function getById(id: string): Promise<WishlistItem | null> {
  const [row] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, id)).limit(1);
  return row ?? null;
}

export async function create(
  createdBy: string,
  input: WishlistItemCreateInput,
): Promise<WishlistItem> {
  const [row] = await db
    .insert(wishlistItems)
    .values({
      type: input.type,
      countryCode: input.countryCode,
      locationName: input.locationName ?? null,
      notes: input.notes ?? null,
      tags: input.tags,
      data: input.data,
      createdBy,
    })
    .returning();
  if (!row) throw new Error('Wishlist insert returned no row');
  return row;
}

export async function update(id: string, input: WishlistItemUpdateInput): Promise<WishlistItem> {
  const [row] = await db
    .update(wishlistItems)
    .set({
      type: input.type,
      countryCode: input.countryCode,
      locationName: input.locationName ?? null,
      notes: input.notes ?? null,
      tags: input.tags,
      data: input.data,
      updatedAt: new Date(),
    })
    .where(eq(wishlistItems.id, id))
    .returning();
  if (!row) throw new Error('WISHLIST_ITEM_NOT_FOUND');
  return row;
}

// Hard delete. Materialised segments survive via ON DELETE SET NULL
// on segments.wishlistItemId — see schema.
export async function remove(id: string): Promise<void> {
  await db.delete(wishlistItems).where(eq(wishlistItems.id, id));
}

// Materialise a wishlist item onto a trip as an undated segment.
// Two-step writeshape kept simple for one personal user: load the
// item, verify trip ownership, insert. If we ever see contention
// across the household this should move into a transaction.
//
// `startsAt = NULL` is the ADR-0003 wishlist convention — activity
// rows with no date show up under the Activities-tab Wishlist
// subsection; food rows show up at the tail of the Food tab. The
// user dates them via the existing "promote with a date" flow.
//
// `data` is a verbatim copy of the wishlist item's data — the per-
// type Zod shapes are isomorphic, no field-name translation. The
// `wishlistItemId` FK records provenance for the suggestions-panel
// "already added to this trip" exclusion.
export interface MaterialisedResult {
  segment: Segment;
  item: WishlistItem;
}

export async function materialiseOnTrip(
  userId: string,
  itemId: string,
  tripId: string,
): Promise<MaterialisedResult> {
  // Single transaction so a concurrent delete between the item read
  // and the segment insert can't leave a segment pointing at a row
  // that's about to be removed. Trip access uses tripVisibleToViewer
  // (ADR-0015): materialising a wishlist place onto a trip is a content
  // write, so a household member can drop a pick onto a shared trip.
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), tripVisibleToViewer(userId)))
      .limit(1);
    if (!owned) throw new Error('TRIP_NOT_FOUND');

    const [item] = await tx
      .select()
      .from(wishlistItems)
      .where(eq(wishlistItems.id, itemId))
      .limit(1);
    if (!item) throw new Error('WISHLIST_ITEM_NOT_FOUND');

    const [segment] = await tx
      .insert(segments)
      .values({
        tripId,
        type: item.type,
        data: item.data,
        startsAt: null,
        endsAt: null,
        locationName: item.locationName,
        countryCode: item.countryCode,
        originCountryCode: null,
        wishlistItemId: item.id,
      })
      .returning();
    if (!segment) throw new Error('Segment insert returned no row');
    return { segment, item };
  });
}

// Returns countries that have at least one wishlist item. Used by the
// /wishlist page's country filter chips — only surface countries that
// can actually filter the list.
export async function listCountriesWithItems(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ countryCode: wishlistItems.countryCode })
    .from(wishlistItems);
  return rows.map((r) => r.countryCode).sort();
}

// Builds a userId → display-name map for the "added by …" tag on
// wishlist cards. Falls back to email local-part for users without
// a `name`, matching the dashboard's first-name greeting rule. The
// page reads this and merges it with the wishlist rows itself —
// trying to JOIN the lookup into `list()` would either eager-load
// users on every list query or force a second roundtrip the page
// already pays for.
export async function listUserDisplayNames(): Promise<Map<string, string>> {
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const out = new Map<string, string>();
  for (const u of rows) {
    // split('…') always returns ≥ 1 element; the ?? '' is defensive
    // against `noUncheckedIndexedAccess` and never actually fires.
    const first = u.name?.split(' ')[0] ?? u.email.split('@')[0] ?? u.email;
    out.set(u.id, first);
  }
  return out;
}
