/**
 * Input validation for cronbase.
 *
 * Validates job names, commands, environment variables, and other user input
 * before it reaches the store or executor.
 */

/** Maximum lengths for various fields. */
export const LIMITS = {
	/** Maximum job name length */
	JOB_NAME_MAX: 200,
	/** Maximum command length */
	COMMAND_MAX: 65_536, // 64 KiB
	/** Maximum description length */
	DESCRIPTION_MAX: 1000,
	/** Maximum CWD path length */
	CWD_MAX: 4096,
	/** Maximum number of environment variables */
	ENV_MAX_KEYS: 100,
	/** Maximum environment variable key length */
	ENV_KEY_MAX: 256,
	/** Maximum environment variable value length */
	ENV_VALUE_MAX: 32_768,
	/** Maximum number of tags */
	TAGS_MAX: 20,
	/** Maximum tag length */
	TAG_MAX: 100,
	/** Maximum number of webhooks per job */
	WEBHOOKS_MAX: 10,
	/** Maximum webhook URL length */
	WEBHOOK_URL_MAX: 2048,
	/** Maximum timeout in seconds (24 hours) */
	TIMEOUT_MAX: 86_400,
	/** Maximum schedule expression length */
	SCHEDULE_MAX: 500,
} as const;

/** Valid job name pattern: alphanumeric, hyphens, underscores, dots. */
const JOB_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Reserved environment variable names that should not be overridden.
 * Only USER and SHELL are blocked — overriding these can cause confusing
 * behavior in subprocesses (e.g. sudo, id, tty handling).
 * PATH, HOME, LANG, LC_ALL are intentionally allowed because standard
 * crontab(5) supports overriding them and they are commonly used.
 */
const RESERVED_ENV_VARS = new Set(["USER", "SHELL"]);

export interface ValidationError {
	field: string;
	message: string;
}

/**
 * Validate a job name.
 */
export function validateJobName(name: unknown): ValidationError | null {
	if (typeof name !== "string" || name.trim().length === 0) {
		return { field: "name", message: "Job name is required" };
	}
	if (name.length > LIMITS.JOB_NAME_MAX) {
		return { field: "name", message: `Job name must be at most ${LIMITS.JOB_NAME_MAX} characters` };
	}
	if (!JOB_NAME_PATTERN.test(name)) {
		return {
			field: "name",
			message:
				"Job name must start with a letter or number and contain only letters, numbers, hyphens, underscores, and dots",
		};
	}
	return null;
}

/**
 * Validate a command string.
 */
export function validateCommand(command: unknown): ValidationError | null {
	if (typeof command !== "string" || command.trim().length === 0) {
		return { field: "command", message: "Command is required" };
	}
	if (command.length > LIMITS.COMMAND_MAX) {
		return {
			field: "command",
			message: `Command must be at most ${LIMITS.COMMAND_MAX} characters`,
		};
	}
	return null;
}

/**
 * Validate environment variables.
 */
export function validateEnv(env: unknown): ValidationError | null {
	if (env === undefined || env === null) return null;
	if (typeof env !== "object" || Array.isArray(env)) {
		return { field: "env", message: "Environment variables must be an object" };
	}
	const entries = Object.entries(env as Record<string, unknown>);
	if (entries.length > LIMITS.ENV_MAX_KEYS) {
		return {
			field: "env",
			message: `At most ${LIMITS.ENV_MAX_KEYS} environment variables allowed`,
		};
	}
	for (const [key, value] of entries) {
		if (key.length === 0) {
			return { field: "env", message: "Environment variable key cannot be empty" };
		}
		if (key.length > LIMITS.ENV_KEY_MAX) {
			return {
				field: "env",
				message: `Environment variable key "${key}" exceeds ${LIMITS.ENV_KEY_MAX} characters`,
			};
		}
		if (RESERVED_ENV_VARS.has(key)) {
			return { field: "env", message: `Cannot override reserved environment variable "${key}"` };
		}
		if (typeof value !== "string") {
			return { field: "env", message: `Environment variable "${key}" must be a string` };
		}
		if (value.length > LIMITS.ENV_VALUE_MAX) {
			return {
				field: "env",
				message: `Environment variable "${key}" value exceeds ${LIMITS.ENV_VALUE_MAX} characters`,
			};
		}
	}
	return null;
}

