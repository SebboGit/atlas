// Forces a west-of-UTC timezone for THIS WHOLE FILE, before any date math,
// so `resolveRailDays`' continuation fold + check-out stamp are exercised
// off-UTC — the map-rail twin of `continuations.tz.test.ts`. The fold is
// part of the SSR'd markup now (computed on the server AND the client),
// so the contract is INVARIANCE: an off-UTC viewer must fold exactly the
// rows and stamp exactly the day a UTC server rendered, or hydration
// mismatches. Only `position` is viewer-local (and mount-gated). Mirrors
// the ADR-0014 lesson: TZ-dependent rendering needs a non-UTC check.
process.env.TZ = 'America/Los_Angeles';

import { describe, expect, it } from 'vitest';

import {
  resolveRailDays,
  type RailContinuationCandidate,
  type RailDay,
  type RailItem,
} from './timeline-model';

function item(segmentId: string): RailItem {
  return {
    segmentId,
    icon: 'hotel',
    label: 'Hotel',
    locationName: null,
    timeLabel: null,
    country: 'US',
    mapKind: 'pin',
  };
}

function serverDay(
  dateKey: string,
  dayNumber: number,
  items: RailItem[],
  continuationCandidates: RailContinuationCandidate[] = [],
): RailDay {
  return { key: dateKey, dateKey, dayNumber, items, continuationCandidates };
}

describe('resolveRailDays — off-UTC invariance', () => {
  it('folds the same continuation rows and check-out stamp a UTC server renders', () => {
    // Sanity: the forced tz is in effect — 00:00Z is the PRIOR local day.
    expect(new Date(Date.UTC(2026, 5, 1)).getDate()).toBe(31);

    // Date-only hotel (the real validator shape: a YYYY-MM-DD pick → UTC
    // midnight). Checks in 28 May, out 1 Jun. The filled calendar always
    // carries the UTC check-out day (fillDayRange extends through the
    // latest endsAt), so the stamp targets a day that exists.
    const candidate: RailContinuationCandidate = {
      item: { ...item('hotel-1'), continuation: true, continuationSince: '28 May' },
      startsAt: new Date(Date.UTC(2026, 4, 28)),
      endsAt: new Date(Date.UTC(2026, 5, 1)),
      checkOutTime: '11:00',
    };
    const days: RailDay[] = [
      serverDay('2026-05-28', 1, [item('hotel-1')], [candidate]),
      serverDay('2026-05-29', 2, [item('a-1')]),
      serverDay('2026-05-30', 3, [item('a-2')]),
      serverDay('2026-05-31', 4, [item('a-3')]),
      serverDay('2026-06-01', 5, [item('a-4')]),
    ];

    // The continuation fold is clock-free, so assert BOTH the pre-mount
    // (SSR-matching, clientToday null) shape and a mounted viewer's: the
    // folded items must be identical — that identity IS hydration safety.
    const preMount = resolveRailDays(days, null);
    const mounted = resolveRailDays(days, new Date(2026, 4, 31, 12, 0, 0));
    expect(mounted.map((d) => d.items)).toEqual(preMount.map((d) => d.items));

    // Rows on every spanned day after check-in, none on the check-in day.
    const hasCont = (key: string) =>
      mounted.find((d) => d.dateKey === key)!.items.some((i) => i.continuation);
    expect(hasCont('2026-05-28')).toBe(false);
    for (const key of ['2026-05-29', '2026-05-30', '2026-05-31', '2026-06-01']) {
      expect(hasCont(key)).toBe(true);
    }

    // The check-out chip lands on the UTC check-out day — the same day a
    // UTC server stamps — and on no earlier row.
    const contOn = (key: string) =>
      mounted.find((d) => d.dateKey === key)!.items.find((i) => i.segmentId === 'hotel-1')!;
    expect(contOn('2026-06-01').continuationCheckOut).toBe('11:00');
    for (const key of ['2026-05-29', '2026-05-30', '2026-05-31']) {
      expect(contOn(key).continuationCheckOut ?? null).toBeNull();
    }
  });
});
