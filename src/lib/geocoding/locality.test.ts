import { describe, expect, it } from 'vitest';

import { chooseLocality } from './locality';

// Admin geography only — synthetic where a venue would be needed.
describe('chooseLocality', () => {
  it('takes the city when it is a real city', () => {
    expect(chooseLocality({ city: 'Hanoi' })).toBe('Hanoi');
    expect(chooseLocality({ city: 'Ho Chi Minh City', district: 'Cầu Ông Lãnh' })).toBe(
      'Ho Chi Minh City',
    );
    expect(chooseLocality({ city: 'Tokyo', district: 'Shinjuku' })).toBe('Tokyo');
  });

  it('defers a ward-shaped city to the state (post-reform Vietnamese admin)', () => {
    expect(
      chooseLocality({
        city: 'Nam Hoa Lư Ward',
        district: 'Ninh Hải',
        state: 'Ninh Binh province',
      }),
    ).toBe('Ninh Binh');
    expect(chooseLocality({ city: 'Phường Nam Hoa Lư', state: 'Tỉnh Ninh Bình' })).toBe(
      'Ninh Bình',
    );
  });

  it('strips Vietnamese admin classifiers', () => {
    expect(chooseLocality({ city: 'Thành phố Hà Nội' })).toBe('Hà Nội');
    expect(chooseLocality({ state: 'Tỉnh Ninh Bình' })).toBe('Ninh Bình');
  });

  it('never strips an English "City" that is part of the name', () => {
    expect(chooseLocality({ city: 'Mexico City' })).toBe('Mexico City');
    expect(chooseLocality({ city: 'Quebec City' })).toBe('Quebec City');
  });

  it('falls back through town/village/district/county/state', () => {
    expect(chooseLocality({ village: 'Ninh Hải', state: 'Tỉnh Ninh Bình' })).toBe('Ninh Hải');
    expect(chooseLocality({ district: 'Hoan Kiem Ward', state: 'Thành phố Hà Nội' })).toBe(
      'Hà Nội',
    );
    expect(chooseLocality({ county: 'Somerset' })).toBe('Somerset');
  });

  it('defers commune-shaped values with Unicode-final markers (xã)', () => {
    // JS \b never matches after "ã" — the lookaround boundaries do.
    expect(chooseLocality({ city: 'Xã Ninh Hải', state: 'Tỉnh Ninh Bình' })).toBe('Ninh Bình');
  });

  it('keeps a provincial town whose classifier contains xã', () => {
    // "Thị xã Sơn Tây" is a town — the prefix strips off BEFORE the
    // marker test, so its own name survives.
    expect(chooseLocality({ city: 'Thị xã Sơn Tây', state: 'Thành phố Hà Nội' })).toBe('Sơn Tây');
  });

  it('returns null when nothing usable exists', () => {
    expect(chooseLocality({})).toBeNull();
    expect(chooseLocality({ city: '   ' })).toBeNull();
  });
});
