import { createRequire } from 'node:module';

import { type Page } from '@playwright/test';

import { expect, test } from './fixtures/auth';
import {
  seedActivitySegment,
  seedGeocodedActivitySegment,
  seedTrip,
  seedUngeocodedActivitySegment,
} from './fixtures/db';

// The trip map's mobile bottom sheet used to be a vaul Drawer — a Radix
// dialog vaul never made non-modal — so wherever it mounted, Radix marked
// every sibling subtree `aria-hidden="true"` and trapped focus inside it:
// the whole map page at laptop width while a `lg:hidden` class merely
// hid the sheet (#150), and everything but the sheet below `lg` (#159).
// It is now a plain `<aside>` mounted only below `lg`, so these tests
// assert on the accessibility tree and on focus, not on what is painted.

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 360, height: 640 };
const TALL_PHONE = { width: 390, height: 844 };
// Below `lg`, so the sheet mounts, but driven by a mouse.
const NARROW_WINDOW = { width: 900, height: 700 };

const TRIP_DATES = {
  startDate: new Date('2025-10-04T00:00:00Z'),
  endDate: new Date('2025-10-10T00:00:00Z'),
};

// A trip with dated days (so the rail/sheet have something to render),
// one dated, pinned segment (so the map has geometry and a legend, and
// the timeline a selectable row) and one unpinnable segment (so the "Not pinned" chip renders — see
// `settle()`). One country only: the country chip strip's quiet ISO
// codes are a deliberate sub-AA choice that would fail the axe scan.
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
    startsAt: new Date('2025-10-05T09:00:00Z'),
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
  const chip = page.getByRole('button', { name: /^not pinned\s*,\s*\d+ segments?$/i });
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
  await expect(page.getByRole('button', { name: /^legend$/i })).toBeVisible();

  // The rest of the map page's own chrome: the way off the route, the map
  // landmark, the chip over it, and the top bar.
  await expect(page.getByRole('link', { name: 'Back to trip' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Trip map' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^not pinned\s*,\s*\d+ segments?$/i }),
  ).toBeVisible();
  await expect(page.getByRole('banner')).toBeVisible();

  // Positive control first: `main` must exist for its absence from the
  // aria-hidden selector below to mean anything.
  await expect(page.locator('main')).toHaveCount(1);
  // `:is(…)` covers `main` carrying the attribute itself as well as
  // inheriting it, so the check survives `<main>` moving to body level.
  await expect(page.locator('main:is([aria-hidden="true"], [aria-hidden="true"] *)')).toHaveCount(
    0,
  );
  // Nothing is made inert either — the role engine above would not catch
  // that, since `inert` leaves the tree but takes away interaction.
  await expect(page.locator('[inert]')).toHaveCount(0);
}

// The sheet's header button: its name is the peek summary ("Day 01 · 2
// items"), which the laptop rail's day buttons ("Day 01 SAT 4 OCT") never
// match — so this also tells the sheet's presence from the rail's.
function sheetHandle(page: Page) {
  return page.getByRole('button', { name: /^day 01 · \d+ items?$/i });
}

// The sheet itself — the laptop rail is a "Trip timeline" too, but has no
// header button controlling a list.
function sheet(page: Page) {
  return page.locator('aside[aria-label="Trip timeline"]:has(button[aria-controls])');
}

// The sheet's top edge, once its snap transition has come to rest.
async function settledSheetTop(page: Page): Promise<number> {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const top = (await sheet(page).boundingBox())?.y ?? Number.NaN;
      const still = top === last;
      last = top;
      return still;
    })
    .toBe(true);
  return last;
}

// The focused control is on screen and not under the (settled) sheet —
// WCAG 2.4.11, Focus Not Obscured.
async function expectFocusClearOfSheet(page: Page): Promise<void> {
  const sheetTop = await settledSheetTop(page);
  const focused = page.locator(':focus');
  await expect(focused).toBeInViewport();
  const box = await focused.boundingBox();
  expect(box, 'focused control has a box').not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(sheetTop);
}

