# Examples

cronbase ships with ready-to-use example configurations in the `examples/` directory. Copy and modify them for your needs.

## Database backup

Back up PostgreSQL and MySQL databases on a schedule with cleanup of old backups.

```yaml
jobs:
  - name: backup-postgres
    schedule: "0 2 * * *"
    command: >
      pg_dump -Fc mydb > /backups/mydb-$(date +%Y%m%d-%H%M%S).dump &&
      echo "Backup completed: $(du -h /backups/mydb-*.dump | tail -1)"
    timeout: 600
    retry:
      maxAttempts: 2
      baseDelay: 60
    on_failure: https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

  - name: cleanup-old-backups
    schedule: "0 4 * * *"
    command: find /backups -name '*.dump' -o -name '*.sql.gz' | sort | head -n -7 | xargs rm -f
    timeout: 60
```

See: [`examples/database-backup.yaml`](https://github.com/paperkite-hq/cronbase/blob/main/examples/database-backup.yaml)

## Health checks

Monitor services and get alerted before your users notice downtime.

```yaml
jobs:
  - name: check-web-app
    schedule: "*/5 * * * *"
    command: >
      STATUS=$(curl -sf -o /dev/null -w "%{http_code}" https://myapp.com/health) &&
      echo "Status: $STATUS" &&
      [ "$STATUS" = "200" ] || (echo "FAIL: got $STATUS" && exit 1)
    timeout: 30
    retry:
      maxAttempts: 1
    on_failure: https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK
```

See: [`examples/health-checks.yaml`](https://github.com/paperkite-hq/cronbase/blob/main/examples/health-checks.yaml)

## Log rotation

Manage application log files — compress, clean up, and monitor disk usage.

```yaml
jobs:
  - name: compress-logs
    schedule: "0 0 * * *"
    command: >
      find /var/log/myapp -name '*.log' -mtime +1 -not -name '*.gz' |
      xargs -I {} gzip {}

  - name: disk-usage-alert
    schedule: "0 */4 * * *"
    command: >
      USAGE=$(df /var/log | tail -1 | awk '{print $5}' | tr -d '%') &&
      [ "$USAGE" -lt 85 ] || (echo "WARNING: disk usage ${USAGE}%" && exit 1)
    on_failure: https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

See: [`examples/log-rotation.yaml`](https://github.com/paperkite-hq/cronbase/blob/main/examples/log-rotation.yaml)

## Data sync

Synchronize data between servers and cloud storage.

```yaml
jobs:
  - name: sync-to-backup
    schedule: "0 */6 * * *"
    command: rsync -az --delete /data/ backup-server:/backups/data/
    timeout: 3600
    retry:
      maxAttempts: 2
      baseDelay: 120
    on_failure: https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

See: [`examples/data-sync.yaml`](https://github.com/paperkite-hq/cronbase/blob/main/examples/data-sync.yaml)

## System maintenance

Routine maintenance — temp cleanup, certificate renewal, Docker pruning.

```yaml
jobs:
  - name: renew-certs
    schedule: "0 4 1,15 * *"
    command: certbot renew --quiet --deploy-hook "systemctl reload nginx"
    timeout: 300
    on_failure: https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

  - name: docker-cleanup
    schedule: "0 5 * * 0"
    command: docker system prune -f --volumes
```

See: [`examples/maintenance.yaml`](https://github.com/paperkite-hq/cronbase/blob/main/examples/maintenance.yaml)

## Running an example

```bash
cronbase start --config examples/health-checks.yaml
```

Or load multiple:

```bash
# Add jobs from a file, then start
cronbase start --config examples/database-backup.yaml
```
