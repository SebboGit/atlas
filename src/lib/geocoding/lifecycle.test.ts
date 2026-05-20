import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Segment } from '@/lib/segments';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn<(work: () => Promise<void>) => void>(),
  getGeocoder: vi.fn(),
  getCachedOrFetch: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  getJobs: () => ({ enqueue: mocks.enqueue }),
}));

vi.mock('./index', () => ({
  getGeocoder: mocks.getGeocoder,
}));

vi.mock('./cache', () => ({
  getCachedOrFetch: mocks.getCachedOrFetch,
}));

import { enqueueGeocodeFetch, geocodeOnSegmentChange } from './lifecycle';

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
  mocks.enqueue.mockImplementation((work) => {
    void work();
  });
  mocks.getGeocoder.mockReturnValue({ geocode: vi.fn() });
  mocks.getCachedOrFetch.mockResolvedValue({ result: null, cached: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geocodeOnSegmentChange — gating', () => {
  it('schedules for a hotel with a propertyName', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'hotel', data: { propertyName: 'Hotel A' } }),
    });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it('schedules for an activity with a title', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'activity', data: { title: 'Mountain' } }),
    });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it('schedules for a transit with a toName', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'transit', data: { mode: 'train', toName: 'Heathrow T5' } }),
    });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does NOT schedule for flight segments — they go through the IATA snapshot', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({
        type: 'flight',
        data: { carrier: 'BA', flightNumber: '287', destinationAirport: 'SFO' },
      }),
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('does NOT schedule for note segments', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'note', data: { body: 'remember visa' } }),
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('does NOT schedule when the segment has no geocodable identity (hotel missing propertyName)', () => {
    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'hotel', data: { address: 'somewhere' } }),
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe('geocodeOnSegmentChange — update path', () => {
  it('does NOT schedule when the derived query is identical to the prior', () => {
    const before = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California' },
      startsAt: new Date('2026-06-01'),
    });
    const after = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California' },
      // Different startsAt — but the geocode query is unchanged.
      startsAt: new Date('2026-06-05'),
    });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('schedules when the propertyName changes', () => {
    const before = makeSegment({ type: 'hotel', data: { propertyName: 'Hotel California' } });
    const after = makeSegment({ type: 'hotel', data: { propertyName: 'Hotel Sakura' } });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it('schedules when the address changes', () => {
    const before = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California', address: '1 Sunset Blvd' },
    });
    const after = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel California', address: '2 Sunset Blvd' },
    });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it('schedules when an activity transitions from missing title to having one', () => {
    // Title is required by the validator, so in practice the prior
    // state would always have one. But buildGeocodeQuery returns null
    // for malformed data, and the lifecycle should treat null→string
    // as "changed" and fire.
    const before = makeSegment({ type: 'activity', data: { description: 'no title' } });
    const after = makeSegment({ type: 'activity', data: { title: 'Eiffel Tower' } });
    geocodeOnSegmentChange({ segment: after, prior: before });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('geocodeOnSegmentChange — job body', () => {
  it('routes the built query through getCachedOrFetch', async () => {
    let captured: (() => Promise<void>) | null = null;
    mocks.enqueue.mockImplementation((work) => {
      captured = work;
    });

    geocodeOnSegmentChange({
      segment: makeSegment({
        type: 'hotel',
        data: { propertyName: 'Hotel Sakura', address: '1-2-3 Roppongi, Tokyo' },
      }),
    });

    expect(captured).not.toBeNull();
    await captured!();
    expect(mocks.getCachedOrFetch).toHaveBeenCalledTimes(1);
    // Address-first: propertyName is excluded from the query to
    // keep Nominatim's q-parser happy. See segment-query.ts.
    expect(mocks.getCachedOrFetch.mock.calls[0]![0]).toBe('1-2-3 Roppongi, Tokyo');
  });

  it('logs and returns when the geocoder factory throws (unconfigured)', async () => {
    mocks.getGeocoder.mockImplementation(() => {
      throw new Error('NOMINATIM_CONTACT_EMAIL is not set');
    });
    let captured: (() => Promise<void>) | null = null;
    mocks.enqueue.mockImplementation((work) => {
      captured = work;
    });

    geocodeOnSegmentChange({
      segment: makeSegment({ type: 'hotel', data: { propertyName: 'Hotel A' } }),
    });
    expect(captured).not.toBeNull();
    await expect(captured!()).resolves.toBeUndefined();
    expect(mocks.getCachedOrFetch).not.toHaveBeenCalled();
  });
});

describe('enqueueGeocodeFetch — per-process dedup', () => {
  // The in-flight Set is module-level state that survives
  // vi.clearAllMocks. Use a unique query per test so prior-test
  // entries don't pollute. Production code is unaffected — Atlas
  // doesn't see the same hotel address from two different test
  // contexts at runtime.

  it('deduplicates concurrent calls for the same normalized query', async () => {
    const captured: Array<() => Promise<void>> = [];
    mocks.enqueue.mockImplementation((work) => {
      captured.push(work);
    });

    enqueueGeocodeFetch('111 dedup ave, testville');
    enqueueGeocodeFetch('  111 Dedup Ave,  testville  '); // same normalized
    enqueueGeocodeFetch('111 DEDUP AVE, TESTVILLE'); // same normalized
    expect(captured).toHaveLength(1);

    // Drain the queued work so the in-flight slot is released —
    // keeps the module-level Set clean for subsequent tests.
    await captured[0]!();
  });

  it('re-enqueues once the prior fetch completes (in-flight slot released)', async () => {
    mocks.enqueue.mockImplementation((work) => {
      void work();
    });

    enqueueGeocodeFetch('222 reentry st, testville');
    // Microtask flush so the first job's `finally` removes the entry.
    await Promise.resolve();
    await Promise.resolve();
    enqueueGeocodeFetch('222 reentry st, testville');

    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  });

  it('short-circuits empty / whitespace-only queries', () => {
    enqueueGeocodeFetch('');
    enqueueGeocodeFetch('   ');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
