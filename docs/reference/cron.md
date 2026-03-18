# Cron Expressions

cronbase uses standard 5-field cron expressions, the same format used by `crontab`.

## Format

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sun=0)
│ │ │ │ │
* * * * *
```

## Special characters

| Character | Description | Example |
|---|---|---|
| `*` | Any value | `* * * * *` (every minute) |
| `,` | List | `1,15,30 * * * *` (minutes 1, 15, 30) |
| `-` | Range | `1-5 * * * *` (minutes 1 through 5) |
| `/` | Step | `*/15 * * * *` (every 15 minutes) |

## Named values

Months and days of week accept names (case-insensitive):

- **Months:** `jan`, `feb`, `mar`, `apr`, `may`, `jun`, `jul`, `aug`, `sep`, `oct`, `nov`, `dec`
- **Days:** `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`

```
0 9 * * mon-fri    # Weekdays at 9 AM
0 0 1 jan,jul *    # Midnight on Jan 1 and Jul 1
```

## Presets

| Preset | Equivalent | Description |
|---|---|---|
| `@yearly` | `0 0 1 1 *` | Once a year (midnight, Jan 1) |
| `@annually` | `0 0 1 1 *` | Same as @yearly |
| `@monthly` | `0 0 1 * *` | First of every month |
| `@weekly` | `0 0 * * 0` | Every Sunday at midnight |
| `@daily` | `0 0 * * *` | Every day at midnight |
| `@midnight` | `0 0 * * *` | Same as @daily |
| `@hourly` | `0 * * * *` | Top of every hour |

## Examples

| Expression | Description |
|---|---|
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Top of every hour |
| `0 2 * * *` | Daily at 2:00 AM |
| `30 9 * * 1-5` | Weekdays at 9:30 AM |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 0 1 * *` | First of every month at midnight |
| `0 6,18 * * *` | Twice daily at 6 AM and 6 PM |
| `0 0 1 1 *` | Once a year on January 1 |
| `0 */4 * * *` | Every 4 hours |
| `15 2 1,15 * *` | 2:15 AM on the 1st and 15th |

## Validation

Use the CLI or API to validate expressions:

```bash
# API endpoint
curl "http://localhost:7433/api/cron/describe?expr=0+2+*+*+*"
```

```json
{
  "valid": true,
  "description": "at minute 0, at hour 2",
  "nextRun": "2025-01-16T02:00:00.000Z"
}
```
