import { describe, expect, it } from 'vitest';

import { segmentCity } from './segment-city';

describe('segmentCity', () => {
  it('returns the resolved city when no locationName competes', () => {
    expect(segmentCity({ city: 'Ho Chi Minh City' }, null)).toBe('Ho Chi Minh City');
  });

  it('suppresses the city when the locationName already covers it', () => {
    expect(segmentCity({ city: 'Shibuya' }, 'Shibuya')).toBeNull();
    expect(segmentCity({ city: 'Shibuya' }, 'Shibuya, Tokyo')).toBeNull();
    // Containment both ways: a short label inside the city name.
    expect(segmentCity({ city: 'Ho Chi Minh City' }, 'ho chi minh')).toBeNull();
  });

  it('shows the city alongside an unrelated label', () => {
    expect(segmentCity({ city: 'Kyoto' }, 'near the station')).toBe('Kyoto');
  });

  it('handles missing coords and empty city', () => {
    expect(segmentCity(null, 'Shibuya')).toBeNull();
    expect(segmentCity({ city: '  ' }, null)).toBeNull();
    expect(segmentCity({}, null)).toBeNull();
  });
});
