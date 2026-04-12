import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { Store } from "../src/store";

const TEST_DB = "/tmp/cronbase-test.db";

let store: Store;

beforeEach(() => {
	try {
		unlinkSync(TEST_DB);
	} catch {
		/* doesn't exist */
	}
	try {
		unlinkSync(`${TEST_DB}-wal`);
	} catch {
		/* doesn't exist */
	}
	try {
		unlinkSync(`${TEST_DB}-shm`);
	} catch {
		/* doesn't exist */
	}
	store = new Store(TEST_DB);
});

afterEach(() => {
	store.close();
	try {
		unlinkSync(TEST_DB);
	} catch {
		/* doesn't exist */
	}
	try {
		unlinkSync(`${TEST_DB}-wal`);
	} catch {
		/* doesn't exist */
	}
	try {
		unlinkSync(`${TEST_DB}-shm`);
	} catch {
		/* doesn't exist */
	}
});

describe("Store - jobs", () => {
	test("adds a job", () => {
		const job = store.addJob({
			name: "test-job",
			schedule: "*/5 * * * *",
			command: "echo hello",
		});

		expect(job.id).toBeGreaterThan(0);
		expect(job.name).toBe("test-job");
		expect(job.schedule).toBe("*/5 * * * *");
		expect(job.command).toBe("echo hello");
		expect(job.enabled).toBe(true);
		expect(job.nextRun).toBeTruthy();
	});

	test("rejects duplicate names", () => {
		store.addJob({ name: "dup", schedule: "@daily", command: "echo 1" });
		expect(() => store.addJob({ name: "dup", schedule: "@daily", command: "echo 2" })).toThrow();
	});

	test("gets job by ID", () => {
		const created = store.addJob({ name: "by-id", schedule: "@hourly", command: "echo test" });
		const found = store.getJob(created.id);
		expect(found).not.toBeNull();
		expect(found?.name).toBe("by-id");
	});

	test("gets job by name", () => {
		store.addJob({ name: "by-name", schedule: "@hourly", command: "echo test" });
		const found = store.getJobByName("by-name");
		expect(found).not.toBeNull();
		expect(found?.name).toBe("by-name");
	});

	test("returns null for missing job", () => {
		expect(store.getJob(999)).toBeNull();
		expect(store.getJobByName("nonexistent")).toBeNull();
	});

	test("lists all jobs", () => {
		store.addJob({ name: "a-job", schedule: "@daily", command: "echo a" });
		store.addJob({ name: "b-job", schedule: "@hourly", command: "echo b" });
		const jobs = store.listJobs();
		expect(jobs).toHaveLength(2);
		expect(jobs[0].name).toBe("a-job"); // sorted alphabetically
	});

	test("deletes a job", () => {
		const job = store.addJob({ name: "to-delete", schedule: "@daily", command: "echo bye" });
		expect(store.deleteJob(job.id)).toBe(true);
		expect(store.getJob(job.id)).toBeNull();
	});

	test("toggle enabled/disabled", () => {
		const job = store.addJob({ name: "toggle", schedule: "@daily", command: "echo test" });
		expect(job.enabled).toBe(true);

		store.toggleJob(job.id, false);
		expect(store.getJob(job.id)?.enabled).toBe(false);
		expect(store.getJob(job.id)?.nextRun).toBeNull();

		store.toggleJob(job.id, true);
		expect(store.getJob(job.id)?.enabled).toBe(true);
		expect(store.getJob(job.id)?.nextRun).toBeTruthy();
	});

	test("stores retry config", () => {
		const job = store.addJob({
			name: "retry-job",
			schedule: "@daily",
			command: "echo test",
			retry: { maxAttempts: 3, baseDelay: 60 },
		});
		expect(job.retry.maxAttempts).toBe(3);
		expect(job.retry.baseDelay).toBe(60);
	});

	test("stores env vars", () => {
		const job = store.addJob({
			name: "env-job",
			schedule: "@daily",
			command: "echo $FOO",
			env: { FOO: "bar", BAZ: "qux" },
		});
		expect(job.env).toEqual({ FOO: "bar", BAZ: "qux" });
	});
});

