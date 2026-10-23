'use client';

import * as React from 'react';

import { resolveTheme, type ResolvedTheme, type ThemePreference } from './preference';

export type { ResolvedTheme };

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The theme on screen right now, read straight off the document. For code
 * that runs outside render (a map built in an effect); components that
 * re-render on a switch use `useResolvedTheme`.
 */
export function readResolvedTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return resolveTheme(
    document.documentElement.dataset.theme,
    window.matchMedia(DARK_QUERY).matches,
  );
}

/**
 * A CSS custom property's current value on <html>, for canvas surfaces
 * (MapLibre paint) that can't take `var()`. Re-read after a theme switch:
 * the dark tokens override the same names.
 */
export function readCssColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    media.removeEventListener('change', onChange);
    observer.disconnect();
  };
}

/**
 * The theme actually on screen. `null` during SSR and the first client
 * render, so markup that depends on it can't mismatch on hydration.
 */
export function useResolvedTheme(): ResolvedTheme | null {
  return React.useSyncExternalStore<ResolvedTheme | null>(subscribe, readResolvedTheme, () => null);
}

/** Apply a preference to the document right away; persisting is the caller's job. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
}
