import { sql } from 'drizzle-orm';

import type { Database } from '@/db/client';
import { countries } from '@/db/schema';

import { ISO_COUNTRIES } from './data';

/**
 * Idempotently load the ISO 3166-1 country reference table.
 *
 * This is required reference data, not optional demo data:
 * `trip_countries` and `user_visited_countries` both reference
 * `countries.code` with `ON DELETE RESTRICT`, so an empty table makes
 * marking a country visited fail with a foreign-key violation. The
 * worker seeds it on every boot (right after migrations) so a fresh
 * Docker deploy is usable with no manual step; `pnpm db:seed` runs the
 * same path for bare-metal installs. `onConflictDoNothing()` keeps
 * repeat runs free.
 *
 * Takes the database as an argument rather than importing the shared
 * singleton so the one-shot seed script can own and close its own pool,
 * while the long-lived worker passes the shared client.
 *
 * Names are UPDATED on conflict, not left alone. A display name can
 * change without the code changing ("Korea, South" → "South Korea"),
 * and `onConflictDoNothing` would have frozen every existing database
 * on the old spelling forever — including production, where this table
 * has been populated since the first boot. The code is the identity;
 * the name is derived data this snapshot owns.
 *
 * @returns the number of reference rows the seed covers.
 */
export async function seedCountries(db: Pick<Database, 'insert'>): Promise<number> {
  // Spread the readonly tuple — Drizzle's `.values()` wants a mutable array.
  await db
    .insert(countries)
    .values([...ISO_COUNTRIES])
    .onConflictDoUpdate({ target: countries.code, set: { name: sql`excluded.name` } });
  return ISO_COUNTRIES.length;
}
