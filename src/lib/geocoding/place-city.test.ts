import { describe, expect, it } from 'vitest';

import { placeCity } from './place-city';

describe('placeCity', () => {
  it('returns the resolved city when no locationName competes', () => {
    expect(placeCity({ city: 'Ho Chi Minh City' }, null)).toBe('Ho Chi Minh City');
  });

  it('suppresses the city when the locationName already covers it', () => {
    expect(placeCity({ city: 'Shibuya' }, 'Shibuya')).toBeNull();
    expect(placeCity({ city: 'Shibuya' }, 'Shibuya, Tokyo')).toBeNull();
    // Containment both ways: a short label inside the city name.
    expect(placeCity({ city: 'Ho Chi Minh City' }, 'ho chi minh')).toBeNull();
  });

  it('shows the city alongside an unrelated label', () => {
    expect(placeCity({ city: 'Kyoto' }, 'near the station')).toBe('Kyoto');
  });

  it('handles missing coords and empty city', () => {
    expect(placeCity(null, 'Shibuya')).toBeNull();
    expect(placeCity({ city: '  ' }, null)).toBeNull();
    expect(placeCity({}, null)).toBeNull();
  });

  describe('alongside.country', () => {
    it('suppresses a city-state whose city equals its country', () => {
      expect(placeCity({ city: 'Singapore' }, null, { country: 'Singapore' })).toBeNull();
      expect(placeCity({ city: 'monaco' }, null, { country: 'Monaco' })).toBeNull();
    });

    it('keeps a city whose name merely contains the country', () => {
      expect(placeCity({ city: 'Mexico City' }, null, { country: 'Mexico' })).toBe('Mexico City');
      expect(placeCity({ city: 'Panama City' }, null, { country: 'Panama' })).toBe('Panama City');
      expect(placeCity({ city: 'Kuwait City' }, null, { country: 'Kuwait' })).toBe('Kuwait City');
    });

    it('ignores a blank or absent country', () => {
      expect(placeCity({ city: 'Kyoto' }, null, { country: '  ' })).toBe('Kyoto');
      expect(placeCity({ city: 'Kyoto' }, null, {})).toBe('Kyoto');
    });
  });

  describe('alongside.text', () => {
    it('suppresses a city the address already spells out', () => {
      expect(
        placeCity({ city: 'Kyoto' }, null, { text: '294 Kiyomizu, Higashiyama Ward, Kyoto' }),
      ).toBeNull();
    });

    it('does not suppress on the reverse containment', () => {
      // A short description must never delete a longer city name.
      expect(placeCity({ city: 'Kyoto' }, null, { text: 'Kyo' })).toBe('Kyoto');
    });

    it('keeps a city an unrelated description does not mention', () => {
      expect(placeCity({ city: 'Kyoto' }, null, { text: 'Morning visit before crowds' })).toBe(
        'Kyoto',
      );
    });
  });
});
