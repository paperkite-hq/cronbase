import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { getLogLevel, logger, setJsonFormat, setLogLevel } from "../src/logger";

describe("logger", () => {
	// Capture console output in tests
	let stdoutLines: string[] = [];
	let stderrLines: string[] = [];
	let originalLevel: ReturnType<typeof getLogLevel>;

	beforeEach(() => {
		stdoutLines = [];
		stderrLines = [];
		originalLevel = getLogLevel();

		spyOn(console, "log").mockImplementation((...args) => {
			stdoutLines.push(args.join(" "));
		});
		spyOn(console, "warn").mockImplementation((...args) => {
			stderrLines.push(args.join(" "));
		});
		spyOn(console, "error").mockImplementation((...args) => {
			stderrLines.push(args.join(" "));
		});
	});

	afterEach(() => {
		// Restore original level and format after each test
		setLogLevel(originalLevel);
		setJsonFormat(false);
		mock.restore();
	});

	describe("level filtering", () => {
		it("emits info messages at default info level", () => {
			setLogLevel("info");
			logger.info("hello world");
			expect(stdoutLines.length).toBe(1);
			expect(stdoutLines[0]).toContain("hello world");
		});

		it("suppresses debug messages at info level", () => {
			setLogLevel("info");
			logger.debug("debug msg");
			expect(stdoutLines.length).toBe(0);
			expect(stderrLines.length).toBe(0);
		});

		it("emits debug messages when level is debug", () => {
			setLogLevel("debug");
			logger.debug("debug msg");
			expect(stdoutLines.length).toBe(1);
			expect(stdoutLines[0]).toContain("debug msg");
		});

		it("suppresses info messages at warn level", () => {
			setLogLevel("warn");
			logger.info("info msg");
			expect(stdoutLines.length).toBe(0);
		});

		it("emits warn messages at warn level", () => {
			setLogLevel("warn");
			logger.warn("warn msg");
			expect(stderrLines.length).toBe(1);
			expect(stderrLines[0]).toContain("warn msg");
		});

		it("suppresses everything at silent level", () => {
			setLogLevel("silent");
			logger.error("should not appear");
			logger.warn("should not appear");
			logger.info("should not appear");
			logger.debug("should not appear");
			expect(stdoutLines.length).toBe(0);
			expect(stderrLines.length).toBe(0);
		});

		it("only emits error messages at error level", () => {
			setLogLevel("error");
			logger.debug("debug");
			logger.info("info");
			logger.warn("warn");
			logger.error("actual error");
			expect(stdoutLines.length).toBe(0);
			expect(stderrLines.length).toBe(1);
			expect(stderrLines[0]).toContain("actual error");
		});
	});

	describe("text format", () => {
		it("includes [cronbase] prefix", () => {
			setLogLevel("info");
			logger.info("test message");
			expect(stdoutLines[0]).toContain("[cronbase]");
		});

		it("includes the message", () => {
			setLogLevel("info");
			logger.info("my message");
			expect(stdoutLines[0]).toContain("my message");
		});

		it("appends meta as JSON", () => {
			setLogLevel("info");
			logger.info("msg", { jobName: "backup", durationMs: 42 });
			expect(stdoutLines[0]).toContain('"jobName":"backup"');
			expect(stdoutLines[0]).toContain('"durationMs":42');
		});

		it("omits meta when not provided", () => {
			setLogLevel("info");
			logger.info("clean message");
			expect(stdoutLines[0]).not.toContain("{");
		});

		it("routes warn to console.warn", () => {
			setLogLevel("warn");
			logger.warn("watch out");
			expect(stderrLines[0]).toContain("watch out");
			expect(stdoutLines.length).toBe(0);
		});

		it("routes error to console.error", () => {
			setLogLevel("error");
			logger.error("something broke");
			expect(stderrLines[0]).toContain("something broke");
			expect(stdoutLines.length).toBe(0);
		});
	});

	describe("JSON format", () => {
		beforeEach(() => {
			setJsonFormat(true);
		});

		it("emits valid JSON", () => {
			setLogLevel("info");
			logger.info("json test");
			expect(stdoutLines.length).toBe(1);
			const parsed = JSON.parse(stdoutLines[0]);
			expect(parsed).toBeDefined();
		});

		it("includes time, level, and msg fields", () => {
			setLogLevel("info");
			logger.info("structured message");
			const parsed = JSON.parse(stdoutLines[0]);
			expect(parsed.time).toBeString();
			expect(parsed.level).toBe("info");
			expect(parsed.msg).toBe("structured message");
		});

		it("merges meta fields into the JSON object", () => {
			setLogLevel("info");
			logger.info("with meta", { jobName: "cleanup", exitCode: 0 });
			const parsed = JSON.parse(stdoutLines[0]);
			expect(parsed.jobName).toBe("cleanup");
			expect(parsed.exitCode).toBe(0);
		});

		it("includes correct level for warn", () => {
			setLogLevel("warn");
			logger.warn("a warning");
			const parsed = JSON.parse(stderrLines[0]);
			expect(parsed.level).toBe("warn");
		});

		it("includes correct level for error", () => {
			setLogLevel("error");
			logger.error("an error");
			const parsed = JSON.parse(stderrLines[0]);
			expect(parsed.level).toBe("error");
		});
	});

	describe("getLogLevel / setLogLevel", () => {
		it("getLogLevel returns the active level", () => {
			setLogLevel("debug");
			expect(getLogLevel()).toBe("debug");
		});

		it("setLogLevel changes the active level", () => {
			setLogLevel("warn");
			expect(getLogLevel()).toBe("warn");
			setLogLevel("info");
			expect(getLogLevel()).toBe("info");
		});
	});
});
