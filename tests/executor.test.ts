import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { executeJob } from "../src/executor";
import { Store } from "../src/store";
import type { Job } from "../src/types";

const TEST_DB = "/tmp/cronbase-executor-test.db";
let store: Store;

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: 1,
		name: "test-job",
		schedule: "@daily",
		command: "echo hello",
		cwd: "/tmp",
		env: {},
		timeout: 0,
		retry: { maxAttempts: 0, baseDelay: 1 },
		enabled: true,
		description: "",
		tags: [],
		createdAt: new Date().toISOString(),
		nextRun: null,
		lastStatus: null,
		lastRun: null,
		...overrides,
	};
}

beforeEach(() => {
	try {
		unlinkSync(TEST_DB);
	} catch {
		/* ok */
	}
	try {
		unlinkSync(`${TEST_DB}-wal`);
	} catch {
		/* ok */
	}
	try {
		unlinkSync(`${TEST_DB}-shm`);
	} catch {
		/* ok */
	}
	store = new Store(TEST_DB);
});

afterEach(() => {
	store.close();
	try {
		unlinkSync(TEST_DB);
	} catch {
		/* ok */
	}
	try {
		unlinkSync(`${TEST_DB}-wal`);
	} catch {
		/* ok */
	}
	try {
		unlinkSync(`${TEST_DB}-shm`);
	} catch {
		/* ok */
	}
});

describe("executeJob", () => {
	test("executes a successful command", async () => {
		const dbJob = store.addJob({ name: "echo-test", schedule: "@daily", command: "echo hello" });
		const job = makeJob({ id: dbJob.id, name: dbJob.name, command: "echo hello" });
		const result = await executeJob(job, store);

		expect(result.status).toBe("success");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("hello");
		expect(result.durationMs).toBeGreaterThan(0);
	});

	test("captures stderr on failure", async () => {
		const dbJob = store.addJob({
			name: "fail-test",
			schedule: "@daily",
			command: "echo error >&2 && exit 1",
		});
		const job = makeJob({ id: dbJob.id, name: dbJob.name, command: "echo error >&2 && exit 1" });
		const result = await executeJob(job, store);

		expect(result.status).toBe("failed");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.trim()).toBe("error");
	});

	test(
		"enforces timeout",
		async () => {
			// Use "exec sleep" so the sleep process receives SIGTERM directly
			// (without exec, sh traps signals and sleep runs for its full duration)
			const dbJob = store.addJob({
				name: "timeout-test",
				schedule: "@daily",
				command: "exec sleep 30",
			});
			const job = makeJob({
				id: dbJob.id,
				name: dbJob.name,
				command: "exec sleep 30",
				timeout: 1,
			});
			const result = await executeJob(job, store);

			expect(result.status).toBe("timeout");
			expect(result.durationMs).toBeLessThan(10000);
		},
		{ timeout: 15000 },
	);

	test("retries on failure", async () => {
		const dbJob = store.addJob({
			name: "retry-test",
			schedule: "@daily",
			command: "exit 1",
			retry: { maxAttempts: 2, baseDelay: 1 },
		});
		const job = makeJob({
			id: dbJob.id,
			name: dbJob.name,
			command: "exit 1",
			retry: { maxAttempts: 2, baseDelay: 0.01 }, // fast backoff for test
		});

		const result = await executeJob(job, store);

		expect(result.status).toBe("failed");

		// Should have 3 executions (1 initial + 2 retries)
		const execs = store.getExecutions({ jobId: dbJob.id });
		expect(execs).toHaveLength(3);
	});

	test("passes env vars to command", async () => {
		const dbJob = store.addJob({ name: "env-test", schedule: "@daily", command: "echo $TEST_VAR" });
		const job = makeJob({
			id: dbJob.id,
			name: dbJob.name,
			command: "echo $TEST_VAR",
			env: { TEST_VAR: "cronbase-rocks" },
		});

		const result = await executeJob(job, store);
		expect(result.status).toBe("success");
		expect(result.stdout.trim()).toBe("cronbase-rocks");
	});

	test(
		"truncates large output without unbounded memory",
		async () => {
			// Generate output larger than 1 MiB (the MAX_OUTPUT_BYTES limit)
			// Using printf to generate ~1.1 MiB of output
			const dbJob = store.addJob({
				name: "large-output-test",
				schedule: "@daily",
				command: "dd if=/dev/zero bs=1024 count=1200 2>/dev/null | tr '\\0' 'A'",
			});
			const job = makeJob({
				id: dbJob.id,
				name: dbJob.name,
				command: "dd if=/dev/zero bs=1024 count=1200 2>/dev/null | tr '\\0' 'A'",
			});

			const result = await executeJob(job, store);
			expect(result.status).toBe("success");
			// Output should be truncated to ~1 MiB + truncation message
			expect(result.stdout).toContain("[truncated at 1048576 bytes]");
			expect(result.stdout.length).toBeLessThan(1048576 + 100); // 1 MiB + truncation note
		},
		{ timeout: 15000 },
	);

	test("records execution in store", async () => {
		const dbJob = store.addJob({ name: "record-test", schedule: "@daily", command: "echo stored" });
		const job = makeJob({ id: dbJob.id, name: dbJob.name, command: "echo stored" });

		await executeJob(job, store);

		const execs = store.getExecutions({ jobId: dbJob.id });
		expect(execs).toHaveLength(1);
		expect(execs[0].status).toBe("success");
		expect(execs[0].stdout.trim()).toBe("stored");
		expect(execs[0].finishedAt).toBeTruthy();
	});
});
