import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function TripNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-24 pb-24 sm:px-8">
      <Card variant="glass" className="atlas-rise relative overflow-hidden">
        <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-16 text-center">
          <span className="border-foreground/25 text-foreground/55 mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.2em]">
            404
          </span>
          <h1 className="font-display text-foreground text-3xl tracking-tight">Trip not found.</h1>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            It might have been deleted, or you might not have access to it.
          </p>
          <Link href="/trips" className="mt-6">
            <Button variant="outline" size="sm">
              ← Back to trips
            </Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
