# ADR-0010: Geocoding via Nominatim (public OSM endpoint)

- **Status:** Accepted
- **Date:** 2026-05-17
- **Deciders:** @SebboGit

## Context

Phase 3a of the trip map (commits `0e26923`, `c743fb9`) renders flight pins
and arcs from the committed IATA airport snapshot. Hotels, activities, and
transit segments are pin-eligible but appear today in an "ungeocoded" list
under the map with the placeholder copy "Pinning hotels, activities, and
transit needs geocoding — coming next."

To turn `locationName` ("Hotel Example, Paris", "Mountain viewpoint",
"Central Station main entrance") into a pin we need a free-text →
`{lat, lng}` service.

Atlas operates under the constraints already set by CLAUDE.md ("External
Integrations"):

- Behind a swappable interface, one file per provider.
- DB-backed cache, no in-memory cache for cross-request data.
- Secrets in env, never log full response bodies.
- Graceful degradation: manual entry / "not pinned yet" must always work.
- No retries that compound rate-limited quota.

The flight pipeline taught us a related lesson (ADR-0009): when data has a
stable identity (airports, airlines), prefer a committed snapshot over a
runtime API. Street-level POIs don't have that property — there's no
canonical 2-letter code for "the boutique hotel a block off Plaza Mayor."
That's where a real geocoder earns its place.

## Decision

Use **Nominatim** (the public OSM-hosted geocoding service at
`nominatim.openstreetmap.org`) as Atlas's geocoding backend. Wire it
through a `Geocoder` interface in `src/lib/geocoding/` with one
implementation file (`nominatim.ts`) and a DB-backed cache (`cache.ts`)
keyed on the normalized query string.

### Operational rules

1. **One request per second, hard ceiling.** Nominatim's usage policy
   allows up to 1 req/s for absolutely-bulk operations; Atlas's volume is
   far below that, but we enforce 1 req/s in code via an in-process token
   bucket so a runaway loop can't get us banned.

2. **`User-Agent` is mandatory and identifying.** Nominatim explicitly
   blocks generic agents. Atlas sends:
   `Atlas/<version> (<NOMINATIM_CONTACT_EMAIL>)`.
   A new env var `NOMINATIM_CONTACT_EMAIL` carries the contact address;
   if unset, the geocoder factory throws at startup rather than silently
   sending an unattributed request.

3. **No retries on rate-limit or 5xx.** A 429 or 5xx response returns
   `null` from `Geocoder.geocode` and the caller falls through to the
   ungeocoded list with a "try again in a moment" reason. Retries on
   quota-limited APIs only deepen the hole.

4. **DB cache with TTL.** All callers go through
   `getCachedOrFetch(query)` — never call `Geocoder.geocode` directly.
   Cache row schema:
   - **PK:** `query_normalized` (lowercase, trimmed, whitespace
     collapsed) — same normalisation we'd apply for an equality
     comparison.
   - **Positive hit TTL:** **90 days.** Hotels and city POIs move
     rarely; even a quarter-year-old coordinate is materially correct
     for "show this pin on a map."
   - **Negative hit TTL:** **7 days.** A "couldn't find this" answer
     is usually a malformed `locationName` (typo, partial address); we
     don't want to wait 90 days to retry after the user fixes it, but
     we also don't want to hit Nominatim on every page load for a
     genuinely unresolvable string. 7 days lets a once-a-week trip
     refresh re-try without bothering Nominatim per render.
   - Expired rows are not auto-purged — `getCachedOrFetch` treats an
     expired hit as a miss and refreshes in place.

5. **Attribution.** Nominatim is OSM data. We append " · Geocoding by
   Nominatim" to the existing OSM attribution line on the trip-detail
   map (`src/components/features/trip-map/trip-map.tsx`). The global
   `/map` view is choropleth-only and doesn't call Nominatim, so its
   attribution stays unchanged.

6. **Server-only.** The geocoding module never ships to a client bundle.
   Trip-map data goes through the existing server-side repo
   (`src/lib/trip-map/repo.ts`); on-demand geocoding is fired from
   server actions via the `Jobs` interface (`InlineJobs` today), never
   from the browser.

### Privacy

Nominatim calls send the segment's free-text `locationName` over the
network to a third-party host. That's a real boundary crossing — but
the field is text the user typed (or extraction lifted from a hotel
confirmation), not document content, not PII beyond a venue name +
city. We log the **hash** of the normalized query (for cache-debugging
correlations), never the raw string or the response body.

This is consistent with the spirit of ADR-0006 (no document content
leaves the host): a venue name on a public map is qualitatively different
from a passport scan.

## Consequences

### Positive

- **Zero cost.** Free for personal-scale volumes.
- **No API key to rotate.** `User-Agent` + contact email is the entire
  identification story.
- **OSM-aligned.** Same attribution chain as the eventual Protomaps
  basemap; one mental model.
- **Cache amortises everything.** A trip with 10 hotels geocoded once
  costs 10 Nominatim hits ever. Re-renders, re-visits, re-extracts: all
  free.

### Negative / tradeoffs

- **Rate-limited by policy, not by us.** A bad actor (or a bad loop)
  could overshoot 1 req/s without the token bucket. We mitigate with
  the in-process bucket but a multi-process future (cluster mode,
  serverless) would need redis-backed throttling — out of scope today.
- **Quality is OSM quality.** Coverage is excellent in Europe and
  major cities, thinner for rural Asia / Africa. The ungeocoded list
  is the safety net; users see what's missing, can fix the
  `locationName`, and re-extract or re-edit.
- **Public instance can go down.** A 5xx returns null; pins disappear
  from the map gracefully. Cache hits keep working through the outage.
- **Third-party network call per uncached `locationName`.** Documented
  above. Mitigated by 90-day positive TTL.

### Neutral

- The `Geocoder` interface lives even though there's exactly one
  implementation today. Same pattern as `LLMExtractor` (ADR-0006) —
  the interface is the contract, the impl is a swap when needed.

## Alternatives considered

- **Photon (Komoot, OSM-based).** Free, no rate limit on their public
  instance, autocomplete-oriented. Rejected for now: API surface skews
  toward search-as-you-type rather than one-shot geocoding, and the
  cache story is identical so we'd see no shape difference. Reasonable
  fallback if Nominatim becomes unreliable.

- **Mapbox / Google / HERE / OpenCage.** Higher quality on
  ambiguous addresses, but: paid (or free tiers that cap below our
  realistic ceiling), API keys to rotate, and a vendor dependency
  outside the OSM ecosystem we've already committed to via Protomaps.
  Rejected on the same "self-hosted-first" principle as ADR-0006 and
  ADR-0009.

- **Self-hosted Nominatim from day one.** Doable (it's a documented
  Docker image) but every Atlas instance would carry the ~100+ GB
  planet import. Premature for a personal app — public instance is
  fine until we either hit rate limits routinely or our query volume
  starts to feel like abuse.

- **No geocoding; manual lat/lng on segments.** The fallback path on
  every hosted geocoder, but it pushes work onto the user and the
  segment form for every hotel and activity. Rejected: Nominatim
  covers the common case well enough that manual entry isn't worth
  the UX cost.

## Post-acceptance notes

**2026-05-17 — hotel query simplified to address-first.** Initial
implementation combined `propertyName, address` for hotels on the
theory that Nominatim handles compound queries well. In practice
branded hotel names with management-company suffixes (e.g. a long
"Hotel Brand City Managed By Other Brand" string) trip Nominatim's
left-to-right q-parser and return null even though the underlying
street address resolves cleanly on its own. Changed
`buildGeocodeQuery` for hotels to use `address` alone and fall back
to `propertyName` only when no address is on file. Activities and
transit are unaffected — their primary fields (`title`, `toName`)
are short enough not to confuse the parser.

## When to revisit

Trigger conditions for a superseding ADR:

1. **Sustained rate-limit pressure.** If 429 responses become routine
   (more than a handful per week), switch to self-hosted Nominatim
   (Docker, planet import on the homelab) — same interface, same
   cache, just `NOMINATIM_URL` pointed at the local instance.

2. **Cache hit rate drops materially.** A consistently low hit ratio
   (say, < 50%) means our normalisation isn't matching the way users
   type, or the TTLs are wrong. Tune the cache key, not the provider.

3. **Coverage failures on real trips.** If users are consistently
   landing in the "couldn't find" list for places that clearly exist
   on OSM, the issue is query construction (over-detailed input, wrong
   language), not Nominatim itself. Adjust the input normalisation
   first; consider Photon as the second-pass fallback only if needed.

## References

- ADR-0006 — Ollama-only LLM extraction (same self-hosted-first
  philosophy, same interface pattern).
- ADR-0009 — Static snapshots for identity-bearing reference data
  (the inverse case: when not to call a runtime API).
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Protomaps](https://protomaps.com/) — basemap end state, separate
  concern.
