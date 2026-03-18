/**
 * YAML/JSON config file loader for cronbase.
 *
 * Supports defining jobs declaratively in a config file
 * instead of (or in addition to) the CLI `add` command.
 *
 * Config format (YAML or JSON):
 *
 * ```yaml
 * jobs:
 *   - name: backup-db
 *     schedule: "0 2 * * *"
 *     command: pg_dump mydb > /backups/db.sql
 *     timeout: 300
 *     retry:
 *       maxAttempts: 2
 *       baseDelay: 60
 *     on_failure: https://hooks.slack.com/services/xxx
 *
 *   - name: cleanup-logs
 *     schedule: "@daily"
 *     command: find /var/log -name '*.gz' -mtime +30 -delete
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { parseCron } from "./cron";
import type { Store } from "./store";
import type { AlertConfig, JobConfig } from "./types";
import { validateJobConfig, validateSchedule, validateWebhookUrl } from "./validation";

interface ConfigJobEntry {
	name: string;
	schedule: string;
	command: string;
	cwd?: string;
	env?: Record<string, string>;
	timeout?: number;
	/** Modern retry format: { maxAttempts, baseDelay } */
	retry?: { maxAttempts: number; baseDelay?: number };
	/** @deprecated Use retry.maxAttempts instead */
	retries?: number;
	/** @deprecated Use retry.baseDelay instead */
	retry_delay?: number;
	description?: string;
	tags?: string[];
	enabled?: boolean;
	/** Webhook URL for failure alerts */
	on_failure?: string;
	/** Webhook URL for success alerts */
	on_success?: string;
	/** Alert on every execution (success + failure) */
	on_complete?: string;
}

interface ConfigFile {
	jobs?: ConfigJobEntry[];
}

/**
 * Parse a YAML-subset config file. Supports basic YAML features:
 * - Key-value pairs
 * - Lists with `-` prefix
 * - Nested objects (indentation-based)
 * - Quoted strings
 * - Comments with #
 *
 * For full YAML support, users can use JSON format instead.
 * This parser handles the common cronbase config patterns without external deps.
 */
