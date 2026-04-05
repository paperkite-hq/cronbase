/**
 * API route handlers for cronbase HTTP server.
 */

import { describeCron, parseCron } from "./cron";
import { executeJob } from "./executor";
import { logger } from "./logger";
import type { Store } from "./store";
import type { AlertConfig, JobConfig } from "./types";
import { validateJobConfig, validateSchedule, validateWebhookUrl } from "./validation";

/** Safe wrapper around describeCron that returns a fallback on invalid schedules.
 * Prevents a single corrupted job from crashing the entire job listing API. */
function safeDescribeCron(schedule: string): string {
	try {
		return describeCron(schedule);
	} catch {
		return "Invalid schedule";
	}
}

export function json(
	data: unknown,
	status = 200,
	extraHeaders: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", ...extraHeaders },
	});
}

export async function handleApi(
	req: Request,
	path: string,
	store: Store,
	corsHeaders: Record<string, string>,
	canRunJob?: (jobId: number) => string | null,
	trackActiveJob?: (jobId: number, promise: Promise<unknown>) => void,
): Promise<Response> {
	try {
		// Helper to parse JSON body with a proper 400 error on malformed input
		async function parseJsonBody<T>(request: Request): Promise<T> {
			try {
				return (await request.json()) as T;
			} catch {
				throw { status: 400, message: "Invalid JSON in request body" };
			}
		}

		// GET /api/stats
		if (path === "/api/stats" && req.method === "GET") {
			const stats = store.getStats();
			return json(stats, 200, corsHeaders);
		}

		// GET /api/jobs
		if (path === "/api/jobs" && req.method === "GET") {
			const jobs = store.listJobs();
			const enriched = jobs.map((j) => ({
				...j,
				scheduleDescription: safeDescribeCron(j.schedule),
			}));
			return json(enriched, 200, corsHeaders);
		}

		// POST /api/jobs — create a new job
		if (path === "/api/jobs" && req.method === "POST") {
			const body = await parseJsonBody<Partial<JobConfig>>(req);
			if (!body.name || !body.schedule || !body.command) {
				return json({ error: "name, schedule, and command are required" }, 400, corsHeaders);
			}
			const validationError = validateJobConfig(body as Record<string, unknown>);
			if (validationError) {
				return json({ error: validationError.message }, 400, corsHeaders);
			}
			const scheduleError = validateSchedule(body.schedule, parseCron);
			if (scheduleError) {
				return json({ error: scheduleError.message }, 400, corsHeaders);
			}
			// Check for duplicate name before insert
			const existing = store.getJobByName(body.name);
			if (existing) {
				return json({ error: `A job named "${body.name}" already exists` }, 409, corsHeaders);
			}
			const job = store.addJob(body as JobConfig);
			return json({ ...job, scheduleDescription: describeCron(job.schedule) }, 201, corsHeaders);
		}

		// Routes with job ID: /api/jobs/:id
		const jobMatch = path.match(/^\/api\/jobs\/(\d+)$/);
		if (jobMatch) {
			const jobId = Number(jobMatch[1]);
			const job = store.getJob(jobId);

			if (!job) {
				return json({ error: "Job not found" }, 404, corsHeaders);
			}

			// GET /api/jobs/:id
			if (req.method === "GET") {
				return json(
					{ ...job, scheduleDescription: safeDescribeCron(job.schedule) },
					200,
					corsHeaders,
				);
			}

			// PUT /api/jobs/:id — update job
			if (req.method === "PUT") {
				const body = await parseJsonBody<Partial<JobConfig>>(req);
				// Validate all fields that are being changed (merge with existing for full validation)
				const validationError = validateJobConfig({
					name: body.name ?? job.name,
					command: body.command ?? job.command,
					description: body.description ?? job.description,
					timeout: body.timeout ?? job.timeout,
					env: body.env ?? job.env,
					tags: body.tags ?? job.tags,
					cwd: body.cwd ?? job.cwd,
					retry: body.retry ?? job.retry,
					timezone: body.timezone ?? job.timezone,
				} as Record<string, unknown>);
				if (validationError) {
					return json({ error: validationError.message }, 400, corsHeaders);
				}
				if ("schedule" in body) {
					if (!body.schedule) {
						return json({ error: "schedule cannot be empty" }, 400, corsHeaders);
					}
					const scheduleError = validateSchedule(body.schedule, parseCron);
					if (scheduleError) {
						return json({ error: scheduleError.message }, 400, corsHeaders);
					}
				}
				// Check for name uniqueness if name is being changed
				if (body.name && body.name !== job.name) {
					const existing = store.getJobByName(body.name);
					if (existing) {
						return json({ error: `A job named "${body.name}" already exists` }, 409, corsHeaders);
					}
				}
				store.updateJob(jobId, body);
				const updated = store.getJob(jobId);
				if (!updated) return json({ error: "Job not found" }, 404, corsHeaders);
				return json(
					{ ...updated, scheduleDescription: describeCron(updated.schedule) },
					200,
					corsHeaders,
				);
			}

			// DELETE /api/jobs/:id
			if (req.method === "DELETE") {
				store.deleteJob(jobId);
				return json({ ok: true }, 200, corsHeaders);
			}

			// PATCH /api/jobs/:id/toggle
			if (req.method === "PATCH") {
				return json(
					{ error: "Use PATCH /api/jobs/:id/toggle or /api/jobs/:id/run" },
					400,
					corsHeaders,
				);
			}
		}

		// PATCH /api/jobs/:id/toggle
		const toggleMatch = path.match(/^\/api\/jobs\/(\d+)\/toggle$/);
		if (toggleMatch && req.method === "PATCH") {
			const jobId = Number(toggleMatch[1]);
			const job = store.getJob(jobId);
			if (!job) return json({ error: "Job not found" }, 404, corsHeaders);
			store.toggleJob(jobId, !job.enabled);
			const updated = store.getJob(jobId);
			return json(updated, 200, corsHeaders);
		}

		// POST /api/jobs/:id/run — manual trigger
		const runMatch = path.match(/^\/api\/jobs\/(\d+)\/run$/);
		if (runMatch && req.method === "POST") {
			const jobId = Number(runMatch[1]);
			const job = store.getJob(jobId);
			if (!job) return json({ error: "Job not found" }, 404, corsHeaders);
			// Check concurrency limit if the scheduler provided a gate
			if (canRunJob) {
				const denied = canRunJob(jobId);
				if (denied) {
					return json({ error: denied }, 429, corsHeaders);
				}
			}
			// Execute async, return immediately with execution started
			const execPromise = executeJob(job, store);
			// Register in active set so scheduler tracks it for concurrency
			if (trackActiveJob) {
				trackActiveJob(jobId, execPromise);
			}
			// Don't await — return immediately so UI stays responsive
			execPromise.catch((e) => {
				logger.error(`Manual run error for ${job.name}:`, { error: String(e) });
			});
			return json({ status: "started", jobId, jobName: job.name }, 202, corsHeaders);
		}

		// GET /api/executions?jobId=N&limit=N&brief=1
		if (path === "/api/executions" && req.method === "GET") {
			const url = new URL(req.url);
			const jobIdParam = url.searchParams.get("jobId");
			const limitParam = url.searchParams.get("limit");
			const briefParam = url.searchParams.get("brief");
			const jobId = jobIdParam ? Number(jobIdParam) : undefined;
			const limit = limitParam ? Number(limitParam) : 50;
			const brief = briefParam === "1" || briefParam === "true";
			if (jobId !== undefined && (Number.isNaN(jobId) || jobId < 1 || !Number.isInteger(jobId))) {
				return json({ error: "jobId must be a positive integer" }, 400, corsHeaders);
			}
			if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
				return json({ error: "limit must be between 1 and 1000" }, 400, corsHeaders);
			}
			const execs = store.getExecutions({ jobId, limit, brief });
			return json(execs, 200, corsHeaders);
		}

		// GET /api/executions/:id
		const execMatch = path.match(/^\/api\/executions\/(\d+)$/);
		if (execMatch && req.method === "GET") {
			const execId = Number(execMatch[1]);
			const exec = store.getExecutionById(execId);
			if (!exec) return json({ error: "Execution not found" }, 404, corsHeaders);
			return json(exec, 200, corsHeaders);
		}

		// GET /api/jobs/:id/alerts — get alert config
		const alertGetMatch = path.match(/^\/api\/jobs\/(\d+)\/alerts$/);
		if (alertGetMatch && req.method === "GET") {
			const jobId = Number(alertGetMatch[1]);
			const job = store.getJob(jobId);
			if (!job) return json({ error: "Job not found" }, 404, corsHeaders);
			const config = store.getJobAlert(jobId);
			return json(config ?? { webhooks: [] }, 200, corsHeaders);
		}

		// PUT /api/jobs/:id/alerts — set alert config
		const alertPutMatch = path.match(/^\/api\/jobs\/(\d+)\/alerts$/);
		if (alertPutMatch && req.method === "PUT") {
			const jobId = Number(alertPutMatch[1]);
			const job = store.getJob(jobId);
			if (!job) return json({ error: "Job not found" }, 404, corsHeaders);
			const body = await parseJsonBody<AlertConfig>(req);
			if (!body.webhooks || !Array.isArray(body.webhooks)) {
				return json({ error: "webhooks array required" }, 400, corsHeaders);
			}
			for (const webhook of body.webhooks) {
				const urlError = validateWebhookUrl(webhook.url);
				if (urlError) return json({ error: urlError.message }, 400, corsHeaders);
				if (!webhook.events || !Array.isArray(webhook.events) || webhook.events.length === 0) {
					return json(
						{ error: "Each webhook must have a non-empty events array" },
						400,
						corsHeaders,
					);
				}
				const validEvents = new Set(["success", "failed", "timeout"]);
				for (const event of webhook.events) {
					if (!validEvents.has(event)) {
						return json({ error: `Invalid event type: "${event}"` }, 400, corsHeaders);
					}
				}
				// Deduplicate events
				webhook.events = [...new Set(webhook.events)];
			}
			store.setJobAlert(jobId, body);
			return json({ ok: true }, 200, corsHeaders);
		}

		// DELETE /api/jobs/:id/alerts — remove alert config
		const alertDelMatch = path.match(/^\/api\/jobs\/(\d+)\/alerts$/);
		if (alertDelMatch && req.method === "DELETE") {
			const jobId = Number(alertDelMatch[1]);
			if (!store.getJob(jobId)) {
				return json({ error: "Job not found" }, 404, corsHeaders);
			}
			store.removeJobAlert(jobId);
			return json({ ok: true }, 200, corsHeaders);
		}

		// GET /api/cron/describe?expr=...
		if (path === "/api/cron/describe" && req.method === "GET") {
			const url = new URL(req.url);
			const expr = url.searchParams.get("expr");
			if (!expr) return json({ error: "expr parameter required" }, 400, corsHeaders);
			try {
				parseCron(expr);
				return json({ valid: true, description: describeCron(expr) }, 200, corsHeaders);
			} catch (e) {
				return json({ valid: false, error: (e as Error).message }, 200, corsHeaders);
			}
		}

		return json({ error: "Not found" }, 404, corsHeaders);
	} catch (error) {
		// Structured errors from parseJsonBody and similar helpers
		if (error && typeof error === "object" && "status" in error && "message" in error) {
			const e = error as { status: number; message: string };
			return json({ error: e.message }, e.status, corsHeaders);
		}
		logger.error("API error:", { error: String(error) });
		// Never expose internal error messages to API clients (could leak file paths, SQL, etc.)
		return json({ error: "Internal server error" }, 500, corsHeaders);
	}
}
