# Comparison with Alternatives

Choosing a cron job tool depends on your environment, scale, and what you need beyond "run this command on a schedule." This page compares cronbase with the most common alternatives so you can pick the right tool for your situation.

## Quick comparison

| Feature | cronbase | crontab | Supercronic | Ofelia | dkron | healthchecks.io |
|---|---|---|---|---|---|---|
| Web dashboard | Yes | No | No | No | Yes | Yes |
| Job execution | Yes | Yes | Yes | Yes (Docker) | Yes | No (monitoring only) |
| Execution history | Yes | No | No | Limited | Yes | No |
| stdout/stderr capture | Yes | Via mail | stdout/stderr | Docker logs | Limited | No |
| Retry with backoff | Yes | No | No | No | Yes | No |
| Webhook + email alerts | Yes | No | No | Slack only | Yes | Yes |
| Config file | YAML/JSON | crontab | crontab | Docker labels | JSON | N/A |
| Dependencies | None (Bun) | None | None (Go binary) | Docker | etcd/Consul | SaaS |
| Self-hosted | Yes | Yes | Yes | Yes | Yes | Optional |

## cronbase vs crontab

crontab is the default scheduler on every Unix system. It's battle-tested, zero-dependency, and pre-installed. If all you need is to run a script on a schedule, crontab works.

Where crontab falls short:

- **No visibility.** Did your backup job run last night? You have to check log files (if you remembered to redirect output), parse syslog, or wait for something to break. cronbase gives you a web dashboard showing every execution, its output, and whether it succeeded or failed.
- **No alerting.** crontab can email output via `MAILTO`, but most servers don't have a working mail setup. cronbase sends alerts to Slack, Discord, or any webhook endpoint when jobs fail.
- **No retry logic.** If a crontab job fails, it just fails. You'd need wrapper scripts for retry. cronbase supports automatic retry with configurable exponential backoff.
- **No execution history.** crontab doesn't track past runs. cronbase stores full stdout/stderr for every execution, so you can debug failures after the fact.
- **Awkward configuration.** `crontab -e` works, but managing cron across multiple servers means SSH and manual editing. cronbase uses config-as-code (YAML/JSON), so you can version your job definitions in git.

**When to stay with crontab:** You have a single server with a handful of jobs, you're comfortable with syslog, and you don't need alerting or execution history. See the [migration guide](/guide/migration) when you're ready to switch.

## cronbase vs Supercronic

