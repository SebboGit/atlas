// Seed the local dev DB with the synthetic fixture dataset and print a
// ready-to-paste cookie snippet so a developer can be signed in as the
// fixture user without going through the OIDC flow.
//
// Hard-refuses to run on the primary worktree — the fixture user clears
// any prior trips/documents/wishlist items belonging to that user, and
// running this against the manually-curated DB on `main` would clobber
// real test data. Sibling worktrees have their own isolated postgres
// volume (compose project name = directory name), so wiping the
// fixture user there is safe.
//
// Invoked by `pnpm seed:dev` and `pnpm dev:up:wt`. See issue #31.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { buildFixtureDataset, createFixtureSession } from './lib/fixture-data';

function refuseIfPrimaryWorktree(): void {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
    const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
    }).trim();
    // In a linked worktree these point at different paths; in the
    // primary worktree they resolve to the same directory.
    if (resolve(gitDir) === resolve(gitCommonDir)) {
      console.error(
        'Refusing to seed dev fixture: this is the primary worktree.\n' +
          'Run it from a sibling worktree (e.g. ../atlas-<branch>) so it stays\n' +
          "isolated from main's manual test data. See issue #31.",
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('Could not determine worktree status:', err);
    process.exit(1);
  }
}

async function main() {
  refuseIfPrimaryWorktree();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Default to the local dev origin; allow override for the rare case
  // of pointing the cookie at a non-default port.
  const origin = process.env.ATLAS_DEV_ORIGIN ?? 'http://localhost:3000';

  const pool = new Pool({ connectionString: url, max: 1 });
  let payload: { userId: string; detailTripId: string };
  let sessionToken: string;
  try {
    const built = await buildFixtureDataset(pool);
    sessionToken = await createFixtureSession(pool, built.userId);
    payload = { userId: built.userId, detailTripId: built.detailTripId };
  } finally {
    await pool.end();
  }

  // Print operator-friendly instructions. Stay terse — first line is
  // the headline, then the copy-paste snippet, then the URL to open
  // afterwards. No marketing, no preamble.
  const expiresHours = 24;
  console.log('');
  console.log('Fixture dataset seeded.');
  console.log('');
  console.log(`Open ${origin} → DevTools → Application → Cookies → ${origin}`);
  // Plain `authjs.session-token` is the dev (http) cookie name. A TLS-
  // fronted Atlas would carry the `__Secure-` prefix; not a concern
  // here because this script only runs against the local dev origin.
  console.log("Add a cookie named 'authjs.session-token' with this value:");
  console.log('');
  console.log(`  ${sessionToken}`);
  console.log('');
  console.log(`Or paste this into the DevTools Console (cookie expires in ${expiresHours}h):`);
  console.log('');
  console.log(
    `  document.cookie = "authjs.session-token=${sessionToken}; path=/; max-age=${expiresHours * 3600}"`,
  );
  console.log('');
  console.log(`Hero trip: ${origin}/trips/${payload.detailTripId}`);
  console.log(`Trip map:  ${origin}/trips/${payload.detailTripId}/map`);
  console.log(`Wishlist:  ${origin}/wishlist`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
