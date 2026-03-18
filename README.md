<p align="center">
  <h1 align="center">cronbase</h1>
  <p align="center">Beautiful self-hosted cron job manager with web dashboard</p>
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
  <a href="#docker">Docker</a> &bull;
  <a href="#example-configurations">Examples</a>
</p>

<p align="center">
  <a href="https://github.com/paperkite-hq/cronbase/actions/workflows/ci.yml"><img src="https://github.com/paperkite-hq/cronbase/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
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
- **Webhook alerting** — Slack, Discord, or any HTTP endpoint with auto-format detection

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
- Per-job alert configuration
- Non-blocking async delivery with 10s timeout

**Operations**
- YAML or JSON config files for declarative job definitions
- Docker image with health check endpoint
- Graceful shutdown on SIGINT/SIGTERM
- SQLite with WAL mode for concurrent access
- stdout/stderr capture capped at 1 MiB per execution

## Quick Start

```bash
# Install Bun if you haven't already
curl -fsSL https://bun.sh/install | bash

# Clone and start
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
bun install

# Add your first job
bun run src/cli.ts add \
  --name "hello" \
  --schedule "*/5 * * * *" \
  --command "echo Hello from cronbase!"

# Start the scheduler + web dashboard
bun run src/cli.ts start
# → Open http://localhost:7433
```

## Installation

### From source

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
bun install
```

### Docker

```bash
docker run -d \
  --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  cronbase
```

Or with Docker Compose:

```bash
curl -O https://raw.githubusercontent.com/paperkite-hq/cronbase/main/docker-compose.yml
docker compose up -d
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
cronbase start [--port 7433] [--db ./cronbase.db] [--config cronbase.yaml]
                                                    Start scheduler + web UI

cronbase add --name <name> --schedule <cron> --command <cmd> [options]
  --cwd <dir>            Working directory (default: .)
  --timeout <seconds>    Kill job after N seconds
  --retries <count>      Max retry attempts on failure (default: 0)
  --retry-delay <secs>   Base delay for exponential backoff (default: 30)
  --description <text>   Optional description
  --disabled             Create job in disabled state

cronbase list                                       List all jobs
cronbase history [--job <name>] [--limit 20]        Show execution history
cronbase run <name>                                 Manually trigger a job
cronbase remove <name>                              Remove a job
cronbase enable <name>                              Enable a disabled job
cronbase disable <name>                             Disable a job
cronbase stats                                      Show summary statistics
cronbase validate [--path cronbase.yaml]            Validate config file (no DB changes)
cronbase import [--dry-run]                         Import jobs from system crontab
cronbase export                                     Export jobs as YAML config
cronbase prune [--days 90]                          Prune old execution history
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

### Config file alert shortcuts

```yaml
jobs:
  - name: my-job
    schedule: "@hourly"
    command: ./task.sh
    on_failure: https://hooks.slack.com/...   # Alert on failure + timeout
    on_success: https://hooks.slack.com/...   # Alert on success only
    on_complete: https://hooks.slack.com/...  # Alert on every execution
```

## Docker

### Build and run

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
  cronbase start --db /data/cronbase.db --config /app/cronbase.yaml
```

### Docker Compose

```yaml
services:
  cronbase:
    build: .
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

## Comparison

| Feature | cronbase | crontab | Ofelia | dkron | healthchecks.io |
|---|---|---|---|---|---|
| Web dashboard | Yes | No | No | Yes | Yes |
| Job execution | Yes | Yes | Yes (Docker) | Yes | No (monitoring only) |
| Execution history | Yes | No | Limited | Yes | No |
| stdout/stderr capture | Yes | Via mail | Docker logs | Limited | No |
| Retry with backoff | Yes | No | No | Yes | No |
| Webhook alerts | Yes | No | Slack only | Yes | Yes |
| Config file | YAML/JSON | crontab | Docker labels | JSON | N/A |
| Dependencies | None (Bun) | None | Docker | etcd/Consul | SaaS |
| Self-hosted | Yes | Yes | Yes | Yes | Optional |

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
