import express from "express";
import type { Orchestrator } from "./orchestrator.js";
import type { OrchestratorEvent } from "./types.js";
import { logger } from "./logger.js";

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Symphony</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    line-height: 1.6;
    min-height: 100vh;
  }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px; }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 24px;
    border-bottom: 1px solid #21262d;
    margin-bottom: 24px;
  }
  header h1 { font-size: 24px; font-weight: 600; color: #f0f6fc; }
  header h1 span { color: #58a6ff; }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    padding: 4px 12px;
    border-radius: 20px;
    background: #161b22;
    border: 1px solid #21262d;
  }
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #f85149;
  }
  .status-dot.connected { background: #3fb950; }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 32px;
  }
  .config-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 8px;
    padding: 16px;
  }
  .config-card .label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #8b949e;
    margin-bottom: 4px;
  }
  .config-card .value {
    font-size: 18px;
    font-weight: 600;
    color: #f0f6fc;
  }

  .section {
    margin-bottom: 32px;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .section-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: #f0f6fc;
  }
  .count-badge {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 10px;
    background: #21262d;
    color: #8b949e;
  }

  .card-list { display: flex; flex-direction: column; gap: 8px; }
  .card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 8px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: border-color 0.15s;
  }
  .card:hover { border-color: #30363d; }

  .run-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .run-dot.running {
    background: #3fb950;
    animation: pulse 2s infinite;
  }
  .run-dot.waiting {
    background: #d29922;
  }
  .run-dot.failed {
    background: #f85149;
  }
  .run-dot.completed {
    background: #3fb950;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .card-body { flex: 1; min-width: 0; }
  .card-title {
    font-weight: 600;
    color: #f0f6fc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-meta {
    font-size: 13px;
    color: #8b949e;
  }
  .card-status {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 12px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .card-status.running { background: rgba(63,185,80,0.15); color: #3fb950; }
  .card-status.waiting { background: rgba(210,153,34,0.15); color: #d29922; }
  .card-status.failed { background: rgba(248,81,73,0.15); color: #f85149; }
  .card-status.completed { background: rgba(63,185,80,0.15); color: #3fb950; }

  .token-section {
    margin-bottom: 32px;
  }
  .token-bar {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 8px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .token-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .token-stat .label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #8b949e;
  }
  .token-stat .value {
    font-size: 16px;
    font-weight: 600;
    color: #f0f6fc;
  }
  .token-stat .value.warning { color: #d29922; }
  .token-stat .value.danger { color: #f85149; }
  .token-divider {
    width: 1px;
    height: 32px;
    background: #21262d;
  }

  .empty-state {
    text-align: center;
    padding: 32px;
    color: #484f58;
    font-size: 14px;
    background: #161b22;
    border: 1px dashed #21262d;
    border-radius: 8px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    color: #f0f6fc;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn:hover { background: #30363d; }
  .btn:active { background: #282e33; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: #238636; border-color: #2ea043; }
  .btn-primary:hover { background: #2ea043; }

  .actions { display: flex; gap: 8px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1><span>&#9835;</span> Symphony</h1>
    <div class="actions">
      <div class="status-badge">
        <div id="conn-dot" class="status-dot"></div>
        <span id="conn-text">Connecting...</span>
      </div>
      <button id="poll-btn" class="btn btn-primary" onclick="triggerPoll()">Trigger Poll</button>
    </div>
  </header>

  <div id="config-grid" class="config-grid"></div>

  <div id="token-section" class="token-section"></div>

  <div class="section">
    <div class="section-header">
      <h2>Active Runs</h2>
      <span id="running-count" class="count-badge">0</span>
    </div>
    <div id="running-list" class="card-list">
      <div class="empty-state">No active runs</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Retry Queue</h2>
      <span id="retry-count" class="count-badge">0</span>
    </div>
    <div id="retry-list" class="card-list">
      <div class="empty-state">Retry queue is empty</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Recent Completions</h2>
      <span id="completed-count" class="count-badge">0</span>
    </div>
    <div id="completed-list" class="card-list">
      <div class="empty-state">No completed runs yet</div>
    </div>
  </div>
</div>

<script>
function esc(s) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

function statusClass(status) {
  if (status === 'running_agent' || status === 'preparing_workspace' || status === 'building_prompt' || status === 'finishing') return 'running';
  if (status === 'waiting_continuation') return 'waiting';
  if (status === 'failed' || status === 'retrying') return 'failed';
  return 'completed';
}

function formatStatus(status) {
  return status.replace(/_/g, ' ');
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function relTime(dateStr) {
  var d = new Date(dateStr);
  var diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function render(state) {
  var c = state.config;
  document.getElementById('config-grid').innerHTML =
    '<div class="config-card"><div class="label">Repository</div><div class="value">' + esc(c.github.owner + '/' + c.github.repo) + '</div></div>' +
    '<div class="config-card"><div class="label">Label</div><div class="value">' + esc(c.github.label) + '</div></div>' +
    '<div class="config-card"><div class="label">Poll Interval</div><div class="value">' + c.polling.interval_seconds + 's</div></div>' +
    '<div class="config-card"><div class="label">Max Sessions</div><div class="value">' + c.concurrency.max_sessions + '</div></div>' +
    '<div class="config-card"><div class="label">Max Turns</div><div class="value">' + c.agent.max_continuation_turns + '</div></div>';

  // Token usage section
  var tu = state.tokenUsage;
  if (tu) {
    var globalBudget = c.token_budget && c.token_budget.max_tokens_global;
    var globalClass = '';
    if (globalBudget) {
      var ratio = tu.global.total_tokens / globalBudget;
      if (ratio >= 1) globalClass = ' danger';
      else if (ratio >= 0.8) globalClass = ' warning';
    }
    var html = '<div class="section-header"><h2>Token Usage</h2></div><div class="token-bar">' +
      '<div class="token-stat"><div class="label">Input</div><div class="value">' + fmtTokens(tu.global.input_tokens) + '</div></div>' +
      '<div class="token-divider"></div>' +
      '<div class="token-stat"><div class="label">Output</div><div class="value">' + fmtTokens(tu.global.output_tokens) + '</div></div>' +
      '<div class="token-divider"></div>' +
      '<div class="token-stat"><div class="label">Total</div><div class="value' + globalClass + '">' + fmtTokens(tu.global.total_tokens) +
      (globalBudget ? ' / ' + fmtTokens(globalBudget) : '') + '</div></div>';
    var issueNums = Object.keys(tu.byIssue);
    if (issueNums.length > 0) {
      html += '<div class="token-divider"></div>';
      var perIssueBudget = c.token_budget && c.token_budget.max_tokens_per_issue;
      issueNums.forEach(function(num) {
        var iu = tu.byIssue[num];
        var ic = '';
        if (perIssueBudget) {
          var ir = iu.total_tokens / perIssueBudget;
          if (ir >= 1) ic = ' danger';
          else if (ir >= 0.8) ic = ' warning';
        }
        html += '<div class="token-stat"><div class="label">#' + num + '</div><div class="value' + ic + '">' + fmtTokens(iu.total_tokens) +
          (perIssueBudget ? ' / ' + fmtTokens(perIssueBudget) : '') + '</div></div>';
      });
    }
    html += '</div>';
    document.getElementById('token-section').innerHTML = html;
  }

  var running = state.running || [];
  document.getElementById('running-count').textContent = running.length;
  if (running.length === 0) {
    document.getElementById('running-list').innerHTML = '<div class="empty-state">No active runs</div>';
  } else {
    document.getElementById('running-list').innerHTML = running.map(function(r) {
      var sc = statusClass(r.status);
      return '<div class="card">' +
        '<div class="run-dot ' + sc + '"></div>' +
        '<div class="card-body">' +
          '<div class="card-title">#' + r.issue.number + ' ' + esc(r.issue.title) + '</div>' +
          '<div class="card-meta">Attempt ' + r.attempt + ' &middot; Turn ' + r.turn + ' &middot; Started ' + relTime(r.started_at) + (r.token_usage ? ' &middot; ' + fmtTokens(r.token_usage.total_tokens) + ' tokens' : '') + '</div>' +
        '</div>' +
        '<div class="card-status ' + sc + '">' + formatStatus(r.status) + '</div>' +
      '</div>';
    }).join('');
  }

  var retry = state.retryQueue || [];
  document.getElementById('retry-count').textContent = retry.length;
  if (retry.length === 0) {
    document.getElementById('retry-list').innerHTML = '<div class="empty-state">Retry queue is empty</div>';
  } else {
    document.getElementById('retry-list').innerHTML = retry.map(function(r) {
      return '<div class="card">' +
        '<div class="run-dot waiting"></div>' +
        '<div class="card-body">' +
          '<div class="card-title">#' + r.issue.number + ' ' + esc(r.issue.title) + '</div>' +
          '<div class="card-meta">Next attempt #' + r.attempt + ' &middot; Retry at ' + new Date(r.nextRetryAt).toLocaleTimeString() + '</div>' +
        '</div>' +
        '<div class="card-status waiting">pending retry</div>' +
      '</div>';
    }).join('');
  }

  var completed = state.completedRuns || [];
  document.getElementById('completed-count').textContent = completed.length;
  if (completed.length === 0) {
    document.getElementById('completed-list').innerHTML = '<div class="empty-state">No completed runs yet</div>';
  } else {
    document.getElementById('completed-list').innerHTML = completed.map(function(r) {
      var sc = r.status === 'completed' ? 'completed' : 'failed';
      return '<div class="card">' +
        '<div class="run-dot ' + sc + '"></div>' +
        '<div class="card-body">' +
          '<div class="card-title">#' + r.issue.number + ' ' + esc(r.issue.title) + '</div>' +
          '<div class="card-meta">Attempt ' + r.attempt + ' &middot; Turn ' + r.turn + ' &middot; Finished ' + relTime(r.finished_at) + (r.token_usage ? ' &middot; ' + fmtTokens(r.token_usage.total_tokens) + ' tokens' : '') + '</div>' +
        '</div>' +
        '<div class="card-status ' + sc + '">' + r.status + '</div>' +
      '</div>';
    }).join('');
  }
}

function setConnected(connected) {
  var dot = document.getElementById('conn-dot');
  var text = document.getElementById('conn-text');
  if (connected) {
    dot.className = 'status-dot connected';
    text.textContent = 'Connected';
  } else {
    dot.className = 'status-dot';
    text.textContent = 'Disconnected';
  }
}

function fetchState() {
  fetch('/api/v1/state')
    .then(function(r) { return r.json(); })
    .then(render)
    .catch(function(e) { console.error('Failed to fetch state', e); });
}

function triggerPoll() {
  var btn = document.getElementById('poll-btn');
  btn.disabled = true;
  fetch('/api/v1/refresh', { method: 'POST' })
    .then(function() { btn.disabled = false; })
    .catch(function() { btn.disabled = false; });
}

var es = new EventSource('/api/v1/events');
es.onopen = function() { setConnected(true); };
es.onmessage = function() { fetchState(); };
es.onerror = function() { setConnected(false); };

fetchState();
</script>
</body>
</html>`;
}

export function createApp(orchestrator: Orchestrator): express.Express {
  const app = express();

  app.use(express.json());

  // Dashboard
  app.get("/", (_req, res) => {
    res.type("html").send(dashboardHtml());
  });

  // State endpoint
  app.get("/api/v1/state", (_req, res) => {
    const state = orchestrator.getState();
    res.json({
      running: state.running,
      retryQueue: state.retryQueue,
      completedRuns: state.completedRuns,
      config: state.config,
      tokenUsage: state.tokenUsage,
    });
  });

  // Issue detail
  app.get("/api/v1/issues/:number", (req, res) => {
    const issueNumber = parseInt(req.params.number, 10);
    if (isNaN(issueNumber)) {
      res.status(400).json({ error: "Invalid issue number" });
      return;
    }

    const state = orchestrator.getState();

    const running = state.running.find((r) => r.issue.number === issueNumber);
    if (running) {
      res.json({ source: "running", data: running });
      return;
    }

    const retry = state.retryQueue.find((r) => r.issue.number === issueNumber);
    if (retry) {
      res.json({ source: "retryQueue", data: retry });
      return;
    }

    const completed = state.completedRuns.find(
      (r) => r.issue.number === issueNumber
    );
    if (completed) {
      res.json({ source: "completedRuns", data: completed });
      return;
    }

    res.status(404).json({ error: "Issue not found" });
  });

  // Trigger poll
  app.post("/api/v1/refresh", async (_req, res) => {
    try {
      await orchestrator.triggerPoll();
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Refresh trigger failed");
      res.status(500).json({ error: "Poll trigger failed" });
    }
  });

  // SSE events
  app.get("/api/v1/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const listener = (event: OrchestratorEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    orchestrator.addEventListener(listener);

    req.on("close", () => {
      orchestrator.removeEventListener(listener);
    });
  });

  return app;
}
