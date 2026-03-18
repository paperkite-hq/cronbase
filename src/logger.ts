/**
 * Structured logger for cronbase.
 *
 * Log level is controlled by the `CRONBASE_LOG_LEVEL` environment variable
 * (default: `"info"`). Valid levels from least to most verbose:
 *
 *   `error` < `warn` < `info` < `debug` < `silent` (disables all output)
 *
 * Set `CRONBASE_LOG_FORMAT=json` for machine-readable JSON output, suitable
 * for log aggregation tools (Datadog, Loki, CloudWatch, etc.).
 *
 * @example
 * ```bash
 * # Suppress routine INFO output in production
 * CRONBASE_LOG_LEVEL=warn cronbase start
 *
 * # Enable debug tracing for troubleshooting
 * CRONBASE_LOG_LEVEL=debug cronbase start
 *
 * # JSON output for log aggregation
 * CRONBASE_LOG_FORMAT=json cronbase start | your-log-collector
 * ```
 */

/** Log severity levels (from least to most verbose). */
export type LogLevel = "error" | "warn" | "info" | "debug" | "silent";

/** Numeric weight for each level — lower = more severe. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	silent: 4,
};

function parseLevel(raw: string | undefined): LogLevel {
	const normalized = raw?.toLowerCase().trim();
	if (normalized && normalized in LEVEL_WEIGHT) return normalized as LogLevel;
	return "info";
}

let activeLevel: LogLevel = parseLevel(process.env.CRONBASE_LOG_LEVEL);
let jsonFormat: boolean = process.env.CRONBASE_LOG_FORMAT?.toLowerCase() === "json";

/** Override the active log level programmatically. */
export function setLogLevel(level: LogLevel): void {
	activeLevel = level;
}

/** Returns the currently active log level. */
export function getLogLevel(): LogLevel {
	return activeLevel;
}

/** Override the output format programmatically. Set `true` for JSON. */
export function setJsonFormat(enabled: boolean): void {
	jsonFormat = enabled;
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
	if (activeLevel === "silent") return false;
	return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[activeLevel];
}

type ConsoleMeta = Record<string, unknown>;

function emit(level: Exclude<LogLevel, "silent">, message: string, meta?: ConsoleMeta): void {
	if (!shouldLog(level)) return;

	if (jsonFormat) {
		const entry: Record<string, unknown> = {
			time: new Date().toISOString(),
			level,
			msg: message,
		};
		if (meta) Object.assign(entry, meta);
		const line = JSON.stringify(entry);
		if (level === "error") {
			console.error(line);
		} else if (level === "warn") {
			console.warn(line);
		} else {
			console.log(line);
		}
	} else {
		const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
		const line = `[cronbase] ${message}${metaStr}`;
		if (level === "error") {
			console.error(line);
		} else if (level === "warn") {
			console.warn(line);
		} else {
			console.log(line);
		}
	}
}

/** Module-level cronbase logger. */
export const logger = {
	/** Debug-level message — visible when `CRONBASE_LOG_LEVEL=debug`. */
	debug(message: string, meta?: ConsoleMeta): void {
		emit("debug", message, meta);
	},
	/** Informational message (default level). */
	info(message: string, meta?: ConsoleMeta): void {
		emit("info", message, meta);
	},
	/** Warning — potential issue, no action needed immediately. */
	warn(message: string, meta?: ConsoleMeta): void {
		emit("warn", message, meta);
	},
	/** Error — something failed. */
	error(message: string, meta?: ConsoleMeta): void {
		emit("error", message, meta);
	},
};
