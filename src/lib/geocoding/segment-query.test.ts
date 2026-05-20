import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import { buildGeocodeQuery } from './segment-query';

function makeSegment(overrides: Partial<Segment>): Segment {
  return {
    id: 'seg-1',
    tripId: 'trip-1',
    type: 'hotel',
    data: {},
    startsAt: null,
    endsAt: null,
    locationName: null,
    countryCode: null,
    originCountryCode: null,
    needsReview: false,
    createdAt: new Date('2026-05-17'),
    updatedAt: new Date('2026-05-17'),
    ...overrides,
  } as Segment;
}

describe('buildGeocodeQuery — hotel', () => {
  it('uses address alone — propertyName is excluded to keep Nominatim happy', () => {
    // Branded hotel names ("a long branded hotel name Managed By
    // Another Brand") throw off Nominatim's left-to-right q-parser.
    // The address is the reliable signal.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        data: { propertyName: 'Hotel California', address: '1 Sunset Blvd, Los Angeles' },
      }),
    );
    expect(q).toBe('1 Sunset Blvd, Los Angeles');
  });

  it('falls back to propertyName when address is absent', () => {
    const q = buildGeocodeQuery(
      makeSegment({ type: 'hotel', data: { propertyName: 'Hotel California' } }),
    );
    expect(q).toBe('Hotel California');
  });

  it('falls back to propertyName when address is whitespace-only', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        data: { propertyName: 'Hotel California', address: '   ' },
      }),
    );
    expect(q).toBe('Hotel California');
  });

  it('ignores locationName entirely — locationName is the pin label, not the geocode source', () => {
    // A user who entered "Shibuya" as the locationName for "Hotel
    // Sakura, 1-2-3 Roppongi" should NOT see "Hotel Sakura, 1-2-3
    // Roppongi, Shibuya" sent to Nominatim. The address is in the
    // correct part of Tokyo already; locationName is purely the UI
    // shorthand.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        locationName: 'Shibuya',
        data: { propertyName: 'Hotel Sakura', address: '1-2-3 Roppongi, Tokyo' },
      }),
    );
    expect(q).toBe('1-2-3 Roppongi, Tokyo');
  });

  it('returns null when data is malformed (missing propertyName)', () => {
    const q = buildGeocodeQuery(makeSegment({ type: 'hotel', data: { address: 'somewhere' } }));
    expect(q).toBeNull();
  });
});

describe('buildGeocodeQuery — activity', () => {
  it('uses title alone when no locationName supplements it', () => {
    const q = buildGeocodeQuery(makeSegment({ type: 'activity', data: { title: 'Eiffel Tower' } }));
    expect(q).toBe('Eiffel Tower');
  });

  it('appends locationName as a disambiguator for landmarks that exist in many cities', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'activity',
        locationName: 'Chiang Mai',
        data: { title: 'Old Town' },
      }),
    );
    expect(q).toBe('Old Town, Chiang Mai');
  });

  it('ignores whitespace-only locationName', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'activity',
        locationName: '   ',
        data: { title: 'Mountain' },
      }),
    );
    expect(q).toBe('Mountain');
  });

  it('returns null when title is missing', () => {
    const q = buildGeocodeQuery(
      makeSegment({ type: 'activity', data: { description: 'no title here' } }),
    );
    expect(q).toBeNull();
  });
});

describe('buildGeocodeQuery — transit', () => {
  it('uses destination (toName) as the pin location', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'transit',
        data: { mode: 'train', fromName: 'Paddington Station', toName: 'Heathrow T5' },
      }),
    );
    expect(q).toBe('Heathrow T5');
  });

  it('falls back to fromName when toName is missing', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'transit',
        data: { mode: 'train', fromName: 'Paddington Station' },
      }),
    );
    expect(q).toBe('Paddington Station');
  });

  it('returns null when neither toName nor fromName is set', () => {
    const q = buildGeocodeQuery(makeSegment({ type: 'transit', data: { mode: 'bus' } }));
    expect(q).toBeNull();
  });
});

describe('buildGeocodeQuery — flight and note', () => {
  it('returns null for flight segments (handled by IATA snapshot)', () => {
    expect(
      buildGeocodeQuery(
        makeSegment({
          type: 'flight',
          data: { carrier: 'BA', flightNumber: '287', destinationAirport: 'SFO' },
        }),
      ),
    ).toBeNull();
  });

  it('returns null for note segments (no place on the map)', () => {
    expect(
      buildGeocodeQuery(makeSegment({ type: 'note', data: { body: 'remember the visa' } })),
    ).toBeNull();
  });
});
