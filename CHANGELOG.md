# Changelog

All notable changes to Atlas are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.1] - 2026-07-18

### Added

- **City on hotel, food, and activity cards** — cards now show which city a
  place is in ("Chiyoda · 2 nights · Garden twin"), resolved automatically
  when the place is geocoded. Your own location label still wins: when it
  already names the city, no duplicate line appears. Existing entries pick
  their city up the next time they re-geocode.
- **Find location falls back to the address** — when a property isn't in
  OpenStreetMap at all (common for small hotels), the search now retries with
  the entry's address and offers street-level matches, clearly labeled.
  Picking one fills the Plus Code but keeps your typed address, which is more
  precise than the street that matched it.

### Fixed

- **Stale pages after navigating or acting** — the installed app's offline
  cache was serving last-seen data on every in-app navigation: a segment
  created by an extraction didn't appear on its tab until a hard reload, and
  renaming a document then extracting it visibly reverted the name. Cached
  data is now used only when actually offline.
- **Garbled Vietnamese text broke place search** — text pulled from booking
  PDFs arrives with letters split apart ("Nguy ễ n" instead of "Nguyễn"),
  which silently ruined geocoding for those entries. The split letters are
  now rejoined before any search runs.

## [1.4.0] - 2026-07-18

### Added

- **Rename documents** — uploaded files often arrive with cryptic
  booking-system names. A pencil next to the document title now opens a rename
  dialog; the file itself keeps its original name (downloads are unchanged),
  and search finds a document by either its new title or the old filename.
- **Attach documents to itinerary entries by hand** — when a document couldn't
  be read automatically, it used to dangle with no link to anything. An
  entry's detail view now has a Documents section listing every file on the
  trip with an attach/detach toggle. Links made by hand are never touched by a
  later re-extraction.

### Changed

- **Finding places by name actually works** — geocoding now tries a
  name-oriented search engine (Photon) first and falls back to the previous
  one (Nominatim), and hotels and restaurants look up by their name instead of
  their address. Foreign venues that never resolved before now pin correctly.
  One consequence: editing an entry's address no longer moves its pin — use
  the Plus Code field or the address picker to correct a misplaced pin.

### Fixed

- **Broken logo in the installed app when offline** — the app's brand images
  are now stored for offline use when the app installs, so already-visited
  pages no longer show a broken-image placeholder without a connection.

## [1.3.2] - 2026-06-25

### Fixed

- **Installed-app icon kept showing the old, oversized version** — 1.3.1 resized
  the home-screen icon, but OS icon caches are keyed by URL and held onto the
  previous image, so the change never showed. The icon URLs now carry a revision
  marker, so reinstalling the app picks up the correctly-sized icon.

## [1.3.1] - 2026-06-25

### Added

- **Quick-nav on the mobile home screen** — the phone home page now shows a
  compact grid of shortcuts to Trips, Wishlist, Map, and Stats beneath the
  next-trip hero, so you can jump to a section without opening the menu. The
  laptop layout is unchanged.

### Changed

- **App icon sits as an inset glyph** — the installed-app icon's globe was
  filling the whole tile edge-to-edge; it now has a margin so it reads like a
  proper home-screen icon.
- **No bounce at the page edges in the installed app** — the PWA no longer
  rubber-bands when you scroll past the top or bottom, so it feels more native.
  A normal browser tab keeps its pull-to-refresh.

## [1.3.0] - 2026-06-25

### Added

- **Install Atlas as an app (PWA)** — Atlas now installs to your phone's home
  screen and launches full-screen, without browser chrome. On Android use
  Chrome's "Install app"; on iPhone use Safari's Share → Add to Home Screen.
  Once installed, a service worker keeps the pages you've already opened
  viewable offline, so an itinerary loaded before takeoff is still there on the
  plane. Offline is read-only — adding or editing still needs a connection — and
  the trip-map basemap isn't cached, so the trip map shows a brief offline
  notice while its flight arcs, pins, and country shapes still render. See
  ADR-0017.

## [1.2.2] - 2026-06-10

### Fixed

- **Multi-day activities no longer read "Staying"** — the quiet continuation
  row a multi-day segment shows on each day it spans now words itself by
  type: hotels keep "Staying · since …", while activities, transit, and
  flights read "Ongoing · since …" — a trek pass isn't somewhere you sleep.
  Applies to the itinerary and the trip-map timeline alike; screen readers
  hear the same phrasing.

