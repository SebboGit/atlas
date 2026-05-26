import { test as base, type Page } from '@playwright/test';

import { cleanupTestUser, createTestUserWithSession, type TestUserHandle } from './db';

interface AuthFixtures {
  // A logged-in Page. Behind the scenes: insert user + session row,
  // set the cookie on the browser context, yield the page. After the
  // test, delete the user (FK cascade tears down everything else).
  authedPage: Page;
  // The same handle exposed for tests that need the user.id for
  // their own seeding (trips, wishlist items, segments).
  authedUser: TestUserHandle;
}

export const test = base.extend<AuthFixtures>({
  authedUser: async ({}, use) => {
    const handle = await createTestUserWithSession();
    await use(handle);
    await cleanupTestUser();
  },

  authedPage: async ({ context, page, baseURL, authedUser }, use) => {
    // Cookie name has no `__Secure-` prefix because AUTH_URL is http://
    // in dev/CI. The session cookie value is the raw token — Auth.js's
    // DB session strategy does not sign the cookie (the integrity check
    // is the SELECT against the `sessions` table).
    const hostname = new URL(baseURL ?? 'http://localhost:3000').hostname;
    await context.addCookies([
      {
        name: 'authjs.session-token',
        value: authedUser.sessionToken,
        domain: hostname,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await use(page);
  },
});

export { expect } from '@playwright/test';
