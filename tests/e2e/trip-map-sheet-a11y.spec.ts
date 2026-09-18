import { createRequire } from 'node:module';

import { type Page } from '@playwright/test';

import { expect, test } from './fixtures/auth';
import {
  seedActivitySegment,
  seedGeocodedActivitySegment,
  seedTrip,
  seedUngeocodedActivitySegment,
} from './fixtures/db';

// The trip map's mobile bottom sheet (vaul) is a Radix dialog, and vaul
// does not forward `modal` to it — so whenever the sheet is in the DOM,
// Radix marks every sibling subtree `aria-hidden="true"`. A `lg:hidden`
// class hid the sheet visually but left it mounted, which took the whole
// map page out of the accessibility tree on laptop (#150). The sheet is
// now mount-gated on the same breakpoint, so these tests assert on the
// accessibility tree, not on what is painted.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 360, height: 640 };

const TRIP_DATES = {
  startDate: new Date('2025-10-04T00:00:00Z'),
  endDate: new Date('2025-10-10T00:00:00Z'),
};

// A trip with dated days (so the rail/sheet have something to render),
// one pinned segment (so the map has geometry and a legend) and one
// unpinnable segment (so the "Not pinned" chip renders — see
// `settle()`).
async function seedMappedTrip(userId: string, title: string): Promise<string> {
  const tripId = await seedTrip(userId, { title, status: 'completed', ...TRIP_DATES });
  // Dated, so the timeline has a day bucket to render.
  await seedActivitySegment(tripId, {
    title: 'Tsukiji walk',
    startsAt: new Date('2025-10-04T09:00:00Z'),
    countryCode: 'JP',
    locationName: 'Tsukiji',
  });
  await seedGeocodedActivitySegment(tripId, {
    title: 'Sensō-ji',
    locationName: 'Asakusa',
    countryCode: 'JP',
    lat: 35.7148,
    lng: 139.7967,
  });
  await seedUngeocodedActivitySegment(tripId, {
    title: `Friend's place ${Date.now()}`,
    countryCode: 'JP',
  });
  return tripId;
}

// Proof that the page has hydrated — required before any assertion that
// something is ABSENT, because the sheet mounts a frame after hydration
// and a count-of-zero fired too early would pass against the bug too.
// Opening the "Not pinned" popover is client-only state, so SSR HTML
// alone cannot satisfy it (the same interaction as
// trip-map-not-pinned-chip.spec.ts). Deliberately NOT MapLibre's `load`
// event, which headless runs don't fire reliably.
async function settle(page: Page): Promise<void> {
  const chip = page.getByRole('button', { name: /segments? not on the map/i });
  const popover = page.getByRole('region', { name: /segments? not on the map/i });
  await expect(chip).toBeVisible();
  // Retry the click: on a cold `next dev` the chip is painted before its
  // handler is live, so the first press can land on nothing. Retrying
  // the pair beats waiting out a single long timeout.
  await expect(async () => {
    await chip.click();
    await expect(popover).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  // The axe scan that follows must not see the popover: an Escape that
  // lands mid-open leaves it up, and its own markup then fails the scan.
  await expect(popover).toBeHidden();
}

// The page's own landmarks and controls, asserted BY ROLE. Playwright's
// role engine skips `aria-hidden` subtrees, so these fail outright when
// the sheet has hidden the page — which a DOM-presence check would not
// catch.
async function expectPageInAccessibilityTree(page: Page, tripTitle: string): Promise<void> {
  await expect(page.getByRole('heading', { name: tripTitle, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Trip timeline' })).toBeVisible();
  // A control that lives on the map surface itself. The wishlist toggle
  // would do too, but it only renders for a trip with geocoded wishlist
  // pins; the legend chip is there whenever the map has a pin.
  await expect(page.getByRole('button', { name: /map legend/i })).toBeVisible();

  // Positive control first: `main` must exist for its absence from the
  // aria-hidden selector below to mean anything.
  await expect(page.locator('main')).toHaveCount(1);
  // `:is(…)` covers `main` carrying the attribute itself as well as
  // inheriting it, so the check survives `<main>` moving to body level.
  await expect(page.locator('main:is([aria-hidden="true"], [aria-hidden="true"] *)')).toHaveCount(
    0,
  );
}

// axe-core ships as a standalone browser bundle, so the scan needs no
// wrapper package — `@axe-core/playwright` would only be a second copy
// of the same engine. Resolved off disk rather than imported, because it
// has to run inside the page, not in the test process.
const requireFromSpec = createRequire(import.meta.url);

declare global {
  interface Window {
    axe: typeof import('axe-core');
  }
}

// A full-document axe scan. Run only once the page has hydrated — a
// scan of the SSR shell would pass without ever seeing the sheet.
async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.addScriptTag({ path: requireFromSpec.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document);
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      target: String(violation.nodes[0]?.target?.[0] ?? '(no target)'),
    }));
  });
  const summary = violations
    .map((violation) => `${violation.id} (${violation.impact}) — ${violation.target}`)
    .join('\n');
  expect(violations, `axe-core violations:\n${summary}`).toEqual([]);
}

