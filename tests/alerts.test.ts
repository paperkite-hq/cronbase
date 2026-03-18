import { describe, expect, test } from "bun:test";
import type { AlertPayload } from "../src/alerts";
import { formatDiscord, formatSlack } from "../src/alerts";

const makePayload = (event: AlertPayload["event"]): AlertPayload => ({
	event,
	job: {
		id: 1,
		name: "backup-db",
		schedule: "0 2 * * *",
		command: "pg_dump mydb > /backups/db.sql",
	},
	execution: {
		id: 42,
		status: event === "success" ? "success" : event === "timeout" ? "timeout" : "failed",
		exitCode: event === "success" ? 0 : 1,
		durationMs: 15230,
		startedAt: "2026-03-18T02:00:00.000Z",
		finishedAt: "2026-03-18T02:00:15.230Z",
		stdoutTail: "Dumping table users...",
		stderrTail: event !== "success" ? "ERROR: connection refused" : "",
		attempt: 0,
	},
	timestamp: "2026-03-18T02:00:15.230Z",
});

describe("formatSlack", () => {
	test("formats success payload", () => {
		const result = formatSlack(makePayload("success")) as Record<string, unknown>;
		expect(result.attachments).toBeDefined();
		const attachments = result.attachments as Array<Record<string, unknown>>;
		expect(attachments[0].color).toBe("#22c55e");
		const blocks = attachments[0].blocks as Array<Record<string, unknown>>;
		expect(blocks[0].type).toBe("section");
		const text = blocks[0].text as Record<string, string>;
		expect(text.text).toContain("backup-db");
		expect(text.text).toContain("success");
	});

	test("formats failure payload with stderr", () => {
		const result = formatSlack(makePayload("failed")) as Record<string, unknown>;
		const attachments = result.attachments as Array<Record<string, unknown>>;
		expect(attachments[0].color).toBe("#ef4444");
		const blocks = attachments[0].blocks as Array<Record<string, unknown>>;
		// Should have an stderr block
		const stderrBlock = blocks.find((b) => {
			const t = b.text as Record<string, string> | undefined;
			return t?.text?.includes("stderr");
		});
		expect(stderrBlock).toBeTruthy();
	});

	test("includes job metadata in fields", () => {
		const result = formatSlack(makePayload("success")) as Record<string, unknown>;
		const attachments = result.attachments as Array<Record<string, unknown>>;
		const blocks = attachments[0].blocks as Array<Record<string, unknown>>;
		const fieldsBlock = blocks.find((b) => b.fields);
		expect(fieldsBlock).toBeTruthy();
		const fields = fieldsBlock?.fields as Array<Record<string, string>>;
		const scheduleField = fields.find((f) => f.text.includes("Schedule"));
		expect(scheduleField?.text).toContain("0 2 * * *");
	});
});

describe("formatDiscord", () => {
	test("formats success payload", () => {
		const result = formatDiscord(makePayload("success")) as Record<string, unknown>;
		expect(result.embeds).toBeDefined();
		const embeds = result.embeds as Array<Record<string, unknown>>;
		expect(embeds[0].color).toBe(0x22c55e);
		expect(embeds[0].title).toContain("backup-db");
		expect(embeds[0].title).toContain("success");
	});

	test("formats failure payload", () => {
		const result = formatDiscord(makePayload("failed")) as Record<string, unknown>;
		const embeds = result.embeds as Array<Record<string, unknown>>;
		expect(embeds[0].color).toBe(0xef4444);
		const fields = embeds[0].fields as Array<Record<string, unknown>>;
		const stderrField = fields.find((f) => f.name === "stderr");
		expect(stderrField).toBeTruthy();
	});

	test("includes timestamp and footer", () => {
		const result = formatDiscord(makePayload("success")) as Record<string, unknown>;
		const embeds = result.embeds as Array<Record<string, unknown>>;
		expect(embeds[0].timestamp).toBeDefined();
		const footer = embeds[0].footer as Record<string, string>;
		expect(footer.text).toBe("cronbase");
	});

	test("includes schedule field", () => {
		const result = formatDiscord(makePayload("success")) as Record<string, unknown>;
		const embeds = result.embeds as Array<Record<string, unknown>>;
		const fields = embeds[0].fields as Array<Record<string, unknown>>;
		const scheduleField = fields.find((f) => f.name === "Schedule");
		expect(scheduleField?.value).toContain("0 2 * * *");
	});
});

describe("Markdown injection prevention", () => {
	const makeInjectionPayload = (): AlertPayload => ({
		event: "failed",
		job: {
			id: 1,
			name: "<https://evil.com|Click here> *bold*",
			schedule: "* * * * *",
			command: "echo hi",
		},
		execution: {
			id: 1,
			status: "failed",
			exitCode: 1,
			durationMs: 100,
			startedAt: "2026-03-18T00:00:00Z",
			finishedAt: "2026-03-18T00:00:00Z",
			stdoutTail: "",
			stderrTail: "``` @everyone pwned",
			attempt: 0,
		},
		timestamp: "2026-03-18T00:00:00Z",
	});

	test("Slack format escapes angle brackets in job name", () => {
		const result = formatSlack(makeInjectionPayload()) as Record<string, unknown>;
		const attachments = result.attachments as Array<Record<string, unknown>>;
		const blocks = attachments[0].blocks as Array<Record<string, unknown>>;
		const text = (blocks[0].text as Record<string, string>).text;
		// Should NOT contain raw angle brackets (Slack link injection)
		expect(text).not.toContain("<https://evil.com");
		expect(text).toContain("&lt;");
	});

	test("Discord format escapes backticks in stderr", () => {
		const result = formatDiscord(makeInjectionPayload()) as Record<string, unknown>;
		const embeds = result.embeds as Array<Record<string, unknown>>;
		const fields = embeds[0].fields as Array<Record<string, unknown>>;
		const stderrField = fields.find((f) => f.name === "stderr");
		// Should NOT contain raw backticks that could break out of code block
		expect(stderrField?.value).not.toContain("``` @everyone");
	});

	test("Discord format prevents @everyone mentions in stderr", () => {
		const result = formatDiscord(makeInjectionPayload()) as Record<string, unknown>;
		const embeds = result.embeds as Array<Record<string, unknown>>;
		const fields = embeds[0].fields as Array<Record<string, unknown>>;
		const stderrField = fields.find((f) => f.name === "stderr");
		// Zero-width space should break the @everyone mention
		expect(stderrField?.value).not.toMatch(/@everyone(?!\u200B)/);
	});
});
