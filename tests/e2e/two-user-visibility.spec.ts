import { type Browser, type BrowserContext, expect, test } from '@playwright/test';

import {
  cleanupTestUser,
  createTestUserWithSession,
  seedTrip,
  TEST_MEMBER_EMAIL,
  TEST_OWNER_EMAIL,
  type TestUserHandle,
} from './fixtures/db';

// Two real signed-in identities sharing one Atlas instance — the
// scenario src/lib/trips/repo.test.ts covers at the SQL level, lifted to
// the rendered UI. Verifies ADR-0015 end to end:
//
//   - a household trip created by the owner is visible to another member
//     (list + detail), proving cross-user sharing actually renders;
//   - a private trip is owner-only — absent from the member's list and a
//     404 on a direct URL hit (the layout's notFound());
//   - trip-row controls (Edit / Archive / Delete / Upload) render only
//     for the owner; a member viewing a shared trip gets the read
//     surfaces without them.
//
// No second PocketID identity is required: the auth fixture seeds a
// session row + cookie directly (Auth.js DB-session strategy, unsigned
// cookie), so we just mint two of them and drive a context per user.
//
// This spec does NOT use the shared single-user `authedPage` fixture — it
// needs two live identities at once, so it manages two contexts by hand.

const DEFAULT_BASE_URL = 'http://localhost:3000';

async function signedInContext(
  browser: Browser,
  baseURL: string | undefined,
  token: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const hostname = new URL(baseURL ?? DEFAULT_BASE_URL).hostname;
  // Same cookie shape as fixtures/auth.ts: no `__Secure-` prefix (AUTH_URL
  // is http:// in dev/CI), raw unsigned token — the integrity check is the
  // SELECT against the `sessions` row, not a signed cookie.
  await context.addCookies([
    {
      name: 'authjs.session-token',
      value: token,
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  return context;
}

test.describe('two-user visibility boundary (ADR-0015)', () => {
  let owner: TestUserHandle;
  let member: TestUserHandle;
  let householdTripId: string;
  let privateTripId: string;
  // Date.now() keeps titles unique against any rows other specs leave
  // behind on the shared CI database, so the link/heading matchers below
  // can't collide.
  const stamp = Date.now();
  const householdTitle = `Shared Household ${stamp}`;
  const privateTitle = `Owner Private ${stamp}`;

  test.beforeAll(async () => {
    owner = await createTestUserWithSession(TEST_OWNER_EMAIL);
    member = await createTestUserWithSession(TEST_MEMBER_EMAIL);

    householdTripId = await seedTrip(owner.id, {
      title: householdTitle,
      visibility: 'household',
      // Completed + fixed past dates: stable on the /trips index, immune
      // to auto-status transitions.
      status: 'completed',
      startDate: new Date('2024-04-10T00:00:00Z'),
      endDate: new Date('2024-04-17T00:00:00Z'),
    });
    privateTripId = await seedTrip(owner.id, {
      title: privateTitle,
      visibility: 'private',
      status: 'completed',
      startDate: new Date('2024-05-10T00:00:00Z'),
      endDate: new Date('2024-05-17T00:00:00Z'),
    });
  });

  test.afterAll(async () => {
    // CASCADE from each user drops their sessions + trips + segments.
    await cleanupTestUser(TEST_OWNER_EMAIL);
    await cleanupTestUser(TEST_MEMBER_EMAIL);
  });

  test('owner sees both trips, the private badge, and owner-only controls', async ({
    browser,
    baseURL,
  }) => {
    const context = await signedInContext(browser, baseURL, owner.sessionToken);
    try {
      const page = await context.newPage();

      await page.goto('/trips');
      await expect(page.getByRole('link', { name: new RegExp(householdTitle, 'i') })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(privateTitle, 'i') })).toBeVisible();

      // The owner reaches their own private trip.
      await page.goto(`/trips/${privateTripId}`);
      await expect(
        page.getByRole('heading', { name: new RegExp(privateTitle, 'i') }),
      ).toBeVisible();
      // PrivateBadge. trip-chrome renders it twice (eyebrow row for ≥sm,
      // title row for <sm); filter to the one actually shown so the
      // assertion holds regardless of which viewport a future Playwright
      // project runs at.
      await expect(
        page.getByText('Private', { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      // Owner-only trip-row controls render.
      await expect(page.getByRole('button', { name: /^edit trip$/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /^delete forever$/i })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("member sees the shared trip but never the owner's private one", async ({
    browser,
    baseURL,
  }) => {
    const context = await signedInContext(browser, baseURL, member.sessionToken);
    try {
      const page = await context.newPage();

      // List: the household trip is shared in; the private one is not.
      await page.goto('/trips');
      await expect(page.getByRole('link', { name: new RegExp(householdTitle, 'i') })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(privateTitle, 'i') })).toHaveCount(0);

      // Direct hit on the owner's private trip. The `[id]` layout runs
      // getByIdForUser → null → notFound() at this very URL, which throws
      // before the page-level redirect to /itinerary can run — so the
      // response is a 404 served at /trips/:id (the URL never advances).
      const res = await page.goto(`/trips/${privateTripId}`);
      expect(res?.status()).toBe(404);
      expect(page.url()).toContain(privateTripId);
      expect(page.url()).not.toContain('/itinerary'); // notFound short-circuits the redirect

      // The shared trip opens (read access) but exposes no owner controls.
      await page.goto(`/trips/${householdTripId}`);
      await expect(
        page.getByRole('heading', { name: new RegExp(householdTitle, 'i') }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^edit trip$/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^archive$/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^delete forever$/i })).toHaveCount(0);
      // The phone overflow menu (which also carries those actions) is
      // owner-only too, so its trigger is absent as well.
      await expect(page.getByRole('button', { name: /trip actions/i })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
