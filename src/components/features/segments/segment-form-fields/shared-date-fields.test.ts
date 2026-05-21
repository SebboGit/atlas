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

// The optional start field's placeholder is type-aware: an undated
// activity is the wishlist state (ADR-0003) and the copy invites it;
// an undated food entry just sits undated on the flat Food tab, so
// food shows no placeholder.
describe('startPlaceholderFor', () => {
  it('shows no placeholder for food', () => {
    expect(startPlaceholderFor('food')).toBe('');
  });

  it('uses wishlist copy for activity', () => {
    expect(startPlaceholderFor('activity')).toBe('Leave empty for wishlist');
  });
});
