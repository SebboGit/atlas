import type { SegmentType } from '@/lib/segments';

// Every segment type owns one pastel tone (see the --color-seg-* tokens in
// globals.css). The same tone marks the type everywhere it appears — the
// ticket stub, the day header's type counts, map pins and filter chips — and
// is identical in light and dark, so a colour always means the same thing.

/** Stub fill + its ink. Text on a stub must use the ink, never foreground. */
export const SEGMENT_TONE: Record<SegmentType, string> = {
  flight: 'bg-seg-flight text-seg-flight-ink',
  hotel: 'bg-seg-hotel text-seg-hotel-ink',
  activity: 'bg-seg-activity text-seg-activity-ink',
  food: 'bg-seg-food text-seg-food-ink',
  transit: 'bg-seg-transit text-seg-transit-ink',
  note: 'bg-seg-note text-seg-note-ink',
};

/** Fill only — for dots and swatches. */
export const SEGMENT_SWATCH: Record<SegmentType, string> = {
  flight: 'bg-seg-flight',
  hotel: 'bg-seg-hotel',
  activity: 'bg-seg-activity',
  food: 'bg-seg-food',
  transit: 'bg-seg-transit',
  note: 'bg-seg-note',
};

/**
 * Ink alone — for controls laid over a stub (the phone ticket's top strip
 * carries the edit / delete cluster). Prefixed `max-sm:` at the call site
 * where the stub moves out from under the controls at `sm:`.
 */
export const SEGMENT_INK: Record<SegmentType, string> = {
  flight: 'text-seg-flight-ink',
  hotel: 'text-seg-hotel-ink',
  activity: 'text-seg-activity-ink',
  food: 'text-seg-food-ink',
  transit: 'text-seg-transit-ink',
  note: 'text-seg-note-ink',
};

/** The same inks, applied below `sm:` only (static strings for Tailwind). */
export const SEGMENT_INK_PHONE: Record<SegmentType, string> = {
  flight: 'max-sm:text-seg-flight-ink',
  hotel: 'max-sm:text-seg-hotel-ink',
  activity: 'max-sm:text-seg-activity-ink',
  food: 'max-sm:text-seg-food-ink',
  transit: 'max-sm:text-seg-transit-ink',
  note: 'max-sm:text-seg-note-ink',
};
