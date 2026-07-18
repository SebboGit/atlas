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
  it('name-first: propertyName wins over the address (ADR-0018)', () => {
    // The Photon → Nominatim ladder makes venue names the reliable
    // signal; the address's building/floor tails are what used to
    // null out. No locationName and no country on the row → the bare
    // name is the whole query.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        data: { propertyName: 'Hotel California', address: '1 Sunset Blvd, Los Angeles' },
      }),
    );
    expect(q).toBe('Hotel California');
  });

  it('appends the country name as context when the row has one but no locationName', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        countryCode: 'US',
        data: { propertyName: 'Hotel California', address: '1 Sunset Blvd, Los Angeles' },
      }),
    );
    expect(q).toBe('Hotel California, United States');
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

  it('locationName beats the country as the context tail', () => {
    // "Hotel Sakura, Shibuya" — the pin label is more specific than
    // the country and wins; the address stays out of name queries.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        locationName: 'Shibuya',
        countryCode: 'JP',
        data: { propertyName: 'Hotel Sakura', address: '1-2-3 Roppongi, Tokyo' },
      }),
    );
    expect(q).toBe('Hotel Sakura, Shibuya');
  });

  it('returns null for a whitespace-only propertyName — the schema rejects it before any fallback', () => {
    // hotelDataSchema requires a non-empty trimmed propertyName, so
    // the in-code address fallback is defence-in-depth, not a live
    // path: malformed data nulls out at the parse gate.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        data: { propertyName: '   ', address: '1 Sunset Blvd, Los Angeles' },
      }),
    );
    expect(q).toBeNull();
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

  it('appends the country name when the row has one but no locationName', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'activity',
        countryCode: 'TH',
        data: { title: 'Old Town' },
      }),
    );
    expect(q).toBe('Old Town, Thailand');
  });

  it('returns null when title is missing', () => {
    const q = buildGeocodeQuery(
      makeSegment({ type: 'activity', data: { description: 'no title here' } }),
    );
    expect(q).toBeNull();
  });
});

describe('buildGeocodeQuery — food', () => {
  it('name-first: venue wins over the address, same rule as hotels (ADR-0018)', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        data: { venue: 'Narisawa', address: '2-6-15 Minami-Aoyama, Minato, Tokyo' },
      }),
    );
    expect(q).toBe('Narisawa');
  });

  it('venue + locationName wins even when an address is on file', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        locationName: 'Ginza',
        data: { venue: 'Ippudo', address: '4-10-3 Ginza, Chuo, Tokyo' },
      }),
    );
    expect(q).toBe('Ippudo, Ginza');
  });

  it('appends the country name when the row has one but no locationName', () => {
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        countryCode: 'JP',
        data: { venue: 'Ippudo' },
      }),
    );
    expect(q).toBe('Ippudo, Japan');
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
    expect(q).toBe('Hotel California');
  });
});

describe('buildGeocodeQuery — name protection vs address stripping (ADR-0018 review)', () => {
  it('never address-strips tokens from name-first queries', () => {
    // "Room 39" is a real Bangkok venue; the address normalizer's
    // unit-designator rule would reduce "Room 39, Bangkok" to
    // "Bangkok" — a plausible-looking wrong pin cached for 90 days.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        locationName: 'Bangkok',
        data: { venue: 'Room 39' },
      }),
    );
    expect(q).toBe('Room 39, Bangkok');
  });

  it('keeps number-branded hotel names intact under a country tail', () => {
    // "Hotel 1898" (Barcelona) — the trailing-4-digit postcode rule
    // must not fire on the name part.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'hotel',
        countryCode: 'ES',
        data: { propertyName: 'Hotel 1898' },
      }),
    );
    expect(q).toBe('Hotel 1898, Spain');
  });

  it('skips the country tail when the code does not resolve', () => {
    // countryName echoes unknown codes back; "Sushi Zen, JA" is a
    // junk token that costs matches the bare name would have made.
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'food',
        countryCode: 'JA',
        data: { venue: 'Sushi Zen' },
      }),
    );
    expect(q).toBe('Sushi Zen');
  });

  it('still address-strips the name-less fallback branches', () => {
    // Address branches keep the full normalizer — the JP postcode
    // tail comes off inside buildGeocodeQuery now (normalization
    // moved in; call sites no longer re-apply it).
    const q = buildGeocodeQuery(
      makeSegment({
        type: 'activity',
        data: { title: 'Ghibli Museum', address: '1-1-83 Simorenjaku, Mitaka, Tokyo 181-0013' },
      }),
    );
    expect(q).toBe('1-1-83 Simorenjaku, Mitaka, Tokyo');
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
