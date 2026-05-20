'use client';

import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ISO_COUNTRIES, countryName } from '@/lib/countries';
import { cn } from '@/lib/utils';

interface CountrySelectProps {
  /** ISO 3166-1 alpha-2 code, or '' when nothing is selected. */
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  /** Forwarded to the trigger button for label associations. */
  name?: string;
}

// Filterable country picker. Native `<select>` was fine on mobile (OS
// picker handles search) but mediocre on desktop with 250 options —
// only single-letter cycling. This combobox gives the same search
// experience everywhere: type to filter, arrow keys to navigate,
// Enter to select.
//
// Hand-rolled on Atlas's existing Popover + Input primitives instead
// of pulling in `cmdk`, because (a) it's <200 lines, (b) keeps the
// dependency surface minimal per the "fully owned components"
// principle, (c) the Atlas surface treatment (paper card, warm tints,
// mono code suffix) doesn't quite map onto cmdk's defaults.
export function CountrySelect({
  value,
  onChange,
  onBlur,
  id,
  name,
  invalid,
  placeholder = '— Choose —',
}: CountrySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  // Tracks whether the most recent highlight change came from a
  // keyboard event. We only scroll the highlighted row into view in
  // that case — for trackpad scrolling, doing so causes the list to
  // bounce back as the cursor crosses options and re-anchors the view.
  const keyboardNavRef = React.useRef(false);

  // Filter on name or code, case-insensitive. Code search lets a power
  // user type "JP" and land on Japan immediately.
  const filtered = React.useMemo(() => {
    if (!query.trim()) return ISO_COUNTRIES;
    const q = query.trim().toLowerCase();
    return ISO_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [query]);

  const selectedName = value ? countryName(value) : undefined;

  // Reset query + highlight whenever the popover toggles. Routed through
  // `onOpenChange` (rather than an effect on `open`) so cleanup lives in
  // the event handler and doesn't trigger setState-in-effect.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery('');
      setHighlighted(0);
      // Focus the search field after Radix mounts the content.
      window.setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      onBlur?.();
    }
  }

  // Clamp the highlight when the filtered list shrinks. Done in render
  // (React's "store info from previous renders" pattern) so it doesn't
  // run as a setState-in-effect anti-pattern.
  const maxIndex = Math.max(filtered.length - 1, 0);
  if (highlighted > maxIndex) {
    setHighlighted(maxIndex);
  }

  // Auto-scroll the highlighted option into view ONLY when navigating
  // with arrow keys. Scrolling on every highlight change fights the
  // user's trackpad scroll: as the list moves, the cursor crosses
  // options, fires onMouseEnter, re-highlights, and we'd snap the
  // view back — making the list feel "stuck."
  React.useEffect(() => {
    if (!keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  function pick(code: string) {
    onChange(code);
    handleOpenChange(false);
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      keyboardNavRef.current = true;
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      keyboardNavRef.current = true;
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[highlighted];
      if (target) pick(target.code);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleOpenChange(false);
    }
  }

  const listboxId = id ? `${id}-listbox` : undefined;
  const activeId = id ? `${id}-opt-${highlighted}` : undefined;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          name={name}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-invalid={invalid || undefined}
          className={cn(
            // Matches the Atlas Select / Input styling so it sits in a
            // form row without standing out.
            'border-foreground/15 bg-card/70 text-foreground',
            'flex h-11 w-full items-center justify-between gap-2 rounded-xl border px-4 py-2 text-[15px]',
            'shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_1px_2px_rgba(60,40,20,0.04)] backdrop-blur-sm',
            'transition-[border-color,box-shadow] duration-200',
            'focus-visible:outline-none',
            'focus-visible:border-primary/55 focus-visible:shadow-[0_0_0_3px_hsl(18_52%_36%/0.16),0_1px_0_rgba(255,255,255,0.7)_inset]',
            invalid && 'border-destructive/60 focus-visible:shadow-[0_0_0_3px_hsl(0_65%_45%/0.18)]',
          )}
        >
          <span className={cn('truncate', !selectedName && 'text-muted-foreground/60')}>
            {selectedName ?? placeholder}
          </span>
          <ChevronDown className="text-foreground/55 ml-auto size-4 shrink-0" strokeWidth={1.6} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Match the trigger width so the popover looks like an
        // extension of the field rather than a floating box.
        className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
      >
        <div className="border-foreground/10 border-b p-2">
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Search…"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            className="h-9 text-sm"
          />
        </div>
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          // Stop wheel propagation so when the popover is opened from
          // inside a Dialog (modal, scroll-locked), react-remove-scroll
          // doesn't preventDefault our wheel events.
          onWheel={(e) => e.stopPropagation()}
          className="max-h-[min(360px,50vh)] overflow-y-auto overscroll-contain p-1"
        >
          {/* Clear option — always at the top so users can undo a pick. */}
          <Option
            id={id ? `${id}-opt-clear` : undefined}
            highlighted={false}
            selected={!value}
            onClick={() => pick('')}
            // No mouseenter highlight on the clear option (it's not in
            // the filtered list); keeping it distinct.
          >
            <span className="text-foreground/55 italic">None</span>
          </Option>
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-sm italic">No matches.</p>
          ) : (
            filtered.map((c, i) => (
              <Option
                key={c.code}
                id={id ? `${id}-opt-${i}` : undefined}
                dataIndex={i}
                highlighted={i === highlighted}
                selected={value === c.code}
                onClick={() => pick(c.code)}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="truncate">{c.name}</span>
                <span className="text-foreground/40 ml-2 font-mono text-[10px] tracking-wider">
                  {c.code}
                </span>
              </Option>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface OptionProps {
  id?: string;
  dataIndex?: number;
  highlighted: boolean;
  selected: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  children: React.ReactNode;
}

function Option({
  id,
  dataIndex,
  highlighted,
  selected,
  onClick,
  onMouseEnter,
  children,
}: OptionProps) {
  return (
    <button
      id={id}
      data-index={dataIndex}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
        highlighted ? 'bg-foreground/8' : 'hover:bg-foreground/5',
        selected && 'text-primary',
      )}
    >
      {children}
      {selected && <Check className="text-primary ml-auto size-3.5 shrink-0" strokeWidth={2} />}
    </button>
  );
}
