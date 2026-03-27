# FAQ & Troubleshooting

Common questions about running and managing cronbase.

## Can I run cronbase alongside my existing crontab?

Yes. cronbase and crontab are completely independent — cronbase uses its own SQLite database and scheduler, so it won't interfere with your system crontab. You can migrate jobs gradually, running both side by side until you're ready to remove the old crontab entries. See the [Migration guide](/guide/migration) for a step-by-step process.

## What happens if cronbase crashes while a job is running?

Running jobs are terminated when the cronbase process exits. The execution will be recorded as incomplete in the history. When cronbase restarts, it resumes scheduling from where it left off — any jobs that were due during the downtime will run on their next scheduled time, not retroactively. Use a process manager like [systemd](/guide/raspberry-pi#systemd-service) or Docker's `restart: unless-stopped` to ensure cronbase restarts automatically.

## How do I upgrade cronbase?

**Docker**: Pull the latest image and recreate the container. Your data is safe as long as you're using a volume mount for `/data`:

```bash
docker pull ghcr.io/paperkite-hq/cronbase:latest
docker stop cronbase && docker rm cronbase
docker run -d --name cronbase -p 7433:7433 -v cronbase-data:/data ghcr.io/paperkite-hq/cronbase
```

**From source**: Pull the latest code and rebuild:

```bash
cd cronbase && git pull && bun install
```

The SQLite database schema is migrated automatically on startup — no manual migration steps needed.

## How do I back up my cronbase data?

All data lives in a single SQLite file (default: `./cronbase.db`). Copy this file while cronbase is running — SQLite handles concurrent reads safely. For automated backups, add a cronbase job that backs itself up:

```yaml
jobs:
  - name: backup-cronbase
    schedule: "0 3 * * *"
    command: cp /data/cronbase.db /backups/cronbase-$(date +%Y%m%d).db
    description: Daily cronbase database backup
```

See the [Configuration guide](/guide/configuration) for the `CRONBASE_DB` environment variable that controls the database path.

## Can I run cronbase on a Raspberry Pi?

Yes — cronbase runs great on Raspberry Pi 2 or later. Docker is the easiest option and works on both 32-bit and 64-bit Raspberry Pi OS. Native Bun installation requires 64-bit OS. See the full [Raspberry Pi guide](/guide/raspberry-pi) for installation, systemd setup, and storage tips to reduce SD card wear.

## How do I change the dashboard port?

Pass the `--port` flag when starting cronbase:

```bash
cronbase start --port 8080
```

With Docker, map the container port to your desired host port:

```bash
docker run -d -p 8080:7433 -v cronbase-data:/data ghcr.io/paperkite-hq/cronbase
```

The default port is `7433`. See the [CLI reference](/reference/cli) for all startup options.

## Does cronbase support seconds-level scheduling?

No. cronbase uses standard 5-field cron expressions with a minimum granularity of one minute, the same as `crontab`. This is intentional — seconds-level scheduling is better handled by application-level timers or dedicated task queues. See the [Cron Expressions reference](/reference/cron) for supported syntax and presets.

## How much disk space does the execution history use?

cronbase stores execution history in SQLite, which is very space-efficient. A typical job running every 5 minutes generates roughly 1-2 MB of history per month (depending on output size). You can check current database size via the [health endpoint](/reference/api):

```bash
curl http://localhost:7433/health
# { "status": "ok", "dbSizeBytes": 45056, ... }
```

For jobs that produce large output, consider trimming output in your commands or periodically compacting the database.

## Can I use cronbase in a Docker Swarm or Kubernetes cluster?

Yes, with one constraint: cronbase uses SQLite, so only **one instance** should run at a time. Running multiple replicas against the same database will cause duplicate job executions. In Kubernetes, set `replicas: 1` and use a `PersistentVolumeClaim` for the database. See the [Kubernetes guide](/guide/kubernetes) for complete manifests covering standalone deployments, sidecar patterns, and ingress configuration.

## How do I secure the dashboard?

Set the `CRONBASE_API_TOKEN` environment variable to require a Bearer token on all API and dashboard requests:

```bash
CRONBASE_API_TOKEN=your-secret-token cronbase start
```

For production deployments, put cronbase behind a reverse proxy (nginx, Caddy) with TLS. See the [Configuration guide](/guide/configuration#environment-variables) for all security-related settings.

## Why aren't my config file changes taking effect?

cronbase reads the config file on startup only. After editing your YAML or JSON config, restart cronbase:

```bash
# Native
cronbase start --config cronbase.yaml

# Docker Compose
docker compose restart

# Kubernetes
kubectl rollout restart deployment/cronbase -n cronbase
```

Jobs are matched by name — existing jobs are updated, new jobs are created, and jobs not in the config file are left unchanged. See the [Config File reference](/reference/config) for details.

## How do I check if cronbase is healthy?

Hit the built-in health endpoint:

```bash
curl http://localhost:7433/health
```

This returns the server status, job counts, and database size. The [Docker image](/guide/docker#health-check) includes an automatic health check that polls this endpoint every 30 seconds.
