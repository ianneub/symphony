import { describe, it, expect } from "vitest";
import { loadWorkflow, renderPrompt } from "../src/config.js";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  it("throws on negative numeric values", () => {
    expect(() =>
      loadWorkflow(resolve(__dirname, "fixtures/negative-numbers-workflow.md"))
    ).toThrow("polling.interval_seconds must be a positive number");
  });

  it("throws on wrong type for numeric field", () => {
    expect(() =>
      loadWorkflow(resolve(__dirname, "fixtures/wrong-types-workflow.md"))
    ).toThrow("polling.interval_seconds must be a positive number");
  });

  it("throws on empty github.label", () => {
    expect(() =>
      loadWorkflow(resolve(__dirname, "fixtures/empty-label-workflow.md"))
    ).toThrow("github.label must be a non-empty string");
  });

  it("throws on zero max_sessions", () => {
    expect(() =>
      loadWorkflow(resolve(__dirname, "fixtures/zero-sessions-workflow.md"))
    ).toThrow("concurrency.max_sessions must be a positive number");
  });

  it("throws on whitespace-only workspace.root", () => {
    expect(() =>
      loadWorkflow(resolve(__dirname, "fixtures/empty-root-workflow.md"))
    ).toThrow("workspace.root must be a non-empty string");
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
