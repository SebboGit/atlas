// Defense in depth for the E2E DB helpers in `./db.ts`.
//
// The helpers below truncate by a sentinel email (`e2e@test.invalid`)
// which can never collide with real data. This guard adds a second
// layer: it refuses to run at all if DATABASE_URL doesn't look like a
// local dev / CI Postgres. The cost of being wrong here is wiping a
// production user; the cost of being right is zero.
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('E2E fixture: DATABASE_URL is not set.');
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('E2E fixture: DATABASE_URL is not a valid URL.');
  }

  // Allow loopback + the docker-compose service names. Bracketed IPv6
  // (`[::1]`) is what URL.hostname returns for the loopback form;
  // bare `::1` never appears so we don't carry it.
  const safeHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres', 'db']);
  if (safeHosts.has(host)) return;
  // Allow hosts whose first label is literally "test" (e.g. "test-db",
  // "test.local"). Earlier we used `host.includes('test')`, which also
  // matched `latest-db.example.com`, `attest.example.com`, etc. — far
  // too generous given the cost of a wrong-DB wipe.
  if (/^test([.-]|$)/.test(host)) return;

  throw new Error(
    `E2E fixture: refusing to operate against DATABASE_URL host "${host}". ` +
      'Only localhost/CI databases are permitted.',
  );
}
