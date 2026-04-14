# Changelog

All notable changes to cronbase will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] — 2026-04-14

### Added

- **Prometheus `/metrics` endpoint** — Prometheus-compatible metrics exposition for integration with Grafana, AlertManager, and any Prometheus-compatible stack. Exposes job counts, execution counters, duration summaries, scheduler state, and database size. Unauthenticated (like `/health`) for safe scraping.
- **Global pause/resume** — `cronbase pause [--until <datetime>]` and `cronbase resume` for maintenance windows. Auto-resume timer, scheduler tick guard, REST API endpoints (`/api/scheduler/{status,pause,resume}`), pause state reflected in `/health`.
- **`cronbase doctor`** — diagnostic command that checks runtime environment (Bun version, port availability, timezone validity, database accessibility, config file parsing) and reports issues with actionable suggestions. Supports `--json` output.

### Fixed

- npm publish workflow: added `--access public` flag for scoped package first-publish
- npm publish workflow: switched to legacy auth for compatibility

## [0.3.0] — 2026-04-07

### Added

- **SMTP email alerting** — built-in SMTP client for email notifications on job success, failure, or timeout. Supports Gmail, SES, Postmark, and any SMTP server. Per-job email configuration via config file or REST API. No external dependencies.
- **`--demo` flag** — `cronbase start --demo` pre-loads 3 sample jobs (health-check, daily-backup, weekly-cleanup) when the database is empty, giving evaluators an immediate view of the dashboard in action
- **Interactive `cronbase add` wizard** — running `add` without flags now launches a guided prompt for name, schedule, and command. Only activates on TTY (piped/scripted usage unchanged)
- **`cronbase edit` subcommand** — modify a job's schedule, command, timeout, or other fields in-place without destroying execution history
- **`cronbase show` subcommand** — inspect a single job's full configuration, next run time, and recent execution stats
- **`cronbase logs` subcommand** — quickly view stdout/stderr from recent executions without opening the dashboard
- **Timezone-aware scheduling** — `CRONBASE_TIMEZONE` env var and per-job `timezone` field for running jobs in any IANA timezone

### Fixed

- Validate timezone field on job create and update — invalid IANA timezone names are now rejected
- Use `node:` protocol for readline import (Node.js/Bun compatibility)

### Changed

- Expanded CONTRIBUTING.md with contributor onboarding guidance (architecture overview, test patterns, code style)
- Documented SMTP email alerting in README, alerting guide, and config reference
- Added maintenance/pruning guide and prune CLI reference to docs site
- Added FAQ & troubleshooting page to docs site
- Updated dependencies: Biome 2.4.9 → 2.4.10, GitHub Actions (download-artifact v8, upload-pages-artifact v4, docker/build-push-action v7)

## [0.2.0] — 2026-03-25

### Added

- **`--json` flag** — machine-readable output for all CLI commands (pipe-friendly scripts and monitoring)
- **Docker-first Quick Start** — README leads with a one-liner `docker run`; Bun-from-source path moved to secondary
- **GHCR Docker image** — `ghcr.io/paperkite-hq/cronbase` published on every release via GitHub Actions
- **Deployment guides** — step-by-step setup for Raspberry Pi, Kubernetes (Deployment + CronJob), and Proxmox LXC
- **Supercronic comparison** — added to the comparison table with a dedicated migration guide
- **Coverage badge** — CI-generated shields.io badge in README; CI enforces a minimum coverage threshold
- **Dashboard tests** — Playwright tests for dashboard UI; YAML edge-case tests for import/export
- **Clock logo and favicon** — analog clock SVG used in README and docs site
- **Security section** — README documents API token auth, SSRF protection, and CORS restriction
- **Docker healthcheck** — `docker-compose.yml` now includes a `/health` endpoint check
- **GitHub templates** — issue and pull-request templates for contributor experience
- **Dependabot + `.editorconfig`** — automated dependency updates and consistent editor formatting

### Fixed

- Escape `</script>` in API token injection to prevent XSS in dashboard bootstrap
- Route all log output through the structured logger (previously some paths wrote directly to stderr)
- Safe YAML export quoting — special characters and multi-line values now round-trip correctly
- `PATH`, `HOME`, `LANG`, `LC_ALL` allowed as env overrides; IPv6 ULA addresses blocked in SSRF check
- Handle closed database gracefully during shutdown (previously threw on in-flight queries)
- Docker `VOLUME` declaration ordering fix — `chown` now runs before the volume mount
- Docker `workflow_dispatch` checks out `main` instead of a stale tag
- CLI test timeout increased to prevent flaky CI failures

### Changed

- Extracted `runCommand()` helper for in-process CLI testing; CLI test coverage improved from 17% → 74%
- Init wizard clarified `CRONBASE_API_TOKEN` guidance and webhook alerting documentation

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

[0.4.0]: https://github.com/paperkite-hq/cronbase/releases/tag/v0.4.0
[0.3.0]: https://github.com/paperkite-hq/cronbase/releases/tag/v0.3.0
[0.2.0]: https://github.com/paperkite-hq/cronbase/releases/tag/v0.2.0
[0.1.0]: https://github.com/paperkite-hq/cronbase/releases/tag/v0.1.0
