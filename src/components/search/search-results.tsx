'use client';

import { Activity, FileText, Hotel, Map as MapIcon, MapPin, Plane, TrainFront } from 'lucide-react';
import * as React from 'react';

import { CommandGroup, CommandItem } from '@/components/ui/command';
import type { SearchResultRow, SearchResults } from '@/lib/search/types';

// Stable lookup table — defined at module scope so the icon picker is a
// pure value selection, not a component constructor inside render. The
// `react-hooks/static-components` rule otherwise flags any `const Icon =
// pickFn(...)` shape because Icon could (in theory) be a freshly-built
// component.
const ICON_CLASS = 'text-foreground/55 size-4 shrink-0';

function RowIcon({ row }: { row: SearchResultRow }) {
  if (row.type === 'trip') return <MapIcon className={ICON_CLASS} aria-hidden />;
  if (row.type === 'document') return <FileText className={ICON_CLASS} aria-hidden />;
  switch (row.segmentType) {
    case 'flight':
      return <Plane className={ICON_CLASS} aria-hidden />;
    case 'hotel':
      return <Hotel className={ICON_CLASS} aria-hidden />;
    case 'activity':
      return <Activity className={ICON_CLASS} aria-hidden />;
    case 'transit':
      return <TrainFront className={ICON_CLASS} aria-hidden />;
    case 'note':
      return <FileText className={ICON_CLASS} aria-hidden />;
    default:
      return <MapPin className={ICON_CLASS} aria-hidden />;
  }
}

// Highlight every case-insensitive occurrence of each whitespace-split
// token from `query`. Token-split (not the whole query) so multi-word
// searches and FTS tokenisation still produce visible highlights —
// `"flight HAN"` lights up both `"flight"` and `"HAN"` independently
// instead of looking for the exact substring `"flight HAN"`. Overlapping
// token matches are coalesced by walking left-to-right and only opening
// a new <mark> at the earliest unresolved match.
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = React.useMemo(() => {
    return query
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
  }, [query]);
  if (tokens.length === 0) return <>{text}</>;

  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    // Find the next match across any token from the current cursor.
    let nextIdx = -1;
    let nextLen = 0;
    for (const tok of tokens) {
      const idx = lower.indexOf(tok, cursor);
      if (idx === -1) continue;
      if (nextIdx === -1 || idx < nextIdx || (idx === nextIdx && tok.length > nextLen)) {
        nextIdx = idx;
        nextLen = tok.length;
      }
    }
    if (nextIdx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (nextIdx > cursor) parts.push(text.slice(cursor, nextIdx));
    parts.push(
      <mark key={`m-${nextIdx}`} className="bg-primary/15 text-foreground rounded-sm px-0.5">
        {text.slice(nextIdx, nextIdx + nextLen)}
      </mark>,
    );
    cursor = nextIdx + nextLen;
  }
  return <>{parts}</>;
}

function ResultItem({
  row,
  query,
  onSelect,
}: {
  row: SearchResultRow;
  query: string;
  onSelect: (row: SearchResultRow) => void;
}) {
  // cmdk identifies items by their `value`. Using the row id keeps
  // selection stable across re-fetches with the same query.
  return (
    <CommandItem
      value={`${row.type}:${row.id}`}
      onSelect={() => onSelect(row)}
      className="data-[selected='true']:bg-foreground/8"
    >
      <RowIcon row={row} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground truncate text-sm">
          <Highlight text={row.title} query={query} />
        </span>
        {row.subtitle ? (
          <span className="text-muted-foreground truncate text-xs">{row.subtitle}</span>
        ) : null}
      </div>
    </CommandItem>
  );
}

// Group render order: Trips → Hotels → Activities → Documents → Flights → Transit → Notes.
// Reflects likelihood-of-interest. The parent Trip first, then where you
// stayed / what you did, then documents, then the transactional records
// (flights, transit, notes) you mostly remember by trip rather than by
// name. Food slots in between Trips and Hotels when the food segment
// type lands — see memory: food-segment-type.
export function SearchResultsView({
  results,
  query,
  onSelect,
}: {
  results: SearchResults;
  query: string;
  onSelect: (row: SearchResultRow) => void;
}) {
  const hasAny =
    results.trips.length > 0 || results.segments.length > 0 || results.documents.length > 0;
  if (!hasAny) return null;

  // Partition segments by subtype so each renders in its own group.
  // Per-subtype ordering inside each bucket is preserved from the SQL
  // ORDER BY rank DESC.
  const bySubtype = new Map<string, SearchResultRow[]>();
  for (const r of results.segments) {
    if (!r.segmentType) continue;
    const bucket = bySubtype.get(r.segmentType);
    if (bucket) bucket.push(r);
    else bySubtype.set(r.segmentType, [r]);
  }

  return (
    <>
      <Group heading="Trips" rows={results.trips} query={query} onSelect={onSelect} />
      <Group heading="Hotels" rows={bySubtype.get('hotel')} query={query} onSelect={onSelect} />
      <Group
        heading="Activities"
        rows={bySubtype.get('activity')}
        query={query}
        onSelect={onSelect}
      />
      <Group heading="Documents" rows={results.documents} query={query} onSelect={onSelect} />
      <Group heading="Flights" rows={bySubtype.get('flight')} query={query} onSelect={onSelect} />
      <Group heading="Transit" rows={bySubtype.get('transit')} query={query} onSelect={onSelect} />
      <Group heading="Notes" rows={bySubtype.get('note')} query={query} onSelect={onSelect} />
    </>
  );
}

function Group({
  heading,
  rows,
  query,
  onSelect,
}: {
  heading: string;
  rows: SearchResultRow[] | undefined;
  query: string;
  onSelect: (row: SearchResultRow) => void;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {rows.map((r) => (
        <ResultItem key={r.id} row={r} query={query} onSelect={onSelect} />
      ))}
    </CommandGroup>
  );
}
