import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Issue } from "../src/types.js";

// Mock all external dependencies before importing Orchestrator
vi.mock("../src/config.js", () => ({
  loadWorkflow: vi.fn(() => ({
    config: {
      github: { owner: "test", repo: "test-repo", label: "agent" },
      polling: { interval_seconds: 30 },
      workspace: { root: "./workspaces" },
      agent: { timeout_seconds: 60, max_continuation_turns: 2 },
      concurrency: { max_sessions: 5 },
    },
    promptTemplate: "Fix issue {{issue.number}}",
    lastModified: 1,
  })),
  renderPrompt: vi.fn(() => "rendered prompt"),
}));

vi.mock("../src/github.js", () => ({
  fetchIssues: vi.fn(),
  isBlocked: vi.fn(() => false),
  isIssueActive: vi.fn(() => true),
}));

vi.mock("../src/workspace.js", () => ({
  createWorkspace: vi.fn((_root: string, num: number) => `/tmp/ws/issue-${num}`),
  cleanupWorkspace: vi.fn(),
  workspacePath: vi.fn((_root: string, num: number) => `/tmp/ws/issue-${num}`),
}));

vi.mock("../src/agent.js", () => ({
  runAgent: vi.fn(() =>
    Promise.resolve({
      sessionId: "session-1",
      success: true,
      tokenUsage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    })
  ),
}));

import { Orchestrator } from "../src/orchestrator.js";
import { fetchIssues, isIssueActive } from "../src/github.js";

function makeIssue(number: number): Issue {
  return {
    id: number,
    number,
    title: `Issue ${number}`,
    body: "test body",
    labels: ["agent"],
    state: "open",
    url: `https://github.com/test/test-repo/issues/${number}`,
    blocked_by: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("Orchestrator completed issue skipping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("does not re-dispatch a completed issue on subsequent polls", async () => {
    const issue9 = makeIssue(9);
    vi.mocked(fetchIssues).mockResolvedValue([issue9]);
    // isIssueActive returns false so no continuation — completes after turn 1
    vi.mocked(isIssueActive).mockResolvedValue(false);

    const orch = new Orchestrator("fake-workflow.md");

    // First poll: dispatches issue 9
    await orch.triggerPoll();
    // Wait for the dispatch promise to settle
    await vi.advanceTimersByTimeAsync(100);

    const state1 = orch.getState();
    expect(state1.completedRuns).toHaveLength(1);
    expect(state1.completedRuns[0].issue.number).toBe(9);
    expect(state1.completedRuns[0].status).toBe("completed");

    // Second poll: issue 9 should be skipped
    vi.mocked(fetchIssues).mockResolvedValue([issue9]);
    await orch.triggerPoll();
    await vi.advanceTimersByTimeAsync(100);

    // Still only 1 completed run — was not re-dispatched
    const state2 = orch.getState();
    expect(state2.completedRuns).toHaveLength(1);
    expect(state2.running).toHaveLength(0);
  });

  it("still dispatches a different issue after one completes", async () => {
    const issue9 = makeIssue(9);
    const issue10 = makeIssue(10);
    vi.mocked(fetchIssues).mockResolvedValue([issue9]);
    vi.mocked(isIssueActive).mockResolvedValue(false);

    const orch = new Orchestrator("fake-workflow.md");

    // Complete issue 9
    await orch.triggerPoll();
    await vi.advanceTimersByTimeAsync(100);

    expect(orch.getState().completedRuns).toHaveLength(1);

    // Now poll returns both issues — only issue 10 should dispatch
    vi.mocked(fetchIssues).mockResolvedValue([issue9, issue10]);
    await orch.triggerPoll();
    await vi.advanceTimersByTimeAsync(100);

    const state = orch.getState();
    expect(state.completedRuns).toHaveLength(2);
    expect(state.completedRuns.map((r) => r.issue.number)).toContain(10);
  });

  it("does not skip failed issues (they go to retry queue)", async () => {
    const { runAgent } = await import("../src/agent.js");
    const issue9 = makeIssue(9);
    vi.mocked(fetchIssues).mockResolvedValue([issue9]);
    vi.mocked(runAgent).mockResolvedValueOnce({
      sessionId: "session-1",
      success: false,
      error: "something broke",
      tokenUsage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 },
    });

    const orch = new Orchestrator("fake-workflow.md");

    await orch.triggerPoll();
    await vi.advanceTimersByTimeAsync(100);

    const state = orch.getState();
    // Failed run goes to completedRuns with "failed" status AND retry queue
    expect(state.completedRuns).toHaveLength(1);
    expect(state.completedRuns[0].status).toBe("failed");
    expect(state.retryQueue).toHaveLength(1);
  });
});
