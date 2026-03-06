# Deferred Features

Features intentionally excluded from v1. Each section describes the feature, where it integrates, and what's needed to implement it.

## Hook System

**What:** Pre- and post-workspace lifecycle scripts (e.g., run `npm install` after clone, run linting before agent starts).

**Where it plugs in:** `workspace.ts` — after clone/branch creation and before agent launch. Config in `WORKFLOW.md` under a `hooks` key.

**Spec reference:** `hooks` front matter key with `pre_run` and `post_run` commands.

## Token Usage Rate Limiting / Budget Caps

**What:** Track cumulative token usage across sessions and enforce per-issue or global budgets. Stop dispatching when budget is exceeded.

**Where it plugs in:** `agent.ts` — accumulate token counts from SDK events. `orchestrator.ts` — check budget before dispatch. `types.ts` — add `token_usage` to `RunAttempt`. `api.ts` — expose aggregate usage in state endpoint.

**Spec reference:** Aggregate token usage tracking in orchestrator state, rate limit checks during dispatch.

## `$VAR` Environment Indirection in Config — ✅ Implemented

**What:** Allow `WORKFLOW.md` config values to reference environment variables (e.g., `root: $WORKSPACE_ROOT`), resolved at parse time.

**Where it plugs in:** `config.ts` — after YAML parsing, the `resolveEnvVars` helper walks all string values and replaces `$VAR` patterns with `process.env[VAR]`. Throws a clear error if a referenced variable is not set.

**Spec reference:** Config layer supports `$VAR` indirection for secret handling and deployment flexibility.
