# Deferred Features

Features intentionally excluded from v1. Each section describes the feature, where it integrates, and what's needed to implement it.

## ~~Hook System~~ ✅ Implemented

**What:** Pre- and post-workspace lifecycle scripts (e.g., run `npm install` after clone, run linting before agent starts).

**Where it plugs in:** `orchestrator.ts` — `pre_run` hooks execute after workspace creation and before agent launch; `post_run` hooks execute after agent completes. Config in `WORKFLOW.md` under a `hooks` key. Uses `execFileSync` for safety.

**Spec reference:** `hooks` front matter key with `pre_run` and `post_run` commands.

## Token Usage Rate Limiting / Budget Caps

**What:** Track cumulative token usage across sessions and enforce per-issue or global budgets. Stop dispatching when budget is exceeded.

**Where it plugs in:** `agent.ts` — accumulate token counts from SDK events. `orchestrator.ts` — check budget before dispatch. `types.ts` — add `token_usage` to `RunAttempt`. `api.ts` — expose aggregate usage in state endpoint.

**Spec reference:** Aggregate token usage tracking in orchestrator state, rate limit checks during dispatch.

## `$VAR` Environment Indirection in Config

**What:** Allow `WORKFLOW.md` config values to reference environment variables (e.g., `root: $WORKSPACE_ROOT`), resolved at parse time.

**Where it plugs in:** `config.ts` — during YAML parsing, detect `$VAR` patterns and substitute with `process.env[VAR]`.

**Spec reference:** Config layer supports `$VAR` indirection for secret handling and deployment flexibility.
