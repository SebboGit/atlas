import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Segment } from '@/lib/segments';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(name: string, data: unknown, opts?: { singletonKey?: string }) => Promise<void>>(),
  getGeocoder: vi.fn(),
  getCachedOrFetch: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  getJobs: () => ({ send: mocks.send }),
}));

vi.mock('./index', () => ({
  getGeocoder: mocks.getGeocoder,
}));

vi.mock('./cache', () => ({
  getCachedOrFetch: mocks.getCachedOrFetch,
}));

import {
  enqueueGeocodeFetch,
  GEOCODE_FETCH_JOB,
  geocodeOnSegmentChange,
  runGeocodeFetchJob,
} from './lifecycle';

function makeSegment(overrides: Partial<Segment>): Segment {
  return {
    id: 'seg-1',
    tripId: 'trip-1',
    type: 'hotel',
    data: { propertyName: 'Hotel California' },
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue();
  mocks.getGeocoder.mockReturnValue({ geocode: vi.fn() });
  mocks.getCachedOrFetch.mockResolvedValue({ result: null, cached: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geocodeOnSegmentChange — gating', () => {
  it('enqueues for a hotel with a propertyName', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'hotel', data: { propertyName: 'Hotel A' } }),
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]![0]).toBe(GEOCODE_FETCH_JOB);
  });

  it('enqueues for an activity with a title', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'activity', data: { title: 'Mountain' } }),
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('enqueues for a transit with a toName', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'transit', data: { mode: 'train', toName: 'Heathrow T5' } }),
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('does NOT enqueue for flight segments — they go through the IATA snapshot', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({
        type: 'flight',
        data: { carrier: 'BA', flightNumber: '287', destinationAirport: 'SFO' },
      }),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does NOT enqueue for note segments', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'note', data: { body: 'remember visa' } }),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does NOT enqueue when the segment has no geocodable identity (hotel missing propertyName)', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'hotel', data: { address: 'somewhere' } }),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('geocodeOnSegmentChange — update path', () => {
  it('does NOT enqueue when the derived query is identical to the prior', () => {
    const before = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California' },
      startsAt: new Date('2026-06-01'),
    });
    const after = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California' },
      startsAt: new Date('2026-06-05'),
    });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('enqueues when the propertyName changes', () => {
    const before = makeSegment({ type: 'hotel', data: { propertyName: 'Hotel California' } });
    const after = makeSegment({ type: 'hotel', data: { propertyName: 'Hotel Sakura' } });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('enqueues when the property name changes', () => {
    // Name-first (ADR-0018): the derived query is built from the
    // propertyName, so that's the field whose change re-geocodes.
    const before = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California', address: '1 Sunset Blvd' },
    });
    const after = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel Kariforunia', address: '1 Sunset Blvd' },
    });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-enqueue when the name changes under a stored Plus Code', () => {
    // Why the edit dialog never saves a code derived from the cached
    // coordinates (#135): a stored code outranks the name, so a rename
    // under one can no longer move the pin. A code the user typed or
    // picked is a deliberate pin and keeps that precedence.
    const before = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California', plusCode: '8Q7XMQJ8+FV' },
    });
    const after = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel Sakura', plusCode: '8Q7XMQJ8+FV' },
    });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('enqueues the name query when a renamed stay carries no Plus Code', () => {
    // The fixed edit path: the form shows the derived code but stores
    // nothing, so the rename re-geocodes by name (ADR-0018).
    const before = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California' },
      countryCode: 'JP',
    });
    const after = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel Sakura' },
      countryCode: 'JP',
    });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]?.[1]).toMatchObject({ query: 'Hotel Sakura, Japan' });
  });

  it('does NOT re-enqueue when only the address changes under a stable name', () => {
    // Consequence of name-first: the address is informational once a
    // name is on file. Wrong-pin fixes go through the Plus Code field
    // or the address picker, not address edits.
    const before = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California', address: '1 Sunset Blvd' },
    });
    const after = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California', address: '2 Sunset Blvd' },
    });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('enqueues when an activity transitions from missing title to having one', () => {
    const before = makeSegment({ type: 'activity', data: { description: 'no title' } });
    const after = makeSegment({ type: 'activity', data: { title: 'Eiffel Tower' } });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});