## [1.2.1] - 2026-06-09

### Fixed

- **Itinerary skipped trip days that held no segments** — a trip with only a
  hotel check-in and a return flight showed "Day 1, Day 2" (Day 2 being the
  last day) and counted the pill from those two days. The itinerary and the
  trip-map timeline now render the trip's full calendar: every day appears,
  the day count reflects the real span, days inside a stay carry the quiet
  "Staying" row through to the check-out day, and a day with nothing
  scheduled reads "No plans". With a country filter active, days the filter
  empties are dropped while day numbers stay calendar-true.

## [1.2.0] - 2026-06-09

### Added

- **Hotel check-in and check-out times** — a hotel can now record optional
  check-in and check-out times. The check-in shows on the segment card; the
  check-out shows on the stay's final day, on the "Staying" continuation row in
  the itinerary and the map timeline. The times are display-only — they never
  change how a hotel is ordered, which still follows its check-in date.

### Changed

- **Floating local time for flights** — flight times now follow the same
  floating-local model as every other segment: stored and shown exactly as the
  boarding pass prints them, with the origin/destination airport supplying only
  a zone label (e.g. `06:00 JST`) rather than converting the clock. This
  collapses the previous flight-vs-everything-else time split into one model and
  keeps morning departures from positive-offset airports — a 06:00 Tokyo flight,
  say — on the correct itinerary day. See ADR-0016.

### Fixed

- **Flight times from boarding passes read an hour or two off** — an extracted
  local departure double-counted the airport's UTC offset, so an 18:05 CEST
  departure displayed as 20:05. Flight times now store and show the printed wall
  clock verbatim. Existing skewed times correct themselves when you re-extract
  the document.
- **A same-day hotel check-in could sort before the flight that got you there** —
  within a single day a hotel check-in now never appears earlier than the last
  flight to land that day.
- **The itinerary and the trip-map timeline could disagree on "today"** — near
  midnight in a non-UTC timezone the two views could classify a different day as
  today, and so collapse the past differently. They now read the same clock.
- **Extraction reported "Ollama not configured" on a working setup** — the app
  checks that Ollama is reachable before handing extraction to the worker, but
  only the worker had the connection settings. The app now reads them too, so
  extraction runs instead of refusing.
- **The background worker logged a spurious missing-basemap warning** on every
  boot even when the map rendered fine. The worker never serves map tiles — that
  is the app's job — so the misplaced check was removed.

## [1.1.4] - 2026-06-09

### Fixed

- **Uploading documents larger than 1 MB** — uploads failed with a generic
  "Something went wrong." Server Actions cap their request body at 1 MB by
  default, well below the 20 MB storage limit, so most boarding-pass and hotel
  PDFs were rejected before they ever reached storage. The cap now tracks the
  storage limit.
- **Undated notes and transit were invisible** — a note or transit segment
  saved without a date appeared nowhere: no tab lists those types, and the
  itinerary showed only dated segments. They now surface in an "Undated"
  section on the itinerary.

## [1.1.3] - 2026-06-08

### Fixed

- **Adding documents and segments in production** — uploading a document or
  adding any segment failed with a generic "Something went wrong." The PDF
  parser was being loaded into the web app process, where it crashed on a
  browser API that doesn't exist on the server. It now loads only in the
  background worker, where extraction actually runs.

## [1.1.2] - 2026-06-07

### Fixed

- **Itinerary continuation rows** — a multi-day stay shows a "Staying since" row
  on each day it spans. Tapping one a second time — or after collapsing the past
  — now re-runs the jump and highlight to the original segment instead of doing
  nothing.
- **Review banner on segment cards** — the edit and delete buttons on a segment
  flagged for review no longer spill past the banner's lower edge.
- **Segment type picker** — in the Add and Edit segment dialog, the row of type
  buttons is laid out as an even grid: the first button's border is no longer
  clipped, and the sixth no longer dangles on its own line.

## [1.1.1] - 2026-06-04

### Fixed

