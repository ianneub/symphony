import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWorkflow, renderPrompt, resolveEnvVars } from "../src/config.js";
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
});

describe("resolveEnvVars", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.TEST_GH_OWNER = process.env.TEST_GH_OWNER;
    savedEnv.TEST_GH_REPO = process.env.TEST_GH_REPO;
    savedEnv.TEST_WORKSPACE_ROOT = process.env.TEST_WORKSPACE_ROOT;
    savedEnv.UNSET_VAR = process.env.UNSET_VAR;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("replaces $VAR patterns with environment variable values", () => {
    process.env.TEST_GH_OWNER = "myorg";
    process.env.TEST_GH_REPO = "myrepo";
    const result = resolveEnvVars({ owner: "$TEST_GH_OWNER", repo: "$TEST_GH_REPO" });
    expect(result).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("replaces $VAR embedded in a larger string", () => {
    process.env.TEST_WORKSPACE_ROOT = "/tmp/ws";
    const result = resolveEnvVars("prefix/$TEST_WORKSPACE_ROOT/suffix");
    expect(result).toBe("prefix//tmp/ws/suffix");
  });

  it("throws when a referenced env var is not set", () => {
    delete process.env.UNSET_VAR;
    expect(() => resolveEnvVars("$UNSET_VAR")).toThrow(
      'Environment variable "UNSET_VAR" is referenced in config but is not set'
    );
  });

  it("leaves non-string values unchanged", () => {
    expect(resolveEnvVars(42)).toBe(42);
    expect(resolveEnvVars(true)).toBe(true);
    expect(resolveEnvVars(null)).toBe(null);
  });

  it("recursively resolves nested objects and arrays", () => {
    process.env.TEST_GH_OWNER = "deep";
    const result = resolveEnvVars({ nested: { val: "$TEST_GH_OWNER" }, arr: ["$TEST_GH_OWNER"] });
    expect(result).toEqual({ nested: { val: "deep" }, arr: ["deep"] });
  });
});

describe("loadWorkflow with env vars", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.TEST_GH_OWNER = process.env.TEST_GH_OWNER;
    savedEnv.TEST_GH_REPO = process.env.TEST_GH_REPO;
    savedEnv.TEST_WORKSPACE_ROOT = process.env.TEST_WORKSPACE_ROOT;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("resolves $VAR references in workflow config", () => {
    process.env.TEST_GH_OWNER = "envorg";
    process.env.TEST_GH_REPO = "envrepo";
    process.env.TEST_WORKSPACE_ROOT = "/var/workspaces";
    const result = loadWorkflow(resolve(__dirname, "fixtures/env-workflow.md"));
    expect(result.config.github.owner).toBe("envorg");
    expect(result.config.github.repo).toBe("envrepo");
    expect(result.config.workspace.root).toBe("/var/workspaces");
  });

  it("throws when a referenced env var is missing", () => {
    process.env.TEST_GH_OWNER = "envorg";
    delete process.env.TEST_GH_REPO;
    process.env.TEST_WORKSPACE_ROOT = "/tmp";
    expect(() =>
      loadWorkflow(resolve(__dirname, "fixtures/env-workflow.md"))
    ).toThrow('Environment variable "TEST_GH_REPO" is referenced in config but is not set');
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
