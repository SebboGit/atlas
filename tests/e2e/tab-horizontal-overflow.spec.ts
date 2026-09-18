import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/auth';
import {
  seedActivitySegment,
  seedFoodSegment,
  seedHotelSegment,
  seedTransitSegment,
  seedTrip,
} from './fixtures/db';

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
 * a page-level measurement would also fold in unrelated chrome, so a
 * failure here would not say which layer broke. The trip header's own
 * page-level budget is guarded separately, below (#151) — until that fix
 * a long single-word title pushed the status pill and the overflow menu
 * past 360px, and measuring the document here would have failed this for
 * reasons that had nothing to do with the grid.
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

/**
 * How far a card's text column runs past the left edge of the action
 * cluster. Positive means the buttons sit on top of the text.
 */
async function clusterOverlap(page: Page, segmentId: string): Promise<number> {
  return page.evaluate((id) => {
    const card = document.getElementById(`seg-${id}`);
    if (!card) throw new Error(`segment card seg-${id} not rendered`);
    const textCol = card.querySelector('.min-w-0.flex-1');
    const cluster = card.querySelector('.absolute');
    if (!textCol) throw new Error(`seg-${id}: no text column`);
    if (!cluster) throw new Error(`seg-${id}: no action cluster`);
    return Math.round(textCol.getBoundingClientRect().right - cluster.getBoundingClientRect().left);
  }, segmentId);
}

// Regression guard for #123. The action cluster is `size-7` on pointer
// (88px) but `size-11` on touch to meet the 44px tap-target rule
// (136px), while the card reserved a flat 112px lane — so on every touch
// device the buttons sat 35px inside the text column and a long title
// truncated underneath them. The lane is now measured per input type.
//
// `hasTouch` + `isMobile` is what flips Chromium to `hover: none`, which
// is the media query both the lane width and the glyph hang off. Without
// it this passes trivially: headless Chromium reports `hover: hover` and
// takes the pointer branch.
test.describe('segment cards — action cluster clears the text on touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('the buttons do not overlap the card text', async ({ authedPage, authedUser }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: `Touch ${Date.now().toString(36)}`,
      startDate: new Date('2024-10-01T00:00:00Z'),
      endDate: new Date('2024-10-07T00:00:00Z'),
      status: 'completed',
    });
    // Activities carry the widest cluster — edit + delete + reschedule.
    const activityId = await seedActivitySegment(tripId, {
      title: 'Arashiyama bamboo grove and the monkey park beyond it',
      countryCode: 'JP',
      locationName: 'Arashiyama, Nishikyō-ku',
      startsAt: new Date('2024-10-02T10:00:00Z'),
    });

    await authedPage.goto(`/trips/${tripId}/activities`);
    // Wait for the CLUSTER, not just the tab: SegmentRowSurface is
    // mount-gated behind hydration (#68), so the buttons attach after
    // first paint and measuring too early finds no cluster at all.
    await expect(authedPage.getByRole('button', { name: /^edit activity$/i })).toBeVisible();
    expect(
      await clusterOverlap(authedPage, activityId),
      'action cluster overlaps the card text on a touch device',
    ).toBeLessThanOrEqual(0);
  });
});

/**
 * How far the document's scrollable width runs past the viewport.
 * Positive means the page scrolls sideways, which CLAUDE.md forbids
 * outside an intentional component.
 */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const de = document.documentElement;
    return Math.round(de.scrollWidth - de.clientWidth);
  });
}

