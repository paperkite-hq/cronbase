import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { loadConfigFile, parseSimpleYaml } from "../src/config";
import { Store } from "../src/store";

const TEST_DB = "/tmp/cronbase-config-test.db";
const TEST_CONFIG = "/tmp/cronbase-test-config.yaml";

function cleanupDb() {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(TEST_DB + suffix);
		} catch {
			/* doesn't exist */
		}
	}
}

function cleanupConfig() {
	try {
		unlinkSync(TEST_CONFIG);
	} catch {
		/* doesn't exist */
	}
}

describe("parseSimpleYaml", () => {
	test("parses basic YAML config", () => {
		const yaml = `
jobs:
  - name: backup
    schedule: "0 2 * * *"
    command: pg_dump mydb > /backups/db.sql
    timeout: 300
    description: Daily database backup

  - name: cleanup
    schedule: "@daily"
    command: find /var/log -name '*.gz' -mtime +30 -delete
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(2);
		expect(result.jobs?.[0].name).toBe("backup");
		expect(result.jobs?.[0].schedule).toBe("0 2 * * *");
		expect(result.jobs?.[0].command).toBe("pg_dump mydb > /backups/db.sql");
		expect(result.jobs?.[0].timeout).toBe(300);
		expect(result.jobs?.[1].name).toBe("cleanup");
		expect(result.jobs?.[1].schedule).toBe("@daily");
	});

	test("parses JSON config", () => {
		const json = JSON.stringify({
			jobs: [
				{
					name: "test-job",
					schedule: "*/5 * * * *",
					command: "echo hello",
				},
			],
		});
		const result = parseSimpleYaml(json);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs?.[0].name).toBe("test-job");
	});

	test("handles comments", () => {
		const yaml = `
# Main config
jobs:
  - name: backup # database backup
    schedule: "0 2 * * *"
    command: echo hello
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs?.[0].name).toBe("backup");
	});

	test("parses boolean and numeric values", () => {
		const yaml = `
jobs:
  - name: test
    schedule: "@daily"
    command: echo test
    timeout: 60
    enabled: false
    retries: 3
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs?.[0].timeout).toBe(60);
		expect(result.jobs?.[0].enabled).toBe(false);
		expect(result.jobs?.[0].retries).toBe(3);
	});

	test("parses retry object block", () => {
		const yaml = `
jobs:
  - name: test
    schedule: "@daily"
    command: echo test
    retry:
      maxAttempts: 3
      baseDelay: 60
    description: with retry
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs?.[0].retry).toEqual({ maxAttempts: 3, baseDelay: 60 });
		expect(result.jobs?.[0].description).toBe("with retry");
	});

	test("parses retry object with only maxAttempts", () => {
		const yaml = `
jobs:
  - name: test
    schedule: "@daily"
    command: echo test
    retry:
      maxAttempts: 2
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs?.[0].retry).toEqual({ maxAttempts: 2 });
	});

	test("parses webhook alert URLs", () => {
		const yaml = `
jobs:
  - name: critical-job
    schedule: "@hourly"
    command: check-service
    on_failure: https://hooks.slack.com/services/xxx
    on_success: https://discord.com/api/webhooks/yyy
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs?.[0].on_failure).toBe("https://hooks.slack.com/services/xxx");
		expect(result.jobs?.[0].on_success).toBe("https://discord.com/api/webhooks/yyy");
	});

	test("parses inline tags array", () => {
		const yaml = `
jobs:
  - name: tagged
    schedule: "@daily"
    command: echo test
    tags: [production, database, critical]
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs?.[0].tags).toEqual(["production", "database", "critical"]);
	});

	test("rejects malformed inline tags array missing closing bracket", () => {
		const yaml = `
jobs:
  - name: broken
    schedule: "@daily"
    command: echo test
    tags: [production, database
`;
		expect(() => parseSimpleYaml(yaml)).toThrow("missing closing bracket");
	});

	test("parses literal block scalar (|) for multiline commands", () => {
		const yaml = `
jobs:
  - name: multiline
    schedule: "0 9 * * 1"
    command: |
      openssl s_client -connect myapp.com:443 </dev/null 2>/dev/null |
      openssl x509 -noout -dates
    description: Weekly cert check
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs?.[0].command).toBe(
			"openssl s_client -connect myapp.com:443 </dev/null 2>/dev/null |\nopenssl x509 -noout -dates",
		);
		expect(result.jobs?.[0].description).toBe("Weekly cert check");
	});

	test("parses folded block scalar (>) for multiline commands", () => {
		const yaml = `
jobs:
  - name: folded
    schedule: "@daily"
    command: >
      echo hello
      world
    description: Folded command
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs?.[0].command).toBe("echo hello world");
		expect(result.jobs?.[0].description).toBe("Folded command");
	});

	test("block scalar as last property of last job", () => {
		const yaml = `
jobs:
  - name: last-block
    schedule: "@daily"
    command: |
      line1
      line2
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs?.[0].command).toBe("line1\nline2");
	});

	test("block scalar preserves indentation beyond base level", () => {
		const yaml = `
jobs:
  - name: indented
    schedule: "@daily"
    command: |
      if true; then
        echo nested
      fi
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs?.[0].command).toBe("if true; then\n  echo nested\nfi");
	});
});

describe("loadConfigFile", () => {
	let store: Store;

	beforeEach(() => {
		cleanupDb();
		cleanupConfig();
		store = new Store(TEST_DB);
	});

	afterEach(() => {
		store.close();
		cleanupDb();
		cleanupConfig();
	});

	test("loads jobs from YAML file", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: test-job-1
    schedule: "*/5 * * * *"
    command: echo hello

  - name: test-job-2
    schedule: "@daily"
    command: echo world
    description: Second test job
`,
		);

		const result = loadConfigFile(TEST_CONFIG, store);
		expect(result.added).toBe(2);
		expect(result.updated).toBe(0);

		const jobs = store.listJobs();
		expect(jobs).toHaveLength(2);
		expect(jobs.find((j) => j.name === "test-job-1")).toBeTruthy();
		expect(jobs.find((j) => j.name === "test-job-2")).toBeTruthy();
	});

	test("updates existing jobs on reload", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: my-job
    schedule: "@hourly"
    command: echo v1
`,
		);

		loadConfigFile(TEST_CONFIG, store);
		expect(store.listJobs()).toHaveLength(1);
		expect(store.getJobByName("my-job")?.command).toBe("echo v1");

		// Update the config
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: my-job
    schedule: "@hourly"
    command: echo v2
`,
		);

		const result = loadConfigFile(TEST_CONFIG, store);
		expect(result.added).toBe(0);
		expect(result.updated).toBe(1);
		expect(store.getJobByName("my-job")?.command).toBe("echo v2");
	});

	test("loads jobs from JSON file", () => {
		writeFileSync(
			TEST_CONFIG,
			JSON.stringify({
				jobs: [
					{
						name: "json-job",
						schedule: "0 * * * *",
						command: "echo json",
					},
				],
			}),
		);

		const result = loadConfigFile(TEST_CONFIG, store);
		expect(result.added).toBe(1);
	});

	test("throws on missing file", () => {
		expect(() => loadConfigFile("/tmp/nonexistent.yaml", store)).toThrow("Config file not found");
	});

	test("throws on missing required fields", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: incomplete
    schedule: "@daily"
`,
		);

		expect(() => loadConfigFile(TEST_CONFIG, store)).toThrow("missing required field(s): command");
	});

	test("throws on duplicate job names", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: dup-job
    schedule: "@daily"
    command: echo first
  - name: dup-job
    schedule: "@hourly"
    command: echo second
`,
		);

		expect(() => loadConfigFile(TEST_CONFIG, store)).toThrow("Duplicate job name");
	});

	test("throws on invalid cron expression", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: bad-cron
    schedule: "invalid"
    command: echo test
`,
		);

		expect(() => loadConfigFile(TEST_CONFIG, store)).toThrow();
	});

	test("sets alert config when on_failure/on_success specified", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: alerted-job
    schedule: "@daily"
    command: echo test
    on_failure: https://hooks.slack.com/services/xxx
`,
		);

		loadConfigFile(TEST_CONFIG, store);
		const job = store.getJobByName("alerted-job") as NonNullable<
			ReturnType<typeof store.getJobByName>
		>;
		const alerts = store.getJobAlert(job.id);
		expect(alerts).not.toBeNull();
		expect(alerts?.webhooks).toHaveLength(1);
		expect(alerts?.webhooks[0].url).toBe("https://hooks.slack.com/services/xxx");
		expect(alerts?.webhooks[0].events).toContain("failed");
	});

	test("rejects invalid webhook URL in on_failure", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: bad-webhook
    schedule: "@daily"
    command: echo test
    on_failure: ftp://evil.example.com/hook
`,
		);

		expect(() => loadConfigFile(TEST_CONFIG, store)).toThrow("http or https");
	});

	test("rejects invalid webhook URL in on_success", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: bad-webhook
    schedule: "@daily"
    command: echo test
    on_success: not-a-url
`,
		);

		expect(() => loadConfigFile(TEST_CONFIG, store)).toThrow("Invalid webhook URL");
	});

	test("rejects invalid webhook URL in on_complete", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: bad-webhook
    schedule: "@daily"
    command: echo test
    on_complete: file:///etc/passwd
`,
		);

		expect(() => loadConfigFile(TEST_CONFIG, store)).toThrow("http or https");
	});

	test("validates job config fields from config file", () => {
		writeFileSync(
			TEST_CONFIG,
			JSON.stringify({
				jobs: [
					{
						name: "invalid name with spaces!",
						schedule: "* * * * *",
						command: "echo test",
					},
				],
			}),
		);

		expect(() => loadConfigFile(TEST_CONFIG, store)).toThrow("Job name must start with");
	});

	test("env block does not consume subsequent job properties", () => {
		const yaml = `
jobs:
  - name: env-leak-test
    schedule: "* * * * *"
    command: echo hello
    env:
      FOO: bar
      BAZ: qux
    timeout: 300
    description: should not be eaten by env
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(1);
		const job = result.jobs?.[0];
		expect(job?.env).toEqual({ FOO: "bar", BAZ: "qux" });
		expect(job?.timeout).toBe(300);
		expect(job?.description).toBe("should not be eaten by env");
	});

	test("tags block does not consume subsequent job properties", () => {
		const yaml = `
jobs:
  - name: tags-leak-test
    schedule: "0 * * * *"
    command: echo hi
    tags:
      - web
      - prod
    timeout: 60
    description: after tags
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(1);
		const job = result.jobs?.[0];
		expect(job?.tags).toEqual(["web", "prod"]);
		expect(job?.timeout).toBe(60);
		expect(job?.description).toBe("after tags");
	});

	test("retry block does not consume subsequent job properties", () => {
		const yaml = `
jobs:
  - name: retry-leak-test
    schedule: "0 * * * *"
    command: echo hi
    retry:
      maxAttempts: 3
      baseDelay: 45
    timeout: 60
    description: after retry
`;
		const result = parseSimpleYaml(yaml);
		expect(result.jobs).toHaveLength(1);
		const job = result.jobs?.[0];
		expect(job?.retry).toEqual({ maxAttempts: 3, baseDelay: 45 });
		expect(job?.timeout).toBe(60);
		expect(job?.description).toBe("after retry");
	});

	test("loadConfigFile handles modern retry object from YAML", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: retry-test
    schedule: "* * * * *"
    command: echo test
    retry:
      maxAttempts: 3
      baseDelay: 45
`,
		);
		const store = new Store(TEST_DB);
		loadConfigFile(TEST_CONFIG, store);
		const job = store.getJobByName("retry-test");
		expect(job).toBeTruthy();
		expect(job?.retry.maxAttempts).toBe(3);
		expect(job?.retry.baseDelay).toBe(45);
		store.close();
	});

	test("loadConfigFile handles legacy retries/retry_delay from YAML", () => {
		writeFileSync(
			TEST_CONFIG,
			`
jobs:
  - name: legacy-retry-test
    schedule: "* * * * *"
    command: echo test
    retries: 2
    retry_delay: 60
`,
		);
		const store = new Store(TEST_DB);
		loadConfigFile(TEST_CONFIG, store);
		const job = store.getJobByName("legacy-retry-test");
		expect(job).toBeTruthy();
		expect(job?.retry.maxAttempts).toBe(2);
		expect(job?.retry.baseDelay).toBe(60);
		store.close();
	});
});

