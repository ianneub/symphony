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
    hooks: data.hooks
      ? {
          pre_run: Array.isArray(data.hooks.pre_run)
            ? data.hooks.pre_run
            : undefined,
          post_run: Array.isArray(data.hooks.post_run)
            ? data.hooks.post_run
            : undefined,
        }
      : undefined,
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
