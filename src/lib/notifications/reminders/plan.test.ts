import { describe, expect, it } from 'vitest';

import {
  connectingLegIds,
  dueReminders,
  GRACE_MS,
  planReminders,
  type PlannedReminder,
  type ReminderSegment,
} from './plan';

// Floating wall-clock helper: the UTC fields ARE the printed time.
const wall = (iso: string) => new Date(`${iso}Z`);
const iso = (epoch: number) => new Date(epoch).toISOString();

function seg(overrides: Partial<ReminderSegment>): ReminderSegment {
  return {
    id: 's1',
    tripId: 't1',
    type: 'flight',
    startsAt: null,
    endsAt: null,
    data: {},
    locationName: null,
    zone: 'Asia/Tokyo',
    ...overrides,
  };
}

const byKind = (rs: PlannedReminder[]) => Object.fromEntries(rs.map((r) => [r.kind, r]));

describe('flights', () => {
  const flight = seg({
    startsAt: wall('2026-11-10T14:00:00'),
    data: { flightNumber: 'NH210', originAirport: 'HND', destinationAirport: 'CDG' },
  });

  it('fires 24h and 4h before departure, local to the airport', () => {
    const r = byKind(planReminders(flight));
    // 14:00 JST is 05:00 UTC.
    expect(iso(r['flight-24h']!.fireAt)).toBe('2026-11-09T05:00:00.000Z');
    expect(iso(r['flight-4h']!.fireAt)).toBe('2026-11-10T01:00:00.000Z');
    expect(r['flight-24h']!.title).toBe('NH210 departs tomorrow 14:00');
    expect(r['flight-4h']!.title).toBe('NH210 departs 14:00');
    expect(r['flight-4h']!.body).toBe('HND → CDG');
    expect(r['flight-4h']!.category).toBe('flights');
  });

  it('moves a reminder that would land at night to 22:00 the evening before', () => {
    const early = { ...flight, startsAt: wall('2026-11-10T06:00:00') };
    const r = byKind(planReminders(early));
    // 4h before 06:00 is 02:00 → 22:00 on the 9th (13:00 UTC).
    expect(iso(r['flight-4h']!.fireAt)).toBe('2026-11-09T13:00:00.000Z');
    expect(r['flight-4h']!.title).toBe('NH210 departs tomorrow 06:00');
    // 24h before is 06:00 on the 9th, still inside the night window, so it
    // also moves: to 22:00 on the 8th, two evenings ahead.
    expect(iso(r['flight-24h']!.fireAt)).toBe('2026-11-08T13:00:00.000Z');
    expect(r['flight-24h']!.title).toBe('NH210 departs Tue 06:00');
  });

  it('leaves a daytime reminder where it is', () => {
    const r = byKind(planReminders({ ...flight, startsAt: wall('2026-11-10T09:00:00') }));
    // 24h before 09:00 is 09:00 on the 9th.
    expect(iso(r['flight-24h']!.fireAt)).toBe('2026-11-09T00:00:00.000Z');
  });

  it('names the weekday when a moved reminder lands two days ahead', () => {
    const r = byKind(planReminders({ ...flight, startsAt: wall('2026-11-10T01:00:00') }));
    // 24h before 01:00 Tue is 01:00 Mon → 22:00 Sun.
    expect(r['flight-24h']!.title).toBe('NH210 departs Tue 01:00');
  });

  it('gives a connecting leg no reminders of its own', () => {
    expect(planReminders({ ...flight, isConnection: true })).toEqual([]);
  });

  it('says "today" at 09:00 for a flight with no time', () => {
    const r = planReminders({ ...flight, startsAt: wall('2026-11-10T00:00:00') });
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('today');
    expect(r[0]!.title).toBe('NH210 today');
    expect(iso(r[0]!.fireAt)).toBe('2026-11-10T00:00:00.000Z');
  });
});

describe('transit', () => {
  it('fires 3h before a train with the route as body', () => {
    const [r] = planReminders(
      seg({
        type: 'transit',
        zone: 'Asia/Shanghai',
        startsAt: wall('2026-10-16T12:38:00'),
        data: { mode: 'train', fromName: 'Guangzhoudong', toName: 'West Kowloon' },
      }),
    );
    expect(r!.title).toBe('Train departs 12:38');
    expect(r!.body).toBe('Guangzhoudong → West Kowloon');
    expect(r!.tags).toEqual(['train']);
    expect(iso(r!.fireAt)).toBe('2026-10-16T01:38:00.000Z');
  });

  it('reads as a pick-up time for a car leg', () => {
    const [r] = planReminders(
      seg({ type: 'transit', startsAt: wall('2026-10-16T08:00:00'), data: { mode: 'car' } }),
    );
    // 05:00 is night → 22:00 the evening before.
    expect(r!.title).toBe('Car tomorrow at 08:00');
  });
});

