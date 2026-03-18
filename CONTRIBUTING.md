# Contributing to cronbase

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

cronbase requires [Bun](https://bun.sh/) v1.0 or later.

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
bun install
```

## Running locally

```bash
# Start the scheduler + dashboard in watch mode
bun run dev

# Run tests
bun test

# Lint and format
bun run check
bun run format
```

## Project Structure

```
src/
  cli.ts        Command-line interface
  cron.ts       Cron expression parser and scheduler
  executor.ts   Job execution (spawn, timeout, retry)
  scheduler.ts  Polling loop and lifecycle management
  store.ts      SQLite database layer (bun:sqlite)
  server.ts     HTTP server + embedded web dashboard
  alerts.ts     Webhook alerting (Slack, Discord, generic)
  config.ts     YAML/JSON config file loader
  types.ts      TypeScript type definitions
  index.ts      Public API exports

tests/          Test files (mirrors src/ structure)
examples/       Example configuration files
```

## Running Tests

```bash
# All tests
bun test

# Specific test file
bun test tests/cron.test.ts

# Watch mode
bun test --watch
```

## Code Style

- TypeScript with strict mode
- Formatted with [Biome](https://biomejs.dev/)
- No external runtime dependencies — only `bun:sqlite` and Node.js built-ins
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`

## Pull Request Guidelines

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure all tests pass: `bun test`
4. Ensure code passes lint: `bun run check`
5. Write a clear PR description explaining the change

## Reporting Issues

Please include:
- cronbase version and Bun version
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license.
