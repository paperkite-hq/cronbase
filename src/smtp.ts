/**
 * Minimal SMTP client for cronbase email alerts.
 *
 * Implements the SMTP protocol directly over Bun's TCP sockets —
 * no external dependencies required.
 *
 * Supported configurations:
 *   - Plain SMTP on port 25 or 587 (with optional AUTH LOGIN)
 *   - SMTPS (TLS from connect) on port 465 via CRONBASE_SMTP_SECURE=true
 *
 * Environment variables:
 *   CRONBASE_SMTP_HOST      — SMTP server hostname (required)
 *   CRONBASE_SMTP_PORT      — SMTP server port (default: 587)
 *   CRONBASE_SMTP_SECURE    — "true" for TLS/SMTPS on connect (default: false)
 *   CRONBASE_SMTP_FROM      — Sender address (default: cronbase@localhost)
 *   CRONBASE_SMTP_USERNAME  — SMTP AUTH username (optional)
 *   CRONBASE_SMTP_PASSWORD  — SMTP AUTH password (optional)
 */

import type { SmtpOptions } from "./types";

/** Read SMTP configuration from environment variables. Returns null if CRONBASE_SMTP_HOST is not set. */
export function getSmtpOptions(): SmtpOptions | null {
	const host = process.env.CRONBASE_SMTP_HOST;
	if (!host) return null;

	return {
		host,
		port: Number(process.env.CRONBASE_SMTP_PORT ?? "587"),
		secure: process.env.CRONBASE_SMTP_SECURE === "true",
		from: process.env.CRONBASE_SMTP_FROM ?? "cronbase@localhost",
		username: process.env.CRONBASE_SMTP_USERNAME,
		password: process.env.CRONBASE_SMTP_PASSWORD,
	};
}

/** SMTP response line: code + message */
interface SmtpResponse {
	code: number;
	message: string;
}

/** Connection timeout: 15 seconds */
const CONNECT_TIMEOUT_MS = 15_000;
/** Per-command response timeout: 10 seconds */
const COMMAND_TIMEOUT_MS = 10_000;

/**
 * Low-level SMTP session over a single TCP connection.
 * Handles line-buffering and response parsing internally.
 */
class SmtpSession {
	private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
	private buffer = "";
	private pendingResolve: ((r: SmtpResponse) => void) | null = null;
	private pendingReject: ((e: Error) => void) | null = null;
	private commandTimer: ReturnType<typeof setTimeout> | null = null;

	/** Open a TCP (or TLS) connection to the SMTP server. */
	async connect(host: string, port: number, tls: boolean): Promise<SmtpResponse> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`SMTP connect timeout after ${CONNECT_TIMEOUT_MS}ms`));
			}, CONNECT_TIMEOUT_MS);

			// Store resolve/reject so the greeting line can fulfill this promise
			this.pendingResolve = (r) => {
				clearTimeout(timer);
				resolve(r);
			};
			this.pendingReject = (e) => {
				clearTimeout(timer);
				reject(e);
			};

			const socketHandlers = {
				data: (_socket: unknown, data: Buffer) => {
					this.onData(data.toString());
				},
				error: (_socket: unknown, error: Error) => {
					this.onError(error);
				},
				close: () => {
					this.onError(new Error("SMTP connection closed unexpectedly"));
				},
				open: () => {
					// Wait for greeting — resolved via pendingResolve when first line arrives
				},
			};

			// Bun.connect union type requires `as unknown as` to avoid UnixSocketOptions narrowing
			const socketOptions = tls
				? { hostname: host, port, tls: {}, socket: socketHandlers }
				: { hostname: host, port, socket: socketHandlers };

			Bun.connect(socketOptions as unknown as Parameters<typeof Bun.connect>[0]).then((sock) => {
				this.socket = sock;
			}, reject);
		});
	}

	/** Send a command and wait for a response line. */
	async command(cmd: string): Promise<SmtpResponse> {
		if (!this.socket) throw new Error("SMTP socket is not connected");
		return new Promise((resolve, reject) => {
			this.pendingResolve = resolve;
			this.pendingReject = reject;
			this.commandTimer = setTimeout(() => {
				reject(new Error(`SMTP command timeout: ${cmd.split(" ")[0]}`));
			}, COMMAND_TIMEOUT_MS);
			this.socket?.write(`${cmd}\r\n`);
		});
	}

	/** Send the email DATA block (headers + body) and wait for the "250 OK" response. */
	async sendData(data: string): Promise<SmtpResponse> {
		if (!this.socket) throw new Error("SMTP socket is not connected");
		// Issue the DATA command
		const dataResp = await this.command("DATA");
		if (dataResp.code !== 354) {
			throw new Error(`SMTP DATA command rejected: ${dataResp.code} ${dataResp.message}`);
		}
		// Stream the message body terminated by <CRLF>.<CRLF>
		// Dot-stuff any lines beginning with '.' per RFC 5321
		const stuffed = data.replace(/^\.$/gm, "..");
		return new Promise((resolve, reject) => {
			this.pendingResolve = resolve;
			this.pendingReject = reject;
			this.commandTimer = setTimeout(() => {
				reject(new Error("SMTP DATA body send timeout"));
			}, COMMAND_TIMEOUT_MS);
			this.socket?.write(`${stuffed}\r\n.\r\n`);
		});
	}

	close(): void {
		try {
			this.socket?.write("QUIT\r\n");
			this.socket?.end();
		} catch {
			// Ignore errors on close
		}
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		// Process all complete lines (may arrive in multiple chunks)
		for (;;) {
			const idx = this.buffer.indexOf("\r\n");
			if (idx === -1) break;
			const line = this.buffer.slice(0, idx);
			this.buffer = this.buffer.slice(idx + 2);
			this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		// Multi-line responses use "NNN-..." for continuation, "NNN " for the last line
		const code = Number(line.slice(0, 3));
		const isContinuation = line[3] === "-";
		if (isContinuation) return; // ignore continuation lines, wait for final

		if (!Number.isNaN(code) && (this.pendingResolve || this.pendingReject)) {
			if (this.commandTimer) {
				clearTimeout(this.commandTimer);
				this.commandTimer = null;
			}
			const resolve = this.pendingResolve;
			this.pendingResolve = null;
			this.pendingReject = null;
			resolve?.({ code, message: line.slice(4) });
		}
	}

	private onError(error: Error): void {
		if (this.commandTimer) {
			clearTimeout(this.commandTimer);
			this.commandTimer = null;
		}
		const reject = this.pendingReject;
		this.pendingResolve = null;
		this.pendingReject = null;
		reject?.(error);
	}
}

