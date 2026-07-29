// Text derivation shared by every surface that renders a wishlist item:
// the card on /wishlist, the suggestion rows on a trip's Food /
// Activities tabs, and the read-only info dialog behind those rows.
//
// Pure and React-free, in its own module rather than exported from
// wishlist-card.tsx, because that file transitively imports the form
// dialog → server actions → auth, which a unit test can't load. Same
// reason the three consumers share it: a trigger's aria-label and the
// dialog title it opens must never disagree.

import { activityDataSchema, foodDataSchema } from '@/lib/segments';
import type { WishlistItem } from '@/lib/wishlist';

/**
 * The headline name — venue for food, title for an activity. Falls back
 * to a generic noun if the JSONB is malformed; the validator enforces
 * the shape on write, so this is a defensive read, not an expected path.
 */
export function wishlistItemName(item: WishlistItem): string {
  if (item.type === 'food') {
    const parsed = foodDataSchema.safeParse(item.data);
    return parsed.success ? parsed.data.venue : 'Food spot';
  }
  const parsed = activityDataSchema.safeParse(item.data);
  return parsed.success ? parsed.data.title : 'Attraction';
}

/**
 * The secondary descriptor — the card's detail line. Food shows its
 * address, an activity its description and failing that its address:
 * `activityDataSchema` has carried one since Plus Codes landed, and it
 * was the only place-bearing field the card never rendered.
 *
 * Deliberately NOT falling back to `locationName`. The card's meta row
 * already prints it, so the old fallback rendered it twice on every
 * item without an address ("Jingūmae" under "Den", then "Japan ·
 * Jingūmae").
 */
export function wishlistSubtitle(item: WishlistItem): string | undefined {
  if (item.type === 'food') {
    const parsed = foodDataSchema.safeParse(item.data);
    return (parsed.success ? parsed.data.address : undefined) || undefined;
  }
  const parsed = activityDataSchema.safeParse(item.data);
  if (!parsed.success) return undefined;
  return parsed.data.description || parsed.data.address || undefined;
}

/** The item's street address, when it has one. Used by the info dialog. */
export function wishlistAddress(item: WishlistItem): string | undefined {
  const schema = item.type === 'food' ? foodDataSchema : activityDataSchema;
  const parsed = schema.safeParse(item.data);
  return (parsed.success ? parsed.data.address : undefined) || undefined;
}

/** The item's stored Plus Code, when it has one. Used by the info dialog. */
export function wishlistPlusCode(item: WishlistItem): string | undefined {
  const schema = item.type === 'food' ? foodDataSchema : activityDataSchema;
  const parsed = schema.safeParse(item.data);
  return (parsed.success ? parsed.data.plusCode : undefined) || undefined;
}
