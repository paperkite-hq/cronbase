#!/usr/bin/env bun
/**
 * cronbase CLI — command-line interface for managing cron jobs.
 *
 * Usage:
 *   cronbase start              Start the scheduler
 *   cronbase add <opts>         Add a new job
 *   cronbase list               List all jobs
 *   cronbase history [--job N]  Show execution history
 *   cronbase run <name>         Manually trigger a job
 *   cronbase remove <name>      Remove a job
 *   cronbase enable <name>      Enable a job
 *   cronbase disable <name>     Disable a job
 *   cronbase stats              Show summary statistics
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
  cronbase history [--job <name>] [--limit 20]          Show execution history
  cronbase run <name>                                   Manually trigger a job
  cronbase remove <name>                                Remove a job
  cronbase enable <name>                                Enable a disabled job
  cronbase disable <name>                               Disable a job
  cronbase stats                                        Show summary statistics
  cronbase prune [--days 90]                            Prune old execution history
  cronbase validate [--path cronbase.yaml]              Validate a config file (no DB changes)
  cronbase import [--dry-run]                            Import jobs from system crontab
  cronbase export                                        Export jobs as YAML config

Options for 'add':
  --name <name>          Job name (required, must be unique)
  --schedule <cron>      Cron expression or preset (required)
  --command <cmd>        Shell command to execute (required)
  --cwd <dir>            Working directory (default: .)
  --timeout <seconds>    Kill job after N seconds (default: no timeout)
  --retries <count>      Max retry attempts on failure (default: 0)
  --retry-delay <secs>   Base delay for exponential backoff (default: 30)
  --description <text>   Optional description
  --disabled             Create job in disabled state

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
	"db",
	"port",
	"host",
	"config",
	"prune-days",
	"job",
	"limit",
	"days",
	"path",
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

async function main(): Promise<void> {
	const { command, flags, positional } = parseArgs(process.argv.slice(2));

	if (
		flags.version === "true" ||
		command === "version" ||
		command === "--version" ||
		command === "-v"
	) {
		console.log(`cronbase v${VERSION}`);
		return;
	}

	switch (command) {
		case "init": {
			const outputPath = flags.path ?? "cronbase.yaml";
			const force = flags.force === "true";

			// Check if file already exists
			if (!force && (await Bun.file(outputPath).exists())) {
				console.error(`Error: ${outputPath} already exists. Use --force to overwrite.`);
				process.exit(1);
			}

			const configContent = `# cronbase configuration
# Documentation: https://github.com/paperkite-hq/cronbase

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
    # on_failure: https://hooks.slack.com/services/T.../B.../xxx

  # Health check — every 5 minutes
  - name: health-check
    schedule: "*/5 * * * *"
    command: curl -sf http://localhost:3000/health || exit 1
    timeout: 30
    description: Application health check
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
    # on_success: https://hooks.slack.com/services/T.../B.../xxx
