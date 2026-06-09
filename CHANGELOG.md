# Changelog

All notable changes to Atlas are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SebboGit/atlas/compare/v1.1.4...HEAD
[1.1.4]: https://github.com/SebboGit/atlas/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/SebboGit/atlas/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/SebboGit/atlas/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/SebboGit/atlas/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/SebboGit/atlas/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/SebboGit/atlas/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/SebboGit/atlas/releases/tag/v1.0.0
