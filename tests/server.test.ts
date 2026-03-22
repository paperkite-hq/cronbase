/**
 * Tests for the cronbase HTTP server and REST API.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { createServer } from "../src/server";
import { Store } from "../src/store";

const TEST_DB = "/tmp/cronbase-server-test.db";
const TEST_PORT = 17433;

let store: Store;
let server: ReturnType<typeof createServer>;
const base = `http://localhost:${TEST_PORT}`;

beforeAll(() => {
	try {
		unlinkSync(TEST_DB);
	} catch {}
	store = new Store(TEST_DB);
	server = createServer({ store, port: TEST_PORT });
});

afterAll(() => {
	server.stop();
	store.close();
	try {
		unlinkSync(TEST_DB);
	} catch {}
});

beforeEach(() => {
	// Clean jobs between tests
	for (const job of store.listJobs()) {
		store.deleteJob(job.id);
	}
});

async function api(path: string, opts: RequestInit = {}) {
	const res = await fetch(base + path, {
		headers: { "Content-Type": "application/json" },
		...opts,
	});
	return { status: res.status, data: await res.json() };
}

describe("Dashboard", () => {
	test("serves HTML at /", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const html = await res.text();
		expect(html).toContain("cronbase");
		expect(html).toContain("data-theme");
	});

	test("returns 404 for unknown paths", async () => {
		const res = await fetch(`${base}/unknown`);
		expect(res.status).toBe(404);
	});

	test("dashboard contains env vars editor", async () => {
		const res = await fetch(`${base}/`);
		const html = await res.text();
		expect(html).toContain("env-editor");
		expect(html).toContain("env-rows");
		expect(html).toContain("Add variable");
	});

	test("dashboard contains tags editor", async () => {
		const res = await fetch(`${base}/`);
		const html = await res.text();
		expect(html).toContain("tags-editor");
		expect(html).toContain("tags-list");
		expect(html).toContain("tag-input");
	});

	test("dashboard contains alerts modal", async () => {
		const res = await fetch(`${base}/`);
		const html = await res.text();
		expect(html).toContain("alerts-modal");
		expect(html).toContain("webhooks-container");
		expect(html).toContain("Save Alerts");
	});

	test("no Cache-Control header when no API token is set", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBeNull();
	});
});

describe("GET /api/stats", () => {
	test("returns stats with no jobs", async () => {
		const { status, data } = await api("/api/stats");
		expect(status).toBe(200);
		expect(data.totalJobs).toBe(0);
		expect(data.enabledJobs).toBe(0);
		expect(data.recentSuccesses).toBe(0);
		expect(data.recentFailures).toBe(0);
	});

	test("returns stats reflecting jobs", async () => {
		store.addJob({ name: "test-stat", schedule: "@daily", command: "echo hi" });
		const { data } = await api("/api/stats");
		expect(data.totalJobs).toBe(1);
		expect(data.enabledJobs).toBe(1);
	});
});

describe("GET /api/jobs", () => {
	test("returns empty array when no jobs", async () => {
		const { status, data } = await api("/api/jobs");
		expect(status).toBe(200);
		expect(data).toEqual([]);
	});

	test("returns jobs with schedule description", async () => {
		store.addJob({ name: "test-list", schedule: "0 * * * *", command: "echo hourly" });
		const { data } = await api("/api/jobs");
		expect(data).toHaveLength(1);
		expect(data[0].name).toBe("test-list");
		expect(data[0].schedule).toBe("0 * * * *");
		expect(data[0].scheduleDescription).toBeTruthy();
	});
});

describe("POST /api/jobs", () => {
	test("creates a new job", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "test-create",
				schedule: "*/5 * * * *",
				command: "echo hello",
				description: "Test job",
			}),
		});
		expect(status).toBe(201);
		expect(data.name).toBe("test-create");
		expect(data.command).toBe("echo hello");
		expect(data.scheduleDescription).toBeTruthy();
	});

	test("rejects missing required fields", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({ name: "incomplete" }),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("required");
	});

	test("rejects invalid cron expression", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "bad-cron",
				schedule: "invalid",
				command: "echo test",
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Invalid schedule");
	});

	test("returns 400 for malformed JSON body", async () => {
		const res = await fetch(`${base}/api/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not valid json{{{",
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toContain("Invalid JSON");
	});

	test("creates a job with tags and env vars", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "tagged-job",
				schedule: "0 * * * *",
				command: "echo hi",
				tags: ["deploy", "prod"],
				env: { NODE_ENV: "production", DEBUG: "true" },
			}),
		});
		expect(status).toBe(201);
		expect(data.tags).toEqual(["deploy", "prod"]);
		expect(data.env).toEqual({ NODE_ENV: "production", DEBUG: "true" });

		// Verify tags and env persist in listing
		const list = await api("/api/jobs");
		const job = list.data.find((j: { name: string }) => j.name === "tagged-job");
		expect(job.tags).toEqual(["deploy", "prod"]);
		expect(job.env).toEqual({ NODE_ENV: "production", DEBUG: "true" });
	});
});

describe("GET /api/jobs/:id", () => {
	test("returns a specific job", async () => {
		const job = store.addJob({ name: "test-get", schedule: "@hourly", command: "echo get" });
		const { status, data } = await api(`/api/jobs/${job.id}`);
		expect(status).toBe(200);
		expect(data.name).toBe("test-get");
	});

	test("returns 404 for non-existent job", async () => {
		const { status } = await api("/api/jobs/99999");
		expect(status).toBe(404);
	});
});

describe("PUT /api/jobs/:id", () => {
	test("updates a job", async () => {
		const job = store.addJob({ name: "test-update", schedule: "@daily", command: "echo old" });
		const { status, data } = await api(`/api/jobs/${job.id}`, {
			method: "PUT",
			body: JSON.stringify({ command: "echo new", description: "Updated" }),
		});
		expect(status).toBe(200);
		expect(data.command).toBe("echo new");
		expect(data.description).toBe("Updated");
	});

	test("rejects invalid schedule on update", async () => {
		const job = store.addJob({ name: "test-bad-update", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}`, {
			method: "PUT",
			body: JSON.stringify({ schedule: "not-valid" }),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Invalid schedule");
	});
});

