import { sql } from 'drizzle-orm';

import { db } from '@/db/client';

import type { SearchResultRow, SearchResults, SegmentSubtype } from './types';

// Trips and documents are single-bucket groups, capped at 5. Segment
// subtypes (flight, hotel, activity, transit, food, note) each get
// their own bucket capped at 3 so a multi-leg flight or a hotel-heavy
// trip can't shove every other subtype off the result list. Total
// worst-case segment rows: 3 × 6 subtypes = 18, displayed across
// separate groups.
const PER_GROUP_LIMIT = 5 as const;
const PER_SUBTYPE_LIMIT = 3 as const;

// pg_trgm similarity threshold. Default 0.3 is too strict on short
// one-word queries; 0.2 keeps recall reasonable ("Hanoy" → "Hanoi")
// without flooding the palette with false positives. Inlined as an
// explicit `similarity(...) > X` predicate rather than `set_limit()` so
// the threshold is unambiguous to the planner and doesn't depend on
// CTE evaluation order. Tune after real query traffic shows up.
const TRIGRAM_SIMILARITY = 0.2;

// Minimum token length for prefix (`:*`) matching to fire. Single-char
// prefixes match huge swaths of the corpus and the FTS rank becomes
// arbitrary — the palette would be filled with whichever row happened
// to sort first. Two chars give the planner enough signal to rank
// meaningfully without losing the as-you-type feel.
const PREFIX_MIN_TOKEN_LENGTH = 2;

// Build a `to_tsquery`-compatible string that prefix-matches every
// eligible token. Splits on any non-alphanumeric run (whitespace,
// hyphens, punctuation), keeps Unicode letters/digits so non-ASCII
// place names ("Tōkyō", "München") survive, lowercases for visual
// consistency (tsquery is case-insensitive anyway), drops tokens
// shorter than PREFIX_MIN_TOKEN_LENGTH, and joins survivors with ` & `
// suffixed by `:*`.
//
// Hyphens deserve a note: `to_tsquery` parses bare `-` as the NOT
// operator, so "saint-jean" naïvely becomes `saint & !jean`. Splitting
// on non-alphanumerics sidesteps that — and the `simple` tsvector
// stored on disk already breaks "saint-jean" into two lexemes, so
// `saint:* & jean:*` matches what users expect.
//
// Returns the joined query string, or an empty string when no tokens
// qualify. `to_tsquery('simple', '')` parses to an empty tsquery (no
// FTS match), leaving the trigram path to carry whatever recall the
// short query deserves.
export function buildPrefixTsquery(input: string): string {
  // NFC-normalise first so an IME-produced NFD "Tōkyō" (base 'o' +
  // combining macron) collapses to the precomposed form before the
  // \p{L} split — otherwise the combining mark gets stripped and the
  // user's typed string produces a different tsquery than the same
  // characters pasted from elsewhere.
  return input
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((tok) => tok.length >= PREFIX_MIN_TOKEN_LENGTH)
    .map((tok) => `${tok}:*`)
    .join(' & ');
}

