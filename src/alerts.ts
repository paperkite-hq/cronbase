/**
 * Alerting system for cronbase.
 *
 * Fires webhook notifications on job success/failure.
 * Includes pre-built formatters for Slack and Discord.
 */

import { logger } from "./logger";
import { formatEmailBody, formatEmailSubject, getSmtpOptions, sendEmail } from "./smtp";
import type { Store } from "./store";
import type { AlertConfig, Execution, ExecutionStatus, Job } from "./types";

/** Escape Slack mrkdwn special characters to prevent injection via job names or output. */
function escSlack(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape Discord markdown to prevent injection (backtick breakout, @mentions, links). */
function escDiscord(s: string): string {
	return s.replace(/`/g, "\u02CB").replace(/@/g, "@\u200B");
}

/** Payload sent to webhook endpoints. */
export interface AlertPayload {
	/** Event type */
	event: "success" | "failed" | "timeout";
	/** Job details */
	job: {
		id: number;
		name: string;
		schedule: string;
		command: string;
	};
	/** Execution details */
	execution: {
		id: number;
		status: ExecutionStatus;
		exitCode: number | null;
		durationMs: number | null;
		startedAt: string;
		finishedAt: string | null;
		/** Last 500 chars of stdout */
		stdoutTail: string;
		/** Last 500 chars of stderr */
		stderrTail: string;
		attempt: number;
	};
	/** ISO 8601 timestamp */
	timestamp: string;
}

/** Format a webhook payload for Slack Block Kit. */
export function formatSlack(payload: AlertPayload): object {
	const emoji = payload.event === "success" ? ":white_check_mark:" : ":x:";
	const color = payload.event === "success" ? "#22c55e" : "#ef4444";
	const duration = payload.execution.durationMs
		? `${(payload.execution.durationMs / 1000).toFixed(1)}s`
		: "—";

	const blocks = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `${emoji} *cronbase: ${escSlack(payload.job.name)}* — ${payload.event}`,
			},
		},
		{
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*Schedule:*\n\`${escSlack(payload.job.schedule)}\`` },
				{ type: "mrkdwn", text: `*Duration:*\n${duration}` },
				{
					type: "mrkdwn",
					text: `*Exit Code:*\n${payload.execution.exitCode ?? "—"}`,
				},
				{
					type: "mrkdwn",
					text: `*Attempt:*\n${payload.execution.attempt + 1}`,
				},
			],
		},
	];

	// Add stderr tail if present (failure context)
	if (payload.execution.stderrTail) {
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*stderr:*\n\`\`\`${escSlack(payload.execution.stderrTail)}\`\`\``,
			},
			fields: undefined as never,
		});
	}

	return {
		attachments: [
			{
				color,
				blocks,
			},
		],
	};
}

/** Format a webhook payload for Discord embeds. */
export function formatDiscord(payload: AlertPayload): object {
	const emoji = payload.event === "success" ? "\u2705" : "\u274c";
	const color = payload.event === "success" ? 0x22c55e : 0xef4444;
	const duration = payload.execution.durationMs
		? `${(payload.execution.durationMs / 1000).toFixed(1)}s`
		: "\u2014";

	const fields = [
		{ name: "Schedule", value: `\`${escDiscord(payload.job.schedule)}\``, inline: true },
		{ name: "Duration", value: duration, inline: true },
		{ name: "Exit Code", value: `${payload.execution.exitCode ?? "\u2014"}`, inline: true },
	];

	if (payload.execution.stderrTail) {
		fields.push({
			name: "stderr",
			value: `\`\`\`${escDiscord(payload.execution.stderrTail.slice(0, 1000))}\`\`\``,
			inline: false,
		});
	}

	return {
		embeds: [
			{
				title: `${emoji} ${escDiscord(payload.job.name)} \u2014 ${payload.event}`,
				color,
				fields,
				footer: { text: "cronbase" },
				timestamp: payload.timestamp,
			},
		],
	};
}

/** Build an alert payload from a job and execution. */
function buildPayload(job: Job, execution: Execution): AlertPayload {
	const event: AlertPayload["event"] =
		execution.status === "success"
			? "success"
			: execution.status === "timeout"
				? "timeout"
				: "failed";

	return {
		event,
		job: {
			id: job.id,
			name: job.name,
			schedule: job.schedule,
			command: job.command,
		},
		execution: {
			id: execution.id,
			status: execution.status,
			exitCode: execution.exitCode,
			durationMs: execution.durationMs,
			startedAt: execution.startedAt,
			finishedAt: execution.finishedAt,
			stdoutTail: (execution.stdout ?? "").slice(-500),
			stderrTail: (execution.stderr ?? "").slice(-500),
			attempt: execution.attempt,
		},
		timestamp: new Date().toISOString(),
	};
}

