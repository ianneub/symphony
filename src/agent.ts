import { query } from "@anthropic-ai/claude-agent-sdk";
import type { OrchestratorEvent, TokenUsage } from "./types.js";
import { logger } from "./logger.js";

export interface AgentOptions {
  cwd: string;
  allowedTools: string[];
  permissionMode: string;
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
  tokenUsage: TokenUsage;
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
  const tokenUsage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

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

      // Accumulate token usage from SDK events that carry usage data
      const msgAny = message as any;
      if (msgAny.usage) {
        const usage = msgAny.usage;
        if (usage.input_tokens != null) {
          tokenUsage.input_tokens += usage.input_tokens;
        }
        if (usage.output_tokens != null) {
          tokenUsage.output_tokens += usage.output_tokens;
        }
        tokenUsage.total_tokens = tokenUsage.input_tokens + tokenUsage.output_tokens;
      }

      if ("result" in message) {
        log.debug({ result: (message as any).result }, "Agent result");
      }
    }

    clearTimeout(timeout);
    log.info({ sessionId, tokenUsage }, "Agent session completed");
    return { sessionId, success: true, tokenUsage };
  } catch (err) {
    clearTimeout(timeout);
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    log.error({ err: errorMessage, sessionId }, "Agent session failed");
    return { sessionId, success: false, error: errorMessage, tokenUsage };
  }
}
