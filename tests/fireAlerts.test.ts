import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { type AlertPayload, fireAlerts, formatDiscord, formatSlack } from "../src/alerts";
import type { AlertConfig, Execution, Job } from "../src/types";

function makePayload(overrides?: Partial<AlertPayload>): AlertPayload {
	return {
		event: "failed",
		job: {
			id: 1,
			name: "backup-db",
			schedule: "0 3 * * *",
			command: "pg_dump mydb > /backups/mydb.sql",
		},
		execution: {
			id: 42,
			status: "failed",
			exitCode: 1,
			durationMs: 5230,
			startedAt: "2026-03-18T03:00:00.000Z",
			finishedAt: "2026-03-18T03:00:05.230Z",
			stdoutTail: "",
			stderrTail: "pg_dump: connection refused",
			attempt: 0,
		},
		timestamp: "2026-03-18T03:00:05.300Z",
		...overrides,
	};
}

function makeJob(overrides?: Partial<Job>): Job {
	return {
		id: 1,
		name: "backup-db",
		schedule: "0 3 * * *",
		command: "pg_dump mydb > /backups/mydb.sql",
		cwd: ".",
		env: {},
		timeout: 300,
		retry: { maxAttempts: 0, baseDelay: 30 },
		enabled: true,
		description: "Database backup",
		tags: [],
		createdAt: "2026-03-01T00:00:00.000Z",
		nextRun: "2026-03-19T03:00:00.000Z",
		lastStatus: "failed",
		lastRun: "2026-03-18T03:00:05.230Z",
		...overrides,
	};
}

function makeExecution(overrides?: Partial<Execution>): Execution {
	return {
		id: 42,
		jobId: 1,
		jobName: "backup-db",
		status: "failed",
		startedAt: "2026-03-18T03:00:00.000Z",
		finishedAt: "2026-03-18T03:00:05.230Z",
		durationMs: 5230,
		exitCode: 1,
		stdout: "",
		stderr: "pg_dump: connection refused",
		attempt: 0,
		...overrides,
	};
}

describe("formatSlack", () => {
	it("includes stderr in failure payload", () => {
		const payload = makePayload();
		const result = formatSlack(payload) as {
			attachments: Array<{ color: string; blocks: unknown[] }>;
		};
		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].color).toBe("#ef4444");
		// Should have 3 blocks: header, fields, stderr
		expect(result.attachments[0].blocks).toHaveLength(3);
	});

	it("omits stderr block on success", () => {
		const payload = makePayload({
			event: "success",
			execution: { ...makePayload().execution, stderrTail: "" },
		});
		const result = formatSlack(payload) as {
			attachments: Array<{ color: string; blocks: unknown[] }>;
		};
		expect(result.attachments[0].color).toBe("#22c55e");
		expect(result.attachments[0].blocks).toHaveLength(2);
	});
});

describe("formatDiscord", () => {
	it("includes stderr field for failures", () => {
		const payload = makePayload();
		const result = formatDiscord(payload) as {
			embeds: Array<{ title: string; color: number; fields: unknown[] }>;
		};
		expect(result.embeds).toHaveLength(1);
		expect(result.embeds[0].color).toBe(0xef4444);
		// 3 standard fields + 1 stderr
		expect(result.embeds[0].fields).toHaveLength(4);
	});

	it("truncates long stderr to 1000 chars", () => {
		const longStderr = "x".repeat(2000);
		const payload = makePayload({
			execution: { ...makePayload().execution, stderrTail: longStderr },
		});
		const result = formatDiscord(payload) as {
			embeds: Array<{ fields: Array<{ value: string }> }>;
		};
		const stderrField = result.embeds[0].fields[3];
		// 1000 chars + 6 chars for ``` markers
		expect(stderrField.value.length).toBeLessThanOrEqual(1010);
	});
});

