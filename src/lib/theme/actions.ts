'use server';

import { cookies } from 'next/headers';

import { err, ok, type Result } from '@/types/result';

import { THEME_COOKIE, themePreferenceSchema } from './preference';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Persist the colour-theme preference. The client applies the change to
 * <html data-theme> immediately; this only makes it survive a reload. No
 * auth gate: it writes a display cookie on the caller's own browser and
 * touches no data.
 */
export async function setThemePreferenceAction(raw: unknown): Promise<Result<null, string>> {
  const parsed = themePreferenceSchema.safeParse(raw);
  if (!parsed.success) return err('Unknown theme.');

  const store = await cookies();
  store.set(THEME_COOKIE, parsed.data, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    httpOnly: true,
    // Secure whenever the app is served over https (prod behind the reverse
    // proxy); a plain-http LAN dev server would otherwise drop the cookie.
    secure: process.env.AUTH_URL?.trim().startsWith('https://') ?? false,
  });
  return ok(null);
}
