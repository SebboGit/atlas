'use client';

import { Bricolage_Grotesque, DM_Mono } from 'next/font/google';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

import './globals.css';

// global-error replaces the root layout, so it owns its own <html>/<body>
// AND must re-wire the font CSS variables — they live on the root layout's
// <html>, which is gone in this code path. Without this, font-display and
// font-mono would fall back to system sans/monos.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
  axes: ['opsz'],
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-dm-mono',
  display: 'swap',
  weight: ['400', '500'],
});

type GlobalErrorProps = {
  error: Error & { digest?: string };
  // Next.js passes a reset() here, but the root layout itself failed in this
  // path — a soft retry can't recover it, so we hard-reload instead (below).
  reset: () => void;
};

export default function GlobalError({ error }: GlobalErrorProps) {
  useEffect(() => {
    // Client component — the server logger isn't importable here.
    // Surface to the browser console; never render the stack in the UI.
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={`${bricolage.variable} ${dmMono.variable}`}>
      <body className="min-h-screen">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
          <span className="border-foreground/25 text-foreground/70 mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.06em]">
            ø
          </span>
          <h1 className="font-display text-foreground text-3xl tracking-tight">
            Something went wrong.
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            Atlas hit an unexpected error. Try reloading.
          </p>
          {error.digest ? (
            <p className="text-muted-foreground/60 mt-4 font-mono text-[10px] tracking-[0.06em] uppercase">
              Ref {error.digest}
            </p>
          ) : null}
          <Button size="sm" className="mt-6" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </main>
      </body>
    </html>
  );
}
