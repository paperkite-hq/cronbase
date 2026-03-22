/**
 * Tests for input validation module.
 */

import { describe, expect, test } from "bun:test";
import {
	LIMITS,
	validateCommand,
	validateCwd,
	validateDescription,
	validateEnv,
	validateJobConfig,
	validateJobName,
	validateRetryConfig,
	validateSchedule,
	validateTags,
	validateTimeout,
	validateWebhookUrl,
} from "../src/validation";

describe("validateJobName", () => {
	test("accepts valid names", () => {
		expect(validateJobName("backup")).toBeNull();
		expect(validateJobName("my-job")).toBeNull();
		expect(validateJobName("job_123")).toBeNull();
		expect(validateJobName("a.b.c")).toBeNull();
		expect(validateJobName("A")).toBeNull();
		expect(validateJobName("9-lives")).toBeNull();
	});

	test("rejects empty name", () => {
		expect(validateJobName("")).not.toBeNull();
		expect(validateJobName("  ")).not.toBeNull();
		expect(validateJobName(null)).not.toBeNull();
		expect(validateJobName(undefined)).not.toBeNull();
	});

	test("rejects names starting with special chars", () => {
		expect(validateJobName("-bad")).not.toBeNull();
		expect(validateJobName("_bad")).not.toBeNull();
		expect(validateJobName(".bad")).not.toBeNull();
	});

	test("rejects names with invalid characters", () => {
		expect(validateJobName("my job")).not.toBeNull();
		expect(validateJobName("my/job")).not.toBeNull();
		expect(validateJobName("my;job")).not.toBeNull();
		expect(validateJobName("my$job")).not.toBeNull();
	});

	test("rejects names exceeding max length", () => {
		const longName = "a".repeat(LIMITS.JOB_NAME_MAX + 1);
		expect(validateJobName(longName)).not.toBeNull();
	});

	test("accepts name at max length", () => {
		const maxName = "a".repeat(LIMITS.JOB_NAME_MAX);
		expect(validateJobName(maxName)).toBeNull();
	});
});

describe("validateCommand", () => {
	test("accepts valid commands", () => {
		expect(validateCommand("echo hello")).toBeNull();
		expect(validateCommand("pg_dump mydb > /backups/db.sql")).toBeNull();
	});

	test("rejects empty command", () => {
		expect(validateCommand("")).not.toBeNull();
		expect(validateCommand("  ")).not.toBeNull();
		expect(validateCommand(null)).not.toBeNull();
	});

	test("rejects oversized commands", () => {
		const bigCommand = "x".repeat(LIMITS.COMMAND_MAX + 1);
		expect(validateCommand(bigCommand)).not.toBeNull();
	});
});

describe("validateEnv", () => {
	test("accepts valid env", () => {
		expect(validateEnv({ MY_VAR: "value" })).toBeNull();
		expect(validateEnv({})).toBeNull();
		expect(validateEnv(null)).toBeNull();
		expect(validateEnv(undefined)).toBeNull();
	});

	test("rejects non-object env", () => {
		expect(validateEnv("string")).not.toBeNull();
		expect(validateEnv([])).not.toBeNull();
	});

	test("rejects reserved env vars (USER, SHELL)", () => {
		expect(validateEnv({ USER: "nobody" })).not.toBeNull();
		expect(validateEnv({ SHELL: "/bin/zsh" })).not.toBeNull();
	});

	test("allows crontab-standard env overrides (PATH, HOME, LANG, LC_ALL)", () => {
		expect(validateEnv({ PATH: "/usr/local/bin:/usr/bin" })).toBeNull();
		expect(validateEnv({ HOME: "/opt/app" })).toBeNull();
		expect(validateEnv({ LANG: "en_US.UTF-8" })).toBeNull();
		expect(validateEnv({ LC_ALL: "C" })).toBeNull();
	});

	test("rejects non-string values", () => {
		expect(validateEnv({ MY_VAR: 123 })).not.toBeNull();
	});

	test("rejects too many keys", () => {
		const bigEnv: Record<string, string> = {};
		for (let i = 0; i < LIMITS.ENV_MAX_KEYS + 1; i++) {
			bigEnv[`VAR_${i}`] = "val";
		}
		expect(validateEnv(bigEnv)).not.toBeNull();
	});

	test("rejects empty-string key", () => {
		const err = validateEnv({ "": "value" });
		expect(err).not.toBeNull();
		expect(err?.message).toContain("cannot be empty");
	});
});

describe("validateDescription", () => {
	test("accepts valid descriptions", () => {
		expect(validateDescription("Daily backup")).toBeNull();
		expect(validateDescription("")).toBeNull();
		expect(validateDescription(null)).toBeNull();
	});

	test("rejects oversized descriptions", () => {
		const big = "x".repeat(LIMITS.DESCRIPTION_MAX + 1);
		expect(validateDescription(big)).not.toBeNull();
	});
});

