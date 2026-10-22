'use client';

import * as React from 'react';

import type { ThemePreference } from './preference';

export type ResolvedTheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readResolved(): ResolvedTheme {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
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
  return React.useSyncExternalStore<ResolvedTheme | null>(subscribe, readResolved, () => null);
}

/** Apply a preference to the document right away; persisting is the caller's job. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
}
