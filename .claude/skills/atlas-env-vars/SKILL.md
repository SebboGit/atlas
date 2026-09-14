---
name: atlas-env-vars
description: Use when editing Atlas `.env` or `.env.example`, configuring a new deployment, or looking up what a specific environment variable controls. Reference for DATABASE_URL, AUTH_SECRET, OIDC_*, STORAGE_*, TILES_*/PROTOMAPS_PMTILES_URL, OCR_*/PADDLEOCR_URL, OLLAMA_*, NOMINATIM_CONTACT_EMAIL/PHOTON_URL, NTFY_*, CRON_PRUNE_SCHEDULE/CRON_TZ, ATLAS_DEV_ORIGINS, NEXT_PUBLIC_ATLAS_DATE_FORMAT, and LOG_LEVEL/LOG_PRETTY.
---

# Atlas — Environment Variables

See `.env.example` for the full documented list. At minimum:

- `DATABASE_URL` — Postgres connection string
- `AUTH_SECRET` — random 32+ byte secret for Auth.js
- `AUTH_URL` — canonical app URL
- `OIDC_ISSUER_URL` — PocketID base URL (e.g. `https://id.example.com`)
- `OIDC_CLIENT_ID` — from PocketID admin UI
- `OIDC_CLIENT_SECRET` — from PocketID admin UI
- `STORAGE_DIR` — document storage root. Default `./data/documents` (project-relative — works for `pnpm dev`). docker-compose overrides to the absolute container path `/app/data/documents` and bind-mounts the host directory onto it.
- `STORAGE_MAX_BYTES` — per-upload size cap, default `20971520` (20MB)
- `STORAGE_ALLOWED_MIMES` — comma-separated MIME allowlist enforced server-side after magic-byte detection
- `TILES_DIR` — directory holding Protomaps PMTiles served by `/api/tiles` (default `./data/tiles`)
- `PROTOMAPS_PMTILES_URL` — URL the client loads the basemap from (default `/api/tiles/world.pmtiles`)
- `OCR_ENGINE` — `tesseract` (default, in-process) or `paddle` (sidecar via `PADDLEOCR_URL`)
- `PADDLEOCR_URL` — base URL of the PaddleOCR sidecar (only when `OCR_ENGINE=paddle`)
- `OLLAMA_URL` — base URL of the Ollama instance used for extraction (default `http://localhost:11434`)
- `OLLAMA_MODEL` — model tag to use (e.g. `qwen2.5:7b`)
- `NOMINATIM_CONTACT_EMAIL` — contact email sent in the geocoder `User-Agent`, both providers (required per Nominatim usage policy)
- `PHOTON_URL` — optional override for the Photon endpoint (defaults to the public https://photon.komoot.io; ADR-0018)
- `NTFY_URL` — base URL of the self-hosted ntfy server (e.g. `https://ntfy.example.com`)
- `NTFY_TOKEN` — optional access token when the ntfy server requires auth
- `CRON_PRUNE_SCHEDULE` — six-field cron expression for the nightly prune (default `0 40 3 * * *`)
- `CRON_STATUS_SCHEDULE` — cron expression for the daily trip status sweep (default `5 0 * * *`, i.e. 00:05 UTC)
- `CRON_TZ` — IANA timezone for the **prune** run window (default `UTC`). The status sweep ignores it and always runs in UTC: its day math is UTC (ADR-0016), so a non-UTC trigger would fire it in the prior UTC day and lag trip transitions by a day. An unknown zone falls back to UTC with a `worker.schedules.invalid_tz` warning.
- `ATLAS_DEV_ORIGINS` — comma-separated origins allowed for cross-origin RSC/HMR in `pnpm dev` (homelab LAN access). No effect in prod.
- `NEXT_PUBLIC_ATLAS_DATE_FORMAT` — client-side date display format (default `iso`)
- `LOG_LEVEL` — pino log level (`trace` | `debug` | `info` | `warn` | `error`), default `info`
- `LOG_PRETTY` — `true` to pretty-print logs in dev; leave `false` in prod for JSON
