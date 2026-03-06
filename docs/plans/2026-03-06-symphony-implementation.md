# Symphony Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript service that polls GitHub Issues, creates isolated workspaces, and runs Claude Agent SDK sessions to address them.

**Architecture:** Single-process async Node.js app. Orchestrator polls GitHub on a timer, dispatches agent sessions as async tasks capped by a semaphore, tracks all state in memory. Express serves a JSON API + SSE event stream + HTML dashboard.

**Tech Stack:** TypeScript, Node.js, `@anthropic-ai/claude-agent-sdk`, `octokit`, `express`, `pino`, `gray-matter` (YAML front matter parsing), `vitest` (testing)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.gitignore`

**Step 1: Initialize the project**

```bash
cd /Users/ianneub/Downloads/symphony
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install @anthropic-ai/claude-agent-sdk octokit express pino gray-matter
npm install -D typescript @types/node @types/express vitest tsx
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
workspaces/
*.log
.env
```

**Step 5: Create minimal src/index.ts**

```typescript
console.log("Symphony starting...");
```

**Step 6: Add scripts to package.json**

Set `"type": "module"` and add:
```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Step 7: Verify it runs**

Run: `npm run dev`
Expected: prints "Symphony starting..."

**Step 8: Commit**

```bash
git add package.json tsconfig.json src/index.ts .gitignore package-lock.json
git commit -m "feat: scaffold TypeScript project with dependencies"
```

---

### Task 2: Types Module

**Files:**
- Create: `src/types.ts`

**Step 1: Write the types file**

```typescript
export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url: string;
  blocked_by: BlockingIssue[];
  created_at: string;
  updated_at: string;
}

export interface BlockingIssue {
  number: number;
  title: string;
  state: string;
}

export interface WorkflowConfig {
  github: {
    owner: string;
    repo: string;
    label: string;
  };
  polling: {
    interval_seconds: number;
  };
  workspace: {
    root: string;
  };
  agent: {
    timeout_seconds: number;
    max_continuation_turns: number;
  };
  concurrency: {
    max_sessions: number;
  };
}

export interface RunAttempt {
  issue: Issue;
  status: RunStatus;
  attempt: number;
  turn: number;
  started_at: Date;
  workspace_path: string;
  session_id?: string;
}

export type RunStatus =
  | "preparing_workspace"
  | "building_prompt"
  | "running_agent"
  | "waiting_continuation"
  | "finishing"
  | "completed"
  | "failed"
  | "retrying";

export interface RetryEntry {
  issue: Issue;
  attempt: number;
  nextRetryAt: Date;
}

export interface OrchestratorState {
  running: Map<number, RunAttempt>;
  retryQueue: Map<number, RetryEntry>;
  completedRuns: CompletedRun[];
  config: WorkflowConfig;
  promptTemplate: string;
  configLastModified: number;
}

export interface CompletedRun {
  issue: Issue;
  status: "completed" | "failed";
  attempt: number;
  turn: number;
  finished_at: Date;
}

export type OrchestratorEvent =
  | { type: "run_started"; issue: Issue; attempt: number }
  | { type: "run_status_changed"; issueNumber: number; status: RunStatus }
  | { type: "run_completed"; issueNumber: number; turn: number }
  | { type: "run_failed"; issueNumber: number; error: string }
  | { type: "retry_scheduled"; issueNumber: number; nextRetryAt: Date }
  | { type: "config_reloaded" }
  | { type: "poll_completed"; issueCount: number };
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add core type definitions"
```

---

### Task 3: Logger Module

**Files:**
- Create: `src/logger.ts`

**Step 1: Write the logger**

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function issueLogger(issueNumber: number) {
  return logger.child({ issue: issueNumber });
}
```

**Step 2: Install pino-pretty for dev**

```bash
npm install -D pino-pretty
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/logger.ts package.json package-lock.json
git commit -m "feat: add structured logging with pino"
```

---

### Task 4: Config / Workflow Loader

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`
- Create: `test/fixtures/valid-workflow.md`
- Create: `test/fixtures/minimal-workflow.md`

**Step 1: Create test fixtures**

`test/fixtures/valid-workflow.md`:
````markdown
---
github:
  owner: testorg
  repo: testrepo
  label: agent
polling:
  interval_seconds: 15
workspace:
  root: ./workspaces
agent:
  timeout_seconds: 300
  max_continuation_turns: 3
concurrency:
  max_sessions: 2
---

You are working on issue #{{issue.number}}: {{issue.title}}

{{issue.body}}

Create a branch, make changes, commit, and open a PR when done.
````

`test/fixtures/minimal-workflow.md` (uses defaults):
````markdown
---
github:
  owner: testorg
  repo: testrepo
---

Fix issue #{{issue.number}}: {{issue.title}}
````

**Step 2: Write the failing tests**

