/**
 * Scheduler — polls for due jobs and executes them.
 */

import type { Server } from "bun";
import { executeJob } from "./executor";
import { logger, setLogLevel } from "./logger";
import { createServer } from "./server";
import { Store } from "./store";
import type { SchedulerOptions } from "./types";
import { DEFAULT_SCHEDULER_OPTIONS } from "./types";

// SchedulerOptions omits logLevel from the internal options type since it is
// handled separately via setLogLevel in the constructor.
type InternalOptions = Required<Omit<SchedulerOptions, "logLevel">>;

export class Scheduler {
	private store: Store;
	private options: InternalOptions;
	private timer: ReturnType<typeof setInterval> | null = null;
	private pruneTimer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private ticking = false;
	private activeJobs = new Set<number>();
	/** Jobs that have already had one skip recorded while their execution is still running.
	 * Prevents recording a skip on every tick AND prevents double-advancing next_run
	 * (the real execution's updateJobAfterExecution will handle the advance). */
	private skipRecorded = new Set<number>();
	private server: Server<unknown> | null = null;

	constructor(options?: SchedulerOptions) {
		this.options = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };
		if (this.options.pollInterval < 100) {
			throw new Error("pollInterval must be at least 100ms to prevent CPU-intensive tight loops");
		}
		if (this.options.maxConcurrent < 0 || !Number.isInteger(this.options.maxConcurrent)) {
			throw new Error("maxConcurrent must be 0 (unlimited) or a positive integer");
		}
		if (options?.logLevel !== undefined) {
			setLogLevel(options.logLevel);
		}
		this.store = new Store(this.options.dbPath);
	}

	/** Start the scheduler loop and web server. */
	start(): void {
		if (this.running) return;
		this.running = true;

		// Recover orphaned executions from a previous crash
		const recovered = this.store.recoverStaleExecutions();
		if (recovered > 0) {
			logger.info(`Recovered ${recovered} stale execution(s) from previous crash`);
		}

		logger.info(
			`Scheduler started (poll every ${this.options.pollInterval}ms, db: ${this.options.dbPath})`,
		);

		// Start web UI + API server
		const apiToken = process.env.CRONBASE_API_TOKEN;
		this.server = createServer({
			store: this.store,
			port: this.options.port,
			hostname: this.options.hostname,
			apiToken,
			canRunJob: (jobId: number) => this.checkCanRunJob(jobId),
			trackActiveJob: (jobId: number, promise: Promise<unknown>) => {
				this.activeJobs.add(jobId);
				promise.finally(() => this.activeJobs.delete(jobId));
			},
		});
		if (apiToken) {
			logger.info("API authentication enabled (CRONBASE_API_TOKEN)");
		} else if (this.options.hostname !== "127.0.0.1" && this.options.hostname !== "localhost") {
			logger.warn(
				"WARNING: No API token set and server is network-accessible. " +
					"Set CRONBASE_API_TOKEN or bind to 127.0.0.1 to prevent unauthorized access.",
			);
		}
		logger.info(`Web UI: http://${this.options.hostname}:${this.options.port}`);

		// Run immediately, then on interval
		this.tick();
		this.timer = setInterval(() => this.tick(), this.options.pollInterval);

		// Auto-prune old execution history
		if (this.options.pruneAfterDays > 0) {
			this.pruneOldExecutions();
			// Run pruning once per day (86400000ms)
			this.pruneTimer = setInterval(() => this.pruneOldExecutions(), 86400000);
		}
	}

	private pruneOldExecutions(): void {
		try {
			const deleted = this.store.pruneExecutions(this.options.pruneAfterDays);
			if (deleted > 0) {
				logger.info(
					`Pruned ${deleted} execution(s) older than ${this.options.pruneAfterDays} days`,
				);
			}
		} catch (error) {
			logger.error("Prune error:", { error: String(error) });
		}
	}

	/** Stop the scheduler loop and web server. Waits for active jobs to finish (up to gracePeriodMs). */
	async stop(gracePeriodMs = 30000): Promise<void> {
		this.running = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (this.pruneTimer) {
			clearInterval(this.pruneTimer);
			this.pruneTimer = null;
		}
		if (this.server) {
			this.server.stop(true); // close existing connections immediately
			this.server = null;
		}

		// Wait for active jobs to drain
		if (this.activeJobs.size > 0) {
			logger.info(
				`Waiting for ${this.activeJobs.size} active job(s) to finish (timeout: ${gracePeriodMs / 1000}s)...`,
			);
			const deadline = Date.now() + gracePeriodMs;
			while (this.activeJobs.size > 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			if (this.activeJobs.size > 0) {
				logger.warn(
					`${this.activeJobs.size} job(s) still running after grace period — forcing shutdown`,
				);
			}
		}

		logger.info("Scheduler stopped");
	}

	/** Get the underlying store for direct access (CLI, API). */
	getStore(): Store {
		return this.store;
	}

	/** Close the scheduler and database. */
	async close(gracePeriodMs?: number): Promise<void> {
		await this.stop(gracePeriodMs);
		this.store.close();
	}

	/** Check if a manual job run is allowed under the current concurrency limit. Returns error message if denied, null if allowed. */
	private checkCanRunJob(jobId: number): string | null {
		if (this.activeJobs.has(jobId)) {
			return "Job is already running";
		}
		if (this.options.maxConcurrent > 0 && this.activeJobs.size >= this.options.maxConcurrent) {
			return `Concurrency limit reached (${this.activeJobs.size}/${this.options.maxConcurrent} jobs running)`;
		}
		return null;
	}

	private async tick(): Promise<void> {
		// Guard against overlapping ticks — if a previous tick is still running
		// (e.g., getDueJobs query is slow under load), skip this tick entirely.
		if (this.ticking) return;
		this.ticking = true;
		try {
			// Skip execution when paused (auto-resume is handled by isPaused)
			const pauseState = this.store.isPaused();
			if (pauseState.paused) return;

			const dueJobs = this.store.getDueJobs();

			for (const job of dueJobs) {
				// Skip if we've hit the concurrent job limit
				if (this.options.maxConcurrent > 0 && this.activeJobs.size >= this.options.maxConcurrent) {
					logger.debug(
						`Deferred: ${job.name} (${this.activeJobs.size}/${this.options.maxConcurrent} concurrent jobs)`,
					);
					break; // Stop processing more jobs this tick — will pick up on next tick
				}

				// Skip if this job is already running (prevent overlap).
				// Record at most one skip per overlap period. Don't call
				// updateJobAfterExecution here — that would advance next_run,
				// and then the real execution's updateJobAfterExecution would
				// advance it AGAIN, causing the next scheduled run to be missed.
				if (this.activeJobs.has(job.id)) {
					if (!this.skipRecorded.has(job.id)) {
						logger.warn(`Skipped: ${job.name} (still running from previous tick)`);
						const skipId = this.store.startExecution(job.id, job.name, 0);
						this.store.finishExecution(
							skipId,
							"skipped",
							null,
							"",
							"Skipped: previous execution still running",
							0,
						);
						this.skipRecorded.add(job.id);
					}
					continue;
				}

				this.activeJobs.add(job.id);
				logger.info(`Running: ${job.name} (${job.schedule})`);

				// Run async — don't block the tick loop
				executeJob(job, this.store)
					.then((result) => {
						const emoji = result.status === "success" ? "✓" : "✗";
						logger.info(
							`${emoji} ${job.name}: ${result.status} (${result.durationMs}ms, exit ${result.exitCode})`,
						);
					})
					.catch((error) => {
						logger.error(`Error executing ${job.name}:`, { error: String(error) });
					})
					.finally(() => {
						this.activeJobs.delete(job.id);
						this.skipRecorded.delete(job.id);
					});
			}
		} catch (error) {
			logger.error("Tick error:", { error: String(error) });
		} finally {
			this.ticking = false;
		}
	}
}
