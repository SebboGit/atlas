'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { CountrySelect } from '@/components/ui/country-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { countryName } from '@/lib/countries';
import { addManualCountryAction, removeManualCountryAction } from '@/lib/countries/actions';
import { cn } from '@/lib/utils';

interface ManageCountriesPopoverProps {
  /** ISO-2 codes the user has manually marked. Server-provided. */
  manualCodes: string[];
}

// Per-user manual visited-country management. The map renders the
// shared "visited" state; this is the dedicated affordance for adding
// places the user has been to that aren't represented by an Atlas trip
// (typically pre-Atlas travel history). Lives in a popover off the
// page header so the map area itself stays uncluttered.
//
// Optimistic state: the popover mirrors `manualCodes` into local
// state so adds/removes feel instant. The server action returns,
// `revalidatePath('/map')` re-renders the parent, and the prop
// updates — at which point the local state re-syncs.
export function ManageCountriesPopover({ manualCodes }: ManageCountriesPopoverProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  // React 19's useOptimistic gives us snappy add/remove feedback while
  // the server action is in flight, and automatically re-syncs to
  // `manualCodes` once `revalidatePath('/map')` flushes the new state
  // through. No effects, no manual prop-mirroring.
  const [optimistic, applyOptimistic] = React.useOptimistic(
    manualCodes,
    (state: string[], action: { type: 'add' | 'remove'; code: string }) => {
      if (action.type === 'add') {
        if (state.includes(action.code)) return state;
        return [...state, action.code].sort();
      }
      return state.filter((c) => c !== action.code);
    },
  );

  const knownSet = React.useMemo(() => new Set(optimistic), [optimistic]);

  function handleAdd() {
    if (!picked) return;
    setError(null);
    if (knownSet.has(picked)) {
      setPicked('');
      return;
    }
    const code = picked;
    setPicked('');
    startTransition(async () => {
      applyOptimistic({ type: 'add', code });
      const result = await addManualCountryAction(code);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not add country.');
        // useOptimistic only resyncs when the source prop changes. On
        // failure the server state is unchanged, so we'd be stuck
        // displaying the optimistic-add forever — router.refresh()
        // forces a re-fetch that pushes the canonical state back in.
        router.refresh();
      }
    });
  }

  function handleRemove(code: string) {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ type: 'remove', code });
      const result = await removeManualCountryAction(code);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not remove country.');
        router.refresh();
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-3.5" strokeWidth={1.75} />
          Manually add country
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-4">
        <div className="mb-3">
          <p className="font-display text-foreground text-sm font-medium tracking-tight">
            Add a country
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-snug">
            For places you visited before Atlas. They appear on the map alongside countries from
            your trips.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <CountrySelect value={picked} onChange={setPicked} placeholder="Search countries" />
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleAdd}
            disabled={!picked || knownSet.has(picked)}
          >
            Add
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-destructive mt-2 text-xs">
            {error}
          </p>
        )}

        <div className="border-foreground/10 mt-4 border-t pt-3">
          <p className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.22em] uppercase">
            Marked {optimistic.length > 0 && `· ${optimistic.length}`}
          </p>
          {optimistic.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">Nothing added yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {optimistic.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => handleRemove(code)}
                    aria-label={`Remove ${countryName(code) ?? code}`}
                    className={cn(
                      'border-foreground/15 bg-card/70 text-foreground/85 hover:border-destructive/50 hover:bg-destructive/8 hover:text-destructive',
                      'group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    )}
                  >
                    <span>{countryName(code) ?? code}</span>
                    <X
                      className="text-foreground/40 group-hover:text-destructive size-3"
                      strokeWidth={2}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
