import { afterEach, describe, expect, it } from 'vitest';

import {
  convertDistance,
  getDistanceUnit,
  groupDigits,
  latitudeLabel,
  monthYear,
  plural,
} from './format';

describe('groupDigits', () => {
  it('leaves short numbers untouched', () => {
    expect(groupDigits(0)).toBe('0');
    expect(groupDigits(42)).toBe('42');
    expect(groupDigits(999)).toBe('999');
  });

  it('groups thousands with a thin space', () => {
    expect(groupDigits(1000)).toBe('1 000');
    expect(groupDigits(12480)).toBe('12 480');
    expect(groupDigits(1234567)).toBe('1 234 567');
  });

  it('rounds before grouping', () => {
    expect(groupDigits(1999.6)).toBe('2 000');
  });
});

describe('monthYear', () => {
  it('renders a UTC month and year', () => {
    expect(monthYear(new Date('2025-03-15T00:00:00Z'))).toBe('March 2025');
  });

  it('does not slip a month at a UTC boundary', () => {
    expect(monthYear(new Date('2025-03-01T00:00:00Z'))).toBe('March 2025');
  });
});

describe('latitudeLabel', () => {
  it('marks the northern hemisphere', () => {
    expect(latitudeLabel(64.13)).toBe('64.1° N');
  });

  it('marks the southern hemisphere', () => {
    expect(latitudeLabel(-45.03)).toBe('45.0° S');
  });

  it('drops the hemisphere letter on the equator', () => {
    expect(latitudeLabel(0)).toBe('0.0°');
  });
});

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'night')).toBe('night');
  });

  it('uses the plural otherwise', () => {
    expect(plural(0, 'night')).toBe('nights');
    expect(plural(2, 'night')).toBe('nights');
  });

  it('honours an explicit plural form', () => {
    expect(plural(2, 'country', 'countries')).toBe('countries');
  });
});

describe('getDistanceUnit', () => {
  afterEach(() => {
    delete process.env.ATLAS_DISTANCE_UNIT;
  });

  it('defaults to km when the var is unset', () => {
    delete process.env.ATLAS_DISTANCE_UNIT;
    expect(getDistanceUnit()).toBe('km');
  });

  it('returns mi when the var is set to mi', () => {
    process.env.ATLAS_DISTANCE_UNIT = 'mi';
    expect(getDistanceUnit()).toBe('mi');
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    process.env.ATLAS_DISTANCE_UNIT = '  MI ';
    expect(getDistanceUnit()).toBe('mi');
  });

  it('falls back to km on an unrecognised value', () => {
    process.env.ATLAS_DISTANCE_UNIT = 'leagues';
    expect(getDistanceUnit()).toBe('km');
  });
});

describe('convertDistance', () => {
  it('passes kilometres through unchanged', () => {
    expect(convertDistance(0, 'km')).toBe(0);
    expect(convertDistance(12480, 'km')).toBe(12480);
  });

  it('converts kilometres to statute miles', () => {
    // 1609.344 km is exactly 1000 miles.
    expect(convertDistance(1609.344, 'mi')).toBeCloseTo(1000, 6);
    // A round 100 km is ~62.14 miles.
    expect(convertDistance(100, 'mi')).toBeCloseTo(62.1371, 3);
  });

  it('leaves zero at zero in either unit', () => {
    expect(convertDistance(0, 'mi')).toBe(0);
  });
});
