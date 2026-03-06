export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

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
  token_budget?: {
    max_tokens_per_issue?: number;
    max_tokens_global?: number;
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
  token_usage: TokenUsage;
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
  token_usage: TokenUsage;
}

export type OrchestratorEvent =
  | { type: "run_started"; issue: Issue; attempt: number }
  | { type: "run_status_changed"; issueNumber: number; status: RunStatus }
  | { type: "run_completed"; issueNumber: number; turn: number }
  | { type: "run_failed"; issueNumber: number; error: string }
  | { type: "retry_scheduled"; issueNumber: number; nextRetryAt: Date }
  | { type: "config_reloaded" }
  | { type: "poll_completed"; issueCount: number }
  | { type: "budget_exceeded"; issueNumber: number; usage: number; limit: number };