`test/config.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { loadWorkflow, renderPrompt } from "../src/config.js";
import { resolve } from "path";

describe("loadWorkflow", () => {
  it("parses a full WORKFLOW.md with all fields", () => {
    const result = loadWorkflow(resolve(__dirname, "fixtures/valid-workflow.md"));
    expect(result.config.github.owner).toBe("testorg");
    expect(result.config.github.repo).toBe("testrepo");
    expect(result.config.github.label).toBe("agent");
    expect(result.config.polling.interval_seconds).toBe(15);
    expect(result.config.workspace.root).toBe("./workspaces");
    expect(result.config.agent.timeout_seconds).toBe(300);
    expect(result.config.agent.max_continuation_turns).toBe(3);
    expect(result.config.concurrency.max_sessions).toBe(2);
    expect(result.promptTemplate).toContain("{{issue.number}}");
    expect(result.lastModified).toBeGreaterThan(0);
  });

  it("applies defaults for missing optional fields", () => {
    const result = loadWorkflow(resolve(__dirname, "fixtures/minimal-workflow.md"));
    expect(result.config.github.label).toBe("agent");
    expect(result.config.polling.interval_seconds).toBe(30);
    expect(result.config.workspace.root).toBe("./workspaces");
    expect(result.config.agent.timeout_seconds).toBe(600);
    expect(result.config.agent.max_continuation_turns).toBe(5);
    expect(result.config.concurrency.max_sessions).toBe(1);
  });

  it("throws on missing required github.owner", () => {
    expect(() =>
      loadWorkflow(resolve(__dirname, "fixtures/invalid-workflow.md"))
    ).toThrow();
  });
});

describe("renderPrompt", () => {
  it("substitutes issue fields into the template", () => {
    const template = "Fix #{{issue.number}}: {{issue.title}}\n{{issue.body}}";
    const result = renderPrompt(template, {
      issue: { number: 42, title: "Bug fix", body: "Details here" },
      attempt: 1,
      turn: 1,
    });
    expect(result).toBe("Fix #42: Bug fix\nDetails here");
  });

  it("substitutes attempt and turn", () => {
    const template = "Attempt {{attempt}}, turn {{turn}}";
    const result = renderPrompt(template, {
      issue: { number: 1, title: "", body: "" },
      attempt: 3,
      turn: 2,
    });
    expect(result).toBe("Attempt 3, turn 2");
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — module not found

**Step 4: Write the config module**

`src/config.ts`:
```typescript
import matter from "gray-matter";
import { readFileSync, statSync } from "fs";
import type { WorkflowConfig } from "./types.js";

const DEFAULTS: Omit<WorkflowConfig, "github"> = {
  polling: { interval_seconds: 30 },
  workspace: { root: "./workspaces" },
  agent: { timeout_seconds: 600, max_continuation_turns: 5 },
  concurrency: { max_sessions: 1 },
};

export interface WorkflowLoadResult {
  config: WorkflowConfig;
  promptTemplate: string;
  lastModified: number;
}

export function loadWorkflow(filePath: string): WorkflowLoadResult {
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  if (!data.github?.owner || !data.github?.repo) {
    throw new Error("WORKFLOW.md must specify github.owner and github.repo");
  }

  const config: WorkflowConfig = {
    github: {
      owner: data.github.owner,
      repo: data.github.repo,
      label: data.github.label ?? DEFAULTS.polling && "agent",
    },
    polling: {
      interval_seconds:
        data.polling?.interval_seconds ?? DEFAULTS.polling.interval_seconds,
    },
    workspace: {
      root: data.workspace?.root ?? DEFAULTS.workspace.root,
    },
    agent: {
      timeout_seconds:
        data.agent?.timeout_seconds ?? DEFAULTS.agent.timeout_seconds,
      max_continuation_turns:
        data.agent?.max_continuation_turns ??
        DEFAULTS.agent.max_continuation_turns,
    },
    concurrency: {
      max_sessions:
        data.concurrency?.max_sessions ?? DEFAULTS.concurrency.max_sessions,
    },
  };

  const stat = statSync(filePath);

  return {
    config,
    promptTemplate: content.trim(),
    lastModified: stat.mtimeMs,
  };
}

interface PromptContext {
  issue: { number: number; title: string; body: string; [key: string]: unknown };
  attempt: number;
  turn: number;
}

export function renderPrompt(template: string, ctx: PromptContext): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let value: unknown = ctx;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return "";
      value = (value as Record<string, unknown>)[part];
    }
    return String(value ?? "");
  });
}
```

**Step 5: Create invalid fixture for error test**

Create `test/fixtures/invalid-workflow.md`:
````markdown
---
polling:
  interval_seconds: 10
---

No github config here.
````

**Step 6: Run tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: all PASS

**Step 7: Commit**

```bash
git add src/config.ts test/
git commit -m "feat: add WORKFLOW.md parser with defaults and template rendering"
```

---

### Task 5: GitHub Client

**Files:**
- Create: `src/github.ts`
- Create: `test/github.test.ts`

**Step 1: Write the failing tests**

`test/github.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { normalizeIssue, isBlocked } from "../src/github.js";

describe("normalizeIssue", () => {
  it("normalizes a GitHub REST issue response", () => {
    const raw = {
      id: 1,
      number: 42,
      title: "Fix bug",
      body: "Description",
      labels: [{ name: "agent" }, { name: "bug" }],
      state: "open",
      html_url: "https://github.com/org/repo/issues/42",
      created_at: "2026-03-06T00:00:00Z",
      updated_at: "2026-03-06T01:00:00Z",
    };
    const result = normalizeIssue(raw, []);
    expect(result.number).toBe(42);
    expect(result.labels).toEqual(["agent", "bug"]);
    expect(result.blocked_by).toEqual([]);
  });
});

