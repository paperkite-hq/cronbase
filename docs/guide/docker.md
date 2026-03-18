# Docker

cronbase includes a Dockerfile and Docker Compose configuration for containerized deployment.

## Quick start

```bash
docker run -d \
  --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  cronbase
```

The dashboard is available at `http://localhost:7433`.

## Build the image

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
docker build -t cronbase .
```

## With a config file

Mount your config file into the container:

```bash
docker run -d \
  --name cronbase \
  -p 7433:7433 \
  -v cronbase-data:/data \
  -v ./cronbase.yaml:/app/cronbase.yaml \
  cronbase start --db /data/cronbase.db --config /app/cronbase.yaml
```

## Docker Compose

```yaml
services:
  cronbase:
    build: .
    ports:
      - "7433:7433"
    volumes:
      - cronbase-data:/data
      - ./cronbase.yaml:/app/cronbase.yaml
    command: ["start", "--db", "/data/cronbase.db", "--config", "/app/cronbase.yaml"]
    restart: unless-stopped

volumes:
  cronbase-data:
```

```bash
docker compose up -d
```

## Data persistence

SQLite database is stored at `/data/cronbase.db` inside the container. Mount a volume to `/data` to persist data across container restarts.

## Health check

The Docker image includes a built-in health check that hits the `/health` endpoint every 30 seconds.

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' cronbase

# Manual health check
curl http://localhost:7433/health
```

Response:

```json
{
  "status": "ok",
  "totalJobs": 5,
  "enabledJobs": 4,
  "dbSizeBytes": 45056
}
```

## Image details

- Base: `oven/bun:1-alpine`
- Port: `7433`
- Data volume: `/data`
- Entrypoint: `bun run src/cli.ts`
- No external dependencies