describe("DELETE /api/jobs/:id", () => {
	test("deletes a job", async () => {
		const job = store.addJob({ name: "test-delete", schedule: "@daily", command: "echo del" });
		const { status } = await api(`/api/jobs/${job.id}`, { method: "DELETE" });
		expect(status).toBe(200);
		const check = store.getJob(job.id);
		expect(check).toBeNull();
	});
});

describe("PATCH /api/jobs/:id/toggle", () => {
	test("toggles job enabled state", async () => {
		const job = store.addJob({ name: "test-toggle", schedule: "@daily", command: "echo" });
		expect(job.enabled).toBe(true);

		const { data: disabled } = await api(`/api/jobs/${job.id}/toggle`, { method: "PATCH" });
		expect(disabled.enabled).toBe(false);

		const { data: enabled } = await api(`/api/jobs/${job.id}/toggle`, { method: "PATCH" });
		expect(enabled.enabled).toBe(true);
	});
});

describe("POST /api/jobs/:id/run", () => {
	test("triggers a job run", async () => {
		const job = store.addJob({
			name: "test-run",
			schedule: "@daily",
			command: "echo triggered",
		});
		const { status, data } = await api(`/api/jobs/${job.id}/run`, { method: "POST" });
		expect(status).toBe(202);
		expect(data.status).toBe("started");
		expect(data.jobName).toBe("test-run");
	});

	test("returns 404 for non-existent job", async () => {
		const { status } = await api("/api/jobs/99999/run", { method: "POST" });
		expect(status).toBe(404);
	});
});

describe("GET /api/executions", () => {
	test("returns executions after a job run", async () => {
		const job = store.addJob({
			name: "test-exec-history",
			schedule: "@daily",
			command: "echo exec-test",
		});
		// Create a manual execution record
		const execId = store.startExecution(job.id, job.name, 0);
		store.finishExecution(execId, "success", 0, "output", "", 100);

		const { data } = await api("/api/executions");
		expect(data.length).toBeGreaterThanOrEqual(1);
		expect(data[0].jobName).toBe("test-exec-history");
	});

	test("filters by jobId", async () => {
		const job1 = store.addJob({ name: "exec-filter-1", schedule: "@daily", command: "echo 1" });
		const job2 = store.addJob({ name: "exec-filter-2", schedule: "@daily", command: "echo 2" });
		const eid1 = store.startExecution(job1.id, job1.name, 0);
		store.finishExecution(eid1, "success", 0, "", "", 50);
		const eid2 = store.startExecution(job2.id, job2.name, 0);
		store.finishExecution(eid2, "success", 0, "", "", 50);

		const { data } = await api(`/api/executions?jobId=${job1.id}`);
		expect(data).toHaveLength(1);
		expect(data[0].jobName).toBe("exec-filter-1");
	});
});

