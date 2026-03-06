# Deferred Features

Features intentionally excluded from v1. Each section describes the feature, where it integrates, and what's needed to implement it.

## Hook System

**What:** Pre- and post-workspace lifecycle scripts (e.g., run `npm install` after clone, run linting before agent starts).

**Where it plugs in:** `workspace.ts` — after clone/branch creation and before agent launch. Config in `WORKFLOW.md` under a `hooks` key.

**Spec reference:** `hooks` front matter key with `pre_run` and `post_run` commands.

## ~~Token Usage Rate Limiting / Budget Caps~~ (Implemented)

**Status:** Implemented in issue #8.

**What was done:**
- Added `TokenUsage` type and `token_usage` field to `RunAttempt` and `CompletedRun` in `types.ts`
- Added optional `token_budget` config (`max_tokens_per_issue`, `max_tokens_global`) to `WorkflowConfig`
- Agent SDK token usage events are accumulated in `agent.ts` and returned in `AgentResult`
- Budget checks (per-issue and global) run before dispatch in `orchestrator.ts`; a `budget_exceeded` event is emitted when limits are hit
- Aggregate token usage (global and per-issue) exposed in `/api/v1/state` endpoint
- Dashboard displays token usage summary and per-run token counts

## `$VAR` Environment Indirection in Config

**What:** Allow `WORKFLOW.md` config values to reference environment variables (e.g., `root: $WORKSPACE_ROOT`), resolved at parse time.

**Where it plugs in:** `config.ts` — during YAML parsing, detect `$VAR` patterns and substitute with `process.env[VAR]`.

**Spec reference:** Config layer supports `$VAR` indirection for secret handling and deployment flexibility.
