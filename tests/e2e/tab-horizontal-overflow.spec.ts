import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/auth';
import { seedActivitySegment, seedFoodSegment, seedTrip } from './fixtures/db';

// Regression guard for #117. The Food and Activities tabs render their
// segments in a `grid`, and a grid item defaults to `min-width: auto` —
// so the item was forced to the card's min-content (~364px) instead of
// the ~312px available at 360px wide, burst out of its track, and the
// whole page scrolled sideways by 30px.

const PHONE = { width: 360, height: 640 };

/**
 * How far one seeded segment's card sticks out past the list holding it.
 *
 * Anchored on the card's own `seg-<id>` element rather than a
 * `querySelector('ul.grid')`, for two reasons. The wishlist suggestions
 * panel renders an identical `ul.grid` ABOVE the segment list, so a
 * selector-based lookup silently measures the wrong list the moment that
 * panel is open — and its cards are narrow enough to pass, which would
 * leave this green with the fix reverted. And measuring a known segment
 * means "nothing matched" throws instead of quietly returning 0.
 *
 * Scoped to the list rather than `document.documentElement` on purpose:
 * a page-level measurement also trips on unrelated chrome (the trip
 * header's status pill and overflow menu can push past 360px on a long
 * title), which would fail this for reasons unrelated to the grid.
 */
async function cardOverflow(page: Page, segmentId: string): Promise<number> {
  return page.evaluate((id) => {
    const card = document.getElementById(`seg-${id}`);
    if (!card) throw new Error(`segment card seg-${id} not rendered`);
    const list = card.closest('ul');
    if (!list) throw new Error(`segment card seg-${id} is not inside a list`);
    return Math.round(card.getBoundingClientRect().width - list.getBoundingClientRect().width);
  }, segmentId);
}

test.describe('trip tabs — segment cards fit their list at 360px', () => {
  test('Activities and Food cards do not exceed the list width on a phone viewport', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: `Overflow ${Date.now().toString(36)}`,
      startDate: new Date('2024-09-01T00:00:00Z'),
      endDate: new Date('2024-09-07T00:00:00Z'),
      status: 'completed',
    });

    // A long title with a long location is the shape that pushed the
    // card's min-content past the viewport. Both tabs need their own
    // segment: an empty tab renders TabEmpty instead of the grid, so it
    // would pass without exercising the thing under test.
    const activityId = await seedActivitySegment(tripId, {
      title: 'Arashiyama bamboo grove and the monkey park beyond it',
      countryCode: 'JP',
      locationName: 'Arashiyama, Nishikyō-ku',
      startsAt: new Date('2024-09-02T10:00:00Z'),
    });
    const foodId = await seedFoodSegment(tripId, {
      venue: 'Kikunoi Roan counter seating, second sitting',
      countryCode: 'JP',
      locationName: 'Shimogyō-ku, Kyoto',
      startsAt: new Date('2024-09-03T19:00:00Z'),
    });

    await authedPage.setViewportSize(PHONE);

    const tabs = [
      { path: 'activities', addButton: /add activity/i, segmentId: activityId },
      { path: 'food', addButton: /add food/i, segmentId: foodId },
    ] as const;

    for (const tab of tabs) {
      await authedPage.goto(`/trips/${tripId}/${tab.path}`);
      // Wait on the tab's own control so the measurement can't race an
      // empty first paint. `.first()` — the header's add button and the
      // empty state's share an accessible name.
      await expect(authedPage.getByRole('button', { name: tab.addButton }).first()).toBeVisible();
      // Soft, so a failure on the first tab still reports the second
      // rather than hiding it behind an early abort.
      expect
        .soft(
          await cardOverflow(authedPage, tab.segmentId),
          `${tab.path} tab: the segment card is wider than its list`,
        )
        .toBeLessThanOrEqual(0);
    }
  });
});
