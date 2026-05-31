import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// Shared with the worker's boot-time seed (scripts/worker.ts) so a Docker
// deploy and a bare-metal `pnpm db:seed` load identical reference data.
import { seedCountries } from '../src/lib/countries/seed';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  console.log('▸ seeding countries…');
  const count = await seedCountries(db);
  console.log(`▸ seed complete (${count} countries)`);

  await pool.end();
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
