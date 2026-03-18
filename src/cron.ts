/**
 * Cron expression parser.
 *
 * Supports standard 5-field cron expressions:
 *   minute hour day-of-month month day-of-week
 *
 * Plus presets: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly
 */

import type { ParsedCron } from "./types";

const PRESETS: Record<string, string> = {
	"@yearly": "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly": "0 0 1 * *",
	"@weekly": "0 0 * * 0",
	"@daily": "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly": "0 * * * *",
};

const FIELD_RANGES: [number, number][] = [
	[0, 59], // minute
	[0, 23], // hour
	[1, 31], // day of month
	[1, 12], // month
	[0, 6], // day of week (0 = Sunday)
];

const MONTH_NAMES: Record<string, number> = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
};

const DAY_NAMES: Record<string, number> = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
};

/**
 * Parse a single cron field into an array of valid values.
 * When isDow is true, value 7 is normalized to 0 (Sunday) for
 * compatibility with standard cron (man 5 crontab: "0 or 7 is Sun").
 */
function parseField(
	field: string,
	[min, max]: [number, number],
	names?: Record<string, number>,
	isDow = false,
): number[] {
	const values = new Set<number>();

	for (const part of field.split(",")) {
		let working = part.trim().toLowerCase();

		// Replace names with numbers
		if (names) {
			for (const [name, num] of Object.entries(names)) {
				working = working.replaceAll(name, String(num));
			}
		}

		if (working === "*") {
			for (let i = min; i <= max; i++) values.add(i);
		} else if (working.includes("/")) {
			const [range, stepStr] = working.split("/");
			const step = Number.parseInt(stepStr, 10);
			if (Number.isNaN(step) || step <= 0) {
				throw new Error(`Invalid step value: ${stepStr}`);
			}
			let start = min;
			let end = max;
			if (range !== "*") {
				if (range.includes("-")) {
					[start, end] = range.split("-").map((s) => Number.parseInt(s, 10));
				} else {
					start = Number.parseInt(range, 10);
				}
			}
			for (let i = start; i <= end; i += step) values.add(i);
		} else if (working.includes("-")) {
			const [startStr, endStr] = working.split("-");
			const start = Number.parseInt(startStr, 10);
			const end = Number.parseInt(endStr, 10);
			if (Number.isNaN(start) || Number.isNaN(end)) {
				throw new Error(`Invalid range: ${part}`);
			}
			if (start > end) {
				throw new Error(`Invalid range: ${start}-${end} (start must be <= end)`);
			}
			for (let i = start; i <= end; i++) values.add(i);
		} else {
			const val = Number.parseInt(working, 10);
			if (Number.isNaN(val)) {
				throw new Error(`Invalid value: ${part}`);
			}
			values.add(val);
		}
	}

	// Normalize day-of-week 7 → 0 (both mean Sunday per POSIX cron spec)
	if (isDow && values.has(7)) {
		values.delete(7);
		values.add(0);
	}

	// Validate all values are in range
	for (const v of values) {
		if (v < min || v > max) {
			throw new Error(`Value ${v} out of range [${min}, ${max}]`);
		}
	}

	return [...values].sort((a, b) => a - b);
}

/**
 * Parse a cron expression string into a ParsedCron object.
 */
export function parseCron(expression: string): ParsedCron {
	const expr = PRESETS[expression.toLowerCase()] ?? expression;
	const fields = expr.trim().split(/\s+/);

	if (fields.length !== 5) {
		throw new Error(
			`Invalid cron expression: expected 5 fields, got ${fields.length}. Format: minute hour day-of-month month day-of-week`,
		);
	}

	return {
		minute: parseField(fields[0], FIELD_RANGES[0]),
		hour: parseField(fields[1], FIELD_RANGES[1]),
		dayOfMonth: parseField(fields[2], FIELD_RANGES[2]),
		month: parseField(fields[3], FIELD_RANGES[3], MONTH_NAMES),
		dayOfWeek: parseField(fields[4], FIELD_RANGES[4], DAY_NAMES, true),
	};
}

/**
 * Get the next run time after `after` for the given parsed cron expression.
 * Returns an ISO 8601 string.
 */
