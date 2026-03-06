import { describe, it, expect } from "vitest";
import { normalizeIssue, isBlocked } from "../src/github.js";

describe("normalizeIssue", () => {
  it("normalizes a GitHub REST issue response", () => {
    const raw = {
      id: 1,
      number: 42,
      title: "Fix bug",
      body: "Description",
      labels: [{ name: "agent" }, { name: "bug" }],
      state: "open",
      html_url: "https://github.com/org/repo/issues/42",
      created_at: "2026-03-06T00:00:00Z",
      updated_at: "2026-03-06T01:00:00Z",
    };
    const result = normalizeIssue(raw, []);
    expect(result.number).toBe(42);
    expect(result.labels).toEqual(["agent", "bug"]);
    expect(result.blocked_by).toEqual([]);
  });
});

describe("isBlocked", () => {
  it("returns false when no blockers", () => {
    expect(isBlocked({ blocked_by: [] } as any)).toBe(false);
  });

  it("returns true when blocked by open issue", () => {
    expect(
      isBlocked({
        blocked_by: [{ number: 10, title: "Blocker", state: "OPEN" }],
      } as any)
    ).toBe(true);
  });

  it("returns false when blocker is closed", () => {
    expect(
      isBlocked({
        blocked_by: [{ number: 10, title: "Blocker", state: "CLOSED" }],
      } as any)
    ).toBe(false);
  });
});
