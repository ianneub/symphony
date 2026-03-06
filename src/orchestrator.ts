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

const MAX_BACKOFF_MS = 300_000;
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
      this.reloadConfigIfChanged();

      const { github } = this.state.config;
      const issues = await fetchIssues(github.owner, github.repo, github.label);
      this.emit({ type: "poll_completed", issueCount: issues.length });

      // Collect all candidates: retries first, then new issues
      const candidates: Array<{ issue: Issue; attempt: number }> = [];

      // Process retry queue
      for (const [issueNumber, entry] of this.state.retryQueue) {
        if (shouldRetry(entry)) {
          this.state.retryQueue.delete(issueNumber);
          log.info({ issue: issueNumber }, "Retrying issue");
          candidates.push({ issue: entry.issue, attempt: entry.attempt });
        }
      }

      // Filter new issues
      const eligible = issues.filter((issue) => {
        if (this.state.running.has(issue.number)) return false;
        if (this.state.retryQueue.has(issue.number)) return false;
        if (this.isCompleted(issue.number)) {
          log.debug({ issue: issue.number }, "Issue already completed, skipping");
          return false;
        }
        if (isBlocked(issue)) {
          log.debug({ issue: issue.number }, "Issue is blocked, skipping");
          return false;
        }
        // Skip issues already in candidates (from retry)
        if (candidates.some((c) => c.issue.number === issue.number)) return false;
        return true;
      });

      for (const issue of eligible) {
        candidates.push({ issue, attempt: 1 });
      }

      // Apply concurrency limit to all candidates
      const availableSlots =
        this.state.config.concurrency.max_sessions - this.state.running.size;
      const toDispatch = candidates.slice(0, Math.max(0, availableSlots));

      for (const { issue, attempt } of toDispatch) {
        this.dispatch(issue, attempt).catch((err) =>
          log.error({ err, issue: issue.number }, "Dispatch failed")
        );
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

  private async dispatch(
    issue: Issue,
    attempt: number,
    turn: number = 1,
    sessionId?: string
  ): Promise<void> {
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
      this.updateRunStatus(issue.number, "preparing_workspace");
      const token = process.env.GITHUB_TOKEN;
      const repoUrl = token
        ? `https://x-access-token:${token}@github.com/${config.github.owner}/${config.github.repo}.git`
        : `https://github.com/${config.github.owner}/${config.github.repo}.git`;
      const wsPath = await createWorkspace(
        config.workspace.root,
        issue.number,
        repoUrl
      );

      this.updateRunStatus(issue.number, "building_prompt");
      const prompt = renderPrompt(promptTemplate, {
        issue: { number: issue.number, title: issue.title, body: issue.body },
        attempt,
        turn,
      });

      this.updateRunStatus(issue.number, "running_agent");
      log.info("Launching agent session");
      const result = await runAgent(
        prompt,
        wsPath,
        config.agent.timeout_seconds,
        sessionId,
        (event) => this.emit(event)
      );

      this.updateRunStatus(issue.number, "finishing");

      if (result.success) {
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
            // Keep in running map to prevent re-dispatch during delay

            setTimeout(() => {
              this.state.running.delete(issue.number);
              this.dispatch(issue, attempt, turn + 1, result.sessionId).catch(
                (err) => log.error({ err }, "Continuation dispatch failed")
              );
            }, CONTINUATION_DELAY_MS);
            return;
          }
        }

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
      this.emit({
        type: "run_failed",
        issueNumber: issue.number,
        error: errorMessage,
      });

      const backoff = calculateBackoff(attempt);
      const nextRetryAt = new Date(Date.now() + backoff);
      this.state.retryQueue.set(issue.number, {
        issue,
        attempt: attempt + 1,
        nextRetryAt,
      });
      this.emit({
        type: "retry_scheduled",
        issueNumber: issue.number,
        nextRetryAt,
      });
      log.info({ backoff, nextRetryAt }, "Retry scheduled");
    }
  }

  private updateRunStatus(
    issueNumber: number,
    status: RunAttempt["status"]
  ): void {
    const run = this.state.running.get(issueNumber);
    if (run) {
      run.status = status;
      this.emit({ type: "run_status_changed", issueNumber, status });
    }
  }

  private isCompleted(issueNumber: number): boolean {
    return this.state.completedRuns.some(
      (run) => run.issue.number === issueNumber && run.status === "completed"
    );
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
    if (this.state.completedRuns.length > MAX_COMPLETED_RUNS) {
      this.state.completedRuns = this.state.completedRuns.slice(
        0,
        MAX_COMPLETED_RUNS
      );
    }
  }
}
