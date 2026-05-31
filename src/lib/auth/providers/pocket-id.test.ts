// Regression guard for the OIDC profile mapping. If profile().id ever
// stops returning the stable `sub`, Auth.js falls back to a random
// providerAccountId on every sign-in and the user is locked out with a
// permanent OAuthAccountNotLinked error — a silent, total-lockout bug
// with no other test covering it. See the long comment in pocket-id.ts.

import { describe, expect, it } from 'vitest';

import type { PocketIDProfile } from '../profile-schema';

import { pocketIdProvider } from './pocket-id';

// The profile mapper ignores its `tokens` argument; `{} as never` keeps
// the two-arg next-auth signature satisfied without an `any`.
function mapper() {
  const map = pocketIdProvider().profile;
  if (!map) throw new Error('pocketIdProvider() must define a profile mapper');
  return (p: PocketIDProfile) => map(p, {} as never);
}

describe('pocketIdProvider.profile', () => {
  it('maps the OIDC sub to id (the providerAccountId)', async () => {
    const mapped = await mapper()({ sub: 'oidc-sub-123', email: 'a@b.test', name: 'Alice' });
    expect(mapped.id).toBe('oidc-sub-123');
  });

  it('is stable across calls — never invents a random id', async () => {
    const map = mapper();
    const a = await map({ sub: 'stable-sub' });
    const b = await map({ sub: 'stable-sub' });
    expect(a.id).toBe('stable-sub');
    expect(b.id).toBe('stable-sub');
  });

  it('fills email/name defaults without touching id', async () => {
    const map = mapper();
    expect((await map({ sub: 's', preferred_username: 'pu' })).name).toBe('pu');
    const bare = await map({ sub: 's' });
    expect(bare.email).toBe('');
    expect(bare.name).toBeNull();
  });
});