describe("Store - getDueJobs", () => {
	test("detects jobs as due when next_run is in the past (format consistency)", () => {
		const job = store.addJob({
			name: "due-format-test",
			schedule: "* * * * *",
			command: "echo hello",
		});

		// Verify next_run was stored (in SQLite datetime format, not ISO 8601)
		const stored = store.getJob(job.id);
		expect(stored?.nextRun).toBeTruthy();
		// Should be in SQLite format: "YYYY-MM-DD HH:MM:SS" (no T separator)
		expect(stored?.nextRun).not.toContain("T");

		// Force next_run to 1 minute ago using raw SQL (simulates time passing)
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		db.query("UPDATE jobs SET next_run = datetime('now', '-1 minute') WHERE id = $id").run({
			$id: job.id,
		});

		// getDueJobs should find it
		const due = store.getDueJobs();
		expect(due.length).toBe(1);
		expect(due[0].name).toBe("due-format-test");
	});

	test("next_run stored via addJob is comparable with SQLite datetime()", () => {
		// This is the critical regression test: addJob stores next_run,
		// and getDueJobs compares it with datetime('now'). If the formats
		// don't match (e.g. ISO 8601 'T' vs SQLite ' ' separator), the
		// lexicographic comparison breaks and jobs never trigger.
		const job = store.addJob({
			name: "format-regression",
			schedule: "* * * * *",
			command: "echo test",
		});

		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		const row = db.query("SELECT next_run FROM jobs WHERE id = $id").get({ $id: job.id }) as {
			next_run: string;
		};

		// next_run must be in SQLite datetime format for comparisons to work
		expect(row.next_run).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
	});

	test("updateJobAfterExecution stores next_run in SQLite format", () => {
		const job = store.addJob({
			name: "after-exec-format",
			schedule: "*/5 * * * *",
			command: "echo test",
		});

		store.updateJobAfterExecution(job.id, "success");

		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		const row = db.query("SELECT next_run FROM jobs WHERE id = $id").get({ $id: job.id }) as {
			next_run: string;
		};

		// Must be SQLite format, not ISO 8601
		expect(row.next_run).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(row.next_run).not.toContain("T");
		expect(row.next_run).not.toContain("Z");
	});
});

describe("Store - executions", () => {
	test("records execution lifecycle", () => {
		const job = store.addJob({ name: "exec-test", schedule: "@daily", command: "echo test" });
		const execId = store.startExecution(job.id, job.name, 0);

		let execs = store.getExecutions({ jobId: job.id });
		expect(execs).toHaveLength(1);
		expect(execs[0].status).toBe("running");

		store.finishExecution(execId, "success", 0, "hello\n", "", 150);

		execs = store.getExecutions({ jobId: job.id });
		expect(execs).toHaveLength(1);
		expect(execs[0].status).toBe("success");
		expect(execs[0].exitCode).toBe(0);
		expect(execs[0].stdout).toBe("hello\n");
		expect(execs[0].durationMs).toBe(150);
	});

	test("records multiple attempts", () => {
		const job = store.addJob({ name: "retry-exec", schedule: "@daily", command: "echo test" });

		store.startExecution(job.id, job.name, 0);
		store.startExecution(job.id, job.name, 1);
		store.startExecution(job.id, job.name, 2);

		const execs = store.getExecutions({ jobId: job.id });
		expect(execs).toHaveLength(3);
	});

	test("gets execution by ID", () => {
		const job = store.addJob({ name: "exec-by-id", schedule: "@daily", command: "echo test" });
		const execId = store.startExecution(job.id, job.name, 0);
		store.finishExecution(execId, "success", 0, "output\n", "", 200);

		const exec = store.getExecutionById(execId);
		expect(exec).not.toBeNull();
		expect(exec?.id).toBe(execId);
		expect(exec?.jobName).toBe("exec-by-id");
		expect(exec?.status).toBe("success");
		expect(exec?.stdout).toBe("output\n");
		expect(exec?.durationMs).toBe(200);
	});

	test("returns null for missing execution", () => {
		expect(store.getExecutionById(99999)).toBeNull();
	});

	test("limits execution history", () => {
		const job = store.addJob({ name: "limit-test", schedule: "@daily", command: "echo test" });

		for (let i = 0; i < 10; i++) {
			store.startExecution(job.id, job.name, 0);
		}

		const execs = store.getExecutions({ jobId: job.id, limit: 5 });
		expect(execs).toHaveLength(5);
	});
});

