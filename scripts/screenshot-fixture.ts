// One-off fixture for the documentation screenshots in docs/screenshots/.
//
// Builds the synthetic demo dataset (shared with `pnpm seed:dev` via
// scripts/lib/fixture-data.ts) and prints a valid Auth.js session token
// so scripts/capture-screenshots.ts can drive a headless browser through
// every documented surface.
//
// Re-running is safe: the fixture user's trips, documents, wishlist
// items, sessions, and manual country marks are wiped and rebuilt every
// time.
//
// Prints JSON to stdout: { sessionToken, userId, detailTripId, trips }.

import { Pool } from 'pg';

import { buildFixtureDataset, createFixtureSession } from './lib/fixture-data';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { userId, detailTripId, trips } = await buildFixtureDataset(pool);
    const sessionToken = await createFixtureSession(pool, userId);
    process.stdout.write(
      JSON.stringify({ sessionToken, userId, detailTripId, trips }, null, 2) + '\n',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
