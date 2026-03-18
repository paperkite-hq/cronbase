---
layout: home
hero:
  name: cronbase
  text: Self-hosted cron job manager
  tagline: Replace crontab -e with a modern web dashboard. Define, execute, and monitor scheduled tasks.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/paperkite-hq/cronbase
features:
  - title: Web Dashboard
    details: Real-time job monitoring with execution history, stdout/stderr viewer, and dark/light theme. Create and manage jobs from your browser.
  - title: Zero Dependencies
    details: Single binary on Bun, SQLite storage, embedded web UI. No external services, no Docker required, no config servers.
  - title: Webhook Alerting
    details: Get notified on Slack, Discord, or any HTTP endpoint when jobs fail. Auto-detects platform and sends rich formatted messages.
  - title: Config as Code
    details: Define jobs in YAML or JSON config files. Sync on startup — perfect for version-controlled infrastructure.
  - title: Retry & Timeout
    details: Per-job timeout enforcement with SIGTERM/SIGKILL escalation. Automatic retry with exponential backoff.
  - title: Full Observability
    details: Every execution recorded with stdout/stderr capture, duration, exit code, and attempt number. Query via CLI, API, or dashboard.
---
