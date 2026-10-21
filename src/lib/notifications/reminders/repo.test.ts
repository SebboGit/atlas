// DB-integration tests for the reminder queries and tables (ADR-0020).
// Skipped cleanly when DATABASE_URL is unset.

import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notificationDeliveries, segments, trips, users } from '@/db/schema';
import { DELIVERY_RETENTION_MS, runPrune } from '@/lib/maintenance/prune';

import {
  getTripReminderState,
  isTripMuted,
  listReminderCandidates,
  listTripMutes,
  recordDelivery,
  setTripMuted,
  updateNotificationSettings,
} from '../repo';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const ALL_ON = { extraction: true, flights: true, transit: true, hotels: true, plans: true };

describeIfDb('notifications.repo reminders', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  const tripIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
  });

  afterAll(async () => {
    if (tripIds.length > 0) await db.delete(trips).where(inArray(trips.id, tripIds));
    await pool.end();
  });

  async function makeUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `remind-${randomUUID()}@test.invalid`, sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    return u!.id;
  }

  async function makeTrip(
    userId: string,
    opts: {
      visibility?: 'household' | 'private';
      status?: 'planned' | 'completed' | 'archived';
    } = {},
  ): Promise<string> {
    const [t] = await db
      .insert(trips)
      .values({
        userId,
        title: 'Reminder fixture',
        status: opts.status ?? 'planned',
        visibility: opts.visibility ?? 'household',
      })
      .returning({ id: trips.id });
    tripIds.push(t!.id);
    return t!.id;
  }

  async function makeSegment(
    tripId: string,
    values: Partial<typeof segments.$inferInsert> & { type: 'flight' | 'hotel' | 'note' },
  ): Promise<string> {
    const [s] = await db
      .insert(segments)
      .values({ tripId, data: {}, ...values })
      .returning({ id: segments.id });
    return s!.id;
  }

  // A far-future window no other test writes into.
  const from = new Date('2091-03-01T00:00:00Z');
  const to = new Date('2091-03-04T00:00:00Z');

  it('lists dated segments and hotel check-outs in the window, for planned and active trips', async () => {
    const owner = await makeUser();
    const trip = await makeTrip(owner);
    const archived = await makeTrip(owner, { status: 'archived' });
    const completed = await makeTrip(owner, { status: 'completed' });
    const inWindow = await makeSegment(trip, {
      type: 'flight',
      startsAt: new Date('2091-03-02T10:00:00Z'),
    });
    const checkout = await makeSegment(trip, {
      type: 'hotel',
      startsAt: new Date('2091-02-20T15:00:00Z'),
      endsAt: new Date('2091-03-02T11:00:00Z'),
    });
    const outside = await makeSegment(trip, {
      type: 'flight',
      startsAt: new Date('2091-04-01T10:00:00Z'),
    });
    const note = await makeSegment(trip, {
      type: 'note',
      startsAt: new Date('2091-03-02T10:00:00Z'),
      data: { body: 'x' },
    });
    const onArchived = await makeSegment(archived, {
      type: 'flight',
      startsAt: new Date('2091-03-02T10:00:00Z'),
    });
    const onCompleted = await makeSegment(completed, {
      type: 'flight',
      startsAt: new Date('2091-03-02T10:00:00Z'),
    });

    const ids = (await listReminderCandidates(from, to)).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([inWindow, checkout]));
    expect(ids).not.toContain(outside);
    expect(ids).not.toContain(note);
    expect(ids).not.toContain(onArchived);
    expect(ids).not.toContain(onCompleted);
  });

  it('records a reminder once per topic', async () => {
    const owner = await makeUser();
    const trip = await makeTrip(owner);
    const segmentId = await makeSegment(trip, {
      type: 'flight',
      startsAt: new Date('2091-03-02T10:00:00Z'),
    });
    const base = {
      kind: 'flight-4h',
      segmentId,
      eventAt: new Date('2091-03-02T06:00:00Z'),
      fireAt: new Date('2091-03-01T13:00:00Z'),
      status: 'queued' as const,
    };
    expect(await recordDelivery({ ...base, topic: 'a' })).toEqual(expect.any(String));
    expect(await recordDelivery({ ...base, topic: 'a' })).toBeNull();
    expect(await recordDelivery({ ...base, topic: 'b' })).toEqual(expect.any(String));
    // Moved from 06:00 to 07:30 after its 22:00 reminder went out: same
    // fire time (the night rule), new event time, so a corrected reminder.
    expect(
      await recordDelivery({ ...base, topic: 'a', eventAt: new Date('2091-03-02T07:30:00Z') }),
    ).toEqual(expect.any(String));
  });

  it('hands back a reminder stuck as queued, once', async () => {
    const owner = await makeUser();
    const trip = await makeTrip(owner);
    const segmentId = await makeSegment(trip, {
      type: 'flight',
      startsAt: new Date('2091-03-02T10:00:00Z'),
    });
    const key = {
      topic: 'a',
      kind: 'flight-4h',
      segmentId,
      eventAt: new Date('2091-03-02T06:00:00Z'),
      fireAt: new Date('2091-03-01T13:00:00Z'),
    };
    // The worker died after writing the row and before queueing the send.
    const [row] = await db
      .insert(notificationDeliveries)
      .values({ ...key, createdAt: new Date(Date.now() - 15 * 60_000) })
      .returning({ id: notificationDeliveries.id });

    expect(await recordDelivery({ ...key, status: 'queued' })).toBe(row!.id);
    // Re-stamped on the hand-back, so the next sweep leaves it alone.
    expect(await recordDelivery({ ...key, status: 'queued' })).toBeNull();
  });

  it('mutes a trip per user, and only a trip the user can see', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const shared = await makeTrip(owner);
    const priv = await makeTrip(owner, { visibility: 'private' });

    expect(await setTripMuted(other, shared, true)).toBe(true);
    expect(await isTripMuted(other, shared)).toBe(true);
    expect(await isTripMuted(owner, shared)).toBe(false);
    expect(await listTripMutes([shared])).toEqual(new Set([`${other}:${shared}`]));

    expect(await setTripMuted(other, priv, true)).toBe(false);
    expect(await isTripMuted(other, priv)).toBe(false);

    expect(await setTripMuted(other, shared, false)).toBe(true);
    expect(await isTripMuted(other, shared)).toBe(false);
  });

  it('offers the mute switch only to a user with notifications on', async () => {
    const userId = await makeUser();
    const trip = await makeTrip(userId);
    expect(await getTripReminderState(userId, trip)).toBeNull();
    // On, but no topic of their own and (in tests) no server default:
    // nothing would be sent, so nothing to mute.
    await updateNotificationSettings(userId, { enabled: true, topic: null, prefs: ALL_ON });
    expect(await getTripReminderState(userId, trip)).toBeNull();
    await updateNotificationSettings(userId, { enabled: true, topic: 'mine', prefs: ALL_ON });
    expect(await getTripReminderState(userId, trip)).toEqual({ muted: false });
  });

  it('prunes delivery history older than the retention period', async () => {
    const owner = await makeUser();
    const trip = await makeTrip(owner);
    const segmentId = await makeSegment(trip, {
      type: 'flight',
      startsAt: new Date('2091-03-02T10:00:00Z'),
    });
    const now = new Date();
    const [old] = await db
      .insert(notificationDeliveries)
      .values({
        topic: 'old',
        kind: 'flight-4h',
        segmentId,
        eventAt: now,
        fireAt: now,
        createdAt: new Date(now.getTime() - DELIVERY_RETENTION_MS - 60_000),
      })
      .returning({ id: notificationDeliveries.id });
    const [fresh] = await db
      .insert(notificationDeliveries)
      .values({ topic: 'fresh', kind: 'flight-4h', segmentId, eventAt: now, fireAt: now })
      .returning({ id: notificationDeliveries.id });

    await runPrune(
      db as never,
      { sessions: false, tokens: false, geocode: false, deliveries: true },
      now,
      true,
    );
    const left = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.segmentId, segmentId));
    expect(left.map((r) => r.id)).toEqual([fresh!.id]);
    expect(old).toBeDefined();
  });
});