describe("fireAlerts", () => {
	let fetchCalls: Array<{ url: string; body: string }>;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		fetchCalls = [];
		globalThis.fetch = mock(async (url: string | Request, init?: RequestInit) => {
			fetchCalls.push({
				url: typeof url === "string" ? url : url.url,
				body: init?.body as string,
			});
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("fires webhooks for matching events", async () => {
		const config: AlertConfig = {
			webhooks: [{ url: "https://hooks.slack.com/services/T/B/X", events: ["failed", "timeout"] }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe("https://hooks.slack.com/services/T/B/X");

		const body = JSON.parse(fetchCalls[0].body);
		// Slack format detected
		expect(body.attachments).toBeDefined();
	});

	it("skips webhooks for non-matching events", async () => {
		const config: AlertConfig = {
			webhooks: [{ url: "https://hooks.slack.com/services/T/B/X", events: ["success"] }],
		};

		// Execution is failed, webhook only listens for success
		await fireAlerts(makeJob(), makeExecution(), config);

		expect(fetchCalls).toHaveLength(0);
	});

	it("fires to multiple webhooks", async () => {
		const config: AlertConfig = {
			webhooks: [
				{ url: "https://hooks.slack.com/services/T/B/X", events: ["failed"] },
				{ url: "https://discord.com/api/webhooks/123/abc", events: ["failed"] },
				{ url: "https://example.com/webhook", events: ["failed"] },
			],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		expect(fetchCalls).toHaveLength(3);
	});

	it("detects Slack URL and formats accordingly", async () => {
		const config: AlertConfig = {
			webhooks: [{ url: "https://hooks.slack.com/services/T/B/X", events: ["failed"] }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		const body = JSON.parse(fetchCalls[0].body);
		expect(body.attachments).toBeDefined();
	});

	it("detects Discord URL and formats accordingly", async () => {
		const config: AlertConfig = {
			webhooks: [{ url: "https://discord.com/api/webhooks/123/abc", events: ["failed"] }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		const body = JSON.parse(fetchCalls[0].body);
		expect(body.embeds).toBeDefined();
	});

	it("uses generic format for unknown URLs", async () => {
		const config: AlertConfig = {
			webhooks: [{ url: "https://example.com/webhook", events: ["failed"] }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		const body = JSON.parse(fetchCalls[0].body);
		// Generic format has event, job, execution at top level
		expect(body.event).toBe("failed");
		expect(body.job).toBeDefined();
		expect(body.execution).toBeDefined();
	});

	it("handles fetch failures gracefully", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("Network error");
		}) as unknown as typeof fetch;

		const config: AlertConfig = {
			webhooks: [{ url: "https://hooks.slack.com/services/T/B/X", events: ["failed"] }],
		};

		// Should not throw
		await fireAlerts(makeJob(), makeExecution(), config);
	});

	it("handles non-OK responses gracefully", async () => {
		globalThis.fetch = mock(async () => {
			return new Response("Internal Server Error", { status: 500 });
		}) as unknown as typeof fetch;

		const config: AlertConfig = {
			webhooks: [{ url: "https://hooks.slack.com/services/T/B/X", events: ["failed"] }],
		};

		// Should not throw
		await fireAlerts(makeJob(), makeExecution(), config);
	});

	it("builds correct payload for success events", async () => {
		const config: AlertConfig = {
			webhooks: [{ url: "https://example.com/webhook", events: ["success"] }],
		};

		const successExec = makeExecution({ status: "success", exitCode: 0, stderr: "" });
		await fireAlerts(makeJob({ lastStatus: "success" }), successExec, config);

		expect(fetchCalls).toHaveLength(1);
		const body = JSON.parse(fetchCalls[0].body);
		expect(body.event).toBe("success");
	});

	it("builds correct payload for timeout events", async () => {
		const config: AlertConfig = {
			webhooks: [{ url: "https://example.com/webhook", events: ["timeout"] }],
		};

		const timeoutExec = makeExecution({ status: "timeout", exitCode: null });
		await fireAlerts(makeJob({ lastStatus: "timeout" }), timeoutExec, config);

		expect(fetchCalls).toHaveLength(1);
		const body = JSON.parse(fetchCalls[0].body);
		expect(body.event).toBe("timeout");
	});

	it("uses empty webhooks list without error", async () => {
		const config: AlertConfig = { webhooks: [] };
		await fireAlerts(makeJob(), makeExecution(), config);
		expect(fetchCalls).toHaveLength(0);
	});

	it("retries on fetch failure with default 2 retries", async () => {
		let callCount = 0;
		globalThis.fetch = mock(async () => {
			callCount++;
			throw new Error("Network error");
		}) as unknown as typeof fetch;

		const config: AlertConfig = {
			webhooks: [{ url: "https://example.com/webhook", events: ["failed"] }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		// 1 initial + 2 retries = 3 total
		expect(callCount).toBe(3);
	});

	it("retries on non-OK response", async () => {
		let callCount = 0;
		globalThis.fetch = mock(async () => {
			callCount++;
			return new Response("Server Error", { status: 500 });
		}) as unknown as typeof fetch;

		const config: AlertConfig = {
			webhooks: [{ url: "https://example.com/webhook", events: ["failed"] }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		expect(callCount).toBe(3);
	});

	it("stops retrying after success", async () => {
		let callCount = 0;
		globalThis.fetch = mock(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response("Server Error", { status: 500 });
			}
			fetchCalls.push({ url: "recovered", body: "{}" });
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;

		const config: AlertConfig = {
			webhooks: [{ url: "https://example.com/webhook", events: ["failed"] }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		// Should stop after 2nd attempt (success)
		expect(callCount).toBe(2);
	});

	it("respects custom retryAttempts=0 (no retries)", async () => {
		let callCount = 0;
		globalThis.fetch = mock(async () => {
			callCount++;
			throw new Error("Network error");
		}) as unknown as typeof fetch;

		const config: AlertConfig = {
			webhooks: [{ url: "https://example.com/webhook", events: ["failed"], retryAttempts: 0 }],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		expect(callCount).toBe(1);
	});

	it("respects custom retryAttempts=5", async () => {
		let callCount = 0;
		globalThis.fetch = mock(async () => {
			callCount++;
			throw new Error("Network error");
		}) as unknown as typeof fetch;

		const config: AlertConfig = {
			webhooks: [
				{
					url: "https://example.com/webhook",
					events: ["failed"],
					retryAttempts: 5,
					retryDelayMs: 10,
				},
			],
		};

		await fireAlerts(makeJob(), makeExecution(), config);

		// 1 initial + 5 retries = 6 total
		expect(callCount).toBe(6);
	});
});
