'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { setThemePreferenceAction } from '@/lib/theme/actions';
import { applyThemePreference } from '@/lib/theme/client';
import type { ThemePreference } from '@/lib/theme/preference';
import { cn } from '@/lib/utils';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function ThemePreferencePicker({ initial }: { initial: ThemePreference }) {
  const [value, setValue] = React.useState<ThemePreference>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  function choose(next: ThemePreference) {
    setValue(next);
    setError(null);
    applyThemePreference(next);
    startTransition(async () => {
      const result = await setThemePreferenceAction(next);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="bg-muted inline-flex flex-wrap gap-1 rounded-full p-1">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors',
                'has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2',
                active
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground [@media(hover:hover)]:hover:text-foreground',
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={active}
                onChange={() => choose(option.value)}
                className="sr-only"
              />
              <Icon aria-hidden className="size-4" strokeWidth={2} />
              {option.label}
            </label>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
