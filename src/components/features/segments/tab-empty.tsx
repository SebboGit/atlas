import { Card, CardContent } from '@/components/ui/card';

interface TabEmptyProps {
  title: string;
  hint: string;
  action?: React.ReactNode;
}

// Reusable empty-state for the type-specific tabs. Lighter than the
// itinerary's empty state (no topographic decoration) so the type-tab
// surfaces don't shout "look at me" when they're just waiting.
export function TabEmpty({ title, hint, action }: TabEmptyProps) {
  return (
    <Card
      variant="paper"
      className="atlas-rise relative overflow-hidden"
      style={{ animationDelay: '300ms' }}
    >
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <span className="border-foreground/25 text-foreground/55 inline-flex h-9 w-9 items-center justify-center rounded-full border font-mono text-[10px]">
          ø
        </span>
        <p className="font-display text-foreground text-xl tracking-tight">{title}</p>
        <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">{hint}</p>
        {action && <div className="mt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}
