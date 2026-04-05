import { describe, expect, test } from "bun:test";
import { formatEmailBody, formatEmailSubject, getSmtpOptions } from "../src/smtp";

describe("formatEmailSubject", () => {
	test("success", () => {
		const s = formatEmailSubject("success", "backup-db");
		expect(s).toContain("[cronbase]");
		expect(s).toContain("backup-db");
		expect(s).toContain("succeeded");
	});

	test("failed", () => {
		const s = formatEmailSubject("failed", "cleanup-logs");
		expect(s).toContain("[cronbase]");
		expect(s).toContain("cleanup-logs");
		expect(s).toContain("failed");
	});

	test("timeout", () => {
		const s = formatEmailSubject("timeout", "long-job");
		expect(s).toContain("[cronbase]");
		expect(s).toContain("long-job");
		expect(s).toContain("timed out");
	});
});

describe("formatEmailBody", () => {
	const baseExec = {
		exitCode: 1,
		durationMs: 5230,
		startedAt: "2026-03-18T03:00:00.000Z",
		attempt: 0,
		stderrTail: "pg_dump: connection refused",
		stdoutTail: "",
	};

	test("includes job name and schedule", () => {
		const body = formatEmailBody("failed", "backup-db", "0 3 * * *", baseExec);
		expect(body).toContain("backup-db");
		expect(body).toContain("0 3 * * *");
	});

	test("includes exit code and duration", () => {
		const body = formatEmailBody("failed", "backup-db", "0 3 * * *", baseExec);
		expect(body).toContain("5.2s");
		expect(body).toContain("1"); // exit code
	});

	test("includes stderr tail for failures", () => {
		const body = formatEmailBody("failed", "backup-db", "0 3 * * *", baseExec);
		expect(body).toContain("pg_dump: connection refused");
	});

	test("includes stdout tail for success", () => {
		const successExec = { ...baseExec, exitCode: 0, stderrTail: "", stdoutTail: "Backup complete" };
		const body = formatEmailBody("success", "backup-db", "0 3 * * *", successExec);
		expect(body).toContain("Backup complete");
	});

	test("omits stdout for failures", () => {
		const failExec = { ...baseExec, stdoutTail: "some stdout" };
		const body = formatEmailBody("failed", "backup-db", "0 3 * * *", failExec);
		// stdout section only added for success
		expect(body).not.toContain("stdout (last 500 chars):");
	});

	test("handles null exit code (timeout)", () => {
		const timeoutExec = { ...baseExec, exitCode: null, durationMs: null, stderrTail: "" };
		const body = formatEmailBody("timeout", "slow-job", "* * * * *", timeoutExec);
		expect(body).toContain("slow-job");
		expect(body).toContain("—"); // null exit code rendered as em dash
	});

	test("shows attempt number (1-based)", () => {
		const retryExec = { ...baseExec, attempt: 2 };
		const body = formatEmailBody("failed", "job", "* * * * *", retryExec);
		expect(body).toContain("3"); // attempt 2 → display as "3"
	});

	test("includes cronbase footer", () => {
		const body = formatEmailBody("success", "job", "* * * * *", {
			...baseExec,
			exitCode: 0,
			stderrTail: "",
		});
		expect(body).toContain("cronbase");
	});
});

describe("getSmtpOptions", () => {
	test("returns null when CRONBASE_SMTP_HOST not set", () => {
		const saved = process.env.CRONBASE_SMTP_HOST;
		delete process.env.CRONBASE_SMTP_HOST;
		const result = getSmtpOptions();
		expect(result).toBeNull();
		if (saved !== undefined) process.env.CRONBASE_SMTP_HOST = saved;
	});

	test("returns options when CRONBASE_SMTP_HOST is set", () => {
		const saved = process.env.CRONBASE_SMTP_HOST;
		process.env.CRONBASE_SMTP_HOST = "smtp.example.com";
		const result = getSmtpOptions();
		expect(result).not.toBeNull();
		expect(result?.host).toBe("smtp.example.com");
		expect(result?.port).toBe(587); // default port
		expect(result?.secure).toBe(false); // default
		if (saved !== undefined) process.env.CRONBASE_SMTP_HOST = saved;
		else delete process.env.CRONBASE_SMTP_HOST;
	});

	test("respects CRONBASE_SMTP_PORT", () => {
		const savedHost = process.env.CRONBASE_SMTP_HOST;
		const savedPort = process.env.CRONBASE_SMTP_PORT;
		process.env.CRONBASE_SMTP_HOST = "smtp.example.com";
		process.env.CRONBASE_SMTP_PORT = "465";
		const result = getSmtpOptions();
		expect(result?.port).toBe(465);
		if (savedHost !== undefined) process.env.CRONBASE_SMTP_HOST = savedHost;
		else delete process.env.CRONBASE_SMTP_HOST;
		if (savedPort !== undefined) process.env.CRONBASE_SMTP_PORT = savedPort;
		else delete process.env.CRONBASE_SMTP_PORT;
	});

	test("respects CRONBASE_SMTP_SECURE=true", () => {
		const savedHost = process.env.CRONBASE_SMTP_HOST;
		const savedSecure = process.env.CRONBASE_SMTP_SECURE;
		process.env.CRONBASE_SMTP_HOST = "smtp.example.com";
		process.env.CRONBASE_SMTP_SECURE = "true";
		const result = getSmtpOptions();
		expect(result?.secure).toBe(true);
		if (savedHost !== undefined) process.env.CRONBASE_SMTP_HOST = savedHost;
		else delete process.env.CRONBASE_SMTP_HOST;
		if (savedSecure !== undefined) process.env.CRONBASE_SMTP_SECURE = savedSecure;
		else delete process.env.CRONBASE_SMTP_SECURE;
	});

	test("defaults from address to cronbase@localhost", () => {
		const savedHost = process.env.CRONBASE_SMTP_HOST;
		const savedFrom = process.env.CRONBASE_SMTP_FROM;
		process.env.CRONBASE_SMTP_HOST = "smtp.example.com";
		delete process.env.CRONBASE_SMTP_FROM;
		const result = getSmtpOptions();
		expect(result?.from).toBe("cronbase@localhost");
		if (savedHost !== undefined) process.env.CRONBASE_SMTP_HOST = savedHost;
		else delete process.env.CRONBASE_SMTP_HOST;
		if (savedFrom !== undefined) process.env.CRONBASE_SMTP_FROM = savedFrom;
	});

	test("reads username and password", () => {
		const savedHost = process.env.CRONBASE_SMTP_HOST;
		process.env.CRONBASE_SMTP_HOST = "smtp.example.com";
		process.env.CRONBASE_SMTP_USERNAME = "user@example.com";
		process.env.CRONBASE_SMTP_PASSWORD = "secret";
		const result = getSmtpOptions();
		expect(result?.username).toBe("user@example.com");
		expect(result?.password).toBe("secret");
		if (savedHost !== undefined) process.env.CRONBASE_SMTP_HOST = savedHost;
		else delete process.env.CRONBASE_SMTP_HOST;
		delete process.env.CRONBASE_SMTP_USERNAME;
		delete process.env.CRONBASE_SMTP_PASSWORD;
	});
});
