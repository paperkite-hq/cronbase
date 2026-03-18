/**
 * Tests for API token authentication.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { createServer } from "../src/server";
import { Store } from "../src/store";

const TEST_DB = "/tmp/cronbase-auth-test.db";
const TEST_PORT = 17435;
const API_TOKEN = "test-secret-token-12345";

let store: Store;
let server: ReturnType<typeof createServer>;
const base = `http://localhost:${TEST_PORT}`;

beforeAll(() => {
	try {
		unlinkSync(TEST_DB);
	} catch {}
	store = new Store(TEST_DB);
	server = createServer({ store, port: TEST_PORT, apiToken: API_TOKEN });
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

describe("API Token Authentication", () => {
	test("rejects API requests without token", async () => {
		const res = await fetch(`${base}/api/jobs`);
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toBe("Unauthorized");
	});

	test("rejects API requests with wrong token", async () => {
		const res = await fetch(`${base}/api/jobs`, {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(401);
	});

	test("rejects token of different length (exercises timing-safe padding)", async () => {
		const res = await fetch(`${base}/api/jobs`, {
			headers: { Authorization: "Bearer x" },
		});
		expect(res.status).toBe(401);
	});

	test("accepts API requests with correct token", async () => {
		const res = await fetch(`${base}/api/jobs`, {
			headers: { Authorization: `Bearer ${API_TOKEN}` },
		});
		expect(res.status).toBe(200);
	});

	test("health endpoint remains unauthenticated", async () => {
		const res = await fetch(`${base}/health`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.status).toBe("ok");
	});

	test("dashboard requires token via query param when apiToken is set", async () => {
		// Without token — 401
		const res1 = await fetch(`${base}/`);
		expect(res1.status).toBe(401);

		// With wrong token — 401
		const res2 = await fetch(`${base}/?token=wrong`);
		expect(res2.status).toBe(401);

		// With correct token — 200
		const res3 = await fetch(`${base}/?token=${API_TOKEN}`);
		expect(res3.status).toBe(200);
		expect(res3.headers.get("content-type")).toContain("text/html");
		const html = await res3.text();
		expect(html).toContain("API_TOKEN");
	});

	test("POST /api/jobs requires auth", async () => {
		const res = await fetch(`${base}/api/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "test", schedule: "@daily", command: "echo" }),
		});
		expect(res.status).toBe(401);
	});

	test("POST /api/jobs works with auth", async () => {
		const res = await fetch(`${base}/api/jobs`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${API_TOKEN}`,
			},
			body: JSON.stringify({ name: "test-auth-create", schedule: "@daily", command: "echo hi" }),
		});
		expect(res.status).toBe(201);
	});

	test("OPTIONS is unauthenticated for CORS preflight", async () => {
		const res = await fetch(`${base}/api/jobs`, { method: "OPTIONS" });
		expect(res.status).toBe(204);
	});

	test("CORS does not send Access-Control-Allow-Origin when API token is set", async () => {
		const res = await fetch(`${base}/api/jobs`, {
			headers: { Authorization: `Bearer ${API_TOKEN}` },
		});
		expect(res.status).toBe(200);
		// When auth is enabled, wildcard CORS is omitted to prevent cross-origin exploitation
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("dashboard response includes Cache-Control: no-store when token is set", async () => {
		const res = await fetch(`${base}/?token=${API_TOKEN}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store, private");
	});

	test("dashboard embeds token safely via JSON.stringify", async () => {
		const res = await fetch(`${base}/?token=${API_TOKEN}`);
		const html = await res.text();
		// JSON.stringify wraps in double quotes — verify the token is properly JSON-encoded
		expect(html).toContain(`const API_TOKEN = ${JSON.stringify(API_TOKEN)};`);
		// Must NOT use the old single-quote escaping pattern
		expect(html).not.toContain(`const API_TOKEN = '`);
	});
});
