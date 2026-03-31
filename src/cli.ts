#!/usr/bin/env bun
/**
 * cronbase CLI — command-line interface for managing cron jobs.
 *
 * Usage:
 *   cronbase start              Start the scheduler
 *   cronbase add <opts>         Add a new job
 *   cronbase list               List all jobs
 *   cronbase show <name>        Show full details of a single job
 *   cronbase edit <name> <opts> Update an existing job
 *   cronbase history [--job N]  Show execution history
 *   cronbase run <name>         Manually trigger a job
 *   cronbase remove <name>      Remove a job
 *   cronbase enable <name>      Enable a job
 *   cronbase disable <name>     Disable a job
 *   cronbase stats              Show summary statistics
 *   cronbase logs <name>        Show output from recent executions
 */

import { loadConfigFile, validateConfigFile } from "./config";
import { describeCron, parseCron } from "./cron";
import { executeJob } from "./executor";
import { Scheduler } from "./scheduler";
import { Store } from "./store";
import type { JobConfig } from "./types";
import { VERSION } from "./types";
import { validateJobConfig, validateSchedule } from "./validation";

const DEFAULT_DB = process.env.CRONBASE_DB ?? "./cronbase.db";

function usage(): void {
	console.log(`cronbase — Beautiful self-hosted cron job manager

Usage:
  cronbase init [--path cronbase.yaml] [--force]          Generate a starter config file
  cronbase start [--port 7433] [--host 127.0.0.1] [--db ./cronbase.db] [--config cronbase.yaml] [--prune-days 90]
                                                       Start scheduler + web UI
  cronbase add --name <name> --schedule <cron> --command <cmd> [options]
  cronbase list                                         List all jobs
  cronbase show <name>                                  Show full details of a single job
  cronbase edit <name> [options]                        Update an existing job
  cronbase history [--job <name>] [--limit 20]          Show execution history
  cronbase run <name>                                   Manually trigger a job
  cronbase remove <name>                                Remove a job
  cronbase enable <name>                                Enable a disabled job
  cronbase disable <name>                               Disable a job
  cronbase stats                                        Show summary statistics
  cronbase logs <name> [--limit 1]                      Show output from recent executions
  cronbase prune [--days 90]                            Prune old execution history
  cronbase validate [--path cronbase.yaml]              Validate a config file (no DB changes)
  cronbase import [--dry-run]                            Import jobs from system crontab
  cronbase export                                        Export jobs as YAML config

Global options:
  --json                 Output in JSON format (list, history, stats, run, export)

Options for 'add':
  --name <name>          Job name (required, must be unique)
  --schedule <cron>      Cron expression or preset (required)
  --command <cmd>        Shell command to execute (required)
  --cwd <dir>            Working directory (default: .)
  --timeout <seconds>    Kill job after N seconds (default: no timeout)
  --retries <count>      Max retry attempts on failure (default: 0)
  --retry-delay <secs>   Base delay for exponential backoff (default: 30)
  --description <text>   Optional description
  --timezone <tz>        IANA timezone (e.g. America/New_York). Overrides CRONBASE_TIMEZONE.
  --disabled             Create job in disabled state

Options for 'edit' (only specified flags are changed):
  --schedule <cron>      New cron expression or preset
  --command <cmd>        New shell command
  --cwd <dir>            New working directory
  --timeout <seconds>    New timeout (0 to remove)
  --retries <count>      New retry count
  --retry-delay <secs>   New backoff delay
  --description <text>   New description
  --timezone <tz>        New timezone
  --enabled              Enable the job
  --disabled             Disable the job

Environment:
  CRONBASE_DB            Database path (default: ./cronbase.db)
`);
}

/** Flags that always consume the next argument as their value.
 * Without this, `--command "--verbose check"` would treat "--verbose check"
 * as a flag (starts with --), silently setting command to "true". */
const VALUE_FLAGS = new Set([
	"name",
	"schedule",
	"command",
	"cwd",
	"timeout",
	"retries",
	"retry-delay",
	"description",
	"timezone",
	"db",
	"port",
	"host",
	"config",
	"prune-days",
	"job",
	"limit",
	"days",
	"path",
	"output",
]);