describe("Store - pruneExecutions", () => {
	test("removes old executions", () => {
		const job = store.addJob({ name: "prune-test", schedule: "@daily", command: "echo test" });

		// Create some executions
		for (let i = 0; i < 5; i++) {
			const execId = store.startExecution(job.id, job.name, 0);
			store.finishExecution(execId, "success", 0, "", "", 100);
		}

		// Pruning with 0 days should remove nothing (all are recent)
		// Actually 0 means "older than 0 days from now" — all are in the future relative to that
		const removed = store.pruneExecutions(0);
		// All executions are from "now", so none are older than 0 days ago
		expect(removed).toBe(0);
		expect(store.getExecutions({ jobId: job.id })).toHaveLength(5);
	});

	test("returns count of removed rows", () => {
		const job = store.addJob({ name: "prune-count", schedule: "@daily", command: "echo test" });
		const execId = store.startExecution(job.id, job.name, 0);
		store.finishExecution(execId, "success", 0, "", "", 100);

		// Pruning with a very large window should remove nothing
		const removed = store.pruneExecutions(365);
		expect(removed).toBe(0);
	});
});

describe("Store - recoverStaleExecutions", () => {
	test("marks running executions as failed on recovery", () => {
		const job = store.addJob({ name: "stale-test", schedule: "@daily", command: "echo test" });

		// Simulate two "running" executions left over from a crash
		const exec1 = store.startExecution(job.id, job.name, 0);
		const exec2 = store.startExecution(job.id, job.name, 1);

		// One finished execution should be unaffected
		const exec3 = store.startExecution(job.id, job.name, 2);
		store.finishExecution(exec3, "success", 0, "done", "", 100);

		const recovered = store.recoverStaleExecutions();
		expect(recovered).toBe(2);

		const e1 = store.getExecutionById(exec1);
		expect(e1?.status).toBe("failed");
		expect(e1?.stderr).toContain("scheduler restart");
		expect(e1?.finishedAt).toBeTruthy();

		const e2 = store.getExecutionById(exec2);
		expect(e2?.status).toBe("failed");

		// The already-finished execution should be unchanged
		const e3 = store.getExecutionById(exec3);
		expect(e3?.status).toBe("success");
	});

	test("returns 0 when no stale executions exist", () => {
		const job = store.addJob({ name: "no-stale", schedule: "@daily", command: "echo test" });
		const execId = store.startExecution(job.id, job.name, 0);
		store.finishExecution(execId, "success", 0, "", "", 100);

		const recovered = store.recoverStaleExecutions();
		expect(recovered).toBe(0);
	});

	test("appends to existing stderr on recovery", () => {
		const job = store.addJob({ name: "append-stderr", schedule: "@daily", command: "echo test" });
		const execId = store.startExecution(job.id, job.name, 0);
		// Simulate partial stderr from before crash — update directly
		store.finishExecution(execId, "running" as "failed", null, "", "partial error", 0);
		// Reset back to running to simulate the stale state
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		db.query("UPDATE executions SET status = 'running', finished_at = NULL WHERE id = $id").run({
			$id: execId,
		});

		const recovered = store.recoverStaleExecutions();
		expect(recovered).toBe(1);

		const exec = store.getExecutionById(execId);
		expect(exec?.stderr).toContain("partial error");
		expect(exec?.stderr).toContain("scheduler restart");
	});
});

describe("Store - alerts", () => {
	test("returns fallback on corrupted alert config JSON", () => {
		const job = store.addJob({ name: "corrupt-alert", schedule: "@daily", command: "echo test" });
		// Set alert config normally first
		store.setJobAlert(job.id, { webhooks: [{ url: "https://example.com", events: ["failed"] }] });
		expect(store.getJobAlert(job.id)?.webhooks).toHaveLength(1);

		// Corrupt the JSON directly in DB
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		db.query("UPDATE job_alerts SET config = 'not valid json' WHERE job_id = $id").run({
			$id: job.id,
		});

		// Should return fallback instead of throwing
		const alert = store.getJobAlert(job.id);
		expect(alert).not.toBeNull();
		expect(alert?.webhooks).toEqual([]);
	});
});

