# Changelog

All notable changes to Atlas are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SebboGit/atlas/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/SebboGit/atlas/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/SebboGit/atlas/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/SebboGit/atlas/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/SebboGit/atlas/releases/tag/v1.0.0