test.describe('trip map — timeline sheet accessibility', () => {
  test.describe('laptop', () => {
    test.use({ viewport: LAPTOP });

    test('does not mount the sheet, and leaves the page in the a11y tree', async ({
      authedPage,
      authedUser,
    }) => {
      const title = 'Laptop map a11y';
      const tripId = await seedMappedTrip(authedUser.id, title);
      await authedPage.goto(`/trips/${tripId}/map`);
      await settle(authedPage);

      // No drawer in the DOM at all above the `lg` breakpoint…
      await expect(authedPage.locator('[data-vaul-drawer]')).toHaveCount(0);
      // …and therefore nothing Radix could hide from assistive tech.
      await expectPageInAccessibilityTree(authedPage, title);
      await expectNoAxeViolations(authedPage);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: PHONE });

    test('mounts the sheet', async ({ authedPage, authedUser }) => {
      const tripId = await seedMappedTrip(authedUser.id, 'Phone map sheet');
      await authedPage.goto(`/trips/${tripId}/map`);

      await expect(authedPage.locator('[data-vaul-drawer]')).toHaveCount(1);
      // The peek header is the sheet's accessible name (a Drawer.Title).
      await expect(authedPage.getByRole('dialog', { name: /day 01/i })).toBeVisible();
      // The sheet mounting is client-only, so the assertion above is the
      // hydration signal the scan needs. Green with the sheet open, i.e.
      // the `aria-hidden` Radix puts on its siblings here is the intended
      // dialog behaviour, not a violation (#159 tracks retiring it).
      await expectNoAxeViolations(authedPage);
    });
  });

  test.describe('resize across the breakpoint', () => {
    test.use({ viewport: PHONE });

    test('unmounts on the way up and mounts again on the way down', async ({
      authedPage,
      authedUser,
    }) => {
      const title = 'Resize map sheet';
      const tripId = await seedMappedTrip(authedUser.id, title);
      await authedPage.goto(`/trips/${tripId}/map`);
      // The sheet mounting is itself client-only, so this doubles as the
      // hydration signal for the assertions that follow.
      await expect(authedPage.locator('[data-vaul-drawer]')).toHaveCount(1);

      await authedPage.setViewportSize(LAPTOP);
      await expect(authedPage.locator('[data-vaul-drawer]')).toHaveCount(0);
      // Unmounting the dialog must also clear the `aria-hidden` Radix
      // put on its siblings — a leftover attribute is the same bug.
      await expectPageInAccessibilityTree(authedPage, title);

      await authedPage.setViewportSize(PHONE);
      await expect(authedPage.locator('[data-vaul-drawer]')).toHaveCount(1);
    });
  });
});
