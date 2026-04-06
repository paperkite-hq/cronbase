# Config File Reference

cronbase supports declarative job definitions in YAML or JSON files.

## Loading

```bash
cronbase start --config cronbase.yaml
```

On startup, cronbase:
1. Reads and parses the config file
2. For each job entry:
   - If a job with that name already exists → updates it
   - If no job with that name exists → creates it
3. Jobs not in the config file are left unchanged

This means you can safely re-run with the same config file without duplicating jobs.

## YAML format

```yaml
jobs:
  - name: backup-db
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db.sql
    cwd: /opt/myapp
    timeout: 300
    retries: 2
    retry_delay: 60
    description: Nightly database backup
    enabled: true
    tags: [database, backup]
    env:
      PGHOST: localhost
      PGPORT: "5432"
    on_failure: https://hooks.slack.com/services/T.../B.../xxx
    on_success: https://hooks.slack.com/services/T.../B.../yyy
    on_complete: https://hooks.slack.com/services/T.../B.../zzz
    on_failure_email: ops@example.com
    on_complete_email: ops@example.com, oncall@example.com
```

## JSON format

```json
{
  "jobs": [
    {
      "name": "backup-db",
      "schedule": "0 2 * * *",
      "command": "pg_dump mydb > /backups/db.sql",
      "timeout": 300,
      "retries": 2,
      "on_failure": "https://hooks.slack.com/services/T.../B.../xxx"
    }
  ]
}
```

## Field reference

### Required fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique job identifier |
| `schedule` | string | Cron expression or preset |
| `command` | string | Shell command (passed to `sh -c`) |

### Optional fields

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | string | `.` | Working directory for the command |
| `timeout` | number | — | Kill after N seconds |
| `retries` | number | `0` | Max retry attempts |
| `retry_delay` | number | `30` | Base delay for exponential backoff (seconds) |
| `description` | string | — | Human-readable description |
| `enabled` | boolean | `true` | Whether the job runs on schedule |
| `tags` | string[] | `[]` | Tags for organization |
| `env` | object | — | Environment variables (key-value pairs) |
| `timezone` | string | — | IANA timezone for this job (e.g. `America/New_York`). Overrides the `CRONBASE_TIMEZONE` env var for this job only. |

### Webhook alert shortcuts

| Field | Type | Events |
|---|---|---|
| `on_failure` | string (URL) | `failed`, `timeout` |
| `on_success` | string (URL) | `success` |
| `on_complete` | string (URL) | `success`, `failed`, `timeout` |

These shortcuts create webhook alert configurations. The URL format is auto-detected — Slack and Discord URLs receive platform-specific formatted messages; all other URLs receive the raw JSON payload.

### Email alert shortcuts

| Field | Type | Events |
|---|---|---|
| `on_failure_email` | string (email) | `failed`, `timeout` |
| `on_success_email` | string (email) | `success` |
| `on_complete_email` | string (email) | `success`, `failed`, `timeout` |

These shortcuts create email alert configurations. Values can be a single address or comma-separated list (e.g. `ops@example.com, oncall@example.com`). Requires `CRONBASE_SMTP_HOST` to be set — see [Alerting guide](/guide/alerting#email-smtp).

You can combine webhook and email shortcuts on the same job.

## YAML parser notes

cronbase includes a built-in YAML parser that handles common config patterns without external dependencies. It supports:

- Key-value pairs
- Lists (with `-` prefix)
- Nested objects (env blocks)
- Quoted and unquoted strings
- Comments with `#`
- Inline arrays `[a, b, c]`

For advanced YAML features, use JSON format instead.
