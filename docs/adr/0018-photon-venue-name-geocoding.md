# ADR-0018: Photon-first free-text geocoding with Nominatim fallback

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** @SebboGit
- **Amends:** ADR-0010 (provider clause; the cache, etiquette, and interface decisions there stand)

## Context

ADR-0010 chose Nominatim's public endpoint for free-text geocoding, and
ADR-0010's own failure catalogue plus two follow-ups (#26 Plus Codes,
#27 address normalizer) narrowed but did not close the hit-rate gap for
foreign venues (issue #104). The residual failures are venue-_name_
queries: Nominatim is an address interpreter, not a search engine — its
`q=` parser tokenises left-to-right, requires essentially all terms to
match, and has no typo tolerance and no relevance ranking. Its own
documentation points name/autocomplete workloads elsewhere.

The trigger observation: plus.codes/map resolves the same hotel names
instantly. Investigation showed its search box is Google Places
autocomplete — the plus code is trivial client-side math over the
coordinates Google returns. The geocoder is the magic, not the code
format. Google Places itself is **not adoptable**: the Google Maps
Platform terms prohibit displaying results on a non-Google map and
caching coordinates beyond ~30 days. Atlas renders pins on MapLibre
and caches coordinates permanently — the architecture violates both
clauses by design, so that path is closed regardless of pricing.

Photon (komoot's open-source geocoder) indexes the same OSM data as
Nominatim through OpenSearch: typo tolerance, prefix matching, and all
`name:*` language tags searchable. It fixes the matching half of the
gap. It cannot fix coverage — a place absent from OSM stays unfindable
by name, and the #26 Plus Code paste flow remains the escape hatch.
A live probe of the documented failure cases ("Hotel Gajoen Tokyo",
"Nazuna Kyoto Gosho") resolved all of them on the public instance.

## Decision

1. **Provider ladder, one query string.** Free-text geocoding becomes
   `FallbackGeocoder(photon, nominatim)`: Photon first, Nominatim
   retried on a Photon null. The ladder implements the same `Geocoder`
   interface, so the cache layer, `PlaceResolver` (Plus Code routing),
   and every call site are untouched — and the cache-key contract
   (normalised query string) is unchanged. Nominatim remains the
   reverse geocoder for Plus Code display names.
2. **Public instance, self-host as plan B.** `photon.komoot.io` under
   its fair-use policy, same posture as public Nominatim in ADR-0010:
   permanent DB cache in front, 1 req/s in-process throttle, identifying
   User-Agent (reusing `NOMINATIM_CONTACT_EMAIL`). `PHOTON_URL` points
   at a self-hosted instance (~75–100 GB planet index) if the public
   one ever degrades — an env swap, not a rewrite.
3. **Name-first queries for hotels and food.** With a name-capable
   matcher, the derived query flips: `propertyName`/`venue` plus a
   context tail — the user's pin-style `locationName` when present,
   else the segment's country name. The address is the query only for
   name-less rows. (The old address-first order existed solely to dodge
   Nominatim's q-parser; ADR-0010's "labels vs. coordinates" rule —
   `locationName` is the pin label — is superseded on this one point:
   the label now doubles as the disambiguation tail.) Activities keep
   address-before-title but gain the same country fallback tail.
4. **The interactive picker (#16) rides the ladder.** `search()` goes
   to Photon first, giving the candidate list typo tolerance.
5. **Normalization moves into the query builder.** `buildGeocodeQuery`
   now returns the geocoder-ready string: address branches run through
   the `normalizeForGeocoder` noise-stripper, name and Plus Code
   branches get NFC/whitespace cleanup only. The stripper's floor/unit/
   postcode rules were written for addresses and silently delete tokens
   from number-branded venue names ("Room 39, Bangkok" → "Bangkok",
   "Hotel 1898, Spain" → "Hotel, Spain") — caught in review before
   merge. Call sites no longer re-apply the normalizer; the worker's
   defensive re-normalize is likewise removed. An unresolvable country
   code is dropped rather than appended as a junk tail.
6. **Provenance on cache rows.** `GeocodeResult.source` records which
   provider produced a hit and is persisted to `geocode_cache.source`
   ("photon" / "nominatim" / "plus-code"; "none" for misses), so "is
   the fallback carrying the load?" is answerable from the table.

## Consequences

- Venue-name lookups — the #104 pain — resolve without an address on
  file, including the documented Japanese failure cases.
- An address edit under a stable venue name no longer re-geocodes the
  pin (the name drives the query). Wrong-pin fixes go through the Plus
  Code field or the address picker, which were already the designed
  correction paths.
- A Photon miss costs one extra throttled Nominatim request per
  negative-TTL window — bounded by the cache, invisible per render.
- Two public fair-use dependencies instead of one; either being down
  degrades to the other rather than to "no pins". komoot's 2025
  acquisition makes the public instance's long-term future less certain
  than OSMF-run Nominatim — the swap door (`PHOTON_URL`) is the hedge.
- Existing negative cache rows for unchanged queries suppress retries
  until their TTL lapses; hotel/food keys change with the name-first
  flip, so the common cases re-resolve immediately.

## Alternatives considered

- **Google Places** — best matcher and the only one that fixes
  coverage, but ToS-incompatible with MapLibre rendering and permanent
  coordinate caching (see Context). Rejected outright, not deferred.
- **Photon replacing Nominatim entirely** — simpler, but discards
  Nominatim's stronger structured-address parsing as a backstop for
  name-less rows.
- **Type-routed dual pipeline** (names → Photon, addresses →
  Nominatim, no cross-fallback) — requires the query builder to emit
  kind metadata and a miss on one side never tries the other.
- **Locality-tail retry ladder on Nominatim alone** (the deferred #104
  side-idea) — helps chopped addresses, does nothing for the
  type-a-venue-name case that motivated the issue.

## When to revisit

- Photon's public instance degrades or disappears → set `PHOTON_URL`
  to a self-hosted instance.
- `geocode_cache.source` shows Nominatim recovering a meaningful share
  of Photon misses → look at what those queries have in common before
  adding anything.
- A real coverage gap emerges (places simply not in OSM) → no OSM-based
  provider fixes that; the Plus Code flow stays the answer.

## References

- Issue #104 (decision comment, 2026-07-17)
- ADR-0010 — Nominatim geocoding (amended, not superseded)
- ADR-0009 — snapshot-over-API principle (why no static answer exists here)
- Google Maps Platform Terms §3.2.3 (no non-Google-map display; caching limits)
- https://github.com/komoot/photon
