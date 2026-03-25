import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatDate,
	formatDuration,
	parseArgs,
	parseCrontabLine,
	runCommand,
	statusIcon,
} from "../src/cli";

// CLI tests spawn Bun subprocesses. Under load (e.g., pre-commit hooks running
// all test files concurrently), subprocess startup + SQLite init can exceed the
// default 5s timeout. 15s handles multi-subprocess tests on a loaded system.
setDefaultTimeout(15_000);

const CLI = join(import.meta.dir, "../src/cli.ts");

/** Run the CLI with given args and return stdout, stderr, exitCode */
async function runCli(
	args: string[],
	env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe("parseArgs", () => {
	test("parses basic flags", () => {
		const result = parseArgs(["add", "--name", "test", "--schedule", "* * * * *"]);
		expect(result.command).toBe("add");
		expect(result.flags.name).toBe("test");
		expect(result.flags.schedule).toBe("* * * * *");
	});

	test("parses --key=value syntax", () => {
		const result = parseArgs(["add", "--name=test", "--command=echo hello"]);
		expect(result.flags.name).toBe("test");
		expect(result.flags.command).toBe("echo hello");
	});

	test("parses boolean flags", () => {
		const result = parseArgs(["add", "--disabled", "--dry-run"]);
		expect(result.flags.disabled).toBe("true");
		expect(result.flags["dry-run"]).toBe("true");
	});

	test("known value flags consume next arg even if it starts with --", () => {
		// This was a bug: --command "--verbose check" would set command to "true"
		// because the parser treated "--verbose check" as a new flag
		const result = parseArgs([
			"add",
			"--name",
			"test",
			"--command",
			"--verbose check",
			"--schedule",
			"* * * * *",
		]);
		expect(result.flags.command).toBe("--verbose check");
		expect(result.flags.name).toBe("test");
		expect(result.flags.schedule).toBe("* * * * *");
	});

	test("--key=value syntax works for values starting with --", () => {
		const result = parseArgs(["add", "--command=--run-checks", "--name=test"]);
		expect(result.flags.command).toBe("--run-checks");
	});

	test("parses positional arguments", () => {
		const result = parseArgs(["run", "my-job"]);
		expect(result.command).toBe("run");
		expect(result.positional).toEqual(["my-job"]);
	});

	test("unknown flags still treat non-flag next arg as value", () => {
		const result = parseArgs(["start", "--custom", "value"]);
		expect(result.flags.custom).toBe("value");
	});

	test("unknown flags with no next arg are boolean", () => {
		const result = parseArgs(["start", "--custom"]);
		expect(result.flags.custom).toBe("true");
	});

	test("defaults to help when no args", () => {
		const result = parseArgs([]);
		expect(result.command).toBe("help");
	});
});

describe("formatDate", () => {
	test("returns dash for null", () => {
		expect(formatDate(null)).toBe("—");
	});

	test("handles ISO 8601 format", () => {
		const result = formatDate("2026-03-20T10:30:00Z");
		// Should produce a locale string (exact format varies by env)
		expect(result).toBeTruthy();
		expect(result).not.toBe("—");
	});

	test("handles SQLite datetime format (space separator)", () => {
		const result = formatDate("2026-03-20 10:30:00");
		expect(result).toBeTruthy();
		expect(result).not.toBe("—");
	});
});

describe("formatDuration", () => {
	test("returns dash for null", () => {
		expect(formatDuration(null)).toBe("—");
	});

	test("returns dash for undefined", () => {
		expect(formatDuration(undefined as unknown as null)).toBe("—");
	});

	test("formats milliseconds", () => {
		expect(formatDuration(500)).toBe("500ms");
		expect(formatDuration(0)).toBe("0ms");
		expect(formatDuration(999)).toBe("999ms");
	});

	test("formats seconds", () => {
		expect(formatDuration(1000)).toBe("1.0s");
		expect(formatDuration(5500)).toBe("5.5s");
		expect(formatDuration(59999)).toBe("60.0s");
	});

	test("formats minutes", () => {
		expect(formatDuration(60000)).toBe("1.0m");
		expect(formatDuration(90000)).toBe("1.5m");
		expect(formatDuration(3600000)).toBe("60.0m");
	});
});

describe("statusIcon", () => {
	test("returns correct icons for each status", () => {
		expect(statusIcon("success")).toBe("✓");
		expect(statusIcon("failed")).toBe("✗");
		expect(statusIcon("timeout")).toBe("⏱");
		expect(statusIcon("running")).toBe("▶");
		expect(statusIcon("skipped")).toBe("⏭");
	});

	test("returns dash for null", () => {
		expect(statusIcon(null)).toBe("—");
	});

	test("returns dash for unknown status", () => {
		expect(statusIcon("unknown")).toBe("—");
		expect(statusIcon("")).toBe("—");
	});
});

describe("parseCrontabLine", () => {
	test("parses standard 5-field cron entry", () => {
		const result = parseCrontabLine("0 2 * * * /usr/bin/backup.sh");
		expect(result).toEqual({ schedule: "0 2 * * *", command: "/usr/bin/backup.sh" });
	});

	test("parses entry with multi-word command", () => {
		const result = parseCrontabLine("*/5 * * * * curl -sf http://localhost/health");
		expect(result).toEqual({
			schedule: "*/5 * * * *",
			command: "curl -sf http://localhost/health",
		});
	});

	test("parses @preset entries", () => {
		expect(parseCrontabLine("@daily /usr/bin/cleanup")).toEqual({
			schedule: "@daily",
			command: "/usr/bin/cleanup",
		});
		expect(parseCrontabLine("@hourly script.sh --flag")).toEqual({
			schedule: "@hourly",
			command: "script.sh --flag",
		});
	});

	test("skips empty lines", () => {
		expect(parseCrontabLine("")).toBeNull();
		expect(parseCrontabLine("   ")).toBeNull();
	});

	test("skips comments", () => {
		expect(parseCrontabLine("# this is a comment")).toBeNull();
		expect(parseCrontabLine("  # indented comment")).toBeNull();
	});

	test("skips variable assignments", () => {
		expect(parseCrontabLine("SHELL=/bin/bash")).toBeNull();
		expect(parseCrontabLine("PATH=/usr/local/bin:/usr/bin")).toBeNull();
		expect(parseCrontabLine("MAILTO=admin@example.com")).toBeNull();
	});

	test("returns null for lines with too few fields", () => {
		expect(parseCrontabLine("0 2 * *")).toBeNull();
		expect(parseCrontabLine("just-a-word")).toBeNull();
	});
});

describe("CLI commands", () => {
	let tmpDir: string;
	let dbPath: string;

	// Fresh temp DB for each test
	afterEach(() => {
		if (tmpDir && existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true });
		}
	});

	function freshDb(): string {
		tmpDir = mkdtempSync(join(tmpdir(), "cronbase-cli-test-"));
		dbPath = join(tmpDir, "test.db");
		return dbPath;
	}

	test("help shows usage", async () => {
		const { stdout, exitCode } = await runCli(["help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("cronbase — Beautiful self-hosted cron job manager");
		expect(stdout).toContain("cronbase start");
		expect(stdout).toContain("cronbase add");
	});

	test("--help flag shows usage", async () => {
		const { stdout, exitCode } = await runCli(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("cronbase — Beautiful self-hosted cron job manager");
	});

	test("version shows package version", async () => {
		const { stdout, exitCode } = await runCli(["version"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/cronbase v\d+\.\d+\.\d+/);
	});

	test("--version flag", async () => {
		const { stdout, exitCode } = await runCli(["--version"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/cronbase v\d+\.\d+\.\d+/);
	});

	test("unknown command shows error", async () => {
		const { stderr, exitCode } = await runCli(["bogus"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unknown command: bogus");
	});

	test("add creates a job", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli([
			"add",
			"--name",
			"test-job",
			"--schedule",
			"*/5 * * * *",
			"--command",
			"echo hello",
			"--db",
			db,
		]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓ Job added: test-job");
		expect(stdout).toContain("*/5 * * * *");
		expect(stdout).toContain("echo hello");
	});

	test("add with description and timeout", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli([
			"add",
			"--name",
			"detailed-job",
			"--schedule",
			"0 * * * *",
			"--command",
			"date",
			"--description",
			"A test job",
			"--timeout",
			"60",
			"--db",
			db,
		]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓ Job added: detailed-job");
	});

	test("add with retries", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli([
			"add",
			"--name",
			"retry-job",
			"--schedule",
			"0 * * * *",
			"--command",
			"echo retry",
			"--retries",
			"3",
			"--retry-delay",
			"10",
			"--db",
			db,
		]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓ Job added: retry-job");
	});

	test("add with --disabled flag", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli([
			"add",
			"--name",
			"disabled-job",
			"--schedule",
			"0 * * * *",
			"--command",
			"echo disabled",
			"--disabled",
			"--db",
			db,
		]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓ Job added: disabled-job");
	});

	test("add rejects missing required fields", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli(["add", "--name", "test", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("--name, --schedule, and --command are required");
	});

	test("add rejects duplicate name", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"dup",
			"--schedule",
			"* * * * *",
			"--command",
			"echo 1",
			"--db",
			db,
		]);
		const { stderr, exitCode } = await runCli([
			"add",
			"--name",
			"dup",
			"--schedule",
			"* * * * *",
			"--command",
			"echo 2",
			"--db",
			db,
		]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain('A job named "dup" already exists');
	});

	test("add rejects invalid schedule", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli([
			"add",
			"--name",
			"bad-sched",
			"--schedule",
			"not-a-cron",
			"--command",
			"echo hi",
			"--db",
			db,
		]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Error:");
	});

	test("list with no jobs", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["list", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No jobs defined");
	});

	test("list shows jobs", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"job-a",
			"--schedule",
			"* * * * *",
			"--command",
			"echo a",
			"--db",
			db,
		]);
		await runCli([
			"add",
			"--name",
			"job-b",
			"--schedule",
			"0 * * * *",
			"--command",
			"echo b",
			"--db",
			db,
		]);
		const { stdout, exitCode } = await runCli(["list", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("job-a");
		expect(stdout).toContain("job-b");
		expect(stdout).toContain("2 job(s)");
	});

	test("run executes a job", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"echo-job",
			"--schedule",
			"* * * * *",
			"--command",
			"echo hello-world",
			"--db",
			db,
		]);
		const { stdout, exitCode } = await runCli(["run", "echo-job", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Running: echo-job");
		expect(stdout).toContain("✓ success");
		expect(stdout).toContain("hello-world");
	});

	test("run with failing command exits 1", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"fail-job",
			"--schedule",
			"* * * * *",
			"--command",
			"exit 42",
			"--db",
			db,
		]);
		const { stdout, exitCode } = await runCli(["run", "fail-job", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stdout).toContain("✗ failed");
	});

	test("run with missing name", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli(["run", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Job name required");
	});

	test("run with unknown job", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli(["run", "nonexistent", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Job "nonexistent" not found');
	});

	test("remove deletes a job", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"to-remove",
			"--schedule",
			"* * * * *",
			"--command",
			"echo x",
			"--db",
			db,
		]);
		const { stdout, exitCode } = await runCli(["remove", "to-remove", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓ Removed: to-remove");

		// Verify it's gone
		const list = await runCli(["list", "--db", db]);
		expect(list.stdout).toContain("No jobs defined");
	});

	test("remove with missing name", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli(["remove", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Job name required");
	});

	test("remove with unknown job", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli(["remove", "ghost", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Job "ghost" not found');
	});

	test("enable and disable toggle job state", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"toggle-job",
			"--schedule",
			"* * * * *",
			"--command",
			"echo x",
			"--db",
			db,
		]);

		const disableResult = await runCli(["disable", "toggle-job", "--db", db]);
		expect(disableResult.exitCode).toBe(0);
		expect(disableResult.stdout).toContain("✓ Disabled: toggle-job");

		// Verify it shows as disabled in list
		const list1 = await runCli(["list", "--db", db]);
		expect(list1.stdout).toContain("disabled");

		const enableResult = await runCli(["enable", "toggle-job", "--db", db]);
		expect(enableResult.exitCode).toBe(0);
		expect(enableResult.stdout).toContain("✓ Enabled: toggle-job");
	});

	test("enable with missing name", async () => {
		const { stderr, exitCode } = await runCli(["enable"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Job name required");
	});

	test("disable with missing name", async () => {
		const { stderr, exitCode } = await runCli(["disable"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Job name required");
	});

	test("enable with unknown job", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli(["enable", "ghost", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Job "ghost" not found');
	});

	test("stats with empty db", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["stats", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Jobs:      0 total, 0 enabled");
		expect(stdout).toContain("0 successes, 0 failures");
	});

	test("stats after adding jobs", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"stat-job",
			"--schedule",
			"* * * * *",
			"--command",
			"echo x",
			"--db",
			db,
		]);
		const { stdout, exitCode } = await runCli(["stats", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Jobs:      1 total, 1 enabled");
	});

	test("history with no executions", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["history", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No execution history");
	});

	test("history shows executions after run", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"hist-job",
			"--schedule",
			"* * * * *",
			"--command",
			"echo hi",
			"--db",
			db,
		]);
		await runCli(["run", "hist-job", "--db", db]);
		const { stdout, exitCode } = await runCli(["history", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("hist-job");
		expect(stdout).toContain("success");
	});

	test("history with --job filter", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"a-job",
			"--schedule",
			"* * * * *",
			"--command",
			"echo a",
			"--db",
			db,
		]);
		await runCli([
			"add",
			"--name",
			"b-job",
			"--schedule",
			"* * * * *",
			"--command",
			"echo b",
			"--db",
			db,
		]);
		await runCli(["run", "a-job", "--db", db]);
		await runCli(["run", "b-job", "--db", db]);
		const { stdout, exitCode } = await runCli(["history", "--job", "a-job", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("a-job");
		expect(stdout).not.toContain("b-job");
	});

	test("history with unknown job name", async () => {
		const db = freshDb();
		const { stderr, exitCode } = await runCli(["history", "--job", "nope", "--db", db]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Job "nope" not found');
	});

	test("prune cleans old executions", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"prune-job",
			"--schedule",
			"* * * * *",
			"--command",
			"echo x",
			"--db",
			db,
		]);
		await runCli(["run", "prune-job", "--db", db]);
		// Prune with 0 days should remove the execution we just created
		const { stdout, exitCode } = await runCli(["prune", "--days", "0", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓ Pruned");
		expect(stdout).toContain("older than 0 days");
	});

	test("export with no jobs", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["export", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("# No jobs to export");
	});

	test("export produces YAML", async () => {
		const db = freshDb();
		await runCli([
			"add",
			"--name",
			"export-job",
			"--schedule",
			"0 */2 * * *",
			"--command",
			"echo exported",
			"--description",
			"test export",
			"--db",
			db,
		]);
		const { stdout, exitCode } = await runCli(["export", "--db", db]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("jobs:");
		expect(stdout).toContain("name: export-job");
		expect(stdout).toContain('schedule: "0 */2 * * *"');
		expect(stdout).toContain("command: echo exported");
		expect(stdout).toContain("description: test export");
	});

	test("CRONBASE_DB env var is used as default", async () => {
		const db = freshDb();
		await runCli(["add", "--name", "env-job", "--schedule", "* * * * *", "--command", "echo env"], {
			CRONBASE_DB: db,
		});
		const { stdout, exitCode } = await runCli(["list"], { CRONBASE_DB: db });
		expect(exitCode).toBe(0);
		expect(stdout).toContain("env-job");
	});

	test("init creates a config file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-init-test-"));
		const configPath = join(dir, "cronbase.yaml");
		const { stdout, exitCode } = await runCli(["init", "--path", configPath]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain(`✓ Created ${configPath}`);
		expect(stdout).toContain("Next steps:");
		expect(stdout).toContain("cronbase start --config");
		expect(stdout).toContain("CRONBASE_API_TOKEN");
		// Verify file contents
		const content = await Bun.file(configPath).text();
		expect(content).toContain("jobs:");
		expect(content).toContain("backup-db");
		expect(content).toContain("health-check");
		expect(content).toContain("cleanup-logs");
		expect(content).toContain("weekly-report");
		expect(content).toContain("CRONBASE_API_TOKEN");
		expect(content).toContain("on_failure");
		rmSync(dir, { recursive: true });
	});

	test("init refuses to overwrite existing file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-init-test-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(configPath, "existing content");
		const { stderr, exitCode } = await runCli(["init", "--path", configPath]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("already exists");
		expect(stderr).toContain("--force");
		// Verify original file is untouched
		const content = await Bun.file(configPath).text();
		expect(content).toBe("existing content");
		rmSync(dir, { recursive: true });
	});

	test("init with --force overwrites existing file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-init-test-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(configPath, "old content");
		const { stdout, exitCode } = await runCli(["init", "--path", configPath, "--force"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓ Created");
		const content = await Bun.file(configPath).text();
		expect(content).toContain("jobs:");
		expect(content).not.toContain("old content");
		rmSync(dir, { recursive: true });
	});
});

describe("--json output", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir && existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true });
		}
	});

	function freshDb(): string {
		tmpDir = mkdtempSync(join(tmpdir(), "cronbase-json-test-"));
		return join(tmpDir, "test.db");
	}

	async function addTestJob(db: string, name = "test-job") {
		await runCli([
			"add",
			"--name",
			name,
			"--schedule",
			"*/5 * * * *",
			"--command",
			"echo hello",
			"--description",
			"A test job",
			"--db",
			db,
		]);
	}

	test("list --json outputs valid JSON array", async () => {
		const db = freshDb();
		await addTestJob(db);
		const { stdout, exitCode } = await runCli(["list", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBe(1);
		expect(data[0].name).toBe("test-job");
		expect(data[0].schedule).toBe("*/5 * * * *");
		expect(data[0].command).toBe("echo hello");
		expect(data[0].description).toBe("A test job");
		expect(typeof data[0].id).toBe("number");
		expect(typeof data[0].enabled).toBe("boolean");
	});

	test("list --json with empty db outputs empty array", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["list", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toEqual([]);
	});

	test("list --output json works the same as --json", async () => {
		const db = freshDb();
		await addTestJob(db);
		const { stdout, exitCode } = await runCli(["list", "--output", "json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.length).toBe(1);
		expect(data[0].name).toBe("test-job");
	});

	test("history --json outputs valid JSON array", async () => {
		const db = freshDb();
		await addTestJob(db);
		await runCli(["run", "test-job", "--db", db]);
		const { stdout, exitCode } = await runCli(["history", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBe(1);
		expect(data[0].jobName).toBe("test-job");
		expect(data[0].status).toBe("success");
		expect(typeof data[0].durationMs).toBe("number");
		expect(data[0].exitCode).toBe(0);
	});

	test("history --json with empty db outputs empty array", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["history", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toEqual([]);
	});

	test("stats --json outputs valid JSON object", async () => {
		const db = freshDb();
		await addTestJob(db);
		await runCli(["run", "test-job", "--db", db]);
		const { stdout, exitCode } = await runCli(["stats", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.totalJobs).toBe(1);
		expect(data.enabledJobs).toBe(1);
		expect(data.recentSuccesses).toBe(1);
		expect(data.recentFailures).toBe(0);
		expect(data.successRate).toBe(100);
	});

	test("stats --json with no executions has null successRate", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["stats", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.totalJobs).toBe(0);
		expect(data.successRate).toBeNull();
	});

	test("run --json outputs execution result", async () => {
		const db = freshDb();
		await addTestJob(db);
		const { stdout, exitCode } = await runCli(["run", "test-job", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.status).toBe("success");
		expect(data.exitCode).toBe(0);
		expect(typeof data.durationMs).toBe("number");
		expect(data.stdout).toContain("hello");
	});

	test("export --json outputs JSON config", async () => {
		const db = freshDb();
		await addTestJob(db);
		const { stdout, exitCode } = await runCli(["export", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.jobs).toBeDefined();
		expect(data.jobs.length).toBe(1);
		expect(data.jobs[0].name).toBe("test-job");
		expect(data.jobs[0].schedule).toBe("*/5 * * * *");
		expect(data.jobs[0].command).toBe("echo hello");
		expect(data.jobs[0].description).toBe("A test job");
	});

	test("export --json with empty db outputs empty jobs array", async () => {
		const db = freshDb();
		const { stdout, exitCode } = await runCli(["export", "--json", "--db", db]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toEqual({ jobs: [] });
	});
});

describe("validate", () => {
	test("validates a valid config file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-validate-test-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(
			configPath,
			`jobs:
  - name: backup
    schedule: "0 2 * * *"
    command: pg_dump mydb
  - name: health-check
    schedule: "*/5 * * * *"
    command: curl -sf http://example.com/health
`,
		);
		const { stdout, exitCode } = await runCli(["validate", "--path", configPath]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("✓");
		expect(stdout).toContain("valid");
		expect(stdout).toContain("2 jobs");
		rmSync(dir, { recursive: true });
	});

	test("reports error for invalid schedule", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-validate-test-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(
			configPath,
			`jobs:
  - name: bad-job
    schedule: "not-a-cron"
    command: echo hello
`,
		);
		const { stderr, exitCode } = await runCli(["validate", "--path", configPath]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("bad-job");
		expect(stderr).toContain("schedule");
		rmSync(dir, { recursive: true });
	});

	test("reports error for missing required fields", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-validate-test-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(
			configPath,
			`jobs:
  - name: incomplete-job
    schedule: "* * * * *"
`,
		);
		const { stderr, exitCode } = await runCli(["validate", "--path", configPath]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("command");
		rmSync(dir, { recursive: true });
	});

	test("reports error for missing config file", async () => {
		const { stderr, exitCode } = await runCli(["validate", "--path", "/nonexistent/cronbase.yaml"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("not found");
		rmSync;
	});

	test("reports duplicate job names", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-validate-test-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(
			configPath,
			`jobs:
  - name: my-job
    schedule: "* * * * *"
    command: echo first
  - name: my-job
    schedule: "* * * * *"
    command: echo second
`,
		);
		const { stderr, exitCode } = await runCli(["validate", "--path", configPath]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("my-job");
		expect(stderr).toContain("Duplicate");
		rmSync(dir, { recursive: true });
	});
});

/**
 * In-process tests via runCommand() — these exercise the same code paths as
 * the subprocess tests above, but run in the test process so bun's coverage
 * tool can track line execution.
 */
describe("runCommand (in-process)", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir && existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true });
		}
	});

	function freshDb(): string {
		tmpDir = mkdtempSync(join(tmpdir(), "cronbase-inproc-test-"));
		return join(tmpDir, "test.db");
	}

	test("version returns 0", async () => {
		const code = await runCommand("version", {}, []);
		expect(code).toBe(0);
	});

	test("--version flag returns 0", async () => {
		const code = await runCommand("anything", { version: "true" }, []);
		expect(code).toBe(0);
	});

	test("help returns 0", async () => {
		const code = await runCommand("help", {}, []);
		expect(code).toBe(0);
	});

	test("--help returns 0", async () => {
		const code = await runCommand("--help", {}, []);
		expect(code).toBe(0);
	});

	test("unknown command returns 1", async () => {
		const code = await runCommand("bogus", {}, []);
		expect(code).toBe(1);
	});

	test("add with missing fields returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("add", { name: "test", db }, []);
		expect(code).toBe(1);
	});

	test("add creates a job", async () => {
		const db = freshDb();
		const code = await runCommand(
			"add",
			{ name: "my-job", schedule: "*/5 * * * *", command: "echo hello", db },
			[],
		);
		expect(code).toBe(0);
	});

	test("add with invalid schedule returns 1", async () => {
		const db = freshDb();
		const code = await runCommand(
			"add",
			{ name: "bad", schedule: "not-cron", command: "echo x", db },
			[],
		);
		expect(code).toBe(1);
	});

	test("add duplicate name returns 1", async () => {
		const db = freshDb();
		await runCommand("add", { name: "dup", schedule: "* * * * *", command: "echo 1", db }, []);
		const code = await runCommand(
			"add",
			{ name: "dup", schedule: "* * * * *", command: "echo 2", db },
			[],
		);
		expect(code).toBe(1);
	});

	test("add with retries", async () => {
		const db = freshDb();
		const code = await runCommand(
			"add",
			{
				name: "retry-job",
				schedule: "0 * * * *",
				command: "echo retry",
				retries: "3",
				"retry-delay": "10",
				db,
			},
			[],
		);
		expect(code).toBe(0);
	});

	test("add with timeout and description", async () => {
		const db = freshDb();
		const code = await runCommand(
			"add",
			{
				name: "detailed",
				schedule: "0 * * * *",
				command: "date",
				timeout: "60",
				description: "A test job",
				db,
			},
			[],
		);
		expect(code).toBe(0);
	});

	test("add with --disabled", async () => {
		const db = freshDb();
		const code = await runCommand(
			"add",
			{ name: "dis", schedule: "0 * * * *", command: "echo x", disabled: "true", db },
			[],
		);
		expect(code).toBe(0);
	});

	test("list with no jobs", async () => {
		const db = freshDb();
		const code = await runCommand("list", { db }, []);
		expect(code).toBe(0);
	});

	test("list with jobs", async () => {
		const db = freshDb();
		await runCommand("add", { name: "j1", schedule: "* * * * *", command: "echo a", db }, []);
		await runCommand("add", { name: "j2", schedule: "0 * * * *", command: "echo b", db }, []);
		const code = await runCommand("list", { db }, []);
		expect(code).toBe(0);
	});

	test("list --json", async () => {
		const db = freshDb();
		await runCommand("add", { name: "j1", schedule: "* * * * *", command: "echo a", db }, []);
		const code = await runCommand("list", { json: "true", db }, []);
		expect(code).toBe(0);
	});

	test("run executes a job", async () => {
		const db = freshDb();
		await runCommand(
			"add",
			{ name: "echo-job", schedule: "* * * * *", command: "echo hello-world", db },
			[],
		);
		const code = await runCommand("run", { db }, ["echo-job"]);
		expect(code).toBe(0);
	});

	test("run with failing command returns 1", async () => {
		const db = freshDb();
		await runCommand(
			"add",
			{ name: "fail-job", schedule: "* * * * *", command: "exit 42", db },
			[],
		);
		const code = await runCommand("run", { db }, ["fail-job"]);
		expect(code).toBe(1);
	});

	test("run --json", async () => {
		const db = freshDb();
		await runCommand(
			"add",
			{ name: "json-run", schedule: "* * * * *", command: "echo hi", db },
			[],
		);
		const code = await runCommand("run", { json: "true", db }, ["json-run"]);
		expect(code).toBe(0);
	});

	test("run with missing name returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("run", { db }, []);
		expect(code).toBe(1);
	});

	test("run with unknown job returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("run", { db }, ["nonexistent"]);
		expect(code).toBe(1);
	});

	test("remove deletes a job", async () => {
		const db = freshDb();
		await runCommand(
			"add",
			{ name: "to-remove", schedule: "* * * * *", command: "echo x", db },
			[],
		);
		const code = await runCommand("remove", { db }, ["to-remove"]);
		expect(code).toBe(0);
	});

	test("remove with missing name returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("remove", { db }, []);
		expect(code).toBe(1);
	});

	test("remove unknown job returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("remove", { db }, ["ghost"]);
		expect(code).toBe(1);
	});

	test("enable and disable", async () => {
		const db = freshDb();
		await runCommand("add", { name: "toggle", schedule: "* * * * *", command: "echo x", db }, []);
		expect(await runCommand("disable", { db }, ["toggle"])).toBe(0);
		expect(await runCommand("enable", { db }, ["toggle"])).toBe(0);
	});

	test("enable with missing name returns 1", async () => {
		const code = await runCommand("enable", {}, []);
		expect(code).toBe(1);
	});

	test("disable with missing name returns 1", async () => {
		const code = await runCommand("disable", {}, []);
		expect(code).toBe(1);
	});

	test("enable unknown job returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("enable", { db }, ["ghost"]);
		expect(code).toBe(1);
	});

	test("disable unknown job returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("disable", { db }, ["ghost"]);
		expect(code).toBe(1);
	});

	test("stats with empty db", async () => {
		const db = freshDb();
		const code = await runCommand("stats", { db }, []);
		expect(code).toBe(0);
	});

	test("stats after adding jobs", async () => {
		const db = freshDb();
		await runCommand("add", { name: "s1", schedule: "* * * * *", command: "echo x", db }, []);
		const code = await runCommand("stats", { db }, []);
		expect(code).toBe(0);
	});

	test("stats --json", async () => {
		const db = freshDb();
		await runCommand("add", { name: "s1", schedule: "* * * * *", command: "echo x", db }, []);
		await runCommand("run", { db }, ["s1"]);
		const code = await runCommand("stats", { json: "true", db }, []);
		expect(code).toBe(0);
	});

	test("stats --json with no executions", async () => {
		const db = freshDb();
		const code = await runCommand("stats", { json: "true", db }, []);
		expect(code).toBe(0);
	});

	test("history with no executions", async () => {
		const db = freshDb();
		const code = await runCommand("history", { db }, []);
		expect(code).toBe(0);
	});

	test("history after run", async () => {
		const db = freshDb();
		await runCommand("add", { name: "h1", schedule: "* * * * *", command: "echo hi", db }, []);
		await runCommand("run", { db }, ["h1"]);
		const code = await runCommand("history", { db }, []);
		expect(code).toBe(0);
	});

	test("history --json", async () => {
		const db = freshDb();
		await runCommand("add", { name: "h1", schedule: "* * * * *", command: "echo hi", db }, []);
		await runCommand("run", { db }, ["h1"]);
		const code = await runCommand("history", { json: "true", db }, []);
		expect(code).toBe(0);
	});

	test("history --job filter", async () => {
		const db = freshDb();
		await runCommand("add", { name: "a", schedule: "* * * * *", command: "echo a", db }, []);
		await runCommand("run", { db }, ["a"]);
		const code = await runCommand("history", { job: "a", db }, []);
		expect(code).toBe(0);
	});

	test("history --job unknown returns 1", async () => {
		const db = freshDb();
		const code = await runCommand("history", { job: "nope", db }, []);
		expect(code).toBe(1);
	});

	test("prune", async () => {
		const db = freshDb();
		await runCommand("add", { name: "p1", schedule: "* * * * *", command: "echo x", db }, []);
		await runCommand("run", { db }, ["p1"]);
		const code = await runCommand("prune", { days: "0", db }, []);
		expect(code).toBe(0);
	});

	test("export with no jobs", async () => {
		const db = freshDb();
		const code = await runCommand("export", { db }, []);
		expect(code).toBe(0);
	});

	test("export produces YAML", async () => {
		const db = freshDb();
		await runCommand(
			"add",
			{
				name: "exp",
				schedule: "0 */2 * * *",
				command: "echo exported",
				description: "test export",
				db,
			},
			[],
		);
		const code = await runCommand("export", { db }, []);
		expect(code).toBe(0);
	});

	test("export --json", async () => {
		const db = freshDb();
		await runCommand("add", { name: "exp", schedule: "* * * * *", command: "echo x", db }, []);
		const code = await runCommand("export", { json: "true", db }, []);
		expect(code).toBe(0);
	});

	test("export --json with no jobs", async () => {
		const db = freshDb();
		const code = await runCommand("export", { json: "true", db }, []);
		expect(code).toBe(0);
	});

	test("init creates config file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-init-inproc-"));
		const configPath = join(dir, "cronbase.yaml");
		const code = await runCommand("init", { path: configPath }, []);
		expect(code).toBe(0);
		expect(existsSync(configPath)).toBe(true);
		rmSync(dir, { recursive: true });
	});

	test("init refuses overwrite", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-init-inproc-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(configPath, "existing");
		const code = await runCommand("init", { path: configPath }, []);
		expect(code).toBe(1);
		rmSync(dir, { recursive: true });
	});

	test("init --force overwrites", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-init-inproc-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(configPath, "old");
		const code = await runCommand("init", { path: configPath, force: "true" }, []);
		expect(code).toBe(0);
		const content = await Bun.file(configPath).text();
		expect(content).toContain("jobs:");
		rmSync(dir, { recursive: true });
	});

	test("validate valid config", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-validate-inproc-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(
			configPath,
			`jobs:\n  - name: test\n    schedule: "* * * * *"\n    command: echo hi\n`,
		);
		const code = await runCommand("validate", { path: configPath }, []);
		expect(code).toBe(0);
		rmSync(dir, { recursive: true });
	});

	test("validate invalid config returns 1", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cronbase-validate-inproc-"));
		const configPath = join(dir, "cronbase.yaml");
		await Bun.write(configPath, `jobs:\n  - name: test\n    schedule: "bad"\n    command: echo\n`);
		const code = await runCommand("validate", { path: configPath }, []);
		expect(code).toBe(1);
		rmSync(dir, { recursive: true });
	});

	test("validate missing file returns 1", async () => {
		const code = await runCommand("validate", { path: "/nonexistent/cronbase.yaml" }, []);
		expect(code).toBe(1);
	});
});