/** Detect webhook type from URL and format accordingly. */
function formatPayload(url: string, payload: AlertPayload): object {
	if (url.includes("hooks.slack.com") || url.includes("slack.com/api")) {
		return formatSlack(payload);
	}
	if (url.includes("discord.com/api/webhooks") || url.includes("discordapp.com/api/webhooks")) {
		return formatDiscord(payload);
	}
	// Generic JSON payload
	return payload;
}

/** Maximum backoff delay for webhook retries (30 seconds). */
const MAX_WEBHOOK_BACKOFF_MS = 30_000;

/** Send a single webhook request. Returns true on success (2xx), false otherwise. */
async function sendWebhook(url: string, body: object): Promise<boolean> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10_000), // 10s timeout for webhook
	});
	return response.ok;
}

/** Fire webhooks for a completed execution. Retries failed deliveries with exponential backoff. */
export async function fireAlerts(
	job: Job,
	execution: Execution,
	alertConfig: AlertConfig,
): Promise<void> {
	const payload = buildPayload(job, execution);
	const event = payload.event;

	for (const webhook of alertConfig.webhooks) {
		// Check if this webhook cares about this event
		if (!webhook.events.includes(event)) continue;

		const maxAttempts = 1 + (webhook.retryAttempts ?? 2);
		const baseDelay = webhook.retryDelayMs ?? 1000;
		const body = formatPayload(webhook.url, payload);

		let delivered = false;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			// Backoff delay on retries (capped at MAX_WEBHOOK_BACKOFF_MS)
			if (attempt > 0) {
				const delay = Math.min(baseDelay * 2 ** (attempt - 1), MAX_WEBHOOK_BACKOFF_MS);
				await new Promise((resolve) => setTimeout(resolve, delay));
				logger.info(`Retrying webhook for ${job.name} (attempt ${attempt + 1}/${maxAttempts})`);
			}

			try {
				delivered = await sendWebhook(webhook.url, body);
				if (delivered) break;

				logger.error(
					`Alert webhook non-OK response for ${job.name} (attempt ${attempt + 1}/${maxAttempts})`,
				);
			} catch (error) {
				logger.error(
					`Alert webhook error for ${job.name} (attempt ${attempt + 1}/${maxAttempts})`,
					{ error: error instanceof Error ? error.message : String(error) },
				);
			}
		}

		if (!delivered) {
			logger.error(
				`Alert webhook permanently failed for ${job.name} after ${maxAttempts} attempt(s): ${webhook.url}`,
			);
		}
	}
}

/** Fire email alerts for a completed execution. */
export async function fireEmailAlerts(
	job: Job,
	execution: Execution,
	alertConfig: AlertConfig,
): Promise<void> {
	if (!alertConfig.emails || alertConfig.emails.length === 0) return;

	const payload = buildPayload(job, execution);
	const event = payload.event;

	const smtpOpts = getSmtpOptions();
	if (!smtpOpts) {
		logger.warn(
			`Email alerts configured for job "${job.name}" but CRONBASE_SMTP_HOST is not set — skipping`,
		);
		return;
	}

	const subject = formatEmailSubject(event, job.name);
	const body = formatEmailBody(event, job.name, job.schedule, {
		exitCode: execution.exitCode,
		durationMs: execution.durationMs,
		startedAt: execution.startedAt,
		attempt: execution.attempt,
		stderrTail: (execution.stderr ?? "").slice(-500),
		stdoutTail: (execution.stdout ?? "").slice(-500),
	});

	for (const emailConfig of alertConfig.emails) {
		if (!emailConfig.events.includes(event)) continue;
		if (emailConfig.to.length === 0) continue;

		try {
			await sendEmail(smtpOpts, emailConfig.to, subject, body);
			logger.info(
				`Email alert sent for job "${job.name}" (${event}) → ${emailConfig.to.join(", ")}`,
			);
		} catch (error) {
			logger.error(`Email alert failed for job "${job.name}" (${event})`, {
				error: error instanceof Error ? error.message : String(error),
				to: emailConfig.to.join(", "),
			});
		}
	}
}

/**
 * Check if a job has alert configuration and fire alerts if needed.
 * Called by the executor after a job completes.
 */
export async function processAlerts(job: Job, execution: Execution, store: Store): Promise<void> {
	const alertConfig = store.getJobAlert(job.id);
	if (!alertConfig) return;

	const hasWebhooks = alertConfig.webhooks.length > 0;
	const hasEmails = (alertConfig.emails ?? []).length > 0;
	if (!hasWebhooks && !hasEmails) return;

	await Promise.all([
		hasWebhooks ? fireAlerts(job, execution, alertConfig) : Promise.resolve(),
		hasEmails ? fireEmailAlerts(job, execution, alertConfig) : Promise.resolve(),
	]);
}
