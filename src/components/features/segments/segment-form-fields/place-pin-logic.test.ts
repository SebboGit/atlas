import { describe, expect, it } from 'vitest';

import {
  PLACE_PATHS,
  placePinLine,
  placeQueryKey,
  placeStillLocated,
  placeValuesAt,
  trimText,
  valueAt,
} from './place-pin-logic';

describe('placePinLine', () => {
  const located = { lat: 35.6812, lng: 139.7671, city: 'Chiyoda' };
  const base = { address: '', plusCode: '', located, stillLocated: true };

  it('shows a saved or typed Plus Code as pinned, with the address as detail', () => {
    expect(placePinLine({ ...base, plusCode: '8Q7XMQJ8+FV', address: '1-9-1 Marunouchi' })).toEqual(
      {
        state: 'pinned',
        code: '8Q7XMQJ8+FV',
        detail: '1-9-1 Marunouchi',
      },
    );
    expect(
      placePinLine({ ...base, plusCode: 'MQ8R+5C Chiyoda City, Tokyo', located: null }),
    ).toEqual({ state: 'pinned', code: 'MQ8R+5C Chiyoda City, Tokyo', detail: null });
  });

  it('never calls a code the form would reject pinned', () => {
    // A local code needs its anchor to be valid.
    expect(placePinLine({ ...base, plusCode: 'MQ8R+5C', located: null })).toBeNull();
    expect(placePinLine({ ...base, plusCode: '8Q7X', located: null })).toBeNull();
  });

  it('shows where the saved segment located a place, until it would move', () => {
    expect(placePinLine(base)).toEqual({
      state: 'located',
      code: expect.stringMatching(/^8Q7X[A-Z0-9]{4}\+[A-Z0-9]{2}$/),
      detail: 'Chiyoda',
    });
    expect(placePinLine({ ...base, stillLocated: false })).toBeNull();
  });

  it('prefers a typed code over the cached coordinates', () => {
    // The user's own code wins: `located` describes where the segment
    // sat before this edit, the field is where it will sit next.
    expect(placePinLine({ ...base, plusCode: '8Q98HX7P+86', stillLocated: false })).toEqual({
      state: 'pinned',
      code: '8Q98HX7P+86',
      detail: null,
    });
  });

  it('shows no location without cached coordinates', () => {
    expect(placePinLine({ ...base, located: null })).toBeNull();
    expect(placePinLine({ ...base, located: undefined })).toBeNull();
    // Coordinates the encoder rejects can't produce a line either.
    expect(placePinLine({ ...base, located: { lat: Number.NaN, lng: 139.7671 } })).toBeNull();
  });
});

// Form values as the dialog holds them, per segment type.
function hotel(data: Record<string, unknown>, rest: Record<string, unknown> = {}) {
  return {
    type: 'hotel',
    data: { propertyName: 'Park Hyatt Tokyo', ...data },
    locationName: 'Shinjuku',
    countryCode: 'JP',
    ...rest,
  };
}

function train(data: Record<string, unknown>, rest: Record<string, unknown> = {}) {
  return {
    type: 'transit',
    data: { mode: 'train', fromName: 'Tokyo Station', toName: 'Kyoto Station', ...data },
    locationName: 'Tokyo → Kyoto',
    countryCode: 'JP',
    ...rest,
  };
}

