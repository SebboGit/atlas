import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReminderCandidateRow, ReminderRecipient } from '../repo';

const mocks = vi.hoisted(() => ({
  configured: vi.fn<() => boolean>(),
  deploymentTopic: vi.fn<() => string | null>(),
  enqueue: vi.fn(),
  recipients: vi.fn<() => Promise<ReminderRecipient[]>>(),
  candidates: vi.fn<() => Promise<ReminderCandidateRow[]>>(),
  mutes: vi.fn<() => Promise<Set<string>>>(),
  docs: vi.fn<() => Promise<Map<string, string[]>>>(),
  record: vi.fn(),
  mark: vi.fn(),
  coords: vi.fn(),
}));

vi.mock('../index', () => ({
  notificationsConfigured: mocks.configured,
  deploymentTopic: mocks.deploymentTopic,
}));
vi.mock('../job', () => ({ enqueueNotification: mocks.enqueue }));
vi.mock('../repo', () => ({
  listReminderRecipients: mocks.recipients,
  listReminderCandidates: mocks.candidates,
  listTripMutes: mocks.mutes,
  documentIdsBySegment: mocks.docs,
  recordDelivery: mocks.record,
  markDelivery: mocks.mark,
}));
vi.mock('@/lib/geocoding/place-coords', () => ({ getPlaceCoordsView: mocks.coords }));

import { runReminderSweep } from './sweep';

const ALL_ON = { extraction: true, flights: true, transit: true, hotels: true, plans: true };
const wall = (iso: string) => new Date(`${iso}Z`);

// NH210 leaves Haneda at 14:00 JST (05:00 UTC); its 4h reminder is due
// at 01:00 UTC. The sweep runs two minutes later.
const NOW = new Date('2026-11-10T01:02:00Z');
const flight: ReminderCandidateRow = {
  id: 'seg-flight',
  tripId: 'trip-1',
  type: 'flight',
  data: { flightNumber: 'NH210', originAirport: 'HND', destinationAirport: 'CDG' },
  startsAt: wall('2026-11-10T14:00:00'),
  endsAt: null,
  locationName: null,
  countryCode: 'JP',
  tripOwnerId: 'user-a',
  tripVisibility: 'household',
};

const userA: ReminderRecipient = { userId: 'user-a', topic: null, prefs: ALL_ON };
const userB: ReminderRecipient = { userId: 'user-b', topic: 'b-own', prefs: ALL_ON };

let nextId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  nextId = 0;
  mocks.configured.mockReturnValue(true);
  mocks.deploymentTopic.mockReturnValue('shared');
  mocks.enqueue.mockResolvedValue('queued');
  mocks.recipients.mockResolvedValue([userA, userB]);
  mocks.candidates.mockResolvedValue([flight]);
  mocks.mutes.mockResolvedValue(new Set());
  mocks.docs.mockResolvedValue(new Map());
  mocks.record.mockImplementation(async () => `delivery-${++nextId}`);
  mocks.coords.mockResolvedValue({ coordsById: new Map(), pendingCount: 0 });
});

const topicsQueued = () => mocks.enqueue.mock.calls.map(([data]) => data.topic).sort();

