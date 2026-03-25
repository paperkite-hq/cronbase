/**
 * Embedded web dashboard for cronbase — self-contained SPA.
 */

/** Returns the full dashboard HTML as a string. Injects API token if configured. */
export function getDashboardHtml(apiToken?: string): string {
	if (apiToken) {
		// JSON.stringify produces a quoted string safe for JS context, but does NOT escape
		// </script> — a token containing that sequence would break out of the script tag.
		// Replace </ with <\/ so the string is safe inside HTML <script> blocks.
		const safeToken = JSON.stringify(apiToken).replace(/<\//g, "<\\/");
		return DASHBOARD_HTML.replace("const API_TOKEN = null;", `const API_TOKEN = ${safeToken};`);
	}
	return DASHBOARD_HTML;
}
// The dashboard is a self-contained SPA — no build step, no external deps.
// Uses modern CSS (grid, custom properties) and vanilla JS with fetch API.
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cronbase</title>
<style>
:root {
  --bg: #0f1117;
  --bg-card: #1a1d27;
  --bg-hover: #242735;
  --bg-input: #12141c;
  --border: #2a2d3a;
  --text: #e4e6ef;
  --text-dim: #8b8fa3;
  --text-muted: #5c6078;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --success: #22c55e;
  --success-bg: rgba(34,197,94,0.12);
  --danger: #ef4444;
  --danger-bg: rgba(239,68,68,0.12);
  --warning: #f59e0b;
  --warning-bg: rgba(245,158,11,0.12);
  --info: #3b82f6;
  --info-bg: rgba(59,130,246,0.12);
  --radius: 8px;
  --radius-lg: 12px;
  --shadow: 0 1px 3px rgba(0,0,0,0.3);
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
}
[data-theme="light"] {
  --bg: #f5f5f7;
  --bg-card: #ffffff;
  --bg-hover: #f0f0f3;
  --bg-input: #f8f8fa;
  --border: #e0e0e5;
  --text: #1a1a2e;
  --text-dim: #6b7085;
  --text-muted: #9ca0b5;
  --accent: #4f46e5;
  --accent-hover: #6366f1;
  --shadow: 0 1px 3px rgba(0,0,0,0.08);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  min-height: 100vh;
}
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }

/* Layout */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  position: sticky;
  top: 0;
  z-index: 50;
}
.header h1 {
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}
.header h1 span { color: var(--accent); }
.header-actions { display: flex; gap: 8px; align-items: center; }

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

/* Stats cards */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  box-shadow: var(--shadow);
  border-top: 3px solid var(--border);
  transition: border-color 0.2s;
}
.stat-card:hover { border-top-color: var(--accent); }
.stat-card .label {
  font-size: 12px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 4px;
}
.stat-card .value {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.5px;
}
.stat-card .value.success { color: var(--success); }
.stat-card .value.danger { color: var(--danger); }

/* Tabs */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0;
}
.tab {
  padding: 10px 18px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: var(--font);
}
.tab:hover { color: var(--text); }
.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Panel visibility */
.panel { display: none; }
.panel.active { display: block; }

/* Table */
.table-wrap {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th {
  text-align: left;
  padding: 12px 16px;
  font-weight: 600;
  color: var(--text-dim);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
tr:last-child td { border-bottom: none; }
tbody tr { transition: background 0.1s; }
tr:hover td { background: var(--bg-hover); }

/* Status badges */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: capitalize;
}
.badge.success { background: var(--success-bg); color: var(--success); }
.badge.failed { background: var(--danger-bg); color: var(--danger); }
.badge.timeout { background: var(--warning-bg); color: var(--warning); }
.badge.running { background: var(--info-bg); color: var(--info); }
.badge.disabled { background: var(--bg); color: var(--text-muted); }
.badge.never { background: var(--bg); color: var(--text-muted); }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  font-family: var(--font);
  transition: all 0.15s;
}
.btn:hover { background: var(--bg-hover); }
.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  font-weight: 600;
}
.btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn.danger { color: var(--danger); }
.btn.danger:hover { background: var(--danger-bg); }
.btn.sm { padding: 5px 10px; font-size: 12px; border-radius: 6px; }
.btn.icon-only { padding: 6px 8px; }

