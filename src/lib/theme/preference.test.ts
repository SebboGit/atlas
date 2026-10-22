import { describe, expect, it } from 'vitest';

import { parseThemePreference } from './preference';

describe('parseThemePreference', () => {
  it('keeps a known preference', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('falls back to system for anything else', () => {
    expect(parseThemePreference(undefined)).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('')).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
  });
});
