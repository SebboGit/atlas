import { describe, expect, it } from 'vitest';

import { parseThemePreference, resolveTheme } from './preference';

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

describe('resolveTheme', () => {
  it('honours a pinned theme over the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS when nothing is pinned', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
  });

  it('treats an unknown attribute value as unpinned', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('sepia', false)).toBe('light');
  });
});
