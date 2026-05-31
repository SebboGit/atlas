// DB-integration test for the reference-data seed. Skipped cleanly when
// DATABASE_URL is unset, same pattern as repo.test.ts. Guards the boot
// path the worker relies on: a fresh deploy must end up with the full
// ISO country table, and re-running the seed on every boot must be a
// no-op rather than an error.

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ISO_COUNTRIES } from './data';
import { seedCountries } from './seed';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('countries.seedCountries', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  async function countryRows(): Promise<number> {
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM countries');
    return rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    db = drizzle(pool);
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    // Leave the seeded reference data in place — it's idempotent and
    // other suites depend on the country FKs being satisfiable.
    await pool.end();
  });

  it('loads the full ISO country table and is idempotent', async () => {
    const first = await seedCountries(db);
    expect(first).toBe(ISO_COUNTRIES.length);

    const afterFirst = await countryRows();
    expect(afterFirst).toBeGreaterThanOrEqual(ISO_COUNTRIES.length);

    // A second boot must not throw and must not change the row count.
    const second = await seedCountries(db);
    expect(second).toBe(ISO_COUNTRIES.length);
    expect(await countryRows()).toBe(afterFirst);

    // Spot-check a known code resolved to its name.
    const { rows } = await pool.query<{ name: string }>(
      'SELECT name FROM countries WHERE code = $1',
      ['JP'],
    );
    expect(rows[0]?.name).toBeTruthy();
  });
});