describe("export/import round-trip", () => {
	beforeEach(() => {
		cleanupDb();
		cleanupConfig();
	});

	afterEach(() => {
		cleanupDb();
		cleanupConfig();
	});

	test("exported YAML with multiline commands can be re-imported", () => {
		// Simulate what export would produce for a multiline command
		const exportedYaml = `jobs:
  - name: backup-db
    schedule: "0 2 * * *"
    command: |
      pg_dump mydb |
      gzip > /backups/db.sql.gz
    timeout: 300
    description: Nightly backup
`;
		writeFileSync(TEST_CONFIG, exportedYaml);
		const store = new Store(TEST_DB);
		const result = loadConfigFile(TEST_CONFIG, store);
		expect(result.added).toBe(1);
		const job = store.getJobByName("backup-db");
		expect(job).toBeTruthy();
		expect(job?.command).toBe("pg_dump mydb |\ngzip > /backups/db.sql.gz");
		expect(job?.timeout).toBe(300);
		store.close();
	});
});

describe("loadConfigFile alert clearing", () => {
	beforeEach(() => {
		cleanupDb();
		cleanupConfig();
	});

	afterEach(() => {
		cleanupDb();
		cleanupConfig();
	});

	test("removes alerts when webhook config is removed from updated job", () => {
		const store = new Store(TEST_DB);

		// First load: job with on_failure webhook
		writeFileSync(
			TEST_CONFIG,
			`jobs:
  - name: alert-clear-test
    schedule: "0 * * * *"
    command: echo hi
    on_failure: https://hooks.slack.com/test
`,
		);
		loadConfigFile(TEST_CONFIG, store);

		// Verify alert exists
		const job = store.getJobByName("alert-clear-test");
		expect(job).toBeTruthy();
		const alert = store.getJobAlert(job!.id);
		expect(alert).toBeTruthy();
		expect(alert!.webhooks).toHaveLength(1);

		// Second load: same job without webhook — alerts should be cleared
		writeFileSync(
			TEST_CONFIG,
			`jobs:
  - name: alert-clear-test
    schedule: "0 * * * *"
    command: echo hi
`,
		);
		loadConfigFile(TEST_CONFIG, store);

		const alertAfter = store.getJobAlert(job!.id);
		// Alert should be removed (null or empty webhooks)
		expect(alertAfter).toBeNull();

		store.close();
	});
});
