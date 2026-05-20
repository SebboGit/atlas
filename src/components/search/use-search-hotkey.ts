'use client';

import * as React from 'react';

// Cmd+K (mac) / Ctrl+K (everywhere else) opens the palette. `/` also
// opens it, but only when the user isn't focused inside another text
// input — typing `/` inside a real form field should type a slash, not
// hijack focus. The `/` hotkey is also suppressed when another modal
// dialog is open (so the palette doesn't stack on top of a form sheet
// or confirm dialog) and when focus is inside an ARIA-roled textbox /
// combobox / searchbox (custom widgets that aren't native <input>).
function isInsideEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // Custom-rolled text widgets (mentions, combo boxes, etc.) still
  // need to receive `/` as a literal character.
  if (target.closest('[role="textbox"], [role="combobox"], [role="searchbox"]')) {
    return true;
  }
  return false;
}

function anyDialogOpen(): boolean {
  // Radix sets data-state="open" on every open Dialog/Sheet/Popover
  // content. If one exists, leave the keyboard alone — opening the
  // palette on top of it would break the focus stack.
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

export function useSearchHotkey(open: () => void) {
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        if (anyDialogOpen()) return;
        e.preventDefault();
        open();
        return;
      }
      if (e.key === '/' && !isMod && !e.altKey && !isInsideEditable(e.target) && !anyDialogOpen()) {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
}
