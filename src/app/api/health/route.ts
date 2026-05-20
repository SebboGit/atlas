import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Used by the Dockerfile HEALTHCHECK. Keep it cheap.
export async function GET() {
  let dbStatus: 'up' | 'down' = 'down';
  try {
    await db.execute(sql`SELECT 1`);
    dbStatus = 'up';
  } catch {
    dbStatus = 'down';
  }

  const body = { ok: dbStatus === 'up', db: dbStatus, ts: new Date().toISOString() };
  return Response.json(body, { status: dbStatus === 'up' ? 200 : 503 });
}
