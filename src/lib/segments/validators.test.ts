import { describe, expect, it } from 'vitest';

import { segmentCreateInput } from './validators';

// Minimal flight payload used as a base for happy-path assertions.
const FLIGHT_BASE = {
  type: 'flight' as const,
  data: { originAirport: 'LHR', destinationAirport: 'HND' },
};

describe('segmentCreateInput — dateInput timezone parsing', () => {
  it("'yyyy-mm-dd' parses to UTC midnight (floating local time)", () => {
    // Floating local time (ADR-0014): a no-timezone wall-clock is
    // interpreted at UTC, so the stored instant's UTC wall-clock equals
    // what the user picked — deterministic on any runner timezone, and a
    // date-only pick lands on UTC midnight (read as "no time component").
    const result = segmentCreateInput.safeParse({ ...FLIGHT_BASE, startsAt: '2026-06-12' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const d = result.data.startsAt!;
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });

  it("'yyyy-mm-ddThh:mm' parses the wall-clock at UTC", () => {
    const result = segmentCreateInput.safeParse({
      ...FLIGHT_BASE,
      startsAt: '2026-06-12T10:40',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.startsAt!.toISOString()).toBe('2026-06-12T10:40:00.000Z');
  });

  it('empty string and null both normalise to null', () => {
    const empty = segmentCreateInput.safeParse({ ...FLIGHT_BASE, startsAt: '' });
    const nul = segmentCreateInput.safeParse({ ...FLIGHT_BASE, startsAt: null });
    expect(empty.success).toBe(true);
    expect(nul.success).toBe(true);
    if (empty.success) expect(empty.data.startsAt).toBeNull();
    if (nul.success) expect(nul.data.startsAt).toBeNull();
  });

  it('malformed strings normalise to null without throwing', () => {
    const result = segmentCreateInput.safeParse({
      ...FLIGHT_BASE,
      startsAt: 'definitely-not-a-date',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.startsAt).toBeNull();
  });

  it('rejects out-of-range date fields as null (no silent rollover)', () => {
    // The shape regex passes "2026-13-40" but the values overflow; the
    // parser must reject rather than let Date.UTC roll it into 2027.
    for (const bad of ['2026-13-40', '2026-02-30', '2026-06-12T25:00']) {
      const result = segmentCreateInput.safeParse({ ...FLIGHT_BASE, startsAt: bad });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.startsAt).toBeNull();
    }
  });

  it('accepts a Date instance as-is', () => {
    const d = new Date(2026, 5, 12, 10, 40);
    const result = segmentCreateInput.safeParse({ ...FLIGHT_BASE, startsAt: d });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.startsAt?.getTime()).toBe(d.getTime());
  });
});

describe('segmentCreateInput — note variant geography stripping', () => {
  // Regression for the note country-leak bug: switching flight → note
  // in the form preserved countryCode in form state. Without
  // per-variant trimming, that countryCode would survive into the
  // DB and surface in the country-filter chip row for a note.
  it('strips countryCode from note input', () => {
    const result = segmentCreateInput.safeParse({
      type: 'note',
      data: { body: 'remember the passport' },
      countryCode: 'JP', // sneaks in from a prior flight pick
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // The note variant is built from commonFields only, so Zod's
    // default strip behaviour drops the country.
    expect('countryCode' in result.data).toBe(false);
  });

  it('strips originCountryCode + locationName from note input', () => {
    const result = segmentCreateInput.safeParse({
      type: 'note',
      data: { body: 'remember the passport' },
      originCountryCode: 'GB',
      locationName: 'Heathrow',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect('originCountryCode' in result.data).toBe(false);
    expect('locationName' in result.data).toBe(false);
  });

  it('strips originCountryCode from non-flight (hotel) input', () => {
    // Only flights carry originCountryCode. A stray value on a hotel
    // — same form-preservation mechanism — must not reach the DB.
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'Park Hyatt' },
      originCountryCode: 'GB',
      countryCode: 'JP',
    });
    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== 'hotel') return;
    expect('originCountryCode' in result.data).toBe(false);
    expect(result.data.countryCode).toBe('JP'); // kept
  });

  it('retains countryCode + originCountryCode on flight', () => {
    const result = segmentCreateInput.safeParse({
      type: 'flight',
      data: { originAirport: 'LHR', destinationAirport: 'HND' },
      countryCode: 'JP',
      originCountryCode: 'GB',
    });
    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== 'flight') return;
    expect(result.data.countryCode).toBe('JP');
    expect(result.data.originCountryCode).toBe('GB');
  });
});

describe('segmentCreateInput — countryCode normalisation', () => {
  it('empty string round-trips to null', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'x' },
      countryCode: '',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'hotel') {
      expect(result.data.countryCode).toBeNull();
    }
  });

  it('lowercase code is uppercased', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'x' },
      countryCode: 'jp',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'hotel') {
      expect(result.data.countryCode).toBe('JP');
    }
  });

  it('whitespace is trimmed', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'x' },
      countryCode: '  jp  ',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'hotel') {
      expect(result.data.countryCode).toBe('JP');
    }
  });

  it('three-letter code is rejected', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'x' },
      countryCode: 'JPX',
    });
    expect(result.success).toBe(false);
  });

  it('null is accepted (explicit "not set")', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'x' },
      countryCode: null,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'hotel') {
      expect(result.data.countryCode).toBeNull();
    }
  });
});

