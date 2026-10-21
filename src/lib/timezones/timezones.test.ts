import { describe, expect, it } from 'vitest';

import { epochToWallClock, wallClockToEpoch } from './convert';
import { zoneAt, zoneForAirport, zoneForCountry } from './resolve';

describe('wallClockToEpoch / epochToWallClock', () => {
  it('turns a floating 06:00 in Tokyo into 21:00 UTC the day before', () => {
    const wall = new Date('2026-10-16T06:00:00Z');
    expect(new Date(wallClockToEpoch(wall, 'Asia/Tokyo')!).toISOString()).toBe(
      '2026-10-15T21:00:00.000Z',
    );
  });

  it('round-trips across a DST change', () => {
    // Berlin leaves summer time on 2026-10-25; 12:00 on the 26th is CET.
    const wall = new Date('2026-10-26T12:00:00Z');
    const epoch = wallClockToEpoch(wall, 'Europe/Berlin')!;
    expect(new Date(epoch).toISOString()).toBe('2026-10-26T11:00:00.000Z');
    expect(epochToWallClock(epoch, 'Europe/Berlin')!.toISOString()).toBe(wall.toISOString());
  });

  it('returns null for an unknown zone', () => {
    expect(wallClockToEpoch(new Date(), 'Mars/Olympus_Mons')).toBeNull();
    expect(epochToWallClock(0, 'Mars/Olympus_Mons')).toBeNull();
  });
});

describe('zone resolution', () => {
  it('reads an airport zone from the committed table', () => {
    expect(zoneForAirport('HND')).toBe('Asia/Tokyo');
    expect(zoneForAirport('ZZZ')).toBeNull();
    expect(zoneForAirport(null)).toBeNull();
  });

  it('looks a zone up from coordinates', () => {
    expect(zoneAt(22.3, 114.17)).toBe('Asia/Hong_Kong');
    expect(zoneAt(35.68, 139.76)).toBe('Asia/Tokyo');
    expect(zoneAt(Number.NaN, 0)).toBeNull();
    expect(zoneAt(200, 0)).toBeNull();
  });

  it('falls back to a country only when its zones agree', () => {
    expect(zoneForCountry('JP')).toBe('Asia/Tokyo');
    // Berlin and Busingen keep identical offsets.
    expect(zoneForCountry('de')).toBe('Europe/Berlin');
    // Canary Islands run an hour behind Madrid.
    expect(zoneForCountry('ES')).toBeNull();
    expect(zoneForCountry('US')).toBeNull();
    expect(zoneForCountry(null)).toBeNull();
  });

  it('uses the official zone where tzdata lists an informal one', () => {
    expect(zoneForCountry('CN')).toBe('Asia/Shanghai');
  });
});
