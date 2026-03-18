import { describe, expect, test } from "bun:test";
import { describeCron, getNextRun, parseCron } from "../src/cron";

describe("parseCron", () => {
	test("parses simple expressions", () => {
		const parsed = parseCron("0 0 * * *"); // midnight daily
		expect(parsed.minute).toEqual([0]);
		expect(parsed.hour).toEqual([0]);
		expect(parsed.dayOfMonth).toHaveLength(31);
		expect(parsed.month).toHaveLength(12);
		expect(parsed.dayOfWeek).toHaveLength(7);
	});

	test("parses specific values", () => {
		const parsed = parseCron("30 14 1 6 3"); // 2:30 PM, June 1st, Wednesday
		expect(parsed.minute).toEqual([30]);
		expect(parsed.hour).toEqual([14]);
		expect(parsed.dayOfMonth).toEqual([1]);
		expect(parsed.month).toEqual([6]);
		expect(parsed.dayOfWeek).toEqual([3]);
	});

	test("parses ranges", () => {
		const parsed = parseCron("0 9-17 * * *"); // every hour 9am-5pm
		expect(parsed.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
	});

	test("parses steps", () => {
		const parsed = parseCron("*/15 * * * *"); // every 15 minutes
		expect(parsed.minute).toEqual([0, 15, 30, 45]);
	});

	test("parses lists", () => {
		const parsed = parseCron("0 0 1,15 * *"); // 1st and 15th
		expect(parsed.dayOfMonth).toEqual([1, 15]);
	});

	test("parses range with step", () => {
		const parsed = parseCron("0 8-18/2 * * *"); // every 2 hours from 8-18
		expect(parsed.hour).toEqual([8, 10, 12, 14, 16, 18]);
	});

	test("parses @daily preset", () => {
		const parsed = parseCron("@daily");
		expect(parsed.minute).toEqual([0]);
		expect(parsed.hour).toEqual([0]);
		expect(parsed.dayOfMonth).toHaveLength(31);
	});

	test("parses @hourly preset", () => {
		const parsed = parseCron("@hourly");
		expect(parsed.minute).toEqual([0]);
		expect(parsed.hour).toHaveLength(24);
	});

	test("parses @weekly preset", () => {
		const parsed = parseCron("@weekly");
		expect(parsed.minute).toEqual([0]);
		expect(parsed.hour).toEqual([0]);
		expect(parsed.dayOfWeek).toEqual([0]); // Sunday
	});

	test("parses @monthly preset", () => {
		const parsed = parseCron("@monthly");
		expect(parsed.dayOfMonth).toEqual([1]);
	});

	test("parses @yearly preset", () => {
		const parsed = parseCron("@yearly");
		expect(parsed.month).toEqual([1]);
		expect(parsed.dayOfMonth).toEqual([1]);
	});

	test("parses month names", () => {
		const parsed = parseCron("0 0 1 jan,mar,jun *");
		expect(parsed.month).toEqual([1, 3, 6]);
	});

	test("parses day names", () => {
		const parsed = parseCron("0 0 * * mon-fri");
		expect(parsed.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
	});

	test("rejects invalid field count", () => {
		expect(() => parseCron("0 0 *")).toThrow("expected 5 fields");
	});

	test("rejects out-of-range values", () => {
		expect(() => parseCron("60 0 * * *")).toThrow("out of range");
		expect(() => parseCron("0 25 * * *")).toThrow("out of range");
		expect(() => parseCron("0 0 32 * *")).toThrow("out of range");
	});

	test("rejects inverted ranges", () => {
		expect(() => parseCron("0 15-10 * * *")).toThrow("start must be <= end");
		expect(() => parseCron("30-5 * * * *")).toThrow("start must be <= end");
	});
});

describe("getNextRun", () => {
	test("finds next midnight from afternoon", () => {
		const parsed = parseCron("0 0 * * *");
		const after = new Date("2026-03-18T15:00:00Z");
		const next = getNextRun(parsed, after);
		expect(next.toISOString()).toBe("2026-03-19T00:00:00.000Z");
	});

	test("finds next 15-minute mark", () => {
		const parsed = parseCron("*/15 * * * *");
		const after = new Date("2026-03-18T14:07:00Z");
		const next = getNextRun(parsed, after);
		expect(next.toISOString()).toBe("2026-03-18T14:15:00.000Z");
	});

	test("finds next specific day of week", () => {
		const parsed = parseCron("0 9 * * 1"); // Monday at 9am
		const after = new Date("2026-03-18T10:00:00Z"); // Wednesday
		const next = getNextRun(parsed, after);
		// 2026-03-18 is a Wednesday, next Monday is 2026-03-23
		expect(next.getDay()).toBe(1); // Monday
		expect(next.getHours()).toBe(9);
	});

	test("advances to next minute if on exact match", () => {
		const parsed = parseCron("30 * * * *");
		const after = new Date("2026-03-18T14:30:00Z");
		const next = getNextRun(parsed, after);
		expect(next.toISOString()).toBe("2026-03-18T15:30:00.000Z");
	});
});

describe("getNextRun edge cases", () => {
	test("wraps across month boundary", () => {
		const parsed = parseCron("0 0 1 * *"); // 1st of every month at midnight
		const after = new Date("2026-03-15T12:00:00Z");
		const next = getNextRun(parsed, after);
		expect(next.toISOString()).toBe("2026-04-01T00:00:00.000Z");
	});

	test("wraps across year boundary", () => {
		const parsed = parseCron("0 0 1 1 *"); // Jan 1 midnight
		const after = new Date("2026-12-25T00:00:00Z");
		const next = getNextRun(parsed, after);
		expect(next.getFullYear()).toBe(2027);
		expect(next.getMonth()).toBe(0); // January
		expect(next.getDate()).toBe(1);
	});

	test("handles dayOfMonth OR dayOfWeek when both constrained (standard cron)", () => {
		// "0 0 15 * 1" — 15th of month OR Monday (standard cron OR semantics)
		// When BOTH day-of-month and day-of-week are constrained (not *),
		// cron fires when EITHER matches.
		const parsed = parseCron("0 0 15 * 1");
		const after = new Date("2026-03-18T00:00:00Z"); // Wednesday
		const next = getNextRun(parsed, after);
		// Next match: Monday Mar 23 (day-of-week match)
		expect(next.getDay() === 1 || next.getDate() === 15).toBe(true);
	});

	test("dayOfMonth OR dayOfWeek: fires on 15th regardless of weekday", () => {
		// "0 0 15 * 1" — should fire on Apr 15 even though it's a Wednesday
		const parsed = parseCron("0 0 15 * 1");
		const after = new Date("2026-04-14T00:00:00Z"); // Tuesday
		const next = getNextRun(parsed, after);
		// Apr 15 is Wednesday — matches dayOfMonth=15 via OR semantics
		expect(next.getDate()).toBe(15);
		expect(next.getMonth()).toBe(3); // April
	});

	test("dayOfWeek wildcard uses AND semantics", () => {
		// "0 0 15 * *" — only dayOfMonth constrained, dayOfWeek is wildcard → AND
		const parsed = parseCron("0 0 15 * *");
		const after = new Date("2026-03-01T00:00:00Z");
		const next = getNextRun(parsed, after);
		expect(next.getDate()).toBe(15);
	});

	test("handles February correctly", () => {
		const parsed = parseCron("0 12 28 2 *"); // Feb 28 at noon
		const after = new Date("2026-01-01T00:00:00Z");
		const next = getNextRun(parsed, after);
		expect(next.getMonth()).toBe(1); // February
		expect(next.getDate()).toBe(28);
	});

	test("throws for impossible schedule (Feb 31)", () => {
		const parsed = parseCron("0 0 31 2 *"); // Feb 31 — impossible
		const after = new Date("2026-01-01T00:00:00Z");
		expect(() => getNextRun(parsed, after)).toThrow("Could not find next run time");
	});

	test("finds Feb 29 on next leap year", () => {
		// Feb 29 only exists in leap years. 2028 is the next leap year after 2026.
		const parsed = parseCron("0 0 29 2 *");
		const after = new Date("2026-03-01T00:00:00Z");
		const next = getNextRun(parsed, after);
		expect(next.getFullYear()).toBe(2028);
		expect(next.getMonth()).toBe(1); // February
		expect(next.getDate()).toBe(29);
	});

	test("handles last hour of day wrapping to next day", () => {
		const parsed = parseCron("0 0 * * *"); // midnight
		const after = new Date("2026-03-18T23:59:00Z");
		const next = getNextRun(parsed, after);
		expect(next.toISOString()).toBe("2026-03-19T00:00:00.000Z");
	});
});

describe("describeCron", () => {
	test("describes presets", () => {
		expect(describeCron("@daily")).toContain("Once a day");
		expect(describeCron("@hourly")).toContain("Once an hour");
		expect(describeCron("@weekly")).toContain("Once a week");
		expect(describeCron("@monthly")).toContain("Once a month");
		expect(describeCron("@yearly")).toContain("Once a year");
	});

	test("describes custom expression", () => {
		// Single minute + single hour → combined HH:MM format
		expect(describeCron("30 14 * * *")).toBe("At 14:30");
		// Every minute
		expect(describeCron("* * * * *")).toBe("Every minute");
		// Specific minutes across all hours
		expect(describeCron("0,30 * * * *")).toContain("minutes 0, 30");
		// Day-of-week
		expect(describeCron("0 9 * * 1")).toContain("Mon");
		// Weekdays
		expect(describeCron("0 9 * * 1-5")).toContain("weekdays");
		// Month constraint
		expect(describeCron("0 0 1 6 *")).toContain("Jun");
		// Day-of-month
		expect(describeCron("0 0 15 * *")).toContain("day 15");
		// Step-based: every N minutes
		expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
		expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
		// Step-based: every N hours
		expect(describeCron("0 */6 * * *")).toBe("Every 6 hours");
		expect(describeCron("0 */2 * * *")).toBe("Every 2 hours");
		// Single minute + multiple hours → friendly time list
		expect(describeCron("0 9 * * 1")).toBe("At 09:00 on Mon");
	});
});

describe("day-of-week 7 = Sunday (POSIX compatibility)", () => {
	test("7 alone is treated as Sunday (0)", () => {
		const parsed = parseCron("0 0 * * 7");
		expect(parsed.dayOfWeek).toEqual([0]);
	});

	test("range 1-7 covers all week days including Sunday", () => {
		const parsed = parseCron("0 0 * * 1-7");
		expect(parsed.dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	test("list with 7 normalizes to 0", () => {
		const parsed = parseCron("0 0 * * 5,7");
		expect(parsed.dayOfWeek).toEqual([0, 5]);
	});

	test("0 and 7 together deduplicate to single Sunday", () => {
		const parsed = parseCron("0 0 * * 0,7");
		expect(parsed.dayOfWeek).toEqual([0]);
	});

	test("7 normalization does not affect other fields", () => {
		// Value 7 in hour field should still be valid (it's within 0-23)
		const parsed = parseCron("0 7 * * *");
		expect(parsed.hour).toEqual([7]);
	});
});

describe("getNextRun UTC consistency", () => {
	test("uses UTC fields not local time", () => {
		// Create a date where UTC and local time differ in hour/day
		// Use a known UTC time: 2026-03-15 23:30:00 UTC
		const after = new Date("2026-03-15T23:30:00Z");
		const parsed = parseCron("0 0 16 * *"); // midnight on the 16th

		const next = getNextRun(parsed, after);
		// Should find 2026-03-16 00:00 UTC (not affected by local timezone)
		expect(next.getUTCFullYear()).toBe(2026);
		expect(next.getUTCMonth()).toBe(2); // March = 2
		expect(next.getUTCDate()).toBe(16);
		expect(next.getUTCHours()).toBe(0);
		expect(next.getUTCMinutes()).toBe(0);
	});

	test("day-of-week matching uses UTC day", () => {
		// Sunday 2026-03-15 23:50 UTC — in UTC+N timezones this would be Monday local
		const after = new Date("2026-03-15T23:50:00Z"); // Sunday UTC
		const parsed = parseCron("0 0 * * 1"); // Monday

		const next = getNextRun(parsed, after);
		// Next Monday in UTC is 2026-03-16
		expect(next.getUTCDay()).toBe(1); // Monday
		expect(next.getUTCDate()).toBe(16);
	});
});
