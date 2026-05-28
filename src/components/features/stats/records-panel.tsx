import { Card, CardContent } from '@/components/ui/card';
import type { PersonalRecords } from '@/lib/stats';
import { latitudeLabel, plural } from '@/lib/stats/format';

import { RecordEntry } from './record-entry';

/**
 * The personal-records panel: a small ledger of superlatives. Each
 * entry is one record; records with no data (a freshly-started Atlas)
 * are simply omitted rather than shown as "—". If nothing qualifies at
 * all, the whole panel shows a single quiet line.
 *
 * Entries lay out in a two-column grid so they use the full card width
 * — instead of stranding label↔value pairs in a wide, half-empty row.
 */
export function RecordsPanel({ records }: { records: PersonalRecords }) {
  const rows: Array<{ label: string; value: string; note?: string }> = [];

  if (records.longestTrip) {
    const { nights, title } = records.longestTrip;
    rows.push({
      label: 'Longest trip',
      value: `${nights} ${plural(nights, 'night')}`,
      note: title,
    });
  }
  if (records.northernmost) {
    rows.push({
      label: 'Furthest north',
      value: latitudeLabel(records.northernmost.lat),
      note: records.northernmost.label,
    });
  }
  if (records.southernmost) {
    rows.push({
      label: 'Furthest south',
      value: latitudeLabel(records.southernmost.lat),
      note: records.southernmost.label,
    });
  }
  if (records.mostVisitedAirport) {
    const { code, visits } = records.mostVisitedAirport;
    rows.push({
      label: 'Most-seen airport',
      value: code,
      note: `Passed through ${visits} ${plural(visits, 'time')}.`,
    });
  }
  if (records.topAirline) {
    const { name, flights } = records.topAirline;
    rows.push({
      label: 'Most-flown airline',
      value: name,
      note: `${flights} ${plural(flights, 'flight')} on the books.`,
    });
  }

  return (
    <Card variant="paper">
      <CardContent className="flex flex-col gap-6 p-6 sm:p-7">
        <p className="text-foreground/70 flex items-center gap-2.5 font-mono text-[10px] tracking-[0.28em] uppercase">
          <span aria-hidden className="bg-foreground/25 h-px w-5" />
          <span>The records</span>
        </p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Records show up once a few trips have dates and places on them.
          </p>
        ) : (
          <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {rows.map((row) => (
              <RecordEntry key={row.label} label={row.label} value={row.value} note={row.note} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
