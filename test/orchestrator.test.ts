import { describe, it, expect, vi } from "vitest";
import { calculateBackoff, shouldRetry, executeHooks } from "../src/orchestrator.js";
import { execFileSync } from "child_process";

describe("calculateBackoff", () => {
  it("returns 10s for first attempt", () => {
    expect(calculateBackoff(1)).toBe(10_000);
  });

  it("doubles each attempt", () => {
    expect(calculateBackoff(2)).toBe(20_000);
    expect(calculateBackoff(3)).toBe(40_000);
  });

  it("caps at 5 minutes", () => {
    expect(calculateBackoff(10)).toBe(300_000);
  });
});

describe("shouldRetry", () => {
  it("returns true when nextRetryAt is in the past", () => {
    const entry = { nextRetryAt: new Date(Date.now() - 1000) } as any;
    expect(shouldRetry(entry)).toBe(true);
  });

  it("returns false when nextRetryAt is in the future", () => {
    const entry = { nextRetryAt: new Date(Date.now() + 60_000) } as any;
    expect(shouldRetry(entry)).toBe(false);
  });
});

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("executeHooks", () => {
  it("executes each command with execFileSync", () => {
    const mockExec = vi.mocked(execFileSync);
    mockExec.mockClear();

    executeHooks(["npm install", "npm run build"], "/workspace");

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenCalledWith("npm", ["install"], {
      cwd: "/workspace",
      stdio: "pipe",
    });
    expect(mockExec).toHaveBeenCalledWith("npm", ["run", "build"], {
      cwd: "/workspace",
      stdio: "pipe",
    });
  });

  it("handles commands with no arguments", () => {
    const mockExec = vi.mocked(execFileSync);
    mockExec.mockClear();

    executeHooks(["ls"], "/workspace");

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith("ls", [], {
      cwd: "/workspace",
      stdio: "pipe",
    });
  });

  it("propagates errors from execFileSync", () => {
    const mockExec = vi.mocked(execFileSync);
    mockExec.mockClear();
    mockExec.mockImplementation(() => {
      throw new Error("command failed");
    });

    expect(() => executeHooks(["bad-command"], "/workspace")).toThrow(
      "command failed"
    );
  });

  it("stops executing on first failure", () => {
    const mockExec = vi.mocked(execFileSync);
    mockExec.mockClear();
    mockExec.mockImplementationOnce(() => {
      throw new Error("first failed");
    });

    expect(() =>
      executeHooks(["fail-cmd", "second-cmd"], "/workspace")
    ).toThrow("first failed");
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("does nothing with empty array", () => {
    const mockExec = vi.mocked(execFileSync);
    mockExec.mockClear();

    executeHooks([], "/workspace");

    expect(mockExec).not.toHaveBeenCalled();
  });
});
