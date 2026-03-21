FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies (none currently, but future-proof the layer)
COPY package.json ./
RUN bun install --production --frozen-lockfile

# Copy source
COPY src/ src/
COPY tsconfig.json ./

# Create non-root user
RUN addgroup -S cronbase && adduser -S cronbase -G cronbase

# Data volume for SQLite database
RUN mkdir -p /data && chown cronbase:cronbase /data
VOLUME /data

# Default port
EXPOSE 7433

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun run src/cli.ts stats > /dev/null 2>&1 || exit 1

ENV CRONBASE_DB=/data/cronbase.db

USER cronbase

ENTRYPOINT ["bun", "run", "src/cli.ts"]
CMD ["start", "--db", "/data/cronbase.db"]
