/**
 * cronbase — Beautiful self-hosted cron job manager
 *
 * @example
 * ```typescript
 * import { Scheduler, Store } from "cronbase";
 *
 * const scheduler = new Scheduler({ dbPath: "./my-jobs.db" });
 *
 * scheduler.getStore().addJob({
 *   name: "backup",
 *   schedule: "@daily",
 *   command: "pg_dump mydb > /backups/$(date +%Y%m%d).sql",
 *   timeout: 300,
 *   retry: { maxAttempts: 2, baseDelay: 60 },
 * });
 *
 * scheduler.start();
 * ```
 */

export type { AlertPayload } from "./alerts";
export { fireAlerts, formatDiscord, formatSlack, processAlerts } from "./alerts";
export { loadConfigFile } from "./config";
export { describeCron, getNextRun, parseCron } from "./cron";
export { executeJob } from "./executor";
export type { LogLevel } from "./logger";
export { getLogLevel, logger, setJsonFormat, setLogLevel } from "./logger";
export { Scheduler } from "./scheduler";
export { createServer } from "./server";
export { Store } from "./store";
export type {
	AlertConfig,
	Execution,
	ExecutionStatus,
	Job,
	JobConfig,
	ParsedCron,
	RetryConfig,
	SchedulerOptions,
	WebhookConfig,
} from "./types";
export { VERSION } from "./types";
export type { ValidationError } from "./validation";
export {
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
} from "./validation";