export function parseArgs(args: string[]): {
	command: string;
	flags: Record<string, string>;
	positional: string[];
} {
	const command = args[0] ?? "help";
	const flags: Record<string, string> = {};
	const positional: string[] = [];

	for (let i = 1; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const arg = args[i].slice(2);
			// Support --key=value syntax (works for any value including those starting with --)
			const eqIdx = arg.indexOf("=");
			if (eqIdx >= 0) {
				flags[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
			} else if (VALUE_FLAGS.has(arg) && i + 1 < args.length) {
				// Known value flag — always consume the next arg regardless of its format
				flags[arg] = args[i + 1];
				i++;
			} else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
				// Unknown flag with a non-flag-looking next arg — treat as value
				flags[arg] = args[i + 1];
				i++;
			} else {
				flags[arg] = "true";
			}
		} else {
			positional.push(args[i]);
		}
	}

	return { command, flags, positional };
}

export function formatDate(iso: string | null): string {
	if (!iso) return "—";
	// Handle both ISO 8601 (with T) and SQLite datetime format (with space)
	const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
	return d.toLocaleString();
}

export function formatDuration(ms: number | null): string {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

export function statusIcon(status: string | null): string {
	switch (status) {
		case "success":
			return "✓";
		case "failed":
			return "✗";
		case "timeout":
			return "⏱";
		case "running":
			return "▶";
		case "skipped":
			return "⏭";
		default:
			return "—";
	}
}

/**
 * Quote a string for safe embedding in YAML.
 * Uses double-quoted scalars when the value contains characters that would
 * be misinterpreted by a YAML parser (colons, hashes, braces, etc.).
 */
export function yamlQuote(value: string): string {
	// Characters that require quoting in unquoted YAML scalars
	const needsQuoting =
		value === "" ||
		/[:#{}[\],!?|>*&%@`"\\]/.test(value) ||
		/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
		/^(true|false|null|~|yes|no|on|off)$/i.test(value) ||
		/^\d/.test(value) ||
		value !== value.trimEnd();
	if (!needsQuoting) return value;
	// Double-quoted scalar: escape backslashes and double-quotes
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Convert alert webhooks to the config shorthand fields (on_failure, on_success, on_complete).
 * Returns only webhooks that map cleanly to a single shorthand key.
 * Complex custom event sets are omitted (they require the API to configure).
 */
function alertsToShorthand(
	webhooks: Array<{ url: string; events: string[] }>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const wh of webhooks) {
		const events = wh.events;
		if (
			events.includes("failed") &&
			events.includes("timeout") &&
			events.length === 2 &&
			!result.on_failure
		) {
			result.on_failure = wh.url;
		} else if (events.includes("success") && events.length === 1 && !result.on_success) {
			result.on_success = wh.url;
		} else if (
			events.includes("success") &&
			events.includes("failed") &&
			events.includes("timeout") &&
			!result.on_complete
		) {
			result.on_complete = wh.url;
		}
	}
	return result;
}

/**
 * Parse a crontab line into a schedule and command.
 * Skips comments, empty lines, and variable assignments (VAR=value).
 */
export function parseCrontabLine(line: string): { schedule: string; command: string } | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return null;
	if (/^[A-Z_]+=/.test(trimmed)) return null;

	const parts = trimmed.split(/\s+/);

	// Handle @preset entries: @daily /path/to/cmd, @hourly script.sh, etc.
	if (parts[0].startsWith("@") && parts.length >= 2) {
		return { schedule: parts[0], command: parts.slice(1).join(" ") };
	}

	if (parts.length < 6) return null;

	const schedule = parts.slice(0, 5).join(" ");
	const command = parts.slice(5).join(" ");
	return { schedule, command };
}

/**
 * Import jobs from the system crontab (crontab -l).
 * Generates unique names from the command.
 */
async function importFromCrontab(
	store: Store | null,
	dryRun: boolean,
): Promise<{
	total: number;
	added: number;
	skipped: number;
	entries: Array<{ name: string; schedule: string; command: string }>;
}> {
	const proc = Bun.spawn(["crontab", "-l"], { stdout: "pipe", stderr: "pipe" });
	const output = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error("No crontab found for current user (crontab -l failed)");
	}

	const lines = output.split("\n");
	const entries: Array<{ name: string; schedule: string; command: string }> = [];
	const usedNames = new Set<string>();

	for (const line of lines) {
		const parsed = parseCrontabLine(line);
		if (!parsed) continue;

		let baseName = parsed.command
			.replace(/[^a-zA-Z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.toLowerCase()
			.slice(0, 40);
		if (!baseName) baseName = "imported-job";

		let name = baseName;
		let counter = 2;
		while (usedNames.has(name)) {
			name = `${baseName}-${counter}`;
			counter++;
		}
		usedNames.add(name);

		entries.push({ name, schedule: parsed.schedule, command: parsed.command });
	}

	let added = 0;
	let skipped = 0;

	if (!dryRun && store) {
		for (const entry of entries) {
			const existing = store.getJobByName(entry.name);
			if (existing) {
				skipped++;
				continue;
			}
			try {
				store.addJob({
					name: entry.name,
					schedule: entry.schedule,
					command: entry.command,
					description: "Imported from crontab",
				});
				added++;
			} catch (e) {
				console.warn(`  Warning: skipped "${entry.name}": ${(e as Error).message}`);
				skipped++;
			}
		}
	}

	return { total: entries.length, added, skipped, entries };
}

/**
 * Run a CLI command. Returns an exit code (0 = success).
 * Exported for in-process testing — subprocess tests can't track coverage.
 * The `start` command is excluded (it blocks forever with signal handlers).
 */
export async function runCommand(
	command: string,
	flags: Record<string, string>,
	positional: string[],
): Promise<number> {
	const dbPath = flags.db ?? DEFAULT_DB;

	if (
		flags.version === "true" ||
		command === "version" ||
		command === "--version" ||
		command === "-v"
	) {
		console.log(`cronbase v${VERSION}`);
		return 0;
	}

	switch (command) {
		case "init": {
			const outputPath = flags.path ?? "cronbase.yaml";
			const force = flags.force === "true";

			// Check if file already exists
			if (!force && (await Bun.file(outputPath).exists())) {
				console.error(`Error: ${outputPath} already exists. Use --force to overwrite.`);
				return 1;
			}

			const configContent = `# cronbase configuration
# Documentation: https://github.com/paperkite-hq/cronbase
#
# Security: set CRONBASE_API_TOKEN to protect the API and dashboard:
#   export CRONBASE_API_TOKEN=$(openssl rand -hex 32)
#
# Alerting: add on_failure / on_success to any job to get notified when it
# fails or succeeds. Paste a Slack, Discord, or any HTTP webhook URL and
# cronbase will POST a JSON payload with job details. Recommended for all
# jobs that run unattended — alerting is what turns a cron job into a
# monitored process.

jobs:
  # Database backup — runs nightly at 2 AM
  - name: backup-db
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db-$(date +%Y%m%d).sql
    timeout: 300
    retry:
      maxAttempts: 2
      baseDelay: 60
    description: Nightly database backup
    # Uncomment and fill in your webhook URL to get alerted on failure:
    # on_failure: https://hooks.slack.com/services/T.../B.../xxx

  # Health check — every 5 minutes
  - name: health-check
    schedule: "*/5 * * * *"
    command: curl -sf http://localhost:3000/health || exit 1
    timeout: 30
    description: Application health check
    # Uncomment and fill in your webhook URL to get alerted on failure:
    # on_failure: https://discord.com/api/webhooks/xxx/yyy

  # Log cleanup — daily at midnight
  - name: cleanup-logs
    schedule: "@daily"
    command: find /var/log/myapp -name '*.log' -mtime +30 -delete
    description: Remove old log files

  # Weekly report — every Monday at 9 AM
  - name: weekly-report
    schedule: "0 9 * * 1"
    command: ./scripts/generate-report.sh
    timeout: 600
    description: Generate and email weekly report
    # Uncomment and fill in your webhook URL to get notified on success:
    # on_success: https://hooks.slack.com/services/T.../B.../xxx
`;

			await Bun.write(outputPath, configContent);
			console.log(`✓ Created ${outputPath}`);
			console.log();
			console.log("Next steps:");
			console.log(`  1. Edit ${outputPath} to define your jobs`);
			console.log(`  2. (Recommended) Set an API token to protect the dashboard:`);
			console.log(`     export CRONBASE_API_TOKEN=$(openssl rand -hex 32)`);
			console.log(`  3. Start the scheduler:`);
			console.log(`     cronbase start --config ${outputPath}`);
			console.log(`  4. Open http://localhost:7433 to view the dashboard`);
			return 0;
		}

		case "start": {
			const port = Number(flags.port) || 7433;
			const hostname = flags.host;
			const configPath = flags.config;
			const pruneAfterDays = flags["prune-days"] ? Number(flags["prune-days"]) : undefined;
			const scheduler = new Scheduler({ dbPath, port, hostname, pruneAfterDays });

			// Load config file if provided
			if (configPath) {
				try {
					const result = loadConfigFile(configPath, scheduler.getStore());
					console.log(`[cronbase] Config loaded: ${result.added} added, ${result.updated} updated`);
				} catch (e) {
					console.error(`[cronbase] Config error: ${(e as Error).message}`);
					return 1;
				}
			}

			scheduler.start();

			const jobs = scheduler.getStore().listJobs();
			console.log(`[cronbase] ${jobs.length} jobs loaded`);

			// Graceful shutdown — wait for active jobs to finish
			let shuttingDown = false;
			const shutdown = async () => {
				if (shuttingDown) return; // prevent double-shutdown
				shuttingDown = true;
				console.log("\n[cronbase] Shutting down...");
				await scheduler.close();
				process.exit(0);
			};
			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);

			// Keep alive
			await new Promise(() => {}); // never resolves
			return 0; // unreachable but satisfies TypeScript
		}

		case "add": {
			if (!flags.name || !flags.schedule || !flags.command) {
				console.error("Error: --name, --schedule, and --command are required");
				console.error("Run 'cronbase add --help' for usage");
				return 1;
			}

			const store = new Store(dbPath);
			try {
				const config: JobConfig = {
					name: flags.name,
					schedule: flags.schedule,
					command: flags.command,
					cwd: flags.cwd,
					timeout: flags.timeout ? Number(flags.timeout) : undefined,
					retry: flags.retries
						? { maxAttempts: Number(flags.retries), baseDelay: Number(flags["retry-delay"] ?? 30) }
						: undefined,
					description: flags.description,
					timezone: flags.timezone,
					enabled: flags.disabled !== "true",
				};

				// Validate all fields (name pattern, command length, env vars, schedule, etc.)
				const validationError = validateJobConfig(config as unknown as Record<string, unknown>);
				if (validationError) {
					console.error(`Error: ${validationError.message}`);
					return 1;
				}
				const scheduleError = validateSchedule(flags.schedule, parseCron);
				if (scheduleError) {
					console.error(`Error: ${scheduleError.message}`);
					return 1;
				}

				// Check for duplicate name before insert (same as API — avoids raw SQLite error)
				const existing = store.getJobByName(flags.name);
				if (existing) {
					console.error(`Error: A job named "${flags.name}" already exists`);
					return 1;
				}

				const job = store.addJob(config);
				console.log(`✓ Job added: ${job.name}`);
				console.log(`  Schedule: ${job.schedule} (${describeCron(job.schedule)})`);
				console.log(`  Command:  ${job.command}`);
				console.log(`  Next run: ${formatDate(job.nextRun)}`);
				return 0;
			} catch (e) {
				console.error(`Error: ${(e as Error).message}`);
				return 1;
			} finally {
				store.close();
			}
		}

		case "edit": {
			const name = positional[0] ?? flags.name;
			if (!name) {
				console.error("Error: Job name required. Usage: cronbase edit <name> [options]");
				return 1;
			}

			const store = new Store(dbPath);
			try {
				const job = store.getJobByName(name);
				if (!job) {
					console.error(`Error: Job "${name}" not found`);
					return 1;
				}

				// Build partial update from provided flags
				const updates: Partial<JobConfig> = {};
				if ("schedule" in flags) updates.schedule = flags.schedule;
				if ("command" in flags) updates.command = flags.command;
				if ("cwd" in flags) updates.cwd = flags.cwd;
				if ("timeout" in flags) updates.timeout = Number(flags.timeout);
				if ("description" in flags) updates.description = flags.description;
				if ("timezone" in flags) updates.timezone = flags.timezone;
				if ("retries" in flags || "retry-delay" in flags) {
					updates.retry = {
						maxAttempts: "retries" in flags ? Number(flags.retries) : job.retry.maxAttempts,
						baseDelay: "retry-delay" in flags ? Number(flags["retry-delay"]) : job.retry.baseDelay,
					};
				}
				if (flags.disabled === "true") updates.enabled = false;
				if (flags.enabled === "true") updates.enabled = true;

				if (Object.keys(updates).length === 0) {
					console.error(
						"Error: No changes specified. Use flags like --schedule, --command, --timeout, etc.",
					);
					return 1;
				}

				// Validate changed fields merged with existing values
				const merged = {
					name: job.name,
					command: updates.command ?? job.command,
					description: updates.description ?? job.description,
					timeout: updates.timeout ?? job.timeout,
					env: job.env,
					tags: job.tags,
					cwd: updates.cwd ?? job.cwd,
					retry: updates.retry ?? job.retry,
				};
				const validationError = validateJobConfig(merged as unknown as Record<string, unknown>);
				if (validationError) {
					console.error(`Error: ${validationError.message}`);
					return 1;
				}
				if (updates.schedule) {
					const scheduleError = validateSchedule(updates.schedule, parseCron);
					if (scheduleError) {
						console.error(`Error: ${scheduleError.message}`);
						return 1;
					}
				}

				store.updateJob(job.id, updates);
				const updated = store.getJobByName(name);
				console.log(`✓ Updated: ${name}`);
				if (updates.schedule && updated) {
					console.log(`  Schedule: ${updated.schedule} (${describeCron(updated.schedule)})`);
					console.log(`  Next run: ${formatDate(updated.nextRun)}`);
				}
				if (updates.command) console.log(`  Command:  ${updates.command}`);
				if (updates.timeout !== undefined)
					console.log(`  Timeout:  ${updates.timeout > 0 ? `${updates.timeout}s` : "none"}`);
				if (updates.enabled !== undefined)
					console.log(`  Enabled:  ${updates.enabled ? "yes" : "no"}`);
				return 0;
			} catch (e) {
				console.error(`Error: ${(e as Error).message}`);
				return 1;
			} finally {
				store.close();
			}
		}

		case "list": {
			const store = new Store(dbPath);
			try {
				const jobs = store.listJobs();
				const jsonOutput = flags.json === "true" || flags.output === "json";

				if (jsonOutput) {
					console.log(JSON.stringify(jobs, null, 2));
					return 0;
				}

				if (jobs.length === 0) {
					console.log("No jobs defined. Use 'cronbase add' to create one.");
					return 0;
				}

				console.log(
					`${"Name".padEnd(25)} ${"Schedule".padEnd(20)} ${"Status".padEnd(10)} ${"Last Run".padEnd(22)} Next Run`,
				);
				console.log("─".repeat(100));

				for (const job of jobs) {
					const enabled = job.enabled ? "" : " (disabled)";
					console.log(
						`${(job.name + enabled).padEnd(25)} ${job.schedule.padEnd(20)} ${(`${statusIcon(job.lastStatus)} ${job.lastStatus ?? "never"}`).padEnd(10)} ${formatDate(job.lastRun).padEnd(22)} ${formatDate(job.nextRun)}`,
					);
				}

				console.log(`\n${jobs.length} job(s)`);
				return 0;
			} finally {
				store.close();
			}
		}

		case "show": {
			const name = positional[0] ?? flags.name;
			if (!name) {
				console.error("Error: Job name required. Usage: cronbase show <name>");
				return 1;
			}

			const store = new Store(dbPath);
			try {
				const job = store.getJobByName(name);
				if (!job) {
					console.error(`Error: Job "${name}" not found`);
					return 1;
				}

				const jsonOutput = flags.json === "true" || flags.output === "json";

				if (jsonOutput) {
					console.log(JSON.stringify(job, null, 2));
					return 0;
				}

				console.log(`Job: ${job.name}`);
				if (job.description) console.log(`Description: ${job.description}`);
				console.log(`Enabled: ${job.enabled ? "yes" : "no"}`);
				console.log();
				console.log(`Schedule: ${job.schedule} (${describeCron(job.schedule)})`);
				if (job.timezone) console.log(`Timezone: ${job.timezone}`);
				console.log(`Command: ${job.command}`);
				console.log(`Working dir: ${job.cwd}`);
				console.log();
				console.log(`Next run: ${formatDate(job.nextRun)}`);
				console.log(`Last run: ${formatDate(job.lastRun)}`);
				console.log(`Last status: ${statusIcon(job.lastStatus)} ${job.lastStatus ?? "never run"}`);
				console.log();
				console.log(`Timeout: ${job.timeout > 0 ? `${job.timeout}s` : "none"}`);
				console.log(
					`Retries: ${job.retry.maxAttempts > 0 ? `${job.retry.maxAttempts} (delay: ${job.retry.baseDelay}s)` : "none"}`,
				);
				if (job.tags.length > 0) console.log(`Tags: ${job.tags.join(", ")}`);
				if (Object.keys(job.env).length > 0) console.log(`Env: ${Object.keys(job.env).join(", ")}`);
				console.log();
				console.log(`Created: ${formatDate(job.createdAt)}`);

				return 0;
			} finally {
				store.close();
			}
		}

		case "history": {
			const store = new Store(dbPath);
			try {
				const limit = Number(flags.limit) || 20;
				const jsonOutput = flags.json === "true" || flags.output === "json";

				let jobId: number | undefined;
				if (flags.job) {
					const job = store.getJobByName(flags.job);
					if (!job) {
						console.error(`Error: Job "${flags.job}" not found`);
						return 1;
					}
					jobId = job.id;
				}

				const execs = store.getExecutions({ jobId, limit });

				if (jsonOutput) {
					console.log(JSON.stringify(execs, null, 2));
					return 0;
				}

				if (execs.length === 0) {
					console.log("No execution history.");
					return 0;
				}

				console.log(
					`${"Job".padEnd(20)} ${"Status".padEnd(10)} ${"Duration".padEnd(10)} ${"Exit".padEnd(6)} ${"Attempt".padEnd(8)} Started`,
				);
				console.log("─".repeat(90));

				for (const exec of execs) {
					console.log(
						`${exec.jobName.padEnd(20)} ${(`${statusIcon(exec.status)} ${exec.status}`).padEnd(10)} ${formatDuration(exec.durationMs).padEnd(10)} ${String(exec.exitCode ?? "—").padEnd(6)} ${String(exec.attempt).padEnd(8)} ${formatDate(exec.startedAt)}`,
					);
				}

				return 0;
			} finally {
				store.close();
			}
		}

		case "logs": {
			const name = positional[0] ?? flags.name;
			if (!name) {
				console.error("Error: Job name required. Usage: cronbase logs <name>");
				return 1;
			}

			const store = new Store(dbPath);
			try {
				const job = store.getJobByName(name);
				if (!job) {
					console.error(`Error: Job "${name}" not found`);
					return 1;
				}

				const limit = Number(flags.limit) || 1;
				const jsonOutput = flags.json === "true" || flags.output === "json";
				const execs = store.getExecutions({ jobId: job.id, limit });

				if (execs.length === 0) {
					console.log(`No executions found for "${name}".`);
					return 0;
				}

				if (jsonOutput) {
					console.log(
						JSON.stringify(
							execs.map((e) => ({
								id: e.id,
								status: e.status,
								exitCode: e.exitCode,
								durationMs: e.durationMs,
								startedAt: e.startedAt,
								finishedAt: e.finishedAt,
								stdout: e.stdout,
								stderr: e.stderr,
							})),
							null,
							2,
						),
					);
					return 0;
				}

				for (let i = 0; i < execs.length; i++) {
					const exec = execs[i];
					if (execs.length > 1) {
						console.log(
							`── ${statusIcon(exec.status)} ${exec.status} (${formatDuration(exec.durationMs)}, exit ${exec.exitCode ?? "—"}) at ${formatDate(exec.startedAt)} ──`,
						);
					} else {
						console.log(
							`${statusIcon(exec.status)} ${exec.status} (${formatDuration(exec.durationMs)}, exit ${exec.exitCode ?? "—"}) at ${formatDate(exec.startedAt)}`,
						);
					}

					if (exec.stdout.trim()) {
						if (exec.stderr.trim()) console.log("\n--- stdout ---");
						console.log(exec.stdout.trim());
					}
					if (exec.stderr.trim()) {
						if (exec.stdout.trim()) console.log("\n--- stderr ---");
						else console.log("--- stderr ---");
						console.log(exec.stderr.trim());
					}
					if (!exec.stdout.trim() && !exec.stderr.trim()) {
						console.log("(no output)");
					}

					if (i < execs.length - 1) console.log();
				}

				return 0;
			} finally {
				store.close();
			}
		}

		case "run": {
			const name = positional[0] ?? flags.name;
			if (!name) {
				console.error("Error: Job name required. Usage: cronbase run <name>");
				return 1;
			}

			const store = new Store(dbPath);
			try {
				const job = store.getJobByName(name);
				if (!job) {
					console.error(`Error: Job "${name}" not found`);
					return 1;
				}

				const jsonOutput = flags.json === "true" || flags.output === "json";

				if (!jsonOutput) {
					console.log(`Running: ${job.name} (${job.command})`);
				}
				const result = await executeJob(job, store);

				if (jsonOutput) {
					console.log(JSON.stringify(result, null, 2));
				} else {
					console.log(
						`${statusIcon(result.status)} ${result.status} (${formatDuration(result.durationMs)}, exit ${result.exitCode})`,
					);

					if (result.stdout.trim()) {
						console.log("\n--- stdout ---");
						console.log(result.stdout.trim());
					}
					if (result.stderr.trim()) {
						console.log("\n--- stderr ---");
						console.log(result.stderr.trim());
					}
				}

				return result.status === "success" ? 0 : 1;
			} finally {
				store.close();
			}
		}

		case "remove": {
			const name = positional[0] ?? flags.name;
			if (!name) {
				console.error("Error: Job name required. Usage: cronbase remove <name>");
				return 1;
			}

			const store = new Store(dbPath);
			try {
				const job = store.getJobByName(name);
				if (!job) {
					console.error(`Error: Job "${name}" not found`);
					return 1;
				}
				store.deleteJob(job.id);
				console.log(`✓ Removed: ${name}`);
				return 0;
			} finally {
				store.close();
			}
		}

		case "enable": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Job name required");
				return 1;
			}
			const store = new Store(dbPath);
			try {
				const job = store.getJobByName(name);
				if (!job) {
					console.error(`Error: Job "${name}" not found`);
					return 1;
				}
				store.toggleJob(job.id, true);
				console.log(`✓ Enabled: ${name}`);
				return 0;
			} finally {
				store.close();
			}
		}

		case "disable": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Job name required");
				return 1;
			}
			const store = new Store(dbPath);
			try {
				const job = store.getJobByName(name);
				if (!job) {
					console.error(`Error: Job "${name}" not found`);
					return 1;
				}
				store.toggleJob(job.id, false);
				console.log(`✓ Disabled: ${name}`);
				return 0;
			} finally {
				store.close();
			}
		}

		case "stats": {
			const store = new Store(dbPath);
			try {
				const stats = store.getStats();
				const jsonOutput = flags.json === "true" || flags.output === "json";

				if (jsonOutput) {
					const successRate =
						stats.recentSuccesses + stats.recentFailures > 0
							? Number(
									(
										(stats.recentSuccesses / (stats.recentSuccesses + stats.recentFailures)) *
										100
									).toFixed(1),
								)
							: null;
					console.log(JSON.stringify({ ...stats, successRate }, null, 2));
					return 0;
				}

				console.log(`Jobs:      ${stats.totalJobs} total, ${stats.enabledJobs} enabled`);
				console.log(
					`Last 24h:  ${stats.recentSuccesses} successes, ${stats.recentFailures} failures`,
				);
				const rate =
					stats.recentSuccesses + stats.recentFailures > 0
						? (
								(stats.recentSuccesses / (stats.recentSuccesses + stats.recentFailures)) *
								100
							).toFixed(1)
						: "—";
				console.log(`Success:   ${rate}%`);
				return 0;
			} finally {
				store.close();
			}
		}

		case "import": {
			const dryRun = flags["dry-run"] === "true";
			const store = dryRun ? null : new Store(dbPath);
			try {
				const result = await importFromCrontab(store, dryRun);
				if (dryRun) {
					console.log(`Found ${result.total} crontab entries:`);
					for (const entry of result.entries) {
						console.log(`  ${entry.name}: ${entry.schedule} → ${entry.command}`);
					}
					console.log(`\nRun without --dry-run to import.`);
				} else {
					console.log(
						`✓ Imported ${result.added} job(s), skipped ${result.skipped} (already exist)`,
					);
				}
				return 0;
			} catch (e) {
				console.error(`Error: ${(e as Error).message}`);
				return 1;
			} finally {
				store?.close();
			}
		}

		case "validate": {
			const configPath = flags.path ?? "cronbase.yaml";
			const errors = validateConfigFile(configPath);
			if (errors.length === 0) {
				// Count jobs by re-reading to show a helpful summary
				const { existsSync: fsExists, readFileSync: fsRead } = await import("node:fs");
				let jobCount = 0;
				if (fsExists(configPath)) {
					try {
						const { parseSimpleYaml } = await import("./config");
						const content = fsRead(configPath, "utf-8");
						const cfg = parseSimpleYaml(content);
						jobCount = cfg.jobs?.length ?? 0;
					} catch {
						// ignore — errors would have been caught above
					}
				}
				console.log(`✓ ${configPath} is valid (${jobCount} job${jobCount === 1 ? "" : "s"})`);
				return 0;
			}
			for (const err of errors) {
				const prefix = err.job ? `  ${err.job} [${err.field}]` : `  [${err.field}]`;
				console.error(`✗ ${prefix}: ${err.message}`);
			}
			console.error(
				`\n${errors.length} error${errors.length === 1 ? "" : "s"} found in ${configPath}`,
			);
			return 1;
		}

		case "prune": {
			const store = new Store(dbPath);
			try {
				const days = flags.days != null ? Number(flags.days) : 90;
				const deleted = store.pruneExecutions(days);
				console.log(`✓ Pruned ${deleted} execution(s) older than ${days} days`);
				return 0;
			} finally {
				store.close();
			}
		}

		case "export": {
			const store = new Store(dbPath);
			try {
				const jobs = store.listJobs();
				const jsonOutput = flags.json === "true" || flags.output === "json";

				if (jobs.length === 0) {
					if (jsonOutput) {
						console.log(JSON.stringify({ jobs: [] }, null, 2));
					} else {
						console.log("# No jobs to export");
					}
					return 0;
				}

				if (jsonOutput) {
					const exportData = {
						jobs: jobs.map((job) => {
							const entry: Record<string, unknown> = {
								name: job.name,
								schedule: job.schedule,
								command: job.command,
							};
							if (job.cwd && job.cwd !== ".") entry.cwd = job.cwd;
							if (job.timeout > 0) entry.timeout = job.timeout;
							if (job.retry.maxAttempts > 0) {
								entry.retry = {
									maxAttempts: job.retry.maxAttempts,
									...(job.retry.baseDelay !== 30 ? { baseDelay: job.retry.baseDelay } : {}),
								};
							}
							if (job.description) entry.description = job.description;
							if (job.tags.length > 0) entry.tags = job.tags;
							if (!job.enabled) entry.enabled = false;
							if (Object.keys(job.env).length > 0) entry.env = job.env;
							const alertConfig = store.getJobAlert(job.id);
							if (alertConfig?.webhooks?.length) {
								const shortcuts = alertsToShorthand(alertConfig.webhooks);
								Object.assign(entry, shortcuts);
							}
							return entry;
						}),
					};
					console.log(JSON.stringify(exportData, null, 2));
					return 0;
				}

				const yamlLines: string[] = ["jobs:"];
				for (const job of jobs) {
					yamlLines.push(`  - name: ${job.name}`);
					yamlLines.push(`    schedule: "${job.schedule}"`);
					// Use block scalar for multiline commands
					if (job.command.includes("\n")) {
						yamlLines.push("    command: |");
						for (const cmdLine of job.command.split("\n")) {
							yamlLines.push(`      ${cmdLine}`);
						}
					} else {
						yamlLines.push(`    command: ${yamlQuote(job.command)}`);
					}
					if (job.cwd && job.cwd !== ".") {
						yamlLines.push(`    cwd: ${yamlQuote(job.cwd)}`);
					}
					if (job.timeout > 0) {
						yamlLines.push(`    timeout: ${job.timeout}`);
					}
					if (job.retry.maxAttempts > 0) {
						yamlLines.push("    retry:");
						yamlLines.push(`      maxAttempts: ${job.retry.maxAttempts}`);
						if (job.retry.baseDelay !== 30) {
							yamlLines.push(`      baseDelay: ${job.retry.baseDelay}`);
						}
					}
					if (job.description) {
						yamlLines.push(`    description: ${yamlQuote(job.description)}`);
					}
					if (job.tags.length > 0) {
						yamlLines.push(`    tags: [${job.tags.join(", ")}]`);
					}
					if (!job.enabled) {
						yamlLines.push("    enabled: false");
					}
					if (Object.keys(job.env).length > 0) {
						yamlLines.push("    env:");
						for (const [k, v] of Object.entries(job.env)) {
							yamlLines.push(`      ${k}: ${yamlQuote(v)}`);
						}
					}
					// Export alert config if present
					const alertConfig = store.getJobAlert(job.id);
					if (alertConfig?.webhooks?.length) {
						const shortcuts = alertsToShorthand(alertConfig.webhooks);
						for (const [key, url] of Object.entries(shortcuts)) {
							yamlLines.push(`    ${key}: ${url}`);
						}
					}
				}

				console.log(yamlLines.join("\n"));
				return 0;
			} finally {
				store.close();
			}
		}

		case "help":
		case "--help":
		case "-h":
			usage();
			return 0;

		default:
			console.error(`Unknown command: ${command}`);
			usage();
			return 1;
	}
}

async function main(): Promise<void> {
	const { command, flags, positional } = parseArgs(process.argv.slice(2));
	const exitCode = await runCommand(command, flags, positional);
	if (exitCode !== 0) {
		process.exit(exitCode);
	}
}

main().catch((error) => {
	console.error("Fatal:", error);
	process.exit(1);
});
