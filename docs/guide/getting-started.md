# Getting Started

cronbase is a self-hosted cron job manager that replaces `crontab -e` with a modern web dashboard. It runs your jobs, captures output, tracks history, and sends alerts when things go wrong.

## Quick Start with Docker

The fastest way to try cronbase — no prerequisites needed:

```bash
docker run -d \
  --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  ghcr.io/paperkite-hq/cronbase
```

Open **http://localhost:7433** — the dashboard is live.

Add your first job:

```bash
docker exec cronbase cronbase add \
  --name "hello" \
  --schedule "*/5 * * * *" \
  --command "echo Hello from cronbase!"
```

Trigger it immediately:

```bash
docker exec cronbase cronbase run hello
```

```
Running: hello (echo Hello from cronbase!)
✓ success (2.1ms, exit 0)

--- stdout ---
Hello from cronbase!
```

Or use Docker Compose for a persistent setup:

```bash
curl -O https://raw.githubusercontent.com/paperkite-hq/cronbase/main/docker-compose.yml
docker compose up -d
```

## Install from source

If you prefer running directly with [Bun](https://bun.sh/) (v1.0 or later):

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase && bun install

cronbase add --name "hello" --schedule "*/5 * * * *" --command "echo Hello!"
cronbase start   # → http://localhost:7433
```

## Explore the dashboard

Once cronbase is running, open **http://localhost:7433** in your browser. The dashboard shows:

- **Job list** — all registered jobs with status, schedule, and next run time
- **Execution history** — every run with stdout/stderr, duration, and exit code
- **Statistics** — success rate, total executions, enabled job count
- **Job management** — create, edit, enable/disable, and trigger jobs from the UI

## View execution history

From the CLI:

```bash
cronbase history
```

```
Job                  Status     Duration   Exit   Attempt  Started
──────────────────────────────────────────────────────────────────────────────
hello                ✓ success  2.1ms      0      0        3/18/2025, 2:05:00 PM
```

## What's next?

- [Configuration](/guide/configuration) — YAML config files, environment variables, timeouts, retries
- [Alerting](/guide/alerting) — Slack, Discord, and webhook notifications
- [Docker](/guide/docker) — Docker Compose, config files, and health checks
- [Migration](/guide/migration) — Import jobs from your existing crontab
- [CLI Reference](/reference/cli) — All commands and options
