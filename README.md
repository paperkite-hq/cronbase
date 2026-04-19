<p align="center">
  <img src="docs/public/logo.png" width="96" height="96" alt="cronbase logo" />
  <h1 align="center">cronbase</h1>
  <p align="center">Open-source self-hosted cron job manager with web dashboard</p>
</p>

<p align="center">
  <a href="https://paperkite-hq.github.io/cronbase/">Documentation</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#cli-reference">CLI</a> &bull;
  <a href="#api-reference">API</a> &bull;
  <a href="#alerting">Alerting</a> &bull;
  <a href="#monitoring">Monitoring</a> &bull;
  <a href="#docker">Docker</a> &bull;
  <a href="#security">Security</a> &bull;
  <a href="#example-configurations">Examples</a> &bull;
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/paperkite-hq/cronbase/releases/latest"><img src="https://img.shields.io/github/v/release/paperkite-hq/cronbase" alt="Latest Release"></a>
  <a href="https://github.com/paperkite-hq/cronbase/actions/workflows/ci.yml"><img src="https://github.com/paperkite-hq/cronbase/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/endpoint?url=https://paperkite-hq.github.io/cronbase/coverage.json" alt="Coverage">
  <a href="https://github.com/paperkite-hq/cronbase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Powered by Bun"></a>
</p>

---

Replace `crontab -e` with a modern web dashboard for defining, executing, and monitoring scheduled tasks. Think **"Uptime Kuma for cron jobs"** — but cronbase actually *runs* your jobs too.

<p align="center">
  <img alt="cronbase demo" src="docs/public/demo.svg" width="750">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/screenshots/dashboard-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/public/screenshots/dashboard-light.png">
    <img alt="cronbase dashboard" src="docs/public/screenshots/dashboard-dark.png" width="700">
  </picture>
</p>

<p align="center">
  <em>Animated terminal demo &bull; Dark and light themes &bull; Real-time job status &bull; Execution history</em>
</p>

<details>
<summary>More screenshots</summary>

**Execution History** — filter by job, see status, duration, exit codes, and output:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/screenshots/history-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/public/screenshots/history-light.png">
    <img alt="cronbase execution history" src="docs/public/screenshots/history-dark.png" width="700">
  </picture>
</p>

</details>

- **Zero dependencies** — single binary, SQLite storage, embedded web UI
- **Built on Bun** — fast startup, low memory, TypeScript-native
- **Battle-tested cron parser** — 5-field expressions, presets (`@daily`, `@hourly`), month/day names
- **Full observability** — execution history, stdout/stderr capture, duration tracking
- **Webhook + email alerting** — Slack, Discord, any HTTP endpoint, or SMTP email — no external dependencies
- **Prometheus metrics** — `/metrics` endpoint for Grafana, AlertManager, and any Prometheus-compatible stack

## Features

**Job Management**
- Create, list, enable/disable, and remove jobs via CLI or REST API
- Per-job timeouts with graceful SIGTERM → SIGKILL escalation
- Automatic retry with exponential backoff
- Working directory and environment variables per job
- Tags and descriptions for organization

**Web Dashboard**
- Real-time job status with auto-refresh
- Execution history with stdout/stderr viewer
- Create, edit, and trigger jobs from the UI
- Dark/light theme (persisted)
- Statistics: success rate, total executions, enabled count

**Alerting**
- Webhook notifications on success, failure, or timeout
- Auto-detects Slack and Discord URLs — sends rich formatted messages
- SMTP email alerts — built-in SMTP client, no external dependencies
- Per-job alert configuration (webhooks, email, or both)
- Non-blocking async delivery with 10s timeout

**Monitoring**
- Prometheus-compatible `/metrics` endpoint — scrape with Prometheus, graph in Grafana
- Job counts, execution counters, duration summaries, scheduler state, database size
- Unauthenticated (safe for monitoring scrapers alongside `/health`)

**Operations**
- Global pause/resume for maintenance windows (with optional auto-resume timer)
- YAML or JSON config files for declarative job definitions
- Docker image with health check endpoint
- Graceful shutdown on SIGINT/SIGTERM
- SQLite with WAL mode for concurrent access
- stdout/stderr capture capped at 1 MiB per execution

## Quick Start

**With Docker** (no prerequisites):

