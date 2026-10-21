import { expect, test } from './fixtures/auth';
import { seedTrip } from './fixtures/db';

// /settings notification form (ADR-0020). The e2e server runs with a
// placeholder NTFY_URL (playwright.config.ts) so the form renders; no
// worker runs here, so "Send test" only proves the job was queued.
test.describe('notification settings', () => {
  test('saves the switches and topic, and they survive a reload', async ({ authedPage }) => {
    await authedPage.goto('/settings');
    await expect(authedPage.getByRole('heading', { name: /^settings\.?$/i })).toBeVisible();

    const enabled = authedPage.getByRole('checkbox', { name: /push notifications/i });
    const extraction = authedPage.getByRole('checkbox', { name: /document reading/i });
    const topic = authedPage.getByRole('textbox', { name: 'Topic' });

    // A new user starts opted out, on the server default topic.
    await expect(enabled).not.toBeChecked();
    await expect(extraction).toBeChecked();
    await expect(topic).toHaveAttribute('placeholder', 'e2e-default');

    await enabled.check();
    await extraction.uncheck();
    await topic.fill('my-trips');
    await authedPage.getByRole('button', { name: 'Save' }).click();
    await expect(authedPage.getByRole('status')).toHaveText('Saved.');

    await authedPage.reload();
    await expect(enabled).toBeChecked();
    await expect(extraction).not.toBeChecked();
    await expect(topic).toHaveValue('my-trips');

    // Clearing the field goes back to the server default.
    await topic.fill('');
    await authedPage.getByRole('button', { name: 'Save' }).click();
    await expect(authedPage.getByRole('status')).toHaveText('Saved.');
    await authedPage.reload();
    await expect(topic).toHaveValue('');
  });

  test('saves with the topic left empty', async ({ authedPage }) => {
    await authedPage.goto('/settings');
    await authedPage.getByRole('checkbox', { name: /push notifications/i }).check();
    await authedPage.getByRole('button', { name: 'Save' }).click();
    await expect(authedPage.getByRole('status')).toHaveText('Saved.');
  });

  test('rejects a topic ntfy would refuse', async ({ authedPage }) => {
    await authedPage.goto('/settings');
    await authedPage.getByRole('textbox', { name: 'Topic' }).fill('my trips');
    await authedPage.getByRole('button', { name: 'Save' }).click();
    const topic = authedPage.getByRole('textbox', { name: 'Topic' });
    await expect(topic).toHaveAttribute('aria-invalid', 'true');
    await expect(topic).toHaveAccessibleDescription(/letters, digits/i);
  });

  test('queues a test notification and throttles a repeat', async ({ authedPage }) => {
    await authedPage.goto('/settings');
    const sendTest = authedPage.getByRole('button', { name: 'Send test' });
    await sendTest.click();
    await expect(authedPage.getByRole('status')).toHaveText('Test sent.');

    // A second test inside the 30s window is throttled, and says so.
    await sendTest.click();
    await expect(authedPage.getByRole('status')).toHaveText(/already sent/i);
  });

  test('saves a reminder switch', async ({ authedPage }) => {
    await authedPage.goto('/settings');
    const hotels = authedPage.getByRole('checkbox', { name: /^hotels/i });
    await expect(hotels).toBeChecked();
    await hotels.uncheck();
    await authedPage.getByRole('button', { name: 'Save' }).click();
    await expect(authedPage.getByRole('status')).toHaveText('Saved.');
    await authedPage.reload();
    await expect(hotels).not.toBeChecked();
  });

  test('mutes a trip once notifications are on', async ({ authedPage, authedUser }) => {
    const tripId = await seedTrip(authedUser.id, { title: 'Reminder spec', status: 'planned' });
    const mute = authedPage.getByRole('button', { name: /mute reminders|reminders muted/i });

    // Opted out: the trip page offers nothing to mute.
    await authedPage.goto(`/trips/${tripId}/itinerary`);
    await expect(authedPage.getByRole('heading', { name: 'Reminder spec' })).toBeVisible();
    await expect(mute).toHaveCount(0);

    await authedPage.goto('/settings');
    await authedPage.getByRole('checkbox', { name: /push notifications/i }).check();
    await authedPage.getByRole('button', { name: 'Save' }).click();
    await expect(authedPage.getByRole('status')).toHaveText('Saved.');

    await authedPage.goto(`/trips/${tripId}/itinerary`);
    const visible = mute.filter({ visible: true });
    await expect(visible).toHaveText(/mute reminders/i);
    await visible.click();
    await expect(visible).toHaveText(/reminders muted/i);
    await authedPage.reload();
    await expect(mute.filter({ visible: true })).toHaveText(/reminders muted/i);
  });
});
