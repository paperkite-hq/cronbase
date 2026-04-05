import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { fireEmailAlerts } from "../src/alerts";
import * as smtp from "../src/smtp";
import type { AlertConfig, Execution, Job } from "../src/types";

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
		timezone: null,
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

describe("fireEmailAlerts", () => {
	let sendEmailCalls: Array<{ to: string[]; subject: string; body: string }>;
	let getSmtpOptionsSpy: ReturnType<typeof spyOn>;
	let sendEmailSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		sendEmailCalls = [];
		// Stub getSmtpOptions to return a valid config
		getSmtpOptionsSpy = spyOn(smtp, "getSmtpOptions").mockReturnValue({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			from: "cronbase@example.com",
		});
		// Stub sendEmail to record calls without opening a TCP connection
		sendEmailSpy = spyOn(smtp, "sendEmail").mockImplementation(async (_opts, to, subject, body) => {
			sendEmailCalls.push({ to: [...to], subject, body });
		});
	});

	afterEach(() => {
		getSmtpOptionsSpy.mockRestore();
		sendEmailSpy.mockRestore();
	});

	it("sends email for matching failure event", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["ops@example.com"], events: ["failed", "timeout"] }],
		};

		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(1);
		expect(sendEmailCalls[0].to).toEqual(["ops@example.com"]);
		expect(sendEmailCalls[0].subject).toContain("backup-db");
		expect(sendEmailCalls[0].subject).toContain("failed");
	});

	it("skips email when event does not match", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["ops@example.com"], events: ["success"] }],
		};

		// Execution is failed, email only configured for success
		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(0);
	});

	it("sends to multiple recipients", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["alice@example.com", "bob@example.com"], events: ["failed"] }],
		};

		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(1);
		expect(sendEmailCalls[0].to).toEqual(["alice@example.com", "bob@example.com"]);
	});

	it("sends to multiple email configs independently", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [
				{ to: ["oncall@example.com"], events: ["failed", "timeout"] },
				{ to: ["logs@example.com"], events: ["failed", "success"] },
			],
		};

		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(2);
	});

	it("sends for success event", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["ops@example.com"], events: ["success"] }],
		};

		const successExec = makeExecution({ status: "success", exitCode: 0, stderr: "" });
		await fireEmailAlerts(makeJob({ lastStatus: "success" }), successExec, config);

		expect(sendEmailCalls).toHaveLength(1);
		expect(sendEmailCalls[0].subject).toContain("succeeded");
	});

	it("sends for timeout event", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["ops@example.com"], events: ["timeout"] }],
		};

		const timeoutExec = makeExecution({ status: "timeout", exitCode: null });
		await fireEmailAlerts(makeJob({ lastStatus: "timeout" }), timeoutExec, config);

		expect(sendEmailCalls).toHaveLength(1);
		expect(sendEmailCalls[0].subject).toContain("timed out");
	});

	it("does nothing when emails array is empty", async () => {
		const config: AlertConfig = { webhooks: [], emails: [] };

		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(0);
	});

	it("does nothing when emails field is absent", async () => {
		const config: AlertConfig = { webhooks: [] };

		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(0);
	});

	it("logs warning and skips when SMTP not configured", async () => {
		getSmtpOptionsSpy.mockReturnValue(null);

		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["ops@example.com"], events: ["failed"] }],
		};

		// Should not throw
		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(0);
	});

	it("handles sendEmail errors gracefully without throwing", async () => {
		sendEmailSpy.mockImplementation(async () => {
			throw new Error("Connection refused");
		});

		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["ops@example.com"], events: ["failed"] }],
		};

		// Should not throw
		await fireEmailAlerts(makeJob(), makeExecution(), config);
	});

	it("includes stderr tail in email body", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: ["ops@example.com"], events: ["failed"] }],
		};

		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls[0].body).toContain("pg_dump: connection refused");
	});

	it("skips email config with empty to array", async () => {
		const config: AlertConfig = {
			webhooks: [],
			emails: [{ to: [], events: ["failed"] }],
		};

		await fireEmailAlerts(makeJob(), makeExecution(), config);

		expect(sendEmailCalls).toHaveLength(0);
	});
});
