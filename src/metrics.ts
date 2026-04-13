/**
 * Prometheus exposition format metrics for cronbase.
 *
 * Exposes job counts, execution counters, scheduler state, and database size
 * as Prometheus-compatible metrics at the /metrics endpoint.
 */

import type { Store } from "./store";
import { VERSION } from "./types";

/**
 * Format all cronbase metrics in Prometheus exposition format.
 * Each metric includes HELP and TYPE annotations per the spec.
 */
export function formatMetrics(store: Store): string {
	const stats = store.getStats();
	const execCounts = store.getExecutionCountsByStatus();
	const pauseState = store.isPaused();
	const health = store.getHealthInfo();
	const duration = store.getRecentDurationStats();

	const lines: string[] = [];

	// Version info gauge (always 1, version carried as label)
	lines.push("# HELP cronbase_info cronbase version information.");
	lines.push("# TYPE cronbase_info gauge");
	lines.push(`cronbase_info{version="${VERSION}"} 1`);
	lines.push("");

	// Job counts by status
	lines.push("# HELP cronbase_jobs_total Number of configured jobs by status.");
	lines.push("# TYPE cronbase_jobs_total gauge");
	lines.push(`cronbase_jobs_total{status="enabled"} ${stats.enabledJobs}`);
	lines.push(`cronbase_jobs_total{status="disabled"} ${stats.totalJobs - stats.enabledJobs}`);
	lines.push("");

	// Cumulative execution counts by status
	lines.push("# HELP cronbase_executions_total Total number of job executions by status.");
	lines.push("# TYPE cronbase_executions_total counter");
	for (const status of ["success", "failed", "timeout", "skipped"]) {
		lines.push(`cronbase_executions_total{status="${status}"} ${execCounts[status] ?? 0}`);
	}
	lines.push("");

	// Execution duration summary
	lines.push(
		"# HELP cronbase_execution_duration_seconds Total execution duration in seconds (recent executions).",
	);
	lines.push("# TYPE cronbase_execution_duration_seconds summary");
	lines.push(`cronbase_execution_duration_seconds_count ${duration.count}`);
	lines.push(`cronbase_execution_duration_seconds_sum ${duration.sum}`);
	lines.push("");

	// Scheduler paused state
	lines.push(
		"# HELP cronbase_scheduler_paused Whether the scheduler is paused (1 = paused, 0 = running).",
	);
	lines.push("# TYPE cronbase_scheduler_paused gauge");
	lines.push(`cronbase_scheduler_paused ${pauseState.paused ? 1 : 0}`);
	lines.push("");

	// Database size
	lines.push("# HELP cronbase_db_size_bytes Size of the SQLite database file in bytes.");
	lines.push("# TYPE cronbase_db_size_bytes gauge");
	lines.push(`cronbase_db_size_bytes ${health.dbSizeBytes}`);
	lines.push("");

	return lines.join("\n");
}
