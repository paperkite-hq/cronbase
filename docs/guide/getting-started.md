# Getting Started

cronbase is a self-hosted cron job manager that replaces `crontab -e` with a modern web dashboard. It runs your jobs, captures output, tracks history, and sends alerts when things go wrong.

## Prerequisites

- [Bun](https://bun.sh/) v1.0 or later

## Installation

### From source

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
bun install
```

### Docker

```bash
docker run -d \
  --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  ghcr.io/paperkite-hq/cronbase
```

## Add your first job

```bash
cronbase add \
  --name "hello" \
  --schedule "*/5 * * * *" \
  --command "echo Hello from cronbase!"
```

This creates a job named `hello` that runs `echo Hello from cronbase!` every 5 minutes.

## Start the scheduler

```bash
cronbase start
```

This starts:
- The **scheduler** — polls for due jobs and executes them
- The **web dashboard** — serves at `http://localhost:7433`

Open your browser to see the dashboard with your job listed.

## Test it manually

Don't want to wait 5 minutes? Trigger it now:

```bash
cronbase run hello
```

You'll see the output immediately:

```
Running: hello (echo Hello from cronbase!)
✓ success (2.1ms, exit 0)

--- stdout ---
Hello from cronbase!
```

## View execution history

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
- [Docker](/guide/docker) — Run cronbase in a container
- [CLI Reference](/reference/cli) — All commands and options
