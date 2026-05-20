# ADR-0013: Postgres-native search via generated `tsvector` columns

- **Status:** Accepted
- **Date:** 2026-05-20
- **Deciders:** @SebboGit

## Context

The May 2026 roadmap identified global search as the highest-leverage
navigation gap in Atlas: _"that ramen place in Tokyo last fall"_ was
unreachable without manually clicking through trips. PR #12 ships a
Cmd+K command palette that searches across three domain aggregates —
`trips`, `segments`, and `documents` — each with a different schema
(plain columns plus per-aggregate JSONB blobs in `data`, `parsed`, and
`overrides`).

Before writing a line of search code we had to decide where the search
index lives. The options were architecturally distinct, not just
implementation details:

1. A separate, application-maintained `search_index` table that mirrors
   tokenised content from all three sources. Writes to a source row fan
   out to the index via triggers or app-side hooks.
2. `tsvector` columns directly on each source table, **maintained by
   Postgres** as `GENERATED ALWAYS ... STORED`. Source writes update
   the index transactionally, by definition.
3. An out-of-process search engine — Elasticsearch, Meilisearch, Typesense
   — fed by an indexer service.

Atlas's other architectural commitments narrow the field quickly:

- **Self-hosted, single-host operational simplicity** (CLAUDE.md). Adding
  a second stateful service is a real cost.
- **Postgres is already in the stack**, with FTS (`tsvector`,
  `websearch_to_tsquery`) and fuzzy matching (`pg_trgm`) built in.
- **"Documents are first-class citizens: original files immutable,
  parsed data separate and re-derivable"** — implying that whatever
  feeds search has to track re-extractions cleanly, not lag behind them.
- **Schema is forward-only**; we'd rather pay for a slightly more
  involved query than carry an indexer's drift bugs forever.

## Decision

Index search content as **generated `tsvector` columns directly on the
source tables**. No central `search_index` table, no application-side
indexer, no out-of-process engine.

Each searchable aggregate gets two columns and two indexes:

- `search_text text GENERATED ALWAYS AS (<expression>) STORED` — the
  tokeniser input, plain text, used as the trigram-similarity column.
- `search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', <same
expression>)) STORED` — the FTS index column.
- A GIN index on `search_tsv` for `@@`-style FTS queries.
- A GIN index on `search_text gin_trgm_ops` for `similarity()` fuzzy
  matching.

The query layer in `src/lib/search/repo.ts` builds one CTE per entity
type (`trip_hits`, `segment_hits`, `document_hits`), `UNION ALL`s them,
and ranks with a blended formula `ts_rank_cd * 2 + similarity` —
FTS doubled so exact keyword matches win ties, trigrams surface typos
above weak FTS. `websearch_to_tsquery('simple', ...)` is used in place
of `to_tsquery` because it never throws on malformed input, which is
exactly what an end-user search box needs.

### Expression hygiene (the load-bearing details)

The `extract_jsonb_text(j jsonb)` SQL helper (migration 0010) walks
`data` / `parsed` / `overrides` payloads via
`jsonb_path_query(j, 'strict $.**') WITH ORDINALITY` and
`string_agg(... ORDER BY ord)`. The function is declared `IMMUTABLE`
and `PARALLEL SAFE`. The ordinality is load-bearing: without an
explicit `ORDER BY`, a future planner that combines parallel partial
aggregates in any order would silently corrupt the generated column,
because `IMMUTABLE` would no longer hold. This is the kind of bug
that doesn't surface in unit tests and only bites a year in, so the
ordinality is enforced in the function body rather than left as a
caller convention.

The documents expression additionally runs
`regexp_replace(original_name, '[^a-zA-Z0-9]+', ' ', 'g')` before
tokenisation (migration 0011). Filenames like `oman_air.pdf` and
`boarding_pass_VN.pdf` would otherwise be a single opaque token under
the `simple` parser and never match a free-text query.