type Row = {
  type: 'trip' | 'segment' | 'document' | 'wishlist';
  segment_type: SegmentSubtype | null;
  wishlist_type: 'food' | 'activity' | null;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

// `currentUserId` scopes results to the viewer (ADR-0015): each entity
// CTE folds in the visibility boundary. Trips and segments are returned
// when the trip is household-shared OR the viewer created it; documents
// stay uploader-scoped (`d.user_id = viewer`), so a private trip's
// boarding pass never surfaces to another member and every hit the
// viewer sees is one they can actually open. Wishlist is fully
// household-shared, so it carries no per-viewer filter.
//
// The `visibility = 'household' OR user_id = …` clauses below are the
// raw-SQL mirror of `tripVisibleToViewer` (src/lib/trips/repo.ts) — they
// can't reuse it directly because this is a hand-written CTE over table
// aliases, so keep them in sync if the canonical predicate changes.
// `repo.visibility.test.ts` guards against drift against a real DB.
export async function searchAll(query: string, currentUserId: string): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < 1) return { trips: [], segments: [], documents: [], wishlist: [] };

  // Build a prefix-matching tsquery in JS rather than handing the raw
  // input to `websearch_to_tsquery`. websearch matches whole lexemes
  // only — typing "Pav" never hits "Pavilion" — which defeats the
  // purpose of an as-you-type palette (issue #17).
  const prefixQuery = buildPrefixTsquery(q);

  // Rank = ts_rank_cd * 2 + similarity. FTS weight doubled so exact
  // keyword hits win ties; trigram hits on typos still surface above
  // weak FTS matches. `to_tsquery('simple', '<token>:*')` is the
  // canonical way to make an FTS query prefix-match — `:*` is a
  // documented lexeme-prefix marker. For empty/sub-threshold input the
  // builder returns ''; `to_tsquery('simple', '')` parses to an empty
  // tsquery (matches nothing via FTS) and `ts_rank_cd(tsv, empty)`
  // evaluates to 0, so the rank expression collapses to pure trigram
  // similarity and the trigram path carries the remaining recall.
  //
  // The `q` CTE evaluates the raw text (for trigram) AND parses the
  // prefix tsquery once; the three per-entity CTEs cross-join `q` so
  // the parser doesn't fire per row. The trigram threshold is an
  // explicit `similarity(...) > X` predicate (the GIN trgm opclass
  // accepts both forms) rather than the session-state `set_limit()`
  // GUC, so the threshold cannot drift with planner evaluation order.
  //
  // The combined score is exposed as a single `rank` alias so ORDER BY
  // can reference it as a bare name. Postgres resolves output aliases
  // in ORDER BY only when they appear as standalone references — once
  // they're inside an expression like `fts * 2 + trg`, the lookup falls
  // back to input columns and fails. One named column avoids that trap.
  const result = await db.execute<Row>(sql`
    WITH q AS (
      SELECT
        ${q}::text AS s,
        to_tsquery('simple', ${prefixQuery}::text) AS tsq
    ),
    trip_hits AS (
      SELECT
        'trip'::text AS type,
        NULL::text AS segment_type,
        NULL::text AS wishlist_type,
        t.id::text AS id,
        t.title AS title,
        -- Trip's own subtitle is just the period; the title already
        -- carries the trip name so no "Trip: <name>" prefix needed.
        to_char(coalesce(t.start_date, t.end_date), 'Mon YYYY') AS subtitle,
        '/trips/' || t.id::text AS href,
        ts_rank_cd(t.search_tsv, q.tsq) * 2 + similarity(t.search_text, q.s) AS rank
      FROM trips t, q
      WHERE (t.search_tsv @@ q.tsq
         OR similarity(t.search_text, q.s) > ${TRIGRAM_SIMILARITY})
        AND (t.visibility = 'household' OR t.user_id = ${currentUserId}::uuid)
      ORDER BY rank DESC
      LIMIT ${PER_GROUP_LIMIT}
    ),
    segment_hits AS (
      -- Per-subtype top-N via ROW_NUMBER() over PARTITION BY type so
      -- flights can't crowd out hotels (or vice versa) when ranking
      -- favours one subtype. Renderer groups these by segment_type.
      --
      -- Title is per-type: route arrow for flights/transit, property
      -- name for hotels, activity title for activities, body excerpt
      -- for notes. The fallback chain ends at the type label so a
      -- malformed payload never produces a blank row.
      --
      -- Subtitle carries the trip context ("Trip: <name> · Mon YYYY")
      -- so the user can disambiguate two segments with the same title
      -- across trips. Flights also get the airline carrier as a brand
      -- prefix because users remember flights by carrier first.
      SELECT type, segment_type, wishlist_type, id, title, subtitle, href
      FROM (
        SELECT
          'segment'::text AS type,
          s.type::text AS segment_type,
          NULL::text AS wishlist_type,
          s.id::text AS id,
          CASE s.type::text
            WHEN 'flight' THEN
              coalesce(
                nullif(
                  coalesce(s.data->>'originAirport', '') || ' → ' ||
                  coalesce(s.data->>'destinationAirport', ''),
                  ' → '
                ),
                s.location_name,
                'Flight'
              )
            WHEN 'hotel' THEN
              coalesce(s.data->>'propertyName', s.location_name, 'Hotel')
            WHEN 'activity' THEN
              coalesce(s.data->>'title', s.location_name, 'Activity')
            WHEN 'transit' THEN
              coalesce(
                nullif(
                  coalesce(s.data->>'fromName', '') || ' → ' ||
                  coalesce(s.data->>'toName', ''),
                  ' → '
                ),
                s.location_name,
                'Transit'
              )
            WHEN 'food' THEN
              coalesce(s.data->>'venue', s.location_name, 'Food')
            ELSE coalesce(s.location_name, left(s.data->>'body', 60), 'Note')
          END AS title,
          CASE
            WHEN s.type::text = 'flight' THEN
              coalesce(nullif(s.data->>'carrier', ''), 'Flight') ||
              ' · Trip: ' || tr.title ||
              coalesce(
                ' · ' || to_char(coalesce(tr.start_date, tr.end_date), 'Mon YYYY'),
                ''
              )
            ELSE
              'Trip: ' || tr.title ||
              coalesce(
                ' · ' || to_char(coalesce(tr.start_date, tr.end_date), 'Mon YYYY'),
                ''
              )
          END AS subtitle,
          -- Flights / hotels / activities / food each have their own
          -- per-type tab; food's flat tab is the only place undated
          -- food is reachable, so it must deep-link there rather than
          -- the itinerary. Transit and notes have no tab and fall back
          -- to the itinerary (the shared chronological view).
          '/trips/' || tr.id::text || '/' ||
            CASE s.type::text
              WHEN 'flight' THEN 'flights'
              WHEN 'hotel' THEN 'hotels'
              WHEN 'activity' THEN 'activities'
              WHEN 'food' THEN 'food'
              ELSE 'itinerary'
            END || '#seg-' || s.id::text AS href,
          ts_rank_cd(s.search_tsv, q.tsq) * 2 + similarity(s.search_text, q.s) AS rank,
          ROW_NUMBER() OVER (
            PARTITION BY s.type
            ORDER BY ts_rank_cd(s.search_tsv, q.tsq) * 2 + similarity(s.search_text, q.s) DESC
          ) AS subtype_rn
        FROM segments s
        JOIN trips tr ON tr.id = s.trip_id, q
        WHERE (s.search_tsv @@ q.tsq
           OR similarity(s.search_text, q.s) > ${TRIGRAM_SIMILARITY})
          AND (tr.visibility = 'household' OR tr.user_id = ${currentUserId}::uuid)
      ) ranked
      WHERE subtype_rn <= ${PER_SUBTYPE_LIMIT}
      ORDER BY rank DESC
    ),
    document_hits AS (
      SELECT
        'document'::text AS type,
        NULL::text AS segment_type,
        NULL::text AS wishlist_type,
        d.id::text AS id,
        d.original_name AS title,
        'Trip: ' || tr.title ||
          coalesce(
            ' · ' || to_char(coalesce(tr.start_date, tr.end_date), 'Mon YYYY'),
            ''
          ) AS subtitle,
        '/trips/' || d.trip_id::text || '/documents' AS href,
        ts_rank_cd(d.search_tsv, q.tsq) * 2 + similarity(d.search_text, q.s) AS rank
      FROM documents d
      JOIN trips tr ON tr.id = d.trip_id, q
      WHERE d.trip_id IS NOT NULL
        AND d.user_id = ${currentUserId}::uuid
        AND (d.search_tsv @@ q.tsq
             OR similarity(d.search_text, q.s) > ${TRIGRAM_SIMILARITY})
      ORDER BY rank DESC
      LIMIT ${PER_GROUP_LIMIT}
    ),
    wishlist_hits AS (
      -- Wishlist items match against the same FTS + trgm columns as
      -- everything else. Title = venue (food) / activity title; the
      -- subtitle carries country + optional location label so the
      -- user can disambiguate "Senso-ji" entries across cities.
      SELECT
        'wishlist'::text AS type,
        NULL::text AS segment_type,
        w.type::text AS wishlist_type,
        w.id::text AS id,
        CASE w.type::text
          WHEN 'food' THEN coalesce(w.data->>'venue', 'Food spot')
          ELSE coalesce(w.data->>'title', 'Attraction')
        END AS title,
        coalesce(c.name, w.country_code) ||
          coalesce(' · ' || nullif(w.location_name, ''), '') AS subtitle,
        '/wishlist#' || w.id::text AS href,
        ts_rank_cd(w.search_tsv, q.tsq) * 2 + similarity(w.search_text, q.s) AS rank
      FROM wishlist_items w
      LEFT JOIN countries c ON c.code = w.country_code, q
      WHERE w.search_tsv @@ q.tsq
         OR similarity(w.search_text, q.s) > ${TRIGRAM_SIMILARITY}
      ORDER BY rank DESC
      LIMIT ${PER_GROUP_LIMIT}
    )
    SELECT type, segment_type, wishlist_type, id, title, subtitle, href FROM trip_hits
    UNION ALL SELECT type, segment_type, wishlist_type, id, title, subtitle, href FROM segment_hits
    UNION ALL SELECT type, segment_type, wishlist_type, id, title, subtitle, href FROM document_hits
    UNION ALL SELECT type, segment_type, wishlist_type, id, title, subtitle, href FROM wishlist_hits
  `);

  const rows = result.rows as Row[];
  const out: SearchResults = { trips: [], segments: [], documents: [], wishlist: [] };
  for (const r of rows) {
    const row: SearchResultRow = {
      type: r.type,
      segmentType: r.segment_type,
      wishlistType: r.wishlist_type,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      href: r.href,
    };
    if (r.type === 'trip') out.trips.push(row);
    else if (r.type === 'segment') out.segments.push(row);
    else if (r.type === 'document') out.documents.push(row);
    else out.wishlist.push(row);
  }
  return out;
}