/* Forms */
.modal-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 100;
  align-items: center;
  justify-content: center;
}
.modal-backdrop.active { display: flex; }
.modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
  animation: modal-in 0.15s ease-out;
}
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.modal h2 {
  font-size: 18px;
  margin-bottom: 20px;
}
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text);
  font-size: 14px;
  font-family: var(--font);
  outline: none;
  transition: border-color 0.15s;
}
.form-group input:focus,
.form-group textarea:focus {
  border-color: var(--accent);
}
.form-group textarea {
  font-family: var(--mono);
  resize: vertical;
  min-height: 60px;
}
.form-group .hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}
.form-group .cron-preview {
  font-size: 12px;
  color: var(--accent);
  margin-top: 4px;
  min-height: 16px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 20px;
}

/* Log viewer */
.log-viewer {
  background: #0a0c10;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.7;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: #a8b5c8;
  margin-top: 12px;
}
[data-theme="light"] .log-viewer {
  background: #1a1d27;
  color: #c8d0de;
}

/* Toggle switch */
.toggle {
  position: relative;
  width: 36px;
  height: 20px;
  cursor: pointer;
}
.toggle input { display: none; }
.toggle .slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 20px;
  transition: 0.2s;
}
.toggle .slider::before {
  content: '';
  position: absolute;
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background: #fff;
  border-radius: 50%;
  transition: 0.2s;
}
.toggle input:checked + .slider { background: var(--success); }
.toggle input:checked + .slider::before { transform: translateX(16px); }

/* Misc */
.mono { font-family: var(--mono); font-size: 13px; }
.dim { color: var(--text-dim); }
.muted { color: var(--text-muted); }
.empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--text-muted);
}
.empty p { margin-bottom: 16px; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.mb-16 { margin-bottom: 16px; }
/* Tags */
.tags-editor .tags-input-row { display: flex; gap: 6px; margin-bottom: 6px; }
.tags-editor .tags-input-row input { flex: 1; }
.tags-list { display: flex; flex-wrap: wrap; gap: 4px; }
.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--accent);
  color: #fff;
  border-radius: 12px;
  font-size: 12px;
}
.tag-pill button {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
  opacity: 0.7;
}
.tag-pill button:hover { opacity: 1; }
.tag-inline {
  display: inline-block;
  padding: 1px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 11px;
  color: var(--text-dim);
  margin-right: 3px;
}

/* Env vars */
.env-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}
.env-row input { flex: 1; padding: 8px 10px; font-size: 13px; }
.env-row .env-key { flex: 0.8; font-family: var(--mono); }
.env-row .env-val { flex: 1.2; }
.env-row .btn { flex-shrink: 0; }

/* Alerts modal */
.webhook-row {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 8px;
}
.webhook-row .form-group { margin-bottom: 10px; }
.webhook-row .form-group:last-child { margin-bottom: 0; }
.events-checkboxes { display: flex; gap: 12px; }
.events-checkboxes label { display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; }
.events-checkboxes input { cursor: pointer; }
.alert-icon {
  cursor: pointer;
  opacity: 0.4;
  display: inline-flex;
  align-items: center;
  padding: 4px;
  border-radius: 4px;
  transition: opacity 0.15s;
}
.alert-icon:hover { opacity: 1; background: var(--bg-hover); }
.alert-icon.active { opacity: 1; color: var(--warning); }

