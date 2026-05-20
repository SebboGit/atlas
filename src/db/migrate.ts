import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  console.log('▸ running migrations…');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('▸ migrations complete');

  await pool.end();
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