The segments expression runs a second regex
`regexp_replace(text, '([a-z])([A-Z])', '\1 \2', 'g')` to split
CamelCase carrier names (`AirAsia` → `Air Asia`, `EasyJet` → `Easy
Jet`) so they tokenise into the words users actually type
(migration 0012). Uppercase IATA codes like `MUC` and already-spaced
names like `Vietnam Airlines` are untouched.

**Rule of thumb when adding a new searchable column:**
punctuation-glued strings need the `[^a-zA-Z0-9]+` split, brand /
product strings need the CamelCase split, plain prose needs neither.

### Text-search configuration

`'simple'` everywhere — no stemming. Atlas content is multilingual
(`Tōkyō`, `München`, Vietnamese hotel names, French street names) and
English stemmers mangle non-English tokens. The cost of `simple` is
that "ramen" doesn't match "ramens", which in practice doesn't bite
because trigram similarity covers the same ground for typos and minor
suffixes.

### Fuzzy matching threshold

Trigram similarity uses an **explicit `similarity(text, q) > 0.2`
predicate**, not the `pg_trgm.similarity_threshold` GUC via
`set_limit()`. The GUC version depends on CTE evaluation order and
could silently drift to the 0.3 default on a different planner; the
explicit predicate is unambiguous and survives planner upgrades. The
0.2 value is a starting point — tune after watching real query
traffic.

### Visibility

Per Atlas's household-visibility model, search results are gated by
`requireUser()` at the action boundary but not filtered by `userId`.
Orphan documents (`trip_id IS NULL`) are filtered out until a
`/documents` index route exists to deep-link to.

## Consequences

### Positive

- **Zero drift risk.** Postgres updates the index inside the same
  transaction as the source row. There is no scenario where a trip
  is saved but its search vector is stale, or vice versa. No
  reconciliation job, no nightly resync.
- **No indexer code.** The "indexer" is `GENERATED ALWAYS AS`. No
  triggers, no hooks in server actions, no queue worker. The simplest
  thing that can possibly work.
- **One mental model for adding entities.** Wishlist, food, locations,
  and anything else that ships later picks up search by adding two
  columns, two indexes, and one CTE to `searchAll`. No coordination
  with a separate indexing service.
- **`needsReview`, `overrides`, and re-extraction "just work."** When
  a user edits a parsed document or extraction overwrites a payload,
  the search vector updates atomically because the source row changes.
- **No new infrastructure.** Postgres is already there, already
  backed up, already part of the operational story.

### Negative / tradeoffs

- **`searchAll` is a multi-CTE `UNION ALL`** rather than a single
  index lookup. Three queries' worth of planning per search call.
  At Atlas's scale (single user, small household) this is invisible,
  but it does mean ranking is computed per-entity and blended in
  application code rather than globally normalised by a search engine.
- **Cross-entity ranking is approximate.** The `ts_rank_cd * 2 +
similarity` formula is identical across entity types, so a strong
  hit in one CTE can outrank a slightly stronger hit in another only
  when the underlying score difference is large. Group caps (5
  trips/documents, 3 per segment subtype via
  `ROW_NUMBER() OVER (PARTITION BY ...)`) hide most of the asymmetry
  in the UI.
- **Adding a new entity requires a migration.** Two new columns and
  two new indexes is forward-only schema work, not a code-only
  change. We accept this — it's the same cost as adding any other
  query-supporting column.
- **JSONB walking has correctness gotchas.** `extract_jsonb_text` and
  the `WITH ORDINALITY` requirement are non-obvious. Anyone editing
  the function must keep `IMMUTABLE` and `PARALLEL SAFE` in mind. The
  ADR is partly to make that explicit so a future maintainer doesn't
  "simplify" the ordinality away.
- **Generated columns are immutable from app code.** `INSERT` /
  `UPDATE` statements cannot set `search_text` or `search_tsv`
  explicitly. This is what we want — but it's worth knowing.

