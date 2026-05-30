# Changelog

All notable changes to Atlas are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches 1.0. Until then, breaking changes can land on `main` without
a major version bump.

## [Unreleased]

### Added

- Licensed under PolyForm Noncommercial 1.0.0 — permits use, modification,
  and redistribution for any noncommercial purpose; forbids commercial use.
- Issue templates for bug reports and feature requests.
- Dedicated deployment guide (`docs/DEPLOYMENT.md`) and development guide
  (`docs/DEVELOPMENT.md`).
- In-stack scheduler (pg-boss inside the `worker` compose service) with
  nightly DB prune.
- Click-a-pin-to-fly-camera interaction on trip-detail map.

### Changed

- README restructured around Features, Quick start, and Documentation index.
- Setup procedures (PocketID, basemap, Ollama) moved from README to
  `docs/DEPLOYMENT.md`.
- `docs/ARCHITECTURE.md` and `docs/DOMAIN_MODEL.md` are now living documents
  with last-reviewed dates rather than "stub" placeholders.

### Removed

- Stale reference to AviationStack in the stack list — was already dropped
  per ADR-0009.

### Fixed

- Segment row Dialog siblings now reconcile correctly across SSR/CSR by
  keying each sibling.
- CSP per-route override scoped correctly for `worker-src`/`img-src` on
  map routes.

[Unreleased]: https://github.com/SebboGit/atlas/commits/main
