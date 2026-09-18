# ADR-0019: Station-aware transit endpoints, route lines, and a Directions link

- **Status:** Accepted (amended 2026-09-18, see below)
- **Date:** 2026-09-13
- **Deciders:** @SebboGit
- **Amends:** ADR-0018 (transit queries: train, bus and ferry station
  names no longer go through the free-text ladder as plain names; the
  ladder, cache contract and hotel, food and activity queries stand)

## Context

A transit segment has one pin today: the first of `plusCode`, `address`,
`toName` and `fromName`, sent through the ADR-0018 ladder as a plain
name. The trip map draws no route, the Find picker only searches the To
name, and `address` and `plusCode` belong to neither end in particular.

Station names are what that ladder handles worst. Live probes against
public Photon on 2026-09-13:

- "Tokyo Station" lands near Ueno, about 3.6 km off, and "Kyoto
  Station" on a car park.
- With railway tags but the name unchanged, "Tokyo Station" returns
  Shakujii-kōen. The stripped "Tokyo" and "Kyoto" with railway tags and
  `countrycode=JP` hit the right stations.
- Tags alone still mislead. "Busta Shinjuku" with bus tags returns the
  Shinjuku-3chome bus stop.
- Stripping backfires on generic names. "Union" with railway tags in the
  US returns the station in Union, New Jersey, not a Union Station.
- A hit that merely contains the name is a different station. "Yokohama
  Station" returned Mutsu-Yokohama Station 640 km away ahead of Yokohama,
  and "Kobe Station" returned Kobe Airport. Where no hit matched exactly
  (Berlin Hbf, München Hbf, Zürich HB), the raw name through Nominatim
  landed within 0.25 km.
- "JR Kyoto Station" matches JR-prefixed neighbours, never Kyoto.
- European names such as "Berlin Hbf", "Gare de Lyon" and "Milano
  Centrale" already resolve as plain names.

Nominatim has no category filter. The pin geocoder's job payload is one
query string, so a category hint has to live in the cache key. And
`transitData` is a `.strict()` JSONB shape, so new fields need no SQL
migration.

## Decision

This ADR covers the whole feature. The data contract and geocoding ship
first, the map line second, and the form and Directions link third.

1. **Endpoint data.** `address` and `plusCode` keep meaning the
   destination; optional `fromAddress` and `fromPlusCode` hold the
   origin's. The schema stays `.strict()`. There is no shape-based
   exception for old rows: a row that only names its origin still reads
   `address` and `plusCode` as the destination, because a row can't tell
   whether it predates the origin fields. Its single-pin cache key is
   unchanged either way.
2. **Modes.** Train, bus and ferry get two endpoints and a map line. Car
   and other keep their single pin, current queries and current cache
   keys. One module defines the mode set. Transit keeps a single
   `countryCode` and no `originCountryCode`; ADR-0005 is unchanged.
3. **Station keys.** A train, bus or ferry endpoint with only a name is
   keyed `station:<mode>:<cc>:<name>`, with the segment's ISO country
   code in lower case (`-` without one) and the raw cleaned name. The
   country never comes from `locationName`. An endpoint with a Plus Code
   or address is queried by it, as today. `PlaceResolver` routes the
   prefix ahead of Plus Codes and free text and strips suffixes at
   resolve time, so strip-rule changes never re-key the cache.
4. **Resolution ladder.** Photon is queried with
   `include=osm.<key>.<value>` filters: the raw name when stripping
   changed it, then the stripped name, both within the segment's country,
   then the stripped name without a country for cross-border origins.
   Stripping removes "Station", "Stn", "Sta.", 駅, 站 and 역, plus a
   preceding rail, railway or train and a leading "JR" for trains, and
   terminal, port, pier or 港 for ferries. Trains filter on railway=station|halt|stop,
   building=train_station and public_transport=station; buses on
   amenity=bus_station, highway=bus_stop and public_transport=station;
   ferries on amenity=ferry_terminal. Two guards check every hit. A local
   osm_key/osm_value check makes an installation that ignores `include`
   return a clean miss. A name check folds accents, drops generic words
   such as station, hbf, bahnhof, terminal and JR, and requires the hit's
   remaining Latin words to equal the query's — containing them isn't
   enough. A name with no comparable Latin words (e.g. 東京駅) skips the
   tagged lookups for the raw-name fallback, since Photon answers with
   English names and a hit it can't check isn't trusted. The first exactly
   matching hit across the
   rungs wins and is cached with source `photon-station`. If every tagged
   rung misses, the raw name goes to Nominatim, then Photon. Nominatim
   goes first because unfiltered Photon is the failure above.
