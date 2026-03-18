# Alerting

cronbase sends webhook notifications when jobs complete. Alerts are configured per-job and fire on success, failure, or timeout events.

## Quick setup

The simplest way to add alerting is in your config file:

```yaml
jobs:
  - name: backup-db
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db.sql
    on_failure: https://hooks.slack.com/services/T.../B.../xxx
```

## Config file shortcuts

| Property | Events triggered |
|---|---|
| `on_failure` | `failed`, `timeout` |
| `on_success` | `success` |
| `on_complete` | `success`, `failed`, `timeout` |

## Platform support

cronbase auto-detects the webhook platform from the URL and sends appropriately formatted messages.

### Slack

URLs containing `hooks.slack.com` or `slack.com/api` receive [Block Kit](https://api.slack.com/block-kit) formatted messages with:
- Color-coded attachments (green for success, red for failure)
- Structured fields: schedule, duration, exit code, attempt number
- stderr output block on failure

### Discord

URLs containing `discord.com/api/webhooks` receive [embed](https://discord.com/developers/docs/resources/channel#embed-object) formatted messages with:
- Color-coded embeds
- Inline fields: schedule, duration, exit code
- stderr output on failure

### Generic webhook

All other URLs receive the raw JSON payload:

```json
{
  "event": "failed",
  "job": {
    "id": 1,
    "name": "backup-db",
    "schedule": "0 2 * * *",
    "command": "pg_dump mydb > /backups/db.sql"
  },
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

## REST API configuration

You can also configure alerts via the REST API:

```bash
# Set alert config for job ID 1
curl -X PUT http://localhost:7433/api/jobs/1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "webhooks": [
      {
        "url": "https://hooks.slack.com/services/T.../B.../xxx",
        "events": ["failed", "timeout"]
      },
      {
        "url": "https://discord.com/api/webhooks/xxx/yyy",
        "events": ["success", "failed", "timeout"]
      }
    ]
  }'

# View current alert config
curl http://localhost:7433/api/jobs/1/alerts

# Remove alerts
curl -X DELETE http://localhost:7433/api/jobs/1/alerts
```

## Behavior

- Alerts are sent asynchronously after job completion — they don't block the scheduler
- Each webhook has a 10-second timeout to prevent hanging
- Failed webhook deliveries are logged but don't affect job status
- The `stdoutTail` and `stderrTail` fields contain the last 500 characters of output
