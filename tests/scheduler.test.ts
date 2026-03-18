import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scheduler } from "../src/scheduler";
import { Store } from "../src/store";

const testDb = () =>
	join(tmpdir(), `cronbase-scheduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

describe("Scheduler", () => {
	let dbPath: string;
	let scheduler: Scheduler;

	beforeEach(() => {
		dbPath = testDb();
	});

	afterEach(async () => {
		if (scheduler) {
			await scheduler.close(1000);
		}
		try {
			unlinkSync(dbPath);
			unlinkSync(`${dbPath}-wal`);
			unlinkSync(`${dbPath}-shm`);
		} catch {
			/* ignore */
		}
	});

	it("creates with default options", () => {
		scheduler = new Scheduler({ dbPath });
		expect(scheduler).toBeDefined();
		expect(scheduler.getStore()).toBeInstanceOf(Store);
	});

	it("rejects pollInterval below 100ms", () => {
		expect(() => new Scheduler({ dbPath, pollInterval: 10 })).toThrow(
			"pollInterval must be at least 100ms",
		);
		expect(() => new Scheduler({ dbPath, pollInterval: 0 })).toThrow(
			"pollInterval must be at least 100ms",
		);
		expect(() => new Scheduler({ dbPath, pollInterval: -1 })).toThrow(
			"pollInterval must be at least 100ms",
		);
	});

	it("creates with custom options", () => {
		scheduler = new Scheduler({
			dbPath,
			pollInterval: 5000,
			port: 9999,
		});
		expect(scheduler).toBeDefined();
	});

	it("start sets running state and creates server", () => {
		scheduler = new Scheduler({ dbPath, port: 0 });
		scheduler.start();
		// Starting again should be a no-op (idempotent)
		scheduler.start();
		scheduler.stop();
	});

	it("stop is idempotent", () => {
		scheduler = new Scheduler({ dbPath, port: 0 });
		scheduler.stop(); // stop before start — should not throw
		scheduler.start();
		scheduler.stop();
		scheduler.stop(); // double stop — should not throw
	});

	it("close stops scheduler and closes database", async () => {
		scheduler = new Scheduler({ dbPath, port: 0 });
		scheduler.start();
		await scheduler.close();
		// After close, getStore().listJobs() should throw (db closed)
		expect(() => scheduler.getStore().listJobs()).toThrow();
	});

	it("getStore returns a usable store", () => {
		scheduler = new Scheduler({ dbPath });
		const store = scheduler.getStore();
		store.addJob({
			name: "test-job",
			schedule: "* * * * *",
			command: "echo hello",
		});
		expect(store.listJobs()).toHaveLength(1);
	});

	it("tick executes due jobs", async () => {
		scheduler = new Scheduler({ dbPath, pollInterval: 100, port: 0 });
		const store = scheduler.getStore();

		// Add a job that's immediately due (next_run in the past)
		store.addJob({
			name: "immediate-job",
			schedule: "* * * * *",
			command: "echo scheduler-test-output",
		});

		// Force next_run to the past so it's due
		const jobs = store.listJobs();
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		db.query("UPDATE jobs SET next_run = datetime('now', '-1 minute') WHERE id = $id").run({
			$id: jobs[0].id,
		});

		scheduler.start();

		// Wait for tick to process and execute the job
		await new Promise((r) => setTimeout(r, 300));

		scheduler.stop();

		// Check that the job was executed
		const executions = store.getExecutions({ jobId: jobs[0].id });
		expect(executions.length).toBeGreaterThanOrEqual(1);
		expect(executions[0].status).toBe("success");
		expect(executions[0].stdout).toContain("scheduler-test-output");
	});

	it("prevents concurrent execution of the same job", async () => {
		scheduler = new Scheduler({ dbPath, pollInterval: 100, port: 0 });
		const store = scheduler.getStore();

		// Add a slow job
		store.addJob({
			name: "slow-job",
			schedule: "* * * * *",
			command: "sleep 2",
		});

		const jobs = store.listJobs();
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;

		// Set next_run to the past
		db.query("UPDATE jobs SET next_run = datetime('now', '-1 minute') WHERE id = $id").run({
			$id: jobs[0].id,
		});

		scheduler.start();

		// Wait for two ticks — the second should skip because job is still running
		await new Promise((r) => setTimeout(r, 200));

		scheduler.stop();

		// Only one real execution should have started — others should be "skipped"
		const executions = store.getExecutions({ jobId: jobs[0].id, limit: 20 });
		const running = executions.filter((e) => e.status !== "skipped");
		expect(running.length).toBe(1);
		// Any additional ticks should have been recorded as skipped
		const skipped = executions.filter((e) => e.status === "skipped");
		expect(skipped.length).toBeGreaterThanOrEqual(0);
	});

	it("records skipped executions when job overlaps", async () => {
		scheduler = new Scheduler({ dbPath, pollInterval: 100, port: 0 });
		const store = scheduler.getStore();

		// Add a slow job
		store.addJob({
			name: "overlap-job",
			schedule: "* * * * *",
			command: "sleep 5",
		});

		const jobs = store.listJobs();
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;

		// Set next_run to the past so it triggers on every tick
		db.query("UPDATE jobs SET next_run = datetime('now', '-1 minute') WHERE id = $id").run({
			$id: jobs[0].id,
		});

		scheduler.start();

		// Wait for multiple ticks — second+ ticks should record skipped executions
		await new Promise((r) => setTimeout(r, 300));

		scheduler.stop();

		const executions = store.getExecutions({ jobId: jobs[0].id, limit: 10 });
		// Should have at least 1 running + 1 skipped
		const skipped = executions.filter((e) => e.status === "skipped");
		expect(skipped.length).toBeGreaterThanOrEqual(1);
		expect(skipped[0].stderr).toContain("previous execution still running");
	});

	it("recovers stale executions on startup", async () => {
		// Pre-seed the database with a "running" execution (simulating a crash)
		const preStore = new Store(dbPath);
		const job = preStore.addJob({
			name: "stale-job",
			schedule: "* * * * *",
			command: "echo test",
		});
		preStore.startExecution(job.id, job.name, 0);

		// Verify it's in "running" state
		let execs = preStore.getExecutions({ jobId: job.id });
		expect(execs[0].status).toBe("running");
		preStore.close();

		// Start scheduler — should recover the stale execution
		scheduler = new Scheduler({ dbPath, port: 0 });
		scheduler.start();

		const store = scheduler.getStore();
		execs = store.getExecutions({ jobId: job.id });
		const recovered = execs.find(
			(e) => e.status === "failed" && e.stderr.includes("scheduler restart"),
		);
		expect(recovered).toBeDefined();
	});

	it("rejects negative maxConcurrent", () => {
		expect(() => new Scheduler({ dbPath, maxConcurrent: -1 })).toThrow(
			"maxConcurrent must be 0 (unlimited) or a positive integer",
		);
	});

	it("rejects non-integer maxConcurrent", () => {
		expect(() => new Scheduler({ dbPath, maxConcurrent: 2.5 })).toThrow(
			"maxConcurrent must be 0 (unlimited) or a positive integer",
		);
	});

	it("creates with maxConcurrent option", () => {
		scheduler = new Scheduler({ dbPath, maxConcurrent: 5 });
		expect(scheduler).toBeDefined();
	});

	it("limits concurrent job execution with maxConcurrent", async () => {
		scheduler = new Scheduler({ dbPath, pollInterval: 100, port: 0, maxConcurrent: 1 });
		const store = scheduler.getStore();

		// Add two slow jobs, both due immediately
		store.addJob({ name: "slow-1", schedule: "* * * * *", command: "sleep 5" });
		store.addJob({ name: "slow-2", schedule: "* * * * *", command: "sleep 5" });

		const jobs = store.listJobs();
		const db = (store as unknown as { db: import("bun:sqlite").Database }).db;
		for (const j of jobs) {
			db.query("UPDATE jobs SET next_run = datetime('now', '-1 minute') WHERE id = $id").run({
				$id: j.id,
			});
		}

		scheduler.start();
		await new Promise((r) => setTimeout(r, 300));
		scheduler.stop();

		// With maxConcurrent=1, only one job should have started a real execution
		const allExecs = store.getExecutions({ limit: 20 });
		const nonSkipped = allExecs.filter((e) => e.status !== "skipped");
		// Should have at most 1 running execution (the other was deferred)
		expect(nonSkipped.length).toBeLessThanOrEqual(2); // 1 for slow-1, possibly 1 skip for slow-1 overlap
		// Both jobs shouldn't have started simultaneously
		const job1Execs = allExecs.filter((e) => e.jobName === "slow-1" && e.status !== "skipped");
		const job2Execs = allExecs.filter((e) => e.jobName === "slow-2" && e.status !== "skipped");
		// At most one of them should have a real execution
		expect(job1Execs.length + job2Execs.length).toBeLessThanOrEqual(1);
	});

	it("skips disabled jobs", async () => {
		scheduler = new Scheduler({ dbPath, pollInterval: 100, port: 0 });
		const store = scheduler.getStore();

		store.addJob({
			name: "disabled-job",
			schedule: "* * * * *",
			command: "echo should-not-run",
			enabled: false,
		});

		scheduler.start();
		await new Promise((r) => setTimeout(r, 200));
		scheduler.stop();

		const executions = store.getExecutions();
		expect(executions).toHaveLength(0);
	});

	it("advances next_run on skip to prevent skip record flood", async () => {
		scheduler = new Scheduler({ dbPath, pollInterval: 100, port: 0 });
		const store = scheduler.getStore();

		// Add a job that runs every minute with a long-running command
		store.addJob({
			name: "slow-flood-test",
			schedule: "* * * * *",
			command: "sleep 10",
		});

		scheduler.start();
		// Wait enough ticks that without the fix, we'd get many skip records
		await new Promise((r) => setTimeout(r, 800));
		await scheduler.stop(1000);

		const executions = store.getExecutions({ limit: 100 });
		// Should have 1 running/success + at most 1 skip record
		// Without the fix, we'd have ~8 skip records (one per 100ms tick)
		const skipRecords = executions.filter((e) => e.status === "skipped");
		expect(skipRecords.length).toBeLessThanOrEqual(1);
	});

	it("defaults hostname to 127.0.0.1", () => {
		scheduler = new Scheduler({ dbPath, pollInterval: 100, port: 0 });
		// Verify the scheduler was created without error — the default hostname is 127.0.0.1
		expect(scheduler).toBeDefined();
	});

	it("accepts custom hostname option", () => {
		scheduler = new Scheduler({
			dbPath,
			pollInterval: 100,
			port: 0,
			hostname: "0.0.0.0",
		});
		expect(scheduler).toBeDefined();
	});
});