// Regression guard for #151 A. The trip title `h1` is a flex item beside
// the `shrink-0` ⋯ actions button (and, before the fix, the status pill
// too — that now rides the back-link line above). A flex item's default
// `min-width: auto` is its min-content width, so a title that is one
// long unbroken word held the `h1` at its full unwrapped width — 402px
// at a 360px viewport — and the document scrolled 243px sideways with
// the actions button off-screen entirely.
//
// The header branch is width-gated (`sm:`), not hover-gated, so the
// emulation is not load-bearing here — `hasTouch` + `isMobile` is for
// consistency with the sibling phone tests in this file, and it is what
// the check-out row below genuinely needs.
test.describe('trip header — a long title does not widen the page', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('the trip page does not scroll sideways at 360px', async ({ authedPage, authedUser }) => {
    // One 23-character word with no break opportunity — the shape that
    // `min-width: auto` refuses to wrap. A title of ordinary words wraps
    // on its spaces and passes even unfixed.
    //
    // It still bites against a PARTIAL revert, which is the thing a
    // widened title column could have hidden: dropping `min-w-0` from
    // the `h1` fails this by 124px and dropping `break-words` by 68px
    // (both verified), so neither class can go quietly.
    //
    // Private, because the phone badge cluster is the widest it gets
    // with both badges in it — and a household trip would render only
    // one of them, leaving the private half of the cluster untested.
    const tripId = await seedTrip(authedUser.id, {
      title: `Reykjavikurborgarferdin ${Date.now().toString(36)}`,
      startDate: new Date('2024-11-01T00:00:00Z'),
      endDate: new Date('2024-11-07T00:00:00Z'),
      status: 'completed',
      visibility: 'private',
    });

    await authedPage.goto(`/trips/${tripId}/itinerary`);
    // The ⋯ menu is the rightmost element in the title row and the one
    // that fell off the edge, so wait for it rather than the heading —
    // measuring before it mounts would measure a narrower row.
    await expect(authedPage.getByRole('button', { name: 'Trip actions' })).toBeVisible();

    // Both badges render twice — once in the `sm:hidden` cluster on the
    // back-link line, once in the `hidden sm:flex` eyebrow row — so
    // filter to the copy this viewport actually shows (the idiom
    // two-user-visibility.spec.ts uses). Asserting they are on screen at
    // all is the other half of the measurement below: a header that fits
    // 360px by dropping a badge would otherwise pass.
    await expect(
      authedPage.getByText('Private', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      authedPage.getByText('Completed', { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    expect(
      await pageOverflow(authedPage),
      'the trip page scrolls sideways at 360px',
    ).toBeLessThanOrEqual(0);
  });

  // The map route has its own `h1` in its own header and took the same
  // `min-w-0 break-words hyphens-auto`. Measuring it at the document
  // level is stable despite the MapLibre canvas — the canvas is sized
  // from its container, so the page width settles before the first tile
  // and does not move once they land.
  test('the trip map page does not scroll sideways at 360px', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: `Reykjavikurborgarferdin ${Date.now().toString(36)}`,
      startDate: new Date('2024-11-01T00:00:00Z'),
      endDate: new Date('2024-11-07T00:00:00Z'),
      status: 'completed',
    });

    await authedPage.goto(`/trips/${tripId}/map`);
    await expect(authedPage.getByRole('heading', { level: 1 })).toBeVisible();

    expect(
      await pageOverflow(authedPage),
      'the trip map page scrolls sideways at 360px',
    ).toBeLessThanOrEqual(0);
  });
});

// Regression guard for #151 B. On the last day of a stay the continuation
// row grows a filled "Check Out <time>" chip. Every sibling in that row
// is `shrink-0` while the name span was only `min-w-0 truncate`, so the
// chip took the whole row and the name collapsed to 0px — the row read as
// a bare time with no place. `flex-1` on the name is half the fix; the
// other half is the "Staying" pill standing down below `sm:` on this one
// row, without which the shrink-0 siblings still overspend the row.
test.describe('itinerary continuation — the check-out chip keeps the name', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('the hotel name still has width on the check-out day', async ({
    authedPage,
    authedUser,
  }) => {
    const tripId = await seedTrip(authedUser.id, {
      title: `Checkout ${Date.now().toString(36)}`,
      startDate: new Date('2024-12-01T00:00:00Z'),
      endDate: new Date('2024-12-07T00:00:00Z'),
      status: 'completed',
    });
    // Long enough to fill the row on its own, so the name can only keep
    // width by claiming the leftover rather than by being short.
    await seedHotelSegment(tripId, {
      propertyName: 'The Ritz-Carlton Kyoto Riverside Deluxe Suite',
      countryCode: 'JP',
      locationName: 'Nakagyo-ku, Kyoto',
      startsAt: new Date('2024-12-02T15:00:00Z'),
      endsAt: new Date('2024-12-05T11:00:00Z'),
      // Only a hotel carrying a check-out TIME grows the chip; `endsAt`
      // alone renders the plain "Staying" row (continuationCheckOutTime).
      checkOutTime: '11:00',
    });

    await authedPage.goto(`/trips/${tripId}/itinerary`);
    // The check-out day's row is the one whose spoken label carries the
    // check-out clause — every earlier day of the stay renders the same
    // name without it.
    const checkOutRow = authedPage.getByRole('link', { name: /checking out at 11:00$/ });
    await expect(checkOutRow).toBeVisible();

    const nameWidth = await checkOutRow.evaluate((row) => {
      // `:scope >` so this can only ever be the row's own name span —
      // a bare `span` would also match anything nested inside a chip.
      const name = row.querySelector(':scope > span:first-of-type');
      if (!name) throw new Error('continuation row has no name span');
      return Math.round(name.getBoundingClientRect().width);
    });
    // Measured at 48px with the fix, 0px without it. The floor is a
    // little under that: enough to prove the name still claims the
    // leftover, loose enough to survive a font-metric nudge.
    expect(nameWidth, 'the Check Out chip evicted the hotel name').toBeGreaterThan(40);
  });
});