describe('placeStillLocated — one-place types', () => {
  it('lets go when the name changes', () => {
    expect(placeStillLocated(hotel({ propertyName: 'Hotel Niwa' }), hotel({}), 'place')).toBe(
      false,
    );
  });

  it('lets go when the location label changes', () => {
    // The label is the query's disambiguation tail (ADR-0018), so the
    // pin moves even though every other field is untouched.
    expect(placeStillLocated(hotel({}, { locationName: 'Ginza' }), hotel({}), 'place')).toBe(false);
  });

  it('lets go when the country changes under a label-less name', () => {
    const saved = hotel({}, { locationName: '', countryCode: 'JP' });
    const current = hotel({}, { locationName: '', countryCode: 'KR' });
    expect(placeStillLocated(current, saved, 'place')).toBe(false);
  });

  it('holds when only the address changes under a stable name', () => {
    // Name-first: the address is informational once a name is on file,
    // so the pin doesn't move and the line stays.
    const saved = hotel({ address: '3-7-1-2 Nishi-Shinjuku' });
    const current = hotel({ address: '3-7-1-2 Nishi-Shinjuku, Tokyo' });
    expect(placeStillLocated(current, saved, 'place')).toBe(true);
  });

  it("treats the form's blank optionals as the keys the saved row never had", () => {
    // What keeps the line from vanishing the instant a dialog opens: RHF
    // holds '' for every registered optional field, the saved row holds
    // nothing at all, and both derive the same query.
    const saved = { type: 'hotel', data: { propertyName: 'Park Hyatt Tokyo' }, countryCode: 'JP' };
    const opened = hotel(
      { address: '', plusCode: '', roomType: '', confirmationNumber: '' },
      { locationName: '' },
    );
    expect(placeStillLocated(opened, saved, 'place')).toBe(true);
  });

  it('lets go when an activity address changes — activities are address-first', () => {
    const saved = {
      type: 'activity',
      data: { title: 'TeamLab Planets', address: '6-1-16 Toyosu' },
      locationName: 'Koto',
      countryCode: 'JP',
    };
    const current = { ...saved, data: { ...saved.data, address: '6-1-16 Toyosu, Koto' } };
    expect(placeStillLocated(current, saved, 'place')).toBe(false);
  });

  it('lets go when a Plus Code is typed, and for values that name nothing', () => {
    expect(placeStillLocated(hotel({ plusCode: '8Q7XMQJ8+FV' }), hotel({}), 'place')).toBe(false);
    expect(placeStillLocated(hotel({ propertyName: '' }), hotel({}), 'place')).toBe(false);
    expect(placeStillLocated(undefined, hotel({}), 'place')).toBe(false);
  });
});

describe('placeStillLocated — transit ends', () => {
  it('holds an origin through a route-label edit', () => {
    // A station key carries the segment's ISO country code and never its
    // locationName, which on transit is route-shaped (ADR-0019 §3).
    const current = train({}, { locationName: 'Tokyo → Osaka' });
    expect(placeStillLocated(current, train({}), 'origin')).toBe(true);
    expect(placeQueryKey(train({}), 'origin')).toBe('station:train:jp:tokyo station');
  });

  it('lets go of the end whose station changed, and holds the other', () => {
    const current = train({ fromName: 'Shinagawa Station' });
    expect(placeStillLocated(current, train({}), 'origin')).toBe(false);
    expect(placeStillLocated(current, train({}), 'destination')).toBe(true);
  });

  it('lets go of both ends when the country changes', () => {
    const current = train({}, { countryCode: 'KR' });
    expect(placeStillLocated(current, train({}), 'origin')).toBe(false);
    expect(placeStillLocated(current, train({}), 'destination')).toBe(false);
  });

  it('gives a car no origin query — it is a single-pin mode', () => {
    const car = train({ mode: 'car' });
    expect(placeQueryKey(car, 'origin')).toBeNull();
    expect(placeStillLocated(car, car, 'origin')).toBe(false);
    expect(placeStillLocated(car, car, 'destination')).toBe(true);
  });
});

describe('placeValuesAt', () => {
  it('reads the three locating fields of one place', () => {
    const values = {
      data: { propertyName: 'Park Hyatt Tokyo', address: '3-7-1-2 Nishi-Shinjuku' },
    };
    expect(placeValuesAt(values, PLACE_PATHS.hotel)).toEqual({
      name: 'Park Hyatt Tokyo',
      address: '3-7-1-2 Nishi-Shinjuku',
      plusCode: undefined,
    });
  });
});

describe('valueAt', () => {
  it('reads a dotted path and tolerates missing branches', () => {
    expect(valueAt({ data: { fromName: 'Tokyo' } }, 'data.fromName')).toBe('Tokyo');
    expect(valueAt({ data: {} }, 'data.fromName')).toBeUndefined();
    expect(valueAt(undefined, 'data.fromName')).toBeUndefined();
  });
});

describe('trimText', () => {
  it('trims strings and flattens everything else to empty', () => {
    expect(trimText('  Ginza ')).toBe('Ginza');
    expect(trimText(undefined)).toBe('');
    expect(trimText(42)).toBe('');
  });
});
