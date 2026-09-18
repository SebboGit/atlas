import { describe, expect, it } from 'vitest';

import { formatTripCompactRange, formatTripDateRange, formatTripDateSpan, toYmd } from './format';

// Trip dates are UTC-midnight day tokens, so every formatter here has to
// read them in UTC. CI runs this suite three times — once in UTC, once at
// +14 (Pacific/Kiritimati) and once at −11 (Pacific/Niue) — so a
// formatter that slipped back to the viewer's zone fails in two of the
// three runs rather than passing everywhere the developer happens to sit.
const START = new Date('2026-10-04T00:00:00Z');
const END = new Date('2026-10-12T00:00:00Z');
const NEXT_YEAR = new Date('2027-01-02T00:00:00Z');

describe('formatTripDateSpan', () => {
  it('renders the stored day in UTC, not the viewer zone', () => {
    expect(formatTripDateSpan(START, END)).toBe('Sun, 4 Oct 2026 → Mon, 12 Oct 2026');
  });

  it('renders open-ended ranges', () => {
    expect(formatTripDateSpan(START, null)).toBe('From Sun, 4 Oct 2026');
    expect(formatTripDateSpan(null, END)).toBe('Until Mon, 12 Oct 2026');
  });

  it('falls back when the trip has no dates yet', () => {
    expect(formatTripDateSpan(null, null)).toBe('Dates to come');
  });
});

describe('formatTripDateRange', () => {
  it('collapses a same-year range to one year label', () => {
    expect(formatTripDateRange(START, END)).toBe('4 Oct – 12 Oct 2026');
  });

  it('spells both years out when the range crosses one', () => {
    expect(formatTripDateRange(END, NEXT_YEAR)).toBe('12 Oct 2026 – 2 Jan 2027');
  });

  it('renders open-ended ranges and the empty state', () => {
    expect(formatTripDateRange(START, null)).toBe('From 4 Oct 2026');
    expect(formatTripDateRange(null, END)).toBe('Until 12 Oct 2026');
    expect(formatTripDateRange(null, null)).toBe('Dates to come');
  });
});

describe('formatTripCompactRange', () => {
  it('collapses a same-year range to one uppercase line', () => {
    expect(formatTripCompactRange(START, END)).toBe('4 OCT – 12 OCT 2026');
  });

  it('carries a year on each end when the range crosses one', () => {
    expect(formatTripCompactRange(END, NEXT_YEAR)).toBe('12 OCT 2026 – 2 JAN 2027');
  });

  it('renders open-ended ranges and the empty state', () => {
    expect(formatTripCompactRange(START, null)).toBe('From 4 OCT 2026');
    expect(formatTripCompactRange(null, END)).toBe('Until 12 OCT 2026');
    expect(formatTripCompactRange(null, null)).toBe('Dates TBC');
  });
});

describe('toYmd', () => {
  it('reads the UTC calendar day', () => {
    expect(toYmd(START)).toBe('2026-10-04');
  });
});
