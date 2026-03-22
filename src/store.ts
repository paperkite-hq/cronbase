/**
 * SQLite storage layer for cronbase.
 * Uses bun:sqlite with WAL mode for concurrent read/write.
 */

import { Database } from "bun:sqlite";
import { getNextRun, parseCron } from "./cron";
import type { AlertConfig, Execution, ExecutionStatus, Job, JobConfig } from "./types";
import { DEFAULT_RETRY, VERSION } from "./types";

/**
 * Convert a JS Date to SQLite datetime format (YYYY-MM-DD HH:MM:SS).
 * This MUST match the format produced by SQLite's datetime() function,
 * so that lexicographic comparisons (e.g. next_run <= datetime('now'))
 * work correctly. Using Date.toISOString() (with 'T' separator) would
 * break comparisons because 'T' (0x54) > ' ' (0x20) lexicographically.
 */
function toSqliteDatetime(date: Date): string {
	return date
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d{3}Z$/, "");
}

export class Store {
	private db: Database;
	private dbPath: string;

	constructor(dbPath: string) {
		this.dbPath = dbPath;
		this.db = new Database(dbPath, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA foreign_keys = ON");
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        schedule TEXT NOT NULL,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL DEFAULT '.',
        env TEXT NOT NULL DEFAULT '{}',
        timeout INTEGER NOT NULL DEFAULT 0,
        retry_max_attempts INTEGER NOT NULL DEFAULT 0,
        retry_base_delay INTEGER NOT NULL DEFAULT 30,
        enabled INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        next_run TEXT,
        last_status TEXT,
        last_run TEXT
      );

      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        job_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        duration_ms INTEGER,
        exit_code INTEGER,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        attempt INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_executions_job_id ON executions(job_id);
      CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at);
      CREATE INDEX IF NOT EXISTS idx_executions_job_started ON executions(job_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(next_run);

      CREATE TABLE IF NOT EXISTS job_alerts (
        job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        config TEXT NOT NULL DEFAULT '{}'
      );
    `);
	}

	/** Add a new job and compute its next run time. */
	addJob(config: JobConfig): Job {
		const parsed = parseCron(config.schedule); // validates expression
		const nextRun = getNextRun(parsed);

		const stmt = this.db.prepare(`
      INSERT INTO jobs (name, schedule, command, cwd, env, timeout, retry_max_attempts, retry_base_delay, enabled, description, tags, next_run)
      VALUES ($name, $schedule, $command, $cwd, $env, $timeout, $retryMax, $retryDelay, $enabled, $description, $tags, $nextRun)
    `);

		const result = stmt.run({
			$name: config.name,
			$schedule: config.schedule,
			$command: config.command,
			$cwd: config.cwd ?? ".",
			$env: JSON.stringify(config.env ?? {}),
			$timeout: config.timeout ?? 0,
			$retryMax: config.retry?.maxAttempts ?? DEFAULT_RETRY.maxAttempts,
			$retryDelay: config.retry?.baseDelay ?? DEFAULT_RETRY.baseDelay,
			$enabled: config.enabled !== false ? 1 : 0,
			$description: config.description ?? "",
			$tags: JSON.stringify(config.tags ?? []),
			$nextRun: toSqliteDatetime(nextRun),
		});

		const id = Number(result.lastInsertRowid);
		return this.getJob(id) as Job;
	}

	/** Get a job by ID. */
	getJob(id: number): Job | null {
		const row = this.db.query("SELECT * FROM jobs WHERE id = $id").get({ $id: id }) as Record<
			string,
			unknown
		> | null;
		if (!row) return null;
		return this.rowToJob(row);
	}

	/** Get a job by name. */
	getJobByName(name: string): Job | null {
		const row = this.db
			.query("SELECT * FROM jobs WHERE name = $name")
			.get({ $name: name }) as Record<string, unknown> | null;
		if (!row) return null;
		return this.rowToJob(row);
	}

	/** List all jobs. */
	listJobs(): Job[] {
		const rows = this.db.query("SELECT * FROM jobs ORDER BY name").all() as Record<
			string,
			unknown
		>[];
		return rows.map((r) => this.rowToJob(r));
	}

	/** Get jobs that are due to run (next_run <= now and enabled). Capped at 100 per tick to prevent unbounded backlogs from blocking the scheduler. */
	getDueJobs(): Job[] {
		const rows = this.db
			.query(
				"SELECT * FROM jobs WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= datetime('now') ORDER BY next_run LIMIT 100",
			)
			.all() as Record<string, unknown>[];
		return rows.map((r) => this.rowToJob(r));
	}

	/** Update a job's last execution status and compute next run time.
	 * Computes next_run from the job's previous next_run (the scheduled time), not from "now".
	 * This prevents schedule drift when jobs take longer than their interval to execute.
	 * If the previous next_run is in the past or missing, falls back to computing from "now".
	 */
	updateJobAfterExecution(jobId: number, status: ExecutionStatus): void {
		const job = this.getJob(jobId);
		if (!job) return;

		let nextRun: string | null = null;
		try {
			const parsed = parseCron(job.schedule);
			// Use the job's previous next_run as the base for computing the next occurrence.
			// This keeps jobs on their cron grid even when execution takes longer than the interval.
			let after: Date;
			if (job.nextRun) {
				const scheduled = new Date(
					job.nextRun.includes("T") ? job.nextRun : `${job.nextRun.replace(" ", "T")}Z`,
				);
				// Only use the scheduled time if it's valid and not too far in the past
				// (more than 24 hours ago means we should reset to "now" to avoid catching up)
				const now = new Date();
				if (!Number.isNaN(scheduled.getTime()) && now.getTime() - scheduled.getTime() < 86400000) {
					after = scheduled;
				} else {
					after = now;
				}
			} else {
				after = new Date();
			}
			nextRun = toSqliteDatetime(getNextRun(parsed, after));
		} catch (e) {
			// Log a warning — the job's next_run will be set to null, effectively disabling it.
			// This can happen if the schedule was manually corrupted in the database.
			console.warn(
				`[cronbase] Failed to compute next run for "${job.name}" (schedule: ${job.schedule}): ${e instanceof Error ? e.message : e}`,
			);
		}

		this.db
			.query(
				"UPDATE jobs SET last_status = $status, last_run = datetime('now'), next_run = $nextRun WHERE id = $id",
			)
			.run({ $status: status, $nextRun: nextRun, $id: jobId });
	}

	/** Update a job's configuration. */
	updateJob(id: number, updates: Partial<JobConfig>): void {
		const job = this.getJob(id);
		if (!job) return;

		// Use "in" checks so callers can explicitly set fields to empty values
		// (e.g. env: {} to clear all env vars). `??` would fall through to the old value.
		const name = "name" in updates ? (updates.name ?? job.name) : job.name;
		const schedule = "schedule" in updates ? (updates.schedule ?? job.schedule) : job.schedule;
		const command = "command" in updates ? (updates.command ?? job.command) : job.command;
		const cwd = "cwd" in updates ? (updates.cwd ?? job.cwd) : job.cwd;
		const env = "env" in updates ? (updates.env ?? job.env) : job.env;
		const timeout = "timeout" in updates ? (updates.timeout ?? job.timeout) : job.timeout;
		const retryMax = updates.retry
			? (updates.retry.maxAttempts ?? job.retry.maxAttempts)
			: job.retry.maxAttempts;
		const retryDelay = updates.retry
			? (updates.retry.baseDelay ?? job.retry.baseDelay)
			: job.retry.baseDelay;
		const enabled = "enabled" in updates ? (updates.enabled ?? job.enabled) : job.enabled;
		const description =
			"description" in updates ? (updates.description ?? job.description) : job.description;
		const tags = "tags" in updates ? (updates.tags ?? job.tags) : job.tags;

		// Only recompute next_run if the schedule or enabled state actually changed.
		// Editing non-schedule fields (description, tags, env) should not reset the countdown.
		const scheduleChanged = schedule !== job.schedule;
		const enabledChanged = !!enabled !== job.enabled;
		let nextRun: string | null = null;
		if (enabled) {
			if (scheduleChanged || enabledChanged) {
				try {
					const parsed = parseCron(schedule);
					nextRun = toSqliteDatetime(getNextRun(parsed));
				} catch (e) {
					console.warn(
						`[cronbase] Failed to compute next run for "${name}" (schedule: ${schedule}): ${e instanceof Error ? e.message : e}`,
					);
				}
			} else {
				// Preserve existing next_run — but recover if it's null on an enabled job
				// (e.g., from a prior schedule parse error). Without this, editing any
				// non-schedule field on a broken job would keep it permanently unscheduled.
				nextRun = job.nextRun;
				if (nextRun === null) {
					try {
						const parsed = parseCron(schedule);
						nextRun = toSqliteDatetime(getNextRun(parsed));
					} catch {
						// Schedule is genuinely invalid — leave null
					}
				}
			}
		}

		this.db
			.query(
				`UPDATE jobs SET name = $name, schedule = $schedule, command = $command,
				 cwd = $cwd, env = $env, timeout = $timeout, retry_max_attempts = $retryMax,
				 retry_base_delay = $retryDelay, enabled = $enabled, description = $description,
				 tags = $tags, next_run = $nextRun WHERE id = $id`,
			)
			.run({
				$name: name,
				$schedule: schedule,
				$command: command,
				$cwd: cwd,
				$env: JSON.stringify(env),
				$timeout: timeout,
				$retryMax: retryMax,
				$retryDelay: retryDelay,
				$enabled: enabled ? 1 : 0,
				$description: description,
				$tags: JSON.stringify(tags),
				$nextRun: nextRun,
				$id: id,
			});
	}

	/** Delete a job and its executions. */
	deleteJob(id: number): boolean {
		const result = this.db.query("DELETE FROM jobs WHERE id = $id").run({ $id: id });
		return result.changes > 0;
	}

	/** Toggle a job's enabled state. */
	toggleJob(id: number, enabled: boolean): void {
		const job = this.getJob(id);
		if (!job) return;

		let nextRun: string | null = null;
		if (enabled) {
			try {
				const parsed = parseCron(job.schedule);
				nextRun = toSqliteDatetime(getNextRun(parsed));
			} catch (e) {
				console.warn(
					`[cronbase] Failed to compute next run for "${job.name}" (schedule: ${job.schedule}): ${e instanceof Error ? e.message : e}`,
				);
			}
		}

		this.db.query("UPDATE jobs SET enabled = $enabled, next_run = $nextRun WHERE id = $id").run({
			$enabled: enabled ? 1 : 0,
			$nextRun: nextRun,
			$id: id,
		});
	}

	/** Record the start of an execution. Returns the execution ID. */
	startExecution(jobId: number, jobName: string, attempt: number): number {
		const result = this.db
			.query(
				"INSERT INTO executions (job_id, job_name, status, attempt) VALUES ($jobId, $jobName, 'running', $attempt)",
			)
			.run({ $jobId: jobId, $jobName: jobName, $attempt: attempt });
		return Number(result.lastInsertRowid);
	}

	/** Complete an execution with results. */
	finishExecution(
		executionId: number,
		status: ExecutionStatus,
		exitCode: number | null,
		stdout: string,
		stderr: string,
		durationMs: number,
	): void {
		this.db
			.query(`
      UPDATE executions
      SET status = $status, exit_code = $exitCode, stdout = $stdout, stderr = $stderr,
          duration_ms = $durationMs, finished_at = datetime('now')
      WHERE id = $id
    `)
			.run({
				$status: status,
				$exitCode: exitCode,
				$stdout: stdout,
				$stderr: stderr,
				$durationMs: durationMs,
				$id: executionId,
			});
	}

	/** Get a single execution by ID. */
	getExecutionById(id: number): Execution | null {
		const row = this.db.query("SELECT * FROM executions WHERE id = $id").get({ $id: id }) as Record<
			string,
			unknown
		> | null;
		if (!row) return null;
		return this.rowToExecution(row);
	}

	/** Get recent executions, optionally filtered by job ID.
	 * When `brief` is true, stdout/stderr are omitted to reduce payload size for list views. */
	getExecutions(opts?: { jobId?: number; limit?: number; brief?: boolean }): Execution[] {
		const limit = opts?.limit ?? 50;
		const columns = opts?.brief
			? "id, job_id, job_name, status, started_at, finished_at, duration_ms, exit_code, attempt"
			: "*";
		let query: string;
		let rows: Record<string, unknown>[];

		if (opts?.jobId) {
			query = `SELECT ${columns} FROM executions WHERE job_id = $jobId ORDER BY started_at DESC LIMIT $limit`;
			rows = this.db.query(query).all({ $jobId: opts.jobId, $limit: limit }) as Record<
				string,
				unknown
			>[];
		} else {
			query = `SELECT ${columns} FROM executions ORDER BY started_at DESC LIMIT $limit`;
			rows = this.db.query(query).all({ $limit: limit }) as Record<string, unknown>[];
		}
		return rows.map((r) => this.rowToExecution(r));
	}

	/** Get summary statistics. */
	getStats(): {
		totalJobs: number;
		enabledJobs: number;
		recentSuccesses: number;
		recentFailures: number;
	} {
		type CountRow = { c: number };
		const totalJobs = Number(
			(this.db.query("SELECT COUNT(*) as c FROM jobs").get() as CountRow)?.c,
		);
		const enabledJobs = Number(
			(this.db.query("SELECT COUNT(*) as c FROM jobs WHERE enabled = 1").get() as CountRow)?.c,
		);
		const recentSuccesses = Number(
			(
				this.db
					.query(
						"SELECT COUNT(*) as c FROM executions WHERE status = 'success' AND started_at > datetime('now', '-24 hours')",
					)
					.get() as CountRow
			)?.c,
		);
		const recentFailures = Number(
			(
				this.db
					.query(
						"SELECT COUNT(*) as c FROM executions WHERE status IN ('failed', 'timeout') AND started_at > datetime('now', '-24 hours')",
					)
					.get() as CountRow
			)?.c,
		);
		return { totalJobs, enabledJobs, recentSuccesses, recentFailures };
	}

	/** Set alert configuration for a job. */
	setJobAlert(jobId: number, config: AlertConfig): void {
		this.db
			.query(
				"INSERT INTO job_alerts (job_id, config) VALUES ($jobId, $config) ON CONFLICT(job_id) DO UPDATE SET config = $config",
			)
			.run({ $jobId: jobId, $config: JSON.stringify(config) });
	}

	/** Get alert configuration for a job. */
	getJobAlert(jobId: number): AlertConfig | null {
		const row = this.db
			.query("SELECT config FROM job_alerts WHERE job_id = $jobId")
			.get({ $jobId: jobId }) as { config: string } | null;
		if (!row) return null;
		return this.safeJsonParse<AlertConfig>(row.config, { webhooks: [] });
	}

	/** Remove alert configuration for a job. */
	removeJobAlert(jobId: number): void {
		this.db.query("DELETE FROM job_alerts WHERE job_id = $jobId").run({ $jobId: jobId });
	}

	/** Get scheduler uptime info for health checks. */
	getHealthInfo(): {
		status: "ok";
		version: string;
		totalJobs: number;
		enabledJobs: number;
		dbSizeBytes: number;
	} {
		const stats = this.getStats();
		// Get DB file size
		let dbSizeBytes = 0;
		try {
			const file = Bun.file(this.dbPath);
			dbSizeBytes = file.size;
		} catch {
			// ignore
		}
		return {
			status: "ok",
			version: VERSION,
			totalJobs: stats.totalJobs,
			enabledJobs: stats.enabledJobs,
			dbSizeBytes,
		};
	}

	private _closed = false;

	/** Returns true if the database has been closed. */
	get closed(): boolean {
		return this._closed;
	}

	close(): void {
		this._closed = true;
		this.db.close();
	}

	/** Mark any "running" executions as "failed" — these are orphans from a previous crash. Returns count of recovered rows. */
	recoverStaleExecutions(): number {
		const result = this.db
			.query(
				"UPDATE executions SET status = 'failed', finished_at = datetime('now'), stderr = CASE WHEN stderr = '' THEN 'Process terminated unexpectedly (scheduler restart)' ELSE stderr || '\nProcess terminated unexpectedly (scheduler restart)' END WHERE status = 'running'",
			)
			.run();
		return result.changes;
	}

	/** Prune execution history older than the given number of days. Returns count of deleted rows. */
	pruneExecutions(olderThanDays: number): number {
		if (olderThanDays <= 0) return 0;
		const result = this.db
			.query("DELETE FROM executions WHERE started_at < datetime('now', $days)")
			.run({ $days: `-${olderThanDays} days` });
		return result.changes;
	}

	private safeJsonParse<T>(value: unknown, fallback: T): T {
		try {
			return JSON.parse(String(value)) as T;
		} catch {
			return fallback;
		}
	}

	private rowToJob(row: Record<string, unknown>): Job {
		return {
			id: Number(row.id),
			name: String(row.name),
			schedule: String(row.schedule),
			command: String(row.command),
			cwd: String(row.cwd),
			env: this.safeJsonParse(row.env, {}),
			timeout: Number(row.timeout),
			retry: {
				maxAttempts: Number(row.retry_max_attempts),
				baseDelay: Number(row.retry_base_delay),
			},
			enabled: row.enabled === 1,
			description: String(row.description),
			tags: this.safeJsonParse(row.tags, []),
			createdAt: String(row.created_at),
			nextRun: row.next_run ? String(row.next_run) : null,
			lastStatus: row.last_status ? (String(row.last_status) as ExecutionStatus) : null,
			lastRun: row.last_run ? String(row.last_run) : null,
		};
	}

	private rowToExecution(row: Record<string, unknown>): Execution {
		return {
			id: Number(row.id),
			jobId: Number(row.job_id),
			jobName: String(row.job_name),
			status: String(row.status) as ExecutionStatus,
			startedAt: String(row.started_at),
			finishedAt: row.finished_at ? String(row.finished_at) : null,
			durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
			exitCode: row.exit_code != null ? Number(row.exit_code) : null,
			stdout: String(row.stdout),
			stderr: String(row.stderr),
			attempt: Number(row.attempt),
		};
	}
}