/** Expect a specific SMTP response code; throw if different. */
function expect(resp: SmtpResponse, code: number, context: string): void {
	if (resp.code !== code) {
		throw new Error(`SMTP ${context} failed: ${resp.code} ${resp.message}`);
	}
}

/**
 * Send an email over SMTP.
 * Throws on any protocol or network error.
 */
export async function sendEmail(
	opts: SmtpOptions,
	to: string[],
	subject: string,
	textBody: string,
): Promise<void> {
	const session = new SmtpSession();

	const greeting = await session.connect(opts.host, opts.port, opts.secure);
	if (greeting.code !== 220) {
		throw new Error(`SMTP greeting failed: ${greeting.code} ${greeting.message}`);
	}

	// EHLO — identify ourselves and learn server capabilities
	const ehlo = await session.command(`EHLO cronbase`);
	if (ehlo.code !== 250) {
		// Fall back to HELO
		const helo = await session.command("HELO cronbase");
		expect(helo, 250, "HELO");
	}

	// AUTH LOGIN if credentials provided
	if (opts.username && opts.password) {
		const authResp = await session.command("AUTH LOGIN");
		expect(authResp, 334, "AUTH LOGIN");

		const userResp = await session.command(Buffer.from(opts.username).toString("base64"));
		expect(userResp, 334, "AUTH LOGIN username");

		const passResp = await session.command(Buffer.from(opts.password).toString("base64"));
		expect(passResp, 235, "AUTH LOGIN password");
	}

	// MAIL FROM
	const mailFrom = await session.command(`MAIL FROM:<${opts.from}>`);
	expect(mailFrom, 250, "MAIL FROM");

	// RCPT TO — one per recipient
	for (const addr of to) {
		const rcpt = await session.command(`RCPT TO:<${addr}>`);
		expect(rcpt, 250, `RCPT TO <${addr}>`);
	}

	// Build RFC 5322 message
	const now = new Date().toUTCString();
	const toHeader = to.join(", ");
	const message = [
		`From: cronbase <${opts.from}>`,
		`To: ${toHeader}`,
		`Subject: ${subject}`,
		`Date: ${now}`,
		`MIME-Version: 1.0`,
		`Content-Type: text/plain; charset=UTF-8`,
		`Content-Transfer-Encoding: 8bit`,
		``,
		textBody,
	].join("\r\n");

	// DATA
	const dataResp = await session.sendData(message);
	expect(dataResp, 250, "DATA");

	session.close();
}

/** Format a plain-text email body for a cronbase alert. */
export function formatEmailBody(
	event: "success" | "failed" | "timeout",
	jobName: string,
	jobSchedule: string,
	execution: {
		exitCode: number | null;
		durationMs: number | null;
		startedAt: string;
		attempt: number;
		stderrTail: string;
		stdoutTail: string;
	},
): string {
	const statusLabel =
		event === "success" ? "succeeded" : event === "timeout" ? "timed out" : "failed";
	const duration = execution.durationMs
		? `${(execution.durationMs / 1000).toFixed(1)}s`
		: "unknown";

	const lines = [
		`cronbase job "${jobName}" ${statusLabel}.`,
		``,
		`Schedule:   ${jobSchedule}`,
		`Started:    ${execution.startedAt}`,
		`Duration:   ${duration}`,
		`Exit code:  ${execution.exitCode ?? "—"}`,
		`Attempt:    ${execution.attempt + 1}`,
	];

	if (execution.stderrTail) {
		lines.push(``, `stderr (last 500 chars):`, execution.stderrTail);
	}
	if (execution.stdoutTail && event === "success") {
		lines.push(``, `stdout (last 500 chars):`, execution.stdoutTail);
	}

	lines.push(``, `---`, `Sent by cronbase`);
	return lines.join("\n");
}

/** Build the email subject line for an alert. */
export function formatEmailSubject(
	event: "success" | "failed" | "timeout",
	jobName: string,
): string {
	const prefix = event === "success" ? "[cronbase] ✓" : "[cronbase] ✗";
	const label = event === "success" ? "succeeded" : event === "timeout" ? "timed out" : "failed";
	return `${prefix} ${jobName} ${label}`;
}