function parseSimpleYaml(content: string): ConfigFile {
	// Try JSON first
	try {
		return JSON.parse(content) as ConfigFile;
	} catch {
		// Not JSON, parse as YAML
	}

	const lines = content.split("\n");
	const jobs: ConfigJobEntry[] = [];
	let currentJob: Record<string, unknown> | null = null;
	let inJobs = false;
	let envBlock: Record<string, string> | null = null;
	let tagsBlock: string[] | null = null;
	let retryBlock: Record<string, number> | null = null;
	let blockIndent = 0; // indentation level of the env:/tags:/retry: key
	// Block scalar state (for `command: |` or `command: >` multiline values)
	let blockScalarKey: string | null = null;
	let blockScalarLines: string[] = [];
	let blockScalarIndent = -1;
	let blockScalarFold = false; // true for `>` (folded), false for `|` (literal)

	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const rawLine = lines[lineIdx];
		const commentIdx = findUnquotedHash(rawLine);
		const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
		const trimmed = line.trimEnd();

		// If we're collecting a block scalar, check if this line continues it
		if (blockScalarKey !== null && currentJob) {
			// Empty lines are preserved in block scalars
			if (trimmed.length === 0) {
				blockScalarLines.push("");
				continue;
			}
			const lineIndent = trimmed.length - trimmed.trimStart().length;
			// First content line sets the block indentation
			if (blockScalarIndent < 0) {
				blockScalarIndent = lineIndent;
			}
			// If indentation is at or deeper than block level, it's part of the scalar
			if (lineIndent >= blockScalarIndent) {
				blockScalarLines.push(trimmed.slice(blockScalarIndent));
				continue;
			}
			// Line is less indented — block scalar ends, flush it
			const joined = blockScalarFold
				? blockScalarLines.join(" ").replace(/ {2,}/g, " ").trim()
				: blockScalarLines.join("\n").trimEnd();
			currentJob[blockScalarKey] = joined;
			blockScalarKey = null;
			blockScalarLines = [];
			blockScalarIndent = -1;
			// Fall through to process this line normally
		}

		if (trimmed.length === 0) continue;

		// Top-level key
		if (/^jobs:\s*$/.test(trimmed)) {
			inJobs = true;
			continue;
		}

		if (!inJobs) continue;

		// New list item (job)
		if (/^\s{1,4}-\s+/.test(trimmed)) {
			// Flush previous env/tags/retry blocks
			if (currentJob) {
				if (envBlock) currentJob.env = envBlock;
				if (tagsBlock) currentJob.tags = tagsBlock;
				if (retryBlock) currentJob.retry = retryBlock;
				jobs.push(currentJob as unknown as ConfigJobEntry);
			}
			currentJob = {};
			envBlock = null;
			tagsBlock = null;
			retryBlock = null;

			// Parse inline key-value on the same line as `-`
			const afterDash = trimmed.replace(/^\s*-\s+/, "");
			if (afterDash.includes(":")) {
				const [key, ...rest] = afterDash.split(":");
				const val = rest.join(":").trim();
				currentJob[key.trim()] = parseYamlValue(val);
			}
			continue;
		}

		// Property of current job
		if (currentJob && /^\s{4,}\S/.test(trimmed)) {
			const stripped = trimmed.trim();
			const lineIndent = trimmed.length - stripped.length;

			// If we're in an env/tags/retry block but this line is at the same or
			// lesser indentation, it's a sibling property — close the block
			if (
				(envBlock !== null || tagsBlock !== null || retryBlock !== null) &&
				lineIndent <= blockIndent
			) {
				if (envBlock) currentJob.env = envBlock;
				if (tagsBlock) currentJob.tags = tagsBlock;
				if (retryBlock) currentJob.retry = retryBlock;
				envBlock = null;
				tagsBlock = null;
				retryBlock = null;
			}

			// Sub-list item (for tags)
			if (stripped.startsWith("- ") && tagsBlock !== null) {
				tagsBlock.push(parseYamlValue(stripped.slice(2).trim()) as string);
				continue;
			}

			// Key-value pair under env block
			if (envBlock !== null && stripped.includes(":") && !stripped.endsWith(":")) {
				const [k, ...v] = stripped.split(":");
				envBlock[k.trim()] = String(parseYamlValue(v.join(":").trim()));
				continue;
			}

			// Key-value pair under retry block
			if (retryBlock !== null && stripped.includes(":") && !stripped.endsWith(":")) {
				const [k, ...v] = stripped.split(":");
				retryBlock[k.trim()] = Number(parseYamlValue(v.join(":").trim()));
				continue;
			}

			if (stripped.includes(":")) {
				const [key, ...rest] = stripped.split(":");
				const val = rest.join(":").trim();
				const keyName = key.trim();

				// Start of env block
				if (keyName === "env" && val === "") {
					envBlock = {};
					tagsBlock = null;
					retryBlock = null;
					blockIndent = lineIndent;
					continue;
				}

				// Start of tags block
				if (keyName === "tags" && val === "") {
					tagsBlock = [];
					envBlock = null;
					retryBlock = null;
					blockIndent = lineIndent;
					continue;
				}

				// Start of retry block
				if (keyName === "retry" && val === "") {
					retryBlock = {};
					envBlock = null;
					tagsBlock = null;
					blockIndent = lineIndent;
					continue;
				}

				// Inline tags array [a, b, c]
				if (keyName === "tags" && val.startsWith("[")) {
					if (!val.endsWith("]")) {
						throw new Error(`Malformed inline array — missing closing bracket: ${val}`);
					}
					const items = val
						.slice(1, -1)
						.split(",")
						.map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
					currentJob.tags = items;
					continue;
				}

				// Block scalar indicators: `|` (literal) or `>` (folded)
				if (val === "|" || val === ">") {
					blockScalarKey = keyName;
					blockScalarLines = [];
					blockScalarIndent = -1; // determined by first content line
					blockScalarFold = val === ">";
					envBlock = null;
					tagsBlock = null;
					retryBlock = null;
					continue;
				}

				envBlock = null;
				tagsBlock = null;
				retryBlock = null;
				currentJob[keyName] = parseYamlValue(val);
			}
		}
	}

	// Flush any pending block scalar
	if (blockScalarKey !== null && currentJob) {
		const joined = blockScalarFold
			? blockScalarLines.join(" ").replace(/ {2,}/g, " ").trim()
			: blockScalarLines.join("\n").trimEnd();
		currentJob[blockScalarKey] = joined;
	}

	// Flush last job
	if (currentJob) {
		if (envBlock) currentJob.env = envBlock;
		if (tagsBlock) currentJob.tags = tagsBlock;
		if (retryBlock) currentJob.retry = retryBlock;
		jobs.push(currentJob as unknown as ConfigJobEntry);
	}

	return { jobs };
}

