# Migration from crontab

This guide helps you move your existing cron jobs from `crontab -e` to cronbase.

## Why migrate?

| Feature | crontab | cronbase |
|---|---|---|
| Web dashboard | No | Yes |
| Execution history | No | Yes |
| stdout/stderr capture | Via mail only | Stored + viewable |
| Retry on failure | No | Yes, with exponential backoff |
| Timeout enforcement | No | Yes, per-job |
| Alerts | No | Slack, Discord, webhooks |
| Enable/disable | Delete + re-add | Toggle on/off |
| Config as code | Sort of | YAML/JSON files |

## Step-by-step migration

### 1. Export your current crontab

```bash
crontab -l > my-crontab.txt
```

### 2. Convert to cronbase format

A crontab entry like:

```
0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
```

Becomes:

```yaml
jobs:
  - name: backup
    schedule: "0 2 * * *"
    command: /usr/local/bin/backup.sh
    description: Nightly backup
```

Note: you don't need `>> /var/log/backup.log 2>&1` — cronbase captures stdout and stderr automatically.

### 3. Handle common crontab patterns

**Output redirection** — cronbase captures output automatically. Remove `>> logfile 2>&1`.

**MAILTO** — Replace with webhook alerts:
```yaml
on_failure: https://hooks.slack.com/services/...
```

**PATH and environment** — Use `env` and `cwd`:
```yaml
jobs:
  - name: my-job
    schedule: "0 * * * *"
    command: ./run.sh
    cwd: /opt/myapp
    env:
      PATH: /usr/local/bin:/usr/bin
      NODE_ENV: production
```

**Lock files (flock)** — cronbase prevents concurrent execution of the same job automatically. Remove `flock` wrappers.

### 4. Load and verify

```bash
# Load your config
cronbase start --config cronbase.yaml

# List jobs to verify
cronbase list

# Test a job manually
cronbase run backup
```

### 5. Disable the old crontab

Once you're confident everything works:

```bash
# Backup
crontab -l > crontab-backup.txt

# Clear
crontab -r
```

## Cron expression compatibility

cronbase supports the standard 5-field cron format used by crontab. If your existing expressions work in crontab, they'll work in cronbase.

**Supported features:**
- Standard 5 fields: minute, hour, day-of-month, month, day-of-week
- Ranges: `1-5`
- Steps: `*/15`, `1-30/2`
- Lists: `1,5,10`
- Names: `mon-fri`, `jan,mar,jul`
- Presets: `@daily`, `@hourly`, `@weekly`, `@monthly`, `@yearly`

**Not supported:**
- 6-field expressions with seconds (crontab doesn't support these either)
- `@reboot` (use your init system for startup tasks)
