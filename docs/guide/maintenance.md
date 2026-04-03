# Maintenance

Over time, cronbase accumulates execution history in its SQLite database. Left unchecked, this grows without bound — on a busy system running dozens of jobs per day, the database can reach hundreds of megabytes within a year.

This guide covers how to keep your database lean through scheduled pruning.

## How history accumulates

Every job execution is recorded in the `executions` table with its status, timestamps, stdout, and stderr. The stdout/stderr output is where most of the storage goes — a job that prints 10KB of output per run, running hourly, adds ~87MB per year.

## Auto-prune on startup

cronbase automatically prunes executions older than 90 days when the scheduler starts, and repeats every 24 hours. No configuration required.

To adjust the retention period, use `--prune-days` when starting the scheduler:

```bash
# Keep 30 days of history
cronbase start --prune-days 30

# Keep 180 days of history
cronbase start --prune-days 180

# Disable auto-prune (not recommended for long-running deployments)
cronbase start --prune-days 0
```

## Manual pruning

To prune immediately without restarting the scheduler:

```bash
cronbase prune --days 90
```

This deletes all execution records older than the specified number of days and prints a count of deleted rows. Safe to run while the scheduler is running.

## Self-pruning job pattern

For deployments where you want explicit control (and an audit trail in the dashboard), register pruning as a cronbase job itself:

```yaml
# cronbase.yaml
jobs:
  - name: prune-history
    schedule: "0 3 * * 0"   # Weekly, Sunday at 3am
    command: cronbase prune --days 90
    description: Prune execution history older than 90 days
    tags: [maintenance]
```

Or via CLI:

```bash
cronbase add \
  --name "prune-history" \
  --schedule "0 3 * * 0" \
  --command "cronbase prune --days 90" \
  --description "Prune execution history older than 90 days"
```

This approach lets you see when pruning last ran and how many records were deleted — both visible in the dashboard.

> **Note:** If you use this pattern, set `--prune-days 0` (or `pruneAfterDays: 0` in the TypeScript API) to disable the built-in auto-prune so you're not pruning twice.

## Choosing a retention period

| Deployment | Recommended retention | Reasoning |
|---|---|---|
| High-frequency jobs (>100/day) | 30 days | Database grows fast; recent history is most actionable |
| Standard deployments | 90 days | Default; balances history depth with storage |
| Audit/compliance requirements | 180–365 days | Legal or operational need for historical records |
| Low-frequency jobs (<10/day) | 365 days | Storage impact is minimal; full history is useful |

The key trade-off: more history means better observability for diagnosing intermittent failures, but also larger database files and slower history queries.

## Checking database size

```bash
# File size
du -sh /path/to/cronbase.db

# Row count (requires sqlite3)
sqlite3 cronbase.db "SELECT COUNT(*) FROM executions;"

# Storage breakdown by job
sqlite3 cronbase.db "
  SELECT job_name,
         COUNT(*) as runs,
         ROUND(SUM(LENGTH(COALESCE(stdout,'')) + LENGTH(COALESCE(stderr,''))) / 1048576.0, 2) as output_mb
  FROM executions
  GROUP BY job_name
  ORDER BY output_mb DESC;
"
```

If a single job dominates storage, consider shortening its log output (redirect to a log file and only print errors) or giving it a shorter retention window via more frequent manual pruning.

## Docker and Kubernetes

If you're running cronbase in Docker or Kubernetes, the database lives inside a mounted volume. Standard backup practices apply — snapshot the volume or copy the `.db` file before pruning if you need a historical archive.

For Docker Compose deployments, you can add a one-off prune service:

```yaml
# docker-compose.yml
services:
  cronbase:
    image: cronbase
    volumes:
      - cronbase-data:/data
    command: start --db /data/cronbase.db --prune-days 90

  # Run manually: docker compose run --rm prune
  prune:
    image: cronbase
    volumes:
      - cronbase-data:/data
    command: prune --db /data/cronbase.db --days 90
    profiles: [tools]

volumes:
  cronbase-data:
```
