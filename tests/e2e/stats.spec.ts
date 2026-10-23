import { expect, test } from './fixtures/auth';
import { seedHotelSegment, seedTrip } from './fixtures/db';

// The /stats tickets: a finished trip with a hotel stay is enough to swap
// the empty state for the lifetime pass, the year tickets and the records.
// Counts aren't asserted — household trips seeded by other specs share
// this database and roll into the same tallies.

const PHONE = { width: 360, height: 640 };

async function seedFinishedStay(userId: string): Promise<string> {
  const title = `Stats ${Date.now().toString(36)}`;
  const tripId = await seedTrip(userId, {
    title,
    status: 'completed',
    startDate: new Date('2024-05-01T00:00:00Z'),
    endDate: new Date('2024-05-07T00:00:00Z'),
  });
  await seedHotelSegment(tripId, {
    propertyName: 'Hotel Gracery Shinjuku',
    startsAt: new Date('2024-05-01T15:00:00Z'),
    endsAt: new Date('2024-05-07T00:00:00Z'),
    countryCode: 'JP',
    locationName: 'Shinjuku',
  });
  return title;
}

test.describe('stats tickets', () => {
  test('a finished stay fills the pass, the years and the records', async ({
    authedPage,
    authedUser,
  }) => {
    await seedFinishedStay(authedUser.id);
    await authedPage.goto('/stats');

    await expect(authedPage.getByRole('heading', { name: /^stats$/i })).toBeVisible();
    const pass = authedPage.getByRole('region', { name: 'Lifetime pass' });
    await expect(pass).toBeVisible();
    await expect(pass.getByText(/nights? away/)).toBeVisible();
    await expect(pass.getByRole('heading', { name: 'Lifetime pass' })).toBeVisible();

    const years = authedPage.getByRole('region', { name: 'Year by year' });
    await expect(years.getByText('2024', { exact: true }).first()).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: 'Records' })).toBeVisible();
    await expect(authedPage.getByText('Nothing to tally yet.')).toHaveCount(0);
  });

  test('nothing scrolls sideways at 360px', async ({ authedPage, authedUser }) => {
    await seedFinishedStay(authedUser.id);
    await authedPage.setViewportSize(PHONE);
    await authedPage.goto('/stats');
    await expect(authedPage.getByRole('region', { name: 'Lifetime pass' })).toBeVisible();

    const overflow = await authedPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
