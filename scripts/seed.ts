import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { countries } from '../src/db/schema/countries';
// Full ISO 3166-1 alpha-2 list lives at src/lib/countries/data.ts so
// the seed and the form's country dropdown stay in lockstep. Adding a
// country = edit one file.
import { ISO_COUNTRIES } from '../src/lib/countries/data';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  console.log(`▸ seeding ${ISO_COUNTRIES.length} countries…`);
  // Spread the readonly tuple — Drizzle's `.values()` expects a
  // mutable array shape.
  await db
    .insert(countries)
    .values([...ISO_COUNTRIES])
    .onConflictDoNothing();
  console.log('▸ seed complete');

  await pool.end();
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
