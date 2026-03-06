import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("max retry limit", () => {
  // We test the behavior by importing the Orchestrator and mocking its dependencies
  // to verify the retry-limiting logic in the dispatch failure handler.

  let Orchestrator: typeof import("../src/orchestrator.js").Orchestrator;
  let mockFetchIssues: ReturnType<typeof vi.fn>;
  let mockRunAgent: ReturnType<typeof vi.fn>;
  let mockCreateWorkspace: ReturnType<typeof vi.fn>;
  let mockLoadWorkflow: ReturnType<typeof vi.fn>;

  const makeConfig = (maxRetries = 10) => ({
    github: { owner: "test", repo: "test", label: "agent" },
    polling: { interval_seconds: 30 },
    workspace: { root: "./workspaces" },
    agent: { timeout_seconds: 600, max_continuation_turns: 5, max_retries: maxRetries },
    concurrency: { max_sessions: 5 },
  });

  const makeIssue = (num: number) => ({
    id: num,
    number: num,
    title: `Issue ${num}`,
    body: "test body",
    labels: ["agent"],
    state: "open" as const,
    url: `https://github.com/test/test/issues/${num}`,
    blocked_by: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  beforeEach(async () => {
    vi.resetModules();

    mockFetchIssues = vi.fn().mockResolvedValue([]);
    mockRunAgent = vi.fn().mockResolvedValue({ success: false, error: "fail" });
    mockCreateWorkspace = vi.fn().mockResolvedValue("/tmp/ws");
    mockLoadWorkflow = vi.fn().mockReturnValue({
      config: makeConfig(3),
      promptTemplate: "test prompt",
      lastModified: 1,
    });

    vi.doMock("../src/github.js", () => ({
      fetchIssues: mockFetchIssues,
      isBlocked: () => false,
      isIssueActive: () => Promise.resolve(true),
    }));
    vi.doMock("../src/agent.js", () => ({
      runAgent: mockRunAgent,
    }));
    vi.doMock("../src/workspace.js", () => ({
      createWorkspace: mockCreateWorkspace,
      cleanupWorkspace: vi.fn(),
      workspacePath: (_root: string, num: number) => `/tmp/ws-${num}`,
    }));
    vi.doMock("../src/config.js", () => ({
      loadWorkflow: mockLoadWorkflow,
      renderPrompt: () => "rendered prompt",
    }));
    vi.doMock("../src/logger.js", () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        }),
      },
    }));

    const mod = await import("../src/orchestrator.js");
    Orchestrator = mod.Orchestrator;
  });

  it("schedules retry when attempt < max_retries", async () => {
    const issue = makeIssue(1);
    mockFetchIssues.mockResolvedValue([issue]);
    mockRunAgent.mockResolvedValue({ success: false, error: "fail" });

    const orchestrator = new Orchestrator("WORKFLOW.md");
    const events: any[] = [];
    orchestrator.addEventListener((e) => events.push(e));

    await orchestrator.triggerPoll();
    // Wait for dispatch to complete
    await new Promise((r) => setTimeout(r, 100));

    const retryEvents = events.filter((e) => e.type === "retry_scheduled");
    expect(retryEvents.length).toBe(1);

    const state = orchestrator.getState();
    expect(state.retryQueue.length).toBe(1);
    expect(state.retryQueue[0].attempt).toBe(2);
  });

  it("does not schedule retry when attempt >= max_retries", async () => {
    // max_retries is 3, so we simulate attempt 3 (the third attempt)
    // by first populating the retry queue with attempt=3
    const issue = makeIssue(42);
    mockFetchIssues.mockResolvedValue([]);
    mockRunAgent.mockResolvedValue({ success: false, error: "persistent failure" });

    const orchestrator = new Orchestrator("WORKFLOW.md");
    const events: any[] = [];
    orchestrator.addEventListener((e) => events.push(e));

    // Manually add to retry queue at attempt 3 (which equals max_retries)
    const state = orchestrator.getState();
    // Access internal state through triggerPoll by setting up the retry queue
    // We'll use a different approach: start with attempt 1 and run through failures

    // Instead, let's set up the issue to appear in the retry queue at attempt=3
    // by mocking fetchIssues to return the issue and manipulating the state
    // We need to trigger a poll that picks up a retry entry at attempt=3

    // Simpler approach: trigger polls with the issue failing each time
    mockFetchIssues.mockResolvedValue([issue]);

    // First attempt (attempt=1) - should retry
    await orchestrator.triggerPoll();
    await new Promise((r) => setTimeout(r, 100));

    let currentState = orchestrator.getState();
    expect(currentState.retryQueue.length).toBe(1);
    expect(currentState.retryQueue[0].attempt).toBe(2);

    // Force the retry to be ready now
    // Trigger poll - the retry entry should be picked up (attempt=2)
    // We need to make the nextRetryAt in the past
    // Access internal retry queue and modify nextRetryAt
    const retryEntry = currentState.retryQueue[0];
    retryEntry.nextRetryAt = new Date(Date.now() - 1000);

    mockFetchIssues.mockResolvedValue([]);
    await orchestrator.triggerPoll();
    await new Promise((r) => setTimeout(r, 100));

    currentState = orchestrator.getState();
    expect(currentState.retryQueue.length).toBe(1);
    expect(currentState.retryQueue[0].attempt).toBe(3);

    // Force retry again (attempt=3 which equals max_retries=3)
    currentState.retryQueue[0].nextRetryAt = new Date(Date.now() - 1000);

    events.length = 0;
    await orchestrator.triggerPoll();
    await new Promise((r) => setTimeout(r, 100));

    // Should NOT have scheduled another retry since attempt 3 >= max_retries 3
    const retryScheduledEvents = events.filter((e) => e.type === "retry_scheduled");
    expect(retryScheduledEvents.length).toBe(0);

    currentState = orchestrator.getState();
    expect(currentState.retryQueue.length).toBe(0);

    // Should be in completedRuns as failed
    const failedRuns = currentState.completedRuns.filter(
      (r) => r.issue.number === 42 && r.status === "failed"
    );
    expect(failedRuns.length).toBeGreaterThanOrEqual(1);
  });

  it("leaves issue in completedRuns as permanently failed when max retries exceeded", async () => {
    // Use max_retries=1 for a quick test
    mockLoadWorkflow.mockReturnValue({
      config: makeConfig(1),
      promptTemplate: "test prompt",
      lastModified: 1,
    });

    // Re-import with updated config
    vi.resetModules();
    const mod = await import("../src/orchestrator.js");
    Orchestrator = mod.Orchestrator;

    const issue = makeIssue(99);
    mockFetchIssues.mockResolvedValue([issue]);
    mockRunAgent.mockResolvedValue({ success: false, error: "fail" });

    const orchestrator = new Orchestrator("WORKFLOW.md");
    const events: any[] = [];
    orchestrator.addEventListener((e) => events.push(e));

    // First attempt (attempt=1) — attempt >= max_retries(1), so no retry
    await orchestrator.triggerPoll();
    await new Promise((r) => setTimeout(r, 100));

    const state = orchestrator.getState();
    expect(state.retryQueue.length).toBe(0);

    const failedRuns = state.completedRuns.filter(
      (r) => r.issue.number === 99 && r.status === "failed"
    );
    expect(failedRuns.length).toBe(1);

    // No retry_scheduled event should have been emitted
    const retryEvents = events.filter((e) => e.type === "retry_scheduled");
    expect(retryEvents.length).toBe(0);
  });
});
