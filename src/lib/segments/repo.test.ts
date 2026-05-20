// DB-integration tests for the segments repo. Skipped cleanly when
// DATABASE_URL is unset, mirroring documents/repo.test.ts and
// auth/jit-user.test.ts. Focused on the dedup comparator in
// findFlightByKey — the rest of the repo is covered by the mocked
// action / link tests.
//
// The two transforms verified here came out of ADR-0009's retro
// review and Code Reviewer H1: carrier-name↔IATA equivalence and
// wall-clock-day comparison on flightDate. Without these, dedup
// silently misses across legacy/new storage forms.

import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { segments, trips, users } from '@/db/schema';

import { findFlightByKey } from './repo';

const DATABASE_URL = process.env.DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('segments.repo.findFlightByKey — dedup comparator', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Fresh user + trip per test. Cascade-on-delete from users
    // makes cleanup unnecessary — same pattern as documents/repo.test.
    const [u] = await db
      .insert(users)
      .values({
        email: `findFlight-${randomUUID()}@test.invalid`,
        sub: `sub-${randomUUID()}`,
      })
      .returning({ id: users.id });
    if (!u) throw new Error('failed to insert test user');
    userId = u.id;

    const [t] = await db
      .insert(trips)
      .values({
        userId,
        title: 'Dedup fixture',
        status: 'planned',
      })
      .returning({ id: trips.id });
    if (!t) throw new Error('failed to insert test trip');
    tripId = t.id;
  });

  it('matches a legacy IATA-form carrier against a name-form query', async () => {
    // Pre-existing row stores the carrier as the bare IATA code "BA"
    // — the form before this PR landed. A re-extraction now writes
    // the resolved name "British Airways" and expects dedup to find
    // the pre-existing row anyway.
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      startsAt: new Date(2026, 5, 1), // local midnight, June 1
      data: { carrier: 'BA', flightNumber: '287' },
    });

    const found = await findFlightByKey(userId, tripId, {
      carrier: 'British Airways',
      flightNumber: '287',
      flightDate: new Date(2026, 5, 1),
    });

    expect(found).not.toBeNull();
    expect((found?.data as { carrier?: string }).carrier).toBe('BA');
  });

  it('matches a name-form carrier against a legacy IATA-form query', async () => {
    // Symmetric to the above — new extraction wrote "British Airways",
    // a separate code path queries with the bare code (e.g. manual
    // legacy import script).
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      startsAt: new Date(2026, 5, 1),
      data: { carrier: 'British Airways', flightNumber: '287' },
    });

    const found = await findFlightByKey(userId, tripId, {
      carrier: 'BA',
      flightNumber: '287',
      flightDate: new Date(2026, 5, 1),
    });

    expect(found).not.toBeNull();
    expect((found?.data as { carrier?: string }).carrier).toBe('British Airways');
  });

  it('does not collapse a midnight-stored segment with a non-midnight scheduled instant', async () => {
    // Pinning the known limitation flagged by the post-ADR-0009 code
    // review (H1) and recorded in ADR-0009 Consequences: when one
    // side is a real ISO instant from scheduledDeparture and the
    // other is local midnight (legacy or flightDate-only), dedup
    // silently misses even though both represent the same wall-clock
    // day. Documented, not fixed — the proper fix is changing how we
    // store dates and is out of scope for ADR-0009.
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      startsAt: new Date(2026, 5, 1), // local midnight June 1
      data: { carrier: 'BA', flightNumber: '287' },
    });

    const found = await findFlightByKey(userId, tripId, {
      carrier: 'BA',
      flightNumber: '287',
      flightDate: new Date('2026-06-01T11:30:00Z'),
    });

    expect(found).toBeNull();
  });

  it('does not match a flight on a different wall-clock day', async () => {
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      startsAt: new Date(2026, 5, 1),
      data: { carrier: 'BA', flightNumber: '287' },
    });

    const found = await findFlightByKey(userId, tripId, {
      carrier: 'BA',
      flightNumber: '287',
      flightDate: new Date(2026, 5, 2),
    });

    expect(found).toBeNull();
  });

  it('does not match a flight with a different flight number on the same day', async () => {
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      startsAt: new Date(2026, 5, 1),
      data: { carrier: 'BA', flightNumber: '287' },
    });

    const found = await findFlightByKey(userId, tripId, {
      carrier: 'BA',
      flightNumber: '999',
      flightDate: new Date(2026, 5, 1),
    });

    expect(found).toBeNull();
  });

  it('does not match an unrelated airline that happens to share a flight number on the same day', async () => {
    // "BA 287" and "LH 287" must not collapse. Caught by the IATA-set
    // expansion being scoped to a single airline.
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      startsAt: new Date(2026, 5, 1),
      data: { carrier: 'Lufthansa', flightNumber: '287' },
    });

    const found = await findFlightByKey(userId, tripId, {
      carrier: 'British Airways',
      flightNumber: '287',
      flightDate: new Date(2026, 5, 1),
    });

    expect(found).toBeNull();
  });
});
