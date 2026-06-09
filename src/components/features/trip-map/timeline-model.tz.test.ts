// Forces a west-of-UTC timezone for THIS WHOLE FILE, before any date math,
// so `resolveRailDays`' check-out stamp is exercised off-UTC — the map-rail
// twin of `continuations.tz.test.ts`. CI runs in UTC and would otherwise
// never see the skew: a date-only hotel's `endsAt` is `00:00Z`, whose LOCAL
// day sits a day earlier west of UTC, so the stay's last continuation row
// renders on an EARLIER token than the UTC day of `endsAt`. The stamp must
// match on that local-day basis (the same one row-gating uses) or the
// check-out time lands on a day with no row and vanishes. Mirrors the
// ADR-0014 lesson: TZ-dependent rendering needs a non-UTC check.
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

describe('resolveRailDays — off-UTC check-out stamp', () => {
  it('stamps the check-out on the last day the stay renders, not the UTC day of endsAt', () => {
    // Sanity: the forced tz is in effect — 00:00Z is the PRIOR local day.
    expect(new Date(Date.UTC(2026, 5, 1)).getDate()).toBe(31);

    // Date-only hotel (the real validator shape: a YYYY-MM-DD pick → UTC
    // midnight). Checks in 28 May, out 1 Jun → endsAt at 2026-06-01T00:00Z.
    // West of UTC the stay's last rendered day is 31 May, so the chip must
    // land there; a UTC match would target "2026-06-01" (a day with no row)
    // and drop the time entirely.
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
    ];
    // today = 31 May (local) → 28-30 May collapse (past), so the hotel is a
    // continuation candidate from a collapsed day, folded onto 31 May (today).
    const out = resolveRailDays(days, new Date(2026, 4, 31, 12, 0, 0));
    const may31 = out.find((d) => d.dateKey === '2026-05-31')!;
    const cont = may31.items.find((i) => i.segmentId === 'hotel-1')!;
    // The continuation renders on 31 May and carries the check-out chip.
    expect(cont.continuation).toBe(true);
    expect(cont.continuationCheckOut).toBe('11:00');
    // And no spurious 2026-06-01 day exists for a UTC match to have used.
    expect(out.some((d) => d.dateKey === '2026-06-01')).toBe(false);
  });
});