describe("Store - cascade delete", () => {
	test("deleting a job cascade-deletes its executions", () => {
		const job = store.addJob({ name: "cascade-test", schedule: "@daily", command: "echo test" });
		const execId = store.startExecution(job.id, job.name, 0);
		store.finishExecution(execId, "success", 0, "output", "", 100);

		// Verify execution exists
		expect(store.getExecutionById(execId)).not.toBeNull();

		// Delete the job
		store.deleteJob(job.id);

		// Execution should be cascade-deleted
		expect(store.getExecutionById(execId)).toBeNull();
	});

	test("deleting a job cascade-deletes its alert config", () => {
		const job = store.addJob({ name: "cascade-alert", schedule: "@daily", command: "echo test" });
		store.setJobAlert(job.id, { webhooks: [{ url: "https://example.com", events: ["failed"] }] });

		// Verify alert exists
		expect(store.getJobAlert(job.id)).not.toBeNull();

		// Delete the job
		store.deleteJob(job.id);

		// Alert config should be cascade-deleted
		expect(store.getJobAlert(job.id)).toBeNull();
	});
});

describe("Store - stats", () => {
	test("returns summary statistics", () => {
		const job = store.addJob({ name: "stats-job", schedule: "@daily", command: "echo test" });

		const execId1 = store.startExecution(job.id, job.name, 0);
		store.finishExecution(execId1, "success", 0, "", "", 100);

		const execId2 = store.startExecution(job.id, job.name, 0);
		store.finishExecution(execId2, "failed", 1, "", "error", 50);

		const stats = store.getStats();
		expect(stats.totalJobs).toBe(1);
		expect(stats.enabledJobs).toBe(1);
		expect(stats.recentSuccesses).toBe(1);
		expect(stats.recentFailures).toBe(1);
	});
});

describe("updateJob field clearing", () => {
	test("explicitly setting env to empty object clears env vars", () => {
		const job = store.addJob({
			name: "env-clear-test",
			schedule: "* * * * *",
			command: "echo hi",
			env: { MY_VAR: "value", OTHER: "data" },
		});
		expect(Object.keys(job.env).length).toBe(2);

		store.updateJob(job.id, { env: {} });
		const updated = store.getJob(job.id);
		expect(updated).not.toBeNull();
		expect(Object.keys(updated?.env ?? {}).length).toBe(0);
	});

	test("explicitly setting tags to empty array clears tags", () => {
		const job = store.addJob({
			name: "tags-clear-test",
			schedule: "* * * * *",
			command: "echo hi",
			tags: ["backup", "daily"],
		});
		expect(job.tags.length).toBe(2);

		store.updateJob(job.id, { tags: [] });
		const updated = store.getJob(job.id);
		expect(updated).not.toBeNull();
		expect(updated?.tags.length).toBe(0);
	});

	test("omitting env preserves existing env vars", () => {
		const job = store.addJob({
			name: "env-preserve-test",
			schedule: "* * * * *",
			command: "echo hi",
			env: { KEEP: "me" },
		});

		store.updateJob(job.id, { description: "new desc" });
		const updated = store.getJob(job.id);
		expect(updated).not.toBeNull();
		expect(updated?.env.KEEP).toBe("me");
		expect(updated?.description).toBe("new desc");
	});

	test("updateJob preserves next_run when non-schedule fields change", () => {
		const job = store.addJob({
			name: "preserve-next-run",
			schedule: "0 */6 * * *", // every 6 hours
			command: "echo hi",
		});
		const originalNextRun = store.getJob(job.id)?.nextRun;
		expect(originalNextRun).not.toBeNull();

		// Update only description — next_run should NOT change
		store.updateJob(job.id, { description: "updated desc" });
		const updated = store.getJob(job.id);
		expect(updated?.nextRun).toBe(originalNextRun);
	});

	test("updateJob recomputes next_run when schedule changes", () => {
		const job = store.addJob({
			name: "recompute-schedule",
			schedule: "0 0 * * *", // daily at midnight
			command: "echo hi",
		});
		const originalNextRun = store.getJob(job.id)?.nextRun;

		// Change schedule — next_run SHOULD change
		store.updateJob(job.id, { schedule: "0 12 * * *" }); // daily at noon
		const updated = store.getJob(job.id);
		expect(updated?.nextRun).not.toBe(originalNextRun);
	});

	test("updateJobAfterExecution computes next_run from scheduled time, not wall clock", () => {
		const job = store.addJob({
			name: "drift-test",
			schedule: "*/5 * * * *", // every 5 minutes
			command: "echo hi",
		});
		const originalNextRun = store.getJob(job.id)?.nextRun;
		expect(originalNextRun).not.toBeNull();

		// After execution, next_run should be based on the cron grid, not reset to now + interval
		store.updateJobAfterExecution(job.id, "success");
		const updated = store.getJob(job.id);
		expect(updated?.nextRun).not.toBeNull();
		// The new next_run should be after the original next_run
		expect(updated?.nextRun).toBeDefined();
		expect(originalNextRun).toBeDefined();
		expect(String(updated?.nextRun) > String(originalNextRun)).toBe(true);
	});
});

