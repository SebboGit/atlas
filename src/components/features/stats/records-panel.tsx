import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { PersonalRecords } from '@/lib/stats';
import { latitudeLabel, plural } from '@/lib/stats/format';
import { cn } from '@/lib/utils';

import { RecordEntry } from './record-entry';

type Row = { label: string; value: string; note?: string };

/**
 * The personal-records panel: a small ledger of superlatives. Each entry
 * is one record; records with no data (a freshly-started Atlas) are
 * omitted rather than shown as "—". If nothing qualifies, the panel shows
 * a single quiet line.
 *
 * Layout: two explicit columns. The left holds the non-latitude records
 * (longest trip, most-seen airport, most-flown airline); the right holds
 * the latitude extremes (furthest north / south) kept together. Explicit
 * columns — not a row-flow grid — so the taller latitude pair never
 * strands an empty cell beside it.
 *
 * This is the printed keepsake at the foot of the logbook: a paired
 * hairline, a mono plate number, and the section's only Fraunces
 * sub-heading lift it above the bar strips it sits under.
 */
export function RecordsPanel({ records }: { records: PersonalRecords }) {
  const left: Row[] = [];
  if (records.longestTrip) {
    const { nights, title } = records.longestTrip;
    left.push({
      label: 'Longest trip',
      value: `${nights} ${plural(nights, 'night')}`,
      note: title,
    });
  }
  if (records.mostVisitedAirport) {
    const { code, visits } = records.mostVisitedAirport;
    left.push({
      label: 'Most-seen airport',
      value: code,
      note: `Passed through ${visits} ${plural(visits, 'time')}.`,
    });
  }
  if (records.topAirline) {
    const { name, flights } = records.topAirline;
    left.push({
      label: 'Most-flown airline',
      value: name,
      note: `${flights} ${plural(flights, 'flight')} on the books.`,
    });
  }

  // Right column: the latitude extremes, kept together.
  const right: Row[] = [];
  if (records.northernmost) {
    right.push({
      label: 'Furthest north',
      value: latitudeLabel(records.northernmost.lat),
      note: records.northernmost.label,
    });
  }
  if (records.southernmost) {
    right.push({
      label: 'Furthest south',
      value: latitudeLabel(records.southernmost.lat),
      note: records.southernmost.label,
    });
  }

  const hasAny = left.length > 0 || right.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Plate header — a paired hairline, the plate number, and the
       *  section's only Fraunces sub-heading. */}
      <div className="flex flex-col gap-4">
        <div className="atlas-rule" aria-hidden />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
          <h2 className="heading-section">For the record.</h2>
          <Badge variant="default" className="self-start sm:self-auto">
            No. 02 · The records
          </Badge>
        </div>
      </div>

      <Card variant="paper">
        <CardContent className="p-6 sm:p-7">
          {!hasAny ? (
            <p className="text-muted-foreground text-sm">
              Records show up once a few trips have dates and places on them.
            </p>
          ) : (
            // Two explicit columns: left = the non-latitude records, right =
            // north/south together. On phone the columns stack, so the
            // latitude pair reads consecutively at the foot. Each column only
            // renders when it has entries, and the two-column track only
            // engages when both sides exist — so a records set with just
            // latitude data doesn't strand an empty left cell.
            <div
              className={cn(
                'grid gap-x-8 gap-y-7',
                left.length > 0 && right.length > 0 && 'sm:grid-cols-2',
              )}
            >
              {left.length > 0 && (
                <div className="flex flex-col gap-7">
                  {left.map((r) => (
                    <RecordEntry key={r.label} label={r.label} value={r.value} note={r.note} />
                  ))}
                </div>
              )}
              {right.length > 0 && (
                <div className="flex flex-col gap-7">
                  {right.map((r) => (
                    <RecordEntry key={r.label} label={r.label} value={r.value} note={r.note} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
