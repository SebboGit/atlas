import { describe, expect, it } from 'vitest';

import { parseNotificationPrefs } from './prefs';

describe('parseNotificationPrefs', () => {
  it('reads a missing key as on', () => {
    expect(parseNotificationPrefs({})).toEqual({ extraction: true });
    expect(parseNotificationPrefs(null)).toEqual({ extraction: true });
  });

  it('keeps a switch the user turned off', () => {
    expect(parseNotificationPrefs({ extraction: false })).toEqual({ extraction: false });
  });

  it('falls back to defaults for a malformed value', () => {
    expect(parseNotificationPrefs({ extraction: 'yes' })).toEqual({ extraction: true });
    expect(parseNotificationPrefs('garbage')).toEqual({ extraction: true });
  });
});
