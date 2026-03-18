/** Core types for cronbase */

import type { LogLevel } from "./logger";

/** Package version — kept in sync with package.json. */
export const VERSION = "0.1.0";

export interface JobConfig {
	/** Unique job identifier */
	id?: number;
	/** Human-readable job name */
	name: string;
	/** Cron expression (5-field) or preset (@daily, @hourly, etc.) */
	schedule: string;
	/** Command to execute (passed to shell) */
	command: string;
	/** Working directory for the command */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** Timeout in seconds (0 = no timeout) */
	timeout?: number;
	/** Retry configuration */
	retry?: RetryConfig;
	/** Whether the job is enabled */
	enabled?: boolean;
	/** Optional description */
	description?: string;
	/** Tags for organization */
	tags?: string[];
}

export interface RetryConfig {
	/** Maximum number of retry attempts (0 = no retry) */
	maxAttempts: number;
	/** Base delay in seconds for exponential backoff */
	baseDelay: number;
}

export interface Job extends Required<Omit<JobConfig, "id" | "tags">> {
	id: number;
	tags: string[];
	/** When the job was created */
	createdAt: string;
	/** Next scheduled run time (ISO 8601) */
	nextRun: string | null;
	/** Last execution result */
	lastStatus: ExecutionStatus | null;
	/** Last execution time (ISO 8601) */
	lastRun: string | null;
}

export type ExecutionStatus = "running" | "success" | "failed" | "timeout" | "skipped";

export interface Execution {
	id: number;
	jobId: number;
	/** Job name (denormalized for convenience) */
	jobName: string;
	status: ExecutionStatus;
	/** ISO 8601 start time */
	startedAt: string;
	/** ISO 8601 end time (null if still running) */
	finishedAt: string | null;
	/** Duration in milliseconds */
	durationMs: number | null;
	/** Process exit code */
	exitCode: number | null;
	/** stdout output */
	stdout: string;
	/** stderr output */
	stderr: string;
	/** Which retry attempt this was (0 = first attempt) */
	attempt: number;
}

export interface CronField {
	type: "wildcard" | "value" | "range" | "step" | "list";
	values: number[];
}

export interface ParsedCron {
	minute: number[];
	hour: number[];
	dayOfMonth: number[];
	month: number[];
	dayOfWeek: number[];
}

export interface WebhookConfig {
	/** Webhook URL to POST to */
	url: string;
	/** Which events trigger this webhook */
	events: ("success" | "failed" | "timeout")[];
	/** Number of retry attempts on failure (default: 2) */
	retryAttempts?: number;
	/** Base delay in ms between retries (default: 1000, exponential backoff applied) */
	retryDelayMs?: number;
}

export interface AlertConfig {
	/** Webhook endpoints to notify */
	webhooks: WebhookConfig[];
}

export interface SchedulerOptions {
	/** How often to check for due jobs (ms). Default: 1000 */
	pollInterval?: number;
	/** SQLite database path. Default: ./cronbase.db */
	dbPath?: string;
	/** Port for web UI and API. Default: 7433 */
	port?: number;
	/** Hostname to bind to. Default: "127.0.0.1" (localhost only). Set to "0.0.0.0" for network access. */
	hostname?: string;
	/** Auto-prune execution history older than N days. 0 = disabled. Default: 90 */
	pruneAfterDays?: number;
	/** Maximum number of jobs running concurrently. 0 = unlimited. Default: 0 */
	maxConcurrent?: number;
	/**
	 * Minimum log level to emit. Overrides the `CRONBASE_LOG_LEVEL` environment variable.
	 * Levels from least to most verbose: `"error"` | `"warn"` | `"info"` | `"debug"` | `"silent"`.
	 * Default: `"info"` (or `CRONBASE_LOG_LEVEL` if set).
	 */
	logLevel?: LogLevel;
}

export const DEFAULT_RETRY: RetryConfig = {
	maxAttempts: 0,
	baseDelay: 30,
};

export const DEFAULT_SCHEDULER_OPTIONS: Required<Omit<SchedulerOptions, "logLevel">> = {
	pollInterval: 1000,
	dbPath: "./cronbase.db",
	port: 7433,
	hostname: "127.0.0.1",
	pruneAfterDays: 90,
	maxConcurrent: 0,
};
