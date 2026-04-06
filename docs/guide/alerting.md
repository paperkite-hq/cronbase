# Alerting

cronbase sends notifications when jobs complete — via webhooks (Slack, Discord, any URL) or email (built-in SMTP client). Alerts are configured per-job and fire on success, failure, or timeout events.

## Quick setup

The simplest way to add alerting is in your config file:

```yaml
jobs:
  - name: backup-db
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db.sql
    on_failure: https://hooks.slack.com/services/T.../B.../xxx
    on_failure_email: ops@example.com
```

## Config file shortcuts

### Webhook shortcuts

| Property | Events triggered |
|---|---|
| `on_failure` | `failed`, `timeout` |
| `on_success` | `success` |
| `on_complete` | `success`, `failed`, `timeout` |

### Email shortcuts

| Property | Events triggered |
|---|---|
| `on_failure_email` | `failed`, `timeout` |
| `on_success_email` | `success` |
| `on_complete_email` | `success`, `failed`, `timeout` |

Email fields accept a single address or a comma-separated list (e.g. `ops@example.com, oncall@example.com`).

You can combine webhook and email shortcuts on the same job — both fire independently.

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

## Email (SMTP)

cronbase includes a built-in SMTP client for email alerts — no external mail libraries or services required.

### Setup

Set the SMTP environment variables before starting cronbase:

```bash
export CRONBASE_SMTP_HOST="smtp.gmail.com"
export CRONBASE_SMTP_PORT=465
export CRONBASE_SMTP_SECURE=true
export CRONBASE_SMTP_FROM="alerts@example.com"
export CRONBASE_SMTP_USERNAME="alerts@example.com"
export CRONBASE_SMTP_PASSWORD="app-password-here"

cronbase start
```

With Docker:

```bash
docker run -d --name cronbase \
  -p 7433:7433 \
  -e CRONBASE_SMTP_HOST="smtp.gmail.com" \
  -e CRONBASE_SMTP_PORT=465 \
  -e CRONBASE_SMTP_SECURE=true \
  -e CRONBASE_SMTP_FROM="alerts@example.com" \
  -e CRONBASE_SMTP_USERNAME="alerts@example.com" \
  -e CRONBASE_SMTP_PASSWORD="app-password-here" \
  -v cronbase-data:/data \
  ghcr.io/paperkite-hq/cronbase
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CRONBASE_SMTP_HOST` | *(none)* | SMTP server hostname (required to enable email alerts) |
| `CRONBASE_SMTP_PORT` | `587` | SMTP server port |
| `CRONBASE_SMTP_SECURE` | `false` | Set to `true` for TLS/SMTPS on connect (typically port 465) |
| `CRONBASE_SMTP_FROM` | `cronbase@localhost` | Sender address |
| `CRONBASE_SMTP_USERNAME` | *(none)* | SMTP AUTH username |
| `CRONBASE_SMTP_PASSWORD` | *(none)* | SMTP AUTH password |

### Email content

Alert emails include:
- Subject line with status icon: `[cronbase] ✓ backup-db succeeded` or `[cronbase] ✗ backup-db failed`
- Job name, schedule, start time, duration, exit code, and attempt number
- Last 500 characters of stderr (on failure) or stdout (on success)

### Common SMTP providers

| Provider | Host | Port | Secure | Notes |
|---|---|---|---|---|
| Gmail | `smtp.gmail.com` | 465 | `true` | Use [App Passwords](https://support.google.com/accounts/answer/185833) |
| Outlook/Office 365 | `smtp.office365.com` | 587 | `false` | Standard auth or OAuth |
| Amazon SES | `email-smtp.us-east-1.amazonaws.com` | 465 | `true` | SMTP credentials from SES console |
| Postmark | `smtp.postmarkapp.com` | 587 | `false` | Server API token as password |
| Local relay | `localhost` | 25 | `false` | No auth needed for local relay |

## REST API configuration

You can also configure alerts via the REST API:

```bash
# Set webhook + email alerts for job ID 1
curl -X PUT http://localhost:7433/api/jobs/1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "webhooks": [
      {
        "url": "https://hooks.slack.com/services/T.../B.../xxx",
        "events": ["failed", "timeout"]
      }
    ],
    "emails": [
      {
        "to": ["ops@example.com", "oncall@example.com"],
        "events": ["failed", "timeout"]
      }
    ]
  }'

# View current alert config
curl http://localhost:7433/api/jobs/1/alerts

# Remove alerts
curl -X DELETE http://localhost:7433/api/jobs/1/alerts
```

Email alerts require SMTP environment variables to be set (see [Email setup](#setup) above). If `CRONBASE_SMTP_HOST` is not set, email alerts are silently skipped with a warning in the logs.

## Behavior

- Alerts are sent asynchronously after job completion — they don't block the scheduler
- Each webhook has a 10-second timeout to prevent hanging
- Failed webhook deliveries are logged but don't affect job status
- The `stdoutTail` and `stderrTail` fields contain the last 500 characters of output
