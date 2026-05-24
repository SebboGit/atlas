import { z } from 'zod';

import { activityDataSchema, foodDataSchema } from '@/lib/segments';

// Mirrors the `wishlist_item_type` Postgres enum.
export const WISHLIST_ITEM_TYPES = ['food', 'activity'] as const;
export const wishlistItemTypeEnum = z.enum(WISHLIST_ITEM_TYPES);
export type WishlistItemType = z.infer<typeof wishlistItemTypeEnum>;

// ISO 3166-1 alpha-2. Mirrors segments/validators.ts handling, but
// **non-nullable** here — wishlist items are useless without a country
// (the suggestions panel filter is country-scoped). Empty / whitespace
// input fails refinement so the form surfaces the error.
const countryCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => s.length === 2, 'Choose a country');

// Common fields shared across types. `locationName` is the pin-style
// label (e.g. "Ginza"), NOT the venue or attraction name — same role
// as on segments. `tags` is a free-form string array; the form
// dedupes and lowercases.
const commonFields = z.object({
  countryCode,
  locationName: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .optional()
    .transform((arr) => {
      if (!arr) return [];
      // Lowercase + de-dupe while preserving first-seen order.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of arr) {
        const t = raw.toLowerCase();
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    }),
});

// Discriminated union mirrors the segment shape exactly: food uses the
// same `data` shape as a food segment, activity uses the same `data`
// shape as an activity segment. This is load-bearing —
// `addWishlistItemToTrip` copies `data` verbatim into a new segment.
export const wishlistItemCreateInput = z.discriminatedUnion('type', [
  commonFields.extend({ type: z.literal('food'), data: foodDataSchema }),
  commonFields.extend({ type: z.literal('activity'), data: activityDataSchema }),
]);
export type WishlistItemCreateInput = z.infer<typeof wishlistItemCreateInput>;

// Update reuses the same shape. The action layer enforces that the
// `type` of an existing item can't be changed (same reason as
// segments — switching food↔activity would require migrating `data`
// and would orphan the suggestions filter).
export const wishlistItemUpdateInput = wishlistItemCreateInput;
export type WishlistItemUpdateInput = z.infer<typeof wishlistItemUpdateInput>;

// List filters used by /wishlist's filter chips and the suggestions
// panel on trip pages.
export const wishlistListFilters = z.object({
  type: wishlistItemTypeEnum.optional(),
  countryCode: z
    .string()
    .trim()
    .transform((s) => (s === '' ? undefined : s.toUpperCase()))
    .pipe(z.string().length(2).optional())
    .optional(),
});
export type WishlistListFilters = z.input<typeof wishlistListFilters>;