/**
 * Vertical gap between a card's meta block and the bottom of its
 * headline. Negative means the meta still shares the title row.
 *
 * Walks up from the `h3` rather than matching the meta by class: the
 * nearest `.min-w-0.flex-1` ancestor is the text column, and the meta is
 * its next sibling in both layouts — so the measurement says where the
 * block landed without encoding which classes put it there.
 */
async function metaGapBelowHeadline(page: Page, segmentId: string): Promise<number> {
  return page.evaluate((id) => {
    const card = document.getElementById(`seg-${id}`);
    if (!card) throw new Error(`segment card seg-${id} not rendered`);
    const headline = card.querySelector('h3');
    if (!headline) throw new Error(`seg-${id}: no headline`);
    const textCol = headline.closest('.min-w-0.flex-1');
    if (!textCol) throw new Error(`seg-${id}: the headline is not inside a text column`);
    const meta = textCol.nextElementSibling;
    if (!meta) throw new Error(`seg-${id}: no meta block beside the text column`);
    return Math.round(meta.getBoundingClientRect().top - headline.getBoundingClientRect().bottom);
  }, segmentId);
}

// `now`-relative UTC dates, as in transit-endpoints.spec.ts: once the
// client knows "today", a past day folds into the collapsed pill and the
// card leaves the DOM entirely, so a 2024 leg would measure nothing.
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

// Regression guard for #151 C. A transit headline is two station names
// and an arrow, and below `sm:` the departure/arrival block beside it
// left the title 65px of a 138px text column — "Kyoto Station →
// Shin-Osaka Station" wrapped over five lines. The card now passes
// `stackMetaOnMobile`, which drops the shell's title row to a column so
// the meta sits under the headline and the title gets the full width.
//
// Drop that prop and the shell falls back to its default row layout:
// the meta returns to the top-right of the title row, its top lands
// 199px ABOVE the bottom of the five-line headline, and this fails
// (verified by removing it).
test.describe('transit cards — the time meta stacks under the headline at 360px', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('the departure and arrival times sit below the station headline', async ({
    authedPage,
    authedUser,
  }) => {
    const stamp = Date.now();
    const tripId = await seedTrip(authedUser.id, {
      title: `Transit ${stamp.toString(36)}`,
      startDate: relDay(1),
      endDate: relDay(3),
      status: 'planned',
    });
    // Long enough that the headline needs the whole column. Stamped
    // names keep the station cache keys to this test (they are shared
    // across rows with the same mode, country and name), and both ends
    // seeded as hits keep the geocode poller off the page.
    const transitId = await seedTransitSegment(tripId, {
      mode: 'train',
      fromName: `Kyoto Station ${stamp}`,
      toName: `Shin-Osaka Station ${stamp}`,
      countryCode: 'JP',
      startsAt: relDay(2, 9),
      endsAt: relDay(2, 11),
      origin: { lat: 34.9858, lng: 135.7588 },
      destination: { lat: 34.7332, lng: 135.5003 },
    });

    await authedPage.goto(`/trips/${tripId}/itinerary`);
    // The card becomes the inspector trigger only after mount, so this
    // also waits out hydration before anything is measured.
    await expect(authedPage.getByRole('button', { name: 'View transit details' })).toBeVisible();

    expect(
      await metaGapBelowHeadline(authedPage, transitId),
      'the transit time meta still shares the row with the headline at 360px',
    ).toBeGreaterThanOrEqual(0);
  });
});
