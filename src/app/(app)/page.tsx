import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';

export default async function HomePage() {
  const user = await requireUser();
  const firstName = user.name?.split(' ')[0] ?? user.email.split('@')[0];

  // Latitude / longitude of nowhere in particular — a small flourish.
  const stampDate = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-16 pb-24 sm:px-8 sm:pt-24">
      {/* Header — first-name greeting in display serif, with a quiet
       *  monospace coordinate strip as a notebook flourish. */}
      <section className="atlas-rise" style={{ animationDelay: '60ms' }}>
        <p className="text-muted-foreground mb-5 flex items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase">
          <span aria-hidden className="bg-foreground/30 h-px w-8" />
          <span>Logbook · {stampDate}</span>
        </p>
        <h1 className="font-display text-foreground text-5xl leading-[1.02] font-medium tracking-tight sm:text-6xl md:text-7xl">
          Welcome back,
          <br />
          <span className="italic">{firstName}</span>.
        </h1>
      </section>

      <div
        aria-hidden
        className="atlas-rise atlas-rule mt-12 mb-10"
        style={{ animationDelay: '160ms' }}
      />

      {/* Four primary surfaces. Trips, Map, and Stats are live; Documents
       *  is an intentionally inert tile that holds a place in the layout
       *  without lying about being clickable. */}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/trips"
          className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          style={{ animationDelay: '240ms' }}
        >
          <Card
            variant="glass"
            className="relative h-full overflow-hidden transition-transform duration-500 hover:-translate-y-0.5"
          >
            {/* Corner stamp — terracotta circle with index numeral */}
            <span
              aria-hidden
              className="border-primary/40 text-primary/80 absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px]"
            >
              01
            </span>
            <CardContent className="flex min-h-44 flex-col justify-between pt-7">
              <p className="text-foreground/55 font-mono text-[10px] tracking-[0.28em] uppercase">
                Section
              </p>
              <div>
                <h2 className="font-display text-3xl leading-none font-medium tracking-tight">
                  Trips
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">Plan, log, and revisit.</p>
              </div>
            </CardContent>
            <span
              aria-hidden
              className="from-primary/0 via-primary/60 to-primary/0 absolute right-6 bottom-6 h-px w-10 bg-gradient-to-r transition-all duration-500 group-hover:w-20"
            />
          </Card>
        </Link>

        <Link
          href="/wishlist"
          className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          style={{ animationDelay: '300ms' }}
        >
          <Card
            variant="glass"
            className="relative h-full overflow-hidden transition-transform duration-500 hover:-translate-y-0.5"
          >
            <span
              aria-hidden
              className="border-primary/40 text-primary/80 absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px]"
            >
              02
            </span>
            <CardContent className="flex min-h-44 flex-col justify-between pt-7">
              <p className="text-foreground/55 font-mono text-[10px] tracking-[0.28em] uppercase">
                Section
              </p>
              <div>
                <h2 className="font-display text-3xl leading-none font-medium tracking-tight">
                  Wishlist
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">Places worth coming back to.</p>
              </div>
            </CardContent>
            <span
              aria-hidden
              className="from-primary/0 via-primary/60 to-primary/0 absolute right-6 bottom-6 h-px w-10 bg-gradient-to-r transition-all duration-500 group-hover:w-20"
            />
          </Card>
        </Link>

        <Link
          href="/map"
          className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          style={{ animationDelay: '360ms' }}
        >
          <Card
            variant="glass"
            className="relative h-full overflow-hidden transition-transform duration-500 hover:-translate-y-0.5"
          >
            <span
              aria-hidden
              className="border-primary/40 text-primary/80 absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px]"
            >
              03
            </span>
            <CardContent className="flex min-h-44 flex-col justify-between pt-7">
              <p className="text-foreground/55 font-mono text-[10px] tracking-[0.28em] uppercase">
                Section
              </p>
              <div>
                <h2 className="font-display text-3xl leading-none font-medium tracking-tight">
                  Map
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">Every place you&apos;ve been.</p>
              </div>
            </CardContent>
            <span
              aria-hidden
              className="from-primary/0 via-primary/60 to-primary/0 absolute right-6 bottom-6 h-px w-10 bg-gradient-to-r transition-all duration-500 group-hover:w-20"
            />
          </Card>
        </Link>

        <Link
          href="/stats"
          className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          style={{ animationDelay: '420ms' }}
        >
          <Card
            variant="glass"
            className="relative h-full overflow-hidden transition-transform duration-500 hover:-translate-y-0.5"
          >
            <span
              aria-hidden
              className="border-primary/40 text-primary/80 absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px]"
            >
              04
            </span>
            <CardContent className="flex min-h-44 flex-col justify-between pt-7">
              <p className="text-foreground/55 font-mono text-[10px] tracking-[0.28em] uppercase">
                Section
              </p>
              <div>
                <h2 className="font-display text-3xl leading-none font-medium tracking-tight">
                  Stats
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">A lifetime in numbers.</p>
              </div>
            </CardContent>
            <span
              aria-hidden
              className="from-primary/0 via-primary/60 to-primary/0 absolute right-6 bottom-6 h-px w-10 bg-gradient-to-r transition-all duration-500 group-hover:w-20"
            />
          </Card>
        </Link>
      </section>
    </main>
  );
}
