# Contributing to cronbase

Thanks for your interest in contributing! This guide will help you get started.

## Ways to Contribute

Contributions of all kinds are welcome. Here are some areas where help is especially appreciated:

- **New alert channels** — cronbase supports Slack, Discord, generic webhooks, and SMTP. Adding new channels (PagerDuty, Telegram, Microsoft Teams, etc.) is a great way to contribute.
- **CLI improvements** — new commands, better output formatting, shell completions.
- **Dashboard enhancements** — UI polish, accessibility improvements, new views or visualizations.
- **Documentation** — tutorials, examples, typo fixes, better explanations.
- **Bug reports** — reproducible issues with clear steps are incredibly valuable.
- **Testing** — expanding test coverage, edge case tests, platform-specific testing.

## Good First Issues

If you're new to the project, these areas are good starting points:

- **Add a new alert channel**: Each channel is a self-contained module in `src/alerts.ts`. Look at the existing Slack or Discord implementations as a template — a new channel is typically under 100 lines.
- **Add example configurations**: The `examples/` directory has sample YAML/JSON configs. Adding examples for common use cases (database backups, log rotation, health checks) helps new users.
- **Improve error messages**: Run cronbase with an invalid config and see if the error messages are clear. Better validation messages in `src/validation.ts` are always welcome.
- **Write documentation**: The `docs/` directory uses VitePress. Adding a how-to guide or expanding the reference docs is a great first contribution.

## Development Setup

cronbase requires [Bun](https://bun.sh/) v1.0 or later.

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
bun install
```

## Running Locally

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
  smtp.ts       SMTP email alerting
  config.ts     YAML/JSON config file loader
  validation.ts Configuration validation
  types.ts      TypeScript type definitions
  index.ts      Public API exports

tests/          Test files (mirrors src/ structure)
examples/       Example configuration files
docs/           VitePress documentation site
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

cronbase uses [Biome](https://biomejs.dev/) for linting and formatting. Key conventions:

- **TypeScript strict mode** — no `any` types, explicit return types on exported functions.
- **Biome formatting** — run `bun run format` before committing. The pre-commit hook enforces this.
- **Zero runtime dependencies** — only `bun:sqlite` and Node.js built-ins. Think carefully before proposing a new dependency.
- **Conventional commits** — prefix commit messages with `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, or `test:`. Examples:
  - `feat: add PagerDuty alert channel`
  - `fix: handle timezone offset in cron parser`
  - `docs: add backup job example to configuration guide`
- **Test coverage** — new features and bug fixes must include tests. Aim to mirror the `src/` structure in `tests/` (e.g., changes to `src/alerts.ts` should have corresponding tests in `tests/alerts.test.ts`).

## Proposing Larger Changes

For significant changes (new features, architectural refactors, API changes), please **open a discussion or issue first** before investing effort. This helps avoid wasted work and gives a chance to align on direction.

A good proposal includes:
1. **What** you want to change and **why**
2. A rough sketch of the approach
3. Any trade-offs or alternatives you considered

Small bug fixes, documentation improvements, and test additions can go straight to a PR without prior discussion.

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
