# TypeScript API Reference

cronbase can be used as a library in your Bun/TypeScript projects.

> **Note:** An installable npm package is not yet available. The `import ... from "cronbase"` paths below describe the published package; until it lands, clone the repo and import from the local source (`import { Scheduler } from "./path/to/cronbase/src"`), or use cronbase via Docker or the CLI.

## Scheduler

The main entry point for running cronbase programmatically.

```typescript
import { Scheduler } from "cronbase";

const scheduler = new Scheduler({
  dbPath: "./my-jobs.db",  // SQLite database path
  port: 7433,              // Web dashboard port
  pollInterval: 1000,      // How often to check for due jobs (ms)
});

// Access the store to manage jobs
const store = scheduler.getStore();

// Start the scheduler + web server
scheduler.start();

// Stop gracefully
scheduler.close();
```

### SchedulerOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `dbPath` | `string` | `"./cronbase.db"` | SQLite database path |
| `port` | `number` | `7433` | Web dashboard port |
| `hostname` | `string` | `"127.0.0.1"` | Bind address (`"0.0.0.0"` for network access) |
| `pollInterval` | `number` | `1000` | Poll interval in milliseconds |
| `pruneAfterDays` | `number` | `90` | Auto-prune executions older than N days (0 = disabled) |
| `maxConcurrent` | `number` | `0` | Max concurrent jobs (0 = unlimited) |
| `logLevel` | `LogLevel` | `"info"` | Minimum log level (`"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"silent"`) |

## Logger

cronbase exports its internal logger for integration with your own logging setup:

```typescript
import { logger, setLogLevel, setJsonFormat, getLogLevel } from "cronbase";

// Change minimum log level at runtime
setLogLevel("debug");

// Enable JSON output
setJsonFormat(true);

// Read current level
console.log(getLogLevel()); // "debug"

// Emit log entries in the same format as cronbase internals
logger.info("Custom message", { jobName: "backup" });
// → [cronbase] Custom message {"jobName":"backup"}
```

The logger respects the `CRONBASE_LOG_LEVEL` and `CRONBASE_LOG_FORMAT` environment variables on startup. Programmatic `setLogLevel` / `setJsonFormat` calls override those values at runtime.

## Store

Database layer for managing jobs and execution history.

```typescript
import { Store } from "cronbase";

const store = new Store("./cronbase.db");
```

### addJob(config)

```typescript
const job = store.addJob({
  name: "backup",
  schedule: "@daily",
  command: "pg_dump mydb > /backups/db.sql",
  timeout: 300,
  retry: { maxAttempts: 2, baseDelay: 60 },
  description: "Nightly backup",
  tags: ["database"],
});
```

### listJobs()

```typescript
const jobs = store.listJobs();
// Returns Job[] with all fields populated
```

### getJobByName(name)

```typescript
const job = store.getJobByName("backup");
// Returns Job | null
```

### updateJob(id, config)

```typescript
store.updateJob(job.id, {
  ...job,
  timeout: 600,
});
```

### deleteJob(id)

```typescript
store.deleteJob(job.id);
```

### toggleJob(id, enabled)

```typescript
store.toggleJob(job.id, false); // Disable
store.toggleJob(job.id, true);  // Enable
```

### getExecutions(opts)

```typescript
const execs = store.getExecutions({
  jobId: 1,    // Optional: filter by job
  limit: 50,   // Optional: max results
});
```

### getStats()

```typescript
const stats = store.getStats();
// { totalJobs, enabledJobs, recentSuccesses, recentFailures }
```

### Alert management

```typescript
// Set alert config
store.setJobAlert(job.id, {
  webhooks: [
    { url: "https://hooks.slack.com/...", events: ["failed"] },
  ],
});

// Get alert config
const config = store.getJobAlert(job.id);

// Remove alerts
store.deleteJobAlert(job.id);
```

## Cron Parser

Parse and describe cron expressions.

