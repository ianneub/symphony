import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateBackoff, shouldRetry } from "../src/orchestrator.js";
import type { Issue, WorkflowConfig } from "../src/types.js";

// ── Unit tests (existing) ──────────────────────────────────────────────

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

// ── Integration tests ──────────────────────────────────────────────────

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    number: 1,
    title: "Test issue",
    body: "Test body",
    labels: ["agent"],
    state: "open",
    url: "https://github.com/org/repo/issues/1",
    blocked_by: [],
    created_at: "2026-03-06T00:00:00Z",
    updated_at: "2026-03-06T01:00:00Z",
    ...overrides,
  };
}

vi.mock("../src/github.js", () => ({
  fetchIssues: vi.fn(async () => []),
  isBlocked: vi.fn((issue: Issue) =>
    issue.blocked_by.some((b) => b.state === "OPEN")
  ),
  isIssueActive: vi.fn(async () => true),
  initGitHub: vi.fn(),
  normalizeIssue: vi.fn(),
}));

vi.mock("../src/workspace.js", () => ({
  createWorkspace: vi.fn(
    async (root: string, issueNumber: number) =>
      `${root}/issue-${issueNumber}`
  ),
  cleanupWorkspace: vi.fn(),
  workspacePath: vi.fn(
    (root: string, issueNumber: number) => `${root}/issue-${issueNumber}`
  ),
  sanitizeIssueName: vi.fn((n: number) => `issue-${n}`),
  validateWorkspacePath: vi.fn(),
}));

vi.mock("../src/agent.js", () => ({
  runAgent: vi.fn(async () => ({ sessionId: "sess-1", success: true })),
  buildAgentOptions: vi.fn(() => ({
    cwd: "/tmp",
    allowedTools: [],
    permissionMode: "acceptEdits",
  })),
}));

vi.mock("../src/config.js", () => {
  let callCount = 0;
  const baseConfig: WorkflowConfig = {
    github: { owner: "testorg", repo: "testrepo", label: "agent" },
    polling: { interval_seconds: 30 },
    workspace: { root: "/tmp/workspaces" },
    agent: { timeout_seconds: 600, max_continuation_turns: 5 },
    concurrency: { max_sessions: 2 },
  };
  return {
    loadWorkflow: vi.fn(() => {
      callCount++;
      return {
        config: { ...baseConfig, concurrency: { ...baseConfig.concurrency } },
        promptTemplate: "Fix #{{issue.number}}: {{issue.title}}",
        lastModified: callCount === 1 ? 1000 : 1000,
      };
    }),
    renderPrompt: vi.fn(
      (_tpl: string, ctx: { issue: { number: number } }) =>
        `Rendered prompt for #${ctx.issue.number}`
    ),
  };
});

vi.mock("../src/logger.js", () => {
  const noop = () => {};
  const childLogger: Record<string, any> = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
  childLogger.child = () => childLogger;
  return {
    logger: childLogger,
    issueLogger: () => childLogger,
  };
});

// Import after mocks are set up
const { Orchestrator } = await import("../src/orchestrator.js");
const { fetchIssues, isIssueActive } = await import("../src/github.js");
const { createWorkspace } = await import("../src/workspace.js");
const { runAgent } = await import("../src/agent.js");
const { loadWorkflow } = await import("../src/config.js");

