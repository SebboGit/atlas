import { expect, test } from './fixtures/auth';
import { seedActivitySegment, seedTrip, seedWishlistActivity } from './fixtures/db';

// Wishlist is the household's reusable place list. The five scenarios
// below exercise the architecture from the original issue:
//
//   1. Created items appear on /wishlist
//   2. They surface as suggestions on trips in their country
//   3. Adding to a trip materialises a segment AND removes the
//      suggestion from THAT trip
//   4. The same item still suggests on a SECOND trip in the same country
//   5. Deleting a wishlist item does NOT cascade to materialised segments
//
// Setup is via DB seeding — the wishlist form's country combobox is a
// custom popover (not a native <select>) and driving it is brittle. The
// Zod input shape is already unit-tested at src/lib/wishlist/validators.ts.
// What's load-bearing for E2E is the surfaces and the cross-trip
// suggestion logic, not the form widget.
//
// Activity suggestions live in a collapsed-by-default disclosure at the
// top of the Activities tab (food suggestions sit on the Food tab). The
// helper below opens that disclosure; the "From your wishlist" toggle is
// always present once a trip has at least one suggestion.

const SUGGESTIONS_TOGGLE = /from your wishlist/i;

test.describe('wishlist', () => {
  test('seeded item appears on /wishlist', async ({ authedPage, authedUser }) => {
    const title = `Senso-ji ${Date.now()}`;
    await seedWishlistActivity(authedUser.id, {
      title,
      countryCode: 'JP',
      locationName: 'Asakusa',
    });

    await authedPage.goto('/wishlist');
    await expect(authedPage.getByText(title)).toBeVisible();
  });

  test('item shows as a suggestion on a same-country trip', async ({ authedPage, authedUser }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Japan trip A',
      startDate: new Date('2024-03-01T00:00:00Z'),
      endDate: new Date('2024-03-07T00:00:00Z'),
      status: 'completed',
    });
    // Trip-country derivation is via segments (ADR-0005), not a
    // trip_countries table — seed at least one JP segment so the trip
    // counts as a Japan trip for the suggestions query.
    await seedActivitySegment(tripId, {
      title: 'Anchor segment',
      countryCode: 'JP',
      startsAt: new Date('2024-03-02T10:00:00Z'),
    });
    const wishlistTitle = `Tsukiji market ${Date.now()}`;
    await seedWishlistActivity(authedUser.id, {
      title: wishlistTitle,
      countryCode: 'JP',
    });

    await authedPage.goto(`/trips/${tripId}/activities`);
    // The disclosure is collapsed by default; its toggle is always
    // present when the trip has suggestions. Expand it to reveal the rows.
    const suggestionsToggle = authedPage.getByRole('button', { name: SUGGESTIONS_TOGGLE });
    await expect(suggestionsToggle).toBeVisible();
    await suggestionsToggle.click();
    await expect(authedPage.getByText(wishlistTitle)).toBeVisible();
  });

  test('adding to trip materialises a segment and removes the suggestion', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Japan trip B',
      startDate: new Date('2024-04-01T00:00:00Z'),
      endDate: new Date('2024-04-07T00:00:00Z'),
      status: 'completed',
    });
    await seedActivitySegment(tripId, {
      title: 'Anchor segment',
      countryCode: 'JP',
      startsAt: new Date('2024-04-02T10:00:00Z'),
    });
    const wishlistTitle = `Shinjuku gyoen ${Date.now()}`;
    await seedWishlistActivity(authedUser.id, {
      title: wishlistTitle,
      countryCode: 'JP',
    });

    await authedPage.goto(`/trips/${tripId}/activities`);
    await authedPage.getByRole('button', { name: SUGGESTIONS_TOGGLE }).click();
    // Suggestion present.
    await expect(authedPage.getByText(wishlistTitle)).toBeVisible();

    // Click "Add to trip" inside the suggestion card. There's only one
    // suggestion on this trip so a top-level button query is unambiguous.
    await authedPage.getByRole('button', { name: /add to trip/i }).click();

    // Wait on the deterministic post-action state — the suggestion's
    // "Add to trip" button disappears once the RSC payload from the
    // action's revalidatePath lands. It was the only suggestion, so the
    // whole panel collapses to nothing. The component's transient "Added
    // to Activities" confirmation chip races the same revalidate, so
    // checking it directly is flaky; the button-gone state is not.
    await expect(authedPage.getByRole('button', { name: /add to trip/i })).toHaveCount(0);

    // The materialised segment now renders as a regular activity card on
    // this same tab.
    await expect(authedPage.getByText(wishlistTitle)).toBeVisible();

    // Reloading keeps the suggestion gone (excluded by
    // excludeMaterialisedOnTrip in wishlist/repo) while the card stays.
    await authedPage.goto(`/trips/${tripId}/activities`);
    await expect(authedPage.getByRole('button', { name: /add to trip/i })).toHaveCount(0);
    await expect(authedPage.getByText(wishlistTitle)).toBeVisible();
  });

  test('same item still suggests on a different same-country trip', async ({
    authedPage,
    authedUser,
  }) => {
    const tripAId = await seedTrip(authedUser.id, {
      title: 'Japan trip C',
      startDate: new Date('2024-05-01T00:00:00Z'),
      endDate: new Date('2024-05-07T00:00:00Z'),
      status: 'completed',
    });
    const tripBId = await seedTrip(authedUser.id, {
      title: 'Japan trip D',
      startDate: new Date('2024-06-01T00:00:00Z'),
      endDate: new Date('2024-06-07T00:00:00Z'),
      status: 'completed',
    });
    await seedActivitySegment(tripAId, {
      title: 'Anchor A',
      countryCode: 'JP',
      startsAt: new Date('2024-05-02T10:00:00Z'),
    });
    await seedActivitySegment(tripBId, {
      title: 'Anchor B',
      countryCode: 'JP',
      startsAt: new Date('2024-06-02T10:00:00Z'),
    });
    const wishlistTitle = `Teamlab Planets ${Date.now()}`;
    await seedWishlistActivity(authedUser.id, {
      title: wishlistTitle,
      countryCode: 'JP',
    });

    // Add to trip A.
    await authedPage.goto(`/trips/${tripAId}/activities`);
    await authedPage.getByRole('button', { name: SUGGESTIONS_TOGGLE }).click();
    await authedPage.getByRole('button', { name: /add to trip/i }).click();
    // Wait for the action's revalidate to land — the suggestion's
    // "Add to trip" button disappears on this trip once materialised.
    await expect(authedPage.getByRole('button', { name: /add to trip/i })).toHaveCount(0);

    // Trip B's suggestion panel still surfaces the same item — the
    // exclusion is per-trip, not global.
    await authedPage.goto(`/trips/${tripBId}/activities`);
    await authedPage.getByRole('button', { name: SUGGESTIONS_TOGGLE }).click();
    await expect(authedPage.getByText(wishlistTitle)).toBeVisible();
  });

  test('deleting a wishlist item leaves materialised segments alone', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: 'Japan trip E',
      startDate: new Date('2024-07-01T00:00:00Z'),
      endDate: new Date('2024-07-07T00:00:00Z'),
      status: 'completed',
    });
    await seedActivitySegment(tripId, {
      title: 'Anchor segment',
      countryCode: 'JP',
      startsAt: new Date('2024-07-02T10:00:00Z'),
    });
    const wishlistTitle = `Meiji Jingu ${Date.now()}`;
    await seedWishlistActivity(authedUser.id, {
      title: wishlistTitle,
      countryCode: 'JP',
    });

    // Materialise the wishlist item onto the trip via UI.
    await authedPage.goto(`/trips/${tripId}/activities`);
    await authedPage.getByRole('button', { name: SUGGESTIONS_TOGGLE }).click();
    await authedPage.getByRole('button', { name: /add to trip/i }).click();
    // Wait for the action's revalidate to land before navigating away.
    await expect(authedPage.getByRole('button', { name: /add to trip/i })).toHaveCount(0);

    // Confirm the segment exists on the activities tab (materialised card).
    await expect(authedPage.getByText(wishlistTitle)).toBeVisible();

    // Delete the wishlist item via the /wishlist UI.
    await authedPage.goto('/wishlist');
    await authedPage.getByRole('button', { name: /delete this attraction/i }).click();
    await authedPage.getByRole('button', { name: /^remove$/i }).click();
    // After delete, the /wishlist list should no longer show the item.
    await expect(authedPage.getByText(wishlistTitle)).toHaveCount(0);

    // The materialised segment survives the delete (FK from
    // segments.wishlistItemId is ON DELETE SET NULL).
    await authedPage.goto(`/trips/${tripId}/activities`);
    await expect(authedPage.getByText(wishlistTitle)).toBeVisible();
  });
});
