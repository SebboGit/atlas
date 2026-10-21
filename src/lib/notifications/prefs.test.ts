import { describe, expect, it } from 'vitest';

import { parseNotificationPrefs } from './prefs';

const ALL_ON = { extraction: true, flights: true, transit: true, hotels: true, plans: true };

describe('parseNotificationPrefs', () => {
  it('reads a missing key as on', () => {
    expect(parseNotificationPrefs({})).toEqual(ALL_ON);
    expect(parseNotificationPrefs(null)).toEqual(ALL_ON);
  });

  it('keeps a switch the user turned off', () => {
    expect(parseNotificationPrefs({ ...ALL_ON, extraction: false })).toEqual({
      ...ALL_ON,
      extraction: false,
    });
  });

  it('falls back to defaults for a malformed value', () => {
    expect(parseNotificationPrefs({ extraction: 'yes' })).toEqual(ALL_ON);
    expect(parseNotificationPrefs('garbage')).toEqual(ALL_ON);
  });
});
