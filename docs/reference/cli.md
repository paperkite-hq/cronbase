# CLI Reference

## cronbase start

Start the scheduler and web dashboard.

```bash
cronbase start [--port 7433] [--db ./cronbase.db] [--config cronbase.yaml]
```

| Flag | Default | Description |
|---|---|---|
| `--port` | `7433` | Port for the web dashboard and REST API |
| `--db` | `./cronbase.db` | Path to the SQLite database |
| `--config` | — | YAML or JSON config file to load on startup |

The scheduler polls every second for due jobs and executes them. The web dashboard is served on the same port.

Stops gracefully on SIGINT (Ctrl+C) or SIGTERM.

## cronbase add

Add a new cron job.

```bash
cronbase add --name <name> --schedule <cron> --command <cmd> [options]
```

| Flag | Required | Default | Description |
|---|---|---|---|
| `--name` | Yes | — | Unique job name |
| `--schedule` | Yes | — | Cron expression or preset (`@daily`, `@hourly`, etc.) |
| `--command` | Yes | — | Shell command to execute (passed to `sh -c`) |
| `--cwd` | No | `.` | Working directory |
| `--timeout` | No | No limit | Kill after N seconds |
| `--retries` | No | `0` | Max retry attempts on failure |
| `--retry-delay` | No | `30` | Base delay (seconds) for exponential backoff |
| `--description` | No | — | Human-readable description |
| `--disabled` | No | `false` | Create in disabled state |

**Example:**

```bash
cronbase add \
  --name "backup-db" \
  --schedule "0 2 * * *" \
  --command "pg_dump mydb > /backups/db.sql" \
  --timeout 300 \
  --retries 2 \
  --description "Nightly database backup"
```

## cronbase list

List all jobs with their current status.

```bash
cronbase list
```

Output columns: Name, Schedule, Status (last execution), Last Run, Next Run.

## cronbase history

Show execution history.

```bash
cronbase history [--job <name>] [--limit 20]
```

| Flag | Default | Description |
|---|---|---|
| `--job` | — | Filter by job name |
| `--limit` | `20` | Maximum number of entries |

## cronbase logs

Show stdout/stderr output from a job's recent executions.

```bash
cronbase logs <name> [--limit 1]
```

| Flag | Default | Description |
|---|---|---|
| `--limit` | `1` | Number of recent executions to show |

By default shows the most recent execution. Use `--limit 5` to see the last 5 runs. Useful for quickly checking why a job failed without opening the dashboard.

```bash
# Check the latest output from backup-db
cronbase logs backup-db

# Show the last 3 runs
cronbase logs backup-db --limit 3

# Machine-readable output
cronbase logs backup-db --json
```

## cronbase run

Manually trigger a job and wait for completion.

```bash
cronbase run <name>
```

Shows stdout/stderr output and exits with the job's exit code (0 for success, 1 for failure).

## cronbase remove

Delete a job and its execution history.

```bash
cronbase remove <name>
```

## cronbase enable

Enable a disabled job so it runs on schedule.

```bash
cronbase enable <name>
```

## cronbase disable

Disable a job without deleting it. Disabled jobs don't execute on schedule but can still be triggered manually with `cronbase run`.

```bash
cronbase disable <name>
```

## cronbase stats

Show summary statistics.

```bash
cronbase stats
```

Output:
```
Jobs:      5 total, 4 enabled
Last 24h:  23 successes, 1 failures
Success:   95.8%
```

## cronbase validate

Validate a config file without making any database changes. Useful as a pre-deploy check in CI pipelines or before running `cronbase start --config`.

```bash
cronbase validate [--path cronbase.yaml]
```

| Flag | Default | Description |
|---|---|---|
| `--path` | `cronbase.yaml` | Path to the config file to validate |

Exits with code `0` if the config is valid, `1` if any errors are found.

Example:

```bash
$ cronbase validate --path my-jobs.yaml
✓ my-jobs.yaml is valid (3 jobs)

$ cronbase validate --path bad-config.yaml
✗   my-job [schedule]: Invalid schedule: Expected 5 fields
1 error found in bad-config.yaml
```

## Global flags

### `--json`

Output in JSON format instead of the default human-readable table. Supported by: `list`, `history`, `logs`, `stats`, `run`, `export`.

```bash
cronbase list --json
cronbase history --json --job backup-db
cronbase stats --json
cronbase run my-job --json
cronbase export --json
```

This is useful for piping into `jq`, scripting, and integration with monitoring tools:

```bash
# Get the name of all failing jobs in the last 24h
cronbase history --json | jq -r '.[] | select(.status == "failed") | .jobName'

# Check if success rate is above threshold
cronbase stats --json | jq '.successRate > 95'

# Export as JSON config
cronbase export --json > cronbase.json
```

Alternatively, use `--output json` for the same effect.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CRONBASE_DB` | `./cronbase.db` | Database path (used by all commands) |
