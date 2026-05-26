import { expect, test } from './fixtures/auth';

// Authenticated reach-through smoke. Each top-level surface must render
// for a logged-in user. Catches accidental top-level breakage (a thrown
// requireUser(), a layout crash, a typo'd Drizzle query in the page
// loader) without depending on any feature-specific data.
test.describe('authed smoke', () => {
  test('home (/) renders the welcome heading', async ({ authedPage }) => {
    await authedPage.goto('/');
    await expect(authedPage).toHaveURL(/\/$/);
    await expect(authedPage.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });

  test('/trips renders', async ({ authedPage }) => {
    await authedPage.goto('/trips');
    await expect(authedPage).toHaveURL(/\/trips$/);
    await expect(authedPage.getByRole('heading', { name: /^trips\.?$/i })).toBeVisible();
  });

  test('/wishlist renders', async ({ authedPage }) => {
    await authedPage.goto('/wishlist');
    await expect(authedPage).toHaveURL(/\/wishlist$/);
    await expect(authedPage.getByRole('heading', { name: /^wishlist\.?$/i })).toBeVisible();
  });

  test('/map renders', async ({ authedPage }) => {
    await authedPage.goto('/map');
    await expect(authedPage).toHaveURL(/\/map$/);
    await expect(authedPage.getByRole('heading', { name: /where you'?ve been/i })).toBeVisible();
  });

  test('/stats renders', async ({ authedPage }) => {
    await authedPage.goto('/stats');
    await expect(authedPage).toHaveURL(/\/stats$/);
    await expect(authedPage.getByRole('heading', { name: /tally so far/i })).toBeVisible();
  });
});