describe("GET /api/cron/describe", () => {
	test("describes a valid cron expression", async () => {
		const { data } = await api(`/api/cron/describe?expr=${encodeURIComponent("*/5 * * * *")}`);
		expect(data.valid).toBe(true);
		expect(data.description).toBeTruthy();
	});

	test("returns error for invalid expression", async () => {
		const { data } = await api("/api/cron/describe?expr=invalid");
		expect(data.valid).toBe(false);
		expect(data.error).toBeTruthy();
	});

	test("requires expr parameter", async () => {
		const { status, data } = await api("/api/cron/describe");
		expect(status).toBe(400);
		expect(data.error).toContain("expr");
	});
});

describe("CORS", () => {
	test("OPTIONS returns CORS headers", async () => {
		const res = await fetch(`${base}/api/jobs`, { method: "OPTIONS" });
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-methods")).toContain("GET");
	});
});

describe("Input validation via API", () => {
	test("rejects job with invalid name characters", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "bad name!",
				schedule: "@daily",
				command: "echo hi",
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("name");
	});

	test("rejects job with reserved env var", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "env-test",
				schedule: "@daily",
				command: "echo hi",
				env: { USER: "nobody" },
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("USER");
	});

	test("allows PATH override in env", async () => {
		const { status } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "path-env-test",
				schedule: "@daily",
				command: "echo hi",
				env: { PATH: "/usr/local/bin:/usr/bin" },
			}),
		});
		expect(status).toBe(201);
	});

	test("rejects update with invalid name", async () => {
		const job = store.addJob({ name: "valid-job", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}`, {
			method: "PUT",
			body: JSON.stringify({ name: "spaces not allowed" }),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("name");
	});

	test("rejects webhook with non-http URL", async () => {
		const job = store.addJob({ name: "webhook-test", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}/alerts`, {
			method: "PUT",
			body: JSON.stringify({
				webhooks: [{ url: "ftp://evil.com/hook", events: ["failed"] }],
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("http");
	});

	test("rejects webhook with empty events array", async () => {
		const job = store.addJob({ name: "webhook-empty-events", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}/alerts`, {
			method: "PUT",
			body: JSON.stringify({
				webhooks: [{ url: "https://hooks.slack.com/test", events: [] }],
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("non-empty events");
	});

	test("rejects webhook with invalid event type", async () => {
		const job = store.addJob({ name: "webhook-event-test", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}/alerts`, {
			method: "PUT",
			body: JSON.stringify({
				webhooks: [{ url: "https://hooks.slack.com/test", events: ["invalid"] }],
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Invalid event");
	});

	test("deduplicates webhook events", async () => {
		const job = store.addJob({ name: "webhook-dedup", schedule: "@daily", command: "echo" });
		const { status } = await api(`/api/jobs/${job.id}/alerts`, {
			method: "PUT",
			body: JSON.stringify({
				webhooks: [
					{ url: "https://hooks.slack.com/test", events: ["success", "success", "failed"] },
				],
			}),
		});
		expect(status).toBe(200);
		const { data } = await api(`/api/jobs/${job.id}/alerts`);
		expect(data.webhooks[0].events).toHaveLength(2);
		expect(data.webhooks[0].events).toContain("success");
		expect(data.webhooks[0].events).toContain("failed");
	});
});

describe("Duplicate job name handling", () => {
	test("POST /api/jobs rejects duplicate name with 409", async () => {
		store.addJob({ name: "unique-job", schedule: "@daily", command: "echo first" });
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "unique-job",
				schedule: "@hourly",
				command: "echo second",
			}),
		});
		expect(status).toBe(409);
		expect(data.error).toContain("already exists");
	});

	test("PUT /api/jobs/:id rejects rename to existing name with 409", async () => {
		store.addJob({ name: "name-taken", schedule: "@daily", command: "echo" });
		const job2 = store.addJob({ name: "will-rename", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job2.id}`, {
			method: "PUT",
			body: JSON.stringify({ name: "name-taken" }),
		});
		expect(status).toBe(409);
		expect(data.error).toContain("already exists");
	});

	test("PUT /api/jobs/:id allows keeping same name", async () => {
		const job = store.addJob({ name: "keep-name", schedule: "@daily", command: "echo" });
		const { status } = await api(`/api/jobs/${job.id}`, {
			method: "PUT",
			body: JSON.stringify({ name: "keep-name", command: "echo updated" }),
		});
		expect(status).toBe(200);
	});
});

describe("PUT /api/jobs/:id validation", () => {
	test("rejects invalid CWD on update", async () => {
		const job = store.addJob({ name: "cwd-test", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}`, {
			method: "PUT",
			body: JSON.stringify({ cwd: "x".repeat(5000) }),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Working directory");
	});

	test("rejects invalid retry config on update", async () => {
		const job = store.addJob({ name: "retry-test", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}`, {
			method: "PUT",
			body: JSON.stringify({ retry: { maxAttempts: 999, baseDelay: 1 } }),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("maxAttempts");
	});

	test("rejects negative timeout on create", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "timeout-test",
				schedule: "* * * * *",
				command: "echo hi",
				timeout: -5,
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Timeout");
	});

	test("rejects excessive timeout on create", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "timeout-test2",
				schedule: "* * * * *",
				command: "echo hi",
				timeout: 100000,
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Timeout");
	});

	test("rejects invalid timeout on update", async () => {
		const job = store.addJob({ name: "timeout-update", schedule: "@daily", command: "echo" });
		const { status, data } = await api(`/api/jobs/${job.id}`, {
			method: "PUT",
			body: JSON.stringify({ timeout: -10 }),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Timeout");
	});

	test("rejects oversized schedule on create", async () => {
		const { status, data } = await api("/api/jobs", {
			method: "POST",
			body: JSON.stringify({
				name: "sched-test",
				schedule: "* ".repeat(300),
				command: "echo hi",
			}),
		});
		expect(status).toBe(400);
		expect(data.error).toContain("Schedule");
	});

	test("DELETE alerts returns 404 for nonexistent job", async () => {
		const { status, data } = await api("/api/jobs/99999/alerts", {
			method: "DELETE",
		});
		expect(status).toBe(404);
		expect(data.error).toBe("Job not found");
	});
});

describe("manual run concurrency gate", () => {
	let gatedStore: Store;
	let gatedServer: ReturnType<typeof createServer>;
	const GATED_PORT = 17436;
	const gatedBase = `http://localhost:${GATED_PORT}`;

	beforeAll(() => {
		const dbPath = `/tmp/cronbase-gated-test-${Date.now()}.db`;
		gatedStore = new Store(dbPath);
		gatedServer = createServer({
			store: gatedStore,
			port: GATED_PORT,
			canRunJob: (_jobId: number) => "Concurrency limit reached (1/1 jobs running)",
			trackActiveJob: () => {},
		});
	});

	afterAll(() => {
		gatedServer.stop();
		gatedStore.close();
	});

	test("manual run returns 429 when concurrency limit is hit", async () => {
		// Create a job
		const createRes = await fetch(`${gatedBase}/api/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "gated-test", schedule: "* * * * *", command: "echo ok" }),
		});
		const job = await createRes.json();

		// Try to run — should be denied by canRunJob gate
		const runRes = await fetch(`${gatedBase}/api/jobs/${job.id}/run`, { method: "POST" });
		expect(runRes.status).toBe(429);
		const body = await runRes.json();
		expect(body.error).toContain("Concurrency limit");
	});
});

describe("Execution query param validation", () => {
	test("rejects non-numeric jobId", async () => {
		const { status, data } = await api("/api/executions?jobId=abc");
		expect(status).toBe(400);
		expect(data.error).toContain("jobId must be a positive integer");
	});

	test("rejects negative jobId", async () => {
		const { status, data } = await api("/api/executions?jobId=-1");
		expect(status).toBe(400);
		expect(data.error).toContain("jobId must be a positive integer");
	});

	test("rejects limit exceeding 1000", async () => {
		const { status, data } = await api("/api/executions?limit=5000");
		expect(status).toBe(400);
		expect(data.error).toContain("limit must be between 1 and 1000");
	});

	test("rejects non-numeric limit", async () => {
		const { status, data } = await api("/api/executions?limit=xyz");
		expect(status).toBe(400);
		expect(data.error).toContain("limit must be between 1 and 1000");
	});

	test("accepts valid query params", async () => {
		const { status } = await api("/api/executions?jobId=1&limit=50");
		expect(status).toBe(200);
	});

	test("rejects float jobId", async () => {
		const { status, data } = await api("/api/executions?jobId=1.5");
		expect(status).toBe(400);
		expect(data.error).toContain("positive integer");
	});
});

describe("PUT /api/jobs/:id schedule validation", () => {
	test("rejects empty string schedule", async () => {
		// Create a job first
		const createRes = await fetch(`${base}/api/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "empty-sched-test", schedule: "* * * * *", command: "echo hi" }),
		});
		const job = await createRes.json();

		// Try to update with empty schedule
		const res = await fetch(`${base}/api/jobs/${job.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ schedule: "" }),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toContain("schedule cannot be empty");
	});
});

describe("Internal error handling", () => {
	test("does not leak internal error details", async () => {
		// Send a request that will cause an internal error (invalid JSON that passes initial parse)
		// We can't easily trigger an internal error, but we can verify the error handler format
		const res = await fetch(`${base}/api/nonexistent-endpoint`);
		expect(res.status).toBe(404);
		const data = await res.json();
		// 404 should not contain stack traces or file paths
		expect(data.error).not.toContain("/");
	});
});