describe("validateTags", () => {
	test("accepts valid tags", () => {
		expect(validateTags(["backup", "daily"])).toBeNull();
		expect(validateTags([])).toBeNull();
		expect(validateTags(null)).toBeNull();
	});

	test("rejects too many tags", () => {
		const tags = Array.from({ length: LIMITS.TAGS_MAX + 1 }, (_, i) => `tag-${i}`);
		expect(validateTags(tags)).not.toBeNull();
	});

	test("rejects empty string tags", () => {
		expect(validateTags(["good", ""])).not.toBeNull();
	});
});

describe("validateWebhookUrl", () => {
	test("accepts valid http/https URLs", () => {
		expect(validateWebhookUrl("https://hooks.slack.com/services/xxx")).toBeNull();
		expect(validateWebhookUrl("https://example.com/webhook")).toBeNull();
	});

	test("rejects non-http protocols", () => {
		expect(validateWebhookUrl("ftp://example.com")).not.toBeNull();
		expect(validateWebhookUrl("file:///etc/passwd")).not.toBeNull();
	});

	test("rejects invalid URLs", () => {
		expect(validateWebhookUrl("not-a-url")).not.toBeNull();
		expect(validateWebhookUrl("")).not.toBeNull();
	});

	test("rejects oversized URLs", () => {
		const longUrl = `https://example.com/${"a".repeat(LIMITS.WEBHOOK_URL_MAX)}`;
		expect(validateWebhookUrl(longUrl)).not.toBeNull();
	});

	test("rejects private/loopback addresses (SSRF protection)", () => {
		// Loopback
		expect(validateWebhookUrl("http://localhost:8080/webhook")).not.toBeNull();
		expect(validateWebhookUrl("http://127.0.0.1/hook")).not.toBeNull();
		expect(validateWebhookUrl("http://[::1]/hook")).not.toBeNull();
		expect(validateWebhookUrl("http://0.0.0.0/hook")).not.toBeNull();

		// Private IPv4 ranges
		expect(validateWebhookUrl("http://10.0.0.1/hook")).not.toBeNull();
		expect(validateWebhookUrl("http://172.16.0.1/hook")).not.toBeNull();
		expect(validateWebhookUrl("http://192.168.1.1/hook")).not.toBeNull();

		// Cloud metadata endpoint
		expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data/")).not.toBeNull();

		// Link-local
		expect(validateWebhookUrl("http://169.254.0.1/hook")).not.toBeNull();

		// IPv6 unique local addresses (fc00::/7)
		expect(validateWebhookUrl("http://[fc00::1]/hook")).not.toBeNull();
		expect(validateWebhookUrl("http://[fc12::1]/hook")).not.toBeNull();
		expect(validateWebhookUrl("http://[fd00::1]/hook")).not.toBeNull();
		expect(validateWebhookUrl("http://[fdab::1]/hook")).not.toBeNull();

		// IPv6 link-local
		expect(validateWebhookUrl("http://[fe80::1]/hook")).not.toBeNull();
	});

	test("accepts public IP addresses", () => {
		expect(validateWebhookUrl("https://8.8.8.8/hook")).toBeNull();
		expect(validateWebhookUrl("https://203.0.113.1/hook")).toBeNull();
	});
});

describe("validateCwd", () => {
	test("accepts valid cwd values", () => {
		expect(validateCwd(".")).toBeNull();
		expect(validateCwd("")).toBeNull();
		expect(validateCwd(null)).toBeNull();
		expect(validateCwd(undefined)).toBeNull();
		expect(validateCwd("/home/user/project")).toBeNull();
	});

	test("rejects non-string cwd", () => {
		expect(validateCwd(123)).not.toBeNull();
		expect(validateCwd(true)).not.toBeNull();
	});

	test("rejects oversized cwd", () => {
		const longPath = "/".repeat(LIMITS.CWD_MAX + 1);
		expect(validateCwd(longPath)).not.toBeNull();
	});
});

