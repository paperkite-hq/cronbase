# Configuration

cronbase can be configured via CLI flags, environment variables, or YAML/JSON config files.

## Config file

Define jobs declaratively in a YAML or JSON file. Jobs are synced on startup — existing jobs (matched by name) are updated, new ones are created.

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
    tags: [database, backup]
    on_failure: https://hooks.slack.com/services/T.../B.../xxx

  - name: cleanup-logs
    schedule: "@daily"
    command: find /var/log -name '*.gz' -mtime +30 -delete
```

Load it on startup:

```bash
cronbase start --config cronbase.yaml
```

### Job properties

| Property | Required | Default | Description |
|---|---|---|---|
| `name` | Yes | — | Unique job identifier |
| `schedule` | Yes | — | Cron expression or preset |
| `command` | Yes | — | Shell command to execute |
| `cwd` | No | `.` | Working directory |
| `env` | No | — | Environment variables (key-value map) |
| `timeout` | No | No limit | Kill after N seconds |
| `retry` | No | — | Retry config object (see [Retry](#retry)) |
| `retry.maxAttempts` | No | `0` | Max retry attempts on failure |
| `retry.baseDelay` | No | `30` | Base delay (seconds) for exponential backoff |
| `description` | No | — | Human-readable description |
| `tags` | No | `[]` | Tags for organization |
| `enabled` | No | `true` | Whether the job runs on schedule |
| `on_failure` | No | — | Webhook URL for failure + timeout events |
| `on_success` | No | — | Webhook URL for success events |
| `on_complete` | No | — | Webhook URL for all events |

### Environment variables in jobs

```yaml
jobs:
  - name: deploy
    schedule: "0 6 * * *"
    command: ./deploy.sh
    env:
      NODE_ENV: production
      AWS_REGION: us-west-2
      DEPLOY_TARGET: staging
```

### Tags

Tags can be specified inline or as a list:

```yaml
# Inline
tags: [backup, database, critical]

# List
tags:
  - backup
  - database
  - critical
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CRONBASE_DB` | `./cronbase.db` | Path to the SQLite database file |
| `CRONBASE_API_TOKEN` | _(none)_ | Require this token on all API requests (recommended for network-accessible deployments) |
| `CRONBASE_LOG_LEVEL` | `info` | Minimum log level: `error`, `warn`, `info`, `debug`, or `silent` |
| `CRONBASE_LOG_FORMAT` | _(text)_ | Set to `json` for machine-readable structured log output |

### Logging

By default, cronbase logs informational messages to stdout and errors/warnings to stderr.

**Suppress routine output in production:**

```bash
CRONBASE_LOG_LEVEL=warn cronbase start
```

**Enable debug tracing for troubleshooting:**

```bash
CRONBASE_LOG_LEVEL=debug cronbase start
```

**Structured JSON for log aggregation (Datadog, Loki, CloudWatch, etc.):**

```bash
CRONBASE_LOG_FORMAT=json cronbase start | your-log-collector
```

JSON log lines include `time` (ISO 8601), `level`, and `msg` fields, plus any additional metadata:

```json
{"time":"2024-01-15T09:00:00.000Z","level":"info","msg":"Running: backup-db (0 2 * * *)"}
{"time":"2024-01-15T09:00:02.000Z","level":"info","msg":"✓ backup-db: success (1842ms, exit 0)"}
```

**Programmatic control (TypeScript API):**

```typescript
import { Scheduler } from "cronbase";

const scheduler = new Scheduler({
  logLevel: "warn",  // overrides CRONBASE_LOG_LEVEL
});
```

## CLI flags

```bash
cronbase start \
  --port 7433 \           # Web dashboard port
  --db ./cronbase.db \    # Database path
  --config cronbase.yaml  # Config file to load
```

## Timeouts

Jobs can have per-job timeout enforcement:

```yaml
jobs:
  - name: slow-task
    schedule: "@hourly"
    command: ./process-data.sh
    timeout: 300  # Kill after 5 minutes
```

When a timeout is hit:
1. cronbase sends SIGTERM to the process
2. Waits 5 seconds for graceful shutdown
3. Sends SIGKILL if still running
4. Records the execution as `timeout` status

## Retry

Failed jobs can be automatically retried with exponential backoff:

```yaml
jobs:
  - name: flaky-api
    schedule: "*/10 * * * *"
    command: curl -sf https://api.example.com/process
    retry:
      maxAttempts: 3   # Up to 3 retry attempts
      baseDelay: 30    # Base delay: 30s, 60s, 120s (exponential)
```

Each retry attempt is recorded separately in execution history with its attempt number.

> **Legacy format**: `retries` and `retry_delay` as top-level properties are still accepted for backwards compatibility.
