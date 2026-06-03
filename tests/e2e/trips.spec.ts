import { expect, test } from './fixtures/auth';
import { seedActivitySegment, seedTrip } from './fixtures/db';

test.describe('trips', () => {
  test('seeded trip appears on /trips and detail opens', async ({ authedPage, authedUser }) => {
    const tripTitle = `E2E Trip ${Date.now()}`;
    const tripId = await seedTrip(authedUser.id, {
      title: tripTitle,
      // Fixed past dates — the trip is "completed" so it doesn't move
      // around the chrono ordering and isn't subject to auto-status
      // transitions.
      startDate: new Date('2024-01-10T00:00:00Z'),
      endDate: new Date('2024-01-17T00:00:00Z'),
      status: 'completed',
    });

    await authedPage.goto('/trips');
    const card = authedPage.getByRole('link', { name: new RegExp(tripTitle, 'i') });
    await expect(card).toBeVisible();

    await card.click();
    await expect(authedPage).toHaveURL(new RegExp(`/trips/${tripId}`));
    await expect(
      authedPage.getByRole('heading', { name: new RegExp(tripTitle, 'i') }),
    ).toBeVisible();
  });

  test('seeded activity segment renders on the activities tab', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'E2E Segment Trip',
      startDate: new Date('2024-02-10T00:00:00Z'),
      endDate: new Date('2024-02-15T00:00:00Z'),
      status: 'completed',
    });
    const segmentTitle = `Tea ceremony in Asakusa ${Date.now()}`;
    await seedActivitySegment(tripId, {
      title: segmentTitle,
      startsAt: new Date('2024-02-12T10:00:00Z'),
      locationName: 'Asakusa',
      countryCode: 'JP',
    });

    await authedPage.goto(`/trips/${tripId}/activities`);
    await expect(authedPage.getByText(segmentTitle)).toBeVisible();
  });

  test('editing a segment from the inspector keeps the edit dialog open', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'E2E Inspector Trip',
      startDate: new Date('2024-03-10T00:00:00Z'),
      endDate: new Date('2024-03-15T00:00:00Z'),
      status: 'completed',
    });
    const segmentTitle = `Inspector edit ${Date.now()}`;
    await seedActivitySegment(tripId, {
      title: segmentTitle,
      startsAt: new Date('2024-03-12T10:00:00Z'),
      countryCode: 'JP',
    });

    await authedPage.goto(`/trips/${tripId}/itinerary`);

    // Tap the card surface to open the read-only inspector.
    await authedPage.getByRole('button', { name: /view activity details/i }).click();
    const inspector = authedPage.getByRole('dialog');
    await expect(inspector.getByText(segmentTitle)).toBeVisible();

    // Open the edit flow from inside the inspector.
    await inspector.getByRole('button', { name: /^edit$/i }).click();

    // The edit dialog must appear AND survive. Regression guard: the edit
    // dialog renders inside the inspector's DialogContent, so an earlier
    // version that auto-closed the inspector on click tore the edit dialog
    // down with it. Re-check after a beat longer than the exit animation.
    const editHeading = authedPage.getByRole('heading', { name: /edit activity/i });
    await expect(editHeading).toBeVisible();
    await authedPage.waitForTimeout(600);
    await expect(editHeading).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /save changes/i })).toBeVisible();
  });

  test('create a trip via the dialog', async ({ authedPage }) => {
    await authedPage.goto('/trips');
    await authedPage.getByRole('button', { name: /^new trip$/i }).click();

    // Scope selectors to the dialog — a future "Edit trip" or "Search"
    // surface that also exposes a Title field would otherwise quietly
    // make `getByLabel` ambiguous.
    const dialog = authedPage.getByRole('dialog');
    // The dialog renders a Title input + a Save button. We deliberately
    // don't touch the custom DatePicker here — it's a popover, not a
    // native <input type="date">, and driving it is brittle. The schema
    // allows null dates, so a title-only create is a valid submission.
    const title = `E2E Created Trip ${Date.now()}`;
    await dialog.getByLabel(/^title$/i).fill(title);
    await dialog.getByRole('button', { name: /^add trip$/i }).click();

    // After create the action calls revalidatePath('/trips') and closes
    // the dialog; the card should appear in the list.
    await expect(authedPage.getByRole('link', { name: new RegExp(title, 'i') })).toBeVisible();
  });
});