describe("validateRetryConfig", () => {
	test("accepts valid retry configs", () => {
		expect(validateRetryConfig({ maxAttempts: 3, baseDelay: 30 })).toBeNull();
		expect(validateRetryConfig({ maxAttempts: 0 })).toBeNull();
		expect(validateRetryConfig(null)).toBeNull();
		expect(validateRetryConfig(undefined)).toBeNull();
	});

	test("rejects non-object retry", () => {
		expect(validateRetryConfig("string")).not.toBeNull();
		expect(validateRetryConfig([])).not.toBeNull();
	});

	test("rejects out-of-range maxAttempts", () => {
		expect(validateRetryConfig({ maxAttempts: -1 })).not.toBeNull();
		expect(validateRetryConfig({ maxAttempts: 101 })).not.toBeNull();
	});

	test("rejects fractional maxAttempts", () => {
		const err = validateRetryConfig({ maxAttempts: 2.5 });
		expect(err).not.toBeNull();
		expect(err?.message).toContain("integer");
	});

	test("rejects out-of-range baseDelay", () => {
		expect(validateRetryConfig({ baseDelay: 0 })).not.toBeNull();
		expect(validateRetryConfig({ baseDelay: 3601 })).not.toBeNull();
	});

	test("rejects fractional baseDelay", () => {
		const err = validateRetryConfig({ baseDelay: 1.5 });
		expect(err).not.toBeNull();
		expect(err?.message).toContain("integer");
	});
});

describe("validateJobConfig", () => {
	test("validates complete valid config", () => {
		expect(validateJobConfig({ name: "backup", command: "echo hi" })).toBeNull();
	});

	test("returns first error for invalid config", () => {
		const err = validateJobConfig({ name: "", command: "echo hi" });
		expect(err).not.toBeNull();
		expect(err?.field).toBe("name");
	});

	test("catches invalid env in full config", () => {
		const err = validateJobConfig({
			name: "backup",
			command: "echo hi",
			env: { USER: "nobody" },
		});
		expect(err).not.toBeNull();
		expect(err?.field).toBe("env");
	});

	test("catches invalid cwd in full config", () => {
		const err = validateJobConfig({
			name: "backup",
			command: "echo hi",
			cwd: 123,
		});
		expect(err).not.toBeNull();
		expect(err?.field).toBe("cwd");
	});

	test("catches invalid retry config in full config", () => {
		const err = validateJobConfig({
			name: "backup",
			command: "echo hi",
			retry: { baseDelay: 99999 },
		});
		expect(err).not.toBeNull();
		expect(err?.field).toBe("retry");
	});

	test("catches invalid timeout in full config", () => {
		const err = validateJobConfig({
			name: "backup",
			command: "echo hi",
			timeout: -5,
		});
		expect(err).not.toBeNull();
		expect(err?.field).toBe("timeout");
	});
});

describe("validateTimeout", () => {
	test("accepts valid timeouts", () => {
		expect(validateTimeout(0)).toBeNull();
		expect(validateTimeout(60)).toBeNull();
		expect(validateTimeout(3600)).toBeNull();
		expect(validateTimeout(LIMITS.TIMEOUT_MAX)).toBeNull();
		expect(validateTimeout(null)).toBeNull();
		expect(validateTimeout(undefined)).toBeNull();
	});

	test("rejects negative timeout", () => {
		expect(validateTimeout(-1)).not.toBeNull();
		expect(validateTimeout(-100)).not.toBeNull();
	});

	test("rejects non-number timeout", () => {
		expect(validateTimeout("60")).not.toBeNull();
		expect(validateTimeout(true)).not.toBeNull();
	});

	test("rejects timeout exceeding max", () => {
		expect(validateTimeout(LIMITS.TIMEOUT_MAX + 1)).not.toBeNull();
	});

	test("rejects non-finite timeout", () => {
		expect(validateTimeout(Number.POSITIVE_INFINITY)).not.toBeNull();
		expect(validateTimeout(Number.NaN)).not.toBeNull();
	});

	test("rejects fractional timeout", () => {
		const err = validateTimeout(1.5);
		expect(err).not.toBeNull();
		expect(err?.message).toContain("whole number");
	});
});

describe("validateSchedule", () => {
	test("accepts valid schedule without parser", () => {
		expect(validateSchedule("*/5 * * * *")).toBeNull();
		expect(validateSchedule("@daily")).toBeNull();
	});

	test("rejects empty schedule", () => {
		expect(validateSchedule("")).not.toBeNull();
		expect(validateSchedule("  ")).not.toBeNull();
		expect(validateSchedule(null)).not.toBeNull();
		expect(validateSchedule(undefined)).not.toBeNull();
	});

	test("rejects non-string schedule", () => {
		expect(validateSchedule(123)).not.toBeNull();
	});

	test("rejects oversized schedule", () => {
		const long = "* ".repeat(LIMITS.SCHEDULE_MAX);
		expect(validateSchedule(long)).not.toBeNull();
	});

	test("validates with parseCron when provided", () => {
		const mockParse = (expr: string) => {
			if (expr === "bad") throw new Error("Invalid expression");
		};
		expect(validateSchedule("*/5 * * * *", mockParse)).toBeNull();
		const err = validateSchedule("bad", mockParse);
		expect(err).not.toBeNull();
		expect(err?.message).toContain("Invalid schedule");
	});
});