- **Mobile dialogs on iOS** — the Add/Edit trip dialog (and other forms with
  native date or dropdown controls) no longer scrolled sideways on iPhone.
  iOS Safari sizes those native controls to a minimum width that ignored the
  field's box, pushing the form past the dialog edge; Android was unaffected.

## [1.1.0] - 2026-06-03

### Added

- **Trip visibility** — every trip is now either _household_ (shared with
  everyone, the default) or _private_ (visible only to its creator). A private
  trip is hidden from other members everywhere — trip lists, search, maps, and
  stats — and returns nothing on a direct link. Household members can still add
  and edit a shared trip's segments; editing the trip itself and uploading its
  documents stay with the creator. See ADR-0015.

### Changed

- **Field-notebook redesign** — a full visual and interaction overhaul. A warm
  sand-and-cream palette, serif display type, and monospace labels give the app
  a calm, field-notebook character in place of the generic dashboard look.
- **Floating local time for segment times** — hotel, activity, transit, food,
  and note times are stored and shown exactly as typed, independent of the
  viewer's timezone, so a 3 PM check-in always reads 3 PM. Flights keep their
  airport-local times, and "today" and countdowns stay relative to the viewer.
  See ADR-0014.
- **Itinerary activities** — the activities tab is flattened into one
  chronological list. Undated activities and food now simply read as undated
  instead of sitting in a separate per-trip "wishlist" state, and food can be
  rescheduled like any other segment. The household Wishlist feature is
  unchanged.

### Fixed

- **Timezone rendering** — segment times and trip date ranges no longer drift or
  trigger server/client hydration mismatches across timezones.
- **Dev sign-in behind a reverse proxy** — the development sign-in flow now
  works correctly when served over HTTPS through a reverse proxy.

## [1.0.1] - 2026-06-01

### Fixed

- **Container healthcheck** — the production app image reported `unhealthy` in
  `docker ps` and dashboards despite serving requests normally. The baked
  healthcheck shelled out to `curl`, which the slim production image doesn't
  ship; it now uses Node's built-in `fetch`. No functional impact — the app
  served correctly throughout — but container status now reflects reality.

## [1.0.0] - 2026-05-31

First stable release. From this version on, Atlas follows Semantic Versioning.

### Added

- **Trips** — itineraries that group flight, hotel, activity, transit, food, and
  note segments, with per-trip visited-country tracking and automatic status
  transitions (upcoming → active → past).
- **Documents** — boarding passes, reservations, and tickets stored as immutable
  originals, with separately held, re-derivable parsed data and review states.
- **Extraction** — a layered pdf-text → OCR → local-LLM (Ollama) pipeline that
  structures travel documents on your own hardware, including multi-leg
  itineraries and Apple Wallet passes. No document content leaves the host.
- **Maps** — a visited-countries world choropleth and a per-trip map with flight
  arcs and Nominatim-geocoded pins for hotels, activities, transit, and food,
  rendered on a self-hosted Protomaps basemap with no third-party tile origins.
- **Search** — a Cmd+K command palette over trips, segments, and documents,
  backed by Postgres full-text search and trigram matching.
- **Stats** — a dashboard of lifetime totals, year-over-year comparisons, and
  personal travel records.
- **Wishlist** — a reusable, household-shared list of food and activity ideas,
  materialised onto trips during planning.
- **Authentication** — passwordless PocketID (passkey OIDC) sign-in with
  database-backed sessions and just-in-time user creation.
- **Background work** — an in-stack pg-boss scheduler (the `worker` service) for
  scheduled and ad-hoc jobs, including nightly database pruning. Scheduled,
  retention-managed database backups run as a separate container.
- **Deployment** — multi-arch (amd64/arm64) images published to GHCR on each
  release, a hardened production compose overlay, and dedicated deployment and
  development guides.

[Unreleased]: https://github.com/SebboGit/atlas/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/SebboGit/atlas/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/SebboGit/atlas/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/SebboGit/atlas/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/SebboGit/atlas/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/SebboGit/atlas/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/SebboGit/atlas/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/SebboGit/atlas/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/SebboGit/atlas/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/SebboGit/atlas/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/SebboGit/atlas/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/SebboGit/atlas/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/SebboGit/atlas/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/SebboGit/atlas/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/SebboGit/atlas/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/SebboGit/atlas/releases/tag/v1.0.0
