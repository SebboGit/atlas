import { describe, expect, it } from 'vitest';

import { countryName } from './data';

describe('countryName', () => {
  it('resolves a known alpha-2 code', () => {
    expect(countryName('JP')).toBe('Japan');
    expect(countryName('US')).toBe('United States');
    expect(countryName('GB')).toBe('United Kingdom');
  });

  it('uppercases the input before lookup', () => {
    expect(countryName('jp')).toBe('Japan');
    expect(countryName('fr')).toBe('France');
  });

  it('keeps preferred-official names', () => {
    expect(countryName('TR')).toBe('Türkiye');
  });

  it('falls back to the original code when unknown', () => {
    // Fallback returns the input verbatim (casing preserved), so the UI
    // renders something rather than an empty label.
    expect(countryName('ZZ')).toBe('ZZ');
    expect(countryName('zz')).toBe('zz');
  });
});
