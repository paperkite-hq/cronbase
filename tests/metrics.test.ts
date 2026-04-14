/**
 * Tests for Prometheus metrics endpoint.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { createServer } from "../src/server";
import { Store } from "../src/store";

const TEST_DB = "/tmp/cronbase-metrics-test.db";
const TEST_PORT = 17437;

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
	for (const job of store.listJobs()) {
		store.deleteJob(job.id);
	}
});

describe("Prometheus metrics", () => {
	test("GET /metrics returns Prometheus exposition format", async () => {
		const res = await fetch(`${base}/metrics`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/plain");
		const body = await res.text();
		expect(body).toContain("# HELP cronbase_info");
		expect(body).toContain("# TYPE cronbase_info gauge");
		expect(body).toContain('cronbase_info{version="');
		expect(body).toContain("cronbase_jobs_total");
		expect(body).toContain("cronbase_executions_total");
		expect(body).toContain("cronbase_scheduler_paused");
		expect(body).toContain("cronbase_db_size_bytes");
		expect(body).toContain("cronbase_execution_duration_seconds_count");
		expect(body).toContain("cronbase_execution_duration_seconds_sum");
	});

	test("/metrics reflects job counts", async () => {
		store.addJob({ name: "m1", schedule: "* * * * *", command: "echo 1" });
		store.addJob({ name: "m2", schedule: "* * * * *", command: "echo 2" });
		store.addJob({ name: "m3", schedule: "* * * * *", command: "echo 3", enabled: false });

		const res = await fetch(`${base}/metrics`);
		const body = await res.text();
		expect(body).toContain('cronbase_jobs_total{status="enabled"} 2');
		expect(body).toContain('cronbase_jobs_total{status="disabled"} 1');
	});

	test("/metrics reflects paused state", async () => {
		store.setPaused(true);
		const res1 = await fetch(`${base}/metrics`);
		const body1 = await res1.text();
		expect(body1).toContain("cronbase_scheduler_paused 1");

		store.setPaused(false);
		const res2 = await fetch(`${base}/metrics`);
		const body2 = await res2.text();
		expect(body2).toContain("cronbase_scheduler_paused 0");
	});

	test("/metrics is unauthenticated", async () => {
		const res = await fetch(`${base}/metrics`);
		expect(res.status).toBe(200);
	});
});

describe("Metrics with auth enabled", () => {
	const AUTH_PORT = 17438;
	const API_TOKEN = "metrics-auth-test-token";
	let authStore: Store;
	let authServer: ReturnType<typeof createServer>;
	const authBase = `http://localhost:${AUTH_PORT}`;
	const AUTH_DB = "/tmp/cronbase-metrics-auth-test.db";

	beforeAll(() => {
		try {
			unlinkSync(AUTH_DB);
		} catch {}
		authStore = new Store(AUTH_DB);
		authServer = createServer({ store: authStore, port: AUTH_PORT, apiToken: API_TOKEN });
	});

	afterAll(() => {
		authServer.stop();
		authStore.close();
		try {
			unlinkSync(AUTH_DB);
		} catch {}
	});

	test("metrics endpoint remains unauthenticated when auth is enabled", async () => {
		const res = await fetch(`${authBase}/metrics`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("cronbase_info");
	});
});