describe("isBlocked", () => {
  it("returns false when no blockers", () => {
    expect(isBlocked({ blocked_by: [] } as any)).toBe(false);
  });

  it("returns true when blocked by open issue", () => {
    expect(
      isBlocked({
        blocked_by: [{ number: 10, title: "Blocker", state: "OPEN" }],
      } as any)
    ).toBe(true);
  });

  it("returns false when blocker is closed", () => {
    expect(
      isBlocked({
        blocked_by: [{ number: 10, title: "Blocker", state: "CLOSED" }],
      } as any)
    ).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/github.test.ts`
Expected: FAIL

**Step 3: Write the GitHub client**

`src/github.ts`:
```typescript
import { Octokit } from "octokit";
import type { Issue, BlockingIssue } from "./types.js";
import { logger } from "./logger.js";

let octokit: Octokit;

export function initGitHub(token?: string) {
  octokit = new Octokit({ auth: token ?? process.env.GITHUB_TOKEN });
}

export function normalizeIssue(
  raw: Record<string, any>,
  blockedBy: BlockingIssue[]
): Issue {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    labels: (raw.labels ?? []).map((l: any) =>
      typeof l === "string" ? l : l.name
    ),
    state: raw.state as "open" | "closed",
    url: raw.html_url,
    blocked_by: blockedBy,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function isBlocked(issue: Issue): boolean {
  return issue.blocked_by.some((b) => b.state === "OPEN");
}

export async function fetchIssues(
  owner: string,
  repo: string,
  label: string
): Promise<Issue[]> {
  const log = logger.child({ component: "github" });

  // Fetch open issues with the target label via REST
  const { data: rawIssues } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: label,
    state: "open",
    per_page: 100,
  });

  // Filter out pull requests (GitHub REST API returns PRs in issues endpoint)
  const issuesOnly = rawIssues.filter((i) => !i.pull_request);

  if (issuesOnly.length === 0) {
    return [];
  }

  // Fetch blockedBy relationships via GraphQL
  const issueNumbers = issuesOnly.map((i) => i.number);
  const blockedByMap = await fetchBlockedBy(owner, repo, issueNumbers);

  const issues = issuesOnly.map((raw) =>
    normalizeIssue(raw, blockedByMap.get(raw.number) ?? [])
  );

  log.info({ count: issues.length }, "Fetched issues from GitHub");
  return issues;
}

async function fetchBlockedBy(
  owner: string,
  repo: string,
  issueNumbers: number[]
): Promise<Map<number, BlockingIssue[]>> {
  const result = new Map<number, BlockingIssue[]>();

  // GraphQL query to fetch blockedBy for multiple issues
  // We batch them to avoid hitting query complexity limits
  for (const num of issueNumbers) {
    try {
      const response: any = await octokit.graphql(
        `query($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $number) {
              blockedBy(first: 10) {
                nodes {
                  number
                  title
                  state
                }
              }
            }
          }
        }`,
        { owner, repo, number: num }
      );

      const nodes = response.repository.issue.blockedBy.nodes ?? [];
      result.set(
        num,
        nodes.map((n: any) => ({
          number: n.number,
          title: n.title,
          state: n.state,
        }))
      );
    } catch (err) {
      logger.warn({ issue: num, err }, "Failed to fetch blockedBy");
      result.set(num, []);
    }
  }

  return result;
}

export async function isIssueActive(
  owner: string,
  repo: string,
  issueNumber: number,
  label: string
): Promise<boolean> {
  try {
    const { data } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    if (data.state !== "open") return false;

    const labels = (data.labels ?? []).map((l: any) =>
      typeof l === "string" ? l : l.name
    );
    return labels.includes(label);
  } catch {
    return false;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/github.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add src/github.ts test/github.test.ts
git commit -m "feat: add GitHub client with issue fetching and blockedBy support"
```

---

### Task 6: Workspace Manager

**Files:**
- Create: `src/workspace.ts`
- Create: `test/workspace.test.ts`

**Step 1: Write the failing tests**

`test/workspace.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  workspacePath,
  validateWorkspacePath,
  sanitizeIssueName,
} from "../src/workspace.js";

describe("sanitizeIssueName", () => {
  it("creates a safe directory name from issue number", () => {
    expect(sanitizeIssueName(42)).toBe("issue-42");
  });
});

describe("workspacePath", () => {
  it("joins root and sanitized issue name", () => {
    expect(workspacePath("/workspaces", 42)).toBe("/workspaces/issue-42");
  });
});

describe("validateWorkspacePath", () => {
  it("accepts paths under the root", () => {
    expect(() =>
      validateWorkspacePath("/workspaces", "/workspaces/issue-42")
    ).not.toThrow();
  });

  it("rejects paths outside the root", () => {
    expect(() =>
      validateWorkspacePath("/workspaces", "/etc/passwd")
    ).toThrow("outside workspace root");
  });

  it("rejects path traversal attempts", () => {
    expect(() =>
      validateWorkspacePath("/workspaces", "/workspaces/../etc/passwd")
    ).toThrow("outside workspace root");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/workspace.test.ts`
Expected: FAIL

**Step 3: Write the workspace manager**

`src/workspace.ts`:
```typescript
import { execSync } from "child_process";
import { existsSync, rmSync, mkdirSync } from "fs";
import { resolve, relative } from "path";
import { logger } from "./logger.js";

export function sanitizeIssueName(issueNumber: number): string {
  return `issue-${issueNumber}`;
}

export function workspacePath(root: string, issueNumber: number): string {
  return resolve(root, sanitizeIssueName(issueNumber));
}

export function validateWorkspacePath(root: string, wsPath: string): void {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(wsPath);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel.startsWith("..") || resolve(resolvedRoot, rel) !== resolvedPath) {
    throw new Error(`Workspace path ${wsPath} is outside workspace root ${root}`);
  }
}

export async function createWorkspace(
  root: string,
  issueNumber: number,
  repoUrl: string,
  defaultBranch: string = "main"
): Promise<string> {
  const wsPath = workspacePath(root, issueNumber);
  validateWorkspacePath(root, wsPath);

  const log = logger.child({ issue: issueNumber, workspace: wsPath });

  if (!existsSync(resolve(root))) {
    mkdirSync(resolve(root), { recursive: true });
  }

  if (existsSync(wsPath)) {
    log.info("Workspace already exists, reusing");
    // Pull latest from default branch
    try {
      execSync(`git fetch origin ${defaultBranch} && git rebase origin/${defaultBranch}`, {
        cwd: wsPath,
        stdio: "pipe",
      });
    } catch (err) {
      log.warn({ err }, "Failed to pull latest, continuing with existing workspace");
    }
    return wsPath;
  }

  log.info("Creating workspace");
  execSync(`git clone --depth=1 ${repoUrl} ${wsPath}`, { stdio: "pipe" });

  const branchName = `symphony/issue-${issueNumber}`;
  execSync(`git checkout -b ${branchName}`, { cwd: wsPath, stdio: "pipe" });

  log.info({ branch: branchName }, "Workspace created");
  return wsPath;
}

export function cleanupWorkspace(root: string, issueNumber: number): void {
  const wsPath = workspacePath(root, issueNumber);
  validateWorkspacePath(root, wsPath);

  if (existsSync(wsPath)) {
    rmSync(wsPath, { recursive: true, force: true });
    logger.info({ issue: issueNumber, workspace: wsPath }, "Workspace cleaned up");
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/workspace.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add src/workspace.ts test/workspace.test.ts
git commit -m "feat: add workspace manager with isolation and path safety"
```

---

### Task 7: Agent Runner

**Files:**
- Create: `src/agent.ts`
- Create: `test/agent.test.ts`

**Step 1: Write the failing tests**

`test/agent.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildAgentOptions } from "../src/agent.js";

describe("buildAgentOptions", () => {
  it("sets cwd to workspace path", () => {
    const opts = buildAgentOptions("/workspaces/issue-42", 600);
    expect(opts.cwd).toBe("/workspaces/issue-42");
  });

  it("includes standard allowed tools", () => {
    const opts = buildAgentOptions("/workspaces/issue-42", 600);
    expect(opts.allowedTools).toContain("Read");
    expect(opts.allowedTools).toContain("Write");
    expect(opts.allowedTools).toContain("Edit");
    expect(opts.allowedTools).toContain("Bash");
  });

  it("sets permission mode to acceptEdits", () => {
    const opts = buildAgentOptions("/workspaces/issue-42", 600);
    expect(opts.permissionMode).toBe("acceptEdits");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/agent.test.ts`
Expected: FAIL

**Step 3: Write the agent runner**

`src/agent.ts`:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunAttempt, OrchestratorEvent } from "./types.js";
import { logger } from "./logger.js";

export interface AgentOptions {
  cwd: string;
  allowedTools: string[];
  permissionMode: string;
  maxTurns?: number;
}

export function buildAgentOptions(
  workspacePath: string,
  _timeoutSeconds: number
): AgentOptions {
  return {
    cwd: workspacePath,
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "acceptEdits",
  };
}

export interface AgentResult {
  sessionId?: string;
  success: boolean;
  error?: string;
}

export async function runAgent(
  prompt: string,
  workspacePath: string,
  timeoutSeconds: number,
  resumeSessionId?: string,
  onEvent?: (event: OrchestratorEvent) => void
): Promise<AgentResult> {
  const log = logger.child({ workspace: workspacePath });
  const opts = buildAgentOptions(workspacePath, timeoutSeconds);

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    log.warn("Agent session timed out");
    abortController.abort();
  }, timeoutSeconds * 1000);

  let sessionId: string | undefined;

  try {
    const response = query({
      prompt,
      options: {
        cwd: opts.cwd,
        allowedTools: opts.allowedTools,
        permissionMode: opts.permissionMode as any,
        abortController,
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      },
    });

    for await (const message of response) {
      if (
        message.type === "system" &&
        (message as any).subtype === "init"
      ) {
        sessionId = (message as any).session_id;
        log.info({ sessionId }, "Agent session started");
      }

      // Log assistant results
      if ("result" in message) {
        log.debug({ result: (message as any).result }, "Agent result");
      }
    }

    clearTimeout(timeout);
    log.info({ sessionId }, "Agent session completed");
    return { sessionId, success: true };
  } catch (err) {
    clearTimeout(timeout);
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    log.error({ err: errorMessage, sessionId }, "Agent session failed");
    return { sessionId, success: false, error: errorMessage };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/agent.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add src/agent.ts test/agent.test.ts
git commit -m "feat: add agent runner with Claude Agent SDK integration"
```

---

### Task 8: Orchestrator

**Files:**
- Create: `src/orchestrator.ts`
- Create: `test/orchestrator.test.ts`

**Step 1: Write the failing tests**

`test/orchestrator.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { calculateBackoff, shouldRetry } from "../src/orchestrator.js";

describe("calculateBackoff", () => {
  it("returns 10s for first attempt", () => {
    expect(calculateBackoff(1)).toBe(10_000);
  });

  it("doubles each attempt", () => {
    expect(calculateBackoff(2)).toBe(20_000);
    expect(calculateBackoff(3)).toBe(40_000);
  });

  it("caps at 5 minutes", () => {
    expect(calculateBackoff(10)).toBe(300_000);
  });
});

describe("shouldRetry", () => {
  it("returns true when nextRetryAt is in the past", () => {
    const entry = { nextRetryAt: new Date(Date.now() - 1000) } as any;
    expect(shouldRetry(entry)).toBe(true);
  });

  it("returns false when nextRetryAt is in the future", () => {
    const entry = { nextRetryAt: new Date(Date.now() + 60_000) } as any;
    expect(shouldRetry(entry)).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/orchestrator.test.ts`
Expected: FAIL

**Step 3: Write the orchestrator**

`src/orchestrator.ts`:
```typescript
import type {
  Issue,
  RunAttempt,
  RetryEntry,
  OrchestratorState,
  OrchestratorEvent,
  CompletedRun,
  WorkflowConfig,
} from "./types.js";
import { loadWorkflow, renderPrompt } from "./config.js";
import { fetchIssues, isBlocked, isIssueActive } from "./github.js";
import { createWorkspace, cleanupWorkspace, workspacePath } from "./workspace.js";
import { runAgent } from "./agent.js";
import { logger } from "./logger.js";

const MAX_BACKOFF_MS = 300_000; // 5 minutes
const CONTINUATION_DELAY_MS = 1_000;
const MAX_COMPLETED_RUNS = 50;

export function calculateBackoff(attempt: number): number {
  return Math.min(10_000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
}

export function shouldRetry(entry: RetryEntry): boolean {
  return entry.nextRetryAt.getTime() <= Date.now();
}

export type EventListener = (event: OrchestratorEvent) => void;

export class Orchestrator {
  private state: OrchestratorState;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private workflowPath: string;
  private listeners: EventListener[] = [];

  constructor(workflowPath: string) {
    this.workflowPath = workflowPath;
    const { config, promptTemplate, lastModified } = loadWorkflow(workflowPath);
    this.state = {
      running: new Map(),
      retryQueue: new Map(),
      completedRuns: [],
      config,
      promptTemplate,
      configLastModified: lastModified,
    };
  }

  addEventListener(listener: EventListener): void {
    this.listeners.push(listener);
  }

  removeEventListener(listener: EventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private emit(event: OrchestratorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, "Event listener error");
      }
    }
  }

  getState(): {
    running: RunAttempt[];
    retryQueue: RetryEntry[];
    completedRuns: CompletedRun[];
    config: WorkflowConfig;
  } {
    return {
      running: Array.from(this.state.running.values()),
      retryQueue: Array.from(this.state.retryQueue.values()),
      completedRuns: this.state.completedRuns,
      config: this.state.config,
    };
  }

  start(): void {
    const interval = this.state.config.polling.interval_seconds * 1000;
    logger.info(
      { interval: this.state.config.polling.interval_seconds },
      "Starting orchestrator"
    );

    // Run first poll immediately
    this.poll();

    this.pollTimer = setInterval(() => this.poll(), interval);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info("Orchestrator stopped");
  }

  async triggerPoll(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    const log = logger.child({ component: "orchestrator" });

    try {
      // 1. Reload config if changed
      this.reloadConfigIfChanged();

      // 2. Fetch candidate issues
      const { github } = this.state.config;
      const issues = await fetchIssues(github.owner, github.repo, github.label);
      this.emit({ type: "poll_completed", issueCount: issues.length });

      // 3. Process retry queue
      for (const [issueNumber, entry] of this.state.retryQueue) {
        if (shouldRetry(entry)) {
          this.state.retryQueue.delete(issueNumber);
          log.info({ issue: issueNumber }, "Retrying issue");
          this.dispatch(entry.issue, entry.attempt);
        }
      }

      // 4. Filter and dispatch new issues
      const eligible = issues.filter((issue) => {
        if (this.state.running.has(issue.number)) return false;
        if (this.state.retryQueue.has(issue.number)) return false;
        if (isBlocked(issue)) {
          log.debug({ issue: issue.number }, "Issue is blocked, skipping");
          return false;
        }
        return true;
      });

      // 5. Apply concurrency limit
      const availableSlots =
        this.state.config.concurrency.max_sessions - this.state.running.size;
      const toDispatch = eligible.slice(0, Math.max(0, availableSlots));

      for (const issue of toDispatch) {
        this.dispatch(issue, 1);
      }
    } catch (err) {
      log.error({ err }, "Poll cycle error");
    }
  }

  private reloadConfigIfChanged(): void {
    try {
      const { config, promptTemplate, lastModified } = loadWorkflow(
        this.workflowPath
      );
      if (lastModified > this.state.configLastModified) {
        this.state.config = config;
        this.state.promptTemplate = promptTemplate;
        this.state.configLastModified = lastModified;
        logger.info("WORKFLOW.md reloaded");
        this.emit({ type: "config_reloaded" });

        // Restart poll timer if interval changed
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          const interval = config.polling.interval_seconds * 1000;
          this.pollTimer = setInterval(() => this.poll(), interval);
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to reload WORKFLOW.md");
    }
  }

  private async dispatch(issue: Issue, attempt: number, turn: number = 1, sessionId?: string): Promise<void> {
    const log = logger.child({ issue: issue.number, attempt, turn });
    const { config, promptTemplate } = this.state;

    const run: RunAttempt = {
      issue,
      status: "preparing_workspace",
      attempt,
      turn,
      started_at: new Date(),
      workspace_path: workspacePath(config.workspace.root, issue.number),
      session_id: sessionId,
    };

    this.state.running.set(issue.number, run);
    this.emit({ type: "run_started", issue, attempt });

    try {
      // Prepare workspace
      this.updateRunStatus(issue.number, "preparing_workspace");
      const repoUrl = `https://github.com/${config.github.owner}/${config.github.repo}.git`;
      const wsPath = await createWorkspace(
        config.workspace.root,
        issue.number,
        repoUrl
      );

      // Build prompt
      this.updateRunStatus(issue.number, "building_prompt");
      const prompt = renderPrompt(promptTemplate, {
        issue: { number: issue.number, title: issue.title, body: issue.body },
        attempt,
        turn,
      });

      // Run agent
      this.updateRunStatus(issue.number, "running_agent");
      log.info("Launching agent session");
      const result = await runAgent(
        prompt,
        wsPath,
        config.agent.timeout_seconds,
        sessionId,
        (event) => this.emit(event)
      );

      // Handle result
      this.updateRunStatus(issue.number, "finishing");

      if (result.success) {
        // Check for continuation
        if (turn < config.agent.max_continuation_turns) {
          const stillActive = await isIssueActive(
            config.github.owner,
            config.github.repo,
            issue.number,
            config.github.label
          );

          if (stillActive) {
            this.updateRunStatus(issue.number, "waiting_continuation");
            log.info({ nextTurn: turn + 1 }, "Scheduling continuation turn");
            this.state.running.delete(issue.number);

            setTimeout(() => {
              this.dispatch(issue, attempt, turn + 1, result.sessionId);
            }, CONTINUATION_DELAY_MS);
            return;
          }
        }

        // Completed
        this.state.running.delete(issue.number);
        this.addCompletedRun(issue, "completed", attempt, turn);
        this.emit({ type: "run_completed", issueNumber: issue.number, turn });
        log.info("Issue run completed");
      } else {
        throw new Error(result.error ?? "Agent session failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err: errorMessage }, "Run failed");

      this.state.running.delete(issue.number);
      this.addCompletedRun(issue, "failed", attempt, turn);
      this.emit({ type: "run_failed", issueNumber: issue.number, error: errorMessage });

      // Schedule retry with backoff
      const backoff = calculateBackoff(attempt);
      const nextRetryAt = new Date(Date.now() + backoff);
      this.state.retryQueue.set(issue.number, {
        issue,
        attempt: attempt + 1,
        nextRetryAt,
      });
      this.emit({ type: "retry_scheduled", issueNumber: issue.number, nextRetryAt });
      log.info({ backoff, nextRetryAt }, "Retry scheduled");
    }
  }

  private updateRunStatus(issueNumber: number, status: RunAttempt["status"]): void {
    const run = this.state.running.get(issueNumber);
    if (run) {
      run.status = status;
      this.emit({ type: "run_status_changed", issueNumber, status });
    }
  }

  private addCompletedRun(
    issue: Issue,
    status: "completed" | "failed",
    attempt: number,
    turn: number
  ): void {
    this.state.completedRuns.unshift({
      issue,
      status,
      attempt,
      turn,
      finished_at: new Date(),
    });
    // Keep only the most recent completed runs
    if (this.state.completedRuns.length > MAX_COMPLETED_RUNS) {
      this.state.completedRuns = this.state.completedRuns.slice(
        0,
        MAX_COMPLETED_RUNS
      );
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/orchestrator.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add src/orchestrator.ts test/orchestrator.test.ts
git commit -m "feat: add orchestrator with polling, dispatch, retries, and continuation"
```

---

### Task 9: API + SSE + Dashboard

**Files:**
- Create: `src/api.ts`

**Step 1: Write the API server**

`src/api.ts`:
```typescript
import express from "express";
import type { Orchestrator } from "./orchestrator.js";
import type { OrchestratorEvent } from "./types.js";
import { logger } from "./logger.js";

export function createApp(orchestrator: Orchestrator): express.Express {
  const app = express();

  // JSON API: state
  app.get("/api/v1/state", (_req, res) => {
    const state = orchestrator.getState();
    res.json({
      running: state.running.map((r) => ({
        issue: r.issue.number,
        title: r.issue.title,
        status: r.status,
        attempt: r.attempt,
        turn: r.turn,
        started_at: r.started_at,
      })),
      retryQueue: state.retryQueue.map((r) => ({
        issue: r.issue.number,
        title: r.issue.title,
        attempt: r.attempt,
        nextRetryAt: r.nextRetryAt,
      })),
      completedRuns: state.completedRuns.map((r) => ({
        issue: r.issue.number,
        title: r.issue.title,
        status: r.status,
        attempt: r.attempt,
        turn: r.turn,
        finished_at: r.finished_at,
      })),
      config: {
        github: `${state.config.github.owner}/${state.config.github.repo}`,
        label: state.config.github.label,
        polling_interval: state.config.polling.interval_seconds,
        max_sessions: state.config.concurrency.max_sessions,
        max_continuation_turns: state.config.agent.max_continuation_turns,
      },
    });
  });

  // JSON API: specific issue
  app.get("/api/v1/issues/:number", (req, res) => {
    const issueNumber = parseInt(req.params.number, 10);
    const state = orchestrator.getState();

    const running = state.running.find((r) => r.issue.number === issueNumber);
    if (running) {
      res.json({ status: "running", ...running });
      return;
    }

    const retry = state.retryQueue.find((r) => r.issue.number === issueNumber);
    if (retry) {
      res.json({ status: "retrying", ...retry });
      return;
    }

    const completed = state.completedRuns.find(
      (r) => r.issue.number === issueNumber
    );
    if (completed) {
      res.json({ status: completed.status, ...completed });
      return;
    }

    res.status(404).json({ error: "Issue not found" });
  });

  // Trigger immediate poll
  app.post("/api/v1/refresh", async (_req, res) => {
    try {
      await orchestrator.triggerPoll();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Poll failed" });
    }
  });

  // SSE event stream
  app.get("/api/v1/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send initial state
    const state = orchestrator.getState();
    res.write(`data: ${JSON.stringify({ type: "initial_state", ...state.running })}\n\n`);

    const listener = (event: OrchestratorEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    orchestrator.addEventListener(listener);

    req.on("close", () => {
      orchestrator.removeEventListener(listener);
    });
  });

  // Dashboard
  app.get("/", (_req, res) => {
    res.type("html").send(dashboardHtml());
  });

  return app;
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Symphony Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
    h1 { color: #58a6ff; margin-bottom: 1.5rem; }
    h2 { color: #8b949e; margin: 1.5rem 0 0.75rem; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .status-dot.running { background: #3fb950; animation: pulse 2s infinite; }
    .status-dot.waiting { background: #d29922; }
    .status-dot.failed { background: #f85149; }
    .status-dot.completed { background: #8b949e; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 1rem; margin-bottom: 0.5rem; }
    .card-title { font-weight: 600; margin-bottom: 0.25rem; }
    .card-meta { font-size: 0.875rem; color: #8b949e; }
    .config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem; }
    .config-item { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 0.75rem; }
    .config-label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; }
    .config-value { font-size: 1.25rem; font-weight: 600; color: #58a6ff; }
    .empty { color: #484f58; font-style: italic; padding: 1rem; }
    .refresh-btn { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem; }
    .refresh-btn:hover { background: #30363d; }
    .connection-status { float: right; font-size: 0.875rem; }
    .connection-status.connected { color: #3fb950; }
    .connection-status.disconnected { color: #f85149; }
  </style>
</head>
<body>
  <h1>Symphony <span class="connection-status" id="connStatus">connecting...</span></h1>

  <div class="config-grid" id="config"></div>

  <h2>Active Runs</h2>
  <div id="running"><div class="empty">No active runs</div></div>

  <h2>Retry Queue</h2>
  <div id="retryQueue"><div class="empty">No retries pending</div></div>

  <h2>Recent Completions</h2>
  <div id="completed"><div class="empty">No completed runs</div></div>

  <div style="margin-top: 2rem;">
    <button class="refresh-btn" onclick="triggerRefresh()">Trigger Poll</button>
  </div>

  <script>
    let state = { running: [], retryQueue: [], completedRuns: [], config: {} };

    async function fetchState() {
      const res = await fetch('/api/v1/state');
      state = await res.json();
      render();
    }

    function connectSSE() {
      const es = new EventSource('/api/v1/events');
      const status = document.getElementById('connStatus');

      es.onopen = () => {
        status.textContent = 'connected';
        status.className = 'connection-status connected';
      };

      es.onmessage = (e) => {
        const event = JSON.parse(e.data);
        // On any event, re-fetch full state for simplicity
        fetchState();
      };

      es.onerror = () => {
        status.textContent = 'disconnected';
        status.className = 'connection-status disconnected';
      };
    }

    function render() {
      // Config
      const config = document.getElementById('config');
      if (state.config) {
        config.innerHTML = [
          configItem('Repository', state.config.github || '-'),
          configItem('Label', state.config.label || '-'),
          configItem('Poll Interval', (state.config.polling_interval || '-') + 's'),
          configItem('Max Sessions', state.config.max_sessions || '-'),
          configItem('Max Turns', state.config.max_continuation_turns || '-'),
        ].join('');
      }

      // Running
      const running = document.getElementById('running');
      if (state.running.length === 0) {
        running.innerHTML = '<div class="empty">No active runs</div>';
      } else {
        running.innerHTML = state.running.map(r =>
          '<div class="card">' +
            '<div class="card-title"><span class="status-dot running"></span>#' + r.issue + ' ' + esc(r.title) + '</div>' +
            '<div class="card-meta">Status: ' + r.status + ' | Attempt: ' + r.attempt + ' | Turn: ' + r.turn + ' | Started: ' + new Date(r.started_at).toLocaleTimeString() + '</div>' +
          '</div>'
        ).join('');
      }

      // Retry queue
      const retry = document.getElementById('retryQueue');
      if (state.retryQueue.length === 0) {
        retry.innerHTML = '<div class="empty">No retries pending</div>';
      } else {
        retry.innerHTML = state.retryQueue.map(r =>
          '<div class="card">' +
            '<div class="card-title"><span class="status-dot waiting"></span>#' + r.issue + ' ' + esc(r.title) + '</div>' +
            '<div class="card-meta">Attempt: ' + r.attempt + ' | Retry at: ' + new Date(r.nextRetryAt).toLocaleTimeString() + '</div>' +
          '</div>'
        ).join('');
      }

      // Completed
      const completed = document.getElementById('completed');
      if (state.completedRuns.length === 0) {
        completed.innerHTML = '<div class="empty">No completed runs</div>';
      } else {
        completed.innerHTML = state.completedRuns.slice(0, 10).map(r =>
          '<div class="card">' +
            '<div class="card-title"><span class="status-dot ' + r.status + '"></span>#' + r.issue + ' ' + esc(r.title) + '</div>' +
            '<div class="card-meta">Status: ' + r.status + ' | Attempt: ' + r.attempt + ' | Turn: ' + r.turn + ' | Finished: ' + new Date(r.finished_at).toLocaleTimeString() + '</div>' +
          '</div>'
        ).join('');
      }
    }

    function configItem(label, value) {
      return '<div class="config-item"><div class="config-label">' + label + '</div><div class="config-value">' + value + '</div></div>';
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    async function triggerRefresh() {
      await fetch('/api/v1/refresh', { method: 'POST' });
      fetchState();
    }

    fetchState();
    connectSSE();
  </script>
</body>
</html>`;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/api.ts
git commit -m "feat: add Express API with SSE events and live dashboard"
```

---

### Task 10: Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Write the entry point**

`src/index.ts`:
```typescript
import { resolve } from "path";
import { Orchestrator } from "./orchestrator.js";
import { createApp } from "./api.js";
import { initGitHub } from "./github.js";
import { logger } from "./logger.js";

const WORKFLOW_PATH = resolve(process.env.WORKFLOW_PATH ?? "WORKFLOW.md");
const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  logger.info({ workflowPath: WORKFLOW_PATH, port: PORT }, "Symphony starting");

  // Initialize GitHub client
  if (!process.env.GITHUB_TOKEN) {
    logger.warn("GITHUB_TOKEN not set, GitHub API calls may be rate-limited");
  }
  initGitHub();

  // Create orchestrator
  const orchestrator = new Orchestrator(WORKFLOW_PATH);

  // Start API server
  const app = createApp(orchestrator);
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "Dashboard available");
  });

  // Start orchestrator
  orchestrator.start();

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down...");
    orchestrator.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start Symphony");
  process.exit(1);
});
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with graceful shutdown"
```

---

### Task 11: Example WORKFLOW.md

**Files:**
- Create: `WORKFLOW.md`

**Step 1: Create the example workflow**

````markdown
---
github:
  owner: your-org
  repo: your-repo
  label: agent
polling:
  interval_seconds: 30
workspace:
  root: ./workspaces
agent:
  timeout_seconds: 600
  max_continuation_turns: 5
concurrency:
  max_sessions: 1
---

You are working on issue #{{issue.number}}: {{issue.title}}

## Issue Description

{{issue.body}}

## Instructions

1. Read the issue carefully and understand what needs to be done.
2. Explore the codebase to understand the relevant code.
3. Make the necessary changes to address the issue.
4. Commit your changes with a clear commit message.
5. Push your branch and open a pull request.

This is attempt {{attempt}}, continuation turn {{turn}}.
````

**Step 2: Commit**

```bash
git add WORKFLOW.md
git commit -m "feat: add example WORKFLOW.md"
```

---

### Task 12: Dockerfile

**Files:**
- Create: `Dockerfile`

**Step 1: Create the Dockerfile**

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

COPY WORKFLOW.md ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

**Step 2: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile for container deployment"
```

---

### Task 13: End-to-End Verification

**Step 1: Build the project**

Run: `npm run build`
Expected: compiles without errors, `dist/` directory created

**Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Run all tests**

Run: `npm test`
Expected: all tests pass

**Step 4: Smoke test dev mode**

Run: `npm run dev` (without WORKFLOW.md configured for a real repo)
Expected: starts up, logs config, dashboard accessible at http://localhost:3000

**Step 5: Commit any fixes**

If any issues found, fix and commit.

---

### Task 14: README

**Files:**
- Create: `README.md`

**Step 1: Write the README**

Include:
- What Symphony does (1-2 sentences)
- Quick start (install, configure WORKFLOW.md, set GITHUB_TOKEN, run)
- Configuration reference (WORKFLOW.md format)
- Dashboard screenshot placeholder
- Docker deployment instructions
- Environment variables reference

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and configuration guide"
```