describe('runReminderSweep', () => {
  it('sends a due reminder once to each topic among the trip members', async () => {
    const counts = await runReminderSweep(NOW);
    expect(topicsQueued()).toEqual(['b-own', 'shared']);
    expect(counts.queued).toBe(2);
    expect(mocks.enqueue.mock.calls[0]![0]).toMatchObject({
      category: 'flights',
      title: 'NH210 departs 14:00',
      body: 'HND → CDG',
      path: '/trips/trip-1/itinerary#seg-seg-flight',
    });
    const queuedRows = mocks.record.mock.calls.map(([d]) => d).filter((d) => d.status === 'queued');
    expect(queuedRows[0]).toMatchObject({
      kind: 'flight-4h',
      segmentId: 'seg-flight',
      fireAt: new Date('2026-11-10T01:00:00Z'),
    });
    // The 24h reminder came due yesterday; it is recorded, not sent.
    expect(
      mocks.record.mock.calls.filter(([d]) => d.kind === 'flight-24h').map(([d]) => d.status),
    ).toEqual(['skipped', 'skipped']);
  });

  it('sends once when two members share a topic', async () => {
    mocks.recipients.mockResolvedValue([userA, { ...userB, topic: null }]);
    await runReminderSweep(NOW);
    expect(topicsQueued()).toEqual(['shared']);
  });

  it('keeps a private trip to its owner and its names off the shared topic', async () => {
    mocks.candidates.mockResolvedValue([{ ...flight, tripVisibility: 'private' }]);
    await runReminderSweep(NOW);
    expect(topicsQueued()).toEqual(['shared']);
    expect(mocks.enqueue.mock.calls[0]![0]).toMatchObject({
      title: 'Flight departs 14:00',
      body: 'Private trip',
    });
  });

  it("keeps the names on a private trip owner's own topic", async () => {
    mocks.recipients.mockResolvedValue([{ ...userA, topic: 'a-own' }]);
    mocks.candidates.mockResolvedValue([{ ...flight, tripVisibility: 'private' }]);
    await runReminderSweep(NOW);
    expect(mocks.enqueue.mock.calls[0]![0].title).toBe('NH210 departs 14:00');
  });

  it('leaves out members who muted the trip or switched the kind off', async () => {
    mocks.mutes.mockResolvedValue(new Set(['user-b:trip-1']));
    mocks.recipients.mockResolvedValue([{ ...userA, prefs: { ...ALL_ON, flights: false } }, userB]);
    await runReminderSweep(NOW);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('records an overdue reminder as skipped instead of sending it', async () => {
    const counts = await runReminderSweep(new Date('2026-11-10T01:45:00Z'));
    expect(mocks.record.mock.calls.every(([d]) => d.status === 'skipped')).toBe(true);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    // Both reminders, on both topics.
    expect(counts.skipped).toBe(4);
  });

  it('does not send a reminder already recorded for that topic', async () => {
    mocks.record.mockResolvedValue(null);
    await runReminderSweep(NOW);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('marks the delivery failed when the send cannot be queued', async () => {
    mocks.enqueue.mockResolvedValue('failed');
    await runReminderSweep(NOW);
    expect(mocks.mark).toHaveBeenCalledWith(expect.stringMatching(/^delivery-/), 'failed');
  });

  it('does nothing without a server or anyone opted in', async () => {
    mocks.configured.mockReturnValue(false);
    await runReminderSweep(NOW);
    mocks.configured.mockReturnValue(true);
    mocks.recipients.mockResolvedValue([]);
    await runReminderSweep(NOW);
    expect(mocks.candidates).not.toHaveBeenCalled();
  });

  it("times a transit leg by its origin's pin", async () => {
    // Hong Kong is UTC+8: the 3h reminder for 12:38 is due at 01:38 UTC.
    mocks.candidates.mockResolvedValue([
      {
        ...flight,
        id: 'seg-train',
        type: 'transit',
        data: { mode: 'train', fromName: 'Guangzhoudong', toName: 'West Kowloon' },
        startsAt: wall('2026-10-16T12:38:00'),
        countryCode: null,
      },
    ]);
    mocks.coords.mockResolvedValue({
      coordsById: new Map([
        [
          'seg-train',
          {
            lat: 22.3,
            lng: 114.17,
            city: null,
            endpoints: { origin: { lat: 23.15, lng: 113.32, city: null }, destination: null },
          },
        ],
      ]),
      pendingCount: 0,
    });
    await runReminderSweep(new Date('2026-10-16T01:39:00Z'));
    expect(mocks.enqueue.mock.calls[0]![0]).toMatchObject({ title: 'Train departs 12:38' });
  });

  it('plans nothing for a segment whose zone cannot be told', async () => {
    mocks.candidates.mockResolvedValue([
      { ...flight, id: 'seg-hotel', type: 'hotel', data: { propertyName: 'X' }, countryCode: 'US' },
    ]);
    const counts = await runReminderSweep(NOW);
    expect(counts.noZone).toBe(1);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('suppresses a connecting leg on the same booking', async () => {
    // HND 08:00 → ITM 09:10, then ITM 11:00 → FUK on the same PNR. The
    // second leg's 4h reminder (07:00 JST, 22:00 UTC) would be due now.
    const leg1 = {
      ...flight,
      id: 'leg-1',
      data: {
        flightNumber: 'NH21',
        originAirport: 'HND',
        destinationAirport: 'ITM',
        pnr: 'abc123',
      },
      startsAt: wall('2026-11-10T08:00:00'),
      endsAt: wall('2026-11-10T09:10:00'),
    };
    const leg2 = {
      ...flight,
      id: 'leg-2',
      data: {
        flightNumber: 'NH25',
        originAirport: 'ITM',
        destinationAirport: 'FUK',
        pnr: 'ABC123',
      },
      startsAt: wall('2026-11-10T11:00:00'),
      endsAt: null,
    };
    mocks.candidates.mockResolvedValue([leg1, leg2]);
    await runReminderSweep(new Date('2026-11-09T22:01:00Z'));
    expect(mocks.record.mock.calls.some(([d]) => d.segmentId === 'leg-2')).toBe(false);
  });
});
