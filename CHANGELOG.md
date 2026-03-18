# Changelog

All notable changes to cronbase will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-03-18

First public release.

### Added

- **Core scheduler** — 5-field cron parser with presets (`@daily`, `@hourly`, etc.), month/day names, ranges, steps, and lists
- **Web dashboard** — embedded SPA with dark/light themes, real-time job status, execution history viewer, and job management UI
- **CLI** — `add`, `list`, `remove`, `enable`, `disable`, `run`, `history`, `stats`, `prune`, `import`, `export`, `start`, `--version`
- **REST API** — full CRUD for jobs, executions, alerts, statistics, and cron expression validation
- **Config files** — declarative job definitions in YAML or JSON, synced on startup
- **Alerting** — webhook notifications on success, failure, or timeout; auto-formatted for Slack (Block Kit) and Discord (embeds)
- **Crontab import** — `cronbase import` reads system crontab and migrates entries
- **Export/backup** — `cronbase export` dumps all jobs as a reloadable YAML config
- **Retry with backoff** — per-job retry count and exponential backoff delay
- **Timeouts** — per-job timeout with SIGTERM → SIGKILL escalation
- **Environment variables** — per-job env vars via config file or API
- **Tags** — organize jobs with arbitrary tags
- **Execution capture** — stdout/stderr recorded per execution (capped at 1 MiB)
- **Auto-pruning** — configurable retention period for old execution history
- **Stale execution recovery** — detects and marks executions orphaned by crashes
- **Concurrency control** — `maxConcurrent` scheduler option
- **Docker support** — Dockerfile, docker-compose.yml, and `/health` endpoint
- **Security** — API token auth, timing-safe comparison, SSRF protection for webhooks, CORS restriction, input validation
- **Programmatic API** — `Scheduler` and `Store` exports for library usage

[0.1.0]: https://github.com/paperkite-hq/cronbase/releases/tag/v0.1.0