5. **Picker and edit dialog.** The Find picker tries the tagged rungs
   first for train, bus and ferry. The edit dialog stops saving a Plus
   Code derived from cached coordinates on transit rows: a saved code
   outranks every other field, so it froze the geocoder's pick. Codes
   already saved that way stay until the user clears the pin.
6. **Map.** Flight and transit routes share one arc source with a `kind`
   discriminator. The transit line is solid, a casing under a terracotta
   core, curved at a ratio of about 0.06 and drawn beneath the basemap
   labels, unlike the dashed flight arcs and the basemap's dashed rail.
   Each endpoint gets a pin, and pins at a shared station aren't deduped.
   A segment has at most one Not-pinned entry (pending, departure not
   found, arrival not found, or not found), and a leg with only one
   station named gets none. A leg over its mode's distance cap (train
   7,000 km, bus 5,000 km, ferry 3,000 km) draws both pins but no line
   and adds no entry. The map page has no `GeocodePoller` because a
   refresh would re-fit the camera, so lines for legacy rows appear on a
   later visit.
7. **Form.** From and To each get Find, an address and a Plus Code. An
   origin pick never sets the segment's country.
8. **Directions.** The transit card and info dialog link to a plain
   Google Maps directions URL, with no API key and no API call. Each
   endpoint is its name, else its Plus Code, else its address, and never
   cached coordinates, which would pass a wrong match on to Google. The
   travel mode is transit for train, bus and ferry, driving for car, and
   omitted for other. The link shows only when both ends exist.
   ADR-0018's ToS objection concerns Google's APIs, and a link the user
   follows to google.com uses none.

The tag lists, strip rules, generic tokens, distance caps, curve ratio
and focus zoom levels are initial values. Tuning them doesn't need a new
ADR.

> **Amended 2026-09-18 — Decision 6.** The route line gains a
> source-aware distance guard. Where both ends resolve and one of them is
> a bare station name that only the free-text fallback could place —
> `geocode_cache.source` reads `photon` or `nominatim` rather than
> `photon-station` — and it sits further from the other end than the
> mode's fallback threshold (train 2,500 km, bus 1,800 km, ferry 900 km),
> the line is withheld and the leg carries a Not-pinned entry naming the
> end that looks wrong, or both when neither is better than a guess. Both
> pins stay: a guess is often right, and a pin claims far less than a line
> does. The guard runs before the mode cap, so a leg that is both over its
> cap and built on a guess now gets an entry where Decision 6 gave it
> none. An end given an address or a Plus Code is trusted at any distance,
> as is a row whose source predates the column, and setting one is the fix
> the entry names. Decision 3 is untouched: the fallback still asks
> without a country, because forcing the destination's country onto the
> origin breaks a cross-border leg. The thresholds sit well above an
> ordinary long leg because the population they govern is wide — a name
> with no comparable Latin words never reaches the tagged rungs at all,
> and the probes above show "Berlin Hbf"-class names fall back and land
> correctly — so a false positive must cost only a line, never a pin. They
> are initial values and tuning them doesn't need a new ADR (#144). One
> consequence of keeping the pins: the Not-pinned bucket now also holds
> legs that ARE pinned, just not trusted enough to draw a line between, so
> the chip's "not on the map" wording over-claims for that class. The
> wording is left alone here — it is the established term and other work
> selects the chip by it — and a rename belongs to a later copy pass.

## Consequences

### Positive

- Station names resolve to stations: "Tokyo Station" pins Tokyo Station,
  not Ueno.
- Rail, bus and ferry legs show their route on the trip map, and both
  ends can be pinned precisely.
- Directions are one tap away without the server calling Google.
- Car, other, hotel, food and activity rows keep their exact cache keys
  and behaviour.

### Negative / tradeoffs

