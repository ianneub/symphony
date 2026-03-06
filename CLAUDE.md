# Symphony

## What this is

A TypeScript service that polls GitHub Issues (labeled `agent`), creates isolated git workspaces per issue, and runs Claude Agent SDK sessions to address them. Inspired by the [OpenAI Symphony spec](https://github.com/openai/symphony/blob/main/SPEC.md), adapted for GitHub Issues + Claude.

## Architecture

Single-process async Node.js app. No worker threads. Concurrency managed via slot counting against `max_sessions`.

**Core loop:** poll GitHub → filter (running/blocked/in-backoff) → apply concurrency limit → dispatch (clone repo → render prompt → run agent → continuation or retry)

## Key files

| File | Purpose |
|------|---------|
| `src/orchestrator.ts` | Core poll/dispatch/retry/continuation loop |
| `src/agent.ts` | Claude Agent SDK integration (`query()`) |
| `src/github.ts` | Octokit REST + GraphQL (blockedBy) |
| `src/workspace.ts` | Per-issue git clone isolation |
| `src/config.ts` | WORKFLOW.md YAML front matter parser |
| `src/api.ts` | Express API + SSE + inline HTML dashboard |
| `src/types.ts` | All shared TypeScript types |
| `src/logger.ts` | Pino structured logging |
| `src/index.ts` | Entry point, env vars, graceful shutdown |

## Commands

- `npm run dev` — run with tsx (hot reload)
- `npm run build` — compile TypeScript to dist/
- `npm start` — run compiled JS
- `npm test` — run vitest
- `npm run test:watch` — vitest watch mode

## Environment variables

- `GITHUB_TOKEN` — required for GitHub API and repo cloning (private repos use token in clone URL)
- `ANTHROPIC_API_KEY` — required for Claude Agent SDK
- `WORKFLOW_PATH` — path to WORKFLOW.md (default: `./WORKFLOW.md`)
- `PORT` — dashboard port (default: 3000)
- `LOG_LEVEL` — pino log level (default: info)
- `NODE_ENV` — set to `production` to disable pino-pretty

## Config

All runtime config lives in `WORKFLOW.md` (YAML front matter + prompt template). Config reloads dynamically without restart. See the file for the full schema.

## Design decisions

- **GitHub Issues over Linear** — uses labels for filtering, GraphQL `blockedBy` for blocking relationships
- **Claude Agent SDK over CLI** — `@anthropic-ai/claude-agent-sdk` provides typed async iterator, session resume for continuation turns
- **SSE over WebSocket** — one-way push for dashboard, simpler than WebSocket, auto-reconnect built into EventSource
- **`execFileSync` over `execSync`** — prevents command injection in workspace git operations
- **Authenticated clone URL** — `https://x-access-token:${token}@github.com/...` for private repo support

## Testing

Tests use vitest. Current coverage is utility functions only (config parsing, workspace paths, backoff calculation, issue normalization). Integration tests for API and orchestrator are tracked in issue #5.

## Open issues

See https://github.com/ianneub/symphony/issues for outstanding work. Issues labeled `agent` are intended for Symphony to work on itself.

## Docs

- `docs/plans/2026-03-06-symphony-design.md` — approved design document
- `docs/plans/2026-03-06-symphony-implementation.md` — implementation plan (completed)
- `docs/deferred.md` — features deferred from v1 (hooks, token budgets, $VAR indirection)

## Conventions

- ESM (`"type": "module"` in package.json)
- Use `.js` extensions in all TypeScript imports (NodeNext module resolution)
- Flat `src/` directory — one file per concern
- Commits use conventional commit prefixes (`feat:`, `fix:`, `docs:`)
- Co-author trailer: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
