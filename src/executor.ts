/**
 * Job executor — spawns child processes with timeout and output capture.
 *
 * SECURITY: Commands are passed to `sh -c` (same as crontab). The command string
 * comes from the job definition (admin-configured), not from user input at runtime.
 * This is the same trust model as crontab itself.
 */

import { processAlerts } from "./alerts";
import { logger } from "./logger";
import type { Store } from "./store";
import type { ExecutionStatus, Job } from "./types";

/** Maximum bytes of stdout/stderr to capture per execution. Prevents unbounded storage. */
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB

/** Maximum backoff delay for job retries (5 minutes). Prevents unbounded wait times. */
const MAX_RETRY_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Read from a ReadableStream up to `maxBytes`, discarding the rest.
 * This bounds peak memory usage — unlike reading the full stream and then truncating.
 */
async function readStreamBounded(
	stream: ReadableStream<Uint8Array> | null,
	maxBytes: number,
): Promise<string> {
	if (!stream) return "";
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	let truncated = false;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (totalBytes >= maxBytes) {
				// Already at limit — discard remaining chunks but keep reading to avoid broken pipe
				truncated = true;
				continue;
			}
			const remaining = maxBytes - totalBytes;
			if (value.length > remaining) {
				chunks.push(value.subarray(0, remaining));
				totalBytes = maxBytes;
				truncated = true;
			} else {
				chunks.push(value);
				totalBytes += value.length;
			}
		}
	} finally {
		reader.releaseLock();
	}

	const decoder = new TextDecoder();
	const text = chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
	if (!truncated) return text;
	// Trim text to ensure total output (including suffix) stays within maxBytes.
	// The suffix is ASCII-only, so length === byte length.
	const suffix = `\n... [truncated at ${maxBytes} bytes]`;
	const trimTo = Math.max(0, maxBytes - suffix.length);
	return text.slice(0, trimTo) + suffix;
}

export interface ExecutionResult {
	status: ExecutionStatus;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

/**
 * Execute a job command with timeout and output capture.
 */
async function runCommand(job: Job): Promise<ExecutionResult> {
	const startTime = Date.now();

	const env = { ...process.env, ...job.env };
	const proc = Bun.spawn(["sh", "-c", job.command], {
		cwd: job.cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});

	let timedOut = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let killTimeoutId: ReturnType<typeof setTimeout> | undefined;

	if (job.timeout > 0) {
		timeoutId = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
			// Force kill after 2s if SIGTERM doesn't work
			killTimeoutId = setTimeout(() => {
				try {
					proc.kill("SIGKILL");
				} catch {
					/* already dead */
				}
			}, 2000);
		}, job.timeout * 1000);
	}

	try {
		// Read output with streaming size limit to prevent unbounded memory usage.
		// Instead of buffering the entire output and then truncating, we stop reading
		// once we hit the limit, keeping peak memory bounded.
		const [stdout, stderr] = await Promise.all([
			readStreamBounded(proc.stdout, MAX_OUTPUT_BYTES),
			readStreamBounded(proc.stderr, MAX_OUTPUT_BYTES),
		]);

		const exitCode = await proc.exited;
		const durationMs = Date.now() - startTime;

		if (timeoutId) clearTimeout(timeoutId);
		if (killTimeoutId) clearTimeout(killTimeoutId);

		if (timedOut) {
			return { status: "timeout", exitCode, stdout, stderr, durationMs };
		}

		return {
			status: exitCode === 0 ? "success" : "failed",
			exitCode,
			stdout,
			stderr,
			durationMs,
		};
	} catch (error) {
		if (timeoutId) clearTimeout(timeoutId);
		if (killTimeoutId) clearTimeout(killTimeoutId);
		const durationMs = Date.now() - startTime;
		return {
			status: "failed",
			exitCode: null,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			durationMs,
		};
	}
}

/**
 * Execute a job with retry support. Records all attempts in the store.
 */
export async function executeJob(job: Job, store: Store): Promise<ExecutionResult> {
	const maxAttempts = Math.max(1, 1 + job.retry.maxAttempts);
	let lastResult: ExecutionResult | null = null;
	let lastExecId = 0;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// Wait for backoff delay on retries (capped to prevent unbounded waits)
		if (attempt > 0) {
			const delay = Math.min(job.retry.baseDelay * 2 ** (attempt - 1) * 1000, MAX_RETRY_BACKOFF_MS);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}

		// If the store was closed during shutdown, abort silently — the execution
		// result cannot be persisted and that is expected during graceful shutdown.
		if (store.closed)
			return (
				lastResult ?? {
					status: "failed",
					exitCode: null,
					stdout: "",
					stderr: "Store closed during shutdown",
					durationMs: 0,
				}
			);

		const execId = store.startExecution(job.id, job.name, attempt);
		lastExecId = execId;
		const result = await runCommand(job);

		// Guard against store being closed while the command was running
		if (store.closed) return result;

		store.finishExecution(
			execId,
			result.status,
			result.exitCode,
			result.stdout,
			result.stderr,
			result.durationMs,
		);

		lastResult = result;

		if (result.status === "success") {
			store.updateJobAfterExecution(job.id, "success");
			// Fire alerts using the exact execution record (not re-querying, which
			// could return a different attempt if retries happened within the same second)
			const exec = store.getExecutionById(execId);
			if (exec) {
				processAlerts(job, exec, store).catch((e) =>
					logger.error(`Alert error for ${job.name}:`, { error: String(e) }),
				);
			}
			return result;
		}

		// Don't retry on timeout
		if (result.status === "timeout") {
			store.updateJobAfterExecution(job.id, "timeout");
			const exec = store.getExecutionById(execId);
			if (exec) {
				processAlerts(job, exec, store).catch((e) =>
					logger.error(`Alert error for ${job.name}:`, { error: String(e) }),
				);
			}
			return result;
		}
	}

	// All attempts exhausted — fire failure alert using the tracked execution ID
	// (not re-querying by jobId, which could return a different job's execution
	// in concurrent scenarios)
	const finalResult = lastResult as ExecutionResult;
	if (store.closed) return finalResult;
	store.updateJobAfterExecution(job.id, finalResult.status);
	const lastExec = store.getExecutionById(lastExecId);
	if (lastExec) {
		processAlerts(job, lastExec, store).catch((e) =>
			logger.error(`Alert error for ${job.name}:`, { error: String(e) }),
		);
	}
	return finalResult;
}
