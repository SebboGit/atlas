import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('landing page renders and exposes the Sign in CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Atlas' })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('the /(app)/* proxy redirects unauthenticated requests to sign-in', async ({ page }) => {
    const response = await page.goto('/trips');
    // Proxy redirects to /api/auth/signin?callbackUrl=/trips. The
    // page may finish at the sign-in page, or — if Auth.js's default
    // sign-in handler can't reach PocketID in this stubbed env — at
    // an error page. Either way it must NOT render the trips dashboard.
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
});
