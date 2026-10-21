import { describe, expect, it } from 'vitest';

import { notificationSettingsInput } from './validators';

describe('notificationSettingsInput', () => {
  it('stores an empty topic as null (use the server default)', () => {
    const parsed = notificationSettingsInput.parse({
      enabled: true,
      topic: '  ',
      prefs: { extraction: true },
    });
    expect(parsed.topic).toBeNull();
  });

  it('trims and keeps a valid topic', () => {
    const parsed = notificationSettingsInput.parse({
      enabled: false,
      topic: ' my-trips ',
      prefs: { extraction: false },
    });
    // Switches not sent default to on.
    expect(parsed).toEqual({
      enabled: false,
      topic: 'my-trips',
      prefs: { extraction: false, flights: true, transit: true, hotels: true, plans: true },
    });
  });

  it('accepts its own output, which is what the server action receives', () => {
    // The form validates client-side and passes the parsed values on,
    // so the action parses an already-transformed `topic: null`.
    const once = notificationSettingsInput.parse({
      enabled: true,
      topic: '',
      prefs: { extraction: true },
    });
    expect(notificationSettingsInput.parse(once)).toEqual(once);
  });

  it('rejects a topic ntfy would refuse', () => {
    const parsed = notificationSettingsInput.safeParse({
      enabled: true,
      topic: 'my trips',
      prefs: { extraction: true },
    });
    expect(parsed.success).toBe(false);
  });
});
