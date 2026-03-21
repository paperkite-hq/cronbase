# Security Policy

## Trust Model

cronbase follows the **same trust model as crontab**: job definitions are admin-configured, not user-supplied at runtime. Commands are executed via `sh -c`, which means any command a system administrator would run in a shell can be used.

**Key assumption**: only trusted administrators have access to the cronbase API and dashboard. cronbase is designed for private/internal networks, not public-facing deployments.

## Authentication

cronbase supports optional API token authentication via the `CRONBASE_API_TOKEN` environment variable. When set, all API requests must include a valid `Authorization: Bearer <token>` header. The web dashboard includes the token automatically when configured.

**Recommendation**: Always enable API token authentication when cronbase is accessible over a network (not just localhost).

## Known Limitations

### No Multi-Tenant Isolation

cronbase runs all jobs under the same OS user. There is no per-job sandboxing, resource limits (cgroups), or user isolation. This is identical to how `crontab` works.

### No TLS

The built-in HTTP server does not support TLS. For production deployments, place cronbase behind a reverse proxy (nginx, Caddy, Traefik) that terminates TLS.

### No Rate Limiting

The API does not enforce request rate limits. In a private network this is acceptable; for any broader exposure, use a reverse proxy with rate limiting.

### Webhook SSRF Protection

Webhook URLs are validated to reject private, loopback, and link-local addresses (e.g., `127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.169.254`). This prevents SSRF attacks even if the API is exposed to less-trusted users.

### Database Permissions

The SQLite database file contains job definitions (including commands) and execution output. Ensure the database file has appropriate filesystem permissions (e.g., `chmod 600 cronbase.db`).

## Environment Variables

cronbase reads these security-relevant environment variables:

| Variable | Purpose |
|---|---|
| `CRONBASE_API_TOKEN` | Bearer token for API authentication (optional but recommended) |

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email: hailey+security@paperkite.sh
3. Include a description, reproduction steps, and potential impact

We aim to respond within 48 hours and will credit reporters in the fix release notes.

## Best Practices for Deployment

1. **Enable authentication**: Set `CRONBASE_API_TOKEN` to a strong random value
2. **Use TLS**: Deploy behind a reverse proxy with TLS termination
3. **Restrict network access**: Bind to localhost or use firewall rules
4. **Limit database permissions**: `chmod 600` on the `.db` file
5. **Review job commands**: Audit scheduled commands regularly
6. **Use Docker**: The official Docker image runs as a non-root user
