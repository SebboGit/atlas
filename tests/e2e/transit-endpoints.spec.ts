import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures/auth';
import { seedTransitSegment, seedTrip } from './fixtures/db';

// A train leg's two endpoints on the itinerary (ADR-0019): the card's
// Directions link, the inspector's Route rows, and the edit form's From /
// To blocks. DOM only — the route line lives on the map canvas, which the
// "Not pinned" chip spec already leaves alone.
//
// Both stations are seeded as cache hits, so the page never enqueues a
// live Photon lookup and never mounts the geocode poller.

// `now`-relative UTC dates, as in itinerary-continuation.spec.ts. The leg
// has to sit on a future day: once the client knows "today", past days
// fold into the collapsed pill and the card leaves the DOM.
const REL_BASE = new Date();
function relDay(offset: number, hour = 12): Date {
  return new Date(
    Date.UTC(
      REL_BASE.getUTCFullYear(),
      REL_BASE.getUTCMonth(),
      REL_BASE.getUTCDate() + offset,
      hour,
    ),
  );
}

// Seeds a trip with one Tokyo → Kyoto train, both ends pinned, and opens
// its itinerary. Suffixed names give the station cache keys to this test
// alone (keys are shared across rows with the same mode, country and name).
async function openTrainItinerary(page: Page, userId: string) {
  const stamp = Date.now();
  const fromName = `Tokyo Station ${stamp}`;
  const toName = `Kyoto Station ${stamp}`;
  const tripId = await seedTrip(userId, {
    title: `Kansai rail ${stamp}`,
    status: 'planned',
    startDate: relDay(1),
    endDate: relDay(3),
  });
  await seedTransitSegment(tripId, {
    mode: 'train',
    fromName,
    toName,
    countryCode: 'JP',
    startsAt: relDay(2, 9),
    endsAt: relDay(2, 11),
    origin: { lat: 35.6812, lng: 139.7671 },
    destination: { lat: 34.9858, lng: 135.7588 },
  });

  await page.goto(`/trips/${tripId}/itinerary`);

  // The card only becomes the inspector trigger after mount (the dialogs
  // stay out of SSR), so waiting on the role="button" wrapper also waits
  // for hydration.
  const card = page.getByRole('button', { name: 'View transit details' });
  await expect(card).toBeVisible();
  return { stamp, fromName, toName, card };
}

test.describe('transit endpoints — itinerary', () => {
  test('the card links both stations to Google Maps directions', async ({
    authedPage,
    authedUser,
  }) => {
    const { stamp, card } = await openTrainItinerary(authedPage, authedUser.id);

    const directions = card.getByRole('link', { name: 'Directions', exact: true });
    await expect(directions).toBeVisible();
    await expect(directions).toHaveAttribute('target', '_blank');

    // Each end is its station name, URL-encoded — never the seeded
    // coordinates, which could pass a wrong geocode on to Google.
    const href = await directions.getAttribute('href');
    expect(href).toContain(`origin=Tokyo%20Station%20${stamp}`);
    expect(href).toContain(`destination=Kyoto%20Station%20${stamp}`);
    expect(href).toContain('travelmode=transit');
  });

  test('the inspector shows the From and To rows and a Directions link', async ({
    authedPage,
    authedUser,
  }) => {
    const { fromName, toName, card } = await openTrainItinerary(authedPage, authedUser.id);

    // Click the title, not the card's centre: a click that lands on the
    // Directions chip follows the link instead of opening the inspector.
    await card.getByText(`${fromName} → ${toName}`).click();

    const inspector = authedPage.getByRole('dialog', { name: `${fromName} → ${toName}` });
    await expect(inspector).toBeVisible();

    await expect(routeRow(inspector, 'From')).toContainText(fromName);
    await expect(routeRow(inspector, 'To')).toContainText(toName);
    const mapsLink = routeRow(inspector, 'Directions').getByRole('link', { name: 'Google Maps' });
    await expect(mapsLink).toBeVisible();
    await expect(mapsLink).toHaveAttribute('href', /travelmode=transit/);
  });

  test('the edit form has a From and a To block with Find and a disclosure', async ({
    authedPage,
    authedUser,
  }) => {
    const { fromName, toName, card } = await openTrainItinerary(authedPage, authedUser.id);

    await card.getByText(`${fromName} → ${toName}`).click();
    const inspector = authedPage.getByRole('dialog', { name: `${fromName} → ${toName}` });
    await inspector.getByRole('button', { name: 'Edit', exact: true }).click();

    const form = authedPage.getByRole('dialog', { name: 'Edit transit' });
    await expect(form).toBeVisible();

    const fromInput = form.locator('#seg-transit-from-name');
    await expect(fromInput).toHaveValue(fromName);
    await expect(form.locator('#seg-transit-to-name')).toHaveValue(toName);

    // Find sits beside its name input and needs a name to search on.
    const fromFind = fromInput.locator('xpath=..').getByRole('button', { name: 'Find' });
    await expect(fromFind).toBeEnabled();
    await fromInput.fill('');
    await expect(fromFind).toBeDisabled();

    // Neither end has an address on file, so both sections start closed.
    const disclosures = form.getByRole('button', { name: 'Address · Plus Code' });
    await expect(disclosures).toHaveCount(2);
    for (const [index, side] of (['from', 'to'] as const).entries()) {
      const disclosure = disclosures.nth(index);
      const address = form.locator(`#seg-transit-${side}-address`);
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(address).toBeHidden();

      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(address).toBeVisible();

      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(address).toBeHidden();
    }
  });
});

// One row of the inspector's definition lists, found by its exact label
// (a plain `hasText` is a case-insensitive substring match).
function routeRow(dialog: Locator, label: string) {
  return dialog.locator('dl > div').filter({
    has: dialog.page().locator('dt', { hasText: new RegExp(`^${label}$`) }),
  });
}