```bash
docker run -d \
  --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  ghcr.io/paperkite-hq/cronbase start --demo
```

Open **http://localhost:7433** — the dashboard is live with 3 sample jobs pre-loaded.

Add your first job:

```bash
docker exec cronbase cronbase add \
  --name "hello" \
  --schedule "*/5 * * * *" \
  --command "echo Hello from cronbase!"
```

Or use Docker Compose for a persistent setup:

```bash
curl -O https://raw.githubusercontent.com/paperkite-hq/cronbase/main/docker-compose.yml
docker compose up -d
```

**With Bun** (from source):

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase && bun install

cronbase add --name "hello" --schedule "*/5 * * * *" --command "echo Hello!"
cronbase start   # → http://localhost:7433
```

## Installation

### Docker

```bash
docker run -d \
  --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  ghcr.io/paperkite-hq/cronbase
```

Or with Docker Compose:

```bash
curl -O https://raw.githubusercontent.com/paperkite-hq/cronbase/main/docker-compose.yml
docker compose up -d
```

### From source

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
bun install
```

## Configuration

### Config file

Define jobs declaratively in YAML or JSON. Jobs are synced on startup — existing jobs (matched by name) are updated, new ones are created.

```yaml
# cronbase.yaml
jobs:
  - name: backup-db
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db-$(date +%Y%m%d).sql
    timeout: 300
    retry:
      maxAttempts: 2
      baseDelay: 60
    description: Nightly database backup
    on_failure: https://hooks.slack.com/services/T.../B.../xxx

  - name: cleanup-logs
    schedule: "@daily"
    command: find /var/log -name '*.gz' -mtime +30 -delete
    description: Remove old compressed logs

  - name: health-check
    schedule: "*/5 * * * *"
    command: curl -sf https://myapp.com/health || exit 1
    timeout: 30
    retry:
      maxAttempts: 1
    on_failure: https://discord.com/api/webhooks/xxx/yyy

  - name: sync-data
    schedule: "0 */6 * * *"
    command: rsync -az /data/ backup-server:/backups/data/
    timeout: 3600
    description: Sync data to backup server every 6 hours

  - name: cert-check
    schedule: "0 9 * * 1"
    command: |
      openssl s_client -connect myapp.com:443 -servername myapp.com </dev/null 2>/dev/null | \
      openssl x509 -noout -dates
    description: Weekly TLS certificate expiry check
```

Validate before starting:

```bash
cronbase validate --path cronbase.yaml   # check for errors without touching the DB
cronbase start --config cronbase.yaml    # load on startup
```

### Environment variable