describe('hotels', () => {
  const hotel = seg({
    type: 'hotel',
    startsAt: wall('2026-10-12T15:00:00'),
    endsAt: wall('2026-10-16T12:00:00'),
    data: { propertyName: 'Royal Garden Hotel' },
  });

  it('reminds 3h before check-in and at 20:00 the evening before check-out', () => {
    const r = byKind(planReminders(hotel));
    expect(r.checkin!.title).toBe('Check-in 15:00');
    expect(r.checkin!.body).toBe('Royal Garden Hotel');
    expect(iso(r.checkin!.fireAt)).toBe('2026-10-12T03:00:00.000Z');
    expect(r.checkout!.title).toBe('Check out tomorrow by 12:00');
    // 20:00 JST on the 15th.
    expect(iso(r.checkout!.fireAt)).toBe('2026-10-15T11:00:00.000Z');
    expect(r.checkout!.category).toBe('hotels');
  });

  it('uses a 09:00 "today" reminder when check-in has no time', () => {
    const r = byKind(
      planReminders({
        ...hotel,
        startsAt: wall('2026-10-12T00:00:00'),
        endsAt: wall('2026-10-13T00:00:00'),
      }),
    );
    expect(r.today!.title).toBe('Check-in today');
    expect(iso(r.today!.fireAt)).toBe('2026-10-12T00:00:00.000Z');
    // One night: the evening before check-out is the check-in evening.
    expect(r.checkout!.title).toBe('Check out tomorrow');
  });

  it('keeps the check-out note for a late check-in', () => {
    const r = byKind(
      planReminders({
        ...hotel,
        startsAt: wall('2026-10-01T21:30:00'),
        endsAt: wall('2026-10-02T11:00:00'),
      }),
    );
    expect(r.checkout!.title).toBe('Check out tomorrow by 11:00');
  });

  it('skips the check-out note on a day-use stay', () => {
    const r = planReminders({
      ...hotel,
      startsAt: wall('2026-10-12T10:00:00'),
      endsAt: wall('2026-10-12T18:00:00'),
    });
    expect(r.map((x) => x.kind)).toEqual(['checkin']);
  });
});

describe('activities and food', () => {
  it('fires 1h before a reservation', () => {
    const [r] = planReminders(
      seg({
        type: 'food',
        startsAt: wall('2026-10-14T19:30:00'),
        data: { venue: 'Narisawa' },
        locationName: 'Minato',
      }),
    );
    expect(r!.title).toBe('Narisawa at 19:30');
    expect(r!.body).toBe('Minato');
    expect(r!.privateTitle).toBe('Food at 19:30');
    expect(r!.privateBody).toBe('Private trip');
    expect(r!.category).toBe('plans');
  });

  it('moves an early-morning plan to the evening before', () => {
    const [r] = planReminders(
      seg({ type: 'activity', startsAt: wall('2026-10-14T07:30:00'), data: { title: 'Tsukiji' } }),
    );
    expect(r!.title).toBe('Tsukiji tomorrow at 07:30');
  });

  it('says "today" for a date-only activity', () => {
    const [r] = planReminders(
      seg({
        type: 'activity',
        startsAt: wall('2026-10-14T00:00:00'),
        data: { title: 'Fushimi Inari' },
      }),
    );
    expect(r!.title).toBe('Today: Fushimi Inari');
  });
});

describe('planReminders', () => {
  it('plans nothing without a zone or a date', () => {
    expect(planReminders(seg({ startsAt: wall('2026-10-14T10:00:00'), zone: null }))).toEqual([]);
    expect(planReminders(seg({ startsAt: null }))).toEqual([]);
  });

  it('keeps a DST change out of the lead time', () => {
    // Berlin falls back on 2026-10-25 at 03:00. 24h before 10:00 CET on
    // the 25th is 11:00 CEST on the 24th — exactly 24 real hours.
    const r = byKind(
      planReminders(
        seg({ zone: 'Europe/Berlin', startsAt: wall('2026-10-25T10:00:00'), data: {} }),
      ),
    );
    expect(r['flight-4h']!.eventAt - r['flight-24h']!.fireAt).toBe(24 * 3_600_000);
  });
});

describe('dueReminders', () => {
  const base: Omit<PlannedReminder, 'segmentId' | 'fireAt' | 'eventAt'> = {
    tripId: 't1',
    kind: 'plan',
    category: 'plans',
    title: '',
    body: '',
    privateTitle: '',
    privateBody: '',
    tags: [],
  };
  const now = Date.UTC(2026, 9, 14, 12);

  it('sends what is due, skips what is past the grace period, ignores the rest', () => {
    const due = dueReminders(
      [
        { ...base, segmentId: 'on-time', fireAt: now - 60_000, eventAt: now + 3_600_000 },
        { ...base, segmentId: 'late', fireAt: now - GRACE_MS - 1, eventAt: now + 3_600_000 },
        { ...base, segmentId: 'future', fireAt: now + 60_000, eventAt: now + 3_600_000 },
        { ...base, segmentId: 'started', fireAt: now - 60_000, eventAt: now - 1 },
      ],
      now,
    );
    expect(due.map((d) => [d.reminder.segmentId, d.status])).toEqual([
      ['on-time', 'send'],
      ['late', 'skip'],
    ]);
  });
});

describe('connectingLegIds', () => {
  const h = 3_600_000;
  it('flags a leg leaving soon after an earlier leg on the same booking lands', () => {
    const ids = connectingLegIds([
      { id: 'a', bookingKeys: ['pnr:ABC123'], departAt: 0, arriveAt: 2 * h },
      { id: 'b', bookingKeys: ['pnr:ABC123'], departAt: 4 * h, arriveAt: 9 * h },
      { id: 'c', bookingKeys: ['pnr:ABC123'], departAt: 30 * h, arriveAt: 32 * h },
      { id: 'd', bookingKeys: ['pnr:XYZ999'], departAt: 5 * h, arriveAt: 6 * h },
      { id: 'e', bookingKeys: [], departAt: 3 * h, arriveAt: 4 * h },
    ]);
    expect([...ids].sort()).toEqual(['b']);
  });

  it('links legs through a shared document', () => {
    const ids = connectingLegIds([
      { id: 'a', bookingKeys: ['doc:1'], departAt: 0, arriveAt: 2 * h },
      { id: 'b', bookingKeys: ['doc:1', 'pnr:QQ'], departAt: 5 * h, arriveAt: null },
    ]);
    expect([...ids]).toEqual(['b']);
  });
});
