'use client';

import { X } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/ui/input';

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Forwarded to the inner input so a sibling `<label htmlFor>` can target it. */
  id?: string;
}

// Lightweight tag chip entry. Comma / Enter commits the current
// buffer. Backspace on an empty buffer pops the last tag (the common
// behaviour for tag widgets — saves a click). Tags are lowercased and
// de-duplicated by the validator; this just keeps the UI tidy.
export function TagInput({ value, onChange, placeholder, id }: TagInputProps) {
  const [buffer, setBuffer] = React.useState('');
  // Echo additions/removals to a polite live region so screen readers
  // hear what just happened — chips by themselves are silent.
  const [announce, setAnnounce] = React.useState('');

  function commit() {
    const t = buffer.trim().toLowerCase();
    if (t === '' || value.includes(t)) {
      setBuffer('');
      return;
    }
    onChange([...value, t]);
    setBuffer('');
    setAnnounce(`Added tag ${t}`);
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
    setAnnounce(`Removed tag ${tag}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && buffer === '' && value.length > 0) {
      const last = value[value.length - 1];
      onChange(value.slice(0, -1));
      if (last) setAnnounce(`Removed tag ${last}`);
    }
  }

  return (
    <>
      <div className="border-foreground/15 bg-background/60 flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
        {value.length > 0 && (
          <ul aria-label="Tags" className="contents">
            {value.map((tag) => (
              <li
                key={tag}
                className="bg-foreground/10 text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              >
                <span>{tag}</span>
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="text-foreground/55 hover:text-foreground focus-visible:ring-primary/40 -m-1 inline-flex h-7 w-7 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
                  onClick={() => removeTag(tag)}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Input
          id={id}
          type="text"
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={value.length === 0 ? (placeholder ?? 'vegetarian, kid-friendly…') : ''}
          aria-describedby={id ? `${id}-help` : undefined}
          className="flex-1 border-0 bg-transparent px-1 py-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>
      {id && (
        <p id={`${id}-help`} className="text-foreground/50 text-[11px] leading-snug">
          Press comma or enter to add a tag. Backspace deletes the previous one.
        </p>
      )}
      {/* Polite live region for AT — added/removed tag announcements.
       *  Visually hidden via sr-only; updates as `announce` changes. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </>
  );
}
