import { expect, test } from '@playwright/test';

// Unauthenticated smoke. These tests run without the auth fixture
// and verify the public surfaces: the signin page renders, gated
// routes redirect, the health endpoint responds.

test.describe('smoke', () => {
  test('unauthenticated / lands on signin with the Atlas wordmark + passkey CTA', async ({
    page,
  }) => {
    // Proxy redirects unauthenticated `/` to `/signin?callbackUrl=/`.
    await page.goto('/');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole('heading', { name: 'Atlas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with passkey/i })).toBeVisible();
  });

  test('the /(app)/* proxy redirects unauthenticated requests to sign-in', async ({ page }) => {
    const response = await page.goto('/trips');
    // Proxy redirects to /signin?callbackUrl=/trips. The page may
    // finish at the sign-in page, or — if Auth.js's default sign-in
    // handler can't reach PocketID in this stubbed env — at an error
    // page. Either way it must NOT render the trips dashboard.
    await expect(page).not.toHaveURL(/\/trips$/);
    expect(response?.status()).toBeLessThan(500);
  });

  test('/api/health returns JSON', async ({ request }) => {
    const res = await request.get('/api/health');
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('db');
  });

  test('/wishlist exists and gates on auth like other app routes', async ({ page }) => {
    // The proxy redirects unauthenticated requests under /(app)/* to
    // sign-in. /wishlist is one of those — confirms the route shipped
    // and the gating works. Full wishlist functional flows live in
    // wishlist.spec.ts behind the auth fixture.
    const response = await page.goto('/wishlist');
    await expect(page).not.toHaveURL(/\/wishlist$/);
    expect(response?.status()).toBeLessThan(500);
  });
});
