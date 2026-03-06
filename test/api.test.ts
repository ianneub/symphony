import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/api.js";
import type { Orchestrator } from "../src/orchestrator.js";
import type { Issue, WorkflowConfig, RunAttempt, RetryEntry, CompletedRun } from "../src/types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    number: 42,
    title: "Test issue",
    body: "Test body",
    labels: ["agent"],
    state: "open",
    url: "https://github.com/org/repo/issues/42",
    blocked_by: [],
    created_at: "2026-03-06T00:00:00Z",
    updated_at: "2026-03-06T01:00:00Z",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    github: { owner: "testorg", repo: "testrepo", label: "agent" },
    polling: { interval_seconds: 30 },
    workspace: { root: "./workspaces" },
    agent: { timeout_seconds: 600, max_continuation_turns: 5 },
    concurrency: { max_sessions: 2 },
    ...overrides,
  };
}

function makeOrchestrator(stateOverrides: {
  running?: RunAttempt[];
  retryQueue?: RetryEntry[];
  completedRuns?: CompletedRun[];
  config?: WorkflowConfig;
} = {}): Orchestrator {
  const state = {
    running: stateOverrides.running ?? [],
    retryQueue: stateOverrides.retryQueue ?? [],
    completedRuns: stateOverrides.completedRuns ?? [],
    config: stateOverrides.config ?? makeConfig(),
  };

  return {
    getState: vi.fn(() => state),
    triggerPoll: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Orchestrator;
}

describe("API", () => {
  describe("GET /", () => {
    it("returns HTML dashboard", async () => {
      const app = createApp(makeOrchestrator());
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.text).toContain("Symphony");
      expect(res.text).toContain("<!DOCTYPE html>");
    });
  });

  describe("GET /api/v1/state", () => {
    it("returns correct shape with empty state", async () => {
      const app = createApp(makeOrchestrator());
      const res = await request(app).get("/api/v1/state");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("running");
      expect(res.body).toHaveProperty("retryQueue");
      expect(res.body).toHaveProperty("completedRuns");
      expect(res.body).toHaveProperty("config");
      expect(Array.isArray(res.body.running)).toBe(true);
      expect(Array.isArray(res.body.retryQueue)).toBe(true);
      expect(Array.isArray(res.body.completedRuns)).toBe(true);
    });

    it("returns config fields", async () => {
      const app = createApp(makeOrchestrator());
      const res = await request(app).get("/api/v1/state");
      expect(res.body.config.github.owner).toBe("testorg");
      expect(res.body.config.github.repo).toBe("testrepo");
      expect(res.body.config.concurrency.max_sessions).toBe(2);
    });

    it("returns running issues in state", async () => {
      const issue = makeIssue();
      const run: RunAttempt = {
        issue,
        status: "running_agent",
        attempt: 1,
        turn: 1,
        started_at: new Date(),
        workspace_path: "./workspaces/issue-42",
      };
      const app = createApp(makeOrchestrator({ running: [run] }));
      const res = await request(app).get("/api/v1/state");
      expect(res.body.running).toHaveLength(1);
      expect(res.body.running[0].issue.number).toBe(42);
    });
  });

  describe("GET /api/v1/issues/:number", () => {
    it("returns running issue", async () => {
      const issue = makeIssue({ number: 10 });
      const run: RunAttempt = {
        issue,
        status: "running_agent",
        attempt: 1,
        turn: 1,
        started_at: new Date(),
        workspace_path: "./workspaces/issue-10",
      };
      const app = createApp(makeOrchestrator({ running: [run] }));
      const res = await request(app).get("/api/v1/issues/10");
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("running");
      expect(res.body.data.issue.number).toBe(10);
    });

    it("returns retry queue issue", async () => {
      const issue = makeIssue({ number: 20 });
      const entry: RetryEntry = {
        issue,
        attempt: 2,
        nextRetryAt: new Date(Date.now() + 60_000),
      };
      const app = createApp(makeOrchestrator({ retryQueue: [entry] }));
      const res = await request(app).get("/api/v1/issues/20");
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("retryQueue");
    });

    it("returns completed issue", async () => {
      const issue = makeIssue({ number: 30 });
      const completed: CompletedRun = {
        issue,
        status: "completed",
        attempt: 1,
        turn: 3,
        finished_at: new Date(),
      };
      const app = createApp(makeOrchestrator({ completedRuns: [completed] }));
      const res = await request(app).get("/api/v1/issues/30");
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("completedRuns");
    });

    it("returns 404 for unknown issue", async () => {
      const app = createApp(makeOrchestrator());
      const res = await request(app).get("/api/v1/issues/999");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Issue not found");
    });

    it("returns 400 for invalid issue number", async () => {
      const app = createApp(makeOrchestrator());
      const res = await request(app).get("/api/v1/issues/abc");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid issue number");
    });
  });

  describe("POST /api/v1/refresh", () => {
    it("triggers poll and returns ok", async () => {
      const orch = makeOrchestrator();
      const app = createApp(orch);
      const res = await request(app).post("/api/v1/refresh");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(orch.triggerPoll).toHaveBeenCalledOnce();
    });

    it("returns 500 when poll throws", async () => {
      const orch = makeOrchestrator();
      (orch.triggerPoll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Poll failed")
      );
      const app = createApp(orch);
      const res = await request(app).post("/api/v1/refresh");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Poll trigger failed");
    });
  });

  describe("GET /api/v1/events", () => {
    it("establishes SSE connection with correct headers", async () => {
      const orch = makeOrchestrator();
      const app = createApp(orch);

      const res = await request(app)
        .get("/api/v1/events")
        .buffer(false)
        .parse((res, callback) => {
          // Read just enough to verify headers, then abort
          res.on("data", () => {});
          // Resolve immediately after connection is established
          setTimeout(() => {
            res.destroy();
            callback(null, {});
          }, 50);
        });

      expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(orch.addEventListener).toHaveBeenCalledOnce();
    });
  });
});
