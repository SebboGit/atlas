import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { users } from '@/db/schema';

import { refreshUserFromClaims } from './jit-user';

const DATABASE_URL = process.env.DATABASE_URL;

// Skip the suite cleanly when no DB is reachable. Locally, run with
//   DATABASE_URL=postgres://atlas:atlas@localhost:55432/atlas pnpm test
// against a throwaway container. In CI the service container is always
// up, so this suite runs by default.
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// Each test gets a unique sub so re-running the suite against a persistent
// DB (or running test files in any order) never trips users_sub_unique.
const uniqueSub = (label: string) => `oidc-sub-${label}-${randomUUID()}`;

describeIfDb('refreshUserFromClaims (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    const [row] = await db
      .insert(users)
      .values({ email: `placeholder-${randomUUID()}@example.invalid` })
      .returning({ id: users.id });
    expect(row?.id).toBeTruthy();
    userId = row!.id;
  });

  it('populates sub on first refresh and updates display attrs', async () => {
    const sub = uniqueSub('abc');
    await refreshUserFromClaims(userId, sub, {
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
      groups: ['atlas-users', 'homelab-admins'],
    });

    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.sub).toBe(sub);
    expect(row?.email).toBe('jane.doe@example.com');
    expect(row?.name).toBe('Jane Doe');
    expect(row?.groups).toEqual(['atlas-users', 'homelab-admins']);
    expect(row?.lastSeenAt).toBeInstanceOf(Date);
  });

  it('a second refresh updates attrs but keeps id and sub stable', async () => {
    const sub = uniqueSub('stable');
    await refreshUserFromClaims(userId, sub, {
      email: 'old@example.com',
      name: 'Old Name',
      groups: ['atlas-users'],
    });
    await refreshUserFromClaims(userId, sub, {
      email: 'new@example.com',
      name: 'New Name',
      groups: ['atlas-users', 'atlas-admins'],
    });

    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.id).toBe(userId);
    expect(row?.sub).toBe(sub);
    expect(row?.email).toBe('new@example.com');
    expect(row?.name).toBe('New Name');
    expect(row?.groups).toEqual(['atlas-users', 'atlas-admins']);
  });

  it('falls back to preferred_username when name is absent', async () => {
    await refreshUserFromClaims(userId, uniqueSub('noname'), {
      email: 'u@example.com',
      preferred_username: 'jdoe',
    });

    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.name).toBe('jdoe');
  });

  it('SPARSE update: omitted email does not overwrite a populated email', async () => {
    const sub = uniqueSub('sparse');
    await refreshUserFromClaims(userId, sub, {
      email: 'first@example.com',
      name: 'First',
    });
    await refreshUserFromClaims(userId, sub, { name: 'Second' });

    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.email).toBe('first@example.com'); // preserved
    expect(row?.name).toBe('Second'); // updated
  });

  it('SPARSE update: omitted groups does not clobber existing groups', async () => {
    const sub = uniqueSub('grp');
    await refreshUserFromClaims(userId, sub, {
      email: 'u@example.com',
      groups: ['atlas-users', 'atlas-admins'],
    });
    await refreshUserFromClaims(userId, sub, { email: 'u@example.com' });

    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.groups).toEqual(['atlas-users', 'atlas-admins']);
  });

  it('explicit empty groups clears them', async () => {
    const sub = uniqueSub('grpclear');
    await refreshUserFromClaims(userId, sub, {
      email: 'u@example.com',
      groups: ['atlas-users'],
    });
    await refreshUserFromClaims(userId, sub, {
      email: 'u@example.com',
      groups: [],
    });

    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.groups).toEqual([]);
  });

  it('emailVerified is written when the claim arrives as boolean', async () => {
    const sub = uniqueSub('ev');
    await refreshUserFromClaims(userId, sub, {
      email: 'u@example.com',
      email_verified: true,
    });
    let [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.emailVerified).toBeInstanceOf(Date);

    await refreshUserFromClaims(userId, sub, {
      email: 'u@example.com',
      email_verified: false,
    });
    [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row?.emailVerified).toBeNull();
  });

  it('rejects oversized groups[] (Zod caps)', async () => {
    const huge = Array.from({ length: 64 }, (_, i) => `g${i}`);
    await expect(
      refreshUserFromClaims(userId, uniqueSub('toomany'), {
        email: 'u@example.com',
        groups: huge,
      }),
    ).rejects.toThrow();
  });

  it('rejects oversized group entry strings (Zod caps)', async () => {
    await expect(
      refreshUserFromClaims(userId, uniqueSub('toolong'), {
        email: 'u@example.com',
        groups: ['x'.repeat(65)],
      }),
    ).rejects.toThrow();
  });

  it('rejects malformed email', async () => {
    await expect(
      refreshUserFromClaims(userId, uniqueSub('bademail'), {
        email: 'not-an-email',
      }),
    ).rejects.toThrow();
  });
});