/** Find the index of a `#` comment character that is not inside quotes. */
function findUnquotedHash(line: string): number {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === "#" && !inSingle && !inDouble) return i;
	}
	return -1;
}

/** Parse a YAML scalar value. */
function parseYamlValue(val: string): string | number | boolean {
	if (val === "true") return true;
	if (val === "false") return false;
	// Remove quotes
	if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
		return val.slice(1, -1);
	}
	// Try number
	if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
	return val;
}

/**
 * Load jobs from a config file into the store.
 * Jobs that already exist (by name) are updated; new ones are created.
 * Returns the number of jobs loaded/updated.
 */
export function loadConfigFile(filePath: string, store: Store): { added: number; updated: number } {
	if (!existsSync(filePath)) {
		throw new Error(`Config file not found: ${filePath}`);
	}

	const content = readFileSync(filePath, "utf-8");
	const config = parseSimpleYaml(content);

	if (!config.jobs || !Array.isArray(config.jobs)) {
		throw new Error("Config file must contain a 'jobs' array");
	}

	// Check for duplicate job names in config
	const seenNames = new Set<string>();
	for (const entry of config.jobs) {
		if (entry.name && seenNames.has(entry.name)) {
			throw new Error(`Duplicate job name in config: "${entry.name}"`);
		}
		if (entry.name) seenNames.add(entry.name);
	}

	let added = 0;
	let updated = 0;

	for (const entry of config.jobs) {
		const missingFields = ["name", "schedule", "command"].filter(
			(f) => !entry[f as keyof ConfigJobEntry],
		);
		if (missingFields.length > 0) {
			throw new Error(
				`Job entry missing required field(s): ${missingFields.join(", ")} in ${JSON.stringify(entry)}`,
			);
		}

		// Validate schedule expression
		const scheduleError = validateSchedule(entry.schedule, parseCron);
		if (scheduleError) {
			throw new Error(`Job "${entry.name}": ${scheduleError.message}`);
		}

		const jobConfig: JobConfig = {
			name: entry.name,
			schedule: entry.schedule,
			command: entry.command,
			cwd: entry.cwd,
			env: entry.env,
			timeout: entry.timeout,
			retry: entry.retry
				? { maxAttempts: entry.retry.maxAttempts, baseDelay: entry.retry.baseDelay ?? 30 }
				: entry.retries
					? { maxAttempts: entry.retries, baseDelay: entry.retry_delay ?? 30 }
					: undefined,
			description: entry.description,
			tags: entry.tags,
			enabled: entry.enabled,
		};

		// Validate job config fields (name pattern, command length, env vars, etc.)
		const validationError = validateJobConfig(jobConfig as unknown as Record<string, unknown>);
		if (validationError) {
			throw new Error(`Job "${entry.name}": ${validationError.message}`);
		}

		// Build alert config from on_failure/on_success/on_complete
		let alert: AlertConfig | undefined;
		if (entry.on_failure || entry.on_success || entry.on_complete) {
			const webhooks: AlertConfig["webhooks"] = [];
			if (entry.on_failure) {
				const urlErr = validateWebhookUrl(entry.on_failure);
				if (urlErr) throw new Error(`Job "${entry.name}" on_failure: ${urlErr.message}`);
				webhooks.push({ url: entry.on_failure, events: ["failed", "timeout"] });
			}
			if (entry.on_success) {
				const urlErr = validateWebhookUrl(entry.on_success);
				if (urlErr) throw new Error(`Job "${entry.name}" on_success: ${urlErr.message}`);
				webhooks.push({ url: entry.on_success, events: ["success"] });
			}
			if (entry.on_complete) {
				const urlErr = validateWebhookUrl(entry.on_complete);
				if (urlErr) throw new Error(`Job "${entry.name}" on_complete: ${urlErr.message}`);
				webhooks.push({ url: entry.on_complete, events: ["success", "failed", "timeout"] });
			}
			alert = { webhooks };
		}

		const existing = store.getJobByName(entry.name);
		if (existing) {
			store.updateJob(existing.id, jobConfig);
			if (alert) {
				store.setJobAlert(existing.id, alert);
			} else {
				// Config is declarative: no webhook config means clear existing alerts
				store.removeJobAlert(existing.id);
			}
			updated++;
		} else {
			const job = store.addJob(jobConfig);
			if (alert) {
				store.setJobAlert(job.id, alert);
			}
			added++;
		}
	}

	return { added, updated };
}

