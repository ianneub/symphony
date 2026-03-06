import matter from "gray-matter";
import { readFileSync, statSync } from "fs";
import type { WorkflowConfig } from "./types.js";

const DEFAULTS = {
  github: { label: "agent" },
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

function assertNonEmptyString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function assertPositiveNumber(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
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
      label: data.github.label ?? DEFAULTS.github.label,
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

  // Validate string fields
  assertNonEmptyString(config.github.owner, "github.owner");
  assertNonEmptyString(config.github.repo, "github.repo");
  assertNonEmptyString(config.github.label, "github.label");
  assertNonEmptyString(config.workspace.root, "workspace.root");

  // Validate numeric fields
  assertPositiveNumber(
    config.polling.interval_seconds,
    "polling.interval_seconds",
  );
  assertPositiveNumber(config.agent.timeout_seconds, "agent.timeout_seconds");
  assertPositiveNumber(
    config.agent.max_continuation_turns,
    "agent.max_continuation_turns",
  );
  assertPositiveNumber(
    config.concurrency.max_sessions,
    "concurrency.max_sessions",
  );

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
