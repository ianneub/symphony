# Symphony

Symphony is a TypeScript service that polls GitHub Issues for a configurable label, creates isolated git workspaces per issue, and runs Claude Agent SDK sessions to address them. It supports multi-turn continuation, exponential backoff retries, and provides a live dashboard.

## Quick Start

```bash
npm install
```

Create a `WORKFLOW.md` in the project root (see [Configuration Reference](#configuration-reference) below).

Set your GitHub token:

```bash
export GITHUB_TOKEN=ghp_...
```

Run in development:

```bash
npm run dev
```

Run in production:

```bash
npm run build
npm start
```

The dashboard is available at [http://localhost:3000](http://localhost:3000).

## Configuration Reference

Symphony is configured via a `WORKFLOW.md` file that combines YAML front matter (settings) with a Markdown body (prompt template).

```markdown
---
github:
  owner: your-org        # required
  repo: your-repo        # required
  label: agent           # default: "agent"
polling:
  interval_seconds: 30   # default: 30
workspace:
  root: ./workspaces     # default: "./workspaces"
agent:
  timeout_seconds: 600   # default: 600
  max_continuation_turns: 5  # default: 5
concurrency:
  max_sessions: 1        # default: 1
---

Your prompt template goes here. Use {{issue.number}}, {{issue.title}},
{{issue.body}}, {{attempt}}, and {{turn}} for variable substitution.
```

`github.owner` and `github.repo` are required. All other fields have defaults as shown above.

The file is re-read each poll cycle, so changes take effect without restarting the service.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub personal access token for API access | none (warns if unset) |
| `WORKFLOW_PATH` | Path to the workflow config file | `WORKFLOW.md` |
| `PORT` | HTTP server port | `3000` |
| `LOG_LEVEL` | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) | `info` |
| `NODE_ENV` | Set to `production` for JSON log output; otherwise uses pretty-printed logs | none |

## Dashboard

The dashboard is served at `http://localhost:3000` (or your configured `PORT`). It renders a live view of active agent sessions, the retry queue, and recent completions/failures, updated in real-time via Server-Sent Events.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/state` | Full orchestrator state: running sessions, retry queue, config summary |
| `GET` | `/api/v1/issues/:number` | Details for a specific issue's current run |
| `POST` | `/api/v1/refresh` | Trigger an immediate poll cycle |
| `GET` | `/api/v1/events` | SSE stream of orchestrator state changes |
| `GET` | `/` | Dashboard HTML page |

## Docker

Build:

```bash
docker build -t symphony .
```

Run:

```bash
docker run -p 3000:3000 \
  -e GITHUB_TOKEN=ghp_... \
  -v $(pwd)/WORKFLOW.md:/app/WORKFLOW.md \
  symphony
```

## How It Works

1. **Poll** -- Each cycle, Symphony fetches open GitHub issues matching the configured label.
2. **Filter** -- Issues that are already running, blocked by other open issues (via GitHub's `blockedBy` relationships), or in a retry backoff window are excluded.
3. **Dispatch** -- Eligible issues are dispatched up to the concurrency limit. Each gets a shallow clone of the repo on a dedicated branch (`symphony/issue-{number}`).
4. **Agent** -- The Claude Agent SDK runs against the workspace with the rendered prompt template. The agent can read, write, edit files, and run shell commands.
5. **Continuation** -- On normal completion, if the issue is still open and labeled, Symphony schedules another turn (up to `max_continuation_turns`) reusing the same workspace.
6. **Retry** -- On failure, the issue enters an exponential backoff queue (10s, 20s, 40s, ... capped at 5 minutes) and is retried on a subsequent poll cycle.
