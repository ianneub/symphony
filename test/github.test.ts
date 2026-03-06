import { describe, it, expect } from "vitest";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { normalizeIssue, isBlocked } from "../src/github.js";
import type { Issue } from "../src/types.js";

type GitHubRestIssue =
  RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"][number];

/** Helper to build a minimal typed REST issue fixture. */
function makeRawIssue(
  overrides: Partial<GitHubRestIssue> = {}
): GitHubRestIssue {
  return {
    id: 1,
    number: 42,
    title: "Fix bug",
    body: "Description",
    labels: [{ id: 1, name: "agent", default: false, node_id: "", url: "", description: null, color: null }, { id: 2, name: "bug", default: false, node_id: "", url: "", description: null, color: null }],
    state: "open",
    html_url: "https://github.com/org/repo/issues/42",
    created_at: "2026-03-06T00:00:00Z",
    updated_at: "2026-03-06T01:00:00Z",
    node_id: "",
    url: "",
    repository_url: "",
    labels_url: "",
    comments_url: "",
    events_url: "",
    locked: false,
    comments: 0,
    closed_at: null,
    author_association: "NONE",
    reactions: {
      url: "",
      total_count: 0,
      "+1": 0,
      "-1": 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    timeline_url: "",
    user: null,
    ...overrides,
  } as GitHubRestIssue;
}

describe("normalizeIssue", () => {
  it("normalizes a GitHub REST issue response", () => {
    const raw = makeRawIssue();
    const result = normalizeIssue(raw, []);
    expect(result.number).toBe(42);
    expect(result.labels).toEqual(["agent", "bug"]);
    expect(result.blocked_by).toEqual([]);
  });
});

describe("isBlocked", () => {
  const baseIssue: Issue = {
    id: 1,
    number: 1,
    title: "Test",
    body: "",
    labels: [],
    state: "open",
    url: "",
    blocked_by: [],
    created_at: "",
    updated_at: "",
  };

  it("returns false when no blockers", () => {
    expect(isBlocked({ ...baseIssue, blocked_by: [] })).toBe(false);
  });

  it("returns true when blocked by open issue", () => {
    expect(
      isBlocked({
        ...baseIssue,
        blocked_by: [{ number: 10, title: "Blocker", state: "OPEN" }],
      })
    ).toBe(true);
  });

  it("returns false when blocker is closed", () => {
    expect(
      isBlocked({
        ...baseIssue,
        blocked_by: [{ number: 10, title: "Blocker", state: "CLOSED" }],
      })
    ).toBe(false);
  });
});
