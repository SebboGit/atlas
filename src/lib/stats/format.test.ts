import { afterEach, describe, expect, it } from 'vitest';

import {
  convertDistance,
  dayMonthYear,
  earthLaps,
  figureWidthEm,
  firstName,
  getDistanceUnit,
  groupDigits,
  latitudeLabel,
  plural,
  shortMonthYear,
  timeOnTheRoad,
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

describe('shortMonthYear', () => {
  it('renders a short UTC month and year', () => {
    expect(shortMonthYear(new Date('2025-03-15T00:00:00Z'))).toBe('Mar 2025');
  });

  it('does not slip a month at a UTC boundary', () => {
    expect(shortMonthYear(new Date('2025-03-01T00:00:00Z'))).toBe('Mar 2025');
  });
});

describe('dayMonthYear', () => {
  it('puts the day first', () => {
    expect(dayMonthYear(new Date('2026-10-23T12:00:00Z'))).toBe('23 Oct 2026');
  });

  it('reads the UTC calendar day', () => {
    expect(dayMonthYear(new Date('2026-10-23T23:30:00Z'))).toBe('23 Oct 2026');
  });
});

describe('firstName', () => {
  it('takes the first word of the name', () => {
    expect(firstName('Sebastian Theimer')).toBe('Sebastian');
    expect(firstName('  Ana   María ')).toBe('Ana');
  });

  it('is null without a name', () => {
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
    expect(firstName('   ')).toBeNull();
  });
});

describe('timeOnTheRoad', () => {
  it('says nothing under a month', () => {
    expect(timeOnTheRoad(0)).toBeNull();
    expect(timeOnTheRoad(30)).toBeNull();
  });

  it('counts whole months, rounded', () => {
    expect(timeOnTheRoad(31)).toBe('1 month on the road');
    expect(timeOnTheRoad(299)).toBe('10 months on the road');
  });

  it('switches to years from twelve months', () => {
    expect(timeOnTheRoad(365)).toBe('1 year on the road');
    expect(timeOnTheRoad(430)).toBe('1 year, 2 months on the road');
    expect(timeOnTheRoad(400)).toBe('1 year, 1 month on the road');
    expect(timeOnTheRoad(731)).toBe('2 years on the road');
  });
});

describe('earthLaps', () => {
  it('is null for no distance, or one that rounds to nothing', () => {
    expect(earthLaps(0)).toBeNull();
    expect(earthLaps(1500)).toBeNull();
  });

  it('keeps one decimal below 100 laps', () => {
    expect(earthLaps(2500)).toBe('0.1');
    expect(earthLaps(268_940)).toBe('6.7');
    expect(earthLaps(1_268_940)).toBe('31.7');
  });

  it('rounds to whole laps from 100', () => {
    expect(earthLaps(4_007_500)).toBe('100');
    expect(earthLaps(12_480_300)).toBe('311');
  });

  it('groups very large lap counts', () => {
    expect(earthLaps(48_090_000)).toBe('1\u202F200');
  });
});

describe('figureWidthEm', () => {
  it('counts digits wider than the thin spaces between groups', () => {
    expect(figureWidthEm('0')).toBe(0.62);
    expect(figureWidthEm(groupDigits(268_940))).toBeCloseTo(6 * 0.62 + 0.14);
    expect(figureWidthEm(groupDigits(12_480_300))).toBeCloseTo(8 * 0.62 + 2 * 0.14);
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

  it('drops it too when the figure rounds to the equator', () => {
    expect(latitudeLabel(-0.04)).toBe('0.0°');
    expect(latitudeLabel(0.04)).toBe('0.0°');
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
