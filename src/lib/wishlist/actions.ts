'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { geocodeOnSegmentChange } from '@/lib/geocoding';
import { err, ok, type Result } from '@/types/result';

import { geocodeOnWishlistChange } from './geocoding';
import * as repo from './repo';
import { wishlistItemCreateInput, wishlistItemUpdateInput } from './validators';

// Same shape as trips/segments actions so the RHF setError adapter
// can be reused without translation.
export type FormError = {
  formMessage?: string;
  fields?: Record<string, string>;
};

function flattenZod(error: z.ZodError): FormError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (key && fields[key] === undefined) fields[key] = issue.message;
  }
  return { fields, formMessage: 'Please fix the highlighted fields.' };
}

function revalidateWishlist() {
  revalidatePath('/wishlist');
}

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`, 'layout');
}

export async function createWishlistItemAction(
  raw: unknown,
): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const parsed = wishlistItemCreateInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  const item = await repo.create(user.id, parsed.data);
  geocodeOnWishlistChange({ item });
  revalidateWishlist();
  return ok({ id: item.id });
}

// Update an existing wishlist item. The action layer locks the `type`
// once set — switching food↔activity would require migrating `data`
// shape and orphans the suggestions filter. The form blocks the type
// switch in the UI; this is defence in depth.
export async function updateWishlistItemAction(
  itemId: string,
  raw: unknown,
): Promise<Result<{ id: string }, FormError>> {
  await requireUser();
  const parsed = wishlistItemUpdateInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  const existing = await repo.getById(itemId);
  if (!existing) return err({ formMessage: 'Wishlist item not found.' });
  if (existing.type !== parsed.data.type) {
    return err({ formMessage: 'Wishlist item type cannot be changed after creation.' });
  }

  try {
    const updated = await repo.update(itemId, parsed.data);
    geocodeOnWishlistChange({ item: updated, prior: existing });
    revalidateWishlist();
    return ok({ id: updated.id });
  } catch (e) {
    if (e instanceof Error && e.message === 'WISHLIST_ITEM_NOT_FOUND') {
      return err({ formMessage: 'Wishlist item not found.' });
    }
    throw e;
  }
}

export async function deleteWishlistItemAction(
  itemId: string,
): Promise<Result<{ id: string }, FormError>> {
  await requireUser();

  const existing = await repo.getById(itemId);
  if (!existing) return err({ formMessage: 'Wishlist item not found.' });

  await repo.remove(itemId);
  revalidateWishlist();
  // Trip pages that surface suggestions need to refresh too — the
  // simplest correct invalidation is the wishlist route plus any
  // currently-open trip (the panel reads at render time and goes
  // stale otherwise). The next trip render picks up the change.
  revalidatePath('/trips', 'layout');
  return ok({ id: itemId });
}

// Materialise a wishlist item onto a trip as an undated segment of
// the matching type. The new segment shows up under the trip-level
// wishlist UI (Activities-tab Wishlist subsection / Food-tab tail)
// for the user to date later. Suggestions panel on this trip will
// stop offering the item; the same item still surfaces on OTHER
// trips that touch its country.
export async function addWishlistItemToTripAction(
  itemId: string,
  tripId: string,
): Promise<Result<{ segmentId: string }, FormError>> {
  const user = await requireUser();

  try {
    const { segment } = await repo.materialiseOnTrip(user.id, itemId, tripId);
    // Reuse the segment-side geocode lifecycle — the cache layer keys
    // off the per-type query string, so the new segment immediately
    // shares the wishlist item's cached coords (same query, same key).
    geocodeOnSegmentChange({ segment });
    revalidateTrip(tripId);
    revalidateWishlist();
    return ok({ segmentId: segment.id });
  } catch (e) {
    if (e instanceof Error && e.message === 'TRIP_NOT_FOUND') {
      return err({ formMessage: 'Trip not found.' });
    }
    if (e instanceof Error && e.message === 'WISHLIST_ITEM_NOT_FOUND') {
      return err({ formMessage: 'Wishlist item not found.' });
    }
    throw e;
  }
}
