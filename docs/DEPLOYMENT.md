# Deployment

Atlas is designed for single-host self-hosting on a homelab or small VM.
This document walks an operator through a complete deployment: prerequisites,
external services (PocketID, Ollama, basemap tiles), and production posture
(reverse proxy, network, backups).

> **Quick start (development only):** see the [README](../README.md). This
> guide covers production-style deployments.

---

## Prerequisites

| Component     | Minimum               | Notes                                                |
| ------------- | --------------------- | ---------------------------------------------------- |
| Host          | 4 vCPU, 8 GB RAM      | LLM extraction is the main load                      |
| Disk          | 100 GB available      | ~33 GB for the basemap, rest for docs + backups      |
| OS            | Linux x86_64 or arm64 | Tested on Debian 12 and Ubuntu 24.04                 |
| Node.js       | 24.x                  | Only required for bare-metal install                 |
| pnpm          | 9.15+                 | Bare-metal only                                      |
| Docker Engine | 24+                   | With Compose v2.24+ (the prod overlay uses `!reset`) |
| PocketID      | Latest                | OIDC provider for authentication                     |
| Ollama        | 0.3+                  | Local LLM for document extraction                    |

A reverse proxy (Caddy or Nginx) and a private network layer (Tailscale,
WireGuard, or VPN) are strongly recommended — Atlas should not be exposed
to the public internet.

---

## Initial setup

### 1. Clone and configure

```bash
git clone <repository-url> atlas
cd atlas
cp .env.example .env
```

Generate a strong session secret:

```bash
openssl rand -base64 32
```

Paste it into `.env` as `AUTH_SECRET`. The full set of environment
variables is documented inline in [`.env.example`](../.env.example).

### 2. Install dependencies (bare-metal only)

```bash
pnpm install --frozen-lockfile
```

Skip this step if you run the full Docker Compose stack.

### 3. Start the stack

```bash
# Dev / single-machine
docker compose up -d

# Production overlay (resource limits, restart policies, prod image targets)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# With scheduled database backups (recommended)
docker compose --profile backup up -d
```

The `app`, `postgres`, and `worker` services come up automatically. The
`db-backup` service is opt-in via the `backup` profile.

The `worker` applies Drizzle migrations and seeds the country reference table
automatically on boot, and the `app` waits on `worker: service_healthy`
before serving requests, so `docker compose up -d` is sufficient — there is
no separate migration or seed step. Running `pnpm db:setup` by hand is only
for bare-metal or CI installs without the worker. See [WORKER.md](./WORKER.md)
for the full boot sequence.

To populate a fresh instance with a demo trip and sample documents for
evaluation, run `docker compose exec app pnpm seed:dev`; skip it on a real
install.

---

## Minimal viable deploy

The smallest working Atlas is four pieces: **Postgres**, the **app**, the
**worker**, and **PocketID**. With those running you get a fully usable
install — create trips, add flights and hotels and activities, upload
documents, and browse the visited-countries world map at `/map`. Everything
in this section below "Initial setup" is needed for that baseline; the two
sections after it are opt-in upgrades you can add later.

Two capabilities are deliberately left out of the baseline because each
carries real setup cost, and each degrades gracefully when absent:

