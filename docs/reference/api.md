# REST API Reference

The REST API is served alongside the web dashboard on the same port (default `7433`). All endpoints return JSON and accept JSON request bodies.

CORS is enabled for all endpoints.

## Health

### GET /health

Returns scheduler status and basic metrics.

**Response:**
```json
{
  "status": "ok",
  "totalJobs": 5,
  "enabledJobs": 4,
  "dbSizeBytes": 45056,
  "paused": false,
  "pausedUntil": null
}
```

## Jobs

### GET /api/jobs

List all jobs.

**Response:** Array of job objects.

### POST /api/jobs

Create a new job.

**Request body:**
```json
{
  "name": "backup-db",
  "schedule": "0 2 * * *",
  "command": "pg_dump mydb > /backups/db.sql",
  "timeout": 300,
  "retry": { "maxAttempts": 2, "baseDelay": 60 },
  "description": "Nightly database backup",
  "tags": ["database", "backup"],
  "timezone": "America/New_York"
}
```

The `timezone` field is optional. When set, cron fields are interpreted as wall-clock time in that IANA timezone (e.g. `America/New_York`, `Europe/London`). When omitted, UTC is used. The `CRONBASE_TIMEZONE` environment variable sets a default for all jobs.

**Response:** The created job object.

### GET /api/jobs/:id

Get a single job by ID.

### PUT /api/jobs/:id

Update a job. Accepts the same fields as POST.

### DELETE /api/jobs/:id

Delete a job.

### PATCH /api/jobs/:id/toggle

Enable or disable a job.

**Request body:**
```json
{ "enabled": false }
```

### POST /api/jobs/:id/run

Trigger immediate execution. Returns immediately — the job runs asynchronously.

**Response:**
```json
{ "message": "Job triggered", "jobId": 1 }
```

## Alerts

### GET /api/jobs/:id/alerts

Get alert configuration for a job.

**Response:**
```json
{
  "webhooks": [
    {
      "url": "https://hooks.slack.com/services/T.../B.../xxx",
      "events": ["failed", "timeout"]
    }
  ]
}
```

### PUT /api/jobs/:id/alerts

Set alert configuration. Replaces any existing config.

**Request body:**
```json
{
  "webhooks": [
    {
      "url": "https://hooks.slack.com/services/...",
      "events": ["failed", "timeout"]
    },
    {
      "url": "https://discord.com/api/webhooks/...",
      "events": ["success", "failed", "timeout"]
    }
  ]
}
```

### DELETE /api/jobs/:id/alerts

Remove all alert configuration for a job.

## Executions

### GET /api/executions

List execution history.

**Query parameters:**

| Parameter | Default | Description |
|---|---|---|
| `jobId` | — | Filter by job ID |
| `limit` | `50` | Maximum number of results |

**Response:** Array of execution objects.

### GET /api/executions/:id

Get a single execution with full stdout/stderr output.

**Response:**
```json
{
  "id": 42,
  "jobId": 1,
  "jobName": "backup-db",
  "status": "success",
  "startedAt": "2025-01-15T02:00:00.000Z",
  "finishedAt": "2025-01-15T02:00:05.230Z",
  "durationMs": 5230,
  "exitCode": 0,
  "stdout": "Backup completed successfully\n",
  "stderr": "",
  "attempt": 0
}
```

## Scheduler

### GET /api/scheduler/status

Check if the scheduler is paused.

**Response:**
```json
{
  "paused": false,
  "until": null
}
```

### POST /api/scheduler/pause

Pause all scheduled job execution. Optionally set an auto-resume time.

**Request body (optional):**
```json
{
  "until": "2025-01-15T06:00:00.000Z"
}
```

**Response:**
```json
{
  "paused": true,
  "until": "2025-01-15T06:00:00.000Z"
}
```

### POST /api/scheduler/resume

Resume scheduled job execution.

**Response:**
```json
{
  "paused": false
}
```

## Utilities

### GET /api/stats

Summary statistics.

**Response:**
```json
{
  "totalJobs": 5,
  "enabledJobs": 4,
  "recentSuccesses": 23,
  "recentFailures": 1
}
```

### GET /api/cron/describe

Validate and describe a cron expression.

**Query parameters:**

| Parameter | Description |
|---|---|
| `expr` | Cron expression to validate |

**Response (valid):**
```json
{
  "valid": true,
  "description": "at minute 0, at hour 2",
  "nextRun": "2025-01-16T02:00:00.000Z"
}
```

**Response (invalid):**
```json
{
  "valid": false,
  "error": "Invalid minute value: 60"
}
```