### Neutral

- The pattern is uniform: every future searchable entity follows the
  same recipe. There is no "one weird trick" for documents vs.
  segments vs. trips — only different source expressions.
- Storage cost is meaningful but bounded: the `STORED` `tsvector`
  duplicates token data, and the GIN indexes add their own bytes. On
  a personal-scale corpus this is rounding error.

## Alternatives considered

- **Central application-maintained `search_index` table.** Most
  conventional answer. Rejected because every write path (server
  actions for trip/segment/document mutations, the extraction
  orchestrator, the `re-extract` flow, the orphan sweeper) would
  need to fan out a write to the index. The first time one of those
  paths forgets — and one of them eventually would — search results
  drift from source-of-truth state and we have a debugging mystery
  with no signal in the application logs. Triggers solve the
  reliability problem but introduce hidden SQL behaviour that's hard
  to test and easy to forget. Generated columns are functionally a
  trigger written in DDL, with the difference that Postgres owns the
  contract and the schema declares it.

- **Out-of-process search engine (Meilisearch / Typesense / pg_search).**
  Best ranking quality, fastest fuzzy matching, by far the most work
  to operate. Adds a second stateful service to back up, monitor,
  upgrade, and restore. Justifiable at a scale Atlas will never reach.
  Rejected on the same self-hosted-first-but-not-overbuilt principle
  as ADR-0006 (no cloud LLM) and ADR-0010 (Nominatim over Mapbox /
  Google) — Postgres is already in the stack and good enough.

- **Plain (non-generated) `tsvector` columns updated by application
  code.** Mechanically the same query shape as the chosen design, but
  the indexer-drift surface returns: every server action that writes
  to a searchable row would have to remember to recompute and write
  the vector. The win of generated columns is precisely that the
  application _cannot_ forget.

- **Live `to_tsvector(...)` on every query (no stored column).**
  Functionally correct, indexable via a functional index, but the
  expression we want involves walking a `jsonb` blob — re-running
  that on every query is wasteful when storage is cheap. Stored
  generated columns trade write-time CPU and disk for query-time
  speed, which is the right tradeoff for a read-heavy search palette.

- **Materialised view over the three tables.** A reasonable middle
  ground, but materialised views in Postgres don't auto-refresh —
  we'd need a refresh schedule, which reintroduces drift and adds a
  scheduler dependency for what should be a transparent index. Worse
  than generated columns on every axis we care about.

## Post-acceptance notes

This ADR was deferred from PR #12's checklist ("ADR added —
borderline. Easy follow-up.") and written after the search slice
shipped. Nothing in the design has changed since merge; this is
documentation of an existing, working decision, not a proposal.

## When to revisit

Trigger conditions for a superseding ADR:

1. **Cross-entity ranking quality becomes a real complaint.** If
   users routinely surface a hotel result when they wanted a flight,
   or vice versa, the per-entity rank normalisation isn't enough. At
   that point either tune per-entity weights, or graduate to a real
   search engine — and only then.
2. **Search latency exceeds ~200ms p95** on a corpus we still
   consider personal-scale. That would mean the `UNION ALL` plan is
   no longer free, and a denormalised central index might earn its
   keep. Until then, denormalisation is unwarranted complexity.
3. **A fourth or fifth searchable entity makes the per-entity CTE
   pattern unwieldy.** Possible but unlikely — wishlist, food, and
   locations all fit the same shape — but if a future entity needs
   fundamentally different ranking (graph traversal, recency-heavy
   weighting, geographic proximity), revisit.

## References

- ADR-0006 — Ollama-only LLM extraction (same self-hosted-first
  philosophy: don't add infrastructure when an in-stack solution is
  good enough).
- ADR-0010 — Geocoding via Nominatim (same principle on the geocoder
  axis: free + good enough beats paid + slightly better).
- [PostgreSQL: Full Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [PostgreSQL: pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)
- [PostgreSQL: Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)