/**
 * Validate a description string.
 */
export function validateDescription(description: unknown): ValidationError | null {
	if (description === undefined || description === null || description === "") return null;
	if (typeof description !== "string") {
		return { field: "description", message: "Description must be a string" };
	}
	if (description.length > LIMITS.DESCRIPTION_MAX) {
		return {
			field: "description",
			message: `Description must be at most ${LIMITS.DESCRIPTION_MAX} characters`,
		};
	}
	return null;
}

/**
 * Validate tags array.
 */
export function validateTags(tags: unknown): ValidationError | null {
	if (tags === undefined || tags === null) return null;
	if (!Array.isArray(tags)) {
		return { field: "tags", message: "Tags must be an array" };
	}
	if (tags.length > LIMITS.TAGS_MAX) {
		return { field: "tags", message: `At most ${LIMITS.TAGS_MAX} tags allowed` };
	}
	for (const tag of tags) {
		if (typeof tag !== "string" || tag.trim().length === 0) {
			return { field: "tags", message: "Each tag must be a non-empty string" };
		}
		if (tag.length > LIMITS.TAG_MAX) {
			return { field: "tags", message: `Tag "${tag}" exceeds ${LIMITS.TAG_MAX} characters` };
		}
	}
	return null;
}

/** Hostnames that resolve to loopback/link-local — block to prevent SSRF. */
const BLOCKED_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"0.0.0.0",
	"::1",
	"[::1]",
	"0177.0.0.1",
	"2130706433", // 127.0.0.1 as decimal
]);

/** IP ranges that are private/reserved — block to prevent SSRF. */
function isPrivateIp(hostname: string): boolean {
	// Strip IPv6 brackets
	const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
	// IPv4 private ranges
	if (/^10\./.test(h)) return true;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
	if (/^192\.168\./.test(h)) return true;
	// Link-local
	if (/^169\.254\./.test(h)) return true;
	// Loopback range
	if (/^127\./.test(h)) return true;
	// IPv6 private/link-local
	if (/^fe80:/i.test(h)) return true;
	// RFC 4193 unique local addresses: fc00::/7 covers fc00::-fdff::
	if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;
	// Cloud metadata
	if (h === "169.254.169.254") return true;
	return false;
}

/**
 * Validate a webhook URL.
 */
export function validateWebhookUrl(url: unknown): ValidationError | null {
	if (typeof url !== "string" || url.trim().length === 0) {
		return { field: "webhooks", message: "Webhook URL is required" };
	}
	if (url.length > LIMITS.WEBHOOK_URL_MAX) {
		return {
			field: "webhooks",
			message: `Webhook URL must be at most ${LIMITS.WEBHOOK_URL_MAX} characters`,
		};
	}
	try {
		const parsed = new URL(url);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return { field: "webhooks", message: "Webhook URL must use http or https" };
		}
		// SSRF protection: block private/loopback/link-local addresses
		const host = parsed.hostname.toLowerCase();
		if (BLOCKED_HOSTS.has(host) || isPrivateIp(host)) {
			return {
				field: "webhooks",
				message: "Webhook URL must not point to a private or loopback address",
			};
		}
	} catch {
		return { field: "webhooks", message: "Invalid webhook URL" };
	}
	return null;
}

/**
 * Validate an IANA timezone string (e.g. "America/New_York").
 * Null/undefined are allowed — they mean "use UTC".
 */
export function validateTimezone(timezone: unknown): ValidationError | null {
	if (timezone === undefined || timezone === null || timezone === "") return null;
	if (typeof timezone !== "string") {
		return { field: "timezone", message: "Timezone must be a string" };
	}
	try {
		Intl.DateTimeFormat("en-US", { timeZone: timezone });
	} catch {
		return {
			field: "timezone",
			message: `Invalid timezone: "${timezone}". Use an IANA timezone name (e.g. America/New_York, Europe/London, UTC)`,
		};
	}
	return null;
}