[Supercronic](https://github.com/aptible/supercronic) is a cron runner built specifically for containers. Unlike the system cron daemon, it logs to stdout/stderr (so container orchestrators can collect the logs), handles `SIGTERM` gracefully for clean shutdowns, and reads a standard crontab file. It's the standard recommendation for "how do I run cron jobs in a Docker container" across Docker, Kubernetes, and Heroku documentation.

**Where Supercronic is a better fit:**

- You want a minimal, no-config cron runner inside a container alongside your main process.
- Your jobs are already defined in a crontab file and you don't want to change the format.
- You only need execution — no dashboard, no history, no alerting.
- You want the smallest possible image footprint (Supercronic is a single Go binary, ~7 MB).

**Where cronbase has the edge:**

- **Visibility.** Supercronic streams job output to container logs — useful if you're already aggregating logs, but there's no dashboard to see what ran, what failed, or what the output was. cronbase records every execution with stdout/stderr, duration, and exit code, accessible via a web UI or CLI.
- **Alerting.** Supercronic has no alerting — if a job fails, you'll only know if you're watching the logs. cronbase sends Slack, Discord, or webhook notifications when jobs fail, time out, or complete.
- **Retry logic.** Supercronic doesn't retry failed jobs. cronbase retries with configurable exponential backoff.
- **Dynamic job management.** Supercronic requires a restart to pick up crontab changes. cronbase lets you add, edit, enable, disable, and trigger jobs at runtime via the dashboard, CLI, or REST API — no restarts.
- **Run outside containers.** Supercronic is designed for containers. cronbase runs as a native process on any server, in Docker, or as a TypeScript library.

**When to use Supercronic:** You're building a Docker image and want a lightweight, container-native cron runner with no extra dependencies or UI. Supercronic is the right choice when simplicity is more important than observability.

**When to migrate to cronbase:** Your jobs are running in production, failures are going undetected, and you're tired of `kubectl logs` or `docker logs` as your only debugging tool.

## cronbase vs Ofelia

[Ofelia](https://github.com/mcuadros/ofelia) is a Docker-based job scheduler that reads job definitions from container labels. It's built specifically for Docker environments.

**Where Ofelia is a better fit:**

- You run everything in Docker and want job scheduling tightly coupled to container lifecycle.
- You prefer defining jobs as Docker labels rather than separate config files.

**Where cronbase has the edge:**

- **Not Docker-only.** Ofelia requires Docker — it can only run jobs inside containers. cronbase runs any shell command on the host, in Docker, or as a library in your TypeScript app.
- **Richer alerting.** Ofelia supports Slack notifications. cronbase supports Slack, Discord, and arbitrary webhook endpoints.
- **Execution history.** Ofelia has limited execution tracking. cronbase stores full stdout/stderr for every run with a searchable history in the dashboard.
- **Retry support.** Ofelia doesn't retry failed jobs. cronbase supports automatic retry with exponential backoff.
- **Active maintenance.** Ofelia's maintenance has been sporadic. cronbase is actively developed.

**When to use Ofelia:** Your infrastructure is 100% Docker and you want job definitions co-located with your Docker Compose files via labels.

## cronbase vs dkron

[dkron](https://dkron.io/) is a distributed cron system designed for multi-node clusters. It uses a consensus protocol (Raft) backed by etcd or Consul.

**Where dkron is a better fit:**

- You need distributed scheduling across many nodes with leader election.
- You need job execution on specific nodes in a cluster.
- You're already running etcd or Consul.

**Where cronbase has the edge:**

- **Zero dependencies.** dkron requires etcd or Consul for its consensus layer. cronbase has no external dependencies — install it, run it, done.
- **Simpler operation.** dkron's distributed architecture adds operational complexity: you need to manage the consensus cluster, handle split-brain scenarios, and debug distributed state. cronbase is a single process with a SQLite database.
- **Lower resource footprint.** A dkron deployment (dkron + etcd/Consul) is significantly heavier than a single cronbase process.
- **TypeScript API.** cronbase can be embedded as a library in TypeScript/Bun projects. dkron is a standalone Go binary.

**When to use dkron:** You're running jobs across a multi-node cluster and need distributed coordination with high availability. If you're on a single server (or a small number of servers), dkron's distributed architecture adds complexity without benefit.

## cronbase vs healthchecks.io

[healthchecks.io](https://healthchecks.io/) is a cron monitoring service. It doesn't execute jobs — it monitors them by watching for expected pings.

**They solve different problems:**

- healthchecks.io answers: "Did my cron job run on time?"
- cronbase answers: "Run this job, show me what happened, and alert me if it failed."

**Where healthchecks.io is a better fit:**

- You already have jobs running via crontab, systemd timers, or CI pipelines and just want dead-man-switch monitoring.
- You want a managed SaaS with no infrastructure to run.
- You need to monitor jobs running across many different systems from one place.

**Where cronbase has the edge:**

- **Actually runs jobs.** healthchecks.io only monitors — you still need crontab or something else to execute. cronbase is the executor and the monitor in one.
- **Self-hosted.** healthchecks.io can be self-hosted, but the primary product is SaaS. cronbase is self-hosted by design, so your data stays on your infrastructure.
- **Execution details.** cronbase captures stdout/stderr for every run. healthchecks.io only knows whether the ping arrived.

**When to use healthchecks.io:** You have jobs running across many systems (CI, Kubernetes, crontab on various servers) and want centralized "did it run?" monitoring. You can also use both — cronbase for execution, healthchecks.io for cross-system monitoring.

## When NOT to use cronbase

cronbase isn't the right choice for every situation:

- **Kubernetes-native workloads.** If you're on Kubernetes, use [CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/). They integrate with your cluster's scheduling, resource limits, and observability stack. Adding cronbase alongside Kubernetes would be redundant.
- **Cloud-native environments.** AWS has EventBridge Scheduler, GCP has Cloud Scheduler, Azure has Logic Apps. If you're all-in on a cloud provider and want managed scheduling with their IAM and monitoring integrations, use their native service.
- **Distributed job queues.** If you need fan-out, priority queues, or exactly-once processing across workers, you want a job queue (BullMQ, Celery, Temporal) rather than a cron scheduler.
- **Sub-second scheduling.** cronbase's minimum resolution is one minute (like crontab). If you need sub-minute scheduling, you need a different approach.

## Summary

| Use case | Best choice |
|---|---|
| Single server, want visibility into cron jobs | **cronbase** |
| Replacing crontab with something better | **cronbase** |
| Lightweight cron runner inside a container | Supercronic |
| Docker-only, jobs defined as container labels | Ofelia |
| Multi-node cluster with distributed coordination | dkron |
| Monitoring existing jobs (not running them) | healthchecks.io |
| Kubernetes workloads | Kubernetes CronJobs |
| Cloud-native, want managed service | Cloud provider scheduler |
