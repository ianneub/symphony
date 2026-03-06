import { describe, it, expect } from "vitest";
import {
  workspacePath,
  validateWorkspacePath,
  sanitizeIssueName,
} from "../src/workspace.js";

describe("sanitizeIssueName", () => {
  it("creates a safe directory name from issue number", () => {
    expect(sanitizeIssueName(42)).toBe("issue-42");
  });
});

describe("workspacePath", () => {
  it("joins root and sanitized issue name", () => {
    expect(workspacePath("/workspaces", 42)).toBe("/workspaces/issue-42");
  });
});

describe("validateWorkspacePath", () => {
  it("accepts paths under the root", () => {
    expect(() =>
      validateWorkspacePath("/workspaces", "/workspaces/issue-42")
    ).not.toThrow();
  });

  it("rejects paths outside the root", () => {
    expect(() =>
      validateWorkspacePath("/workspaces", "/etc/passwd")
    ).toThrow("outside workspace root");
  });

  it("rejects path traversal attempts", () => {
    expect(() =>
      validateWorkspacePath("/workspaces", "/workspaces/../etc/passwd")
    ).toThrow("outside workspace root");
  });
});