```typescript
import { parseCron, describeCron, getNextRun } from "cronbase";

// Parse a cron expression
const parsed = parseCron("0 2 * * *");
// { minute: [0], hour: [2], dayOfMonth: [1..31], month: [1..12], dayOfWeek: [0..6] }

// Get human-readable description
const desc = describeCron("0 2 * * *");
// "at minute 0, at hour 2"

// Calculate next run time
const next = getNextRun("0 2 * * *");
// Date object for the next matching time
```

## Executor

Execute a job directly.

```typescript
import { executeJob } from "cronbase";

const result = await executeJob(job, store);
// { status, exitCode, durationMs, stdout, stderr, attempt, ... }
```

## Config Loader

Load jobs from a YAML or JSON config file.

```typescript
import { loadConfigFile } from "cronbase";

const store = new Store("./cronbase.db");
const { added, updated } = loadConfigFile("./cronbase.yaml", store);
console.log(`Added ${added}, updated ${updated} jobs`);
```

## Web Server

Create a standalone HTTP server for the dashboard and REST API.

```typescript
import { createServer, Store } from "cronbase";

const store = new Store("./cronbase.db");
const server = createServer(store, { port: 7433, hostname: "127.0.0.1" });
// Returns a Bun HTTP server
```

## Alerting

Send webhook notifications for job events.

```typescript
import { fireAlerts, formatSlack, formatDiscord, processAlerts } from "cronbase";
import type { AlertPayload } from "cronbase";

// Fire alerts for a job execution
await fireAlerts(store, jobId, execution);

// Format for specific platforms
const slackPayload = formatSlack(alertPayload);
const discordPayload = formatDiscord(alertPayload);

// Process alerts with custom handling
await processAlerts(webhooks, alertPayload);
```

## Validation

Validate job configuration before saving.

```typescript
import {
  validateJobConfig,
  validateCommand,
  validateSchedule,
  validateWebhookUrl,
  validateRetryConfig,
  LIMITS,
} from "cronbase";
import type { ValidationError } from "cronbase";

// Validate an entire job config
const error: ValidationError | null = validateJobConfig({
  name: "my-job",
  schedule: "* * * * *",
  command: "echo hello",
});

// Validate individual fields
validateCommand("echo hello");     // null if valid
validateSchedule("0 * * * *");     // null if valid
validateWebhookUrl("https://...");  // null if valid
validateRetryConfig({ maxAttempts: 3, baseDelay: 30 }); // null if valid

// Access limits
console.log(LIMITS.maxCommandLength);  // Max command string length
console.log(LIMITS.maxJobNameLength);  // Max job name length
```

### Available validators

| Function | Validates |
|---|---|
| `validateJobConfig` | Full job config object |
| `validateJobName` | Job name format and length |
| `validateCommand` | Command string length |
| `validateSchedule` | Cron expression syntax |
| `validateTimeout` | Timeout value range |
| `validateRetryConfig` | Retry attempts and delay |
| `validateCwd` | Working directory path |
| `validateEnv` | Environment variable map |
| `validateTags` | Tags array |
| `validateDescription` | Description length |
| `validateWebhookUrl` | Webhook URL format |

## Types

```typescript
import type {
  Job,
  JobConfig,
  Execution,
  ExecutionStatus,
  AlertConfig,
  AlertPayload,
  WebhookConfig,
  RetryConfig,
  ParsedCron,
  SchedulerOptions,
  ValidationError,
} from "cronbase";
```

### JobConfig

```typescript
interface JobConfig {
  name: string;
  schedule: string;          // Cron expression or preset
  command: string;           // Shell command
  cwd?: string;              // Working directory
  env?: Record<string, string>;
  timeout?: number;          // Seconds
  retry?: RetryConfig;
  enabled?: boolean;
  description?: string;
  tags?: string[];
}
```

### ExecutionStatus

```typescript
type ExecutionStatus = "running" | "success" | "failed" | "timeout" | "skipped";
```
