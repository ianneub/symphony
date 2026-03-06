import { describe, it, expect } from "vitest";
import { buildAgentOptions } from "../src/agent.js";

describe("buildAgentOptions", () => {
  it("sets cwd to workspace path", () => {
    const opts = buildAgentOptions("/workspaces/issue-42", 600);
    expect(opts.cwd).toBe("/workspaces/issue-42");
  });

  it("includes standard allowed tools", () => {
    const opts = buildAgentOptions("/workspaces/issue-42", 600);
    expect(opts.allowedTools).toContain("Read");
    expect(opts.allowedTools).toContain("Write");
    expect(opts.allowedTools).toContain("Edit");
    expect(opts.allowedTools).toContain("Bash");
  });

  it("sets permission mode to acceptEdits", () => {
    const opts = buildAgentOptions("/workspaces/issue-42", 600);
    expect(opts.permissionMode).toBe("acceptEdits");
  });
});