- Existing name-only train, bus and ferry pins re-geocode once after
  deploy, as each trip's itinerary or map is first opened. The worker is
  serial at about 1.1 s per request and a full miss costs up to four
  Photon requests and one Nominatim request, so the 60-second worker-down
  banner can flash once.
- The Find picker's worst case rises by up to three upstream requests,
  one per tagged rung.
- The name guard costs recall. "Berlin Hbf" doesn't exactly match a hit
  named "Berlin Hauptbahnhof (tief)", and a typed "München" doesn't match
  "Munich", so those endpoints fall back to the raw name, which is
  today's plain-name quality.
- Photon's `include` support varies between self-hosted installations.
  One that ignores or rejects it drops to the fallback, which costs
  requests rather than correctness.
- A wrong match in the right region still draws a confident wrong line.
- Rolling back to an image older than this change fails the `.strict()`
  parse for rows carrying `from*` fields. Only the form writes them, so
  the data contract ships in a release before the form does.
- An old worker that picks up a `station:` job sends the key text to
  Photon and caches the bad result. Stop the worker before starting a new
  image.
- The /stats north and south extremes can lose transit points until the
  affected trips' itinerary or map pages have been opened once.
- The guard is map-local. It governs the route line and the Not-pinned
  entry only; the segment info dialog's Plus Code badges, the edit form's
  located line and the stats extremes still read the raw cache row, so a
  guessed coordinate still shows there. Tracked in #164.

### Neutral

- Old plain transit cache keys are never read again. They expire through
  the TTL, and the nightly prune removes them.
- Privacy: one station name per leg already went to Photon and
  Nominatim. Now both endpoint names do, and Photon also receives a
  category filter and the segment's ISO country code. The pin lookup
  sends Nominatim only the raw name; the Find picker's ordinary search
  still sends the typed name with its location label, country and
  address, as before. The Directions link is a navigation the user starts
  in their own browser.

## Alternatives considered

- **Real track shapes from the public Transitous (MOTIS) API.** Its usage
  policy requires an open-source project, and Atlas is source-available
  under PolyForm Noncommercial, not OSI-licensed. Routing only works
  inside a timetable window of about a year, so past trips would get a
  stand-in service, and every self-hosted install would call the API.
- **Self-hosted MOTIS, OpenTripPlanner or OpenRailRouting.** Each needs
  per-country GTFS and OSM imports kept fresh. OpenRailRouting also
  routed Tokyo–Kyoto on the conventional line, not the Shinkansen.
- **Google Routes or Directions API.** The terms forbid use with a
  non-Google map and cap coordinate caching at 30 days, the conflict
  ADR-0018 rejected Places for.
- **Category options on the Find picker only.** They would never reach
  the pin geocoder, whose job payload is just a query string.
- **A tag filter without suffix stripping, or without the name guard.**
  The probes returned wrong stations for both.
- **`originCountryCode` for transit.** It ripples into visited countries,
  stats and the country chips.
- **Deduping station pins.** Pins belong to segments. Timeline hover and
  day dimming look them up by segment, so a shared pin answers for one
  leg only.
- **Two Not-pinned entries per segment.** The chip counts segments, not
  endpoints.
- **A dashed line.** It reads as a flight arc or the basemap's rail.
- **Lines for car and other.** They would imply a road route Atlas
  doesn't know.

## When to revisit

- Photon drops or changes `include` → the tagged rungs become clean
  misses; rethink the category filter.
- `geocode_cache.source` shows the fallback carrying most station keys →
  tune the strip rules or name guard before adding anything.
- Legs keep losing their line to the fallback thresholds → raise that
  mode's number, or pin the end with an address or Plus Code, which
  outranks the station lookup.
- Transitous changes its eligibility rules, or a router becomes cheap to
  self-host → real track shapes become an option.
- Transit needs cross-border country attribution → revisit the single
  `countryCode`, which means amending ADR-0005.

## References

- ADR-0005 — segment country attribution (unchanged)
- ADR-0010 — geocoding cache and etiquette (unchanged)
- ADR-0011 — Protomaps basemap (its dashed rail is why the line is solid)
- ADR-0018 — Photon-first geocoding (transit clause amended)
- https://github.com/komoot/photon (`include`, `countrycode`)
- https://developers.google.com/maps/documentation/urls/get-started
- https://transitous.org
