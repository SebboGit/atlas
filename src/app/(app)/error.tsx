'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    // Client component — the server logger is not importable here.
    // Surface the error to the browser console; never render the stack in the UI.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-24 pb-24 sm:px-8">
      <Card variant="glass" className="atlas-rise relative overflow-hidden">
        <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-16 text-center">
          <span className="border-foreground/25 text-foreground/70 mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.2em]">
            ø
          </span>
          <h1 className="font-display text-foreground text-3xl tracking-tight">
            Something went wrong.
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            This page didn&apos;t load. Try again, or head back to your trips.
          </p>
          {error.digest ? (
            <p className="text-muted-foreground/60 mt-4 font-mono text-[10px] tracking-[0.2em] uppercase">
              Ref {error.digest}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button size="sm" onClick={() => reset()}>
              Try again
            </Button>
            <Button asChild variant="outline" size="sm">
              {/*
                Hard nav, not a soft <Link>: this boundary wraps everything below
                the app shell, so a client-side nav can re-mount the broken
                subtree and re-throw. A full document load forces a fresh server
                render — the reliable recovery path from an error boundary.
              */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/trips">Back to trips</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