.action-cell { display: flex; gap: 6px; align-items: center; }
.action-cell .btn.sm { min-width: 30px; justify-content: center; }
.refresh-spin { animation: spin 0.8s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Responsive */
@media (max-width: 768px) {
  .container { padding: 16px; }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .form-row { grid-template-columns: 1fr; }
  table { font-size: 13px; }
  th, td { padding: 10px 12px; }
}

/* Toast notifications */
.toast-container {
  position: fixed;
  top: 52px;
  right: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  animation: toast-in 0.2s ease-out;
  max-width: 380px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.toast.error { border-left: 3px solid var(--danger); }
.toast.success { border-left: 3px solid var(--success); }
@keyframes toast-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes toast-out {
  to { opacity: 0; transform: translateX(20px); }
}
</style>
</head>
<body>
<div class="toast-container" id="toast-container"></div>

<div class="header">
  <h1>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    <span>cronbase</span>
    <span id="version-badge" class="dim" style="font-size:12px;font-weight:400"></span>
  </h1>
  <div class="header-actions">
    <button class="btn sm" onclick="toggleTheme()" title="Toggle theme">
      <span id="theme-icon">&#9789;</span>
    </button>
    <button class="btn sm" onclick="refreshAll()" id="refresh-btn" title="Refresh">&#8635;</button>
  </div>
</div>

<div class="container">
  <!-- Stats -->
  <div class="stats" id="stats">
    <div class="stat-card"><div class="label">Total Jobs</div><div class="value" id="stat-total">—</div></div>
    <div class="stat-card"><div class="label">Enabled</div><div class="value" id="stat-enabled">—</div></div>
    <div class="stat-card"><div class="label">24h Successes</div><div class="value success" id="stat-success">—</div></div>
    <div class="stat-card"><div class="label">24h Failures</div><div class="value danger" id="stat-failures">—</div></div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab active" data-tab="jobs">Jobs</button>
    <button class="tab" data-tab="history">Execution History</button>
  </div>

  <!-- Jobs panel -->
  <div class="panel active" id="panel-jobs">
    <div class="flex-between mb-16">
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="job-search" placeholder="Filter jobs..." oninput="filterJobs()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);color:var(--text);font-size:13px;width:200px;">
        <select id="job-status-filter" onchange="filterJobs()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);color:var(--text);font-size:13px;">
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="timeout">Timeout</option>
          <option value="never">Never run</option>
          <option value="disabled">Disabled</option>
        </select>
        <span class="dim" id="job-count"></span>
      </div>
      <button class="btn primary" onclick="showAddJob()">+ Add Job</button>
    </div>
    <div id="jobs-table"></div>
  </div>

  <!-- History panel -->
  <div class="panel" id="panel-history">
    <div class="flex-between mb-16">
      <div>
        <select id="history-filter" onchange="loadExecutions()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);color:var(--text);font-size:13px;">
          <option value="">All jobs</option>
        </select>
      </div>
      <div class="dim" id="exec-count"></div>
    </div>
    <div id="executions-table"></div>
  </div>
</div>

<!-- Add/Edit Job Modal -->
<div class="modal-backdrop" id="job-modal">
  <div class="modal">
    <h2 id="modal-title">Add Job</h2>
    <form onsubmit="return saveJob(event)">
      <input type="hidden" id="job-edit-id">
      <div class="form-group">
        <label for="job-name">Name</label>
        <input type="text" id="job-name" placeholder="backup-database" required>
      </div>
      <div class="form-group">
        <label for="job-schedule">Schedule</label>
        <input type="text" id="job-schedule" placeholder="*/5 * * * *" required oninput="previewCron()">
        <div class="cron-preview" id="cron-preview"></div>
        <div class="hint">5-field cron expression or preset (@daily, @hourly, @weekly, @monthly, @yearly)</div>
      </div>
      <div class="form-group">
        <label for="job-command">Command</label>
        <textarea id="job-command" placeholder="pg_dump mydb > /backups/db.sql" required></textarea>
      </div>
      <div class="form-group">
        <label for="job-description">Description (optional)</label>
        <input type="text" id="job-description" placeholder="Daily database backup">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="job-timeout">Timeout (seconds)</label>
          <input type="number" id="job-timeout" placeholder="0 (no timeout)" min="0">
        </div>
        <div class="form-group">
          <label for="job-retries">Max retries</label>
          <input type="number" id="job-retries" placeholder="0" min="0">
        </div>
      </div>
      <div class="form-group">
        <label for="job-cwd">Working directory (optional)</label>
        <input type="text" id="job-cwd" placeholder=".">
      </div>
      <div class="form-group">
        <label>Tags (optional)</label>
        <div id="tags-editor" class="tags-editor">
          <div class="tags-input-row">
            <input type="text" id="tag-input" placeholder="Add tag..." onkeydown="if(event.key==='Enter'){event.preventDefault();addTag()}">
            <button type="button" class="btn sm" onclick="addTag()">+</button>
          </div>
          <div id="tags-list" class="tags-list"></div>
        </div>
      </div>
      <div class="form-group">
        <label>Environment variables (optional)</label>
        <div id="env-editor">
          <div id="env-rows"></div>
          <button type="button" class="btn sm" onclick="addEnvRow()">+ Add variable</button>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn primary" id="save-btn">Save Job</button>
      </div>
    </form>
  </div>
</div>

<!-- Execution Detail Modal -->
<div class="modal-backdrop" id="exec-modal">
  <div class="modal" style="max-width:700px">
    <div class="flex-between">
      <h2 id="exec-modal-title">Execution Details</h2>
      <button class="btn sm" onclick="closeExecModal()">&#10005;</button>
    </div>
    <div id="exec-detail"></div>
  </div>
</div>

<!-- Alerts Modal -->
<div class="modal-backdrop" id="alerts-modal">
  <div class="modal" style="max-width:600px">
    <div class="flex-between">
      <h2 id="alerts-modal-title">Alert Webhooks</h2>
      <button class="btn sm" onclick="closeAlertsModal()">&#10005;</button>
    </div>
    <div id="alerts-content"></div>
    <div id="webhooks-container"></div>
    <div style="margin-top:12px">
      <button type="button" class="btn sm" onclick="addWebhookRow()">+ Add webhook</button>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="closeAlertsModal()">Cancel</button>
      <button class="btn primary" onclick="saveAlerts()">Save Alerts</button>
    </div>
  </div>
</div>

<script>
// State
let jobs = [];
let allExecs = [];
let pollTimer = null;
let currentTags = [];
let currentAlertJobId = null;

// API token (injected by server when auth is enabled)
const API_TOKEN = null;

// Toast notifications
function showToast(message, type = 'error', durationMs = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.2s ease-in forwards';
    setTimeout(() => toast.remove(), 200);
  }, durationMs);
}