describe("Orchestrator integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createOrchestrator(): InstanceType<typeof Orchestrator> {
    return new Orchestrator("/fake/WORKFLOW.md");
  }

  describe("poll cycle dispatches eligible issues", () => {
    it("dispatches a single eligible issue", async () => {
      const issue = makeIssue({ number: 1 });
      vi.mocked(fetchIssues).mockResolvedValueOnce([issue]);
      vi.mocked(isIssueActive).mockResolvedValue(false);

      const orch = createOrchestrator();
      const events: any[] = [];
      orch.addEventListener((e) => events.push(e));

      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      expect(fetchIssues).toHaveBeenCalledWith("testorg", "testrepo", "agent");
      expect(createWorkspace).toHaveBeenCalledOnce();
      expect(runAgent).toHaveBeenCalledOnce();

      expect(events.some((e) => e.type === "poll_completed")).toBe(true);
      expect(events.some((e) => e.type === "run_started")).toBe(true);
    });

    it("dispatches multiple eligible issues", async () => {
      const issues = [
        makeIssue({ number: 1, id: 1 }),
        makeIssue({ number: 2, id: 2 }),
      ];
      vi.mocked(fetchIssues).mockResolvedValueOnce(issues);
      vi.mocked(isIssueActive).mockResolvedValue(false);

      const orch = createOrchestrator();
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      expect(createWorkspace).toHaveBeenCalledTimes(2);
      expect(runAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe("concurrency limit is respected", () => {
    it("only dispatches up to max_sessions", async () => {
      const issues = [
        makeIssue({ number: 1, id: 1 }),
        makeIssue({ number: 2, id: 2 }),
        makeIssue({ number: 3, id: 3 }),
      ];

      // Make runAgent hang so slots stay occupied
      vi.mocked(runAgent).mockImplementation(() => new Promise(() => {}));
      vi.mocked(fetchIssues).mockResolvedValueOnce(issues);

      const orch = createOrchestrator();
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      // max_sessions is 2, so only 2 dispatched
      expect(createWorkspace).toHaveBeenCalledTimes(2);
      expect(orch.getState().running.length).toBe(2);
    });
  });

  describe("blocked issues are skipped", () => {
    it("does not dispatch blocked issues", async () => {
      const blockedIssue = makeIssue({
        number: 5,
        blocked_by: [{ number: 1, title: "Blocker", state: "OPEN" }],
      });
      const normalIssue = makeIssue({ number: 6, id: 6 });
      vi.mocked(fetchIssues).mockResolvedValueOnce([blockedIssue, normalIssue]);
      vi.mocked(isIssueActive).mockResolvedValue(false);

      const orch = createOrchestrator();
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      expect(createWorkspace).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createWorkspace).mock.calls[0][1]).toBe(6);
    });
  });

  describe("config reload detection", () => {
    it("emits config_reloaded when file timestamp changes", async () => {
      const orch = createOrchestrator();
      const events: any[] = [];
      orch.addEventListener((e) => events.push(e));

      // Make loadWorkflow return a newer timestamp on next call
      vi.mocked(loadWorkflow).mockReturnValueOnce({
        config: {
          github: { owner: "testorg", repo: "testrepo", label: "agent" },
          polling: { interval_seconds: 30 },
          workspace: { root: "/tmp/workspaces" },
          agent: { timeout_seconds: 600, max_continuation_turns: 5 },
          concurrency: { max_sessions: 2 },
        },
        promptTemplate: "Updated prompt",
        lastModified: 2000,
      });

      vi.mocked(fetchIssues).mockResolvedValueOnce([]);

      await orch.triggerPoll();

      expect(events.some((e) => e.type === "config_reloaded")).toBe(true);
    });
  });

  describe("continuation turn scheduling", () => {
    it("schedules continuation when agent succeeds and issue is still active", async () => {
      const issue = makeIssue({ number: 10 });
      vi.mocked(fetchIssues).mockResolvedValueOnce([issue]);
      vi.mocked(isIssueActive).mockResolvedValue(true);
      vi.mocked(runAgent).mockResolvedValue({
        sessionId: "sess-1",
        success: true,
      });

      const orch = createOrchestrator();
      const events: any[] = [];
      orch.addEventListener((e) => events.push(e));

      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      // After first turn, issue should be in waiting_continuation
      const state = orch.getState();
      const running = state.running.find((r) => r.issue.number === 10);
      expect(running).toBeDefined();
      expect(running!.status).toBe("waiting_continuation");

      // Advance past the continuation delay (1000ms)
      vi.mocked(fetchIssues).mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1500);

      // Agent should be called again for turn 2
      expect(runAgent).toHaveBeenCalledTimes(2);
    });

    it("does not continue when issue is no longer active", async () => {
      const issue = makeIssue({ number: 11 });
      vi.mocked(fetchIssues).mockResolvedValueOnce([issue]);
      vi.mocked(isIssueActive).mockResolvedValue(false);

      const orch = createOrchestrator();
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      expect(runAgent).toHaveBeenCalledTimes(1);

      const state = orch.getState();
      expect(state.running.length).toBe(0);
      expect(state.completedRuns.length).toBe(1);
      expect(state.completedRuns[0].status).toBe("completed");
    });
  });

  describe("retry backoff scheduling", () => {
    it("adds failed issue to retry queue with backoff", async () => {
      const issue = makeIssue({ number: 20 });
      vi.mocked(fetchIssues).mockResolvedValueOnce([issue]);
      vi.mocked(runAgent).mockResolvedValueOnce({
        success: false,
        error: "Agent crashed",
      });

      const orch = createOrchestrator();
      const events: any[] = [];
      orch.addEventListener((e) => events.push(e));

      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      const state = orch.getState();
      expect(state.running.length).toBe(0);
      expect(state.retryQueue.length).toBe(1);
      expect(state.retryQueue[0].attempt).toBe(2);
      expect(state.retryQueue[0].issue.number).toBe(20);

      expect(events.some((e) => e.type === "run_failed")).toBe(true);
      expect(events.some((e) => e.type === "retry_scheduled")).toBe(true);
    });

    it("retries issue from retry queue when backoff elapses", async () => {
      const issue = makeIssue({ number: 21 });
      vi.mocked(fetchIssues).mockResolvedValueOnce([issue]);
      vi.mocked(runAgent)
        .mockResolvedValueOnce({ success: false, error: "fail" })
        .mockResolvedValueOnce({ sessionId: "s2", success: true });
      vi.mocked(isIssueActive).mockResolvedValue(false);

      const orch = createOrchestrator();

      // First poll: issue fails and enters retry queue
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      let state = orch.getState();
      expect(state.retryQueue.length).toBe(1);

      // Advance past the backoff (10s for attempt 1)
      vi.mocked(fetchIssues).mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(11_000);

      // Second poll: retry entry is now eligible
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      state = orch.getState();
      expect(state.retryQueue.length).toBe(0);
      expect(runAgent).toHaveBeenCalledTimes(2);
    });

    it("workspace creation failure triggers retry", async () => {
      const issue = makeIssue({ number: 22 });
      vi.mocked(fetchIssues).mockResolvedValueOnce([issue]);
      vi.mocked(createWorkspace).mockRejectedValueOnce(
        new Error("clone failed")
      );

      const orch = createOrchestrator();
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);

      const state = orch.getState();
      expect(state.retryQueue.length).toBe(1);
      expect(state.retryQueue[0].attempt).toBe(2);
    });
  });

  describe("already-running issues are not re-dispatched", () => {
    it("skips issues that are currently running", async () => {
      const issue = makeIssue({ number: 30 });

      vi.mocked(runAgent).mockImplementation(() => new Promise(() => {}));
      vi.mocked(fetchIssues)
        .mockResolvedValueOnce([issue])
        .mockResolvedValueOnce([issue]);

      const orch = createOrchestrator();

      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);
      expect(createWorkspace).toHaveBeenCalledTimes(1);

      // Second poll should skip since issue is still running
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);
      expect(createWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  describe("completed issues are not re-dispatched", () => {
    it("skips issues that completed successfully", async () => {
      const issue = makeIssue({ number: 40 });
      vi.mocked(fetchIssues).mockResolvedValue([issue]);
      vi.mocked(isIssueActive).mockResolvedValue(false);
      vi.mocked(runAgent).mockResolvedValue({
        sessionId: "s1",
        success: true,
      });

      const orch = createOrchestrator();

      // First poll: dispatches and completes
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);
      expect(runAgent).toHaveBeenCalledTimes(1);

      // Second poll: same issue appears but should be skipped
      await orch.triggerPoll();
      await vi.advanceTimersByTimeAsync(100);
      expect(runAgent).toHaveBeenCalledTimes(1);
    });
  });
});