export interface ConfigValidationError {
	/** Job name, or null for file-level errors */
	job: string | null;
	field: string;
	message: string;
}

/**
 * Validate a config file without modifying any database.
 * Returns an array of validation errors (empty = valid).
 */
export function validateConfigFile(filePath: string): ConfigValidationError[] {
	const errors: ConfigValidationError[] = [];

	if (!existsSync(filePath)) {
		return [{ job: null, field: "file", message: `Config file not found: ${filePath}` }];
	}

	let config: ConfigFile;
	try {
		const content = readFileSync(filePath, "utf-8");
		config = parseSimpleYaml(content);
	} catch (e) {
		return [
			{ job: null, field: "file", message: `Failed to parse config: ${(e as Error).message}` },
		];
	}

	if (!config.jobs || !Array.isArray(config.jobs)) {
		return [{ job: null, field: "jobs", message: "Config file must contain a 'jobs' array" }];
	}

	// Check for duplicate job names
	const seenNames = new Set<string>();
	for (const entry of config.jobs) {
		if (entry.name && seenNames.has(entry.name)) {
			errors.push({
				job: entry.name,
				field: "name",
				message: `Duplicate job name: "${entry.name}"`,
			});
		}
		if (entry.name) seenNames.add(entry.name);
	}

	for (const entry of config.jobs) {
		const jobLabel = entry.name ?? "(unnamed)";

		// Required fields
		const missingFields = ["name", "schedule", "command"].filter(
			(f) => !entry[f as keyof ConfigJobEntry],
		);
		for (const field of missingFields) {
			errors.push({ job: jobLabel, field, message: `Missing required field: ${field}` });
		}

		if (missingFields.length > 0) continue; // skip deeper validation if basics are missing

		// Schedule expression
		const scheduleError = validateSchedule(entry.schedule, parseCron);
		if (scheduleError) {
			errors.push({ job: jobLabel, field: "schedule", message: scheduleError.message });
		}

		// Job config fields (name pattern, command length, env, etc.)
		const jobConfig = {
			name: entry.name,
			schedule: entry.schedule,
			command: entry.command,
			cwd: entry.cwd,
			env: entry.env,
			timeout: entry.timeout,
			retry: entry.retry
				? { maxAttempts: entry.retry.maxAttempts, baseDelay: entry.retry.baseDelay ?? 30 }
				: entry.retries
					? { maxAttempts: entry.retries, baseDelay: entry.retry_delay ?? 30 }
					: undefined,
			description: entry.description,
			tags: entry.tags,
			enabled: entry.enabled,
		};
		const configError = validateJobConfig(jobConfig as unknown as Record<string, unknown>);
		if (configError) {
			errors.push({ job: jobLabel, field: configError.field, message: configError.message });
		}

		// Webhook URLs
		if (entry.on_failure) {
			const urlErr = validateWebhookUrl(entry.on_failure);
			if (urlErr) errors.push({ job: jobLabel, field: "on_failure", message: urlErr.message });
		}
		if (entry.on_success) {
			const urlErr = validateWebhookUrl(entry.on_success);
			if (urlErr) errors.push({ job: jobLabel, field: "on_success", message: urlErr.message });
		}
		if (entry.on_complete) {
			const urlErr = validateWebhookUrl(entry.on_complete);
			if (urlErr) errors.push({ job: jobLabel, field: "on_complete", message: urlErr.message });
		}
	}

	return errors;
}

export { parseSimpleYaml };
