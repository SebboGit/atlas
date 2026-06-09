import { expect, test } from './fixtures/auth';
import { seedActivitySegment, seedHotelSegment, seedTrip } from './fixtures/db';

// Regression guard for the "Staying since" continuation rows on an active
// trip's itinerary. A multi-day hotel that checked in on a now-collapsed
// past day surfaces as a quiet continuation row on today; tapping it must
// expand the collapsed past AND flash the real card — on EVERY tap, not
// just the first.
//
// The bug: the continuation was a bare `<a href="#seg-<id>">`. A stay
// shows the same `#seg-<id>` link on every day it spans, so a second tap
// lands on the hash that's already set — the browser fires no
// `hashchange`, and both the force-expand and use-segment-scroll-flash
// (which key off the hash changing) stayed inert. The fix wires an
// onActivate that re-arms the expand and re-fires the flash regardless.

// `now`-relative UTC dates so the trip always straddles "today" whenever
// the suite runs. Mirrors scripts/lib/fixture-data.ts's `relDay`: noon-ish
// UTC keeps each segment on a stable calendar day under any runner TZ
// (CI is UTC), and floating-local times (ADR-0014) are read at UTC anyway.
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

// The inline border-radius use-segment-scroll-flash pins on the target
// row for the duration of the flash, then restores. Its presence is the
// observable proof the flash fired (see use-segment-scroll-flash.ts).
const RING_RADIUS = '1.25rem';

test.describe('itinerary continuation re-activation', () => {
  let tripId: string;
  let hotelId: string;

  test.beforeEach(async ({ authedUser }) => {
    // Active trip straddling today: a collapsed past run (an arrival on
    // day -3, the hotel check-in on day -2) and a visible "today". The
    // hotel runs -2..+2, so it shows a "Staying since" continuation today.
    tripId = await seedTrip(authedUser.id, {
      title: `Patagonia ${Date.now()}`,
      status: 'active',
      startDate: relDay(-3),
      endDate: relDay(2),
    });
    // No countryCode — the collapse/continuation logic is date-driven, and
    // omitting it keeps the spec independent of reference-data seeding (the
    // `countries` FK), so it stands alone from the wishlist suite's needs.
    await seedActivitySegment(tripId, {
      title: 'Arrival at the park',
      startsAt: relDay(-3, 9),
    });
    hotelId = await seedHotelSegment(tripId, {
      propertyName: 'Hotel Las Torres',
      startsAt: relDay(-2, 15),
      endsAt: relDay(2, 11),
    });
    await seedActivitySegment(tripId, {
      title: 'French Valley viewpoint',
      startsAt: relDay(0, 9),
    });
  });

  test('re-flashes the hotel card every time the continuation is tapped', async ({
    authedPage,
  }) => {
    // Force the animated flash path so the ring clears itself between taps
    // — under `reduce`, flash() sets the radius and returns without
    // restoring, which would defeat the "fresh flash" assertion below.
    await authedPage.emulateMedia({ reducedMotion: 'no-preference' });
    await authedPage.goto(`/trips/${tripId}/itinerary`);

    const hotelCard = authedPage.locator(`#seg-${hotelId}`);
    // The stay spans several rendered days, so the same "staying" row
    // appears on each — `.first()` (today's) is the one we drive.
    const continuation = authedPage
      .getByRole('link', { name: /Hotel Las Torres — staying/ })
      .first();

    // Past starts collapsed once the client classifies days: the hotel's
    // own card lives inside the folded run, so only continuations show.
    await expect(continuation).toBeVisible();
    await expect(hotelCard).toHaveCount(0);

    // First tap: expands the past and flashes the card.
    await continuation.click();
    await expect(hotelCard).toBeVisible();
    await expect
      .poll(() => hotelCard.evaluate((n) => n.style.borderRadius), { timeout: 3000 })
      .toBe(RING_RADIUS);

    // The flash restores the radius after ~1.6s — wait it out so the next
    // assertion can only pass on a genuinely fresh flash.
    await expect
      .poll(() => hotelCard.evaluate((n) => n.style.borderRadius), { timeout: 4000 })
      .toBe('');

    // Second tap on the SAME continuation → same `#seg` hash → no native
    // hashchange. Pre-fix this was a no-op; the fix must re-fire the flash.
    await continuation.click();
    await expect
      .poll(() => hotelCard.evaluate((n) => n.style.borderRadius), { timeout: 3000 })
      .toBe(RING_RADIUS);
  });

  test('re-opens the past after the user collapsed it', async ({ authedPage }) => {
    await authedPage.goto(`/trips/${tripId}/itinerary`);

    const hotelCard = authedPage.locator(`#seg-${hotelId}`);
    const continuation = authedPage
      .getByRole('link', { name: /Hotel Las Torres — staying/ })
      .first();

    // Open via the continuation, then fold the past back up via its chevron
    // (which "releases" this exact deep-link hash).
    await expect(continuation).toBeVisible();
    await continuation.click();
    await expect(hotelCard).toBeVisible();

    await authedPage.getByRole('button', { name: 'Collapse past days' }).click();
    await expect(hotelCard).toHaveCount(0);

    // Tapping the continuation again must re-open the past — pre-fix the
    // released hash kept it folded, since the tap couldn't change the hash.
    await continuation.click();
    await expect(hotelCard).toBeVisible();
  });
});
