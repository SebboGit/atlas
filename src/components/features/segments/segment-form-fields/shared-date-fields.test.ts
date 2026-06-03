import { describe, expect, it } from 'vitest';

import type { SegmentType } from '@/lib/segments';

import { hasEndDateField, startPlaceholderFor } from './shared-date-fields';

// Food is a point in time — a "Reservation" clock time with no end —
// so it renders a start-only date row. Every other type keeps the
// start/end pair.
describe('hasEndDateField', () => {
  it('omits the end field for food', () => {
    expect(hasEndDateField('food')).toBe(false);
  });

  it.each<SegmentType>(['flight', 'hotel', 'activity', 'transit', 'note'])(
    'keeps the end field for %s',
    (type) => {
      expect(hasEndDateField(type)).toBe(true);
    },
  );
});

// Activities and food can both be left undated (ADR-0003) and live on
// their flat tabs; the "(optional)" label marker already says the field
// can be left empty, so neither shows a placeholder.
describe('startPlaceholderFor', () => {
  it('shows no placeholder for food', () => {
    expect(startPlaceholderFor('food')).toBe('');
  });

  it('shows no placeholder for activity', () => {
    expect(startPlaceholderFor('activity')).toBe('');
  });
});
