import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

// Cache the pool across Next.js dev hot-reloads. Without this each HMR
// cycle leaks a new pool until Postgres hits its connection limit.
declare global {
  var __atlasPgPool: Pool | undefined;
  var __atlasDb: ReturnType<typeof drizzle> | undefined;
}

// Construct eagerly so the @auth/drizzle-adapter's runtime DB-type
// detection sees a real drizzle instance (a Proxy would trip it up with
// "Unsupported database type (object)"). Pool construction is lazy with
// pg — no socket is opened until the first query. If DATABASE_URL is
// missing, pg falls back to PG* env vars; queries will fail at runtime,
// but importing this module remains safe.
const pool =
  globalThis.__atlasPgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__atlasPgPool = pool;
}

export const db = globalThis.__atlasDb ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__atlasDb = db;
}

export type Database = typeof db;
