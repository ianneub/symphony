# Symphony Design Document

**Date:** 2026-03-06
**Status:** Approved

## Overview

Symphony is a long-running TypeScript service that polls GitHub Issues, creates isolated workspaces per issue, and runs Claude Code agent sessions to address them. It is based on the [Symphony Service Specification](https://github.com/openai/symphony/blob/main/SPEC.md), adapted to use GitHub Issues (instead of Linear) and the Claude Code SDK (instead of Codex CLI).

## Stack

- **Language:** TypeScript (Node.js)
- **Agent:** Claude Code SDK (`@anthropic-ai/claude-agent-sdk`)
- **GitHub:** Octokit (REST + GraphQL)
- **HTTP:** Express
- **Logging:** Pino (structured JSON)
- **Dashboard:** Server-rendered HTML with SSE for live updates

## Core Flow

1. Parse `WORKFLOW.md` (YAML front matter + prompt template)
2. Poll GitHub for open issues with a configured label
3. Filter out blocked issues (via GraphQL `blockedBy`), already-running, and in-backoff
4. Apply concurrency limit, dispatch eligible issues
5. For each issue: clone repo, create branch, render prompt, run Claude Code SDK
6. On normal completion: check if issue still active, schedule continuation turn (up to max)
7. On failure: exponential backoff retry (10s x 2^(n-1), capped at 5min)
8. Dynamic config reload by detecting `WORKFLOW.md` changes each poll cycle
9. Express server with JSON API, SSE event stream, and server-rendered dashboard

## Architecture

Single-process, async Node.js application. All concurrency is handled via async/await with a semaphore pattern for capping concurrent agent sessions. No worker threads or child processes beyond the Claude Code SDK internals.

## Project Structure

```
symphony/
├── package.json
├── tsconfig.json
├── Dockerfile
├── WORKFLOW.md              # example/default workflow
├── src/
│   ├── index.ts             # entry point, CLI arg parsing
│   ├── config.ts            # typed config, WORKFLOW.md parsing
│   ├── orchestrator.ts      # poll loop, dispatch, retry state
│   ├── github.ts            # GitHub Issues client (Octokit)
│   ├── workspace.ts         # per-issue directory management
│   ├── agent.ts             # Claude Code SDK integration
│   ├── api.ts               # Express JSON API + SSE + dashboard
│   ├── logger.ts            # structured logging
│   └── types.ts             # shared type definitions
├── docs/
│   ├── plans/               # design and implementation plans
│   └── deferred.md          # features deferred to later versions
└── test/
    └── ...
```

## Domain Model

### Issue

```typescript
interface Issue {
  id: number;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url: string;
  blocked_by: { number: number; title: string; state: string }[];
  created_at: string;
  updated_at: string;
}
```

### WorkflowConfig

```typescript
interface WorkflowConfig {
  github: {
    owner: string;
    repo: string;
    label: string;            // label to filter on (e.g., "agent")
  };
  polling: {
    interval_seconds: number; // default: 30
  };
  workspace: {
    root: string;             // base directory for workspaces
  };
  agent: {
    timeout_seconds: number;  // max time per agent session
    max_continuation_turns: number;
  };
  concurrency: {
    max_sessions: number;     // default: 1
  };
  // DEFERRED: hooks (pre/post workspace scripts)
  // DEFERRED: token_budget (rate limiting / caps)
}
```

### RunAttempt

```typescript
interface RunAttempt {
  issue: Issue;
  status: RunStatus;
  attempt: number;
  turn: number;
  started_at: Date;
  workspace_path: string;
  // DEFERRED: token_usage tracking
}

type RunStatus =
  | "preparing_workspace"
  | "building_prompt"
  | "running_agent"
  | "waiting_continuation"
  | "finishing"
  | "completed"
  | "failed"
  | "retrying";
```

## Orchestrator

### In-Memory State

```typescript
interface OrchestratorState {
  running: Map<number, RunAttempt>;
  retryQueue: Map<number, RetryEntry>;
  config: WorkflowConfig;
  configLastModified: Date;
}

interface RetryEntry {
  issue: Issue;
  attempt: number;
  nextRetryAt: Date;
}
```

### Poll Cycle

Each cycle (every `polling.interval_seconds`):

1. Re-read `WORKFLOW.md` if file has changed
2. Reconcile active runs (check for completions)
3. Fetch open issues with target label from GitHub
4. Filter out: already running, blocked by open issues, in retry backoff window
5. Apply concurrency limit
6. Dispatch eligible issues

### Continuation Turns

When an agent session completes normally:

1. Check if issue is still open with target label
2. If yes and `turn < max_continuation_turns`, schedule continuation (1s delay)
3. Reuse same workspace, increment turn counter
4. If max turns reached or issue closed/label removed, mark as completed

### Failure Retries

When an agent session errors:

1. Increment attempt counter
2. Calculate backoff: `min(10_000 * 2^(attempt-1), 300_000)` (capped at 5 min)
3. Add to retry queue
4. Dispatch on next poll if backoff window has passed

## Workspace Manager

### Directory Structure

```
<workspace_root>/
├── issue-42/          # sanitized: "issue-{number}"
│   └── <repo clone>
├── issue-108/
│   └── <repo clone>
└── ...
```

### Lifecycle

1. **Create:** `git clone --depth=1`, create branch `symphony/issue-{number}`
2. **Reuse:** On continuation turns, reuse workspace and branch (pull latest from main)
3. **Cleanup:** When issue reaches terminal state, delete workspace directory

### Safety Invariants

- Directory names sanitized to `issue-{number}` (digits only)
- All workspace paths validated to be under `workspace_root`
- Agent sessions only launch with `cwd` set to workspace path

## Agent Integration

Uses `@anthropic-ai/claude-agent-sdk`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

async function runAgent(workspace: string, prompt: string, options: AgentOptions) {
  const events = query({
    prompt,
    options: {
      cwd: workspace,
      maxTurns: options.maxTurns,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    },
  });

  for await (const event of events) {
    // Track status, token usage, errors
    // Update RunAttempt state
    // Log structured events
  }
}
```

### Prompt Construction

`WORKFLOW.md` prompt template rendered with `{{variable}}` substitution using the `issue` object and `attempt`/`turn` numbers.

### Timeout

Each agent session wrapped in a timeout. On timeout, session is aborted and treated as a failure (enters retry with backoff).

## GitHub Client

- **REST (Octokit):** List open issues filtered by label, check issue state
- **GraphQL:** Enrich issues with `blockedBy` relationships
- **Auth:** `GITHUB_TOKEN` environment variable

## API + Dashboard

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/state` | Running sessions, retry queue, config summary |
| GET | `/api/v1/issues/:number` | Details for a specific issue's run |
| POST | `/api/v1/refresh` | Trigger immediate poll cycle |
| GET | `/api/v1/events` | SSE stream of state changes |
| GET | `/` | Dashboard HTML page |

### Dashboard

Server-rendered HTML page with inline JavaScript that connects to the SSE endpoint (`/api/v1/events`). Updates in real-time as orchestrator state changes. Shows active runs, retry queue, and recent completions/failures.

## Logging

Structured JSON to stdout via Pino. Every log entry includes contextual fields (issue number, attempt, turn, workspace). Log level configurable via `LOG_LEVEL` environment variable.

## Configuration Sources (precedence order)

1. CLI arguments / environment variables
2. `WORKFLOW.md` front matter values
3. Built-in defaults

## Deferred Features

See [docs/deferred.md](../deferred.md) for features intentionally deferred:

- Hook system (pre/post workspace scripts)
- Token usage rate limiting / budget caps
- `$VAR` environment indirection in config