describe('segmentCreateInput — discriminated-union safety', () => {
  it('rejects wrong-type data shape (note body on flight)', () => {
    const result = segmentCreateInput.safeParse({
      type: 'flight',
      data: { body: 'this is a note' }, // not a flight shape
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys inside data (strict per type)', () => {
    const result = segmentCreateInput.safeParse({
      type: 'flight',
      data: { originAirport: 'LHR', destinationAirport: 'HND', evil: 'sneak' },
    });
    expect(result.success).toBe(false);
  });

  it('hotel requires propertyName', () => {
    const result = segmentCreateInput.safeParse({ type: 'hotel', data: {} });
    expect(result.success).toBe(false);
  });

  it('activity with no date is valid (wishlist state)', () => {
    const result = segmentCreateInput.safeParse({
      type: 'activity',
      data: { title: 'TeamLab Planets' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.startsAt).toBeNull();
  });

  it('food requires a venue', () => {
    const result = segmentCreateInput.safeParse({ type: 'food', data: {} });
    expect(result.success).toBe(false);
  });

  it('food accepts a venue plus an optional booking reference', () => {
    const result = segmentCreateInput.safeParse({
      type: 'food',
      data: { venue: 'Narisawa', bookingRef: 'OT-4821' },
      startsAt: '2026-09-20T19:30',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'food') {
      expect(result.data.data.venue).toBe('Narisawa');
      expect(result.data.data.bookingRef).toBe('OT-4821');
    }
  });

  it('food accepts an optional address — mirrors the hotel address field', () => {
    const result = segmentCreateInput.safeParse({
      type: 'food',
      data: { venue: 'Narisawa', address: '2-6-15 Minami-Aoyama, Minato, Tokyo' },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'food') {
      expect(result.data.data.address).toBe('2-6-15 Minami-Aoyama, Minato, Tokyo');
    }
  });

  it('food address is trimmed, like the hotel address field', () => {
    const result = segmentCreateInput.safeParse({
      type: 'food',
      data: { venue: 'Narisawa', address: '  2-6-15 Minami-Aoyama  ' },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'food') {
      expect(result.data.data.address).toBe('2-6-15 Minami-Aoyama');
    }
  });

  it('food rejects an address over the 500-char cap', () => {
    const result = segmentCreateInput.safeParse({
      type: 'food',
      data: { venue: 'Narisawa', address: 'x'.repeat(501) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys inside food data (party size is v2)', () => {
    const result = segmentCreateInput.safeParse({
      type: 'food',
      data: { venue: 'Narisawa', partySize: 4 },
    });
    expect(result.success).toBe(false);
  });

  it('food may be left undated — an in-trip shortlist of "maybe" places', () => {
    const result = segmentCreateInput.safeParse({
      type: 'food',
      data: { venue: 'Narisawa' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.startsAt).toBeNull();
  });
});

describe('segmentCreateInput — Plus Code field', () => {
  it('accepts a full Plus Code on hotel data', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'Hotel California', plusCode: '8Q7XMPWG+5V' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a local Plus Code with anchor on food data', () => {
    const result = segmentCreateInput.safeParse({
      type: 'food',
      data: { venue: 'Narisawa', plusCode: 'MP7J+CV Minato City, Tokyo' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a bare local Plus Code (no anchor)', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'Hotel California', plusCode: 'MP7J+CV' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects garbage input', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'Hotel California', plusCode: 'not a code' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty Plus Code string (optional field)', () => {
    const result = segmentCreateInput.safeParse({
      type: 'hotel',
      data: { propertyName: 'Hotel California', plusCode: '' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts plusCode on activity data alongside the new address field', () => {
    const result = segmentCreateInput.safeParse({
      type: 'activity',
      data: {
        title: 'Old Town',
        address: '1-2-3 Roppongi, Tokyo',
        plusCode: '8Q7XMPWG+5V',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts plusCode on transit data alongside the new address field', () => {
    const result = segmentCreateInput.safeParse({
      type: 'transit',
      data: {
        mode: 'ferry',
        toName: 'Sumida Ferry Terminal',
        address: '2-1-1 Hama-rikyu Gardens, Chuo, Tokyo',
        plusCode: '8Q7XMPWG+5V',
      },
    });
    expect(result.success).toBe(true);
  });
});