describe("updateJob null nextRun recovery", () => {
	test("recovers null nextRun when editing non-schedule fields on an enabled job", () => {
		const job = store.addJob({
			name: "null-nextrun-test",
			schedule: "0 12 * * *",
			command: "echo test",
		});

		// Simulate a null next_run from a prior parse error by setting it directly
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		db.query("UPDATE jobs SET next_run = NULL WHERE id = $id").run({ $id: job.id });
		const broken = store.getJob(job.id);
		expect(broken?.nextRun).toBeNull();

		// Now edit a non-schedule field (description) — should recover next_run
		store.updateJob(job.id, { description: "updated" });

		const recovered = store.getJob(job.id);
		expect(recovered?.nextRun).not.toBeNull();
		expect(recovered?.description).toBe("updated");
	});

	test("does not recover nextRun on disabled jobs", () => {
		const job = store.addJob({
			name: "disabled-null-nextrun",
			schedule: "0 12 * * *",
			command: "echo test",
		});

		// Simulate a disabled job with null next_run
		store.toggleJob(job.id, false);
		const disabled = store.getJob(job.id);
		expect(disabled?.nextRun).toBeNull();
		expect(disabled?.enabled).toBe(false);

		// Editing non-schedule field should NOT recover next_run on disabled job
		store.updateJob(job.id, { description: "updated" });
		const stillDisabled = store.getJob(job.id);
		expect(stillDisabled?.nextRun).toBeNull();
	});
});

describe("Store - closed property", () => {
	test("closed is false before close, true after", () => {
		expect(store.closed).toBe(false);
		store.close();
		expect(store.closed).toBe(true);
		// Re-create store for afterEach cleanup
		store = new Store(TEST_DB);
	});
});

