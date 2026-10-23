import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';

// One home nav tile. Extracted from the four copy-pasted cards the home
// page used to hand-roll (~130 lines). The next-trip hero now carries
// section 01 (Trips); these tiles carry 02–04.
export function SectionTile({
  href,
  index,
  title,
  delay,
}: {
  href: string;
  index: string;
  title: string;
  delay?: string;
}) {
  return (
    <Link
      href={href}
      className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      style={delay ? { animationDelay: delay } : undefined}
    >
      <Card
        variant="glass"
        className="relative h-full overflow-hidden transition-transform duration-500 hover:-translate-y-0.5"
      >
        <span
          aria-hidden
          className="border-primary/40 text-primary/80 absolute top-4 right-4 hidden h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px] sm:inline-flex"
        >
          {index}
        </span>
        <CardContent className="flex min-h-0 flex-col justify-between pt-5 sm:min-h-40 sm:pt-7">
          <p className="text-foreground/70 hidden font-mono text-[10px] tracking-[0.28em] uppercase sm:block">
            Section
          </p>
          <h2 className="heading-section">{title}</h2>
        </CardContent>
        <span
          aria-hidden
          className="from-primary/0 via-primary/60 to-primary/0 absolute right-6 bottom-6 hidden h-px w-10 bg-gradient-to-r transition-all duration-500 group-hover:w-20 sm:block"
        />
      </Card>
    </Link>
  );
}
