'use client';

import { Moon, Sun } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { setThemePreferenceAction } from '@/lib/theme/actions';
import { applyThemePreference, useResolvedTheme } from '@/lib/theme/client';
import { cn } from '@/lib/utils';

/**
 * One-tap light/dark switch for the topbar. Flips whatever is on screen and
 * pins the opposite theme; Settings is where "follow the system" lives.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const resolved = useResolvedTheme();
  const [, startTransition] = React.useTransition();

  function toggle() {
    const next = resolved === 'dark' ? 'light' : 'dark';
    applyThemePreference(next);
    startTransition(async () => {
      await setThemePreferenceAction(next);
    });
  }

  const label = resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn('size-11 [&_svg]:size-[18px]', className)}
    >
      {resolved === 'dark' ? <Sun strokeWidth={1.9} /> : <Moon strokeWidth={1.9} />}
    </Button>
  );
}
