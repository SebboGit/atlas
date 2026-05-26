import { expect, test } from './fixtures/auth';
import {
  seedGeocodedActivitySegment,
  seedTrip,
  seedUngeocodedActivitySegment,
} from './fixtures/db';

// The trip-map "Not pinned" chip surfaces segments the geocoder
// couldn't place. It replaces the long below-the-fold list that
// previously rendered under the map.
//
// All three tests seed via DB helpers — the chip's data path runs
// trip → segments → geocode_cache, and reaching it through the UI
// would mean driving the segment form (covered by unit tests) and
// waiting on Nominatim (live network, flaky). The chip is what we're
// testing, not the data plumbing upstream.

test.describe('trip map — "Not pinned" chip', () => {
  test('renders with the segment count when items are ungeocoded', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Trip with unpinnable bits',
      startDate: new Date('2025-10-04T00:00:00Z'),
      endDate: new Date('2025-10-10T00:00:00Z'),
      status: 'completed',
    });
    // Two ungeocoded activities. The chip count pads to two digits so
    // "Not pinned · 02" is the expected literal — same shape the
    // wishlist toggle uses next to it.
    const titleA = `Friend's place ${Date.now()}`;
    const titleB = `Cousin's spare room ${Date.now()}`;
    await seedUngeocodedActivitySegment(tripId, { title: titleA, countryCode: 'JP' });
    await seedUngeocodedActivitySegment(tripId, { title: titleB, countryCode: 'JP' });

    await authedPage.goto(`/trips/${tripId}/map`);

    const chip = authedPage.getByRole('button', { name: /segments? not on the map/i });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Not pinned · 02');
  });

  test('clicking the chip reveals the segment list and reasons', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Trip with one unpinnable activity',
      startDate: new Date('2025-10-04T00:00:00Z'),
      endDate: new Date('2025-10-10T00:00:00Z'),
      status: 'completed',
    });
    const title = `Friend's place ${Date.now()}`;
    await seedUngeocodedActivitySegment(tripId, { title, countryCode: 'JP' });

    await authedPage.goto(`/trips/${tripId}/map`);

    const chip = authedPage.getByRole('button', { name: /segment not on the map/i });
    await expect(chip).toBeVisible();
    await chip.click();

    // The popover's scroll region carries the role + label so a
    // keyboard user can tab into it; the test asserts against the
    // same accessible name so the assertion doubles as a regression
    // catch for the a11y wiring.
    const popoverList = authedPage.getByRole('region', { name: /segments not on the map/i });
    await expect(popoverList).toBeVisible();
    await expect(popoverList.getByText(title)).toBeVisible();
    // The reason text is the trip-map repo's user-facing string for a
    // null cache hit. Asserting against the substring ("couldn't find")
    // covers the actual copy without coupling to the exact phrasing.
    await expect(popoverList.getByText(/couldn't find/i)).toBeVisible();
  });

  test('does not render when every non-flight segment is geocoded', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Trip with everything pinned',
      startDate: new Date('2025-10-04T00:00:00Z'),
      endDate: new Date('2025-10-10T00:00:00Z'),
      status: 'completed',
    });
    // A geocoded activity (pre-seeded positive cache row) is what we
    // need here — not just "a segment". A plain seed without the cache
    // hit reads as `kind: 'miss'` in the repo and STILL ungeocodes
    // with a "geocoding pending" reason. The chip is gated on
    // `ungeocoded.length > 0`, so the test must actually leave that
    // array empty.
    await seedGeocodedActivitySegment(tripId, {
      title: 'Sensō-ji',
      locationName: 'Asakusa',
      countryCode: 'JP',
      lat: 35.7148,
      lng: 139.7967,
    });

    await authedPage.goto(`/trips/${tripId}/map`);

    await expect(authedPage.getByRole('button', { name: /not on the map/i })).toHaveCount(0);
  });
});