// API helpers
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = 'Bearer ' + API_TOKEN;
  const res = await fetch('/api' + path, {
    headers,
    ...opts,
  });
  if (!res.ok && res.status !== 202) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// Format helpers
function fmtDate(iso) {
  if (!iso) return '<span class="muted">—</span>';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}
function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms/1000).toFixed(1) + 's';
  return (ms/60000).toFixed(1) + 'm';
}
function statusBadge(status) {
  const icons = { success: '&#10003;', failed: '&#10007;', timeout: '&#9202;', running: '&#9654;', skipped: '&#9193;' };
  const cls = esc(status || 'never');
  return '<span class="badge ' + cls + '">' + (icons[status] || '—') + ' ' + esc(status || 'never') + '</span>';
}
function fmtNextRun(iso) {
  if (!iso) return '<span class="muted">—</span>';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const now = new Date();
  const diff = d - now;
  if (diff < 0) return '<span style="color:var(--warning)">overdue</span>';
  if (diff < 60000) return 'in ' + Math.floor(diff/1000) + 's';
  if (diff < 3600000) return 'in ' + Math.floor(diff/60000) + 'm';
  if (diff < 86400000) return 'in ' + Math.floor(diff/3600000) + 'h';
  const days = Math.floor(diff / 86400000);
  if (days <= 14) return 'in ' + days + 'd';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

// Data loading
async function loadStats() {
  const s = await api('/stats');
  document.getElementById('stat-total').textContent = s.totalJobs;
  document.getElementById('stat-enabled').textContent = s.enabledJobs;
  document.getElementById('stat-success').textContent = s.recentSuccesses;
  document.getElementById('stat-failures').textContent = s.recentFailures;
}

async function loadJobs() {
  jobs = await api('/jobs');
  // Fetch alert status for each job (in parallel)
  await Promise.all(jobs.map(async (j) => {
    try {
      const alerts = await api('/jobs/' + j.id + '/alerts');
      j._hasAlerts = alerts.webhooks && alerts.webhooks.length > 0;
    } catch { j._hasAlerts = false; }
  }));
  const el = document.getElementById('jobs-table');
  const countEl = document.getElementById('job-count');
  countEl.textContent = jobs.length + ' job' + (jobs.length !== 1 ? 's' : '');
  // Re-apply filters after data reload
  const searchVal = document.getElementById('job-search').value;
  const statusVal = document.getElementById('job-status-filter').value;
  const hasFilters = searchVal || statusVal;

  // Update history filter
  const filter = document.getElementById('history-filter');
  const curVal = filter.value;
  filter.innerHTML = '<option value="">All jobs</option>';
  for (const j of jobs) {
    filter.innerHTML += '<option value="' + j.id + '"' + (curVal == j.id ? ' selected' : '') + '>' + esc(j.name) + '</option>';
  }

  if (jobs.length === 0) {
    el.innerHTML = '<div class="empty"><p>No jobs defined yet.</p><button class="btn primary" onclick="showAddJob()">+ Add your first job</button></div>';
    return;
  }

  let html = '<div class="table-wrap"><table><thead><tr>';
  html += '<th>Name</th><th>Schedule</th><th>Status</th><th>Last Run</th><th>Next Run</th><th>Actions</th>';
  html += '</tr></thead><tbody>';

  for (const j of jobs) {
    html += '<tr>';
    html += '<td><div style="font-weight:600">' + esc(j.name) + '</div>';
    if (j.description) html += '<div class="dim" style="font-size:12px">' + esc(j.description) + '</div>';
    if (j.tags && j.tags.length) html += '<div style="margin-top:3px">' + j.tags.map(t => '<span class="tag-inline">' + esc(t) + '</span>').join('') + '</div>';
    html += '</td>';
    html += '<td><span class="mono">' + esc(j.schedule) + '</span><div class="dim" style="font-size:12px">' + esc(j.scheduleDescription) + '</div></td>';
    html += '<td>' + statusBadge(j.lastStatus) + '</td>';
    html += '<td><span class="dim">' + fmtDate(j.lastRun) + '</span></td>';
    html += '<td>' + (j.enabled ? fmtNextRun(j.nextRun) : '<span class="badge disabled">disabled</span>') + '</td>';
    html += '<td><div class="action-cell">';
    html += '<button class="btn sm" onclick="runJob(' + j.id + ')" title="Run now"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5,3 19,12 5,21"/></svg></button>';
    html += '<button class="btn sm" onclick="editJob(' + j.id + ')" title="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
    html += '<span class="alert-icon' + (j._hasAlerts ? ' active' : '') + '" onclick="showAlerts(' + j.id + ')" title="Alerts"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>';
    html += '<label class="toggle" title="' + (j.enabled ? 'Disable' : 'Enable') + '"><input type="checkbox"' + (j.enabled ? ' checked' : '') + ' onchange="toggleJob(' + j.id + ')"><span class="slider"></span></label>';
    html += '<button class="btn sm danger" onclick="deleteJob(' + j.id + ')" title="Delete">&#10005;</button>';
    html += '</div></td>';
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  el.innerHTML = html;
  if (hasFilters) filterJobs();
}

async function loadExecutions() {
  const filter = document.getElementById('history-filter');
  const jobId = filter.value;
  const params = jobId ? '?jobId=' + jobId + '&limit=100&brief=1' : '?limit=100&brief=1';
  allExecs = await api('/executions' + params);
  const el = document.getElementById('executions-table');
  const countEl = document.getElementById('exec-count');
  countEl.textContent = allExecs.length + ' execution' + (allExecs.length !== 1 ? 's' : '');

  if (allExecs.length === 0) {
    el.innerHTML = '<div class="empty"><p>No execution history yet.</p><p class="dim">Jobs will appear here after their first run.</p></div>';
    return;
  }

  let html = '<div class="table-wrap"><table><thead><tr>';
  html += '<th>Job</th><th>Status</th><th>Duration</th><th>Exit Code</th><th>Attempt</th><th>Started</th><th></th>';
  html += '</tr></thead><tbody>';

  for (const e of allExecs) {
    html += '<tr style="cursor:pointer" onclick="showExecDetail(' + e.id + ')">';
    html += '<td style="font-weight:500">' + esc(e.jobName) + '</td>';
    html += '<td>' + statusBadge(e.status) + '</td>';
    html += '<td class="mono">' + fmtDuration(e.durationMs) + '</td>';
    html += '<td class="mono">' + (e.exitCode != null ? e.exitCode : '—') + '</td>';
    html += '<td>' + (e.attempt > 0 ? '#' + (e.attempt+1) : '—') + '</td>';
    html += '<td class="dim">' + fmtDate(e.startedAt) + '</td>';
    html += '<td><button class="btn sm icon-only" title="View logs">&#8942;</button></td>';
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  btn.innerHTML = '<span class="refresh-spin">&#8635;</span>';
  try {
    await Promise.all([loadStats(), loadJobs(), loadExecutions()]);
  } finally {
    btn.innerHTML = '&#8635;';
  }
}

// Actions
async function runJob(id) {
  try {
    const j = jobs.find(x => x.id === id);
    await api('/jobs/' + id + '/run', { method: 'POST' });
    showToast((j ? j.name : 'Job') + ' triggered', 'success', 2000);
    // Poll for result after a short delay
    setTimeout(refreshAll, 1500);
  } catch(e) { showToast(e.message); }
}

async function toggleJob(id) {
  try {
    await api('/jobs/' + id + '/toggle', { method: 'PATCH' });
    await loadJobs();
    await loadStats();
  } catch(e) { showToast(e.message); }
}

async function deleteJob(id) {
  const j = jobs.find(x => x.id === id);
  const name = j ? j.name : 'ID ' + id;
  if (!confirm('Delete job "' + name + '"? This also removes all execution history.')) return;
  try {
    await api('/jobs/' + id, { method: 'DELETE' });
    showToast(name + ' deleted', 'success', 2000);
    await refreshAll();
  } catch(e) { showToast(e.message); }
}

// Modal
function showAddJob() {
  document.getElementById('modal-title').textContent = 'Add Job';
  document.getElementById('job-edit-id').value = '';
  document.getElementById('job-name').value = '';
  document.getElementById('job-schedule').value = '';
  document.getElementById('job-command').value = '';
  document.getElementById('job-description').value = '';
  document.getElementById('job-timeout').value = '';
  document.getElementById('job-retries').value = '';
  document.getElementById('job-cwd').value = '';
  document.getElementById('cron-preview').textContent = '';
  document.getElementById('save-btn').textContent = 'Save Job';
  currentTags = [];
  renderTags();
  renderEnvRows({});
  document.getElementById('job-modal').classList.add('active');
  document.getElementById('job-name').focus();
}

function editJob(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return;
  document.getElementById('modal-title').textContent = 'Edit Job';
  document.getElementById('job-edit-id').value = id;
  document.getElementById('job-name').value = j.name;
  document.getElementById('job-schedule').value = j.schedule;
  document.getElementById('job-command').value = j.command;
  document.getElementById('job-description').value = j.description || '';
  document.getElementById('job-timeout').value = j.timeout || '';
  document.getElementById('job-retries').value = j.retry?.maxAttempts || '';
  document.getElementById('job-cwd').value = j.cwd !== '.' ? j.cwd : '';
  document.getElementById('save-btn').textContent = 'Update Job';
  currentTags = j.tags ? [...j.tags] : [];
  renderTags();
  renderEnvRows(j.env || {});
  previewCron();
  document.getElementById('job-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('job-modal').classList.remove('active');
}

async function saveJob(e) {
  e.preventDefault();
  const editId = document.getElementById('job-edit-id').value;
  const body = {
    name: document.getElementById('job-name').value.trim(),
    schedule: document.getElementById('job-schedule').value.trim(),
    command: document.getElementById('job-command').value.trim(),
    description: document.getElementById('job-description').value.trim(),
    timeout: Number(document.getElementById('job-timeout').value) || 0,
    retry: { maxAttempts: Number(document.getElementById('job-retries').value) || 0, baseDelay: 30 },
    cwd: document.getElementById('job-cwd').value.trim() || '.',
    tags: currentTags,
    env: collectEnvVars(),
  };

  try {
    if (editId) {
      await api('/jobs/' + editId, { method: 'PUT', body: JSON.stringify(body) });
      showToast(body.name + ' updated', 'success', 2000);
    } else {
      await api('/jobs', { method: 'POST', body: JSON.stringify(body) });
      showToast(body.name + ' created', 'success', 2000);
    }
    closeModal();
    await refreshAll();
  } catch(e) { showToast(e.message); }
}

let cronPreviewTimer = null;
function previewCron() {
  if (cronPreviewTimer) clearTimeout(cronPreviewTimer);
  cronPreviewTimer = setTimeout(async () => {
    const expr = document.getElementById('job-schedule').value.trim();
    const el = document.getElementById('cron-preview');
    if (!expr) { el.textContent = ''; return; }
    try {
      const res = await api('/cron/describe?expr=' + encodeURIComponent(expr));
      el.textContent = res.valid ? res.description : res.error;
      el.style.color = res.valid ? 'var(--accent)' : 'var(--danger)';
    } catch { el.textContent = ''; }
  }, 300);
}

// Execution detail — fetches full record (with stdout/stderr) on demand
async function showExecDetail(id) {
  const brief = allExecs.find(x => x.id === id);
  if (!brief) return;
  document.getElementById('exec-modal-title').textContent = brief.jobName + ' — Execution #' + brief.id;
  document.getElementById('exec-detail').innerHTML = '<div class="dim" style="text-align:center;padding:24px">Loading...</div>';
  document.getElementById('exec-modal').classList.add('active');

  // Fetch full execution record with stdout/stderr
  let e;
  try {
    e = await api('/executions/' + id);
  } catch {
    e = brief; // fallback to brief data if fetch fails
  }

  let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
  html += '<div><span class="dim">Status:</span> ' + statusBadge(e.status) + '</div>';
  html += '<div><span class="dim">Duration:</span> <span class="mono">' + fmtDuration(e.durationMs) + '</span></div>';
  html += '<div><span class="dim">Exit code:</span> <span class="mono">' + (e.exitCode != null ? e.exitCode : '—') + '</span></div>';
  html += '<div><span class="dim">Attempt:</span> ' + (e.attempt + 1) + '</div>';
  html += '<div><span class="dim">Started:</span> ' + fmtDate(e.startedAt) + '</div>';
  html += '<div><span class="dim">Finished:</span> ' + fmtDate(e.finishedAt) + '</div>';
  html += '</div>';

  if (e.stdout) {
    html += '<div style="font-weight:600;margin-bottom:4px">stdout</div>';
    html += '<div class="log-viewer">' + esc(e.stdout) + '</div>';
  }
  if (e.stderr) {
    html += '<div style="font-weight:600;margin-top:12px;margin-bottom:4px">stderr</div>';
    html += '<div class="log-viewer" style="color:var(--danger)">' + esc(e.stderr) + '</div>';
  }
  if (!e.stdout && !e.stderr) {
    html += '<div class="dim" style="text-align:center;padding:24px">No output captured.</div>';
  }

  document.getElementById('exec-detail').innerHTML = html;
}

function closeExecModal() {
  document.getElementById('exec-modal').classList.remove('active');
}

// Tags
function addTag() {
  const input = document.getElementById('tag-input');
  const val = input.value.trim();
  if (val && !currentTags.includes(val)) {
    currentTags.push(val);
    renderTags();
  }
  input.value = '';
  input.focus();
}
function removeTag(idx) {
  currentTags.splice(idx, 1);
  renderTags();
}
function renderTags() {
  const el = document.getElementById('tags-list');
  el.innerHTML = currentTags.map((t, i) =>
    '<span class="tag-pill">' + esc(t) + '<button type="button" onclick="removeTag(' + i + ')">&#10005;</button></span>'
  ).join('');
}

// Env vars
function renderEnvRows(envObj) {
  const container = document.getElementById('env-rows');
  container.innerHTML = '';
  const entries = Object.entries(envObj);
  if (entries.length === 0) return;
  for (const [k, v] of entries) {
    appendEnvRow(k, v);
  }
}
function addEnvRow() { appendEnvRow('', ''); }
function appendEnvRow(key, val) {
  const container = document.getElementById('env-rows');
  const row = document.createElement('div');
  row.className = 'env-row';
  row.innerHTML = '<input class="env-key" type="text" placeholder="KEY" value="' + esc(key) + '">' +
    '<input class="env-val" type="text" placeholder="value" value="' + esc(val) + '">' +
    '<button type="button" class="btn sm danger" onclick="this.parentElement.remove()">&#10005;</button>';
  container.appendChild(row);
}
function collectEnvVars() {
  const env = {};
  document.querySelectorAll('#env-rows .env-row').forEach(row => {
    const key = row.querySelector('.env-key').value.trim();
    const val = row.querySelector('.env-val').value;
    if (key) env[key] = val;
  });
  return env;
}

// Alerts
async function showAlerts(jobId) {
  currentAlertJobId = jobId;
  const j = jobs.find(x => x.id === jobId);
  document.getElementById('alerts-modal-title').textContent = 'Alerts — ' + (j ? j.name : 'Job ' + jobId);
  try {
    const config = await api('/jobs/' + jobId + '/alerts');
    renderWebhooks(config.webhooks || []);
  } catch(e) {
    renderWebhooks([]);
  }
  document.getElementById('alerts-modal').classList.add('active');
}
function closeAlertsModal() {
  document.getElementById('alerts-modal').classList.remove('active');
  currentAlertJobId = null;
}
function renderWebhooks(webhooks) {
  const container = document.getElementById('webhooks-container');
  container.innerHTML = '';
  for (const wh of webhooks) {
    appendWebhookRow(wh.url, wh.events || []);
  }
}
function addWebhookRow() { appendWebhookRow('', ['failed']); }
function appendWebhookRow(url, events) {
  const container = document.getElementById('webhooks-container');
  const row = document.createElement('div');
  row.className = 'webhook-row';
  row.innerHTML = '<div class="form-group">' +
    '<label>Webhook URL</label>' +
    '<input type="url" class="wh-url" placeholder="https://hooks.slack.com/..." value="' + esc(url) + '">' +
    '</div>' +
    '<div class="form-group">' +
    '<label>Events</label>' +
    '<div class="events-checkboxes">' +
    '<label><input type="checkbox" class="wh-evt" value="success"' + (events.includes('success') ? ' checked' : '') + '> Success</label>' +
    '<label><input type="checkbox" class="wh-evt" value="failed"' + (events.includes('failed') ? ' checked' : '') + '> Failed</label>' +
    '<label><input type="checkbox" class="wh-evt" value="timeout"' + (events.includes('timeout') ? ' checked' : '') + '> Timeout</label>' +
    '</div></div>' +
    '<button type="button" class="btn sm danger" onclick="this.parentElement.remove()">Remove</button>';
  container.appendChild(row);
}
function collectWebhooks() {
  const webhooks = [];
  document.querySelectorAll('#webhooks-container .webhook-row').forEach(row => {
    const url = row.querySelector('.wh-url').value.trim();
    if (!url) return;
    const events = [];
    row.querySelectorAll('.wh-evt:checked').forEach(cb => events.push(cb.value));
    if (events.length > 0) webhooks.push({ url, events });
  });
  return webhooks;
}
async function saveAlerts() {
  if (!currentAlertJobId) return;
  const webhooks = collectWebhooks();
  try {
    if (webhooks.length === 0) {
      await api('/jobs/' + currentAlertJobId + '/alerts', { method: 'DELETE' });
    } else {
      await api('/jobs/' + currentAlertJobId + '/alerts', { method: 'PUT', body: JSON.stringify({ webhooks }) });
    }
    closeAlertsModal();
    await loadJobs();
  } catch(e) { showToast(e.message); }
}

// Theme
function toggleTheme() {
  const html = document.documentElement;
  const cur = html.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('theme-icon').innerHTML = next === 'dark' ? '&#9789;' : '&#9788;';
  localStorage.setItem('cronbase-theme', next);
}
// Restore theme
(function() {
  const saved = localStorage.getItem('cronbase-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-icon').innerHTML = saved === 'dark' ? '&#9789;' : '&#9788;';
  }
})();

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// Close modals on backdrop click
document.getElementById('job-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('exec-modal').addEventListener('click', function(e) {
  if (e.target === this) closeExecModal();
});
document.getElementById('alerts-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAlertsModal();
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeModal(); closeExecModal(); closeAlertsModal(); }
  // Cmd/Ctrl+K to focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    const search = document.getElementById('job-search');
    if (search) { search.focus(); search.select(); }
    // Switch to jobs tab if not active
    const jobsTab = document.querySelector('[data-tab="jobs"]');
    if (jobsTab && !jobsTab.classList.contains('active')) jobsTab.click();
  }
  // 'n' to add new job (when no input focused)
  if (e.key === 'n' && !isInputFocused()) showAddJob();
});
function isInputFocused() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

