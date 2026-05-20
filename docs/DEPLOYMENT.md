# Deployment

Atlas is designed for single-host self-hosting on a homelab or small VM.
This document walks an operator through a complete deployment: prerequisites,
external services (PocketID, Ollama, basemap tiles), and production posture
(reverse proxy, network, backups).

> **Quick start (development only):** see the [README](../README.md). This
> guide covers production-style deployments.

---

## Prerequisites

| Component     | Minimum          | Notes                                           |
| ------------- | ---------------- | ----------------------------------------------- |
| Host          | 4 vCPU, 8 GB RAM | LLM extraction is the main load                 |
| Disk          | 100 GB available | ~33 GB for the basemap, rest for docs + backups |
| OS            | Linux x86_64     | Tested on Debian 12 and Ubuntu 24.04            |
| Node.js       | 24.x             | Only required for bare-metal install            |
| pnpm          | 9.15+            | Bare-metal only                                 |
| Docker Engine | 24+              | With Compose v2                                 |
| PocketID      | Latest           | OIDC provider for authentication                |
| Ollama        | 0.3+             | Local LLM for document extraction               |

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

# Production overlay (resource limits, healthchecks, restart policies)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# With scheduled database backups (recommended)
docker compose --profile backup up -d
```

The `app`, `postgres`, and `cron` services come up automatically. The
`db-backup` service is opt-in via the `backup` profile.

### 4. Run migrations and seed

```bash
docker compose exec app pnpm db:migrate
docker compose exec app pnpm db:seed    # optional, dev data only
```

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

| Layer     | Mechanism                               | Schedule        | Retention |
| --------- | --------------------------------------- | --------------- | --------- |
| Database  | `nfrastack/container-db-backup` service | Daily 03:30 UTC | 90 days   |
| Documents | `scripts/backup-documents.sh` (rsync)   | Daily 03:35 UTC | 30 days   |

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

## Operations

### Health checks

- App: `GET /api/health` returns `200 OK` if the database is reachable.
- Postgres: `pg_isready` inside the container.
- Cron: `docker compose logs -f cron` should show job registration at
  startup and successful runs each night.

### Nightly maintenance

The `cron` service runs a nightly prune at 03:40 UTC (configurable via
`CRON_PRUNE_SCHEDULE`) that sweeps expired auth sessions, verification
tokens, and stale geocode cache rows. See
[CLAUDE.md → Backups → Nightly DB prune](../CLAUDE.md#4-nightly-db-prune-in-stack)
for details. Manual run:

```bash
docker compose exec app pnpm db:prune --apply
```

### Upgrading

```bash
git pull
docker compose pull
docker compose up -d
docker compose exec app pnpm db:migrate
```

Migrations are forward-only. Always take a database backup before
upgrading a production deployment.

### Logs

```bash
docker compose logs -f app
docker compose logs -f cron
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