export function getNextRun(parsed: ParsedCron, after: Date = new Date()): Date {
	// Start from the next minute (all arithmetic in UTC — cronbase stores times as UTC)
	const next = new Date(after);
	next.setUTCSeconds(0, 0);
	next.setUTCMinutes(next.getUTCMinutes() + 1);

	// Search forward up to 5 years (needs >4 to handle Feb 29 leap year schedules)
	const limit = new Date(after);
	limit.setUTCFullYear(limit.getUTCFullYear() + 5);

	// Standard cron semantics: when BOTH day-of-month and day-of-week are
	// constrained (neither is a full wildcard), they are OR'd — the job runs
	// if EITHER condition matches. When only one is constrained, it acts as AND.
	const domConstrained = parsed.dayOfMonth.length < 31;
	const dowConstrained = parsed.dayOfWeek.length < 7;
	const useDayOr = domConstrained && dowConstrained;

	// Cap iterations to prevent event loop blocking on impossible schedules
	// (e.g., "0 0 31 2 *" — day 31 in February). Even with efficient skipping,
	// some schedules require scanning millions of minutes.
	const MAX_ITERATIONS = 500_000;
	let iterations = 0;

	while (next < limit) {
		if (++iterations > MAX_ITERATIONS) {
			throw new Error(
				"Could not find next run time within iteration limit — schedule may be impossible or extremely rare",
			);
		}

		const monthOk = parsed.month.includes(next.getUTCMonth() + 1);
		const domOk = parsed.dayOfMonth.includes(next.getUTCDate());
		const dowOk = parsed.dayOfWeek.includes(next.getUTCDay());
		const dayOk = useDayOr ? domOk || dowOk : domOk && dowOk;

		if (
			monthOk &&
			dayOk &&
			parsed.hour.includes(next.getUTCHours()) &&
			parsed.minute.includes(next.getUTCMinutes())
		) {
			return next;
		}

		// Advance: try to skip efficiently
		if (!monthOk) {
			next.setUTCMonth(next.getUTCMonth() + 1, 1);
			next.setUTCHours(0, 0, 0, 0);
		} else if (!dayOk) {
			next.setUTCDate(next.getUTCDate() + 1);
			next.setUTCHours(0, 0, 0, 0);
		} else if (!parsed.hour.includes(next.getUTCHours())) {
			next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
		} else {
			next.setUTCMinutes(next.getUTCMinutes() + 1);
		}
	}

	throw new Error("Could not find next run time within 5 years");
}

/** Detect if a field string is a simple step pattern like *\/N or 0 *\/N */
function detectStep(field: string): number | null {
	const m = field.match(/^\*\/(\d+)$/);
	return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Format a cron expression into a human-readable string.
 */
export function describeCron(expression: string): string {
	const lower = expression.toLowerCase();
	if (lower === "@yearly" || lower === "@annually") return "Once a year (Jan 1 at midnight)";
	if (lower === "@monthly") return "Once a month (1st at midnight)";
	if (lower === "@weekly") return "Once a week (Sunday at midnight)";
	if (lower === "@daily" || lower === "@midnight") return "Once a day (at midnight)";
	if (lower === "@hourly") return "Once an hour (at minute 0)";

	const parsed = parseCron(expression);
	const fields = (PRESETS[lower] ?? expression).trim().split(/\s+/);
	const minStep = detectStep(fields[0]);
	const hourStep = detectStep(fields[1]);

	const MONTH_DISPLAY = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const DAY_DISPLAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

	const parts: string[] = [];

	// --- Time portion ---
	// Detect friendly step-based patterns first
	if (minStep && parsed.hour.length === 24) {
		// */N * ... → "Every N minutes"
		parts.push(`Every ${minStep} minutes`);
	} else if (parsed.minute.length === 1 && parsed.minute[0] === 0 && hourStep) {
		// 0 */N ... → "Every N hours"
		parts.push(`Every ${hourStep} hours`);
	} else if (parsed.minute.length === 60) {
		parts.push("Every minute");
	} else if (parsed.minute.length === 1 && parsed.hour.length === 1) {
		parts.push(
			`At ${String(parsed.hour[0]).padStart(2, "0")}:${String(parsed.minute[0]).padStart(2, "0")}`,
		);
	} else if (parsed.minute.length === 1 && parsed.hour.length === 24) {
		parts.push(`At minute ${parsed.minute[0]} of every hour`);
	} else if (parsed.minute.length === 1) {
		const hourNames =
			parsed.hour.length <= 4
				? parsed.hour
						.map(
							(h) => `${String(h).padStart(2, "0")}:${String(parsed.minute[0]).padStart(2, "0")}`,
						)
						.join(", ")
				: null;
		if (hourNames) {
			parts.push(`At ${hourNames}`);
		} else {
			parts.push(`at minute ${parsed.minute[0]} of hours ${parsed.hour.join(", ")}`);
		}
	} else {
		parts.push(`at minutes ${parsed.minute.join(", ")}`);
		if (parsed.hour.length === 24) parts.push("of every hour");
		else if (parsed.hour.length === 1) parts.push(`of hour ${parsed.hour[0]}`);
		else parts.push(`of hours ${parsed.hour.join(", ")}`);
	}

	// --- Day-of-month ---
	if (parsed.dayOfMonth.length < 31) {
		if (parsed.dayOfMonth.length === 1) parts.push(`on day ${parsed.dayOfMonth[0]}`);
		else parts.push(`on days ${parsed.dayOfMonth.join(", ")}`);
	}

	// --- Month ---
	if (parsed.month.length < 12) {
		const names = parsed.month.map((m) => MONTH_DISPLAY[m - 1]);
		if (names.length === 1) parts.push(`in ${names[0]}`);
		else parts.push(`in ${names.join(", ")}`);
	}

	// --- Day-of-week ---
	if (parsed.dayOfWeek.length < 7) {
		const names = parsed.dayOfWeek.map((d) => DAY_DISPLAY[d]);
		if (names.length === 1) parts.push(`on ${names[0]}`);
		else if (names.length === 5 && !parsed.dayOfWeek.includes(0) && !parsed.dayOfWeek.includes(6))
			parts.push("on weekdays");
		else if (names.length === 2 && parsed.dayOfWeek.includes(0) && parsed.dayOfWeek.includes(6))
			parts.push("on weekends");
		else parts.push(`on ${names.join(", ")}`);
	}

	return parts.join(" ");
}
