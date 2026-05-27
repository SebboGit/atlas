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

describe('buildGeocodeQuery — food', () => {
  it('uses address alone when present — same address-first rule as hotels', () => {
    // A restaurant address resolves far more reliably than a venue
    // name, especially for chains or brand-y names. When the user (or
    // the extractor) supplied an address, that wins outright.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        data: { venue: 'Narisawa', address: '2-6-15 Minami-Aoyama, Minato, Tokyo' },
      }),
    );
    expect(q).toBe('2-6-15 Minami-Aoyama, Minato, Tokyo');
  });

  it('uses address over venue + locationName when both are available', () => {
    // Address-first means a present address suppresses the venue +
    // locationName fallback entirely — mirroring the hotel case.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        locationName: 'Ginza',
        data: { venue: 'Ippudo', address: '4-10-3 Ginza, Chuo, Tokyo' },
      }),
    );
    expect(q).toBe('4-10-3 Ginza, Chuo, Tokyo');
  });

  it('falls back to venue + locationName when address is whitespace-only', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        locationName: 'Ginza',
        data: { venue: 'Ippudo', address: '   ' },
      }),
    );
    expect(q).toBe('Ippudo, Ginza');
  });

  it('uses venue alone when no address and no locationName supplements it', () => {
    const q = buildGeocodeQuery(makeSegment({ type: 'food', data: { venue: 'Narisawa' } }));
    expect(q).toBe('Narisawa');
  });

  it('appends locationName as a disambiguator for chains in many cities', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        locationName: 'Ginza',
        data: { venue: 'Ippudo' },
      }),
    );
    expect(q).toBe('Ippudo, Ginza');
  });

  it('ignores whitespace-only locationName', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        locationName: '   ',
        data: { venue: 'Narisawa' },
      }),
    );
    expect(q).toBe('Narisawa');
  });

  it('returns null when venue is missing', () => {
    const q = buildGeocodeQuery(makeSegment({ type: 'food', data: { bookingRef: 'OT-1' } }));
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

describe('buildGeocodeQuery — Plus Code precedence', () => {
  it('hotel: plusCode wins over address', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        data: {
          propertyName: 'Hotel California',
          address: '1 Sunset Blvd, Los Angeles',
          plusCode: '8Q7XMPWG+5V',
        },
      }),
    );
    expect(q).toBe('8Q7XMPWG+5V');
  });

  it('food: plusCode wins over address', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        data: {
          venue: 'Narisawa',
          address: '2-6-15 Minami-Aoyama, Minato, Tokyo',
          plusCode: 'MP7J+CV Minato City, Tokyo',
        },
      }),
    );
    expect(q).toBe('MP7J+CV Minato City, Tokyo');
  });

  it('activity: plusCode wins over address and title', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'activity',
        locationName: 'Shibuya',
        data: {
          title: 'Old Town',
          address: 'Some Street, Chiang Mai',
          plusCode: '8Q7XMPWG+5V',
        },
      }),
    );
    expect(q).toBe('8Q7XMPWG+5V');
  });

  it('transit: plusCode wins over toName/fromName/address', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'transit',
        data: {
          mode: 'train',
          fromName: 'Paddington Station',
          toName: 'Heathrow T5',
          address: 'Heathrow Airport, London',
          plusCode: '9C3XGV4C+VR',
        },
      }),
    );
    expect(q).toBe('9C3XGV4C+VR');
  });

  it('activity: address used when plusCode absent, before falling through to title', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'activity',
        locationName: 'Shibuya',
        data: { title: 'Old Town', address: '1-2-3 Roppongi, Tokyo' },
      }),
    );
    expect(q).toBe('1-2-3 Roppongi, Tokyo');
  });

  it('transit: address used when plusCode absent, before falling through to toName', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'transit',
        data: {
          mode: 'ferry',
          toName: 'Sumida Ferry Terminal',
          address: '2-1-1 Hama-rikyu Gardens, Chuo, Tokyo',
        },
      }),
    );
    expect(q).toBe('2-1-1 Hama-rikyu Gardens, Chuo, Tokyo');
  });

  it('whitespace-only plusCode is treated as unset', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        data: {
          propertyName: 'Hotel California',
          address: '1 Sunset Blvd, Los Angeles',
          plusCode: '   ',
        },
      }),
    );
    expect(q).toBe('1 Sunset Blvd, Los Angeles');
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
