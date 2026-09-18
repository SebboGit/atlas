import { expect, test } from './fixtures/auth';
import { readSegmentData, seedHotelSegment, seedTrip } from './fixtures/db';

// Editing a pinned stay must not freeze its pin (#135). The edit dialog
// used to prefill `data.plusCode` from the cached coordinates, and a
// saved Plus Code outranks the property name in `buildGeocodeQuery` — so
// the first edit of any kind nailed the segment to whatever the geocoder
// had already picked. The form now shows that code as a display-only
// line and saves nothing.
//
// The stay is seeded with its geocode cached, so the page never enqueues
// a live lookup.

// `now`-relative UTC dates, as in itinerary-continuation.spec.ts. The
// stay has to sit on a future day: once the client knows "today", past
// days fold into the collapsed pill and the card leaves the DOM.
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

// A full Plus Code: eight characters, '+', two more. Matched as a
// substring — the line runs the geocoder's city straight on after it.
const PLUS_CODE = /[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}/;

test.describe('editing a pinned stay', () => {
  test('shows the geocoded pin without saving it, so a rename re-geocodes', async ({
    authedPage,
    authedUser,
  }) => {
    // The property name is the cache key, so a per-run suffix keeps this
    // spec's rows to itself.
    const stamp = Date.now();
    const propertyName = `Hotel Niwa ${stamp}`;
    const tripId = await seedTrip(authedUser.id, {
      title: `Tokyo stay ${stamp}`,
      status: 'planned',
      startDate: relDay(1),
      endDate: relDay(3),
    });
    const hotelId = await seedHotelSegment(tripId, {
      propertyName,
      startsAt: relDay(2, 15),
      endsAt: relDay(3, 11),
      locationName: 'Chiyoda',
      countryCode: 'JP',
      pin: { lat: 35.6968, lng: 139.7536, city: 'Chiyoda' },
    });

    await authedPage.goto(`/trips/${tripId}/itinerary`);

    // The card becomes the inspector trigger only after mount, so waiting
    // on the role="button" wrapper also waits for hydration.
    const card = authedPage.getByRole('button', { name: 'View stay details' }).first();
    await expect(card).toBeVisible();
    await card.getByText(propertyName).click();

    const inspector = authedPage.getByRole('dialog', { name: propertyName });
    await inspector.getByRole('button', { name: 'Edit', exact: true }).click();

    const form = authedPage.getByRole('dialog', { name: 'Edit stay' });
    await expect(form).toBeVisible();

    // The derived code is on the line, not in the field.
    const plusCodeInput = form.locator('#seg-plus-code');
    await expect(plusCodeInput).toHaveValue('');
    const pinLine = form.locator('p', { hasText: PLUS_CODE });
    await expect(pinLine).toBeVisible();
    await expect(pinLine).toContainText('Chiyoda');

    // Renaming the stay points it somewhere else, so the old pin stops
    // being where it is.
    const renamed = `Nazuna Kyoto ${stamp}`;
    await form.locator('#seg-property').fill(renamed);
    await expect(pinLine).toHaveCount(0);

    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form).toBeHidden();

    // Nothing froze the pin: the row carries the new name and no Plus
    // Code, so the next geocode runs off the name (ADR-0018).
    const data = await readSegmentData(hotelId);
    expect(data.propertyName).toBe(renamed);
    // The untouched optional field round-trips as an empty string; what
    // matters is that no code was stored.
    expect(data.plusCode ?? '').toBe('');
  });
});