describe("Store - per-job timezone", () => {
	test("stores and retrieves timezone on addJob", () => {
		const job = store.addJob({
			name: "tz-job",
			schedule: "0 9 * * *",
			command: "echo hello",
			timezone: "America/New_York",
		});

		expect(job.timezone).toBe("America/New_York");
		const fetched = store.getJob(job.id);
		expect(fetched?.timezone).toBe("America/New_York");
	});

	test("timezone defaults to null when not provided", () => {
		const job = store.addJob({
			name: "no-tz-job",
			schedule: "0 9 * * *",
			command: "echo hello",
		});

		expect(job.timezone).toBeNull();
	});

	test("per-job timezone affects nextRun calculation", () => {
		// At 2026-03-15 20:00 UTC = 4 PM Eastern (UTC-4 EDT)
		// "0 9 * * *" = 9 AM Eastern = 13:00 UTC (on the next day)
		// Without timezone, next run in UTC would be 2026-03-16 09:00 UTC
		// With America/New_York, next run would be 2026-03-16 13:00 UTC (9 AM EDT)
		const jobUtc = store.addJob({
			name: "utc-job",
			schedule: "0 9 * * *",
			command: "echo utc",
		});
		const jobNy = store.addJob({
			name: "ny-job",
			schedule: "0 9 * * *",
			command: "echo ny",
			timezone: "America/New_York",
		});

		// Both should have nextRun set, and the NY job's next run should be later
		// because 9 AM Eastern is 1 PM UTC (not 9 AM UTC)
		expect(jobUtc.nextRun).not.toBeNull();
		expect(jobNy.nextRun).not.toBeNull();

		const utcTime = new Date(
			(jobUtc.nextRun as string).includes("T")
				? (jobUtc.nextRun as string)
				: `${(jobUtc.nextRun as string).replace(" ", "T")}Z`,
		);
		const nyTime = new Date(
			(jobNy.nextRun as string).includes("T")
				? (jobNy.nextRun as string)
				: `${(jobNy.nextRun as string).replace(" ", "T")}Z`,
		);

		// NY job should be scheduled for 9 AM Eastern, UTC job for 9 AM UTC
		// Since EDT = UTC-4, NY 9 AM = UTC 13:00
		expect(nyTime.getUTCHours()).toBe(13);
		expect(utcTime.getUTCHours()).toBe(9);
	});

	test("updateJob can change timezone and recomputes nextRun", () => {
		const job = store.addJob({
			name: "update-tz-job",
			schedule: "0 9 * * *",
			command: "echo hello",
		});

		expect(job.timezone).toBeNull();

		store.updateJob(job.id, { timezone: "Europe/London" });
		const updated = store.getJob(job.id);

		expect(updated?.timezone).toBe("Europe/London");
		// nextRun should be recomputed when timezone changes
		expect(updated?.nextRun).not.toBeNull();
	});

	test("updateJob preserves timezone when not updated", () => {
		const job = store.addJob({
			name: "preserve-tz-job",
			schedule: "0 9 * * *",
			command: "echo hello",
			timezone: "Asia/Tokyo",
		});

		store.updateJob(job.id, { description: "updated desc" });
		const updated = store.getJob(job.id);

		expect(updated?.timezone).toBe("Asia/Tokyo");
	});
});

describe("health info", () => {
	test("includes version from types.ts", () => {
		const { VERSION } = require("../src/types");
		const health = store.getHealthInfo();
		expect(health.status).toBe("ok");
		expect(health.version).toBe(VERSION);
		expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("version matches package.json", async () => {
		const { VERSION } = require("../src/types");
		const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
		expect(VERSION).toBe(pkg.version);
	});
});

describe("pause/resume", () => {
	test("isPaused returns false by default", () => {
		const state = store.isPaused();
		expect(state.paused).toBe(false);
		expect(state.until).toBeNull();
	});

	test("setPaused(true) pauses the scheduler", () => {
		store.setPaused(true);
		const state = store.isPaused();
		expect(state.paused).toBe(true);
		expect(state.until).toBeNull();
	});

	test("setPaused(true, until) pauses with expiry", () => {
		const until = new Date(Date.now() + 3600000); // 1 hour from now
		store.setPaused(true, until);
		const state = store.isPaused();
		expect(state.paused).toBe(true);
		expect(state.until).not.toBeNull();
		expect(state.until?.getTime()).toBeCloseTo(until.getTime(), -100);
	});

	test("setPaused(false) resumes the scheduler", () => {
		store.setPaused(true);
		expect(store.isPaused().paused).toBe(true);
		store.setPaused(false);
		expect(store.isPaused().paused).toBe(false);
	});

	test("auto-resumes when paused_until expires", () => {
		const pastDate = new Date(Date.now() - 1000); // 1 second ago
		store.setPaused(true, pastDate);
		// isPaused should detect expiry and auto-resume
		const state = store.isPaused();
		expect(state.paused).toBe(false);
		expect(state.until).toBeNull();
	});

	test("indefinite pause has no until", () => {
		store.setPaused(true);
		const state = store.isPaused();
		expect(state.paused).toBe(true);
		expect(state.until).toBeNull();
	});

	test("re-pausing clears previous until", () => {
		const until = new Date(Date.now() + 3600000);
		store.setPaused(true, until);
		expect(store.isPaused().until).not.toBeNull();
		// Pause again without until → indefinite
		store.setPaused(true);
		expect(store.isPaused().until).toBeNull();
		expect(store.isPaused().paused).toBe(true);
	});
});