describe('geocodeOnSegmentChange — transit endpoints (ADR-0019)', () => {
  const train = (data: Record<string, unknown>) =>
    makeSegment({ type: 'transit', countryCode: 'JP', data: { mode: 'train', ...data } });
  const sentQueries = () =>
    mocks.send.mock.calls.map(([, data]) => (data as { query: string }).query);

  it('enqueues both stations when a train is created', () => {
    geocodeOnSegmentChange({
      segment: train({ fromName: 'Tokyo Station', toName: 'Kyoto Station' }),
    });
    expect(sentQueries()).toEqual([
      'station:train:jp:Kyoto Station',
      'station:train:jp:Tokyo Station',
    ]);
  });

  it('enqueues only the origin when a From name is added', () => {
    geocodeOnSegmentChange({
      prior: train({ toName: 'Kyoto Station' }),
      segment: train({ fromName: 'Tokyo Station', toName: 'Kyoto Station' }),
    });
    expect(sentQueries()).toEqual(['station:train:jp:Tokyo Station']);
  });

  it('enqueues only the origin when only the From name changes', () => {
    geocodeOnSegmentChange({
      prior: train({ fromName: 'Shinagawa Station', toName: 'Kyoto Station' }),
      segment: train({ fromName: 'Tokyo Station', toName: 'Kyoto Station' }),
    });
    expect(sentQueries()).toEqual(['station:train:jp:Tokyo Station']);
  });

  it('enqueues nothing for a date-only or case-only edit', () => {
    const before = train({ fromName: 'Tokyo Station', toName: 'Kyoto Station' });
    geocodeOnSegmentChange({
      prior: before,
      segment: { ...before, startsAt: new Date('2026-10-07T09:12:00Z') },
    });
    geocodeOnSegmentChange({
      prior: before,
      segment: train({ fromName: 'tokyo station', toName: 'KYOTO STATION' }),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('enqueues once for a leg that starts and ends at the same station', () => {
    geocodeOnSegmentChange({
      segment: train({ fromName: 'Kyoto Station', toName: 'Kyoto Station' }),
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('enqueues only the destination for a car with both names', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({
        type: 'transit',
        data: { mode: 'car', fromName: 'Florence', toName: 'Siena' },
      }),
    });
    expect(sentQueries()).toEqual(['Siena']);
  });
});

describe('enqueueGeocodeFetch — singleton key', () => {
  it('passes a normalised singletonKey so pg-boss can dedupe cross-process', () => {
    enqueueGeocodeFetch('111 Dedup Ave, Testville');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [name, data, opts] = mocks.send.mock.calls[0]!;
    expect(name).toBe(GEOCODE_FETCH_JOB);
    expect(data).toEqual({ query: '111 Dedup Ave, Testville' });
    expect(typeof opts?.singletonKey).toBe('string');
    expect(opts?.singletonKey?.length).toBeGreaterThan(0);
  });

  it('produces the same singletonKey for equivalent queries (case + whitespace)', () => {
    enqueueGeocodeFetch('222 Reentry St, Testville');
    enqueueGeocodeFetch('  222 reentry st,  testville  ');
    enqueueGeocodeFetch('222 REENTRY ST, TESTVILLE');
    expect(mocks.send).toHaveBeenCalledTimes(3);
    const keys = mocks.send.mock.calls.map((c) => c[2]?.singletonKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('short-circuits empty / whitespace-only queries', () => {
    enqueueGeocodeFetch('');
    enqueueGeocodeFetch('   ');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('runGeocodeFetchJob — handler body', () => {
  it('routes the query through getCachedOrFetch', async () => {
    await runGeocodeFetchJob({ query: '1-2-3 Roppongi, Tokyo' });
    expect(mocks.getCachedOrFetch).toHaveBeenCalledTimes(1);
    expect(mocks.getCachedOrFetch.mock.calls[0]![0]).toBe('1-2-3 Roppongi, Tokyo');
  });

  it('returns without throwing when the geocoder factory throws (unconfigured)', async () => {
    mocks.getGeocoder.mockImplementation(() => {
      throw new Error('NOMINATIM_CONTACT_EMAIL is not set');
    });
    await expect(runGeocodeFetchJob({ query: 'anywhere' })).resolves.toBeUndefined();
    expect(mocks.getCachedOrFetch).not.toHaveBeenCalled();
  });

  it('passes a station key through verbatim — never re-normalized', async () => {
    await runGeocodeFetchJob({ query: 'station:train:jp:Kyoto Station' });
    expect(mocks.getCachedOrFetch.mock.calls[0]![0]).toBe('station:train:jp:Kyoto Station');
  });

  it('short-circuits empty queries', async () => {
    await runGeocodeFetchJob({ query: '   ' });
    expect(mocks.getCachedOrFetch).not.toHaveBeenCalled();
  });
});
