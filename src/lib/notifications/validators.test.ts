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
    expect(parsed).toEqual({ enabled: false, topic: 'my-trips', prefs: { extraction: false } });
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