| Variable | Default | Description |
|---|---|---|
| `CRONBASE_DB` | `./cronbase.db` | SQLite database path |
| `CRONBASE_API_TOKEN` | *(none)* | Bearer token for API and dashboard authentication ([details](#security)) |
| `CRONBASE_TIMEZONE` | *(UTC)* | IANA timezone for schedule interpretation (e.g. `America/New_York`, `Europe/London`). Cron fields are treated as wall-clock time in this timezone. |
| `CRONBASE_SMTP_HOST` | *(none)* | SMTP server hostname (required to enable email alerts) |
| `CRONBASE_SMTP_PORT` | `587` | SMTP server port |
| `CRONBASE_SMTP_SECURE` | `false` | Set to `true` for TLS/SMTPS on connect (port 465) |
| `CRONBASE_SMTP_FROM` | `cronbase@localhost` | Sender address for alert emails |
| `CRONBASE_SMTP_USERNAME` | *(none)* | SMTP AUTH username (optional) |
| `CRONBASE_SMTP_PASSWORD` | *(none)* | SMTP AUTH password (optional) |

### Cron expressions

Standard 5-field cron format plus presets:

| Field | Range | Special |
|---|---|---|
| Minute | 0-59 | `*`, `,`, `-`, `/` |
| Hour | 0-23 | `*`, `,`, `-`, `/` |
| Day of month | 1-31 | `*`, `,`, `-`, `/` |
| Month | 1-12 | `*`, `,`, `-`, `/`, names (jan-dec) |
| Day of week | 0-7 | `*`, `,`, `-`, `/`, names (sun-sat). 0 and 7 both mean Sunday |

**Presets**: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`

**Examples**:
- `*/15 * * * *` — every 15 minutes
- `0 2 * * *` — daily at 2:00 AM
- `0 9 * * mon-fri` — weekdays at 9:00 AM
- `0 0 1 * *` — first of every month at midnight
- `@hourly` — top of every hour

## CLI Reference

```
cronbase start [--port 7433] [--db ./cronbase.db] [--config cronbase.yaml] [--demo]
                                                    Start scheduler + web UI
  --demo                 Pre-load 3 sample jobs on first launch (empty DB only)

cronbase add --name <name> --schedule <cron> --command <cmd> [options]
  --cwd <dir>            Working directory (default: .)
  --timeout <seconds>    Kill job after N seconds
  --retries <count>      Max retry attempts on failure (default: 0)
  --retry-delay <secs>   Base delay for exponential backoff (default: 30)
  --description <text>   Optional description
  --disabled             Create job in disabled state

cronbase list                                       List all jobs
cronbase edit <name> [options]                      Update an existing job
cronbase history [--job <name>] [--limit 20]        Show execution history
cronbase logs <name> [--limit 1]                    Show output from recent executions
cronbase run <name>                                 Manually trigger a job
cronbase remove <name>                              Remove a job
cronbase enable <name>                              Enable a disabled job
cronbase disable <name>                             Disable a job
cronbase stats                                      Show summary statistics
cronbase pause [--until <datetime>]                  Pause all scheduled execution
cronbase resume                                     Resume scheduled execution
cronbase validate [--path cronbase.yaml]            Validate config file (no DB changes)
cronbase doctor [--config cronbase.yaml]            Check runtime environment and config
cronbase import [--dry-run]                         Import jobs from system crontab
cronbase export                                     Export jobs as YAML config
cronbase prune [--days 90]                          Prune old execution history

Global flags:
  --json                 Output in JSON format (list, history, stats, run, export)
```

<details>
<summary>CLI output examples</summary>

**Adding a job:**
```
$ cronbase add --name "backup-db" --schedule "0 2 * * *" \
    --command "pg_dump mydb > /backups/db.sql" --timeout 300 --retries 2
✓ Job added: backup-db
  Schedule: 0 2 * * * (At 02:00)
  Command:  pg_dump mydb > /backups/db.sql
  Next run: 3/19/2026, 7:00:00 PM
```

**Listing jobs:**
```
$ cronbase list
Name                      Schedule             Status     Last Run               Next Run
────────────────────────────────────────────────────────────────────────────────────────────────────
backup-db                 0 2 * * *            — never    —                      3/19/2026, 7:00:00 PM
cleanup-logs              @daily               — never    —                      3/19/2026, 5:00:00 PM
health-check              */5 * * * *          — never    —                      3/18/2026, 10:55:00 PM

3 job(s)
```

**Inspecting a job:**
```
$ cronbase show backup-db
Job: backup-db
Description: Nightly database backup
Enabled: yes

Schedule: 0 2 * * * (At 02:00)
Command: pg_dump mydb > /backups/db.sql
Working dir: .

Next run: 3/20/2026, 2:00:00 AM
Last run: 3/19/2026, 2:00:05 AM
Last status: ✗ failed

Timeout: 300s
Retries: 2 (delay: 60s)

Created: 3/15/2026, 9:30:00 AM
```

**Running a job manually:**
```
$ cronbase run health-check
Running: health-check (curl -sf https://myapp.com/health)
✓ success (127ms, exit 0)
```

**Viewing execution history:**
```
$ cronbase history --limit 5
Job                  Status     Duration   Exit   Attempt  Started
──────────────────────────────────────────────────────────────────────────────────────────
health-check         ✓ success  127ms      0      0        3/18/2026, 10:53:42 PM
```

**Viewing job output:**
```
$ cronbase logs backup-db
✗ failed (5.2s, exit 1) at 3/19/2026, 2:00:05 AM

--- stdout ---
pg_dump: dumping database "mydb"...

--- stderr ---
pg_dump: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory
```

**Statistics:**
```
$ cronbase stats
Jobs:      3 total, 3 enabled
Last 24h:  1 successes, 0 failures
Success:   100%
```

**Exporting jobs:**
```
$ cronbase export
jobs:
  - name: backup-db
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db.sql
    timeout: 300
    retry:
      maxAttempts: 2
      baseDelay: 60
  - name: cleanup-logs
    schedule: "@daily"
    command: find /var/log -name '*.gz' -mtime +30 -delete
  - name: health-check
    schedule: "*/5 * * * *"
    command: curl -sf https://myapp.com/health
    timeout: 30
```

</details>

### Migrating from crontab

```bash
# Preview what would be imported
cronbase import --dry-run

# Import all crontab entries
cronbase import
```

cronbase reads your system crontab (`crontab -l`), generates job names from commands, and adds them to the database. Existing jobs (by name) are skipped.

### Backup & restore

Export all jobs as a YAML config file, then reload on another machine:

```bash
# Export current jobs
cronbase export > cronbase.yaml

# Restore on another machine
cronbase start --config cronbase.yaml
```

The exported YAML includes schedules, timeouts, retries, environment variables, tags, and alert webhook configuration — everything needed to fully reconstruct your setup.

## API Reference

The web dashboard and REST API are served on the same port (default `7433`).

### Health

```
GET /health
```

Returns scheduler status, job counts, and database size.

### Metrics

```
GET /metrics
```

Prometheus exposition format. Returns job counts, execution counters, duration summaries, scheduler state, and database size. Unauthenticated — safe for Prometheus scrapers.

Example output:

```
# HELP cronbase_info cronbase version information.
# TYPE cronbase_info gauge
cronbase_info{version="0.4.0"} 1

# HELP cronbase_jobs_total Number of configured jobs by status.
# TYPE cronbase_jobs_total gauge
cronbase_jobs_total{status="enabled"} 12
cronbase_jobs_total{status="disabled"} 3

# HELP cronbase_executions_total Total number of job executions by status.
# TYPE cronbase_executions_total counter
cronbase_executions_total{status="success"} 4521
cronbase_executions_total{status="failed"} 23
cronbase_executions_total{status="timeout"} 2
cronbase_executions_total{status="skipped"} 0

# HELP cronbase_scheduler_paused Whether the scheduler is paused (1 = paused, 0 = running).
# TYPE cronbase_scheduler_paused gauge
cronbase_scheduler_paused 0

# HELP cronbase_db_size_bytes Size of the SQLite database file in bytes.
# TYPE cronbase_db_size_bytes gauge
cronbase_db_size_bytes 245760
```

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: cronbase
    static_configs:
      - targets: ["localhost:7433"]
```

### Jobs

```
GET    /api/jobs              List all jobs
POST   /api/jobs              Create a job
GET    /api/jobs/:id          Get job details
PUT    /api/jobs/:id          Update a job
DELETE /api/jobs/:id          Delete a job
PATCH  /api/jobs/:id/toggle   Enable/disable a job
POST   /api/jobs/:id/run      Trigger immediate execution
```

### Alerts

```
GET    /api/jobs/:id/alerts   Get alert configuration
PUT    /api/jobs/:id/alerts   Set alert configuration
DELETE /api/jobs/:id/alerts   Remove alert configuration
```

### Executions

```
GET /api/executions           List execution history (?jobId=N&limit=20)
GET /api/executions/:id       Get execution detail (with stdout/stderr)
```

### Scheduler

```
GET  /api/scheduler/status    Check if the scheduler is paused
POST /api/scheduler/pause     Pause all scheduled execution (body: {"until": "ISO8601"})
POST /api/scheduler/resume    Resume scheduled execution
```

### Utilities

```
GET /api/stats                Summary statistics (job counts, 24h success/failure)
GET /api/cron/describe?expr=  Validate and describe a cron expression
```

## Alerting

cronbase sends webhook notifications when jobs complete. It auto-detects the webhook platform from the URL and formats messages accordingly.

### Slack

Uses Block Kit formatting with color-coded attachments:

```yaml
on_failure: https://hooks.slack.com/services/T.../B.../xxx
```

### Discord

Uses rich embeds with color and fields:

```yaml
on_failure: https://discord.com/api/webhooks/xxx/yyy
```

### Generic webhook

Any other URL receives the raw JSON payload:

```json
{
  "event": "failed",
  "job": { "id": 1, "name": "backup-db", "schedule": "0 2 * * *", "command": "..." },
  "execution": {
    "id": 42,
    "status": "failed",
    "exitCode": 1,
    "durationMs": 5230,
    "startedAt": "2025-01-15T02:00:00.000Z",
    "finishedAt": "2025-01-15T02:00:05.230Z",
    "stdoutTail": "...",
    "stderrTail": "pg_dump: error: connection refused",
    "attempt": 2
  },
  "timestamp": "2025-01-15T02:00:05.235Z"
}
```

### Email (SMTP)

cronbase includes a built-in SMTP client — no external mail libraries needed. Set the SMTP environment variables and add email recipients to your config:

```bash
export CRONBASE_SMTP_HOST="smtp.gmail.com"
export CRONBASE_SMTP_PORT=465
export CRONBASE_SMTP_SECURE=true
export CRONBASE_SMTP_FROM="alerts@example.com"
export CRONBASE_SMTP_USERNAME="alerts@example.com"
export CRONBASE_SMTP_PASSWORD="app-password-here"

cronbase start --config cronbase.yaml
```

```yaml
jobs:
  - name: backup-db
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db.sql
    on_failure_email: ops@example.com
    on_complete_email: ops@example.com, oncall@example.com
```

Emails include the job name, schedule, duration, exit code, and the last 500 characters of stderr/stdout.

### Config file alert shortcuts

Webhooks:

```yaml
jobs:
  - name: my-job
    schedule: "@hourly"
    command: ./task.sh
    on_failure: https://hooks.slack.com/...   # Alert on failure + timeout
    on_success: https://hooks.slack.com/...   # Alert on success only
    on_complete: https://hooks.slack.com/...  # Alert on every execution
```

Email:

```yaml
jobs:
  - name: my-job
    schedule: "@hourly"
    command: ./task.sh
    on_failure_email: ops@example.com          # Email on failure + timeout
    on_success_email: ops@example.com          # Email on success only
    on_complete_email: ops@example.com         # Email on every execution
```

You can combine webhooks and email on the same job — both fire independently.

## Monitoring

cronbase exposes a Prometheus-compatible `/metrics` endpoint for integration with Grafana, AlertManager, and any Prometheus-compatible monitoring stack.

```bash
curl http://localhost:7433/metrics
```

The endpoint is **unauthenticated** (like `/health`) — safe for Prometheus scrapers even when `CRONBASE_API_TOKEN` is set.

**Exposed metrics:**

| Metric | Type | Description |
|---|---|---|
| `cronbase_info` | gauge | Always 1, carries `version` label |
| `cronbase_jobs_total` | gauge | Job count by status (enabled/disabled) |
| `cronbase_executions_total` | counter | Cumulative executions by status (success/failed/timeout/skipped) |
| `cronbase_execution_duration_seconds` | summary | Duration count and sum for recent executions |
| `cronbase_scheduler_paused` | gauge | 1 if paused, 0 if running |
| `cronbase_db_size_bytes` | gauge | SQLite database file size |

**Prometheus scrape config:**

```yaml
scrape_configs:
  - job_name: cronbase
    static_configs:
      - targets: ["localhost:7433"]
```

## Docker

### Pre-built image

```bash
docker run -d --name cronbase -p 7433:7433 -v cronbase-data:/data ghcr.io/paperkite-hq/cronbase
```

### Build from source

```bash
docker build -t cronbase .
docker run -d --name cronbase -p 7433:7433 -v cronbase-data:/data cronbase
```

### With config file

```bash
docker run -d --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  -v ./cronbase.yaml:/app/cronbase.yaml \
  ghcr.io/paperkite-hq/cronbase start --db /data/cronbase.db --config /app/cronbase.yaml
```

### Docker Compose

```yaml
services:
  cronbase:
    image: ghcr.io/paperkite-hq/cronbase
    ports:
      - "7433:7433"
    volumes:
      - cronbase-data:/data
      - ./cronbase.yaml:/app/cronbase.yaml
    command: ["start", "--db", "/data/cronbase.db", "--config", "/app/cronbase.yaml"]
    restart: unless-stopped

volumes:
  cronbase-data:
```

### Health check

The Docker image includes a built-in health check against `/health`. You can also use it externally:

```bash
curl http://localhost:7433/health
```

## Security

cronbase supports token-based authentication for both the API and web dashboard via the `CRONBASE_API_TOKEN` environment variable.

### Setting up authentication

Set the `CRONBASE_API_TOKEN` environment variable before starting cronbase:

```bash
export CRONBASE_API_TOKEN="your-secret-token"
cronbase start
```

With Docker:

```bash
docker run -d --name cronbase \
  -p 7433:7433 \
  -e CRONBASE_API_TOKEN="your-secret-token" \
  -v cronbase-data:/data \
  ghcr.io/paperkite-hq/cronbase
```

When a token is configured:

- **API routes** (`/api/*`) require a `Bearer` token in the `Authorization` header:
  ```bash
  curl -H "Authorization: Bearer your-secret-token" http://localhost:7433/api/jobs
  ```
- **Dashboard** access requires a `?token=` query parameter:
  ```
  http://localhost:7433/?token=your-secret-token
  ```
- **`/health`** remains unauthenticated — safe for Docker health checks and external monitoring.
- **CORS** — when authentication is enabled, the wildcard `Access-Control-Allow-Origin: *` header is omitted to prevent cross-origin exploitation. CORS preflight (`OPTIONS`) requests are always allowed.

### Non-localhost warning

If you bind cronbase to a non-localhost address (e.g., `--host 0.0.0.0`) without setting `CRONBASE_API_TOKEN`, cronbase will log a warning:

> WARNING: No API token set and server is network-accessible. Set CRONBASE_API_TOKEN or bind to 127.0.0.1 to prevent unauthorized access.

### Best practices

- **Always set `CRONBASE_API_TOKEN`** when exposing cronbase beyond localhost.
- **Use a reverse proxy** (nginx, Caddy, Traefik) with TLS termination in front of cronbase for production deployments.
- **Generate strong tokens** — e.g., `openssl rand -hex 32`.
- Token comparison uses constant-time algorithms to prevent timing attacks.

## Comparison

| Feature | cronbase | crontab | Supercronic | Ofelia | dkron | healthchecks.io |
|---|---|---|---|---|---|---|
| Web dashboard | Yes | No | No | No | Yes | Yes |
| Job execution | Yes | Yes | Yes | Yes (Docker) | Yes | No (monitoring only) |
| Execution history | Yes | No | No | Limited | Yes | No |
| stdout/stderr capture | Yes | Via mail | stdout/stderr | Docker logs | Limited | No |
| Retry with backoff | Yes | No | No | No | Yes | No |
| Webhook + email alerts | Yes | No | No | Slack only | Yes | Yes |
| Prometheus metrics | Yes | No | No | No | Yes | No |
| Config file | YAML/JSON | crontab | crontab | Docker labels | JSON | N/A |
| Dependencies | None (Bun) | None | None (Go binary) | Docker | etcd/Consul | SaaS |
| Self-hosted | Yes | Yes | Yes | Yes | Yes | Optional |

## Programmatic API

Use cronbase as a library in your TypeScript/Bun projects:

```typescript
import { Scheduler, Store } from "cronbase";

const scheduler = new Scheduler({ dbPath: "./my-jobs.db", port: 7433 });

scheduler.getStore().addJob({
  name: "backup",
  schedule: "@daily",
  command: "pg_dump mydb > /backups/$(date +%Y%m%d).sql",
  timeout: 300,
  retry: { maxAttempts: 2, baseDelay: 60 },
});

scheduler.start();
```

## Example Configurations

The `examples/` directory contains ready-to-use YAML configurations for common use cases. Copy and adapt them for your needs:

| File | Description |
|---|---|
| [`database-backup.yaml`](examples/database-backup.yaml) | PostgreSQL + MySQL backups with cleanup of old files |
| [`health-checks.yaml`](examples/health-checks.yaml) | Monitor web apps, APIs, databases, Redis, and SSL expiry |
| [`log-rotation.yaml`](examples/log-rotation.yaml) | Compress, archive, and rotate log files |
| [`data-sync.yaml`](examples/data-sync.yaml) | Rsync-based data synchronization |
| [`maintenance.yaml`](examples/maintenance.yaml) | Temp file cleanup, cache warming, disk usage alerts |

Use `cronbase start --config examples/health-checks.yaml` to try one immediately.

For full documentation including guides, API reference, and more examples, see the **[cronbase docs](https://paperkite-hq.github.io/cronbase/)**.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[AGPL-3.0](LICENSE)