// Escape HTML
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// Job filtering
function filterJobs() {
  const query = document.getElementById('job-search').value.toLowerCase().trim();
  const statusFilter = document.getElementById('job-status-filter').value;
  const rows = document.querySelectorAll('#jobs-table tbody tr');
  let visible = 0;
  rows.forEach((row, idx) => {
    const job = jobs[idx];
    if (!job) return;
    const matchesSearch = !query ||
      job.name.toLowerCase().includes(query) ||
      (job.description || '').toLowerCase().includes(query) ||
      job.schedule.toLowerCase().includes(query) ||
      (job.tags || []).some(t => t.toLowerCase().includes(query));
    let matchesStatus = true;
    if (statusFilter === 'disabled') {
      matchesStatus = !job.enabled;
    } else if (statusFilter === 'never') {
      matchesStatus = !job.lastStatus && job.enabled;
    } else if (statusFilter) {
      matchesStatus = job.lastStatus === statusFilter;
    }
    const show = matchesSearch && matchesStatus;
    row.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('job-count').textContent = visible + ' of ' + jobs.length + ' job' + (jobs.length !== 1 ? 's' : '');
}

// Auto-refresh every 5 seconds
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshAll, 5000);
}

// Fetch version from health endpoint
(async function() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    if (data.version) {
      document.getElementById('version-badge').textContent = 'v' + data.version;
    }
  } catch {}
})();

// Initial load
refreshAll().then(startPolling);
</script>
</body>
</html>`;
