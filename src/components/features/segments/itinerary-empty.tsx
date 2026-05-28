import { Card, CardContent } from '@/components/ui/card';

interface ItineraryEmptyProps {
  hasCountryFilter: boolean;
}

// Itinerary empty state. Matches the warm-sand decorative pattern used
// on the trips list empty state (topographic contour ellipses, ø
// glyph) so the two surfaces feel like one app.
export function ItineraryEmpty({ hasCountryFilter }: ItineraryEmptyProps) {
  return (
    <Card
      variant="glass"
      className="atlas-rise relative overflow-hidden"
      style={{ animationDelay: '300ms' }}
    >
      <svg
        aria-hidden
        className="text-foreground/10 pointer-events-none absolute -right-16 -bottom-16 h-72 w-72"
        viewBox="0 0 200 200"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <ellipse
            key={i}
            cx="100"
            cy="100"
            rx={20 + i * 8}
            ry={14 + i * 7}
            transform={`rotate(${-18 + i * 1.5} 100 100)`}
          />
        ))}
      </svg>

      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-16 text-center">
        <span className="border-foreground/25 text-foreground/70 mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.2em]">
          ø
        </span>
        <p className="font-display text-foreground text-2xl tracking-tight">
          {hasCountryFilter ? 'Nothing scheduled there yet.' : 'No segments yet.'}
        </p>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
          {hasCountryFilter
            ? 'Try the All filter, or add flights, hotels, and activities in this country.'
            : 'The itinerary fills in as you add flights, hotels, and activities — or drop a boarding pass and let Atlas extract the details.'}
        </p>
      </CardContent>
    </Card>
  );
}