`;

			await Bun.write(outputPath, configContent);
			console.log(`✓ Created ${outputPath}`);
			console.log();
			console.log("Next steps:");
			console.log(`  1. Edit ${outputPath} to define your jobs`);
			console.log(`  2. Start the scheduler:`);
			console.log(`     cronbase start --config ${outputPath}`);
			console.log(`  3. Open http://localhost:7433 to view the dashboard`);
			break;
		}

		case "start": {
			const port = Number(flags.port) || 7433;
			const hostname = flags.host;
			const dbPath = flags.db ?? DEFAULT_DB;
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
					process.exit(1);
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
			break;
		}

		case "add": {
			if (!flags.name || !flags.schedule || !flags.command) {
				console.error("Error: --name, --schedule, and --command are required");
				console.error("Run 'cronbase add --help' for usage");
				process.exit(1);
			}

			const store = new Store(flags.db ?? DEFAULT_DB);
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
				enabled: flags.disabled !== "true",
			};

			// Validate all fields (name pattern, command length, env vars, schedule, etc.)
			const validationError = validateJobConfig(config as unknown as Record<string, unknown>);
			if (validationError) {
				console.error(`Error: ${validationError.message}`);
				process.exit(1);
			}
			const scheduleError = validateSchedule(flags.schedule, parseCron);
			if (scheduleError) {
				console.error(`Error: ${scheduleError.message}`);
				process.exit(1);
			}

			// Check for duplicate name before insert (same as API — avoids raw SQLite error)
			const existing = store.getJobByName(flags.name);
			if (existing) {
				console.error(`Error: A job named "${flags.name}" already exists`);
				process.exit(1);
			}

			try {
				const job = store.addJob(config);
				console.log(`✓ Job added: ${job.name}`);
				console.log(`  Schedule: ${job.schedule} (${describeCron(job.schedule)})`);
				console.log(`  Command:  ${job.command}`);
				console.log(`  Next run: ${formatDate(job.nextRun)}`);
			} catch (e) {
				console.error(`Error: ${(e as Error).message}`);
				process.exit(1);
			}
			store.close();
			break;
		}

		case "list": {
			const store = new Store(flags.db ?? DEFAULT_DB);
			const jobs = store.listJobs();

			if (jobs.length === 0) {
				console.log("No jobs defined. Use 'cronbase add' to create one.");
				store.close();
				return;
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
			store.close();
			break;
		}

		case "history": {
			const store = new Store(flags.db ?? DEFAULT_DB);
			const limit = Number(flags.limit) || 20;

			let jobId: number | undefined;
			if (flags.job) {
				const job = store.getJobByName(flags.job);
				if (!job) {
					console.error(`Error: Job "${flags.job}" not found`);
					process.exit(1);
				}
				jobId = job.id;
			}

			const execs = store.getExecutions({ jobId, limit });

			if (execs.length === 0) {
				console.log("No execution history.");
				store.close();
				return;
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

			store.close();
			break;
		}

		case "run": {
			const name = positional[0] ?? flags.name;
			if (!name) {
				console.error("Error: Job name required. Usage: cronbase run <name>");
				process.exit(1);
			}

			const store = new Store(flags.db ?? DEFAULT_DB);
			const job = store.getJobByName(name);
			if (!job) {
				console.error(`Error: Job "${name}" not found`);
				process.exit(1);
			}

			console.log(`Running: ${job.name} (${job.command})`);
			const result = await executeJob(job, store);
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

			store.close();
			process.exit(result.status === "success" ? 0 : 1);
			break;
		}

		case "remove": {
			const name = positional[0] ?? flags.name;
			if (!name) {
				console.error("Error: Job name required. Usage: cronbase remove <name>");
				process.exit(1);
			}

			const store = new Store(flags.db ?? DEFAULT_DB);
			const job = store.getJobByName(name);
			if (!job) {
				console.error(`Error: Job "${name}" not found`);
				process.exit(1);
			}
			store.deleteJob(job.id);
			console.log(`✓ Removed: ${name}`);
			store.close();
			break;
		}

		case "enable": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Job name required");
				process.exit(1);
			}
			const store = new Store(flags.db ?? DEFAULT_DB);
			const job = store.getJobByName(name);
			if (!job) {
				console.error(`Error: Job "${name}" not found`);
				process.exit(1);
			}
			store.toggleJob(job.id, true);
			console.log(`✓ Enabled: ${name}`);
			store.close();
			break;
		}

		case "disable": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Job name required");
				process.exit(1);
			}
			const store = new Store(flags.db ?? DEFAULT_DB);
			const job = store.getJobByName(name);
			if (!job) {
				console.error(`Error: Job "${name}" not found`);
				process.exit(1);
			}
			store.toggleJob(job.id, false);
			console.log(`✓ Disabled: ${name}`);
			store.close();
			break;
		}

		case "stats": {
			const store = new Store(flags.db ?? DEFAULT_DB);
			const stats = store.getStats();
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
			store.close();
			break;
		}

		case "import": {
			const dryRun = flags["dry-run"] === "true";
			const store = dryRun ? null : new Store(flags.db ?? DEFAULT_DB);
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
			} catch (e) {
				console.error(`Error: ${(e as Error).message}`);
				process.exit(1);
			}
			store?.close();
			break;
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
			} else {
				for (const err of errors) {
					const prefix = err.job ? `  ${err.job} [${err.field}]` : `  [${err.field}]`;
					console.error(`✗ ${prefix}: ${err.message}`);
				}
				console.error(
					`\n${errors.length} error${errors.length === 1 ? "" : "s"} found in ${configPath}`,
				);
				process.exit(1);
			}
			break;
		}

		case "prune": {
			const days = flags.days != null ? Number(flags.days) : 90;
			const store = new Store(flags.db ?? DEFAULT_DB);
			const deleted = store.pruneExecutions(days);
			console.log(`✓ Pruned ${deleted} execution(s) older than ${days} days`);
			store.close();
			break;
		}

		case "export": {
			const store = new Store(flags.db ?? DEFAULT_DB);
			const jobs = store.listJobs();
			if (jobs.length === 0) {
				console.log("# No jobs to export");
				store.close();
				return;
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
					yamlLines.push(`    command: ${job.command}`);
				}
				if (job.cwd && job.cwd !== ".") {
					yamlLines.push(`    cwd: ${job.cwd}`);
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
					yamlLines.push(`    description: ${job.description}`);
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
						yamlLines.push(`      ${k}: ${v}`);
					}
				}
				// Export alert config if present
				const alertConfig = store.getJobAlert(job.id);
				if (alertConfig?.webhooks) {
					for (const wh of alertConfig.webhooks) {
						const events = wh.events;
						if (events.includes("failed") && events.includes("timeout") && events.length === 2) {
							yamlLines.push(`    on_failure: ${wh.url}`);
						} else if (events.includes("success") && events.length === 1) {
							yamlLines.push(`    on_success: ${wh.url}`);
						} else if (
							events.includes("success") &&
							events.includes("failed") &&
							events.includes("timeout")
						) {
							yamlLines.push(`    on_complete: ${wh.url}`);
						}
					}
				}
			}

			console.log(yamlLines.join("\n"));
			store.close();
			break;
		}

		case "help":
		case "--help":
		case "-h":
			usage();
			break;

		default:
			console.error(`Unknown command: ${command}`);
			usage();
			process.exit(1);
	}
}

main().catch((error) => {
	console.error("Fatal:", error);
	process.exit(1);
});
