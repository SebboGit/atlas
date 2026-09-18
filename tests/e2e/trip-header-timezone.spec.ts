import type { ConsoleMessage, Page } from '@playwright/test';

import { expect, test } from './fixtures/auth';
import { seedTrip } from './fixtures/db';

// Regression guard for #146. Trip dates are UTC-midnight day tokens and
// the trip header used to format them without `timeZone: 'UTC'`, so a
// viewer west of Greenwich read the day before — and, because the server
// renders in UTC while the browser re-renders in the viewer's zone, every
// trip page logged a React hydration mismatch.
//
// CI and the rest of this suite run in UTC, where the browser agrees with
// the server and the bug is invisible. This one file pins the browser to
// Los Angeles (UTC−7/−8) instead of adding a second Playwright project,
// which would double the browser job's minutes.
//
// The hydration assertion is page-wide, not header-scoped: any mismatch
// anywhere on a trip page or the trip list fails this spec.
test.use({ timezoneId: 'America/Los_Angeles' });

// Fixed past dates so auto-status never moves the trip, matching the
// other trip specs. 2024-10-04 is a Friday; from Los Angeles the
// unfixed formatter rendered it as "Thu, 3 Oct 2024".
const START = new Date('2024-10-04T00:00:00Z');
const END = new Date('2024-10-12T00:00:00Z');
const EXPECTED_RANGE = 'Fri, 4 Oct 2024 → Sat, 12 Oct 2024';
// The list card renders the same two stored days through two further
// formatters: `formatTripDateRange` on the laptop card and
// `formatTripCompactRange` on the phone row.
const EXPECTED_LIST_RANGE = '4 Oct – 12 Oct 2024';
const EXPECTED_COMPACT_RANGE = '4 OCT – 12 OCT 2024';

// React reports a hydration mismatch as a console error in dev; a thrown
// one surfaces as a page error. Collect both and match loosely — the
// wording of the message has changed across React releases.
//
// This depends on the suite running against `next dev`, which
// playwright.config.ts starts. A production build throws the minified
// error #418 instead, whose text carries no "hydrat" substring, so the
// check would pass vacuously against a non-dev server.
function collectHydrationComplaints(page: Page): string[] {
  const complaints: string[] = [];
  const record = (text: string) => {
    if (/hydrat/i.test(text)) complaints.push(text);
  };
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') record(msg.text());
  });
  page.on('pageerror', (err) => record(`${err.message}\n${err.stack ?? ''}`));
  return complaints;
}

test.describe('trip header dates under a non-UTC viewer', () => {
  test('shows the stored day and hydrates without a mismatch', async ({
    authedPage,
    authedUser,
  }) => {
    const complaints = collectHydrationComplaints(authedPage);

    const title = `E2E Timezone Trip ${Date.now()}`;
    const tripId = await seedTrip(authedUser.id, {
      title,
      startDate: START,
      endDate: END,
      status: 'completed',
    });

    await authedPage.goto(`/trips/${tripId}`);
    await expect(authedPage.getByText(EXPECTED_RANGE)).toBeVisible();

    // Opening a Radix dialog proves React has hydrated — until then the
    // trigger is inert markup, and a mismatch logged after the assertion
    // above would otherwise be missed.
    await authedPage.getByRole('button', { name: 'Edit trip' }).click();
    await expect(authedPage.getByRole('dialog')).toBeVisible();
    await authedPage.keyboard.press('Escape');

    // Re-assert after hydration: React discards the server HTML on a
    // mismatch, so the client render is what the viewer is left looking
    // at. The first assertion above can pass on markup that is about to
    // be replaced by the day before.
    await expect(authedPage.getByText(EXPECTED_RANGE)).toBeVisible();
    expect(complaints).toEqual([]);

    // The trip list renders the same dates through a second formatter —
    // the phone row's compact form — so the list is worth the one extra
    // navigation rather than a spec of its own.
    await authedPage.goto('/trips');
    // The title carries a per-run stamp, so it is unique on the page and
    // a plain (substring, case-insensitive) name match is enough — no
    // regex built from a variable.
    const card = authedPage.getByRole('link', { name: title });
    await expect(card).toBeVisible();

    // Both list forms, scoped to the seeded trip's card. The laptop
    // range is the visible one at the default 1280px viewport; the
    // compact row is `display:none` there, so it is asserted through the
    // card's text content rather than a second viewport-scoped case.
    const expectListDates = async () => {
      await expect(card.getByText(EXPECTED_LIST_RANGE, { exact: true })).toBeVisible();
      await expect(card).toContainText(EXPECTED_COMPACT_RANGE);
    };
    await expectListDates();

    // The card is in the server HTML, so the assertions above resolve
    // before React hydrates. Open the New-trip dialog for the same
    // proof the header leg gets, then re-assert the dates.
    await authedPage.getByRole('button', { name: 'New trip' }).click();
    await expect(authedPage.getByRole('dialog')).toBeVisible();
    await authedPage.keyboard.press('Escape');
    await expectListDates();
    expect(complaints).toEqual([]);
  });
});