- **Basemap (Protomaps PMTiles)** unlocks the per-trip map at
  `/trips/[id]/map` — flight arcs and geocoded pins on a real basemap.
  Skip it and the world `/map` still works, but per-trip maps render pins
  with no map underneath. Add it when you want trip maps. See
  [Basemap setup](#basemap-setup-protomaps-pmtiles).
- **Ollama** unlocks automatic extraction — drop in a boarding pass or
  hotel confirmation and Atlas fills in the segment for you. Skip it and
  everything still works through manual entry; you just type the details
  yourself. Add it when manual entry gets tedious. See
  [Ollama setup](#ollama-setup).

---

## PocketID setup

Atlas uses [PocketID](https://github.com/stonith404/pocket-id) for
passkey-only OIDC authentication. See [ADR-0002](./adr/0002-auth-via-pocketid.md)
for the rationale.

1. Deploy PocketID on a reachable URL (typically same homelab, behind the
   same reverse proxy).
2. In the PocketID admin UI, create a new OIDC client:
   - **Name:** `atlas`
   - **Callback URL:** `${AUTH_URL}/api/auth/callback/pocket-id`
   - **Scopes:** `openid profile email groups`
   - **(Optional) Group restriction:** `atlas-users` or similar
3. Copy the generated Client ID and Client Secret into `.env`:
   ```bash
   OIDC_ISSUER_URL=https://id.your-domain.tld
   OIDC_CLIENT_ID=<from PocketID>
   OIDC_CLIENT_SECRET=<from PocketID>
   ```
4. Restart the `app` service.

> **TLS note:** if PocketID runs behind Caddy's local CA (as is typical
> for homelab setups), the Atlas container needs `NODE_EXTRA_CA_CERTS`
> pointing at the Caddy root certificate. Mount it into the container
> and set the variable in `docker-compose.prod.yml` — not `.env` — so
> Node picks it up at process start.

---

## Basemap setup (Protomaps PMTiles)

The trip-detail map renders on a self-hosted Protomaps PMTiles basemap.
See [ADR-0011](./adr/0011-protomaps-pmtiles-basemap.md) for the rationale.
The world choropleth at `/map` works without this step; only the
trip-detail basemap requires tiles.

1. Install the `pmtiles` CLI:

   ```bash
   # macOS
   brew install pmtiles
   # Linux — grab a release binary
   curl -L https://github.com/protomaps/go-pmtiles/releases/latest/download/go-pmtiles_Linux_x86_64.tar.gz | tar xz
   ```

2. Extract the worldwide basemap. The default fetches Z0–13 worldwide
   (~33 GB, ~45–90 minutes depending on bandwidth):

   ```bash
   pnpm tiles:fetch
   ```

   Smaller alternatives:

   ```bash
   # Lower zoom ceiling — about 8–10 GB
   TILES_MAX_ZOOM=12 pnpm tiles:fetch

   # Regional extract — specify a bounding box
   TILES_BBOX="-10.5,35.0,32.0,71.5" pnpm tiles:fetch    # Europe
   ```

   > **Schema:** only `build.protomaps.com` daily builds serve schema v4
   > (what the style file expects). The Source Coop S3 mirror carries
   > older schemas (v2/v3) that will render incorrectly.

3. The tile route at `/api/tiles/[...path]` serves the file from
   `TILES_DIR` (default `./data/tiles`, bind-mounted into the container
   at `/app/data/tiles` read-only).

---

## Ollama setup

Atlas runs LLM extraction against a self-hosted Ollama instance. No
content ever leaves the host. See [ADR-0006](./adr/0006-ollama-only-llm-extraction.md)
for the rationale.

On the host running Ollama (typically the same host as Atlas, or a
GPU-equipped machine on the same network):

```bash
# 1. Pull the base model
ollama pull qwen2.5:7b

# 2. Build the Atlas-tuned variant (deterministic sampling, larger
# context window, JSON-only SYSTEM prompt). The Modelfile is checked
# in for reproducibility.
ollama create atlas-extract -f docker/ollama/atlas-extract.Modelfile
```

Point Atlas at the Ollama host in `.env`:

```bash
OLLAMA_URL=http://ollama-host:11434
OLLAMA_MODEL=atlas-extract:latest
```

Falling back to bare `qwen2.5:7b` works but loses deterministic sampling
and may silently truncate longer documents. See
[`docker/ollama/README.md`](../docker/ollama/README.md) for details.

---

## Network and TLS

Atlas should run on a private network. Two common topologies:

### Tailscale (recommended)

1. Install Tailscale on the host and any client devices.
2. Bind the reverse proxy to the Tailscale interface only.
3. Use a Tailscale-issued certificate (`tailscale cert <hostname>`) or
   a wildcard cert from your own CA.

### Reverse proxy with TLS

A minimal Caddy block:

```caddy
atlas.your-domain.tld {
    reverse_proxy localhost:3000
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

Set `AUTH_URL=https://atlas.your-domain.tld` in `.env` so OIDC callbacks
resolve correctly.

**Never expose Postgres directly.** It is only reachable from inside the
Docker network on the default deployment.

---

## Backups

Two layers, both writing under `./data/backups/`:

| Layer     | Mechanism                               | Schedule        | Retention                                  |
| --------- | --------------------------------------- | --------------- | ------------------------------------------ |
| Database  | `nfrastack/container-db-backup` service | Daily 03:30 UTC | 30 days default, 90 under the prod overlay |
| Documents | `scripts/backup-documents.sh` (rsync)   | Daily 03:35 UTC | 30 days                                    |

Activate the database backup service:

```bash
docker compose --profile backup up -d
```

Add a cron entry on the host for the document snapshot:

```cron
35 3 * * *  cd /opt/atlas && ./scripts/backup-documents.sh
```

**Offsite:** rsync `./data/backups/` to your offsite target (Backblaze
B2, S3-compatible bucket, or any WebDAV/SFTP storage). A single rsync
target captures both layers.

### Restore

```bash
# Interactive restore wizard
docker compose exec -it db-backup restore

# Documents are plain files — rsync them back from the snapshot
rsync -av data/backups/documents/<timestamp>/ data/documents/
```

Test a restore from a real snapshot at least once per quarter.

---

## Deploying on Unraid

Unraid has no native Compose support, so install the **Compose Manager Plus**
plugin from Community Apps (the older "Docker Compose Manager" plugin is
deprecated — don't use it). Run Atlas as **one stack with Postgres inside
it**. Do not split Postgres into its own Unraid container: the worker is the
single migration authority and the app is gated on `worker: service_healthy`,
and pulling Postgres out of the stack breaks that health-gating — a green
Postgres container says nothing about whether migrations have run.

Order of operations:

1. **Install PocketID from Community Apps first, and create the OIDC client.**
   A running (green) PocketID container is not the same as working sign-in —
   you need the client created and its ID/secret in hand before Atlas can
   authenticate anyone. Follow [PocketID setup](#pocketid-setup) above.
2. **Install the Compose Manager Plus plugin** from Community Apps.
3. **Create the Atlas stack** and paste in both `docker-compose.yml` and
   `docker-compose.prod.yml`. Provide a real `.env` (not `.env.example`).
4. **Point the `data/` bind mounts at `/mnt/user/appdata/atlas`** (or a
   dedicated cache pool to keep the writes off the array and dodge the
   mover). This is where documents, tiles, and backups live.
5. **Set `ATLAS_IMAGE_TAG`** in `.env` to the release you want (e.g.
   `1.0.0`, or leave it `latest`), then bring the stack up:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup pull
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup up -d
   ```

A release publishes **two** images from one version, and `ATLAS_IMAGE_TAG`
drives both: the `app` pulls `ghcr.io/sebbogit/atlas:$ATLAS_IMAGE_TAG` and the
`worker` pulls the same tag suffixed `-worker`
(`ghcr.io/sebbogit/atlas:$ATLAS_IMAGE_TAG-worker`). The worker image carries the
pg-boss process — it runs migrations and the background jobs the app depends on,
so both must exist for the pull to succeed.

The GHCR images must already exist for the pull to succeed — they are published
by the release workflow when a `v*` tag is pushed, so deploy a tagged version
rather than an unbuilt one.

---

## Operations

### Health checks

- App: `GET /api/health` returns `200 OK` if the database is reachable.
- Postgres: `pg_isready` inside the container.
- Worker: `docker compose logs -f worker` should show handler and
  schedule registration at startup and successful runs each night. See
  [WORKER.md](./WORKER.md) for the full job inventory.

### Nightly maintenance

The `worker` service runs two scheduled jobs out of the box:

- `prune` at 03:40 UTC (configurable via `CRON_PRUNE_SCHEDULE`) — sweeps
  expired auth sessions, verification tokens, and stale geocode cache rows.
- `status-sweep` at 00:05 UTC (configurable via `CRON_STATUS_SCHEDULE`) —
  flips trip statuses forward through their lifecycle (`planned → active`,
  `active → completed`). Forward-only.

Both honour `CRON_TZ` (defaults to `UTC`). See [WORKER.md](./WORKER.md)
for the full picture. Manual prune:

```bash
docker compose exec worker pnpm db:prune --apply
```

### Upgrading

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The worker applies any new migrations on boot before the app starts, so no
manual `db:migrate` step is needed. Migrations are forward-only. Always take
a database backup before upgrading a production deployment.

### Logs

```bash
docker compose logs -f app
docker compose logs -f worker
docker compose logs -f postgres
```

Logs are structured JSON. `LOG_PRETTY=true` enables human-readable
output in development. Document contents, PNRs, passport numbers, and
auth tokens are redacted at the logger boundary.

---

## Troubleshooting

| Symptom                                | Likely cause                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `OAuthAccountNotLinked` on sign-in     | OIDC `sub` claim missing or provider profile mapping broken. Check logs.     |
| Trip map shows pins but no basemap     | `pnpm tiles:fetch` not run yet — see Basemap setup.                          |
| Extraction returns empty results       | Ollama unreachable or `OLLAMA_MODEL` not built on the host. Check logs.      |
| Sign-in fails with cert errors         | PocketID behind Caddy local CA — set `NODE_EXTRA_CA_CERTS` in container env. |
| Upload returns "file type not allowed" | MIME magic bytes don't match `STORAGE_ALLOWED_MIMES`.                        |

For deeper guidance see [CLAUDE.md → Architectural Guardrails](../CLAUDE.md#architectural-guardrails).
