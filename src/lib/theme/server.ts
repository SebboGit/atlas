import { cookies } from 'next/headers';

import { parseThemePreference, THEME_COOKIE, type ThemePreference } from './preference';

export async function getThemePreference(): Promise<ThemePreference> {
  const store = await cookies();
  return parseThemePreference(store.get(THEME_COOKIE)?.value);
}
