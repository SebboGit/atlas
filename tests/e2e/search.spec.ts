import { expect, test } from './fixtures/auth';
import { seedTrip } from './fixtures/db';

// Global search palette (Cmd+K / Ctrl+K). Verifies the hotkey opens the
// palette, the input is focused, and a query against a seeded trip
// title returns the trip as a result.
test.describe('search palette', () => {
  test('Ctrl+K opens the palette and a seeded trip is findable', async ({
    authedPage,
    authedUser,
  }) => {
    const slug = Date.now().toString(36);
    const tripTitle = `SearchableTrip-${slug}`;
    await seedTrip(authedUser.id, {
      title: tripTitle,
      startDate: new Date('2024-08-01T00:00:00Z'),
      endDate: new Date('2024-08-07T00:00:00Z'),
      status: 'completed',
    });

    await authedPage.goto('/trips');
    // Ctrl+K is the cross-platform binding registered in
    // src/components/search/use-search-hotkey.ts. Meta+K also works
    // on macOS — Ctrl works everywhere including the Linux CI runner.
    await authedPage.keyboard.press('Control+k');

    const palette = authedPage.getByRole('dialog');
    await expect(palette).toBeVisible();
    const input = palette.getByPlaceholder(/search trips, segments, documents/i);
    await expect(input).toBeFocused();

    // Need at least 2 chars before the query fires; type the unique
    // slug so the result set is unambiguous.
    await input.fill(tripTitle);
    await expect(palette.getByText(tripTitle)).toBeVisible();
  });
});
