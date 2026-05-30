'use client';

import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { useEffect } from 'react';

import './globals.css';

// global-error replaces the root layout, so it owns its own <html>/<body>
// AND must re-wire the font CSS variables — they live on the root layout's
// <html>, which is gone in this code path. Without this, font-display and
// font-mono would fall back to system serifs/monos.
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'opsz'],
  style: ['normal', 'italic'],
});

const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono-ibm',
  display: 'swap',
  weight: ['400', '500'],
});

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Client component — the server logger isn't importable here.
    // Surface to the browser console; never render the stack in the UI.
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={`${hanken.variable} ${fraunces.variable} ${ibmMono.variable}`}>
      <body className="min-h-screen">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
          <span className="border-foreground/25 text-foreground/70 mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.2em]">
            ø
          </span>
          <h1 className="font-display text-foreground text-3xl tracking-tight">
            Something went wrong.
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            Atlas hit an unexpected error. Try reloading.
          </p>
          {error.digest ? (
            <p className="text-muted-foreground/60 mt-4 font-mono text-[10px] tracking-[0.2em] uppercase">
              Ref {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            className="bg-primary text-primary-foreground hover:bg-primary/92 focus-visible:ring-primary/40 focus-visible:ring-offset-background mt-6 inline-flex h-9 items-center justify-center rounded-full px-4 text-[13px] font-medium tracking-tight transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-[0.5px]"
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
