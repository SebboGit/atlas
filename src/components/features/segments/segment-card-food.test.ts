import { describe, expect, it } from 'vitest';

import { foodCardSubtitle } from './segment-card-food';

// The food card subtitle should locate the venue — address first,
// location label as fallback — and must never surface the booking
// reference (that stays in the info dialog).
describe('foodCardSubtitle', () => {
  it('prefers the parsed address when present', () => {
    expect(
      foodCardSubtitle({ address: '12 Rue de Rivoli, Paris', locationName: 'Le Comptoir' }),
    ).toBe('12 Rue de Rivoli, Paris');
  });

  it('falls back to the location label when there is no address', () => {
    expect(foodCardSubtitle({ address: undefined, locationName: 'Le Comptoir' })).toBe(
      'Le Comptoir',
    );
  });

  it('falls back to the location label when the address is an empty string', () => {
    expect(foodCardSubtitle({ address: '', locationName: 'Le Comptoir' })).toBe('Le Comptoir');
  });

  it('returns undefined when neither address nor location label is set', () => {
    expect(foodCardSubtitle({ address: undefined, locationName: null })).toBeUndefined();
  });

  it('returns undefined when both values are empty strings', () => {
    expect(foodCardSubtitle({ address: '', locationName: '' })).toBeUndefined();
  });
});
