import { afterEach, describe, expect, it } from 'vitest';

import {
  dateFromLocalInZone,
  formatDate,
  formatLocalDateTimeInZone,
  formatTime,
  getDateFormatMode,
  zoneAbbreviation,
} from './index';

describe('formatTime', () => {
  // Reference instant chosen so its wall-clock representation differs
  // across timezones — this is the actual data from the boarding-pass
  // bug that motivated the airport-TZ work: SGN arrival 04:40 ICT,
  // which is 21:40 UTC the previous day.
  const sgnArrivalUtc = new Date('2026-09-20T21:40:00Z');

  it('renders wall-clock at the supplied timezone', () => {
    expect(formatTime(sgnArrivalUtc, { timeZone: 'Asia/Saigon' })).toBe('04:40');
    expect(formatTime(sgnArrivalUtc, { timeZone: 'Asia/Ho_Chi_Minh' })).toBe('04:40');
    expect(formatTime(sgnArrivalUtc, { timeZone: 'UTC' })).toBe('21:40');
    expect(formatTime(sgnArrivalUtc, { timeZone: 'America/Los_Angeles' })).toBe('14:40');
  });

  it('falls back to the runtime zone when timeZone is omitted', () => {
    // Can't assert a specific value (depends on host TZ) but it must
    // return an "HH:MM" string.
    expect(formatTime(sgnArrivalUtc)).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('zoneAbbreviation', () => {
  // Flight times are floating-UTC (ADR-0016): the stored instant's UTC
  // wall-clock IS the displayed time, and this supplies the zone label
  // beside it without shifting the clock. The exact abbreviation is
  // ICU-dependent (Intl emits "JST" or "GMT+9" depending on the host),
  // so we assert structure, not a specific string — same posture the
  // old formatTimeWithZone test took.
  const summer = new Date('2026-06-01T06:00:00Z');
  const winter = new Date('2026-01-01T06:00:00Z');

  it('returns a label without shifting the clock', () => {
    // The time is read in UTC (06:00); only the label comes from the
    // zone. The label is non-empty and never carries the time itself.
    expect(formatTime(summer, { timeZone: 'UTC' })).toBe('06:00');
    const zone = zoneAbbreviation(summer, 'Asia/Tokyo');
    expect(zone).not.toBe('');
    expect(zone).not.toContain(':');
  });

  it('is DST-aware — the label differs between summer and winter', () => {
    // Whether Intl renders CEST/CET or GMT+2/GMT+1, the two must differ.
    expect(zoneAbbreviation(summer, 'Europe/Berlin')).not.toBe(
      zoneAbbreviation(winter, 'Europe/Berlin'),
    );
  });

  it('emits "UTC" for UTC', () => {
    expect(zoneAbbreviation(summer, 'UTC')).toBe('UTC');
  });
});

describe('formatLocalDateTimeInZone', () => {
  // Same SGN-arrival reference instant as above.
  const sgnArrivalUtc = new Date('2026-09-20T21:40:00Z');

  it('renders the wall-clock at the airport, not the runtime', () => {
    expect(formatLocalDateTimeInZone(sgnArrivalUtc, 'Asia/Saigon')).toBe('2026-09-21T04:40');
    expect(formatLocalDateTimeInZone(sgnArrivalUtc, 'Europe/Berlin')).toBe('2026-09-20T23:40');
    expect(formatLocalDateTimeInZone(sgnArrivalUtc, 'UTC')).toBe('2026-09-20T21:40');
  });

  it('drops the time suffix when the instant is midnight in the zone', () => {
    // 2026-09-20 00:00 Asia/Saigon = 2026-09-19 17:00 UTC.
    const sgnMidnight = new Date('2026-09-19T17:00:00Z');
    expect(formatLocalDateTimeInZone(sgnMidnight, 'Asia/Saigon')).toBe('2026-09-20');
  });

  it('handles DST transitions correctly', () => {
    // 2026-03-29 02:30 UTC = 04:30 CEST (Berlin had jumped to summer
    // time at 03:00 CET → 03:00 CEST that morning).
    const dstInstant = new Date('2026-03-29T02:30:00Z');
    expect(formatLocalDateTimeInZone(dstInstant, 'Europe/Berlin')).toBe('2026-03-29T04:30');
  });
});

describe('dateFromLocalInZone', () => {
  it('round-trips with formatLocalDateTimeInZone', () => {
    const cases: Array<{ s: string; tz: string }> = [
      { s: '2026-09-21T04:40', tz: 'Asia/Saigon' },
      { s: '2026-09-20T23:40', tz: 'Europe/Berlin' },
      { s: '2026-09-20T21:40', tz: 'UTC' },
      { s: '2026-09-20', tz: 'Asia/Saigon' },
      // Across the spring-forward transition.
      { s: '2026-03-29T04:30', tz: 'Europe/Berlin' },
    ];
    for (const { s, tz } of cases) {
      const d = dateFromLocalInZone(s, tz);
      expect(d).not.toBeNull();
      expect(formatLocalDateTimeInZone(d!, tz)).toBe(s);
    }
  });

  it('matches the reference SGN arrival instant', () => {
    expect(dateFromLocalInZone('2026-09-21T04:40', 'Asia/Saigon')?.toISOString()).toBe(
      '2026-09-20T21:40:00.000Z',
    );
  });

  it('returns null on malformed input', () => {
    expect(dateFromLocalInZone('', 'UTC')).toBeNull();
    expect(dateFromLocalInZone('not-a-date', 'UTC')).toBeNull();
    expect(dateFromLocalInZone('2026-13-01', 'UTC')).not.toBeNull(); // accepts shape; JS normalises
  });
});

// ---------------------------------------------------------------------------
// formatDate (calendar-date display, env-driven)
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('iso mode is a passthrough', () => {
    expect(formatDate('2026-02-19', 'iso')).toBe('2026-02-19');
  });

  it('eu mode renders DD/MM/YYYY', () => {
    expect(formatDate('2026-02-19', 'eu')).toBe('19/02/2026');
  });

  it('us mode renders MM/DD/YYYY', () => {
    expect(formatDate('2026-02-19', 'us')).toBe('02/19/2026');
  });

  it('returns the input verbatim on malformed strings (no crash)', () => {
    // Extraction payloads occasionally carry garbage past the schema
    // (e.g. a locale-formatted date the LLM emitted). Better to show
    // the user something than to throw on display.
    expect(formatDate('not a date', 'eu')).toBe('not a date');
    expect(formatDate('', 'eu')).toBe('');
    expect(formatDate('19/02/2026', 'eu')).toBe('19/02/2026');
  });
});

describe('getDateFormatMode', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT;
  afterEach(() => {
    process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT = ORIGINAL;
  });

  it('defaults to iso when unset', () => {
    delete process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT;
    expect(getDateFormatMode()).toBe('iso');
  });

  it('accepts the canonical values', () => {
    process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT = 'eu';
    expect(getDateFormatMode()).toBe('eu');
    process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT = 'us';
    expect(getDateFormatMode()).toBe('us');
    process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT = 'iso';
    expect(getDateFormatMode()).toBe('iso');
  });

  it('falls back to iso on unknown values and is case/whitespace tolerant', () => {
    process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT = 'gibberish';
    expect(getDateFormatMode()).toBe('iso');
    process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT = ' EU ';
    expect(getDateFormatMode()).toBe('eu');
  });
});
