import type { Locator } from '@playwright/test';

import { expect, test } from './fixtures/auth';
import {
  seedGeocodedActivitySegment,
  seedTransitSegment,
  seedTrip,
  seedUngeocodedActivitySegment,
} from './fixtures/db';

// The trip-map "Not pinned" chip surfaces segments the geocoder
// couldn't place. It replaces the long below-the-fold list that
// previously rendered under the map.
//
// Every test seeds via DB helpers — the chip's data path runs
// trip → segments → geocode_cache, and reaching it through the UI
// would mean driving the segment form (covered by unit tests) and
// waiting on Photon / Nominatim (live network, flaky). The chip is what
// we're testing, not the data plumbing upstream.
//
// The train tests assert on the chip only. The line is drawn on the
// WebGL canvas, and the station markers mount only after MapLibre's load
// event, which headless CI doesn't fire reliably.

// Opening the popover is client-only state behind a server-rendered
// chip: on a cold `next dev` the chip is painted before its handler is
// live, so a single press can land on nothing and the popover never
// opens. Retry the click/open pair rather than waiting out one long
// timeout — the same treatment trip-map-sheet-a11y.spec.ts gives it. A
// retry after a slow open toggles the popover shut and the next pass
// re-opens it, so the loop still converges.
async function openPopover(chip: Locator, popover: Locator): Promise<void> {
  await expect(chip).toBeVisible();
  await expect(async () => {
    await chip.click();
    await expect(popover).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

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
    // The popover's scroll region carries the role + label so a
    // keyboard user can tab into it; the test asserts against the
    // same accessible name so the assertion doubles as a regression
    // catch for the a11y wiring.
    const popoverList = authedPage.getByRole('region', { name: /segments not on the map/i });
    await openPopover(chip, popoverList);
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

  test('a train with an unfound departure station gets one entry', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Trip with a half-pinned train',
      startDate: new Date('2025-10-04T00:00:00Z'),
      endDate: new Date('2025-10-10T00:00:00Z'),
      status: 'completed',
    });
    // Suffixed names give the station keys to this run alone, so the
    // negative origin row can't shadow a real "Tokyo Station" pin in a
    // shared local database.
    const stamp = Date.now();
    const fromName = `Tokyo Station ${stamp}`;
    const toName = `Kyoto Station ${stamp}`;
    await seedTransitSegment(tripId, {
      mode: 'train',
      fromName,
      toName,
      countryCode: 'JP',
      startsAt: new Date('2025-10-07T09:12:00Z'),
      endsAt: new Date('2025-10-07T11:30:00Z'),
      origin: 'null',
      destination: { lat: 34.9858, lng: 135.7588 },
    });

    await authedPage.goto(`/trips/${tripId}/map`);

    // One segment, one entry — the chip counts segments, not endpoints
    // (ADR-0019).
    const chip = authedPage.getByRole('button', { name: /segments? not on the map/i });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Not pinned · 01');

    const popoverList = authedPage.getByRole('region', { name: /segments? not on the map/i });
    await openPopover(chip, popoverList);
    await expect(popoverList.getByText(`${fromName} → ${toName}`)).toBeVisible();
    await expect(popoverList.getByText(/departure point/i)).toBeVisible();
  });

  test('a ferry whose named stop was guessed far away gets an entry saying so', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Trip with a far-off ferry stop',
      startDate: new Date('2025-10-04T00:00:00Z'),
      endDate: new Date('2025-10-10T00:00:00Z'),
      status: 'completed',
    });
    // #144: the tagged station rungs missed, so the free-text ladder
    // placed "Pudeto" at a harbour ~1,065 km north. Both ends resolve,
    // so before the distance guard this drew a line between them. Both
    // pins still render — this test asserts the chip entry and its
    // reason; the pins and the missing line live on the WebGL canvas,
    // which this file deliberately leaves alone (see the header).
    const stamp = Date.now();
    const fromName = `Pudeto ${stamp}`;
    const toName = `Refugio Paine Grande ${stamp}`;
    await seedTransitSegment(tripId, {
      mode: 'ferry',
      fromName,
      toName,
      countryCode: 'CL',
      startsAt: new Date('2025-10-07T10:00:00Z'),
      endsAt: new Date('2025-10-07T10:30:00Z'),
      origin: { lat: -41.4693, lng: -72.9424, source: 'photon' },
      destination: { lat: -51.09, lng: -73.08 },
    });

    await authedPage.goto(`/trips/${tripId}/map`);

    const chip = authedPage.getByRole('button', { name: /segments? not on the map/i });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Not pinned · 01');

    const popoverList = authedPage.getByRole('region', { name: /segments? not on the map/i });
    await openPopover(chip, popoverList);
    await expect(popoverList.getByText(`${fromName} → ${toName}`)).toBeVisible();
    await expect(popoverList.getByText(/departure point looks wrong/i)).toBeVisible();
  });

  test('does not render when both stations of a train are pinned', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Trip with a pinned train',
      startDate: new Date('2025-10-04T00:00:00Z'),
      endDate: new Date('2025-10-10T00:00:00Z'),
      status: 'completed',
    });
    const stamp = Date.now();
    await seedTransitSegment(tripId, {
      mode: 'train',
      fromName: `Tokyo Station ${stamp}`,
      toName: `Kyoto Station ${stamp}`,
      countryCode: 'JP',
      startsAt: new Date('2025-10-07T09:12:00Z'),
      endsAt: new Date('2025-10-07T11:30:00Z'),
      origin: { lat: 35.6812, lng: 139.7671 },
      destination: { lat: 34.9858, lng: 135.7588 },
    });

    await authedPage.goto(`/trips/${tripId}/map`);

    await expect(authedPage.getByRole('button', { name: /not on the map/i })).toHaveCount(0);
  });
});
