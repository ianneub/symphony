import { Octokit } from "octokit";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { Issue, BlockingIssue } from "./types.js";
import { logger } from "./logger.js";

let octokit: Octokit;

export function initGitHub(token?: string) {
  octokit = new Octokit({ auth: token ?? process.env.GITHUB_TOKEN });
}

/** A single issue item from the REST list-for-repo response. */
type GitHubRestIssue =
  RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"][number];

/** Label shape returned by the REST API – may be a string or an object. */
type IssueLabel = string | { name?: string | undefined };

/** Typed shape for the GraphQL blockedBy query response. */
interface BlockedByGraphQLResponse {
  repository: {
    issue: {
      blockedBy: {
        nodes: Array<{
          number: number;
          title: string;
          state: string;
        }>;
      };
    };
  };
}

export function normalizeIssue(
  raw: GitHubRestIssue,
  blockedBy: BlockingIssue[]
): Issue {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    labels: (raw.labels ?? []).map((l: IssueLabel) =>
      typeof l === "string" ? l : l.name ?? ""
    ),
    state: raw.state as "open" | "closed",
    url: raw.html_url,
    blocked_by: blockedBy,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function isBlocked(issue: Issue): boolean {
  return issue.blocked_by.some((b) => b.state === "OPEN");
}

export async function fetchIssues(
  owner: string,
  repo: string,
  label: string
): Promise<Issue[]> {
  const log = logger.child({ component: "github" });

  const { data: rawIssues } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: label,
    state: "open",
    per_page: 100,
  });

  // Filter out pull requests (GitHub REST API returns PRs in issues endpoint)
  const issuesOnly = rawIssues.filter((i) => !i.pull_request);

  if (issuesOnly.length === 0) {
    return [];
  }

  const issueNumbers = issuesOnly.map((i) => i.number);
  const blockedByMap = await fetchBlockedBy(owner, repo, issueNumbers);

  const issues = issuesOnly.map((raw) =>
    normalizeIssue(raw, blockedByMap.get(raw.number) ?? [])
  );

  log.info({ count: issues.length }, "Fetched issues from GitHub");
  return issues;
}

async function fetchBlockedBy(
  owner: string,
  repo: string,
  issueNumbers: number[]
): Promise<Map<number, BlockingIssue[]>> {
  const result = new Map<number, BlockingIssue[]>();

  for (const num of issueNumbers) {
    try {
      const response = await octokit.graphql<BlockedByGraphQLResponse>(
        `query($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $number) {
              blockedBy(first: 10) {
                nodes {
                  number
                  title
                  state
                }
              }
            }
          }
        }`,
        { owner, repo, number: num }
      );

      const nodes = response.repository.issue.blockedBy.nodes ?? [];
      result.set(
        num,
        nodes.map((n) => ({
          number: n.number,
          title: n.title,
          state: n.state,
        }))
      );
    } catch (err) {
      logger.warn({ issue: num, err }, "Failed to fetch blockedBy");
      result.set(num, []);
    }
  }

  return result;
}

export async function isIssueActive(
  owner: string,
  repo: string,
  issueNumber: number,
  label: string
): Promise<boolean> {
  try {
    const { data } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    if (data.state !== "open") return false;

    const labels = (data.labels ?? []).map((l: IssueLabel) =>
      typeof l === "string" ? l : l.name ?? ""
    );
    return labels.includes(label);
  } catch {
    return false;
  }
}