// Whether keyboard focus currently sits inside the sheet.
function focusIsInSheet(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Boolean(document.activeElement?.closest('aside[aria-label="Trip timeline"]')),
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

// A full-document axe scan, every rule on. Run only once the page has
// hydrated — a scan of the SSR shell would pass without ever seeing the
// sheet.
async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.addScriptTag({ path: requireFromSpec.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document);
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      targets: violation.nodes.map((node) => String(node.target[0] ?? '(no target)')),
    }));
  });
  const summary = violations
    .map((violation) => `${violation.id} (${violation.impact}) — ${violation.targets.join(', ')}`)
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

      // No sheet in the DOM at all above the `lg` breakpoint — the
      // inline rail is the page's one "Trip timeline".
      await expect(sheetHandle(authedPage)).toHaveCount(0);
      await expect(authedPage.getByRole('complementary', { name: 'Trip timeline' })).toHaveCount(1);
      await expectPageInAccessibilityTree(authedPage, title);
      await expectNoAxeViolations(authedPage);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test('mounts the sheet as a landmark that hides nothing', async ({
      authedPage,
      authedUser,
    }) => {
      const title = 'Phone map sheet';
      const tripId = await seedMappedTrip(authedUser.id, title);
      await authedPage.goto(`/trips/${tripId}/map`);

      // The sheet mounting is client-only, so this is also the hydration
      // signal for everything below.
      await expect(sheetHandle(authedPage)).toBeVisible();
      await expect(authedPage.getByRole('complementary', { name: 'Trip timeline' })).toBeVisible();
      await expect(authedPage.getByRole('dialog')).toHaveCount(0);

      await expectPageInAccessibilityTree(authedPage, title);
      // Includes `aria-hidden-focus`, which the vaul dialog failed for
      // every control on the map.
      await expectNoAxeViolations(authedPage);
    });

    test('the header is a button that raises and lowers the sheet', async ({
      authedPage,
      authedUser,
    }) => {
      const tripId = await seedMappedTrip(authedUser.id, 'Phone sheet handle');
      await authedPage.goto(`/trips/${tripId}/map`);
      const handle = sheetHandle(authedPage);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      const peekTop = await settledSheetTop(authedPage);

      // A tap raises it. Retried because a cold `next dev` paints the
      // header before its handler is live — but only while it is still
      // down, so a retry can never toggle it back.
      await expect(async () => {
        if ((await handle.getAttribute('aria-expanded')) === 'false') await handle.tap();
        await expect(handle).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      const openTop = await settledSheetTop(authedPage);
      expect(openTop).toBeLessThan(peekTop - PHONE.height / 2);
      // Over the page rather than the map, the header's text is where
      // contrast can actually be measured.
      await expectNoAxeViolations(authedPage);

      // The keyboard drives it too: arrows step, Escape lowers.
      await handle.focus();
      await authedPage.keyboard.press('ArrowDown');
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      await authedPage.keyboard.press('ArrowUp');
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      await authedPage.keyboard.press('Escape');
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      expect(await settledSheetTop(authedPage)).toBeCloseTo(peekTop, 0);
    });

    test('focus moves freely in and out, and is never left under the sheet', async ({
      authedPage,
      authedUser,
    }) => {
      const tripId = await seedMappedTrip(authedUser.id, 'Phone sheet focus');
      await authedPage.goto(`/trips/${tripId}/map`);
      const handle = sheetHandle(authedPage);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');

      // Tab from the header into the list: at the peek that row hangs
      // below the screen edge, so the sheet rises to show it.
      await handle.focus();
      await authedPage.keyboard.press('Tab');
      expect(await focusIsInSheet(authedPage)).toBe(true);
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      await expect(authedPage.locator(':focus')).toBeInViewport();

      // Back out the way it came: past the header to the map's own
      // controls. Radix's focus trap bounced this back into the sheet.
      // Those controls sit right behind the open sheet, so leaving
      // lowers it, and the control focus lands on is not covered.
      await authedPage.keyboard.press('Shift+Tab');
      await expect(handle).toBeFocused();
      await authedPage.keyboard.press('Shift+Tab');
      expect(await focusIsInSheet(authedPage)).toBe(false);
      expect(
        await authedPage.evaluate(() => Boolean(document.activeElement?.closest('main'))),
      ).toBe(true);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      await expectFocusClearOfSheet(authedPage);

      // And forward out of the far end: the last control in the sheet
      // hands focus on rather than wrapping to the first.
      await authedPage
        .getByRole('complementary', { name: 'Trip timeline' })
        .getByRole('button')
        .last()
        .focus();
      await authedPage.keyboard.press('Tab');
      expect(await focusIsInSheet(authedPage)).toBe(false);
    });

    test('a focused map chip is scrolled out from under the peek', async ({
      authedPage,
      authedUser,
    }) => {
      const tripId = await seedMappedTrip(authedUser.id, 'Phone sheet chips');
      await authedPage.goto(`/trips/${tripId}/map`);
      await expect(sheetHandle(authedPage)).toHaveAttribute('aria-expanded', 'false');

      // The chips sit at the map's bottom edge, which at rest is under
      // the peek. Both phone heights: the peek is a share of the height.
      for (const viewport of [PHONE, TALL_PHONE]) {
        await authedPage.setViewportSize(viewport);
        for (const name of [/^not pinned\s*,\s*\d+ segments?$/i, /^legend$/i]) {
          await authedPage.evaluate(() => window.scrollTo(0, 0));
          await authedPage.getByRole('button', { name }).focus();
          await expectFocusClearOfSheet(authedPage);
        }
      }
    });

    test('a keyboard selection keeps the sheet up, a tap drops it', async ({
      authedPage,
      authedUser,
    }) => {
      const tripId = await seedMappedTrip(authedUser.id, 'Phone sheet select');
      await authedPage.goto(`/trips/${tripId}/map`);
      const handle = sheetHandle(authedPage);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      await handle.focus();
      await authedPage.keyboard.press('ArrowUp');
      await expect(handle).toHaveAttribute('aria-expanded', 'true');

      const row = sheet(authedPage).getByRole('button', { name: /sensō-ji/i });
      // Enter selects without dropping the sheet from under the focus…
      await row.focus();
      await authedPage.keyboard.press('Enter');
      await expect(row).toHaveAttribute('aria-pressed', 'true');
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      await expect(row).toBeInViewport();
      // …a second Enter deselects…
      await authedPage.keyboard.press('Enter');
      await expect(row).toHaveAttribute('aria-pressed', 'false');
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      // …and a tap selects and drops the sheet to show the map.
      await row.tap();
      await expect(row).toHaveAttribute('aria-pressed', 'true');
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test.describe('phone, dark', () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true, colorScheme: 'dark' });

    test('the open sheet passes the scan in dark mode too', async ({ authedPage, authedUser }) => {
      const tripId = await seedMappedTrip(authedUser.id, 'Phone sheet dark');
      await authedPage.goto(`/trips/${tripId}/map`);
      const handle = sheetHandle(authedPage);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      await handle.focus();
      await authedPage.keyboard.press('ArrowUp');
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      await settledSheetTop(authedPage);
      await expectNoAxeViolations(authedPage);
    });
  });

  test.describe('narrow window with a mouse', () => {
    test.use({ viewport: NARROW_WINDOW });

    test('a mouse drag on the header snaps, and the sheet is not left stuck', async ({
      authedPage,
      authedUser,
    }) => {
      const tripId = await seedMappedTrip(authedUser.id, 'Mouse sheet drag');
      await authedPage.goto(`/trips/${tripId}/map`);
      const handle = sheetHandle(authedPage);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      const peekTop = await settledSheetTop(authedPage);

      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await authedPage.mouse.move(x, y);
      await authedPage.mouse.down();
      await authedPage.mouse.move(x, y - 300, { steps: 15 });
      await authedPage.mouse.up();
      // Raised, and the click that ends the drag was swallowed — it
      // would have toggled the sheet straight back down.
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      expect(await settledSheetTop(authedPage)).toBeLessThan(peekTop - 200);

      // A plain click afterwards still works, and the sheet really moves.
      await handle.click();
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      expect(await settledSheetTop(authedPage)).toBeCloseTo(peekTop, 0);
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
      await expect(sheetHandle(authedPage)).toHaveCount(1);

      await authedPage.setViewportSize(LAPTOP);
      await expect(sheetHandle(authedPage)).toHaveCount(0);
      await expectPageInAccessibilityTree(authedPage, title);

      await authedPage.setViewportSize(PHONE);
      await expect(sheetHandle(authedPage)).toHaveCount(1);
    });
  });
});
