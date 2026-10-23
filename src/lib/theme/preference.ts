import { z } from 'zod';

/**
 * Colour-theme preference. `system` follows the OS (prefers-color-scheme);
 * `light` / `dark` pin it. Stored in a cookie, not the DB: it is a per-device
 * display choice, and the root layout needs it before any query runs so the
 * first paint is already in the right theme.
 */
export const THEME_COOKIE = 'atlas-theme';

export const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export function parseThemePreference(value: string | undefined | null): ThemePreference {
  const parsed = themePreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : 'system';
}

/** The theme actually on screen, once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Resolve what's on screen from <html data-theme> and the OS preference. A
 * pinned light/dark wins; anything else (absent = `system`) follows the OS.
 * Pure so the hook's logic is testable without a DOM.
 */
export function resolveTheme(pinned: string | undefined, prefersDark: boolean): ResolvedTheme {
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return prefersDark ? 'dark' : 'light';
}

/** Browser-chrome colour per theme — matches --color-background. */
export const THEME_COLOR = { light: '#e9ecf2', dark: '#0f1014' } as const;
