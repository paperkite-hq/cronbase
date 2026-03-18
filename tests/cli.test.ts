import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli";

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
		// Verify file contents
		const content = await Bun.file(configPath).text();
		expect(content).toContain("jobs:");
		expect(content).toContain("backup-db");
		expect(content).toContain("health-check");
		expect(content).toContain("cleanup-logs");
		expect(content).toContain("weekly-report");
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