/**
 * Validate a working directory path.
 */
export function validateCwd(cwd: unknown): ValidationError | null {
	if (cwd === undefined || cwd === null || cwd === "" || cwd === ".") return null;
	if (typeof cwd !== "string") {
		return { field: "cwd", message: "Working directory must be a string" };
	}
	if (cwd.length > LIMITS.CWD_MAX) {
		return {
			field: "cwd",
			message: `Working directory must be at most ${LIMITS.CWD_MAX} characters`,
		};
	}
	return null;
}

/**
 * Validate a timeout value (seconds).
 */
export function validateTimeout(timeout: unknown): ValidationError | null {
	if (timeout === undefined || timeout === null || timeout === 0) return null;
	if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) {
		return { field: "timeout", message: "Timeout must be a non-negative number" };
	}
	if (!Number.isInteger(timeout)) {
		return { field: "timeout", message: "Timeout must be a whole number of seconds" };
	}
	if (timeout > LIMITS.TIMEOUT_MAX) {
		return {
			field: "timeout",
			message: `Timeout must be at most ${LIMITS.TIMEOUT_MAX} seconds (24 hours)`,
		};
	}
	return null;
}

/**
 * Validate a cron schedule expression.
 * Requires parseCron to be passed in to avoid circular dependency.
 */
export function validateSchedule(
	schedule: unknown,
	parseCron?: (expr: string) => unknown,
): ValidationError | null {
	if (typeof schedule !== "string" || schedule.trim().length === 0) {
		return { field: "schedule", message: "Schedule is required" };
	}
	if (schedule.length > LIMITS.SCHEDULE_MAX) {
		return {
			field: "schedule",
			message: `Schedule must be at most ${LIMITS.SCHEDULE_MAX} characters`,
		};
	}
	if (parseCron) {
		try {
			parseCron(schedule);
		} catch (e) {
			return { field: "schedule", message: `Invalid schedule: ${(e as Error).message}` };
		}
	}
	return null;
}

/** Maximum allowed retry base delay in seconds. */
const MAX_RETRY_BASE_DELAY = 3600;

/**
 * Validate retry configuration.
 */
export function validateRetryConfig(retry: unknown): ValidationError | null {
	if (retry === undefined || retry === null) return null;
	if (typeof retry !== "object" || Array.isArray(retry)) {
		return { field: "retry", message: "Retry config must be an object" };
	}
	const r = retry as Record<string, unknown>;
	if (r.maxAttempts !== undefined) {
		if (
			typeof r.maxAttempts !== "number" ||
			!Number.isInteger(r.maxAttempts) ||
			r.maxAttempts < 0 ||
			r.maxAttempts > 100
		) {
			return { field: "retry", message: "maxAttempts must be an integer between 0 and 100" };
		}
	}
	if (r.baseDelay !== undefined) {
		if (
			typeof r.baseDelay !== "number" ||
			!Number.isInteger(r.baseDelay) ||
			r.baseDelay < 1 ||
			r.baseDelay > MAX_RETRY_BASE_DELAY
		) {
			return {
				field: "retry",
				message: `baseDelay must be an integer between 1 and ${MAX_RETRY_BASE_DELAY} seconds`,
			};
		}
	}
	return null;
}

/**
 * Validate a full job configuration. Returns first error found, or null if valid.
 */
export function validateJobConfig(config: Record<string, unknown>): ValidationError | null {
	return (
		validateJobName(config.name) ??
		validateCommand(config.command) ??
		validateDescription(config.description) ??
		validateTimeout(config.timeout) ??
		validateCwd(config.cwd) ??
		validateEnv(config.env) ??
		validateTags(config.tags) ??
		validateRetryConfig(config.retry) ??
		validateTimezone(config.timezone) ??
		null
	);
}
