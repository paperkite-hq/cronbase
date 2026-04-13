/**
 * HTTP server for cronbase — REST API + embedded web dashboard.
 *
 * Served by Bun.serve, no external dependencies.
 * API endpoints under /api/*, dashboard at /.
 */

import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import type { Server } from "bun";
import { getDashboardHtml } from "./dashboard";
import { formatMetrics } from "./metrics";
import { handleApi, json } from "./routes";
import type { Store } from "./store";

/** Constant-time string comparison to prevent timing attacks on API tokens. */
function timingSafeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	// Always compare same-length buffers for constant-time behavior.
	// If lengths differ, pad the shorter one and still run the comparison
	// (which will fail), so timing doesn't reveal length information.
	const maxLen = Math.max(bufA.length, bufB.length);
	const paddedA = Buffer.alloc(maxLen);
	const paddedB = Buffer.alloc(maxLen);
	bufA.copy(paddedA);
	bufB.copy(paddedB);
	return bufA.length === bufB.length && crypto.timingSafeEqual(paddedA, paddedB);
}

export interface ServerOptions {
	store: Store;
	port: number;
	/** Hostname to bind to. Default: "127.0.0.1". */
	hostname?: string;
	/** Optional API token for authentication. If set, all API requests require Bearer token. */
	apiToken?: string;
	/** Optional callback to check if a manual job run is allowed (concurrency gate). Returns an error message if denied, null if allowed. */
	canRunJob?: (jobId: number) => string | null;
	/** Optional callback to register a manually-started job in the scheduler's active set. */
	trackActiveJob?: (jobId: number, promise: Promise<unknown>) => void;
}

/**
 * Create and start the cronbase HTTP server.
 * Returns the Bun server instance for lifecycle management.
 */
export function createServer(opts: ServerOptions): Server<unknown> {
	const { store, port, hostname, apiToken, canRunJob, trackActiveJob } = opts;

	return Bun.serve({
		port,
		hostname: hostname ?? "127.0.0.1",
		fetch(req) {
			const url = new URL(req.url);
			const path = url.pathname;

			// CORS headers for all responses.
			// When API token auth is enabled, omit Access-Control-Allow-Origin to block
			// cross-origin requests (prevents leaked tokens from being exploited via XSS).
			const corsHeaders: Record<string, string> = apiToken
				? {
						"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization",
					}
				: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization",
					};

			if (req.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: corsHeaders });
			}

			// Health check endpoint (unauthenticated — used by monitoring)
			if (path === "/health" && req.method === "GET") {
				const health = store.getHealthInfo();
				const pauseState = store.isPaused();
				const healthWithPause = {
					...health,
					paused: pauseState.paused,
					pausedUntil: pauseState.until?.toISOString() ?? null,
				};
				return new Response(JSON.stringify(healthWithPause), {
					headers: { "Content-Type": "application/json", ...corsHeaders },
				});
			}

			// Prometheus metrics endpoint (unauthenticated — used by monitoring scrapers)
			if (path === "/metrics" && req.method === "GET") {
				const body = formatMetrics(store);
				return new Response(body, {
					headers: {
						"Content-Type": "text/plain; version=0.0.4; charset=utf-8",
						...corsHeaders,
					},
				});
			}

			// Authenticate API requests when token is configured
			if (apiToken && path.startsWith("/api/")) {
				const authHeader = req.headers.get("Authorization");
				const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
				// Use constant-time comparison to prevent timing attacks
				if (!token || !timingSafeEqual(token, apiToken)) {
					return json({ error: "Unauthorized" }, 401, corsHeaders);
				}
			}

			// API routes
			if (path.startsWith("/api/")) {
				return handleApi(req, path, store, corsHeaders, canRunJob, trackActiveJob);
			}

			// Dashboard — when API token is configured, require it via query param
			// and inject it into dashboard JS for API calls.
			if (path === "/" || path === "/index.html") {
				if (apiToken) {
					const dashUrl = new URL(req.url);
					const dashToken = dashUrl.searchParams.get("token");
					if (!dashToken || !timingSafeEqual(dashToken, apiToken)) {
						return new Response("Unauthorized. Access the dashboard with ?token=YOUR_API_TOKEN", {
							status: 401,
							headers: { "Content-Type": "text/plain", ...corsHeaders },
						});
					}
				}
				const dashHeaders: Record<string, string> = {
					"Content-Type": "text/html; charset=utf-8",
					...corsHeaders,
				};
				// When the dashboard embeds the API token, prevent proxy/CDN caching
				if (apiToken) {
					dashHeaders["Cache-Control"] = "no-store, private";
				}
				return new Response(getDashboardHtml(apiToken), { headers: dashHeaders });
			}

			return new Response("Not Found", { status: 404, headers: corsHeaders });
		},
	});
}
